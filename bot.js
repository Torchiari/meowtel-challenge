// Bot V2 para Midnight Kitchen.
// Navegación compartida, memoria por rol y heurísticas basadas en RULES.md.

const DIRECTIONS = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'W', dx: -1, dy: 0 },
];

const VALID_DIRS = ['N', 'S', 'E', 'W'];
const INF = 0x3fffffff;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value) {
  if (!value || !isNumber(value.x) || !isNumber(value.y) ||
      !Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;
  return { x: value.x, y: value.y };
}

function readTile(value) {
  if (!Array.isArray(value) || value.length < 2 ||
      !Number.isInteger(value[0]) || !Number.isInteger(value[1])) return null;
  return { x: value[0], y: value[1] };
}

function isValidMap(map) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
      map.width <= 0 || map.height <= 0 || !Number.isSafeInteger(map.width * map.height) ||
      !Array.isArray(map.rows) || map.rows.length < map.height || !Array.isArray(map.holes)) return false;
  for (let y = 0; y < map.height; y++) {
    if (typeof map.rows[y] !== 'string' || map.rows[y].length < map.width) return false;
  }
  return true;
}

function makeDebug(setup, message) {
  const rules = setup && setup.rules;
  const limit = rules && Number.isInteger(rules.debugMaxChars) && rules.debugMaxChars >= 0
    ? rules.debugMaxChars
    : 120;
  return String(message).slice(0, limit);
}

function makeAction(setup, move, fields, message) {
  const action = { move: VALID_DIRS.includes(move) || move === 'STAY' ? move : 'STAY' };
  if (fields) {
    for (const key of Object.keys(fields)) action[key] = fields[key];
  }
  action.debug = makeDebug(setup, message);
  return action;
}

function createBot(setup) {
  const role = setup && setup.role;
  const map = setup && setup.map;
  const mapValid = isValidMap(map);
  const area = mapValid ? map.width * map.height : 0;

  function inBounds(x, y) {
    return mapValid && Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function nodeId(x, y) {
    return inBounds(x, y) ? y * map.width + x : -1;
  }

  function coordinates(id) {
    if (!mapValid || !Number.isInteger(id) || id < 0 || id >= area) return null;
    return { x: id % map.width, y: Math.floor(id / map.width) };
  }

  function tileAt(x, y) {
    return inBounds(x, y) ? map.rows[y][x] : null;
  }

  function isWalkable(id) {
    const point = coordinates(id);
    if (!point) return false;
    const tile = tileAt(point.x, point.y);
    return tile === '.' || tile === 'T';
  }

  function directionBetween(fromId, toId) {
    const from = coordinates(fromId);
    const to = coordinates(toId);
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (const step of DIRECTIONS) {
      if (step.dx === dx && step.dy === dy) return step.dir;
    }
    return null;
  }

  // El mapa no cambia durante una partida; se guardan los vecinos una sola vez.
  const neighbors = new Array(area);
  for (let id = 0; id < area; id++) {
    neighbors[id] = [];
    if (!isWalkable(id)) continue;
    const point = coordinates(id);
    for (const step of DIRECTIONS) {
      const next = nodeId(point.x + step.dx, point.y + step.dy);
      if (next >= 0 && isWalkable(next)) neighbors[id].push({ id: next, dir: step.dir });
    }
  }

  const holes = [];
  if (mapValid) {
    for (let i = 0; i < map.holes.length; i++) {
      const hole = map.holes[i];
      const point = readPoint(hole);
      const entrance = hole && readPoint(hole.entrance);
      if (!point || !entrance || tileAt(point.x, point.y) !== 'H' ||
          !isWalkable(nodeId(entrance.x, entrance.y)) ||
          Math.abs(point.x - entrance.x) + Math.abs(point.y - entrance.y) !== 1) {
        holes.push(null);
        continue;
      }
      holes.push({
        index: i,
        id: nodeId(point.x, point.y),
        point,
        entrance,
        entranceId: nodeId(entrance.x, entrance.y),
        exitDirection: directionBetween(nodeId(point.x, point.y), nodeId(entrance.x, entrance.y)),
        enterDirection: directionBetween(nodeId(entrance.x, entrance.y), nodeId(point.x, point.y)),
      });
    }
  }

  function buildTree(startId, stopId) {
    if (!isWalkable(startId)) return null;
    const distance = new Int32Array(area);
    const cost = new Int32Array(area);
    const previous = new Int32Array(area);
    distance.fill(-1);
    cost.fill(INF);
    previous.fill(-1);

    const queue = new Int32Array(area);
    let head = 0;
    let tail = 0;
    distance[startId] = 0;
    cost[startId] = 0;
    queue[tail++] = startId;

    while (head < tail) {
      const current = queue[head++];
      if (current === stopId) break;
      const nextDistance = distance[current] + 1;
      const nextCost = cost[current] + 10;
      for (const edge of neighbors[current]) {
        const next = edge.id;
        if (distance[next] >= 0) continue;
        distance[next] = nextDistance;
        cost[next] = nextCost;
        previous[next] = current;
        queue[tail++] = next;
      }
    }
    return { startId, distance, cost, previous };
  }

  // Para el peligro basta medir el entorno cercano: el resto no recibe penalización.
  function buildThreatField(startId, maxDistance) {
    const distance = new Int32Array(area);
    distance.fill(-1);
    if (!isWalkable(startId)) return { distance };
    const queue = new Int32Array(area);
    let head = 0;
    let tail = 0;
    distance[startId] = 0;
    queue[tail++] = startId;
    while (head < tail) {
      const current = queue[head++];
      if (distance[current] >= maxDistance) continue;
      const nextDistance = distance[current] + 1;
      for (const edge of neighbors[current]) {
        if (distance[edge.id] >= 0) continue;
        distance[edge.id] = nextDistance;
        queue[tail++] = edge.id;
      }
    }
    return { distance };
  }

  function riskPenalty(id, catDistance, confidence) {
    if (!catDistance || confidence <= 0) return 0;
    const distance = catDistance[id];
    if (distance < 0) return 0;
    let penalty = 0;
    if (distance <= 1) penalty = 100;
    else if (distance === 2) penalty = 70;
    else if (distance === 3) penalty = 38;
    else if (distance <= 5) penalty = 14;
    return Math.round(penalty * confidence);
  }

  function heapPush(heap, id, cost) {
    let index = heap.ids.length;
    heap.ids.push(id);
    heap.costs.push(cost);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap.costs[parent] <= cost) break;
      heap.ids[index] = heap.ids[parent];
      heap.costs[index] = heap.costs[parent];
      index = parent;
    }
    heap.ids[index] = id;
    heap.costs[index] = cost;
  }

  function heapPop(heap) {
    const rootId = heap.ids[0];
    const rootCost = heap.costs[0];
    const lastIndex = heap.ids.length - 1;
    const lastId = heap.ids.pop();
    const lastCost = heap.costs.pop();
    if (lastIndex > 0) {
      let index = 0;
      const length = heap.ids.length;
      while (true) {
        const left = index * 2 + 1;
        if (left >= length) break;
        const right = left + 1;
        const child = right < length && heap.costs[right] < heap.costs[left] ? right : left;
        if (heap.costs[child] >= lastCost) break;
        heap.ids[index] = heap.ids[child];
        heap.costs[index] = heap.costs[child];
        index = child;
      }
      heap.ids[index] = lastId;
      heap.costs[index] = lastCost;
    }
    return { id: rootId, cost: rootCost };
  }

  // Dijkstra usa una penalización de riesgo en cada casilla del recorrido.
  function buildRiskTree(startId, catDistance, confidence) {
    if (!isWalkable(startId)) return null;
    const cost = new Int32Array(area);
    const distance = new Int32Array(area);
    const previous = new Int32Array(area);
    cost.fill(INF);
    distance.fill(INF);
    previous.fill(-1);

    const heap = { ids: [], costs: [] };
    cost[startId] = 0;
    distance[startId] = 0;
    heapPush(heap, startId, 0);

    while (heap.ids.length > 0) {
      const current = heapPop(heap);
      if (current.cost !== cost[current.id]) continue;
      for (const edge of neighbors[current.id]) {
        const next = edge.id;
        const nextCost = current.cost + 10 + riskPenalty(next, catDistance, confidence);
        const nextDistance = distance[current.id] + 1;
        if (nextCost > cost[next] ||
            (nextCost === cost[next] && nextDistance >= distance[next])) continue;
        cost[next] = nextCost;
        distance[next] = nextDistance;
        previous[next] = current.id;
        heapPush(heap, next, nextCost);
      }
    }
    return { startId, distance, cost, previous };
  }

  function pathFromTree(tree, targetId) {
    if (!tree || !Number.isInteger(targetId) || targetId < 0 || targetId >= area ||
        tree.distance[targetId] < 0 || tree.distance[targetId] >= INF) return null;
    const path = [];
    let current = targetId;
    while (current !== tree.startId) {
      path.push(current);
      current = tree.previous[current];
      if (current < 0) return null;
    }
    path.reverse();
    return path;
  }

  function routeFromTree(tree, targetId) {
    if (!tree || !Number.isInteger(targetId) || targetId < 0 || targetId >= area ||
        tree.distance[targetId] < 0 || tree.distance[targetId] >= INF) return null;
    const path = pathFromTree(tree, targetId);
    if (!path) return null;
    return {
      distance: tree.distance[targetId],
      cost: tree.cost[targetId],
      firstDir: path.length ? directionBetween(tree.startId, path[0]) : null,
      path,
    };
  }

  function routeToHole(tree, index) {
    const hole = holes[index];
    if (!hole || !tree || tree.distance[hole.entranceId] < 0 ||
        tree.distance[hole.entranceId] >= INF) return null;
    const toEntrance = routeFromTree(tree, hole.entranceId);
    if (!toEntrance) return null;
    const path = toEntrance.path.concat([hole.id]);
    return {
      distance: toEntrance.distance + 1,
      cost: toEntrance.cost + 10,
      firstDir: toEntrance.distance === 0 ? hole.enterDirection : toEntrance.firstDir,
      path,
      hole: index,
    };
  }

  function manhattan(a, b) {
    return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : Infinity;
  }

  function inBoundsPoint(point) {
    return !!point && nodeId(point.x, point.y) >= 0;
  }

  function buildCheeseDistance(cheeseTiles) {
    const distance = new Int32Array(area);
    distance.fill(-1);
    const queue = new Int32Array(area);
    let head = 0;
    let tail = 0;
    if (Array.isArray(cheeseTiles)) {
      for (const tile of cheeseTiles) {
        const point = readTile(tile);
        if (!point) continue;
        const id = nodeId(point.x, point.y);
        if (id < 0 || !isWalkable(id) || distance[id] >= 0) continue;
        distance[id] = 0;
        queue[tail++] = id;
      }
    }
    while (head < tail) {
      const current = queue[head++];
      for (const edge of neighbors[current]) {
        if (distance[edge.id] >= 0) continue;
        distance[edge.id] = distance[current] + 1;
        queue[tail++] = edge.id;
      }
    }
    return distance;
  }

  function rotatingLook(turn) {
    const index = Number.isInteger(turn) && turn > 0 ? (turn - 1) % 4 : 0;
    return DIRECTIONS[index].dir;
  }

  function validEntityPosition(entity) {
    const point = readPoint(entity);
    return point && inBoundsPoint(point) ? point : null;
  }

  if (role === 'cat') {
    const memory = {
      lastSight: null,
      velocity: null,
      eventTarget: null,
      postHole: -1,
      postHoleUntil: -1,
      ignoredScentUntil: -1,
      visits: new Int32Array(area),
      seen: new Int32Array(area),
      searchedCheeseUntil: new Int32Array(area),
      targetId: -1,
      targetType: '',
      initialStamina: null,
      sprintCost: 1,
      previousStamina: null,
      previousSprint: false,
    };
    memory.visits.fill(-10000);
    memory.seen.fill(-10000);
    memory.searchedCheeseUntil.fill(-1);

    function processCatEvents(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== 'string') continue;
        if (event.type === 'caught') {
          memory.lastSight = null;
          memory.velocity = null;
          memory.eventTarget = null;
          memory.postHole = Number.isInteger(event.respawnHole) ? event.respawnHole : -1;
          memory.postHoleUntil = turn + 3;
          memory.ignoredScentUntil = turn + 1;
          memory.targetId = -1;
          memory.targetType = '';
        } else if (event.type === 'delivered') {
          memory.lastSight = null;
          memory.velocity = null;
          memory.eventTarget = null;
          memory.postHole = Number.isInteger(event.hole) ? event.hole : -1;
          memory.postHoleUntil = turn + 2;
          memory.targetId = -1;
          memory.targetType = '';
        } else if (event.type === 'pickup' || event.type === 'dropped') {
          if (Number.isInteger(event.x) && Number.isInteger(event.y) &&
              nodeId(event.x, event.y) >= 0) {
            memory.lastSight = {
              x: event.x,
              y: event.y,
              turn: turn - 1,
              carrying: event.type === 'pickup',
            };
            memory.velocity = null;
            memory.eventTarget = {
              point: { x: event.x, y: event.y },
              turn: turn - 1,
            };
            memory.postHole = -1;
            memory.targetId = -1;
            memory.targetType = '';
          }
        }
      }
    }

    function selectScentTarget(obs, tree, startId) {
      if (!Array.isArray(obs.scent)) return null;
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const recentCatch = turn <= memory.ignoredScentUntil;
      let best = null;
      let bestScore = -Infinity;
      for (const scent of obs.scent) {
        if (!Array.isArray(scent) || scent.length < 3 ||
            !Number.isInteger(scent[0]) || !Number.isInteger(scent[1]) ||
            !isNumber(scent[2])) continue;
        const id = nodeId(scent[0], scent[1]);
        if (id < 0 || !isWalkable(id) || id === startId) continue;
        const distance = tree.distance[id];
        if (distance < 0) continue;
        const strength = Math.max(0, Math.min(1, scent[2]));
        if (strength < (recentCatch ? 0.85 : 0.08)) continue;
        const score = strength * 40 - distance * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = { id, type: 'scent', reason: 'seguir olor' };
        }
      }
      return best;
    }

    function chooseCheeseTarget(obs, tree) {
      if (!Array.isArray(obs.cheese)) return null;
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      let bestId = -1;
      let bestScore = Infinity;
      for (const tile of obs.cheese) {
        const point = readTile(tile);
        if (!point) continue;
        const id = nodeId(point.x, point.y);
        if (id < 0 || !isWalkable(id) || tree.distance[id] < 0 ||
            memory.searchedCheeseUntil[id] > turn) continue;
        const score = tree.cost[id];
        if (score < bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      return bestId >= 0 ? { id: bestId, type: 'cheese', reason: 'investigar queso' } : null;
    }

    function chooseExploreTarget(tree, startId, turn) {
      let bestId = -1;
      let bestScore = -Infinity;
      for (let id = 0; id < area; id++) {
        if (id === startId || !isWalkable(id) || tree.distance[id] < 0) continue;
        const visitAge = Math.min(30, Math.max(0, turn - memory.visits[id]));
        const seeAge = Math.min(20, Math.max(0, turn - memory.seen[id]));
        const score = visitAge * 0.7 + seeAge * 0.3 - tree.distance[id] * 1.6;
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      return bestId >= 0 ? { id: bestId, type: 'explore', reason: 'explorar zona poco visitada' } : null;
    }

    return function act(obs) {
      if (!mapValid || !obs || !validEntityPosition(obs.you)) {
        return makeAction(setup, 'STAY', null, 'gato: observación o mapa inválido');
      }
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const you = validEntityPosition(obs.you);
      const startId = nodeId(you.x, you.y);
      if (!isWalkable(startId)) return makeAction(setup, 'STAY', null, 'gato: posición fuera del piso');
      const visibleMouse = validEntityPosition(obs.mouse);
      const visibleMouseId = visibleMouse ? nodeId(visibleMouse.x, visibleMouse.y) : -1;
      const tree = buildTree(startId, isWalkable(visibleMouseId) ? visibleMouseId : -1);

      if (memory.initialStamina === null && isNumber(obs.you.stamina)) {
        memory.initialStamina = obs.you.stamina;
      }
      if (memory.previousSprint && isNumber(memory.previousStamina) && isNumber(obs.you.stamina)) {
        const observedCost = memory.previousStamina - obs.you.stamina;
        if (observedCost > 0) memory.sprintCost = memory.sprintCost * 0.6 + observedCost * 0.4;
      }
      memory.previousStamina = isNumber(obs.you.stamina) ? obs.you.stamina : null;
      memory.previousSprint = false;

      processCatEvents(obs.events, turn);
      memory.visits[startId] = turn;
      if (Array.isArray(obs.visible)) {
        for (const tile of obs.visible) {
          const point = readTile(tile);
          if (!point) continue;
          const id = nodeId(point.x, point.y);
          if (id >= 0) memory.seen[id] = turn;
        }
      }

      if (memory.targetType === 'cheese' && memory.targetId === startId &&
          !obs.mouse && turn > 0) {
        memory.searchedCheeseUntil[startId] = turn + 12;
      }

      let goal = null;
      if (visibleMouse) {
        if (memory.lastSight && turn - memory.lastSight.turn === 1) {
          const dx = visibleMouse.x - memory.lastSight.x;
          const dy = visibleMouse.y - memory.lastSight.y;
          if (Math.abs(dx) + Math.abs(dy) === 1) memory.velocity = { dx, dy };
          else memory.velocity = null;
        } else {
          memory.velocity = null;
        }
        memory.lastSight = {
          x: visibleMouse.x,
          y: visibleMouse.y,
          turn,
          carrying: obs.mouse.carrying === true,
        };
        memory.eventTarget = null;
        memory.postHole = -1;
        goal = {
          id: nodeId(visibleMouse.x, visibleMouse.y),
          type: 'visible',
          reason: obs.mouse.carrying ? 'perseguir ratón con queso' : 'perseguir ratón visible',
        };
      }

      if (!goal) goal = selectScentTarget(obs, tree, startId);

      if (!goal && memory.eventTarget && turn - memory.eventTarget.turn <= 1) {
        const id = nodeId(memory.eventTarget.point.x, memory.eventTarget.point.y);
        if (id >= 0 && tree.distance[id] >= 0) {
          goal = { id, type: 'event', reason: 'seguir evento reciente' };
        }
      }

      const postHole = memory.postHole >= 0 ? holes[memory.postHole] : null;
      if (!goal && postHole && turn <= memory.postHoleUntil) {
        goal = {
          id: postHole.entranceId,
          type: 'holeIntercept',
          reason: 'vigilar salida del agujero',
          holeDirection: postHole.enterDirection,
        };
      }

      if (!goal && memory.lastSight && turn - memory.lastSight.turn <= 3) {
        const age = Math.max(0, turn - memory.lastSight.turn);
        let point = { x: memory.lastSight.x, y: memory.lastSight.y };
        if (memory.velocity && age > 0 && age <= 2) {
          const predicted = {
            x: point.x + memory.velocity.dx * age,
            y: point.y + memory.velocity.dy * age,
          };
          if (isWalkable(nodeId(predicted.x, predicted.y))) point = predicted;
        }
        const id = nodeId(point.x, point.y);
        if (id >= 0 && tree.distance[id] > 0) {
          goal = { id, type: 'memory', reason: 'buscar posición reciente' };
        }
      }

      if (!goal && memory.eventTarget && turn - memory.eventTarget.turn <= 2) {
        const id = nodeId(memory.eventTarget.point.x, memory.eventTarget.point.y);
        if (id >= 0 && tree.distance[id] > 0) {
          goal = { id, type: 'event', reason: 'investigar evento' };
        }
      }

      if (!goal) goal = chooseCheeseTarget(obs, tree);
      if (!goal) goal = chooseExploreTarget(tree, startId, turn);

      if (!goal) {
        return makeAction(setup, 'STAY', { look: rotatingLook(turn) }, 'gato: barrido de visión');
      }

      const route = routeFromTree(tree, goal.id);
      if (!route) {
        memory.targetId = -1;
        memory.targetType = '';
        return makeAction(setup, 'STAY', { look: rotatingLook(turn) }, 'gato: objetivo sin ruta');
      }

      if (route.distance === 0 && goal.type !== 'visible' && goal.type !== 'holeIntercept') {
        if (goal.type === 'cheese') memory.searchedCheeseUntil[goal.id] = turn + 12;
        memory.targetId = -1;
        memory.targetType = '';
        const nextGoal = chooseExploreTarget(tree, startId, turn);
        if (!nextGoal) return makeAction(setup, 'STAY', { look: rotatingLook(turn) }, 'gato: inspección terminada');
        const nextRoute = routeFromTree(tree, nextGoal.id);
        if (!nextRoute || nextRoute.distance === 0) {
          return makeAction(setup, 'STAY', { look: rotatingLook(turn) }, 'gato: barrido de zona');
        }
        goal.id = nextGoal.id;
        goal.type = nextGoal.type;
        goal.reason = nextGoal.reason;
        goal.route = nextRoute;
      }

      const selectedRoute = goal.route || route;
      const move = selectedRoute.firstDir || 'STAY';
      let look = selectedRoute.firstDir;
      if (!look && goal.type === 'holeIntercept' && goal.holeDirection) look = goal.holeDirection;
      if (!look) look = rotatingLook(turn);

      let sprint = false;
      if (visibleMouse && selectedRoute.path.length >= 2 &&
          isNumber(obs.you.stamina) && memory.initialStamina !== null) {
        const first = directionBetween(startId, selectedRoute.path[0]);
        const second = directionBetween(selectedRoute.path[0], selectedRoute.path[1]);
        const straight = first !== null && first === second;
        const directCatch = selectedRoute.distance <= 2;
        const reserve = directCatch ? 0 : Math.max(1, Math.ceil(memory.initialStamina * 0.2));
        sprint = straight && obs.you.stamina >= memory.sprintCost + reserve;
      }
      if (goal.type === 'holeIntercept' && goal.id === startId) {
        return makeAction(setup, 'STAY', { look }, goal.reason);
      }

      memory.targetId = goal.id;
      memory.targetType = goal.type;
      memory.previousSprint = sprint;
      const fields = { look };
      if (sprint) fields.sprint = true;
      return makeAction(setup, move, fields,
        'gato: ' + goal.reason + (sprint ? '; sprint recto' : '; paso normal'));
    };
  }

  if (role === 'mouse') {
    const taxEvery = setup && setup.rules && isNumber(setup.rules.hidingTaxEvery) &&
      setup.rules.hidingTaxEvery > 0 ? setup.rules.hidingTaxEvery : Infinity;
    const tunnelEstimates = new Array(holes.length);
    for (let i = 0; i < holes.length; i++) tunnelEstimates[i] = new Float64Array(holes.length);

    const memory = {
      lastCat: null,
      previousBell: null,
      visited: new Int32Array(area),
      hiddenTurns: 0,
      hidingTaxEvents: 0,
      lastHiddenTurn: -1,
      waitingHole: -1,
      holeWaitTurns: 0,
      pendingTunnel: null,
      mustStepOffId: -1,
    };
    memory.visited.fill(-10000);

    function processMouseEvents(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== 'string') continue;
        if (event.type === 'caught') {
          memory.pendingTunnel = null;
          memory.mustStepOffId = -1;
          if (Number.isInteger(event.x) && Number.isInteger(event.y) &&
              nodeId(event.x, event.y) >= 0) {
            memory.lastCat = { x: event.x, y: event.y, turn: turn - 1 };
          }
        } else if (event.type === 'dropped') {
          const id = nodeId(event.x, event.y);
          if (id >= 0) {
            memory.mustStepOffId = id;
          }
        } else if (event.type === 'pickup' || event.type === 'delivered') {
          memory.mustStepOffId = -1;
        } else if (event.type === 'hidingTax') {
          memory.hidingTaxEvents++;
          if (Number.isFinite(taxEvery)) {
            memory.hiddenTurns = Math.max(memory.hiddenTurns, memory.hidingTaxEvents * taxEvery);
          }
        }
      }
    }

    function updateTunnelEstimate(obs, turn) {
      const pending = memory.pendingTunnel;
      if (!pending) return;
      if (obs.you.tunneling && isNumber(obs.you.tunneling.turnsLeft)) {
        pending.lastTurnsLeft = obs.you.tunneling.turnsLeft;
        pending.projectedDuration = Math.max(
          pending.projectedDuration || 0,
          turn - pending.startTurn + obs.you.tunneling.turnsLeft
        );
        return;
      }
      if (obs.you.inHole === pending.to) {
        const observed = Math.max(1, turn - pending.startTurn);
        const estimate = pending.projectedDuration > 0
          ? Math.max(observed, Math.min(pending.projectedDuration, observed + 1))
          : observed;
        const old = tunnelEstimates[pending.from] && tunnelEstimates[pending.from][pending.to];
        tunnelEstimates[pending.from][pending.to] = old > 0 ? old * 0.65 + estimate * 0.35 : estimate;
        memory.pendingTunnel = null;
      } else if (turn - pending.startTurn > 30) {
        memory.pendingTunnel = null;
      }
    }

    function estimateTunnel(from, to) {
      const known = tunnelEstimates[from] && tunnelEstimates[from][to];
      if (known > 0) return known;
      const a = holes[from];
      const b = holes[to];
      if (!a || !b) return 4;
      // Estimación inicial: los viajes son de varios turnos y crecen con la distancia.
      return Math.max(2, 2 + Math.floor(manhattan(a.point, b.point) / 5));
    }

    function chooseCheese(tree, cheeseTiles, skipId) {
      if (!Array.isArray(cheeseTiles)) return null;
      let bestId = -1;
      let bestCost = INF;
      let bestSteps = INF;
      for (const tile of cheeseTiles) {
        const point = readTile(tile);
        if (!point) continue;
        const id = nodeId(point.x, point.y);
        if (id < 0 || !isWalkable(id) || id === skipId ||
            tree.distance[id] < 0 || tree.distance[id] >= INF) continue;
        const cost = tree.cost[id];
        const steps = tree.distance[id];
        if (cost < bestCost || (cost === bestCost && steps < bestSteps)) {
          bestId = id;
          bestCost = cost;
          bestSteps = steps;
        }
      }
      return bestId >= 0 ? routeFromTree(tree, bestId) : null;
    }

    function chooseHole(tree) {
      if (!tree) return null;
      let bestIndex = -1;
      let bestCost = INF;
      let bestSteps = INF;
      for (const hole of holes) {
        if (!hole || tree.distance[hole.entranceId] < 0 ||
            tree.distance[hole.entranceId] >= INF) continue;
        const cost = tree.cost[hole.entranceId] + 10;
        const steps = tree.distance[hole.entranceId] + 1;
        if (cost < bestCost || (cost === bestCost && steps < bestSteps)) {
          bestIndex = hole.index;
          bestCost = cost;
          bestSteps = steps;
        }
      }
      return bestIndex >= 0 ? routeToHole(tree, bestIndex) : null;
    }

    function chooseExplore(tree, startId, turn) {
      let bestId = -1;
      let bestScore = -Infinity;
      for (let id = 0; id < area; id++) {
        if (id === startId || !isWalkable(id) || tree.distance[id] < 0 ||
            tree.distance[id] >= INF) continue;
        const age = Math.min(25, Math.max(0, turn - memory.visited[id]));
        const score = age - tree.distance[id] * 1.5;
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      return bestId >= 0 ? routeFromTree(tree, bestId) : null;
    }

    function tunnelChoice(currentIndex, cheeseDistance, catTree, confidence, urgent, bellUrgent) {
      const current = holes[currentIndex];
      if (!current) return null;
      const currentDistance = cheeseDistance[current.entranceId];
      const walkCost = currentDistance >= 0 ? currentDistance + 1 : INF;
      const catAtCurrentExit = catTree
        ? catTree.distance[current.entranceId]
        : INF;
      const threatenedExit = confidence >= 0.5 && catAtCurrentExit >= 0 && catAtCurrentExit <= 2;
      const remainingHide = Number.isFinite(taxEvery)
        ? taxEvery - (memory.hiddenTurns % taxEvery)
        : INF;

      let best = null;
      for (const destination of holes) {
        if (!destination || destination.index === currentIndex) continue;
        const surfaceDistance = cheeseDistance[destination.entranceId];
        const tunnelTurns = estimateTunnel(currentIndex, destination.index);
        const tunnelCost = surfaceDistance >= 0 ? tunnelTurns + 1 + surfaceDistance : INF;
        const catAtDestination = catTree
          ? catTree.distance[destination.entranceId]
          : INF;
        const spatialEscape = manhattan(current.entrance, destination.entrance);
        const knownEscape = threatenedExit &&
          (catAtDestination < 0 || catAtDestination >= catAtCurrentExit + 2);
        const blindEscape = bellUrgent && (!catTree || confidence < 0.5) && spatialEscape >= 5;
        const escape = knownEscape || blindEscape;
        const shortcut = tunnelCost < INF &&
          (walkCost >= INF || tunnelCost + 1 < walkCost);
        if (!escape && !shortcut) continue;
        if (!escape && remainingHide <= tunnelTurns + 1) continue;

        let score = tunnelCost;
        if (escape) score -= 100;
        if (catTree && confidence >= 0.3 && catAtDestination >= 0 && catAtDestination < 5) {
          score += (5 - catAtDestination) * 8;
        }
        if (bellUrgent && (!catTree || confidence < 0.5)) score -= Math.min(8, spatialEscape);
        if (!best || score < best.score) {
          best = { hole: destination.index, score, tunnelTurns, escape, spatialEscape };
        }
      }

      if (best && (best.escape || urgent || best.score < walkCost - 1)) return best;
      return null;
    }

    function chooseStepOff(tree, startId, catTree) {
      const edges = neighbors[startId] || [];
      let best = null;
      for (const edge of edges) {
        const catDistance = catTree ? catTree.distance[edge.id] : INF;
        const score = catDistance >= 0 && catDistance < INF ? catDistance : 100000;
        if (!best || score > best.score) best = { dir: edge.dir, score };
      }
      return best ? best.dir : 'STAY';
    }

    function chooseDrop(obs, startId, catTree, holeRoute) {
      if (!obs.you.carrying || obs.you.inHole !== null || obs.you.heavy !== true ||
          !obs.cat || !holeRoute || holeRoute.distance < 4 || !catTree) return false;
      const catDistance = catTree.distance[startId];
      // Soltar solo en un turno inmóvil donde el gato no alcanza la casilla este turno.
      const routeRisk = holeRoute.cost - holeRoute.distance * 10;
      const riskIsHigh = catDistance <= 4 || (catDistance <= 6 && routeRisk >= 30);
      return catDistance >= 3 && catDistance < INF && riskIsHigh;
    }

    return function act(obs) {
      if (!mapValid || !obs || !validEntityPosition(obs.you)) {
        return makeAction(setup, 'STAY', null, 'ratón: observación o mapa inválido');
      }
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const you = validEntityPosition(obs.you);
      const startId = nodeId(you.x, you.y);
      if (!isWalkable(startId) && obs.you.inHole === null && !obs.you.tunneling) {
        return makeAction(setup, 'STAY', null, 'ratón: posición fuera del piso');
      }

      processMouseEvents(obs.events, turn);
      updateTunnelEstimate(obs, turn);

      const hidden = obs.you.inHole !== null || !!obs.you.tunneling;
      if (hidden && memory.lastHiddenTurn !== turn) {
        memory.hiddenTurns++;
        memory.lastHiddenTurn = turn;
      }
      memory.visited[startId] = turn;

      const catPosition = validEntityPosition(obs.cat);
      if (catPosition) memory.lastCat = { x: catPosition.x, y: catPosition.y, turn };
      const previousBell = memory.previousBell;
      const bellApproaching = isNumber(obs.bell) && isNumber(previousBell) &&
        previousBell - obs.bell >= 0.8;
      const bellUrgent = obs.bellLoud === true || bellApproaching ||
        (isNumber(obs.bell) && obs.bell <= 3.5);
      memory.previousBell = isNumber(obs.bell) ? obs.bell : null;

      if (obs.you.tunneling) {
        const left = isNumber(obs.you.tunneling.turnsLeft) ? obs.you.tunneling.turnsLeft : '?';
        return makeAction(setup, 'STAY', null, 'ratón: túnel en curso; faltan ' + left);
      }

      let catTree = null;
      let confidence = 0;
      if (catPosition) {
        catTree = buildThreatField(nodeId(catPosition.x, catPosition.y), 8);
        confidence = 1;
      } else if (memory.lastCat && turn - memory.lastCat.turn <= 4) {
        catTree = buildThreatField(nodeId(memory.lastCat.x, memory.lastCat.y), 8);
        const age = Math.max(1, turn - memory.lastCat.turn);
        confidence = Math.max(0.15, 0.65 / age);
      }

      const catDistanceAtMouse = catTree ? catTree.distance[startId] : INF;
      const immediateThreat = catPosition && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 2;
      const urgent = !!immediateThreat || bellUrgent;
      const canUseRisk = !!catTree && confidence > 0;
      const inHole = obs.you.inHole !== null;
      const tree = inHole ? null : (canUseRisk
        ? buildRiskTree(startId, catTree.distance, confidence)
        : buildTree(startId));

      if (!tree && !inHole) {
        return makeAction(setup, 'STAY', null, 'ratón: no hay ruta desde esta casilla');
      }

      if (memory.mustStepOffId >= 0 && startId !== memory.mustStepOffId) {
        memory.mustStepOffId = -1;
      }
      if (inHole) {
        const holeIndex = obs.you.inHole;
        const hole = holes[holeIndex];
        if (!hole) return makeAction(setup, 'STAY', null, 'ratón: índice de agujero inválido');

        const cheeseDistance = buildCheeseDistance(obs.cheese);
        const tunnel = tunnelChoice(
          holeIndex,
          cheeseDistance,
          catTree,
          confidence,
          urgent,
          bellUrgent
        );
        if (tunnel) {
          memory.waitingHole = -1;
          memory.holeWaitTurns = 0;
          memory.pendingTunnel = { from: holeIndex, to: tunnel.hole, startTurn: turn, projectedDuration: 0 };
          return makeAction(setup, 'STAY', { tunnel: tunnel.hole },
            'ratón: túnel a ' + tunnel.hole + (tunnel.escape ? ' para escapar' : ' para acortar'));
        }

        const exitDistance = catTree ? catTree.distance[hole.entranceId] : INF;
        const nearTax = Number.isFinite(taxEvery) &&
          taxEvery - (memory.hiddenTurns % taxEvery) <= 1;
        if (confidence >= 0.5 && exitDistance >= 0 && exitDistance <= 1) {
          if (memory.waitingHole !== holeIndex) {
            memory.waitingHole = holeIndex;
            memory.holeWaitTurns = 0;
          }
          const waitLimit = nearTax ? 1 : 2;
          if (memory.holeWaitTurns < waitLimit) {
            memory.holeWaitTurns++;
            return makeAction(setup, 'STAY', null, 'ratón: espera brevemente al gato en agujero');
          }
        }
        memory.waitingHole = -1;
        memory.holeWaitTurns = 0;
        return makeAction(setup, hole.exitDirection || 'STAY', null, 'ratón: salir del agujero');
      }

      const cheeseRoute = obs.you.carrying ? null : chooseCheese(tree, obs.cheese, -1);
      const needHoleRoute = obs.you.carrying === true || urgent || obs.you.heavy === true;
      const holeRoute = needHoleRoute ? chooseHole(tree) : null;
      if (obs.you.heavy === true) {
        if (chooseDrop(obs, startId, catTree, holeRoute)) {
          memory.mustStepOffId = startId;
          return makeAction(setup, 'STAY', { drop: true }, 'ratón: soltar queso durante turno inmóvil');
        }
        return makeAction(setup, 'STAY', null, 'ratón: pesado, espera sin moverse');
      }

      if (memory.mustStepOffId === startId && !obs.you.carrying) {
        return makeAction(setup, chooseStepOff(tree, startId, catTree), null,
          'ratón: salir de la casilla del queso antes de recogerlo');
      }

      if (obs.you.carrying) {
        if (holeRoute) {
          return makeAction(setup, holeRoute.firstDir || 'STAY', null,
            'ratón: entregar queso por agujero ' + holeRoute.hole);
        }
        if (catTree && catDistanceAtMouse < INF) {
          let best = null;
          for (const edge of neighbors[startId]) {
            const distance = catTree.distance[edge.id];
            if (!best || distance > best.distance) best = { dir: edge.dir, distance };
          }
          if (best) return makeAction(setup, best.dir, null, 'ratón: escapar hacia casilla más segura');
        }
        return makeAction(setup, 'STAY', null, 'ratón: no hay agujero accesible');
      }

      if (urgent && holeRoute && (immediateThreat || bellUrgent)) {
        return makeAction(setup, holeRoute.firstDir || 'STAY', null, 'ratón: refugiarse por peligro cercano');
      }

      if (cheeseRoute) {
        if (cheeseRoute.distance === 0) {
          memory.mustStepOffId = startId;
          return makeAction(setup, chooseStepOff(tree, startId, catTree), null,
            'ratón: activar recogida pasando por la casilla');
        }
        return makeAction(setup, cheeseRoute.firstDir || 'STAY', null,
          'ratón: buscar queso a ' + cheeseRoute.distance + ' pasos');
      }

      const roamRoute = chooseExplore(tree, startId, turn);
      if (roamRoute) return makeAction(setup, roamRoute.firstDir || 'STAY', null, 'ratón: explorar el piso');
      return makeAction(setup, 'STAY', null, 'ratón: esperar queso nuevo');
    };
  }

  return function act() {
    return makeAction(setup, 'STAY', null, 'rol inválido');
  };
}
