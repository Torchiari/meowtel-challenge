// Synthetic tests for bot-v3.1.js. These checks are not the official game engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = fs.readFileSync(path.join(__dirname, 'bot-v3.1.js'), 'utf8');
const sandbox = { module: { exports: {} }, performance, Date };
vm.runInNewContext(`${source}\nmodule.exports = { createBot };`, sandbox, { filename: 'bot-v3.1.js' });
const { createBot } = sandbox.module.exports;

const MOVES = ['N', 'S', 'E', 'W', 'STAY'];
const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const RULES = {
  maxTurns: 400,
  catchPoints: 3,
  cheesePoints: 3,
  hidingTaxEvery: 15,
  botTimeMs: 50,
  gameTimeMs: 5000,
  initTimeMs: 500,
  debugMaxChars: 120,
  debugMaxTiles: 20,
};

function makeMap(width = 11, height = 9, holeSpecs = [
  { x: 3, y: 2, entrance: { x: 3, y: 3 } },
  { x: 7, y: 6, entrance: { x: 7, y: 5 } },
]) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      row += x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.';
    }
    rows.push(row);
  }
  for (const hole of holeSpecs) {
    rows[hole.y] = rows[hole.y].slice(0, hole.x) + 'H' + rows[hole.y].slice(hole.x + 1);
  }
  return { width, height, rows, holes: holeSpecs };
}

function setupFor(role, map = makeMap()) {
  return { role, map, rules: { ...RULES } };
}

function mouseObs(map, turn, x, y, extra = {}) {
  return {
    turn,
    maxTurns: 400,
    role: 'mouse',
    score: { cat: 0, mouse: 0 },
    you: { x, y, carrying: false, inHole: null, tunneling: null, heavy: false },
    cat: null,
    bell: null,
    bellLoud: false,
    visible: [],
    cheese: [],
    events: [],
    ...extra,
  };
}

function catObs(turn, x, y, extra = {}) {
  return {
    turn,
    maxTurns: 400,
    role: 'cat',
    score: { cat: 0, mouse: 0 },
    you: { x, y, facing: 'E', stamina: 20 },
    mouse: null,
    visible: [],
    scent: [],
    cheese: [],
    events: [],
    ...extra,
  };
}

function getAction(value) {
  return typeof value === 'string' ? { move: value } : value;
}

function assertAction(value, obs, map) {
  const a = getAction(value);
  assert.ok(a && MOVES.includes(a.move), `invalid move: ${JSON.stringify(value)}`);
  if (a.sprint !== undefined) assert.equal(typeof a.sprint, 'boolean');
  if (a.look !== undefined) assert.ok(['N', 'S', 'E', 'W'].includes(a.look));
  if (a.tunnel !== undefined) {
    assert.equal(obs.role, 'mouse');
    assert.ok(Number.isInteger(obs.you.inHole) && obs.you.inHole >= 0);
    assert.ok(Number.isInteger(a.tunnel) && a.tunnel >= 0 && a.tunnel < map.holes.length);
    assert.notEqual(a.tunnel, obs.you.inHole);
  }
  if (a.drop !== undefined) {
    assert.equal(obs.role, 'mouse');
    assert.equal(a.drop, true);
    assert.equal(obs.you.carrying, true);
    assert.equal(obs.you.inHole, null);
  }
  if (a.debug !== undefined) assert.equal(typeof a.debug, 'string');
  return a;
}

function movePosition(map, x, y, action, role) {
  const a = getAction(action);
  let result = { x, y };
  const delta = DELTA[a.move];
  if (!delta) return result;
  const count = role === 'cat' && a.sprint === true ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const nx = result.x + delta[0];
    const ny = result.y + delta[1];
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) break;
    const tile = map.rows[ny][nx];
    if (tile === '.' || tile === 'T' || (role === 'mouse' && tile === 'H')) result = { x: nx, y: ny };
    else break;
  }
  return result;
}

function test(name, callback) {
  callback();
  process.stdout.write(`PASS ${name}\n`);
}

const map = makeMap();

test('queso soltado debajo del ratón: salir y regresar una sola vez', () => {
  const act = createBot(setupFor('mouse', map));
  const cheese = [[5, 4]];
  const firstObs = mouseObs(map, 1, 5, 4, { cheese, events: [{ type: 'dropped', x: 5, y: 4 }] });
  const first = assertAction(act(firstObs), firstObs, map);
  assert.ok(DELTA[first.move], 'must step off the dropped cheese');
  const outside = movePosition(map, 5, 4, first, 'mouse');
  assert.notDeepEqual(outside, { x: 5, y: 4 });

  const secondObs = mouseObs(map, 2, outside.x, outside.y, { cheese });
  const second = assertAction(act(secondObs), secondObs, map);
  assert.equal(second.move, OPPOSITE[first.move], 'must return directly to the cheese');
  const returned = movePosition(map, outside.x, outside.y, second, 'mouse');
  assert.deepEqual(returned, { x: 5, y: 4 });

  const thirdObs = mouseObs(map, 3, 5, 4, { cheese });
  const third = assertAction(act(thirdObs), thirdObs, map);
  assert.ok(!third.debug.includes('salir una vez'), 'must not step off repeatedly after a failed pickup');
});

test('amenaza durante recuperación: escapar y conservar el objetivo', () => {
  const act = createBot(setupFor('mouse', map));
  const cheese = [[5, 4]];
  const firstObs = mouseObs(map, 1, 5, 4, {
    cheese,
    bell: 2,
    bellLoud: true,
    events: [{ type: 'dropped', x: 5, y: 4 }],
  });
  const first = assertAction(act(firstObs), firstObs, map);
  assert.ok(DELTA[first.move], `must leave the cheese tile to survive: ${JSON.stringify(first)}`);
  const pos = movePosition(map, 5, 4, first, 'mouse');
  const secondObs = mouseObs(map, 2, pos.x, pos.y, { cheese });
  const second = assertAction(act(secondObs), secondObs, map);
  const next = movePosition(map, pos.x, pos.y, second, 'mouse');
  assert.ok(Math.abs(next.x - 5) + Math.abs(next.y - 4) < Math.abs(pos.x - 5) + Math.abs(pos.y - 4),
    'after danger clears, resume recovery toward the dropped cheese');
});

test('recuperación de queso en casilla inicial sin movimientos disponibles', () => {
  const isolated = {
    width: 5,
    height: 5,
    rows: ['#####', '#####', '##.##', '#####', '#####'],
    holes: [],
  };
  const act = createBot(setupFor('mouse', isolated));
  const firstObs = mouseObs(isolated, 1, 2, 2, {
    cheese: [[2, 2]],
    events: [{ type: 'dropped', x: 2, y: 2 }],
  });
  const first = assertAction(act(firstObs), firstObs, isolated);
  assert.equal(first.move, 'STAY', 'there is no legal floor tile to step onto');
  assert.ok(!first.debug.includes('error interno'), first.debug);

  const secondObs = mouseObs(isolated, 2, 2, 2, { cheese: [[2, 2]] });
  const second = assertAction(act(secondObs), secondObs, isolated);
  assert.equal(second.move, 'STAY', 'unavailable recovery must not create a movement cycle');
  assert.ok(!second.debug.includes('error interno'), second.debug);
});

test('gato permanece bloqueando: ignorar waitLimit y comparar impuesto acumulado', () => {
  const oneHole = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);
  const act = createBot(setupFor('mouse', oneHole));
  for (let turn = 1; turn <= 52; turn++) {
    const obs = mouseObs(oneHole, turn, 3, 2, {
      you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
      cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
      bell: 1,
    });
    const a = assertAction(act(obs), obs, oneHole);
    assert.equal(a.move, 'STAY', `must not leave while projected hiding cost is below capture cost (turn ${turn})`);
    assert.equal(a.tunnel, undefined);
  }
  const accumulatedCost = mouseObs(oneHole, 53, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
    bell: 1,
  });
  assert.equal(assertAction(act(accumulatedCost), accumulatedCost, oneHole).move, 'S',
    'after enough projected hidden tax, compare the known catch cost and choose the less harmful action');
});

test('gato se aleja: la campana creciente termina despejando la salida', () => {
  const oneHole = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);
  const act = createBot(setupFor('mouse', oneHole));
  const firstObs = mouseObs(oneHole, 1, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
    bell: 2,
  });
  assert.equal(assertAction(act(firstObs), firstObs, oneHole).move, 'STAY');
  const secondObs = mouseObs(oneHole, 2, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    bell: 5,
  });
  assert.equal(assertAction(act(secondObs), secondObs, oneHole).move, 'STAY',
    'one increasing bell reading is not enough to erase the recent cat position');
  const thirdObs = mouseObs(oneHole, 3, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    bell: 9,
  });
  assert.equal(assertAction(act(thirdObs), thirdObs, oneHole).move, 'S',
    'a second strong increase lowers the recent threat enough to leave');
});

test('gato vuelve a bloquear: cancelar la salida tras una señal de alejamiento', () => {
  const oneHole = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);
  const act = createBot(setupFor('mouse', oneHole));
  const blocked = mouseObs(oneHole, 1, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
    bell: 2,
  });
  assert.equal(assertAction(act(blocked), blocked, oneHole).move, 'STAY');
  const movedAway = mouseObs(oneHole, 2, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    bell: 9,
  });
  assert.equal(assertAction(act(movedAway), movedAway, oneHole).move, 'STAY');
  const returned = mouseObs(oneHole, 3, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
    bell: 1,
  });
  assert.equal(assertAction(act(returned), returned, oneHole).move, 'STAY',
    'a newly visible cat on the entrance overrides the previous easing signal');
});

test('gato con sprint disponible alcanza la salida en dos casillas', () => {
  const oneHole = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);
  const act = createBot(setupFor('mouse', oneHole));
  for (let turn = 1; turn <= 9; turn++) {
    const obs = mouseObs(oneHole, turn, 3, 2, {
      you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
      cat: { x: 3, y: 5, facing: 'N', stamina: 10 },
    });
    const a = assertAction(act(obs), obs, oneHole);
    assert.equal(a.move, 'STAY', `must account for the clear sprint path on turn ${turn}`);
    if (turn === 9) assert.ok(a.debug.includes('salida bloqueada'), a.debug);
  }
});

test('agujero bloqueado con túnel alternativo: elegir otro agujero', () => {
  const act = createBot(setupFor('mouse', map));
  const obs = mouseObs(map, 1, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
    cat: { x: 3, y: 3, facing: 'N', stamina: 10 },
    bell: 1,
  });
  const a = assertAction(act(obs), obs, map);
  assert.equal(a.move, 'STAY');
  assert.equal(a.tunnel, 1);

  const unknownAct = createBot(setupFor('mouse', map));
  const unknownObs = mouseObs(map, 1, 3, 2, {
    you: { x: 3, y: 2, carrying: false, inHole: 0, tunneling: null, heavy: false },
  });
  const unknown = assertAction(unknownAct(unknownObs), unknownObs, map);
  assert.equal(unknown.tunnel, 1, 'unknown cat location must be treated as uncertain, not safe');
});

test('ratón con queso: completar una entrega en el agujero', () => {
  const act = createBot(setupFor('mouse', map));
  let pos = { x: 5, y: 4 };
  let delivered = false;
  for (let turn = 1; turn <= 12; turn++) {
    const obs = mouseObs(map, turn, pos.x, pos.y, {
      you: { x: pos.x, y: pos.y, carrying: true, inHole: null, tunneling: null, heavy: false },
    });
    const a = assertAction(act(obs), obs, map);
    const next = movePosition(map, pos.x, pos.y, a, 'mouse');
    if (map.rows[next.y][next.x] === 'H') {
      delivered = true;
      break;
    }
    pos = next;
  }
  assert.equal(delivered, true, 'must reach and enter a hole');
});

test('gato visible en línea recta: perseguir directamente', () => {
  const act = createBot(setupFor('cat', map));
  const obs = catObs(1, 1, 4, { mouse: { x: 4, y: 4, carrying: false } });
  const a = assertAction(act(obs), obs, map);
  assert.equal(a.move, 'E', JSON.stringify(a));
});

test('gato pierde visión tras dos desplazamientos: predicción moderada', () => {
  const act = createBot(setupFor('cat', map));
  let cat = { x: 1, y: 4 };
  const observations = [4, 5, 6];
  for (let i = 0; i < observations.length; i++) {
    const obs = catObs(i + 1, cat.x, cat.y, { mouse: { x: observations[i], y: 4, carrying: false } });
    const a = assertAction(act(obs), obs, map);
    assert.equal(a.move, 'E');
    cat = movePosition(map, cat.x, cat.y, a, 'cat');
  }
  const lost = catObs(4, cat.x, cat.y);
  const a = assertAction(act(lost), lost, map);
  assert.equal(a.move, 'E', 'should predict one open tile ahead after a stable track');
});

test('gato sigue olor reciente', () => {
  const act = createBot(setupFor('cat', map));
  const obs = catObs(1, 1, 4, { scent: [[5, 4, 0.95]] });
  const a = assertAction(act(obs), obs, map);
  assert.equal(a.move, 'E');
});

test('gato sin objetivo visible: patrullar y moverse', () => {
  const act = createBot(setupFor('cat', map));
  const obs = catObs(1, 5, 4);
  const a = assertAction(act(obs), obs, map);
  assert.ok(DELTA[a.move], 'must choose a patrol step instead of staying in place');
});

function benchmark400(role) {
  const largeMap = makeMap(100, 100, [
    { x: 10, y: 10, entrance: { x: 10, y: 11 } },
    { x: 88, y: 88, entrance: { x: 88, y: 87 } },
  ]);
  const setup = setupFor(role, largeMap);
  const initStart = performance.now();
  const act = createBot(setup);
  const initMs = performance.now() - initStart;
  let pos = { x: 50, y: 50 };
  const durations = [];
  let moves = 0;
  for (let turn = 1; turn <= 400; turn++) {
    const obs = role === 'cat'
      ? catObs(turn, pos.x, pos.y)
      : mouseObs(largeMap, turn, pos.x, pos.y);
    const start = performance.now();
    const value = act(obs);
    const elapsed = performance.now() - start;
    durations.push(elapsed);
    const a = assertAction(value, obs, largeMap);
    if (DELTA[a.move]) moves++;
    pos = movePosition(largeMap, pos.x, pos.y, a, role);
  }
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const maxMs = Math.max(...durations);
  assert.ok(moves > 350, `${role} must keep moving on an open synthetic map; got ${moves} moves`);
  assert.ok(maxMs < 50, `${role} max act time ${maxMs.toFixed(3)}ms exceeded 50ms`);
  assert.ok(totalMs < 5000, `${role} total act time ${totalMs.toFixed(3)}ms exceeded 5000ms`);
  return {
    role,
    initMs: Number(initMs.toFixed(3)),
    averageMs: Number((totalMs / durations.length).toFixed(4)),
    maxMs: Number(maxMs.toFixed(3)),
    totalMs: Number(totalMs.toFixed(3)),
    turns: durations.length,
    moves,
    map: `${largeMap.width}x${largeMap.height}`,
  };
}

const timing = [benchmark400('cat'), benchmark400('mouse')];
process.stdout.write(`PASS 400-call synthetic timing\n${JSON.stringify(timing, null, 2)}\n`);
process.stdout.write('Synthetic only: no official game engine or real match was available.\n');
