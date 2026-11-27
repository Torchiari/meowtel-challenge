// Midnight Kitchen Bot V3.
// Persigue y patrulla como gato; recoge, entrega y escapa como raton.
// Sin imports ni estado fuera de la partida.

const MK_DIRS = ['N', 'E', 'S', 'W'];
const MK_DX = [0, 1, 0, -1];
const MK_DY = [-1, 0, 1, 0];
const MK_INF = 0x3fffffff;

function mkNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function mkPoint(value) {
  if (!value || !Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;
  return { x: value.x, y: value.y };
}

function mkTile(value) {
  if (!Array.isArray(value) || value.length < 2 ||
      !Number.isInteger(value[0]) || !Number.isInteger(value[1])) return null;
  return { x: value[0], y: value[1] };
}

function createBot(setup) {
  const role = setup && setup.role;
  const map = setup && setup.map;
  const rules = setup && setup.rules;
  const validMap = !!map && Number.isInteger(map.width) && Number.isInteger(map.height) &&
    map.width > 0 && map.height > 0 && Number.isSafeInteger(map.width * map.height) &&
    Array.isArray(map.rows) && map.rows.length >= map.height && Array.isArray(map.holes);

  if (!validMap) return function () { return { move: 'STAY' }; };

  const width = map.width;
  const height = map.height;
  const area = width * height;
  const walkable = new Uint8Array(area);
  const neighbors = new Array(area);
  const neighborDirs = new Array(area);

  function inBounds(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  }

  function idAt(x, y) {
    return inBounds(x, y) ? y * width + x : -1;
  }

  function pointId(point) {
    return point ? idAt(point.x, point.y) : -1;
  }

  function dirBetween(from, to) {
    const fx = from % width;
    const fy = Math.floor(from / width);
    const tx = to % width;
    const ty = Math.floor(to / width);
    for (let d = 0; d < 4; d++) {
      if (fx + MK_DX[d] === tx && fy + MK_DY[d] === ty) return d;
    }
    return -1;
  }

  for (let y = 0; y < height; y++) {
    if (typeof map.rows[y] !== 'string' || map.rows[y].length < width) {
      return function () { return { move: 'STAY' }; };
    }
    for (let x = 0; x < width; x++) {
      const tile = map.rows[y][x];
      if (tile === '.' || tile === 'T') walkable[y * width + x] = 1;
    }
  }

  for (let id = 0; id < area; id++) {
    const adjacent = [];
    const dirs = [];
    if (walkable[id]) {
      const x = id % width;
      const y = Math.floor(id / width);
      for (let d = 0; d < 4; d++) {
        const next = idAt(x + MK_DX[d], y + MK_DY[d]);
        if (next >= 0 && walkable[next]) {
          adjacent.push(next);
          dirs.push(d);
        }
      }
    }
    neighbors[id] = adjacent;
    neighborDirs[id] = dirs;
  }

  // Se conserva el índice original: `inHole` y `tunnel` usan ese índice.
  const holes = new Array(map.holes.length);
  const patrolBonus = new Int16Array(area);
  for (let i = 0; i < map.holes.length; i++) {
    const raw = map.holes[i];
    const p = mkPoint(raw);
    const entrance = raw && mkPoint(raw.entrance);
    if (!p || !entrance || !inBounds(p.x, p.y) || !inBounds(entrance.x, entrance.y)) continue;
    const holeId = idAt(p.x, p.y);
    const entranceId = idAt(entrance.x, entrance.y);
    if (map.rows[p.y][p.x] !== 'H' || !walkable[entranceId] ||
        Math.abs(p.x - entrance.x) + Math.abs(p.y - entrance.y) !== 1) continue;
    holes[i] = {
      index: i,
      id: holeId,
      entranceId,
      enterDir: dirBetween(entranceId, holeId),
      exitDir: dirBetween(holeId, entranceId),
      entrance,
      point: p,
    };
    patrolBonus[entranceId] += 12;
  }

  const queue = new Int32Array(area);
  const holeDistance = new Int32Array(area);
  holeDistance.fill(-1);
  let qHead = 0;
  let qTail = 0;
  for (const hole of holes) {
    if (hole && holeDistance[hole.entranceId] < 0) {
      holeDistance[hole.entranceId] = 0;
      queue[qTail++] = hole.entranceId;
    }
  }
  while (qHead < qTail) {
    const current = queue[qHead++];
    const adjacent = neighbors[current];
    for (let k = 0; k < adjacent.length; k++) {
      const next = adjacent[k];
      if (holeDistance[next] >= 0) continue;
      holeDistance[next] = holeDistance[current] + 1;
      queue[qTail++] = next;
    }
  }

  const debugLimit = rules && Number.isInteger(rules.debugMaxChars) && rules.debugMaxChars >= 0
    ? rules.debugMaxChars : 100;

  function action(move, fields, debug) {
    const result = { move: MK_DIRS.includes(move) || move === 'STAY' ? move : 'STAY' };
    if (fields) {
      for (const key of Object.keys(fields)) result[key] = fields[key];
    }
    result.debug = String(debug || '').slice(0, debugLimit);
    return result;
  }

  function bfs(start, distance, previous, firstDirection, maxDistance) {
    distance.fill(-1);
    if (previous) previous.fill(-1);
    if (firstDirection) firstDirection.fill(-1);
    if (start < 0 || !walkable[start]) return;
    let head = 0;
    let tail = 0;
    distance[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      if (maxDistance >= 0 && distance[current] >= maxDistance) continue;
      const adjacent = neighbors[current];
      const dirs = neighborDirs[current];
      for (let k = 0; k < adjacent.length; k++) {
        const next = adjacent[k];
        if (distance[next] >= 0) continue;
        distance[next] = distance[current] + 1;
        if (previous) previous[next] = current;
        if (firstDirection) firstDirection[next] = current === start ? dirs[k] : firstDirection[current];
        queue[tail++] = next;
      }
    }
  }

  const monitor = {
    calls: 0,
    elapsedMs: 0,
    fastMode: false,
    budgetMs: rules && mkNumber(rules.gameTimeMs) && rules.gameTimeMs > 0 ? rules.gameTimeMs : 5000,
  };

  function monitored(core) {
    return function (obs) {
      const startTime = Date.now();
      let result;
      try {
        result = core(obs, monitor.fastMode);
      } catch (error) {
        result = action('STAY', null, 'recuperación tras error de observación');
      }
      const elapsed = Math.max(0, Date.now() - startTime);
      monitor.elapsedMs += elapsed;
      monitor.calls++;
      const turn = obs && Number.isInteger(obs.turn) ? obs.turn : 0;
      const maxTurns = obs && Number.isInteger(obs.maxTurns) ? obs.maxTurns : 400;
      const remainingCalls = Math.max(0, maxTurns - turn);
      if (monitor.calls >= 12 && !monitor.fastMode) {
        const average = monitor.elapsedMs / monitor.calls;
        const projected = monitor.elapsedMs + average * remainingCalls;
        if (projected > monitor.budgetMs * 0.72) monitor.fastMode = true;
      }
      return result;
    };
  }

  if (role === 'cat') {
    const distance = new Int32Array(area);
    const previous = new Int32Array(area);
    const firstDirection = new Int8Array(area);
    const cheeseBonus = new Uint8Array(area);
    const memory = {
      seen: new Int32Array(area),
      visited: new Int32Array(area),
      lastSight: null,
      velocity: null,
      signal: null,
      patrolTarget: -1,
      sprintCost: 1,
      initialStamina: null,
      previousStamina: null,
      previousSprint: false,
    };
    memory.seen.fill(-10000);
    memory.visited.fill(-10000);

    function rememberEvents(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== 'string') continue;
        if (event.type === 'caught' && Number.isInteger(event.respawnHole) && holes[event.respawnHole]) {
          memory.signal = { kind: 'hole', hole: event.respawnHole, turn, waits: 0 };
        } else if (event.type === 'delivered' && Number.isInteger(event.hole) && holes[event.hole]) {
          memory.signal = { kind: 'hole', hole: event.hole, turn, waits: 0 };
        } else if ((event.type === 'pickup' || event.type === 'dropped') &&
                   Number.isInteger(event.x) && Number.isInteger(event.y)) {
          const target = idAt(event.x, event.y);
          if (target >= 0 && walkable[target]) memory.signal = { kind: 'point', id: target, turn, waits: 0 };
        }
      }
    }

    function visibleScentTarget(obs, startId) {
      if (!Array.isArray(obs.scent)) return null;
      let best = null;
      let bestScore = -Infinity;
      for (const smell of obs.scent) {
        if (!Array.isArray(smell) || smell.length < 3 || !Number.isInteger(smell[0]) ||
            !Number.isInteger(smell[1]) || !mkNumber(smell[2])) continue;
        const id = idAt(smell[0], smell[1]);
        if (id < 0 || !walkable[id] || id === startId || distance[id] < 0) continue;
        const strength = Math.max(0, Math.min(1, smell[2]));
        if (strength < 0.06) continue;
        const score = strength * 48 - distance[id] * 3.2;
        if (score > bestScore) {
          bestScore = score;
          best = { id, kind: 'scent', strength };
        }
      }
      return best;
    }

    function choosePatrolTarget(obs, startId, turn) {
      if (memory.patrolTarget >= 0 && memory.patrolTarget < area &&
          walkable[memory.patrolTarget] && distance[memory.patrolTarget] > 0) {
        return memory.patrolTarget;
      }
      memory.patrolTarget = -1;
      cheeseBonus.fill(0);
      if (Array.isArray(obs.cheese)) {
        for (const tile of obs.cheese) {
          const p = mkTile(tile);
          const id = pointId(p);
          if (id >= 0 && cheeseBonus[id] < 8) cheeseBonus[id] = 8;
        }
      }
      let bestId = -1;
      let bestScore = -Infinity;
      for (let id = 0; id < area; id++) {
        if (!walkable[id] || id === startId || distance[id] < 0) continue;
        const seenAge = Math.min(80, Math.max(0, turn - memory.seen[id]));
        const visitAge = Math.min(80, Math.max(0, turn - memory.visited[id]));
        const attraction = patrolBonus[id] + cheeseBonus[id];
        const score = seenAge * 0.8 + visitAge * 0.25 + attraction - distance[id] * 2.4;
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      memory.patrolTarget = bestId;
      return bestId;
    }

    const core = function (obs) {
      if (!obs || !obs.you) return action('STAY', null, 'observación inválida');
      const you = mkPoint(obs.you);
      const startId = pointId(you);
      if (!you || startId < 0 || !walkable[startId]) return action('STAY', null, 'posición inválida');
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      bfs(startId, distance, previous, firstDirection, -1);
      if (memory.initialStamina === null && mkNumber(obs.you.stamina)) memory.initialStamina = obs.you.stamina;
      if (memory.previousSprint && mkNumber(memory.previousStamina) && mkNumber(obs.you.stamina)) {
        const cost = memory.previousStamina - obs.you.stamina;
        if (cost > 0) memory.sprintCost = memory.sprintCost * 0.55 + cost * 0.45;
      }
      memory.previousSprint = false;
      memory.previousStamina = mkNumber(obs.you.stamina) ? obs.you.stamina : null;

      rememberEvents(obs.events, turn);
      memory.visited[startId] = turn;
      if (Array.isArray(obs.visible)) {
        for (const tile of obs.visible) {
          const p = mkTile(tile);
          if (!p) continue;
          const id = idAt(p.x, p.y);
          if (id >= 0) memory.seen[id] = turn;
        }
      }

      const mouse = mkPoint(obs.mouse);
      const mouseId = mouse ? pointId(mouse) : -1;
      let goal = null;
      let reason = '';
      let campHole = null;

      if (mouse && mouseId >= 0 && walkable[mouseId]) {
        if (memory.lastSight && memory.lastSight.turn === turn - 1) {
          const dx = mouse.x - memory.lastSight.x;
          const dy = mouse.y - memory.lastSight.y;
          memory.velocity = Math.abs(dx) + Math.abs(dy) === 1 ? { dx, dy } : null;
        } else {
          memory.velocity = null;
        }
        memory.lastSight = { x: mouse.x, y: mouse.y, turn, carrying: obs.mouse.carrying === true };
        memory.signal = null;
        memory.patrolTarget = -1;
        goal = mouseId;
        reason = obs.mouse.carrying ? 'perseguir ratón con queso' : 'perseguir ratón visible';
      } else {
        if (mouse && mouseId >= 0) {
          for (const hole of holes) {
            if (hole && hole.id === mouseId) {
              goal = hole.entranceId;
              campHole = hole;
              memory.signal = { kind: 'hole', hole: hole.index, turn, waits: 0 };
              memory.patrolTarget = -1;
              reason = 'interceptar ratón en el agujero';
              break;
            }
          }
        }
        const scent = visibleScentTarget(obs, startId);
        if (goal === null && scent) {
          goal = scent.id;
          reason = 'seguir rastro reciente';
          memory.patrolTarget = -1;
        }

        if (goal === null && memory.signal) {
          const age = turn - memory.signal.turn;
          if (memory.signal.kind === 'hole' && age <= 3) {
            const hole = holes[memory.signal.hole];
            if (hole && distance[hole.entranceId] >= 0) {
              goal = hole.entranceId;
              campHole = hole;
              reason = 'interceptar salida de agujero';
            }
          } else if (memory.signal.kind === 'point' && age <= 3 &&
                     memory.signal.id >= 0 && distance[memory.signal.id] >= 0) {
            goal = memory.signal.id;
            reason = 'investigar evento reciente';
          } else if (age > 3) {
            memory.signal = null;
          }
        }

        if (goal === null && memory.lastSight && turn - memory.lastSight.turn <= 3) {
          const age = turn - memory.lastSight.turn;
          let x = memory.lastSight.x;
          let y = memory.lastSight.y;
          if (memory.velocity && age > 0) {
            const px = x + memory.velocity.dx * Math.min(age, 2);
            const py = y + memory.velocity.dy * Math.min(age, 2);
            const predicted = idAt(px, py);
            if (predicted >= 0 && walkable[predicted]) { x = px; y = py; }
          }
          const predictedId = idAt(x, y);
          if (predictedId >= 0 && walkable[predictedId] && distance[predictedId] > 0) {
            goal = predictedId;
            reason = 'buscar última posición';
          }
        }
      }

      if (goal === null) {
        goal = choosePatrolTarget(obs, startId, turn);
        reason = 'patrullar zonas sin revisar';
      }
      if (goal === null || distance[goal] < 0) {
        memory.patrolTarget = -1;
        return action('STAY', { look: MK_DIRS[(Math.max(1, turn) - 1) % 4] }, 'sin ruta; revisar alrededor');
      }

      const steps = distance[goal];
      if (campHole && goal === startId && memory.signal && memory.signal.waits < 2 &&
          turn - memory.signal.turn <= 3) {
        memory.signal.waits++;
        return action('STAY', { look: MK_DIRS[campHole.enterDir] }, reason);
      }
      if (goal === startId) {
        memory.patrolTarget = -1;
        if (memory.signal && memory.signal.kind === 'point') memory.signal = null;
        goal = choosePatrolTarget(obs, startId, turn);
        reason = 'reanudar patrulla';
        if (goal === null || distance[goal] <= 0) {
          return action('STAY', { look: MK_DIRS[(Math.max(1, turn) - 1) % 4] }, 'barrido breve');
        }
      }

      const moveIndex = firstDirection[goal];
      if (moveIndex < 0) return action('STAY', null, 'sin primer paso');
      let sprint = false;
      if (mouse && mouseId >= 0 && distance[mouseId] >= 2 && moveIndex >= 0) {
        let first = mouseId;
        while (previous[first] >= 0 && previous[first] !== startId) first = previous[first];
        if (previous[first] === startId && distance[mouseId] >= 2) {
          let second = mouseId;
          while (previous[second] !== first && previous[second] >= 0) second = previous[second];
          const secondDir = previous[second] === first ? dirBetween(first, second) : -1;
          const straight = secondDir === moveIndex;
          const stamina = mkNumber(obs.you.stamina) ? obs.you.stamina : 0;
          const reserve = distance[mouseId] <= 2 || memory.initialStamina === null
            ? 0 : Math.min(5, Math.ceil(memory.initialStamina * 0.18));
          sprint = straight && stamina >= memory.sprintCost + reserve;
        }
      }
      if (sprint) memory.previousSprint = true;
      return action(MK_DIRS[moveIndex], { look: MK_DIRS[moveIndex], sprint }, reason + (sprint ? '; sprint' : ''));
    };

    return monitored(core);
  }

  if (role === 'mouse') {
    const taxEvery = rules && mkNumber(rules.hidingTaxEvery) && rules.hidingTaxEvery > 0
      ? rules.hidingTaxEvery : 15;
    const searchCost = new Int32Array(area);
    const searchSteps = new Int32Array(area);
    const searchPrevious = new Int32Array(area);
    const searchFirst = new Int8Array(area);
    const threatDistance = new Int32Array(area);
    const cheeseDistance = new Int32Array(area);
    const heapIds = [];
    const heapCosts = [];
    const memory = {
      seen: new Int32Array(area),
      visited: new Int32Array(area),
      lastCat: null,
      previousBell: null,
      hiddenTurns: 0,
      lastHiddenTurn: -1,
      mustStepOff: -1,
      exploreTarget: -1,
      lastExitedHole: -1,
      lastExitTurn: -10000,
      waitingHole: -1,
      holeWaitTurns: 0,
      pendingTunnel: null,
      tunnelTime: new Float64Array(map.holes.length * map.holes.length),
      lastTunnel: null,
      alertUntil: -1,
      alertUnknown: false,
    };
    memory.seen.fill(-10000);
    memory.visited.fill(-10000);

    function heapPush(id, cost) {
      let index = heapIds.length;
      heapIds.push(id);
      heapCosts.push(cost);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heapCosts[parent] <= cost) break;
        heapIds[index] = heapIds[parent];
        heapCosts[index] = heapCosts[parent];
        index = parent;
      }
      heapIds[index] = id;
      heapCosts[index] = cost;
    }

    function heapPop() {
      const id = heapIds[0];
      const cost = heapCosts[0];
      const last = heapIds.pop();
      const lastCost = heapCosts.pop();
      if (heapIds.length > 0) {
        let index = 0;
        const length = heapIds.length;
        while (true) {
          const left = index * 2 + 1;
          if (left >= length) break;
          const right = left + 1;
          const child = right < length && heapCosts[right] < heapCosts[left] ? right : left;
          if (heapCosts[child] >= lastCost) break;
          heapIds[index] = heapIds[child];
          heapCosts[index] = heapCosts[child];
          index = child;
        }
        heapIds[index] = last;
        heapCosts[index] = lastCost;
      }
      return { id, cost };
    }

    function riskPenalty(id, confidence) {
      if (confidence <= 0) return 0;
      const d = threatDistance[id];
      if (d < 0 || d > 5) return 0;
      let penalty = d === 0 ? 900 : d === 1 ? 230 : d === 2 ? 95 : d === 3 ? 38 : d === 4 ? 14 : 5;
      return Math.round(penalty * confidence);
    }

    function mouseSearch(startId, useRisk, confidence) {
      searchCost.fill(MK_INF);
      searchSteps.fill(MK_INF);
      searchPrevious.fill(-1);
      searchFirst.fill(-1);
      if (startId < 0 || !walkable[startId]) return;
      searchCost[startId] = 0;
      searchSteps[startId] = 0;
      if (!useRisk) {
        let head = 0;
        let tail = 0;
        queue[tail++] = startId;
        while (head < tail) {
          const current = queue[head++];
          const adjacent = neighbors[current];
          const dirs = neighborDirs[current];
          for (let k = 0; k < adjacent.length; k++) {
            const next = adjacent[k];
            if (searchSteps[next] < MK_INF) continue;
            searchSteps[next] = searchSteps[current] + 1;
            searchCost[next] = searchSteps[next] * 10;
            searchPrevious[next] = current;
            searchFirst[next] = current === startId ? dirs[k] : searchFirst[current];
            queue[tail++] = next;
          }
        }
        return;
      }
      heapIds.length = 0;
      heapCosts.length = 0;
      heapPush(startId, 0);
      while (heapIds.length > 0) {
        const item = heapPop();
        const current = item.id;
        if (item.cost !== searchCost[current]) continue;
        const adjacent = neighbors[current];
        const dirs = neighborDirs[current];
        for (let k = 0; k < adjacent.length; k++) {
          const next = adjacent[k];
          const cost = item.cost + 10 + riskPenalty(next, confidence);
          const steps = searchSteps[current] + 1;
          if (cost > searchCost[next] || (cost === searchCost[next] && steps >= searchSteps[next])) continue;
          searchCost[next] = cost;
          searchSteps[next] = steps;
          searchPrevious[next] = current;
          searchFirst[next] = current === startId ? dirs[k] : searchFirst[current];
          heapPush(next, cost);
        }
      }
    }

    function updateTunnel(obs, turn) {
      const pending = memory.pendingTunnel;
      if (!pending) return;
      if (obs.you.tunneling) {
        if (mkNumber(obs.you.tunneling.turnsLeft)) pending.lastTurnsLeft = obs.you.tunneling.turnsLeft;
      } else if (obs.you.inHole === pending.to) {
        const duration = Math.max(1, turn - pending.startTurn);
        const slot = pending.from * map.holes.length + pending.to;
        const old = memory.tunnelTime[slot];
        memory.tunnelTime[slot] = old > 0 ? old * 0.65 + duration * 0.35 : duration;
        memory.pendingTunnel = null;
      } else if (turn - pending.startTurn > 30) {
        memory.pendingTunnel = null;
      }
    }

    function processEvents(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== 'string') continue;
        if (event.type === 'caught') {
          memory.pendingTunnel = null;
          memory.mustStepOff = -1;
          if (Number.isInteger(event.x) && Number.isInteger(event.y)) {
            const id = idAt(event.x, event.y);
            if (id >= 0) memory.lastCat = { id, turn: turn - 1 };
          }
        } else if (event.type === 'dropped' && Number.isInteger(event.x) && Number.isInteger(event.y)) {
          memory.mustStepOff = idAt(event.x, event.y);
        } else if (event.type === 'pickup' || event.type === 'delivered') {
          memory.mustStepOff = -1;
        }
      }
    }

    function estimateTunnel(from, to) {
      const slot = from * map.holes.length + to;
      if (memory.tunnelTime[slot] > 0) return memory.tunnelTime[slot];
      const a = holes[from];
      const b = holes[to];
      if (!a || !b) return 5;
      const distance = Math.abs(a.point.x - b.point.x) + Math.abs(a.point.y - b.point.y);
      return Math.max(2, 2 + Math.floor(distance / 6));
    }

    function cheeseDistances(cheeses) {
      cheeseDistance.fill(-1);
      let head = 0;
      let tail = 0;
      if (Array.isArray(cheeses)) {
        for (const tile of cheeses) {
          const p = mkTile(tile);
          const id = pointId(p);
          if (id < 0 || !walkable[id] || cheeseDistance[id] >= 0) continue;
          cheeseDistance[id] = 0;
          queue[tail++] = id;
        }
      }
      while (head < tail) {
        const current = queue[head++];
        const adjacent = neighbors[current];
        for (let k = 0; k < adjacent.length; k++) {
          const next = adjacent[k];
          if (cheeseDistance[next] >= 0) continue;
          cheeseDistance[next] = cheeseDistance[current] + 1;
          queue[tail++] = next;
        }
      }
    }

    function chooseHole(excludeHole) {
      let best = null;
      for (const hole of holes) {
        if (!hole || hole.index === excludeHole || searchSteps[hole.entranceId] >= MK_INF) continue;
        const steps = searchSteps[hole.entranceId] + 1;
        const cost = searchCost[hole.entranceId] + 10;
        if (!best || cost < best.cost || (cost === best.cost && steps < best.steps)) {
          best = {
            hole,
            cost,
            steps,
            dir: searchSteps[hole.entranceId] === 0 ? hole.enterDir : searchFirst[hole.entranceId],
          };
        }
      }
      return best;
    }

    function chooseCheese(cheeses) {
      if (!Array.isArray(cheeses)) return null;
      let best = null;
      let bestScore = MK_INF;
      for (const tile of cheeses) {
        const p = mkTile(tile);
        const id = pointId(p);
        if (id < 0 || !walkable[id] || searchSteps[id] >= MK_INF || holeDistance[id] < 0) continue;
        const returnCost = (holeDistance[id] + 1) * 7;
        const score = searchCost[id] + returnCost;
        if (score < bestScore) {
          bestScore = score;
          best = { id, dir: searchFirst[id], steps: searchSteps[id], score };
        }
      }
      return best;
    }

    function chooseExplore(startId, turn) {
      if (memory.exploreTarget >= 0 && memory.exploreTarget < area &&
          walkable[memory.exploreTarget] && searchSteps[memory.exploreTarget] > 0 &&
          searchSteps[memory.exploreTarget] < MK_INF) return memory.exploreTarget;
      memory.exploreTarget = -1;
      let bestId = -1;
      let bestScore = -Infinity;
      for (let id = 0; id < area; id++) {
        if (!walkable[id] || id === startId || searchSteps[id] >= MK_INF) continue;
        const age = Math.min(60, Math.max(0, turn - memory.seen[id]));
        const visitAge = Math.min(45, Math.max(0, turn - memory.visited[id]));
        const score = age + visitAge * 0.25 - searchSteps[id] * 1.8;
        if (score > bestScore) { bestScore = score; bestId = id; }
      }
      memory.exploreTarget = bestId;
      return bestId;
    }

    function safestStep(startId) {
      const adjacent = neighbors[startId];
      const dirs = neighborDirs[startId];
      let bestDir = -1;
      let bestScore = -Infinity;
      for (let k = 0; k < adjacent.length; k++) {
        const id = adjacent[k];
        const d = threatDistance[id];
        const safety = d < 0 ? 20 : d * 10;
        const score = safety - (holeDistance[id] < 0 ? 5 : holeDistance[id] * 0.2);
        if (score > bestScore) { bestScore = score; bestDir = dirs[k]; }
      }
      return bestDir >= 0 ? MK_DIRS[bestDir] : 'STAY';
    }

    function chooseTunnel(currentIndex, obs, confidence, urgent, bellUrgent, turn, fastMode) {
      const current = holes[currentIndex];
      if (!current) return null;
      const currentExitThreat = threatDistance[current.entranceId];
      const threatenedExit = confidence >= 0.25 && currentExitThreat >= 0 && currentExitThreat <= 3;
      const canEstimateShortcut = !fastMode && obs.you.carrying !== true &&
        Array.isArray(obs.cheese) && obs.cheese.length > 0;
      if (canEstimateShortcut) cheeseDistances(obs.cheese);
      const currentCheeseDistance = canEstimateShortcut ? cheeseDistance[current.entranceId] : -1;
      const currentWalkCost = currentCheeseDistance >= 0 ? currentCheeseDistance + 1 : MK_INF;
      const remainingHidden = taxEvery - (memory.hiddenTurns % taxEvery);
      let best = null;

      for (const destination of holes) {
        if (!destination || destination.index === currentIndex) continue;
        const tunnelTurns = estimateTunnel(currentIndex, destination.index);
        const reverse = memory.lastTunnel && memory.lastTunnel.from === destination.index &&
          memory.lastTunnel.to === currentIndex && turn - memory.lastTunnel.turn < 8;
        const destinationThreat = threatDistance[destination.entranceId];
        const safeAgainstKnownCat = destinationThreat < 0 || destinationThreat >= 4 ||
          (currentExitThreat >= 0 && destinationThreat >= currentExitThreat + 2);
        const spatialDistance = Math.abs(current.entrance.x - destination.entrance.x) +
          Math.abs(current.entrance.y - destination.entrance.y);
        const knownEscape = threatenedExit && safeAgainstKnownCat;
        const blindEscape = bellUrgent && spatialDistance >= 5 &&
          (!memory.lastCat || turn - memory.lastCat.turn > 5 || safeAgainstKnownCat);
        const escape = knownEscape || blindEscape;
        let shortcut = false;
        let destinationWalkCost = MK_INF;
        if (canEstimateShortcut) {
          const destinationCheeseDistance = cheeseDistance[destination.entranceId];
          if (destinationCheeseDistance >= 0) {
            destinationWalkCost = tunnelTurns + 1 + destinationCheeseDistance;
            shortcut = currentWalkCost >= MK_INF || destinationWalkCost + 3 < currentWalkCost;
          }
        }
        if (!escape && (!shortcut || urgent)) continue;
        if (reverse && !escape) continue;
        if (!escape && remainingHidden <= tunnelTurns + 1) continue;
        let score;
        if (escape) {
          const danger = destinationThreat < 0 ? 0 : Math.max(0, 5 - destinationThreat) * 20;
          score = tunnelTurns * 10 + danger - Math.min(spatialDistance, 12);
        } else {
          score = destinationWalkCost * 10;
        }
        if (!best || score < best.score) {
          best = { hole: destination.index, escape, tunnelTurns, score };
        }
      }
      if (best && (best.escape || (!urgent && !bellUrgent))) return best;
      return null;
    }

    const core = function (obs, fastMode) {
      if (!obs || !obs.you) return action('STAY', null, 'observación inválida');
      const you = mkPoint(obs.you);
      const startId = pointId(you);
      if (!you || startId < 0) return action('STAY', null, 'posición inválida');
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      processEvents(obs.events, turn);
      updateTunnel(obs, turn);
      const hidden = obs.you.inHole !== null || !!obs.you.tunneling;
      if (hidden && memory.lastHiddenTurn !== turn) {
        memory.hiddenTurns++;
        memory.lastHiddenTurn = turn;
      }
      if (Array.isArray(obs.visible)) {
        for (const tile of obs.visible) {
          const p = mkTile(tile);
          if (!p) continue;
          const id = idAt(p.x, p.y);
          if (id >= 0) memory.seen[id] = turn;
        }
      }
      if (walkable[startId]) memory.visited[startId] = turn;
      if (memory.mustStepOff >= 0 && (startId !== memory.mustStepOff || obs.you.carrying === true)) {
        memory.mustStepOff = -1;
      }

      const cat = mkPoint(obs.cat);
      if (cat) {
        const catId = pointId(cat);
        if (catId >= 0 && walkable[catId]) memory.lastCat = { id: catId, turn };
      }
      const previousBell = memory.previousBell;
      const bellApproaching = mkNumber(obs.bell) && mkNumber(previousBell) && previousBell - obs.bell >= 0.8;
      const bellUrgent = obs.bellLoud === true || bellApproaching || (mkNumber(obs.bell) && obs.bell <= 3.5);
      memory.previousBell = mkNumber(obs.bell) ? obs.bell : null;

      if (obs.you.tunneling) {
        const left = mkNumber(obs.you.tunneling.turnsLeft) ? obs.you.tunneling.turnsLeft : '?';
        return action('STAY', null, 'túnel en curso; faltan ' + left);
      }

      const inHole = Number.isInteger(obs.you.inHole) && obs.you.inHole >= 0;
      if (!inHole && !walkable[startId]) return action('STAY', null, 'posición fuera del piso');

      let confidence = 0;
      if (cat) confidence = 1;
      else if (memory.lastCat && turn - memory.lastCat.turn <= 5) {
        confidence = Math.max(0.12, 0.7 / Math.max(1, turn - memory.lastCat.turn));
      }
      threatDistance.fill(-1);
      if (cat) {
        const catId = pointId(cat);
        if (catId >= 0 && walkable[catId]) bfs(catId, threatDistance, null, null, 8);
      } else if (memory.lastCat && turn - memory.lastCat.turn <= 5) {
        bfs(memory.lastCat.id, threatDistance, null, null, 8);
      }
      const catDistanceAtMouse = threatDistance[startId];
      const immediateThreat = !!cat && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 3;
      const heardDanger = bellUrgent && (!mkNumber(obs.bell) || obs.bell <= 6);
      if (immediateThreat || heardDanger) {
        memory.alertUntil = turn + 1;
        const knownCat = !!cat || (memory.lastCat && turn - memory.lastCat.turn <= 2);
        memory.alertUnknown = !knownCat;
      }
      const carriedAlert = inHole && turn <= memory.alertUntil;
      const urgent = immediateThreat || heardDanger || carriedAlert;
      const tunnelBellUrgent = bellUrgent ||
        (inHole && memory.alertUnknown && turn <= memory.alertUntil);

      if (inHole) {
        const current = holes[obs.you.inHole];
        if (!current) return action('STAY', null, 'índice de agujero inválido');
        const tunnel = chooseTunnel(obs.you.inHole, obs, confidence, urgent, tunnelBellUrgent, turn, fastMode);
        if (tunnel) {
          memory.waitingHole = -1;
          memory.holeWaitTurns = 0;
          memory.pendingTunnel = { from: obs.you.inHole, to: tunnel.hole, startTurn: turn };
          memory.lastTunnel = { from: obs.you.inHole, to: tunnel.hole, turn };
          return action('STAY', { tunnel: tunnel.hole }, tunnel.escape ? 'túnel para escapar' : 'túnel hacia el queso');
        }
        const exitThreat = threatDistance[current.entranceId];
        const exitBlocked = confidence >= 0.25 && exitThreat >= 0 && exitThreat <= 1;
        const nearTax = taxEvery - (memory.hiddenTurns % taxEvery) <= 1;
        if (exitBlocked && !nearTax && memory.holeWaitTurns < 2) {
          if (memory.waitingHole !== obs.you.inHole) {
            memory.waitingHole = obs.you.inHole;
            memory.holeWaitTurns = 0;
          }
          memory.holeWaitTurns++;
          return action('STAY', null, 'esperar que el gato deje la salida');
        }
        memory.waitingHole = -1;
        memory.holeWaitTurns = 0;
        memory.lastExitedHole = obs.you.inHole;
        memory.lastExitTurn = turn;
        if (obs.you.heavy === true) return action('STAY', null, 'esperar turno pesado dentro del agujero');
        return action(MK_DIRS[current.exitDir], null, 'salir del agujero y avanzar');
      }

      if (obs.you.heavy === true) {
        if (obs.you.carrying === true && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 1) {
          return action('STAY', { drop: true }, 'soltar queso ante captura inminente');
        }
        return action('STAY', null, 'turno pesado; conservar el queso');
      }

      const useRisk = !fastMode && confidence > 0;
      mouseSearch(startId, useRisk, confidence);
      const leftRecentHole = memory.lastExitedHole >= 0 && turn - memory.lastExitTurn < 4;
      const blockedHole = leftRecentHole && obs.you.carrying !== true ? memory.lastExitedHole : -1;
      let holeRoute = obs.you.carrying === true || urgent ? chooseHole(-1) : null;
      if (urgent && blockedHole >= 0 && holeRoute && holeRoute.hole.index === blockedHole) {
        holeRoute = chooseHole(blockedHole);
      }
      let cheeseRoute = null;
      if (obs.you.carrying !== true && !urgent) cheeseRoute = chooseCheese(obs.cheese);
      let targetId = -1;
      let targetDir = -1;
      let reason = '';

      if (obs.you.carrying === true) {
        const delivery = chooseHole(-1);
        if (delivery) {
          targetId = delivery.hole.entranceId;
          targetDir = delivery.dir;
          if (searchSteps[targetId] === 0) targetDir = delivery.hole.enterDir;
          reason = 'entregar queso por agujero ' + delivery.hole.index;
        }
      } else if (urgent && holeRoute) {
        targetId = holeRoute.hole.entranceId;
        targetDir = holeRoute.dir;
        reason = 'buscar refugio por peligro cercano';
      } else if (cheeseRoute) {
        if (cheeseRoute.id === startId) {
          const adjacent = neighbors[startId];
          const dirs = neighborDirs[startId];
          let bestDir = -1;
          let bestScore = -Infinity;
          for (let k = 0; k < adjacent.length; k++) {
            const nearCat = threatDistance[adjacent[k]];
            let score = nearCat < 0 ? 20 : nearCat * 10;
            if (searchCost[adjacent[k]] < MK_INF) score -= Math.min(10, searchCost[adjacent[k]] / 100);
            if (score > bestScore) { bestScore = score; bestDir = dirs[k]; }
          }
          if (bestDir >= 0) {
            memory.mustStepOff = startId;
            return action(MK_DIRS[bestDir], null, 'salir de la casilla para recoger el queso');
          }
        }
        targetId = cheeseRoute.id;
        targetDir = cheeseRoute.dir;
        reason = 'buscar queso y dejar ruta de entrega';
      } else if (memory.mustStepOff === startId) {
        const adjacent = neighbors[startId];
        const dirs = neighborDirs[startId];
        let bestDir = -1;
        let bestScore = -Infinity;
        for (let k = 0; k < adjacent.length; k++) {
          const d = threatDistance[adjacent[k]];
          const score = d < 0 ? 20 : d * 10;
          if (score > bestScore) { bestScore = score; bestDir = dirs[k]; }
        }
        if (bestDir >= 0) return action(MK_DIRS[bestDir], null, 'separarse del queso soltado');
      }

      if (targetId < 0) {
        if (urgent) return action(safestStep(startId), null, 'escapar del gato');
        const explore = chooseExplore(startId, turn);
        if (explore >= 0) {
          targetId = explore;
          targetDir = searchFirst[explore];
          reason = 'explorar hasta que aparezca queso';
        }
      }
      if (targetId < 0 || targetDir < 0) {
        if (cat && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 3) {
          return action(safestStep(startId), null, 'escapar por la casilla más segura');
        }
        return action('STAY', null, 'sin objetivo accesible');
      }
      memory.exploreTarget = reason.indexOf('explorar') === 0 ? targetId : -1;
      if (obs.you.carrying !== true && memory.mustStepOff === startId && targetId !== startId) {
        memory.mustStepOff = -1;
      }
      return action(MK_DIRS[targetDir], null, reason);
    };

    return monitored(core);
  }

  return monitored(function () { return action('STAY', null, 'rol inválido'); });
}
