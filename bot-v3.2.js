// Midnight Kitchen Bot V3.2.
// Mouse: leave safe holes promptly, collect and deliver cheese, and tunnel only
// for an identified escape or a measured route improvement.
// Cat: retain actionable evidence, intercept carrying mice, and avoid scent churn.
// One file, no imports, no filesystem or network access from the bot.

const V32_DIRS = ["N", "E", "S", "W"];
const V32_DX = [0, 1, 0, -1];
const V32_DY = [-1, 0, 1, 0];
const V32_INF = 0x3fffffff;

function v32Number(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function v32Point(value) {
  if (!value || !Number.isInteger(value.x) || !Number.isInteger(value.y))
    return null;
  return { x: value.x, y: value.y };
}

function v32Tile(value) {
  if (
    !Array.isArray(value) ||
    !Number.isInteger(value[0]) ||
    !Number.isInteger(value[1])
  )
    return null;
  return { x: value[0], y: value[1] };
}

function createBot(setup) {
  const role = setup && setup.role;
  const map = setup && setup.map;
  const rules = (setup && setup.rules) || {};
  if (
    !map ||
    !Number.isInteger(map.width) ||
    !Number.isInteger(map.height) ||
    map.width < 1 ||
    map.height < 1 ||
    !Array.isArray(map.rows) ||
    map.rows.length < map.height ||
    !Array.isArray(map.holes)
  ) {
    return function () {
      return { move: "STAY" };
    };
  }

  const width = map.width;
  const height = map.height;
  const area = width * height;
  if (!Number.isSafeInteger(area) || area < 1)
    return function () {
      return { move: "STAY" };
    };
  const walkable = new Uint8Array(area);
  const neighbors = new Array(area);
  const neighborDirs = new Array(area);

  function inBounds(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height
    );
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
      if (fx + V32_DX[d] === tx && fy + V32_DY[d] === ty) return d;
    }
    return -1;
  }

  for (let y = 0; y < height; y++) {
    if (typeof map.rows[y] !== "string" || map.rows[y].length < width) {
      return function () {
        return { move: "STAY" };
      };
    }
    for (let x = 0; x < width; x++) {
      if (map.rows[y][x] === "." || map.rows[y][x] === "T")
        walkable[idAt(x, y)] = 1;
    }
  }

  for (let id = 0; id < area; id++) {
    const adj = [];
    const dirs = [];
    if (walkable[id]) {
      const x = id % width;
      const y = Math.floor(id / width);
      for (let d = 0; d < 4; d++) {
        const next = idAt(x + V32_DX[d], y + V32_DY[d]);
        if (next >= 0 && walkable[next]) {
          adj.push(next);
          dirs.push(d);
        }
      }
    }
    neighbors[id] = adj;
    neighborDirs[id] = dirs;
  }

  const holes = new Array(map.holes.length);
  const holeAt = new Int32Array(area);
  holeAt.fill(-1);
  for (let i = 0; i < map.holes.length; i++) {
    const raw = map.holes[i];
    const point = v32Point(raw);
    const entrance = raw && v32Point(raw.entrance);
    if (
      !point ||
      !entrance ||
      !inBounds(point.x, point.y) ||
      !inBounds(entrance.x, entrance.y)
    )
      continue;
    const holeId = pointId(point);
    const entranceId = pointId(entrance);
    if (
      map.rows[point.y][point.x] !== "H" ||
      !walkable[entranceId] ||
      Math.abs(point.x - entrance.x) + Math.abs(point.y - entrance.y) !== 1
    )
      continue;
    const hole = {
      index: i,
      id: holeId,
      point,
      entrance,
      entranceId,
      enterDir: dirBetween(entranceId, holeId),
      exitDir: dirBetween(holeId, entranceId),
    };
    holes[i] = hole;
    holeAt[holeId] = i;
  }

  const queue = new Int32Array(area);
  const bfsWork = { value: 0 };
  function bfs(start, dist, prev, first, stopAt) {
    dist.fill(-1);
    if (prev) prev.fill(-1);
    if (first) first.fill(-1);
    if (start < 0 || start >= area || !walkable[start]) return 0;
    let head = 0;
    let tail = 0;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      bfsWork.value++;
      if (current === stopAt) break;
      const adj = neighbors[current];
      const dirs = neighborDirs[current];
      for (let k = 0; k < adj.length; k++) {
        const next = adj[k];
        if (dist[next] >= 0) continue;
        dist[next] = dist[current] + 1;
        if (prev) prev[next] = current;
        if (first) first[next] = current === start ? dirs[k] : first[current];
        queue[tail++] = next;
      }
    }
    return tail;
  }

  const holeDistance = new Int32Array(area);
  holeDistance.fill(-1);
  const nearestHole = new Int32Array(area);
  nearestHole.fill(-1);
  const nextTowardHole = new Int32Array(area);
  nextTowardHole.fill(-1);
  let hHead = 0;
  let hTail = 0;
  for (const hole of holes) {
    if (!hole || holeDistance[hole.entranceId] >= 0) continue;
    holeDistance[hole.entranceId] = 0;
    nearestHole[hole.entranceId] = hole.index;
    queue[hTail++] = hole.entranceId;
  }
  while (hHead < hTail) {
    const current = queue[hHead++];
    for (const next of neighbors[current]) {
      if (holeDistance[next] >= 0) continue;
      holeDistance[next] = holeDistance[current] + 1;
      nearestHole[next] = nearestHole[current];
      nextTowardHole[next] = current;
      queue[hTail++] = next;
    }
  }

  const holeRoutes = new Array(holes.length);
  for (const hole of holes) {
    if (!hole) continue;
    const distances = new Int32Array(area);
    bfs(hole.entranceId, distances, null, null, -1);
    holeRoutes[hole.index] = distances;
  }

  const debugLimit =
    Number.isInteger(rules.debugMaxChars) && rules.debugMaxChars >= 0
      ? rules.debugMaxChars
      : 140;
  function action(move, fields, debug) {
    const result = {
      move: V32_DIRS.indexOf(move) >= 0 || move === "STAY" ? move : "STAY",
    };
    if (fields)
      for (const key of Object.keys(fields)) result[key] = fields[key];
    result.debug = String(debug || "").slice(0, debugLimit);
    return result;
  }

  function reconstructPath(start, goal, prev) {
    if (start < 0 || goal < 0 || start >= area || goal >= area) return [];
    const path = [];
    let current = goal;
    while (current >= 0 && path.length <= area) {
      path.push(current);
      if (current === start) break;
      current = prev[current];
    }
    if (path[path.length - 1] !== start) return [];
    path.reverse();
    return path;
  }

  function now() {
    if (
      typeof performance !== "undefined" &&
      performance &&
      typeof performance.now === "function"
    ) {
      return performance.now();
    }
    return Date.now();
  }

  let callCount = 0;
  let elapsedTotal = 0;
  let constrained = false;
  const budget =
    v32Number(rules.gameTimeMs) && rules.gameTimeMs > 0
      ? rules.gameTimeMs
      : 5000;
  function measured(core) {
    return function (obs) {
      const started = now();
      bfsWork.value = 0;
      let result;
      try {
        result = core(obs);
      } catch (err) {
        result = action(
          "STAY",
          null,
          "error interno: " + ((err && err.message) || "desconocido"),
        );
      }
      elapsedTotal += Math.max(0, now() - started);
      callCount++;
      const remaining = Math.max(
        0,
        (obs && Number.isInteger(obs.maxTurns) ? obs.maxTurns : 400) -
          (obs && Number.isInteger(obs.turn) ? obs.turn : 0),
      );
      if (
        callCount >= 10 &&
        (elapsedTotal / callCount) * remaining + elapsedTotal > budget * 0.65
      ) {
        constrained = true;
      }
      return result;
    };
  }

  if (role === "mouse") return createMouse();
  if (role === "cat") return createCat();
  return function () {
    return action("STAY", null, "rol inválido");
  };

  function createMouse() {
    const taxEvery =
      v32Number(rules.hidingTaxEvery) && rules.hidingTaxEvery > 0
        ? rules.hidingTaxEvery
        : 15;
    const dist = new Int32Array(area);
    const first = new Int8Array(area);
    const prev = new Int32Array(area);
    const catDist = new Int32Array(area);
    const catPrev = new Int32Array(area);
    const memory = {
      lastCat: null,
      previousBell: null,
      hiddenTurns: 0,
      lastHiddenTurn: -1,
      holeWait: 0,
      waitingHole: -1,
      holeVisits: new Int32Array(holes.length),
      lastTunnel: null,
      pendingTunnel: null,
      tunnelTimes: new Float64Array(holes.length * holes.length),
      recovery: null,
      ignoredCheese: -1,
      exploreTarget: -1,
      visited: new Int32Array(area),
    };
    memory.holeVisits.fill(-10000);
    memory.visited.fill(-10000);

    function hasCheese(cheeses, id) {
      if (!Array.isArray(cheeses)) return false;
      for (const tile of cheeses) {
        const p = v32Tile(tile);
        if (p && pointId(p) === id) return true;
      }
      return false;
    }

    function processEvents(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== "string") continue;
        if (
          event.type === "dropped" &&
          Number.isInteger(event.x) &&
          Number.isInteger(event.y)
        ) {
          const id = idAt(event.x, event.y);
          if (id >= 0) memory.recovery = { id, phase: "stepOff", turn };
        } else if (event.type === "pickup" || event.type === "delivered") {
          memory.recovery = null;
          memory.ignoredCheese = -1;
        } else if (
          event.type === "caught" &&
          Number.isInteger(event.x) &&
          Number.isInteger(event.y)
        ) {
          const id = idAt(event.x, event.y);
          if (id >= 0) memory.lastCat = { id, turn: Math.max(0, turn - 1) };
          if (memory.recovery) memory.recovery.phase = "return";
        }
      }
    }

    function observeCat(obs, turn) {
      const cat = v32Point(obs.cat);
      if (cat) {
        const id = pointId(cat);
        if (id >= 0 && walkable[id])
          memory.lastCat = { id, turn, stamina: obs.cat.stamina };
      }
      const oldBell = memory.previousBell;
      const approaching =
        v32Number(obs.bell) && v32Number(oldBell) && oldBell - obs.bell >= 1;
      const easing =
        v32Number(obs.bell) && v32Number(oldBell) && obs.bell - oldBell >= 1;
      memory.previousBell = v32Number(obs.bell) ? obs.bell : null;
      return { cat, approaching, easing };
    }

    function positionRisk(
      id,
      obs,
      turn,
      cat,
      catDistance,
      approaching,
      easing,
    ) {
      let risk = 0.03;
      let canReachNow = false;
      if (cat) {
        const d = catDistance[id];
        if (d >= 0 && d <= 1) {
          risk = 1;
          canReachNow = true;
        } else if (d === 2) {
          const dx = (id % width) - cat.x;
          const dy = Math.floor(id / width) - cat.y;
          const mid =
            Math.abs(dx) + Math.abs(dy) === 2 && (dx === 0 || dy === 0)
              ? idAt(cat.x + Math.sign(dx), cat.y + Math.sign(dy))
              : -1;
          if (
            mid >= 0 &&
            walkable[mid] &&
            v32Number(obs.cat.stamina) &&
            obs.cat.stamina > 0
          ) {
            risk = 0.86;
            canReachNow = true;
          } else risk = 0.42;
        } else if (d >= 0 && d <= 4) risk = d === 3 ? 0.22 : 0.12;
      } else if (memory.lastCat) {
        const age = Math.max(0, turn - memory.lastCat.turn);
        if (age <= 2) {
          const d = catDistance[id];
          if (d >= 0 && d <= age * 2 + 1) risk = age === 1 ? 0.28 : 0.13;
          else if (d >= 0 && d <= age * 2 + 4) risk = age === 1 ? 0.12 : 0.07;
        }
      }
      if (v32Number(obs.bell)) {
        const bellRisk =
          obs.bell <= 2
            ? 0.88
            : obs.bell <= 4
              ? 0.5
              : obs.bell <= 6
                ? 0.19
                : 0.04;
        risk = Math.max(risk, bellRisk);
      } else if (!cat && obs.bellLoud === true) {
        risk = Math.max(risk, 0.42);
      } else if (!cat) {
        risk = Math.min(risk, 0.16);
      }
      if (approaching) risk = Math.max(risk, 0.6);
      if (easing && v32Number(obs.bell))
        risk = Math.min(risk, obs.bell <= 4 ? 0.35 : 0.1);
      return { risk: Math.max(0, Math.min(1, risk)), canReachNow };
    }

    function tunnelDuration(from, to) {
      const slot = from * holes.length + to;
      if (memory.tunnelTimes[slot] > 0) return memory.tunnelTimes[slot];
      const a = holes[from];
      const b = holes[to];
      if (!a || !b) return 6;
      const md =
        Math.abs(a.point.x - b.point.x) + Math.abs(a.point.y - b.point.y);
      return Math.max(2, 2 + Math.floor(md / 5));
    }

    function tunnelToSafeHole(
      current,
      turn,
      currentRisk,
      immediate,
      obs,
      cat,
      catDistance,
    ) {
      let best = null;
      for (const dest of holes) {
        if (!dest || dest.index === current.index) continue;
        const reverse =
          memory.lastTunnel &&
          memory.lastTunnel.from === dest.index &&
          memory.lastTunnel.to === current.index &&
          turn - memory.lastTunnel.turn < 14;
        const recentlyVisited = turn - memory.holeVisits[dest.index] < 24;
        if (reverse && !immediate) continue;
        if (recentlyVisited && !immediate) continue;
        let destRisk = 0.06;
        if (cat) {
          const d = catDistance[dest.entranceId];
          destRisk =
            d < 0 ? 0.35 : d <= 1 ? 1 : d <= 2 ? 0.65 : d <= 4 ? 0.24 : 0.06;
        } else if (v32Number(obs.bell)) {
          destRisk = obs.bell <= 2.5 ? 0.35 : obs.bell <= 5 ? 0.18 : 0.06;
        }
        const duration = tunnelDuration(current.index, dest.index);
        let emergency = immediate && destRisk + 0.2 < currentRisk;
        let shortcut = false;
        let saved = 0;
        if (
          !immediate &&
          !constrained &&
          Array.isArray(obs.cheese) &&
          obs.cheese.length
        ) {
          const fromCurrent = holeRoutes[current.index];
          const fromDest = holeRoutes[dest.index];
          let walkBest = V32_INF;
          let tunnelBest = V32_INF;
          for (const tile of obs.cheese) {
            const p = v32Tile(tile);
            const id = pointId(p);
            if (id < 0 || !walkable[id] || holeDistance[id] < 0) continue;
            const a = fromCurrent ? fromCurrent[id] : -1;
            const b = fromDest ? fromDest[id] : -1;
            if (a >= 0) walkBest = Math.min(walkBest, a + holeDistance[id] + 1);
            if (b >= 0)
              tunnelBest = Math.min(
                tunnelBest,
                duration + 1 + b + holeDistance[id] + 1,
              );
          }
          saved = walkBest - tunnelBest;
          shortcut = saved >= 3 && destRisk < 0.35;
        }
        if (!emergency && !shortcut) continue;
        if (reverse && !emergency) continue;
        const score =
          destRisk * 100 +
          duration * 3 -
          (shortcut ? saved * 2 : 0) +
          (recentlyVisited ? 18 : 0);
        if (!best || score < best.score)
          best = { hole: dest.index, score, emergency, saved };
      }
      return best;
    }

    function chooseDeliveryHole(startId, catVisible) {
      let best = null;
      for (const hole of holes) {
        if (!hole || dist[hole.entranceId] < 0) continue;
        const steps = dist[hole.entranceId] + 1;
        const enemy = catVisible ? catDist[hole.entranceId] : -1;
        const margin = enemy < 0 ? 8 : enemy - steps;
        const score =
          steps * 2 -
          Math.min(12, margin) * 1.8 +
          (enemy >= 0 && enemy <= steps + 1 ? 18 : 0);
        if (!best || score < best.score) best = { hole, score, steps };
      }
      return best;
    }

    function chooseCheese(obs, startId, catVisible) {
      let best = null;
      if (!Array.isArray(obs.cheese)) return best;
      for (const tile of obs.cheese) {
        const p = v32Tile(tile);
        const id = pointId(p);
        if (
          id < 0 ||
          !walkable[id] ||
          dist[id] < 0 ||
          id === memory.ignoredCheese
        )
          continue;
        if (holeDistance[id] < 0) continue;
        let score = dist[id] + holeDistance[id] + 1;
        if (catVisible && catDist[id] >= 0 && catDist[id] <= dist[id] + 2) {
          score += (dist[id] + 3 - catDist[id]) * 2.5;
        }
        if (!best || score < best.score) best = { id, score };
      }
      return best;
    }

    function chooseExplore(startId, turn) {
      if (
        memory.exploreTarget >= 0 &&
        memory.exploreTarget < area &&
        walkable[memory.exploreTarget] &&
        memory.exploreTarget !== startId &&
        dist[memory.exploreTarget] >= 0
      )
        return memory.exploreTarget;
      let bestId = -1;
      let bestScore = -Infinity;
      if (constrained) {
        for (const id of neighbors[startId]) {
          const visitAge = Math.min(
            100,
            Math.max(0, turn - memory.visited[id]),
          );
          const score = visitAge - 1.8;
          if (score > bestScore) {
            bestScore = score;
            bestId = id;
          }
        }
        memory.exploreTarget = bestId;
        return bestId;
      }
      for (let id = 0; id < area; id++) {
        if (!walkable[id] || dist[id] <= 0) continue;
        const visitAge = Math.min(100, Math.max(0, turn - memory.visited[id]));
        const score =
          visitAge - dist[id] * 1.8 + (holeDistance[id] >= 0 ? 1 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      memory.exploreTarget = bestId;
      return bestId;
    }

    function safeStep(startId, threatKnown) {
      let bestDir = -1;
      let bestScore = -Infinity;
      for (let k = 0; k < neighbors[startId].length; k++) {
        const id = neighbors[startId][k];
        const enemy = threatKnown ? catDist[id] : -1;
        const score =
          (enemy < 0 ? 12 : enemy * 4) - Math.max(0, holeDistance[id]) * 0.35;
        if (score > bestScore) {
          bestScore = score;
          bestDir = neighborDirs[startId][k];
        }
      }
      return bestDir >= 0 ? V32_DIRS[bestDir] : "STAY";
    }

    const core = function (obs) {
      if (!obs || !obs.you) return action("STAY", null, "observación inválida");
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const you = v32Point(obs.you);
      const startId = pointId(you);
      if (!you || startId < 0) return action("STAY", null, "posición inválida");
      processEvents(obs.events, turn);
      const inHole = Number.isInteger(obs.you.inHole) && obs.you.inHole >= 0;
      const hidden = inHole || !!obs.you.tunneling;
      if (hidden && memory.lastHiddenTurn !== turn) {
        memory.hiddenTurns++;
        memory.lastHiddenTurn = turn;
      }
      if (
        memory.recovery &&
        (obs.you.carrying === true ||
          !hasCheese(obs.cheese, memory.recovery.id))
      ) {
        memory.recovery = null;
        memory.ignoredCheese = -1;
      }
      if (
        memory.ignoredCheese >= 0 &&
        !hasCheese(obs.cheese, memory.ignoredCheese)
      )
        memory.ignoredCheese = -1;
      if (
        memory.recovery &&
        memory.recovery.phase === "stepOff" &&
        startId !== memory.recovery.id
      ) {
        memory.recovery.phase = "return";
      } else if (
        memory.recovery &&
        memory.recovery.phase === "return" &&
        startId === memory.recovery.id &&
        turn > memory.recovery.turn &&
        obs.you.carrying !== true
      ) {
        memory.ignoredCheese = memory.recovery.id;
        memory.recovery = null;
      }
      if (Array.isArray(obs.visible)) {
      }
      const seen = observeCat(obs, turn);
      const catId = seen.cat ? pointId(seen.cat) : -1;
      if (memory.pendingTunnel) {
        if (obs.you.tunneling && v32Number(obs.you.tunneling.turnsLeft)) {
          memory.pendingTunnel.lastLeft = obs.you.tunneling.turnsLeft;
        } else if (inHole && obs.you.inHole === memory.pendingTunnel.to) {
          const slot =
            memory.pendingTunnel.from * holes.length + memory.pendingTunnel.to;
          const elapsed = Math.max(1, turn - memory.pendingTunnel.startTurn);
          memory.tunnelTimes[slot] =
            memory.tunnelTimes[slot] > 0
              ? memory.tunnelTimes[slot] * 0.6 + elapsed * 0.4
              : elapsed;
          memory.pendingTunnel = null;
        } else if (turn - memory.pendingTunnel.startTurn > 30)
          memory.pendingTunnel = null;
      }
      if (obs.you.tunneling) return action("STAY", null, "completar túnel");

      if (seen.cat) bfs(catId, catDist, null, null, -1);
      else if (memory.lastCat && turn - memory.lastCat.turn <= 2)
        bfs(memory.lastCat.id, catDist, null, null, -1);
      else catDist.fill(-1);

      const bellUrgent =
        obs.bellLoud === true ||
        (v32Number(obs.bell) && obs.bell <= 3.5) ||
        seen.approaching;
      if (inHole) {
        const current = holes[obs.you.inHole];
        if (!current) return action("STAY", null, "índice de agujero inválido");
        if (memory.waitingHole !== current.index) {
          memory.waitingHole = current.index;
          memory.holeWait = 0;
        }
        memory.holeVisits[current.index] = turn;
        const exit = positionRisk(
          current.entranceId,
          obs,
          turn,
          seen.cat,
          catDist,
          seen.approaching,
          seen.easing,
        );
        const immediate = exit.canReachNow;
        const tunnel = tunnelToSafeHole(
          current,
          turn,
          exit.risk,
          immediate,
          obs,
          seen.cat,
          catDist,
        );
        if (tunnel) {
          memory.pendingTunnel = {
            from: current.index,
            to: tunnel.hole,
            startTurn: turn,
          };
          memory.lastTunnel = { from: current.index, to: tunnel.hole, turn };
          memory.waitingHole = -1;
          memory.holeWait = 0;
          return action(
            "STAY",
            { tunnel: tunnel.hole },
            tunnel.emergency
              ? "túnel de escape: salida bloqueada"
              : "túnel que ahorra " + tunnel.saved + " pasos",
          );
        }
        if (immediate) {
          memory.holeWait++;
          const nextTax =
            Math.floor((memory.hiddenTurns + 1) / taxEvery) -
            Math.floor(memory.hiddenTurns / taxEvery);
          return action(
            "STAY",
            null,
            "gato alcanza la entrada; impuesto del próximo turno " + nextTax,
          );
        }
        if ((exit.risk >= 0.72 || bellUrgent) && memory.holeWait < 1) {
          memory.holeWait++;
          return action("STAY", null, "confirmar amenaza cercana una vez");
        }
        memory.waitingHole = -1;
        memory.holeWait = 0;
        return action(
          V32_DIRS[current.exitDir],
          null,
          exit.risk < 0.25
            ? "salir: gato lejos, buscar queso"
            : "salir tras comprobar el riesgo",
        );
      }

      if (!walkable[startId])
        return action("STAY", null, "posición fuera del piso");
      bfs(startId, dist, prev, first, -1);
      memory.visited[startId] = turn;
      if (memory.exploreTarget === startId) memory.exploreTarget = -1;

      const catDistance = seen.cat ? catDist[startId] : -1;
      const recentCatAge = memory.lastCat ? turn - memory.lastCat.turn : 10000;
      const heardDanger =
        (v32Number(obs.bell) && obs.bell <= 3.5) || obs.bellLoud === true;
      const urgent =
        (seen.cat && catDistance >= 0 && catDistance <= 3) ||
        heardDanger ||
        (!seen.cat &&
          recentCatAge <= 1 &&
          catDist[startId] >= 0 &&
          catDist[startId] <= 2);
      if (obs.you.heavy === true) {
        if (obs.you.carrying === true && catDistance >= 0 && catDistance <= 1) {
          return action(
            "STAY",
            { drop: true },
            "inmóvil y a distancia de captura: soltar queso",
          );
        }
        return action("STAY", null, "turno pesado");
      }

      if (urgent) {
        const escape = chooseDeliveryHole(startId, !!seen.cat);
        if (escape && escape.steps > 0) {
          const dir =
            startId === escape.hole.entranceId
              ? escape.hole.enterDir
              : first[escape.hole.entranceId];
          if (dir >= 0)
            return action(
              V32_DIRS[dir],
              null,
              "escapar por ruta segura al agujero " + escape.hole.index,
            );
        }
        return action(
          safeStep(startId, !!seen.cat),
          null,
          "alejarse de la amenaza",
        );
      }

      if (obs.you.carrying === true) {
        const delivery = chooseDeliveryHole(startId, !!seen.cat);
        if (delivery) {
          const dir =
            delivery.steps === 1 && startId === delivery.hole.entranceId
              ? delivery.hole.enterDir
              : first[delivery.hole.entranceId];
          return action(
            V32_DIRS[dir],
            null,
            "entregar por la ruta más corta: agujero " + delivery.hole.index,
          );
        }
        return action(
          safeStep(startId, !!seen.cat),
          null,
          "buscar acceso transitable a un agujero",
        );
      }

      if (!memory.recovery && Array.isArray(obs.cheese)) {
        for (const tile of obs.cheese) {
          const p = v32Tile(tile);
          const id = pointId(p);
          if (id === startId && id !== memory.ignoredCheese) {
            memory.recovery = { id, phase: "stepOff", turn };
            break;
          }
        }
      }
      if (memory.recovery) {
        const recovery = memory.recovery;
        if (startId === recovery.id && recovery.phase === "stepOff") {
          const step = safeStep(startId, !!seen.cat);
          if (step !== "STAY") {
            recovery.phase = "return";
            return action(step, null, "salir una vez del queso soltado");
          }
          return action(
            "STAY",
            null,
            "sin casilla segura para recuperar queso",
          );
        }
        if (startId !== recovery.id) {
          if (dist[recovery.id] >= 0 && first[recovery.id] >= 0) {
            return action(
              V32_DIRS[first[recovery.id]],
              null,
              "volver al queso soltado",
            );
          }
          memory.ignoredCheese = recovery.id;
          memory.recovery = null;
        }
      }

      const cheese = chooseCheese(obs, startId, !!seen.cat);
      if (cheese) {
        if (cheese.id === startId)
          return action("STAY", null, "esperar confirmación de recogida");
        if (first[cheese.id] >= 0)
          return action(
            V32_DIRS[first[cheese.id]],
            null,
            "buscar queso y planear entrega",
          );
      }

      const explore = chooseExplore(startId, turn);
      if (explore >= 0 && first[explore] >= 0) {
        memory.exploreTarget = explore;
        return action(
          V32_DIRS[first[explore]],
          null,
          "explorar sector no visitado",
        );
      }
      return action("STAY", null, "sin objetivo transitable");
    };

    return measured(core);
  }

  function createCat() {
    const dist = new Int32Array(area);
    const prev = new Int32Array(area);
    const first = new Int8Array(area);
    const mouseDist = new Int32Array(area);
    const mousePrev = new Int32Array(area);
    const memory = {
      seen: new Int32Array(area),
      visited: new Int32Array(area),
      lastMouse: null,
      velocity: null,
      velocityStreak: 0,
      signal: null,
      scentTarget: -1,
      scentTurn: -10000,
      scentScore: -Infinity,
      patrolTarget: -1,
      previousPosition: -1,
      previousPreviousPosition: -1,
      lastStamina: null,
      previousSprint: false,
      initialStamina: null,
      sprintCost: 6,
      regen: 1,
      campTurns: 0,
    };
    memory.seen.fill(-10000);
    memory.visited.fill(-10000);

    function setSignal(events, turn) {
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || typeof event.type !== "string") continue;
        if (
          event.type === "delivered" &&
          Number.isInteger(event.hole) &&
          holes[event.hole]
        ) {
          memory.signal = {
            kind: "hole",
            id: holes[event.hole].entranceId,
            hole: event.hole,
            turn,
            deadline: turn + Math.min(100, Math.max(24, area / 2)),
            waits: 0,
          };
        } else if (
          event.type === "caught" &&
          Number.isInteger(event.respawnHole) &&
          holes[event.respawnHole]
        ) {
          memory.signal = {
            kind: "hole",
            id: holes[event.respawnHole].entranceId,
            hole: event.respawnHole,
            turn,
            deadline: turn + Math.min(100, Math.max(24, area / 2)),
            waits: 0,
          };
        } else if (
          (event.type === "pickup" || event.type === "dropped") &&
          Number.isInteger(event.x) &&
          Number.isInteger(event.y)
        ) {
          const id = idAt(event.x, event.y);
          if (id >= 0 && walkable[id])
            memory.signal = {
              kind: "point",
              id,
              turn,
              deadline: turn + Math.min(100, Math.max(24, area / 2)),
              waits: 0,
            };
        }
      }
    }

    function nearestMouseHolePath(mouseId) {
      if (
        mouseId < 0 ||
        mouseId >= area ||
        !walkable[mouseId] ||
        nearestHole[mouseId] < 0
      )
        return null;
      const holeIndex = nearestHole[mouseId];
      const hole = holes[holeIndex];
      const path = [mouseId];
      let current = mouseId;
      for (let n = 0; n < area && current !== hole.entranceId; n++) {
        current = nextTowardHole[current];
        if (current < 0) return null;
        path.push(current);
      }
      return { hole, path, steps: path.length - 1 };
    }

    function interceptTarget(mouseId) {
      const route = nearestMouseHolePath(mouseId);
      if (!route) return null;
      const entranceDistance = dist[route.hole.entranceId];
      if (entranceDistance >= 0 && entranceDistance <= route.steps + 1) {
        return {
          id: route.hole.entranceId,
          kind: "intercept",
          hole: route.hole.index,
        };
      }
      let best = null;
      for (let i = 1; i < route.path.length; i++) {
        const id = route.path[i];
        const catSteps = dist[id];
        if (catSteps < 0 || catSteps > i) continue;
        if (!best || i > best.mouseSteps)
          best = {
            id,
            kind: "intercept",
            hole: route.hole.index,
            mouseSteps: i,
          };
      }
      return best;
    }

    function chooseScent(obs, startId, turn) {
      if (!Array.isArray(obs.scent)) return null;
      let best = null;
      for (const smell of obs.scent) {
        if (
          !Array.isArray(smell) ||
          smell.length < 3 ||
          !Number.isInteger(smell[0]) ||
          !Number.isInteger(smell[1]) ||
          !v32Number(smell[2])
        )
          continue;
        const id = idAt(smell[0], smell[1]);
        if (id < 0 || !walkable[id] || id === startId || dist[id] < 0) continue;
        const strength = Math.max(0, Math.min(1, smell[2]));
        if (strength < 0.08) continue;
        let score = strength * 28 - dist[id] * 2;
        const nextOnRoute =
          first[id] >= 0
            ? neighbors[startId][neighborDirs[startId].indexOf(first[id])]
            : -1;
        if (nextOnRoute >= 0 && nextOnRoute === memory.previousPreviousPosition)
          score -= 12;
        if (!best || score > best.score) best = { id, strength, score, turn };
      }
      if (
        memory.scentTarget >= 0 &&
        memory.scentTurn >= turn - 2 &&
        dist[memory.scentTarget] > 0 &&
        dist[memory.scentTarget] >= 0
      ) {
        const carriedScore = memory.scentScore - (turn - memory.scentTurn) * 4;
        if (!best || best.score < carriedScore + 6) {
          return {
            id: memory.scentTarget,
            score: carriedScore,
            turn: memory.scentTurn,
            retained: true,
          };
        }
      }
      if (best) {
        memory.scentTarget = best.id;
        memory.scentTurn = turn;
        memory.scentScore = best.score;
      } else if (memory.scentTarget >= 0 && dist[memory.scentTarget] === 0) {
        memory.scentTarget = -1;
      }
      return best;
    }

    function choosePatrol(startId, turn) {
      if (
        memory.patrolTarget >= 0 &&
        memory.patrolTarget !== startId &&
        walkable[memory.patrolTarget] &&
        dist[memory.patrolTarget] >= 0
      )
        return memory.patrolTarget;
      let target = -1;
      let bestScore = -Infinity;
      for (let id = 0; id < area; id++) {
        if (!walkable[id] || dist[id] <= 0) continue;
        const unseen = Math.min(120, Math.max(0, turn - memory.seen[id]));
        const unvisited = Math.min(120, Math.max(0, turn - memory.visited[id]));
        const score =
          unseen * 0.7 +
          unvisited * 0.3 -
          dist[id] * 1.7 +
          (holeDistance[id] >= 0 && holeDistance[id] <= 2 ? 2 : 0);
        if (score > bestScore) {
          bestScore = score;
          target = id;
        }
      }
      memory.patrolTarget = target;
      return target;
    }

    function sprintPath(target) {
      if (target < 0 || dist[target] < 2) return null;
      let firstNode = target;
      while (prev[firstNode] >= 0 && prev[firstNode] !== currentStart)
        firstNode = prev[firstNode];
      if (prev[firstNode] !== currentStart) return null;
      let secondNode = target;
      while (prev[secondNode] >= 0 && prev[secondNode] !== firstNode)
        secondNode = prev[secondNode];
      if (prev[secondNode] !== firstNode) return null;
      const d1 = dirBetween(currentStart, firstNode);
      const d2 = dirBetween(firstNode, secondNode);
      if (d1 < 0 || d1 !== d2) return null;
      return { dir: d1, firstNode, secondNode };
    }

    let currentStart = -1;
    function catAction(obs, startId, goal, kind, carrying) {
      if (goal < 0 || goal >= area || dist[goal] < 0 || goal === startId)
        return action("STAY", null, "objetivo alcanzado");
      const direction = first[goal];
      if (direction < 0) return action("STAY", null, "sin ruta al objetivo");
      const move = V32_DIRS[direction];
      const stamina = v32Number(obs.you.stamina) ? obs.you.stamina : 0;
      const reserve =
        memory.initialStamina === null
          ? 0
          : Math.max(2, Math.ceil(memory.initialStamina * 0.16));
      const aligned = sprintPath(goal);
      const tactical =
        kind === "intercept" ||
        (kind === "visible" && (carrying || dist[goal] <= 4));
      const sprint =
        !!aligned &&
        tactical &&
        dist[goal] >= 2 &&
        stamina >= memory.sprintCost + reserve;
      memory.previousSprint = sprint;
      memory.lastStamina = stamina;
      return action(
        move,
        { look: move, sprint },
        kind + (sprint ? "; sprint para interceptar" : ""),
      );
    }

    const core = function (obs) {
      if (!obs || !obs.you) return action("STAY", null, "observación inválida");
      const turn = Number.isInteger(obs.turn) ? obs.turn : 0;
      const you = v32Point(obs.you);
      const startId = pointId(you);
      if (!you || startId < 0 || !walkable[startId])
        return action("STAY", null, "posición inválida");
      if (memory.initialStamina === null && v32Number(obs.you.stamina))
        memory.initialStamina = obs.you.stamina;
      if (memory.lastStamina !== null && v32Number(obs.you.stamina)) {
        const delta = memory.lastStamina - obs.you.stamina;
        if (memory.previousSprint && delta > 0)
          memory.sprintCost = memory.sprintCost * 0.55 + delta * 0.45;
        else if (!memory.previousSprint && delta < 0)
          memory.regen = memory.regen * 0.6 + -delta * 0.4;
      }
      memory.previousSprint = false;
      currentStart = startId;
      bfs(startId, dist, prev, first, -1);
      memory.visited[startId] = turn;
      if (memory.patrolTarget === startId) memory.patrolTarget = -1;
      memory.previousPreviousPosition = memory.previousPosition;
      memory.previousPosition = startId;
      setSignal(obs.events, turn);
      if (Array.isArray(obs.visible)) {
        for (const tile of obs.visible) {
          const p = v32Tile(tile);
          if (p) {
            const id = pointId(p);
            if (id >= 0) memory.seen[id] = turn;
          }
        }
      }

      const mouse = v32Point(obs.mouse);
      const mouseId = mouse ? pointId(mouse) : -1;
      const visibleMouse = mouse && mouseId >= 0 && walkable[mouseId];
      if (visibleMouse) {
        if (memory.lastMouse && memory.lastMouse.turn === turn - 1) {
          const dx = mouse.x - memory.lastMouse.x;
          const dy = mouse.y - memory.lastMouse.y;
          if (
            Math.abs(dx) + Math.abs(dy) === 1 &&
            memory.velocity &&
            memory.velocity.dx === dx &&
            memory.velocity.dy === dy
          )
            memory.velocityStreak++;
          else if (Math.abs(dx) + Math.abs(dy) === 1) {
            memory.velocity = { dx, dy };
            memory.velocityStreak = 1;
          } else {
            memory.velocity = null;
            memory.velocityStreak = 0;
          }
        } else {
          memory.velocity = null;
          memory.velocityStreak = 0;
        }
        memory.lastMouse = {
          x: mouse.x,
          y: mouse.y,
          id: mouseId,
          turn,
          carrying: obs.mouse.carrying === true,
        };
        memory.signal = null;
        memory.scentTarget = -1;
        memory.patrolTarget = -1;
      }

      let goal = -1;
      let kind = "patrulla";
      let carrying = false;
      if (visibleMouse) {
        carrying = obs.mouse.carrying === true;
        if (carrying) {
          bfs(mouseId, mouseDist, mousePrev, null, -1);
          const intercept = interceptTarget(mouseId);
          if (intercept && intercept.id === startId) {
            const hole = holes[intercept.hole];
            const lookIndex = hole ? dirBetween(startId, hole.id) : 0;
            return action(
              "STAY",
              { look: V32_DIRS[lookIndex >= 0 ? lookIndex : 0] },
              "bloquear ruta de entrega",
            );
          }
          if (intercept) {
            goal = intercept.id;
            kind = "intercept";
          } else {
            goal = mouseId;
            kind = "visible";
          }
        } else {
          let predicted = mouseId;
          if (memory.velocity && memory.velocityStreak >= 2) {
            const px = mouse.x + memory.velocity.dx;
            const py = mouse.y + memory.velocity.dy;
            const pId = idAt(px, py);
            if (pId >= 0 && walkable[pId] && dist[pId] >= 0) predicted = pId;
          }
          goal = predicted;
          kind = "visible";
        }
      } else {
        const signal = memory.signal;
        if (signal && turn > signal.deadline) memory.signal = null;
        let signalGoal =
          memory.signal && dist[memory.signal.id] >= 0 ? memory.signal.id : -1;
        const scent = chooseScent(obs, startId, turn);
        if (
          signalGoal >= 0 &&
          signalGoal === startId &&
          memory.signal.kind === "hole" &&
          memory.signal.waits < 2
        ) {
          memory.signal.waits++;
          const hole = holes[memory.signal.hole];
          const look = hole ? V32_DIRS[dirBetween(startId, hole.id)] : "N";
          return action("STAY", { look }, "vigilar salida tras señal reciente");
        }
        if (
          signalGoal === startId &&
          memory.signal &&
          memory.signal.kind === "point"
        ) {
          memory.signal = null;
          signalGoal = -1;
        }
        if (
          signalGoal >= 0 &&
          (!scent ||
            scent.score < 18 ||
            signalGoal === startId ||
            (scent.score < 24 && turn - memory.signal.turn < 5))
        ) {
          goal = signalGoal;
          kind =
            memory.signal.kind === "hole"
              ? "interceptar agujero"
              : "investigar evento";
        } else if (scent) {
          goal = scent.id;
          kind = "seguir rastro";
        } else if (signalGoal >= 0) {
          goal = signalGoal;
          kind =
            memory.signal.kind === "hole"
              ? "interceptar agujero"
              : "investigar evento";
        } else if (
          memory.lastMouse &&
          turn - memory.lastMouse.turn <= 24 &&
          dist[memory.lastMouse.id] >= 0
        ) {
          const age = turn - memory.lastMouse.turn;
          if (memory.lastMouse.carrying) {
            const route = nearestMouseHolePath(memory.lastMouse.id);
            if (route) {
              const lead = Math.min(
                route.path.length - 1,
                Math.max(1, age + 1),
              );
              goal = route.path[lead];
              kind = "intercept";
              carrying = true;
            }
          }
          if (goal < 0) {
            goal = memory.lastMouse.id;
            if (memory.velocity && memory.velocityStreak >= 2 && age <= 4) {
              for (let i = 0; i < Math.min(age, 2); i++) {
                const x = (goal % width) + memory.velocity.dx;
                const y = Math.floor(goal / width) + memory.velocity.dy;
                const next = idAt(x, y);
                if (next < 0 || !walkable[next]) break;
                goal = next;
              }
            }
            kind = "buscar última posición";
          }
        }
      }

      if (goal < 0 || dist[goal] < 0) {
        goal = choosePatrol(startId, turn);
        kind = "patrullar cobertura";
      }
      if (goal < 0 || dist[goal] < 0) {
        const direction = (turn - 1) % 4;
        return action(
          V32_DIRS[direction],
          { look: V32_DIRS[direction], sprint: false },
          "barrido local sin objetivo",
        );
      }
      if (goal === startId) {
        if (
          memory.signal &&
          memory.signal.id === startId &&
          memory.signal.kind === "hole"
        ) {
          return action("STAY", { look: "N" }, "vigilar salida de agujero");
        }
        goal = choosePatrol(startId, turn);
        kind = "reanudar cobertura";
      }
      if (goal < 0 || dist[goal] <= 0)
        return action(
          "STAY",
          { look: V32_DIRS[(turn - 1) % 4] },
          "barrido local",
        );
      return catAction(obs, startId, goal, kind, carrying);
    };

    return measured(core);
  }
}
