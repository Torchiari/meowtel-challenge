// Bot V1 para Midnight Kitchen.
// Se apoya solo en la interfaz documentada por el starter y en la observación actual.

const DIRECTIONS = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'W', dx: -1, dy: 0 },
];

const VALID_DIRS = ['N', 'S', 'E', 'W'];

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCoordinate(point) {
  return !!point && isNumber(point.x) && isNumber(point.y) &&
    Number.isInteger(point.x) && Number.isInteger(point.y);
}

function isValidMap(map) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
      map.width <= 0 || map.height <= 0 || !Array.isArray(map.rows) ||
      map.rows.length < map.height || !Array.isArray(map.holes)) return false;
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
  const action = { move };
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

  function inBounds(x, y) {
    return mapValid && Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function nodeId(x, y) {
    return inBounds(x, y) ? y * map.width + x : -1;
  }

  function coordinates(id) {
    if (!mapValid || !Number.isInteger(id) || id < 0 || id >= map.width * map.height) return null;
    return { x: id % map.width, y: Math.floor(id / map.width) };
  }

  function tileAt(x, y) {
    return inBounds(x, y) ? map.rows[y][x] : null;
  }

  function isWalkable(id) {
    const point = coordinates(id);
    if (!point) return false;
    const tile = tileAt(point.x, point.y);
    // Las mesas son transitables; las paredes y los agujeros no forman parte de la ruta normal.
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

  function adjacentIds(id) {
    const point = coordinates(id);
    if (!point) return [];
    const result = [];
    for (const step of DIRECTIONS) {
      const next = nodeId(point.x + step.dx, point.y + step.dy);
      if (next >= 0 && isWalkable(next)) result.push(next);
    }
    return result;
  }

  function buildTree(startId) {
    const count = mapValid ? map.width * map.height : 0;
    const distance = new Int32Array(count);
    const previous = new Int32Array(count);
    const firstDirection = new Array(count);
    distance.fill(-1);
    previous.fill(-1);
    if (!isWalkable(startId)) return { distance, previous, firstDirection, startId: -1 };

    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    distance[startId] = 0;
    queue[tail++] = startId;

    while (head < tail) {
      const current = queue[head++];
      for (const next of adjacentIds(current)) {
        if (distance[next] >= 0) continue;
        distance[next] = distance[current] + 1;
        previous[next] = current;
        firstDirection[next] = current === startId
          ? directionBetween(current, next)
          : firstDirection[current];
        queue[tail++] = next;
      }
    }
    return { distance, previous, firstDirection, startId };
  }

  function pathFromTree(tree, targetId) {
    if (!tree || tree.startId < 0 || !Number.isInteger(targetId) ||
        targetId < 0 || targetId >= tree.distance.length || tree.distance[targetId] < 0) return null;
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
    if (!tree || targetId < 0 || targetId >= tree.distance.length || tree.distance[targetId] < 0) return null;
    const path = pathFromTree(tree, targetId);
    if (!path) return null;
    return {
      distance: tree.distance[targetId],
      firstDir: path.length ? directionBetween(tree.startId, path[0]) : null,
      path,
    };
  }

  function validHole(index) {
    if (!mapValid || !Number.isInteger(index) || index < 0 || index >= map.holes.length) return null;
    const hole = map.holes[index];
    if (!hole || !isCoordinate(hole) || !isCoordinate(hole.entrance) ||
        tileAt(hole.x, hole.y) !== 'H' || !isWalkable(nodeId(hole.entrance.x, hole.entrance.y))) return null;
    if (Math.abs(hole.x - hole.entrance.x) + Math.abs(hole.y - hole.entrance.y) !== 1) return null;
    return hole;
  }

  function routeToHole(tree, index) {
    const hole = validHole(index);
    if (!hole) return null;
    const holeId = nodeId(hole.x, hole.y);
    const entranceId = nodeId(hole.entrance.x, hole.entrance.y);
    const toEntrance = routeFromTree(tree, entranceId);
    if (!toEntrance) return null;
    const enterDirection = directionBetween(entranceId, holeId);
    if (!enterDirection) return null;
    const path = toEntrance.path.concat([holeId]);
    return {
      distance: toEntrance.distance + 1,
      firstDir: toEntrance.distance === 0 ? enterDirection : toEntrance.firstDir,
      path,
      hole: index,
    };
  }

  function routeToPoint(tree, point) {
    if (!isCoordinate(point)) return null;
    const id = nodeId(point.x, point.y);
    return id < 0 ? null : routeFromTree(tree, id);
  }

  function manhattan(a, b) {
    return isCoordinate(a) && isCoordinate(b)
      ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      : Infinity;
  }

  function sweepDirection(turn) {
    const index = Number.isInteger(turn) && turn > 0 ? (turn - 1) % 4 : 0;
    return DIRECTIONS[index].dir;
  }

  function directionToward(from, to, fallback) {
    if (isCoordinate(from) && isCoordinate(to)) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
      if (dy !== 0) return dy > 0 ? 'S' : 'N';
      if (dx !== 0) return dx > 0 ? 'E' : 'W';
    }
    return VALID_DIRS.includes(fallback) ? fallback : 'N';
  }

  function validPosition(entity) {
    return entity && isCoordinate(entity) && nodeId(entity.x, entity.y) >= 0;
  }

  if (role === 'cat') {
    const memory = { lastMouse: null, lastSeenTurn: -1 };

    return function act(obs) {
      if (!mapValid || !obs || !validPosition(obs.you)) {
        return makeAction(setup, 'STAY', null, 'gato: observación o mapa inválido');
      }

      const startId = nodeId(obs.you.x, obs.you.y);
      const tree = buildTree(startId);
      let target = null;
      let reason = 'barrido';
      let mouseVisible = false;

      if (obs.mouse && validPosition(obs.mouse)) {
        target = { x: obs.mouse.x, y: obs.mouse.y };
        mouseVisible = true;
        memory.lastMouse = target;
        memory.lastSeenTurn = Number.isInteger(obs.turn) ? obs.turn : memory.lastSeenTurn;
        reason = 'ratón visible';
      } else if (Array.isArray(obs.scent)) {
        let bestScore = -Infinity;
        for (const scent of obs.scent) {
          if (!Array.isArray(scent) || scent.length < 3 || !isNumber(scent[2]) ||
              !inBounds(scent[0], scent[1])) continue;
          const candidate = { x: scent[0], y: scent[1] };
          const route = routeToPoint(tree, candidate);
          if (!route) continue;
          const strength = Math.max(0, Math.min(1, scent[2]));
          const score = strength * 10 - route.distance * 0.2;
          if (score > bestScore) {
            bestScore = score;
            target = candidate;
          }
        }
        if (target) reason = 'rastro de olor';
      }

      if (!target && memory.lastMouse && Number.isInteger(obs.turn) &&
          obs.turn - memory.lastSeenTurn <= 8) {
        target = memory.lastMouse;
        reason = 'última posición conocida';
      }

      if (!target && Array.isArray(obs.cheese)) {
        let bestDistance = Infinity;
        for (const cheese of obs.cheese) {
          if (!isCoordinate(cheese)) continue;
          const route = routeToPoint(tree, cheese);
          if (route && route.distance < bestDistance) {
            bestDistance = route.distance;
            target = { x: cheese.x, y: cheese.y };
          }
        }
        if (target) reason = 'investigar queso';
      }

      if (!target) {
        return makeAction(setup, 'STAY', { look: sweepDirection(obs.turn) }, 'gato: barrido de visión');
      }

      const route = routeToPoint(tree, target);
      if (!route) {
        return makeAction(setup, 'STAY', { look: directionToward(obs.you, target, obs.you.facing) },
          `gato: ${reason}, ruta bloqueada`);
      }

      const move = route.firstDir || 'STAY';
      const look = route.firstDir || directionToward(obs.you, target, obs.you.facing) || sweepDirection(obs.turn);
      let sprint = false;
      // Sprint solo persiguiendo un objetivo visto y en un tramo recto que ahorra un turno.
      if (mouseVisible && isNumber(obs.you.stamina) && obs.you.stamina >= 3 && route.path.length >= 2) {
        const firstDirection = directionBetween(startId, route.path[0]);
        const secondDirection = directionBetween(route.path[0], route.path[1]);
        sprint = firstDirection !== null && firstDirection === secondDirection;
      }
      const fields = { look };
      if (sprint) fields.sprint = true;
      return makeAction(setup, move, fields,
        `gato: ${reason}; ${sprint ? 'sprint recto' : 'avance normal'}`);
    };
  }

  if (role === 'mouse') {
    const memory = { lastCat: null, lastCatTurn: -1, previousBell: null };

    function closestCheese(tree, cheeses) {
      let best = null;
      if (!Array.isArray(cheeses)) return null;
      for (const cheese of cheeses) {
        if (!isCoordinate(cheese)) continue;
        const route = routeToPoint(tree, cheese);
        if (route && (!best || route.distance < best.route.distance)) {
          best = { point: { x: cheese.x, y: cheese.y }, route };
        }
      }
      return best;
    }

    function closestHole(tree, catPosition) {
      let best = null;
      for (let i = 0; i < map.holes.length; i++) {
        const route = routeToHole(tree, i);
        if (!route) continue;
        const hole = validHole(i);
        const danger = catPosition ? Math.max(0, 4 - manhattan(hole.entrance, catPosition)) : 0;
        const score = route.distance + danger * 2;
        if (!best || score < best.score) best = { route, score, hole: i };
      }
      return best;
    }

    function distanceFromPointToCheese(point, cheeses) {
      const start = nodeId(point.x, point.y);
      const tree = buildTree(start);
      const result = closestCheese(tree, cheeses);
      return result ? result.route.distance : Infinity;
    }

    function tunnelChoice(currentHole, obs, threat, urgent) {
      const current = validHole(currentHole);
      if (!current) return null;
      const currentExitDistance = distanceFromPointToCheese(current.entrance, obs.cheese);
      let best = null;
      for (let i = 0; i < map.holes.length; i++) {
        if (i === currentHole) continue;
        const destination = validHole(i);
        if (!destination) continue;
        const cheeseDistance = distanceFromPointToCheese(destination.entrance, obs.cheese);
        const catDistance = threat ? manhattan(destination.entrance, threat) : 0;
        const holeDistance = manhattan(current.entrance, destination.entrance);
        const routeCost = Number.isFinite(cheeseDistance) ? cheeseDistance : map.width * map.height;
        const safeBonus = threat ? Math.min(8, catDistance) * 2 :
          (urgent ? Math.min(8, holeDistance) * 2 : 0);
        const score = routeCost + 2 - safeBonus;
        if (!best || score < best.score) {
          best = { hole: i, score, cheeseDistance, catDistance, holeDistance };
        }
      }

      if (!best) return null;
      const isEscape = threat ? best.catDistance >= 4 : !!urgent && best.holeDistance >= 4;
      const isShortcut = Number.isFinite(currentExitDistance) &&
        best.cheeseDistance + 3 <= currentExitDistance;
      const isThreatened = threat ? manhattan(current.entrance, threat) <= 3 : !!urgent;
      return isEscape && isThreatened || isShortcut ? best.hole : null;
    }

    function chooseEscapeMove(startId, goal, goalHole, catPosition) {
      const candidates = [{ id: startId, dir: 'STAY' }];
      for (const next of adjacentIds(startId)) candidates.push({ id: next, dir: directionBetween(startId, next) });
      let best = null;
      for (const candidate of candidates) {
        const point = coordinates(candidate.id);
        const tree = buildTree(candidate.id);
        let goalRoute = goalHole !== null
          ? routeToHole(tree, goalHole)
          : routeToPoint(tree, goal);
        const goalDistance = goalRoute ? goalRoute.distance : map.width * map.height;
        const catDistance = manhattan(point, catPosition);
        const danger = Math.max(0, 4 - catDistance);
        const score = goalDistance + danger * 4 + (catDistance === 0 ? 24 : 0) -
          (candidate.dir === 'STAY' ? 0 : 0.1);
        if (!best || score < best.score) best = { dir: candidate.dir, score, catDistance };
      }
      return best ? best.dir : 'STAY';
    }

    function exitHoleAction(obs, holeIndex, threat, urgent) {
      const hole = validHole(holeIndex);
      if (!hole) return makeAction(setup, 'STAY', null, 'ratón: agujero inválido');
      const tunnel = tunnelChoice(holeIndex, obs, threat, urgent);
      if (tunnel !== null && (!obs.you.carrying || urgent)) {
        return makeAction(setup, 'STAY', { tunnel }, `ratón: túnel al agujero ${tunnel}`);
      }
      const holeId = nodeId(hole.x, hole.y);
      const entranceId = nodeId(hole.entrance.x, hole.entrance.y);
      return makeAction(setup, directionBetween(holeId, entranceId) || 'STAY', null,
        'ratón: salir del agujero');
    }

    return function act(obs) {
      if (!mapValid || !obs || !validPosition(obs.you)) {
        return makeAction(setup, 'STAY', null, 'ratón: observación o mapa inválido');
      }

      if (obs.you.tunneling) {
        return makeAction(setup, 'STAY', null, 'ratón: esperando el túnel');
      }
      if (obs.you.heavy === true) {
        return makeAction(setup, 'STAY', null, 'ratón: turno pesado, esperar');
      }

      const catPosition = obs.cat && validPosition(obs.cat)
        ? { x: obs.cat.x, y: obs.cat.y }
        : null;
      if (catPosition) {
        memory.lastCat = catPosition;
        memory.lastCatTurn = Number.isInteger(obs.turn) ? obs.turn : memory.lastCatTurn;
      }
      const previousBell = memory.previousBell;
      const threatPosition = catPosition ||
        (memory.lastCat && Number.isInteger(obs.turn) && obs.turn - memory.lastCatTurn <= 4
          ? memory.lastCat
          : null);
      const bellUrgent = isNumber(obs.bell) &&
        (obs.bell <= 4 || (obs.bellLoud === true) ||
         (isNumber(previousBell) && previousBell - obs.bell >= 1));
      memory.previousBell = isNumber(obs.bell) ? obs.bell : null;
      const urgent = !!catPosition && manhattan(obs.you, catPosition) <= 3 || bellUrgent;

      if (Number.isInteger(obs.you.inHole) && obs.you.inHole >= 0) {
        return exitHoleAction(obs, obs.you.inHole, threatPosition, urgent);
      }

      const startId = nodeId(obs.you.x, obs.you.y);
      const tree = buildTree(startId);
      const cheeseChoice = closestCheese(tree, obs.cheese);
      const holeChoice = closestHole(tree, threatPosition);

      if (obs.you.carrying === true) {
        if (!holeChoice) return makeAction(setup, 'STAY', null, 'ratón: no hay agujero accesible');
        let move = holeChoice.route.firstDir || 'STAY';
        if (catPosition && manhattan(obs.you, catPosition) <= 3) {
          move = chooseEscapeMove(startId, null, holeChoice.hole, catPosition);
        }
        return makeAction(setup, move, null, `ratón: llevar queso al agujero ${holeChoice.hole}`);
      }

      if (urgent && holeChoice) {
        let move = holeChoice.route.firstDir || 'STAY';
        if (catPosition && manhattan(obs.you, catPosition) <= 3) {
          move = chooseEscapeMove(startId, null, holeChoice.hole, catPosition);
        }
        return makeAction(setup, move, null, 'ratón: refugiarse por peligro cercano');
      }

      if (cheeseChoice) {
        let move = cheeseChoice.route.firstDir || 'STAY';
        if (catPosition && manhattan(obs.you, catPosition) <= 3) {
          move = chooseEscapeMove(startId, cheeseChoice.point, null, catPosition);
        }
        return makeAction(setup, move, null, `ratón: buscar queso (${cheeseChoice.route.distance})`);
      }

      if (holeChoice) {
        return makeAction(setup, holeChoice.route.firstDir || 'STAY', null, 'ratón: explorar cerca de un agujero');
      }
      return makeAction(setup, 'STAY', null, 'ratón: no hay objetivo accesible');
    };
  }

  return function act() {
    return makeAction(setup, 'STAY', null, 'rol inválido');
  };
}
