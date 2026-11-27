// Midnight Kitchen Bot V3.1.
// Changelog: recupera queso soltado, trata las salidas de agujero como riesgos y limita el trabajo acumulado.
// Persigue y patrulla como gato; recoge, entrega y escapa como ratón.
// Sin imports ni estado fuera de la partida.

const MK_DIRS = ['N', 'E', 'S', 'W'];
const MK_DX = [0, 1, 0, -1];
const MK_DY = [-1, 0, 1, 0];
const MK_INF = 0x3fffffff;

function mkNow() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

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

  function bfs(start, distance, previous, firstDirection, maxDistance, nodeLimit, stopAt) {
    distance.fill(-1);
    if (previous) previous.fill(-1);
    if (firstDirection) firstDirection.fill(-1);
    if (start < 0 || !walkable[start]) return;
    let head = 0;
    let tail = 0;
    let expanded = 0;
    distance[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      if (nodeLimit > 0 && expanded >= nodeLimit) break;
      const current = queue[head++];
      expanded++;
      monitor.work += 1;
      if (current === stopAt) break;
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
    return { reached: tail, expanded, complete: head >= tail };
  }

  const monitor = {
    calls: 0,
    elapsedMs: 0,
    work: 0,
    totalWork: 0,
    fastMode: area > 4000,
    budgetMs: rules && mkNumber(rules.gameTimeMs) && rules.gameTimeMs > 0 ? rules.gameTimeMs : 5000,
    workLimit: Math.max(1800, Math.min(10000, Math.floor(area * 1.1))),
  };

  function monitored(core) {
    return function (obs) {
      const startTime = mkNow();
      monitor.work = 0;
      let result;
      try {
        result = core(obs, monitor.fastMode);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        result = action('STAY', null, 'error interno: ' + message);
      }
      const elapsed = Math.max(0, mkNow() - startTime);
      monitor.elapsedMs += elapsed;
      monitor.totalWork += monitor.work;
      monitor.calls++;
      const turn = obs && Number.isInteger(obs.turn) ? obs.turn : 0;
      const maxTurns = obs && Number.isInteger(obs.maxTurns) ? obs.maxTurns : 400;
      const remainingCalls = Math.max(0, maxTurns - turn);
      if (!monitor.fastMode && monitor.work > monitor.workLimit) monitor.fastMode = true;
      if (monitor.calls >= 8 && !monitor.fastMode) {
        const average = monitor.elapsedMs / monitor.calls;
        const projected = monitor.elapsedMs + average * remainingCalls;
        const averageWork = monitor.totalWork / monitor.calls;
        const projectedWork = monitor.totalWork + averageWork * remainingCalls;
        const maxProjectedWork = monitor.workLimit * Math.max(1, maxTurns) * 0.7;
        if (projected > monitor.budgetMs * 0.55 || projectedWork > maxProjectedWork) monitor.fastMode = true;
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
      velocityStreak: 0,
      signal: null,
      patrolTarget: -1,
      patrolSectors: new Int32Array(Math.ceil(width / 4) * Math.ceil(height / 4)),
      routeOrigin: -1,
      routeFastMode: false,
      routeReached: 0,
      routeCached: false,
      sprintCost: 1,
      initialStamina: null,
      previousStamina: null,
      previousSprint: false,
    };
    memory.seen.fill(-10000);
    memory.visited.fill(-10000);
    memory.patrolSectors.fill(-10000);

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

    function frontierTarget(targetId, reachedCount) {
      let bestId = -1;
      let bestScore = Infinity;
      const targetX = targetId % width;
      const targetY = Math.floor(targetId / width);
      for (let i = 0; i < reachedCount; i++) {
        monitor.work++;
        const id = queue[i];
        if (id === targetId || distance[id] <= 0) continue;
        const dx = Math.abs(id % width - targetX);
        const dy = Math.abs(Math.floor(id / width) - targetY);
        const score = (dx + dy) * 3 + distance[id] * 0.35;
        if (score < bestScore) { bestScore = score; bestId = id; }
      }
      return bestId;
    }

    function visibleScentTarget(obs, startId, reachedCount) {
      if (!Array.isArray(obs.scent)) return null;
      let best = null;
      let bestScore = -Infinity;
      for (const smell of obs.scent) {
        monitor.work++;
        if (!Array.isArray(smell) || smell.length < 3 || !Number.isInteger(smell[0]) ||
            !Number.isInteger(smell[1]) || !mkNumber(smell[2])) continue;
        const id = idAt(smell[0], smell[1]);
        if (id < 0 || !walkable[id] || id === startId) continue;
        const strength = Math.max(0, Math.min(1, smell[2]));
        if (strength < 0.06) continue;
        if (distance[id] < 0 && !monitor.fastMode) continue;
        const routeSteps = distance[id] >= 0 ? distance[id] :
          Math.abs(startId % width - smell[0]) + Math.abs(Math.floor(startId / width) - smell[1]);
        const score = strength * 48 - routeSteps * 3.2;
        if (score > bestScore) {
          bestScore = score;
          best = { id, kind: 'scent', strength };
        }
      }
      if (best && distance[best.id] < 0) {
        const frontier = frontierTarget(best.id, reachedCount);
        if (frontier < 0) return null;
        best.id = frontier;
      }
      return best;
    }

    function choosePatrolTarget(obs, startId, turn, reachedCount) {
      if (memory.patrolTarget >= 0 && memory.patrolTarget < area &&
          walkable[memory.patrolTarget] && distance[memory.patrolTarget] > 0) {
        return memory.patrolTarget;
      }
      memory.patrolTarget = -1;
      cheeseBonus.fill(0);
      if (Array.isArray(obs.cheese)) {
        for (const tile of obs.cheese) {
          monitor.work++;
          const p = mkTile(tile);
          const id = pointId(p);
          if (id >= 0 && cheeseBonus[id] < 8) cheeseBonus[id] = 8;
        }
      }
      let bestId = -1;
      let bestScore = -Infinity;
      const sectorWidth = Math.ceil(width / 4);
      for (let i = 0; i < reachedCount; i++) {
        monitor.work++;
        const id = queue[i];
        if (!walkable[id] || id === startId) continue;
        const seenAge = Math.min(80, Math.max(0, turn - memory.seen[id]));
        const visitAge = Math.min(80, Math.max(0, turn - memory.visited[id]));
        const attraction = patrolBonus[id] + cheeseBonus[id];
        const sector = Math.floor(id / width / 4) * sectorWidth + Math.floor((id % width) / 4);
        const sectorAge = Math.min(30, Math.max(0, turn - memory.patrolSectors[sector]));
        const repeatPenalty = sectorAge < 20 ? (20 - sectorAge) * 2 : 0;
        const score = seenAge * 0.8 + visitAge * 0.25 + attraction - repeatPenalty - distance[id] * 2.4;
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      memory.patrolTarget = bestId;
      return bestId;
    }

    const core = function (obs, fastMode) {
      if (!obs || !obs.you) return action('STAY', null, 'observación inválida');
      const you = mkPoint(obs.you);
      const startId = pointId(you);
      if (!you || startId < 0 || !walkable[startId]) return action('STAY', null, 'posición inválida');
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const mouse = mkPoint(obs.mouse);
      const mouseId = mouse ? pointId(mouse) : -1;
      const directId = mouseId >= 0 && walkable[mouseId] ? mouseId : -1;
      let reachedCount = memory.routeReached;
      const nodeLimit = fastMode ? Math.min(area, 1400) : area;
      const canReuseRoute = memory.routeCached && memory.routeOrigin === startId &&
        memory.routeFastMode === fastMode;
      if (!canReuseRoute) {
        const result = bfs(startId, distance, previous, firstDirection, -1, nodeLimit, directId);
        reachedCount = result.reached;
        memory.routeOrigin = startId;
        memory.routeFastMode = fastMode;
        memory.routeReached = reachedCount;
        memory.routeCached = directId < 0;
      }
      if (memory.initialStamina === null && mkNumber(obs.you.stamina)) memory.initialStamina = obs.you.stamina;
      if (memory.previousSprint && mkNumber(memory.previousStamina) && mkNumber(obs.you.stamina)) {
        const cost = memory.previousStamina - obs.you.stamina;
        if (cost > 0) memory.sprintCost = memory.sprintCost * 0.55 + cost * 0.45;
      }
      memory.previousSprint = false;
      memory.previousStamina = mkNumber(obs.you.stamina) ? obs.you.stamina : null;

      rememberEvents(obs.events, turn);
      memory.visited[startId] = turn;
      if (memory.patrolTarget === startId) {
        const sector = Math.floor(startId / width / 4) * Math.ceil(width / 4) + Math.floor((startId % width) / 4);
        memory.patrolSectors[sector] = turn;
        memory.patrolTarget = -1;
      }
      if (Array.isArray(obs.visible)) {
        for (const tile of obs.visible) {
          const p = mkTile(tile);
          if (!p) continue;
          const id = idAt(p.x, p.y);
          if (id >= 0) memory.seen[id] = turn;
        }
      }

      let goal = null;
      let reason = '';
      let campHole = null;

      if (mouse && mouseId >= 0 && walkable[mouseId]) {
        if (memory.lastSight && memory.lastSight.turn === turn - 1) {
          const dx = mouse.x - memory.lastSight.x;
          const dy = mouse.y - memory.lastSight.y;
          if (Math.abs(dx) + Math.abs(dy) === 1) {
            if (memory.velocity && memory.velocity.dx === dx && memory.velocity.dy === dy) {
              memory.velocityStreak++;
            } else {
              memory.velocity = { dx, dy };
              memory.velocityStreak = 1;
            }
          } else {
            memory.velocity = null;
            memory.velocityStreak = 0;
          }
        } else {
          memory.velocity = null;
          memory.velocityStreak = 0;
        }
        memory.lastSight = { x: mouse.x, y: mouse.y, turn, carrying: obs.mouse.carrying === true };
        memory.signal = null;
        memory.patrolTarget = -1;
        goal = mouseId;
        reason = obs.mouse.carrying ? 'perseguir ratón con queso' : 'perseguir ratón visible';
        if (obs.mouse.carrying === true) {
          for (const hole of holes) {
            if (!hole || distance[hole.entranceId] < 0) continue;
            const mouseToExit = Math.abs(mouse.x - hole.entrance.x) + Math.abs(mouse.y - hole.entrance.y);
            if (mouseToExit > 2 || distance[hole.entranceId] > mouseToExit) continue;
            goal = hole.entranceId;
            campHole = hole;
            memory.signal = { kind: 'hole', hole: hole.index, turn, waits: 0 };
            reason = 'interceptar salida antes de la entrega';
            break;
          }
        }
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
        const scent = visibleScentTarget(obs, startId, reachedCount);
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
          if (memory.velocity && memory.velocityStreak >= 2 && age > 0 && age <= 2) {
            const px = x + memory.velocity.dx;
            const py = y + memory.velocity.dy;
            const predicted = idAt(px, py);
            const lastId = idAt(x, y);
            if (predicted >= 0 && walkable[predicted] && distance[predicted] >= 0 &&
                (distance[lastId] < 0 || distance[predicted] <= distance[lastId] + 2)) {
              x = px;
              y = py;
            }
          }
          const predictedId = idAt(x, y);
          if (predictedId >= 0 && walkable[predictedId] && distance[predictedId] > 0) {
            goal = predictedId;
            reason = 'buscar última posición';
          }
        }
      }

      if (goal === null) {
        goal = choosePatrolTarget(obs, startId, turn, reachedCount);
        reason = 'patrullar zonas sin revisar';
      }
      if (goal !== null && distance[goal] < 0 && fastMode) {
        const frontier = frontierTarget(goal, reachedCount);
        if (frontier >= 0) goal = frontier;
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
        const oldTarget = memory.patrolTarget;
        if (oldTarget === startId) {
          const sector = Math.floor(startId / width / 4) * Math.ceil(width / 4) + Math.floor((startId % width) / 4);
          memory.patrolSectors[sector] = turn;
        }
        memory.patrolTarget = -1;
        if (memory.signal && memory.signal.kind === 'point') memory.signal = null;
        goal = choosePatrolTarget(obs, startId, turn, reachedCount);
        reason = 'reanudar patrulla';
        if (goal === null || distance[goal] <= 0) {
          return action('STAY', { look: MK_DIRS[(Math.max(1, turn) - 1) % 4] }, 'barrido breve');
        }
      }

      const moveIndex = firstDirection[goal];
      if (moveIndex < 0) return action('STAY', null, 'sin primer paso');
      let sprint = false;
      if (mouse && mouseId >= 0 && goal === mouseId && distance[mouseId] >= 2 && moveIndex >= 0) {
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
    const searchTouched = new Int32Array(area);
    const heapIds = [];
    const heapCosts = [];
    const memory = {
      seen: new Int32Array(area),
      visited: new Int32Array(area),
      lastCat: null,
      previousBell: null,
      hiddenTurns: 0,
      lastHiddenTurn: -1,
      recoveryCheese: null,
      ignoredCheeseId: -1,
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
      unknownEscapeUsed: false,
      threatOrigin: -2,
      threatFastMode: false,
      searchOrigin: -1,
      searchThreatOrigin: -2,
      searchRisk: false,
      searchConfidence: -1,
      searchFastMode: false,
      searchReached: 0,
      cheeseDistanceSignature: -1,
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

    function mouseSearch(startId, useRisk, confidence, fastMode, threatOrigin) {
      const reusable = memory.searchOrigin === startId && memory.searchRisk === useRisk &&
        memory.searchFastMode === fastMode && (!useRisk ||
          (memory.searchThreatOrigin === threatOrigin && memory.searchConfidence === confidence));
      if (reusable) return memory.searchReached;
      searchCost.fill(MK_INF);
      searchSteps.fill(MK_INF);
      searchPrevious.fill(-1);
      searchFirst.fill(-1);
      if (startId < 0 || !walkable[startId]) return;
      searchCost[startId] = 0;
      searchSteps[startId] = 0;
      let reached = 1;
      searchTouched[0] = startId;
      const nodeLimit = fastMode ? Math.min(area, 1400) : area;
      if (!useRisk) {
        let head = 0;
        let tail = 0;
        let expanded = 0;
        queue[tail++] = startId;
        while (head < tail && expanded < nodeLimit) {
          const current = queue[head++];
          expanded++;
          monitor.work++;
          const adjacent = neighbors[current];
          const dirs = neighborDirs[current];
          for (let k = 0; k < adjacent.length; k++) {
            const next = adjacent[k];
            if (searchSteps[next] < MK_INF) continue;
            searchTouched[reached++] = next;
            searchSteps[next] = searchSteps[current] + 1;
            searchCost[next] = searchSteps[next] * 10;
            searchPrevious[next] = current;
            searchFirst[next] = current === startId ? dirs[k] : searchFirst[current];
            queue[tail++] = next;
          }
        }
      } else {
        heapIds.length = 0;
        heapCosts.length = 0;
        heapPush(startId, 0);
        let expanded = 0;
        while (heapIds.length > 0 && expanded < nodeLimit) {
          const item = heapPop();
          const current = item.id;
          if (item.cost !== searchCost[current]) continue;
          expanded++;
          monitor.work++;
          const adjacent = neighbors[current];
          const dirs = neighborDirs[current];
          for (let k = 0; k < adjacent.length; k++) {
            const next = adjacent[k];
            const cost = item.cost + 10 + riskPenalty(next, confidence);
            const steps = searchSteps[current] + 1;
            if (cost > searchCost[next] || (cost === searchCost[next] && steps >= searchSteps[next])) continue;
            if (searchSteps[next] >= MK_INF) searchTouched[reached++] = next;
            searchCost[next] = cost;
            searchSteps[next] = steps;
            searchPrevious[next] = current;
            searchFirst[next] = current === startId ? dirs[k] : searchFirst[current];
            heapPush(next, cost);
          }
        }
      }
      memory.searchOrigin = startId;
      memory.searchRisk = useRisk;
      memory.searchFastMode = fastMode;
      memory.searchThreatOrigin = threatOrigin;
      memory.searchConfidence = confidence;
      memory.searchReached = reached;
      return reached;
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
          if (memory.recoveryCheese) memory.recoveryCheese.phase = 'return';
          if (Number.isInteger(event.x) && Number.isInteger(event.y)) {
            const id = idAt(event.x, event.y);
            if (id >= 0) memory.lastCat = { id, turn: turn - 1 };
          }
        } else if (event.type === 'dropped' && Number.isInteger(event.x) && Number.isInteger(event.y)) {
          const id = idAt(event.x, event.y);
          if (id >= 0) memory.recoveryCheese = { id, phase: 'stepOff', createdTurn: turn };
        } else if (event.type === 'pickup' || event.type === 'delivered') {
          memory.recoveryCheese = null;
          memory.ignoredCheeseId = -1;
        }
      }
    }

    function hasCheeseAt(cheeses, id) {
      if (!Array.isArray(cheeses)) return false;
      for (const tile of cheeses) {
        const p = mkTile(tile);
        if (p && pointId(p) === id) return true;
      }
      return false;
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

    function rememberedPositionRisk(id, turn) {
      if (!memory.lastCat) return 0.5;
      const age = Math.max(0, turn - memory.lastCat.turn);
      if (age > 8) return 0.5;
      const distance = threatDistance[id] < 0 ? 9 : threatDistance[id];
      const reach = 2 * age + 1;
      if (distance <= 1) return age <= 1 ? 0.95 : 0.78;
      if (distance <= reach) return age <= 2 ? 0.82 : 0.68;
      if (distance <= reach + 3) return age <= 2 ? 0.58 : 0.45;
      return 0.22;
    }

    function exitRisk(hole, obs, turn, bellApproaching, bellEasing) {
      const positionRisk = rememberedPositionRisk(hole.entranceId, turn);
      let risk = positionRisk;
      if (mkNumber(obs.bell)) {
        const bellRisk = obs.bell <= 1.5 ? 0.98 : obs.bell <= 3 ? 0.88 :
          obs.bell <= 5 ? 0.68 : obs.bell <= 7 ? 0.46 : 0.2;
        risk = 0.6 * positionRisk + 0.4 * bellRisk;
      } else if (obs.bellLoud === true) {
        risk = Math.max(risk, 0.78);
      }
      if (bellApproaching) risk = Math.max(risk, 0.82);
      if (bellEasing && (!mkNumber(obs.bell) || obs.bell >= 5)) risk = Math.max(0.15, risk - 0.28);
      return Math.max(0, Math.min(1, risk));
    }

    function cheeseDistances(cheeses) {
      let signature = Array.isArray(cheeses) ? cheeses.length * 65537 : 0;
      if (Array.isArray(cheeses)) {
        for (const tile of cheeses) {
          monitor.work++;
          const p = mkTile(tile);
          const id = pointId(p);
          if (id >= 0) signature = (signature + (id + 1) * 2654435761) >>> 0;
        }
      }
      if (memory.cheeseDistanceSignature === signature) return;
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
        monitor.work++;
        const current = queue[head++];
        const adjacent = neighbors[current];
        for (let k = 0; k < adjacent.length; k++) {
          const next = adjacent[k];
          if (cheeseDistance[next] >= 0) continue;
          cheeseDistance[next] = cheeseDistance[current] + 1;
          queue[tail++] = next;
        }
      }
      memory.cheeseDistanceSignature = signature;
    }

    function searchFrontier(targetId) {
      let bestId = -1;
      let bestScore = Infinity;
      const tx = targetId % width;
      const ty = Math.floor(targetId / width);
      for (let i = 0; i < memory.searchReached; i++) {
        monitor.work++;
        const id = searchTouched[i];
        if (id === targetId || searchSteps[id] <= 0) continue;
        const remaining = Math.abs(id % width - tx) + Math.abs(Math.floor(id / width) - ty);
        const score = searchCost[id] + remaining * 10;
        if (score < bestScore) { bestScore = score; bestId = id; }
      }
      return bestId;
    }

    function chooseHole(excludeHole) {
      let best = null;
      for (const hole of holes) {
        monitor.work++;
        if (!hole || hole.index === excludeHole) continue;
        let routeId = hole.entranceId;
        let remaining = 0;
        if (searchSteps[routeId] >= MK_INF) {
          if (!monitor.fastMode) continue;
          routeId = searchFrontier(hole.entranceId);
          if (routeId < 0) continue;
          remaining = Math.abs(routeId % width - hole.entranceId % width) +
            Math.abs(Math.floor(routeId / width) - Math.floor(hole.entranceId / width));
        }
        const steps = searchSteps[routeId] + remaining + 1;
        const cost = searchCost[routeId] + remaining * 10 + 10;
        if (!best || cost < best.cost || (cost === best.cost && steps < best.steps)) {
          best = {
            hole,
            routeId,
            cost,
            steps,
            dir: MK_DIRS[routeId === hole.entranceId && searchSteps[routeId] === 0
              ? hole.enterDir : searchFirst[routeId]],
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
        monitor.work++;
        const p = mkTile(tile);
        const id = pointId(p);
        if (id < 0 || !walkable[id] || holeDistance[id] < 0 || id === memory.ignoredCheeseId) continue;
        let routeId = id;
        let remaining = 0;
        if (searchSteps[id] >= MK_INF) {
          if (!monitor.fastMode) continue;
          routeId = searchFrontier(id);
          if (routeId < 0) continue;
          remaining = Math.abs(routeId % width - id % width) +
            Math.abs(Math.floor(routeId / width) - Math.floor(id / width));
        }
        const returnCost = (holeDistance[id] + 1) * 7;
        const score = searchCost[routeId] + remaining * 10 + returnCost;
        if (score < bestScore) {
          bestScore = score;
          best = { id, routeId, dir: searchFirst[routeId], steps: searchSteps[routeId] + remaining, score };
        }
      }
      return best;
    }

    function routeToTile(id) {
      if (id < 0 || id >= area || !walkable[id]) return null;
      if (searchSteps[id] < MK_INF) {
        return { id, routeId: id, dir: searchFirst[id], steps: searchSteps[id] };
      }
      if (!monitor.fastMode) return null;
      const routeId = searchFrontier(id);
      if (routeId < 0) return null;
      const remaining = Math.abs(routeId % width - id % width) +
        Math.abs(Math.floor(routeId / width) - Math.floor(id / width));
      return { id, routeId, dir: searchFirst[routeId], steps: searchSteps[routeId] + remaining };
    }

    function chooseExplore(startId, turn) {
      if (memory.exploreTarget >= 0 && memory.exploreTarget < area &&
          walkable[memory.exploreTarget] && searchSteps[memory.exploreTarget] > 0 &&
          searchSteps[memory.exploreTarget] < MK_INF) return memory.exploreTarget;
      memory.exploreTarget = -1;
      let bestId = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < memory.searchReached; i++) {
        monitor.work++;
        const id = searchTouched[i];
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

    function chooseTunnel(currentIndex, obs, currentExitRisk, urgent, bellUrgent, turn, fastMode) {
      const current = holes[currentIndex];
      if (!current) return null;
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
        const destinationRisk = rememberedPositionRisk(destination.entranceId, turn);
        const spatialDistance = Math.abs(current.entrance.x - destination.entrance.x) +
          Math.abs(current.entrance.y - destination.entrance.y);
        const knownEscape = currentExitRisk >= 0.62 && destinationRisk <= currentExitRisk - 0.16;
        const unknownPosition = !memory.lastCat || turn - memory.lastCat.turn > 8;
        const unknownEscapeAvailable = unknownPosition && !memory.unknownEscapeUsed;
        const blindEscape = (bellUrgent || unknownEscapeAvailable) && spatialDistance >= 5 &&
          currentExitRisk >= 0.48;
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
        if (reverse && (!escape || destinationRisk > currentExitRisk - 0.35)) continue;
        const taxBefore = Math.floor(memory.hiddenTurns / taxEvery);
        const taxAfter = Math.floor((memory.hiddenTurns + tunnelTurns) / taxEvery);
        const tunnelTax = taxAfter - taxBefore;
        if (!escape && (remainingHidden <= tunnelTurns + 1 || tunnelTax > 0)) continue;
        let score;
        if (escape) {
          const danger = Math.round(destinationRisk * 100);
          score = tunnelTurns * 10 + danger + tunnelTax * 18 - Math.min(spatialDistance, 12);
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
      if (memory.recoveryCheese) {
        const recovery = memory.recoveryCheese;
        if (obs.you.carrying === true || !hasCheeseAt(obs.cheese, recovery.id)) {
          if (memory.ignoredCheeseId === recovery.id) memory.ignoredCheeseId = -1;
          memory.recoveryCheese = null;
        } else if (recovery.phase === 'stepOff' && startId !== recovery.id) {
          recovery.phase = 'return';
        } else if (recovery.phase === 'return' && startId === recovery.id && turn > recovery.createdTurn) {
          memory.ignoredCheeseId = recovery.id;
          memory.recoveryCheese = null;
        }
      }
      if (memory.ignoredCheeseId >= 0 && !hasCheeseAt(obs.cheese, memory.ignoredCheeseId)) memory.ignoredCheeseId = -1;

      const cat = mkPoint(obs.cat);
      if (cat) {
        const catId = pointId(cat);
        if (catId >= 0 && walkable[catId]) {
          memory.lastCat = { id: catId, turn };
          memory.unknownEscapeUsed = false;
        }
      }
      const previousBell = memory.previousBell;
      const bellApproaching = mkNumber(obs.bell) && mkNumber(previousBell) && previousBell - obs.bell >= 0.8;
      const bellEasing = mkNumber(obs.bell) && mkNumber(previousBell) && obs.bell - previousBell >= 1;
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
      const currentCatId = cat ? pointId(cat) : -1;
      const threatSource = currentCatId >= 0 && walkable[currentCatId] ? currentCatId :
        (memory.lastCat && turn - memory.lastCat.turn <= 8 ? memory.lastCat.id : -1);
      if (memory.threatOrigin !== threatSource || memory.threatFastMode !== fastMode) {
        threatDistance.fill(-1);
        if (threatSource >= 0) {
          bfs(threatSource, threatDistance, null, null, 8,
            fastMode ? Math.min(area, 500) : area, -1);
        }
        memory.threatOrigin = threatSource;
        memory.threatFastMode = fastMode;
      }
      const catDistanceAtMouse = threatDistance[startId];
      const rememberedThreat = memory.lastCat && turn - memory.lastCat.turn <= 2 &&
        catDistanceAtMouse >= 0 && catDistanceAtMouse <= 2;
      const immediateThreat = (!!cat && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 3) || !!rememberedThreat;
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
        if (memory.waitingHole !== obs.you.inHole) {
          memory.waitingHole = obs.you.inHole;
          memory.holeWaitTurns = 0;
        }
        const rawExitRisk = exitRisk(current, obs, turn, bellApproaching, bellEasing);
        const catDistanceToExit = threatDistance[current.entranceId];
        // The cat can win the exit tile this turn by reaching it in one move or a
        // clear two-tile sprint. A distant bell must not dilute this concrete danger.
        const catCanMoveToExit = !!cat && catDistanceToExit >= 0 && catDistanceToExit <= 1;
        const catDx = cat ? current.entrance.x - cat.x : 0;
        const catDy = cat ? current.entrance.y - cat.y : 0;
        const sprintMidId = cat && Math.abs(catDx) + Math.abs(catDy) === 2 &&
          (catDx === 0 || catDy === 0)
          ? idAt(cat.x + Math.sign(catDx), cat.y + Math.sign(catDy)) : -1;
        const catCanSprintToExit = !!cat && !catCanMoveToExit &&
          catDistanceToExit === 2 && sprintMidId >= 0 && walkable[sprintMidId] &&
          obs.cat && mkNumber(obs.cat.stamina) && obs.cat.stamina > 0;
        const catCanCaptureAtExit = catCanMoveToExit || catCanSprintToExit;
        const lastCatAge = memory.lastCat ? turn - memory.lastCat.turn : Infinity;
        const recentReliableThreat = !cat && lastCatAge <= 2 && rawExitRisk >= 0.72;
        const exitBlocked = catCanCaptureAtExit || recentReliableThreat || rawExitRisk >= 0.72;
        const currentRisk = catCanMoveToExit ? 1 : catCanSprintToExit
          ? Math.max(0.85, rawExitRisk) : rawExitRisk;
        const tunnel = chooseTunnel(obs.you.inHole, obs, currentRisk, urgent, tunnelBellUrgent, turn, fastMode);
        if (tunnel) {
          memory.waitingHole = -1;
          memory.holeWaitTurns = 0;
          memory.pendingTunnel = { from: obs.you.inHole, to: tunnel.hole, startTurn: turn };
          memory.lastTunnel = { from: obs.you.inHole, to: tunnel.hole, turn };
          if ((!memory.lastCat || turn - memory.lastCat.turn > 8) && !tunnelBellUrgent) {
            memory.unknownEscapeUsed = true;
          }
          return action('STAY', { tunnel: tunnel.hole }, tunnel.escape ? 'túnel para escapar' : 'túnel hacia el queso');
        }
        const highRiskExit = currentRisk >= 0.72;
        const uncertainExit = currentRisk >= 0.48;
        const taxRemaining = taxEvery - (memory.hiddenTurns % taxEvery);
        const waitLimit = highRiskExit ? Math.min(8, Math.max(3, taxRemaining + 1)) :
          uncertainExit ? 1 : 0;
        if (memory.holeWaitTurns < waitLimit) {
          if (memory.waitingHole !== obs.you.inHole) {
            memory.waitingHole = obs.you.inHole;
            memory.holeWaitTurns = 0;
          }
          memory.holeWaitTurns++;
          return action('STAY', null, highRiskExit
            ? 'esperar o buscar una salida menos peligrosa'
            : 'confirmar que la salida esté despejada');
        }
        const turnsRemaining = Math.max(0, (Number.isInteger(obs.maxTurns) ? obs.maxTurns : 400) - turn);
        // If the cat has kept this exit blocked, use that observed duration as a
        // conservative forecast for how much longer hiding may cost. This makes
        // the choice respond to accumulated tax without turning waitLimit into an
        // automatic exit command.
        const hideWindow = Math.min(turnsRemaining, Math.max(taxEvery, memory.holeWaitTurns));
        const hideTaxCost = Math.floor((memory.hiddenTurns + hideWindow) / taxEvery) -
          Math.floor(memory.hiddenTurns / taxEvery);
        const catchPoints = rules && mkNumber(rules.catchPoints) ? rules.catchPoints : 3;
        const cheeseLoss = obs.you.carrying === true
          ? (rules && mkNumber(rules.cheesePoints) ? rules.cheesePoints : 3) : 0;
        const expectedCatchCost = currentRisk * (catchPoints + cheeseLoss);
        if (expectedCatchCost >= hideTaxCost && expectedCatchCost > 0) {
          memory.waitingHole = obs.you.inHole;
          memory.holeWaitTurns++;
          return action('STAY', null,
            (exitBlocked ? 'salida bloqueada o amenaza reciente' : 'riesgo de captura') +
            ': captura estimada ' + expectedCatchCost.toFixed(1) +
            ' vs impuesto proyectado ' + hideTaxCost + ' en ' + hideWindow + ' turnos');
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

      const useRisk = !fastMode && confidence >= 0.45 && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 6;
      mouseSearch(startId, useRisk, confidence, fastMode, threatSource);
      const leftRecentHole = memory.lastExitedHole >= 0 && turn - memory.lastExitTurn < 4;
      const blockedHole = leftRecentHole && obs.you.carrying !== true ? memory.lastExitedHole : -1;
      let holeRoute = obs.you.carrying === true || urgent ? chooseHole(-1) : null;
      if (urgent && blockedHole >= 0 && holeRoute && holeRoute.hole.index === blockedHole) {
        holeRoute = chooseHole(blockedHole);
      }
      let cheeseRoute = null;
      if (obs.you.carrying !== true && !urgent && !memory.recoveryCheese) cheeseRoute = chooseCheese(obs.cheese);

      if (obs.you.carrying !== true && !memory.recoveryCheese && cheeseRoute && cheeseRoute.id === startId) {
        memory.recoveryCheese = { id: startId, phase: 'stepOff', createdTurn: turn };
      }
      if (memory.recoveryCheese && memory.recoveryCheese.id === startId &&
          memory.recoveryCheese.phase === 'stepOff' && urgent) {
        memory.recoveryCheese.phase = 'return';
      }

      if (urgent) {
        if (holeRoute) return action(holeRoute.dir, null, 'escapar hacia agujero ' + holeRoute.hole.index + ' dir ' + holeRoute.dir);
        return action(safestStep(startId), null, 'escapar del gato');
      }

      if (obs.you.carrying === true) {
        const delivery = chooseHole(-1);
        if (delivery) return action(delivery.dir, null, 'entregar queso por agujero ' + delivery.hole.index);
        return action(safestStep(startId), null, 'buscar una ruta de entrega segura');
      }

      if (memory.recoveryCheese) {
        const recovery = memory.recoveryCheese;
        if (recovery.phase === 'stepOff' && startId === recovery.id) {
          const step = safestStep(startId);
          if (step !== 'STAY') {
            recovery.phase = 'return';
            return action(step, null, 'salir una vez del queso soltado');
          }
        }
        recovery.phase = 'return';
        const route = routeToTile(recovery.id);
        if (route && route.dir >= 0) return action(MK_DIRS[route.dir], null, 'volver al queso soltado');
        memory.ignoredCheeseId = recovery.id;
        memory.recoveryCheese = null;
      }

      if (cheeseRoute) {
        if (cheeseRoute.id === startId) {
          const step = safestStep(startId);
          if (step !== 'STAY') return action(step, null, 'salir de la casilla para recoger queso');
        } else if (cheeseRoute.dir >= 0) {
          return action(MK_DIRS[cheeseRoute.dir], null, 'buscar queso y dejar ruta de entrega');
        }
      }

      const explore = chooseExplore(startId, turn);
      if (explore >= 0 && searchFirst[explore] >= 0) {
        memory.exploreTarget = explore;
        return action(MK_DIRS[searchFirst[explore]], null, 'explorar hasta que aparezca queso');
      }
      if (cat && catDistanceAtMouse >= 0 && catDistanceAtMouse <= 3) {
        return action(safestStep(startId), null, 'escapar por la casilla más segura');
      }
      return action('STAY', null, 'sin objetivo accesible');
    };

    return monitored(core);
  }

  return monitored(function () { return action('STAY', null, 'rol inválido'); });
}
