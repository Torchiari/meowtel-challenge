// Behavioral tests and a partial synthetic benchmark for bot-v3.4.js.
// The downloaded JSONL files provide real maps and start states; this test file
// is not the official game engine and the benchmark must not be read as a match.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

function loadBot(file) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  const sandbox = { module: { exports: {} }, performance, Date };
  vm.runInNewContext(`${source}\nmodule.exports = { createBot };`, sandbox, {
    filename: file,
  });
  return sandbox.module.exports.createBot;
}

const createBot34 = loadBot("bot-v3.4.js");
const createBot33 = loadBot("bot-v3.4.js");

const RULES = {
  maxTurns: 400,
  catchPoints: 3,
  cheesePoints: 3,
  hidingTaxEvery: 15,
  botTimeMs: 50,
  gameTimeMs: 5000,
  initTimeMs: 500,
  debugMaxChars: 200,
  debugMaxTiles: 400,
};

const MOVES = ["N", "E", "S", "W", "STAY"];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

function makeMap(
  width = 11,
  height = 9,
  holeSpecs = [
    { x: 3, y: 2, entrance: { x: 3, y: 3 } },
    { x: 7, y: 6, entrance: { x: 7, y: 5 } },
  ],
) {
  const rows = [];

  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      row +=
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "#" : ".";
    }
    rows.push(row);
  }

  for (const h of holeSpecs) {
    rows[h.y] = rows[h.y].slice(0, h.x) + "H" + rows[h.y].slice(h.x + 1);
  }

  return { width, height, rows, holes: holeSpecs };
}

function setup(role, map) {
  return { role, map, rules: { ...RULES } };
}

function mouseObs(map, turn, x, y, extra = {}) {
  return {
    turn,
    maxTurns: 400,
    role: "mouse",
    score: { cat: 0, mouse: 0 },
    you: {
      x,
      y,
      carrying: false,
      inHole: null,
      tunneling: null,
      heavy: false,
    },
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
    role: "cat",
    score: { cat: 0, mouse: 0 },
    you: { x, y, facing: "E", stamina: 22 },
    mouse: null,
    visible: [],
    scent: [],
    cheese: [],
    events: [],
    ...extra,
  };
}

function getAction(value) {
  return typeof value === "string" ? { move: value } : value;
}

function assertAction(value, obs, map) {
  const a = getAction(value);

  assert.ok(
    a && MOVES.includes(a.move),
    `invalid action: ${JSON.stringify(value)}`,
  );

  if (a.sprint !== undefined) {
    assert.equal(typeof a.sprint, "boolean");
  }

  if (a.look !== undefined) {
    assert.ok(["N", "E", "S", "W"].includes(a.look));
  }

  if (a.tunnel !== undefined) {
    assert.equal(obs.role, "mouse");
    assert.ok(Number.isInteger(obs.you.inHole) && obs.you.inHole >= 0);
    assert.ok(
      Number.isInteger(a.tunnel) &&
        a.tunnel >= 0 &&
        a.tunnel < map.holes.length,
    );
    assert.notEqual(a.tunnel, obs.you.inHole);
  }

  if (a.drop !== undefined) {
    assert.equal(obs.role, "mouse");
    assert.equal(a.drop, true);
    assert.equal(obs.you.carrying, true);
    assert.equal(obs.you.inHole, null);
  }

  if (a.debug !== undefined) {
    assert.equal(typeof a.debug, "string");
  }

  return a;
}

function movePosition(map, x, y, value, role) {
  const a = getAction(value);
  const delta = DELTA[a.move];
  let p = { x, y };

  if (!delta) return p;

  const count = role === "cat" && a.sprint === true ? 2 : 1;

  for (let i = 0; i < count; i++) {
    const nx = p.x + delta[0];
    const ny = p.y + delta[1];

    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) break;

    const tile = map.rows[ny][nx];

    if (tile === "." || tile === "T" || (role === "mouse" && tile === "H")) {
      p = { x: nx, y: ny };
    } else {
      break;
    }
  }

  return p;
}

function shortestFirst(map, start, target) {
  const queue = [start];
  const dist = new Map([[`${start.x},${start.y}`, 0]]);
  const first = new Map();
  const key = (p) => `${p.x},${p.y}`;

  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const pk = key(p);

    if (p.x === target.x && p.y === target.y) {
      return first.get(pk) || null;
    }

    for (const move of ["N", "E", "S", "W"]) {
      const [dx, dy] = DELTA[move];
      const nx = p.x + dx;
      const ny = p.y + dy;

      if (
        nx < 0 ||
        ny < 0 ||
        nx >= map.width ||
        ny >= map.height ||
        ![".", "T"].includes(map.rows[ny][nx])
      ) {
        continue;
      }

      const np = { x: nx, y: ny };
      const nk = key(np);

      if (dist.has(nk)) continue;

      dist.set(nk, dist.get(pk) + 1);
      first.set(nk, pk === key(start) ? move : first.get(pk));
      queue.push(np);
    }
  }

  return null;
}

function test(name, callback) {
  callback();
  process.stdout.write(`PASS ${name}\n`);
}

const openMap = makeMap();

test("ratón: gato lejos, salir del agujero y llegar al queso", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));

  let pos = { x: 3, y: 2 };
  let carrying = false;
  let inHole = 0;
  let picked = false;

  for (let turn = 1; turn <= 12; turn++) {
    const obs = mouseObs(map, turn, pos.x, pos.y, {
      you: {
        x: pos.x,
        y: pos.y,
        carrying,
        inHole,
        tunneling: null,
        heavy: false,
      },
      cheese: [[5, 3]],
    });

    const a = assertAction(act(obs), obs, map);

    if (turn === 1) {
      assert.equal(a.move, "S");
      assert.equal(a.tunnel, undefined);
    }

    if (inHole !== null) {
      if (DELTA[a.move]) {
        pos = movePosition(map, pos.x, pos.y, a, "mouse");
        inHole = null;
      }
    } else {
      pos = movePosition(map, pos.x, pos.y, a, "mouse");

      if (pos.x === 5 && pos.y === 3) {
        picked = true;
        carrying = true;
      }
    }

    if (picked) break;
  }

  assert.equal(
    picked,
    true,
    "must find the cheese promptly after leaving a safe hole",
  );
});

test("ratón: no salir a una entrada ocupada por el gato", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));

  const obs = mouseObs(map, 1, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    cat: { x: 3, y: 3, facing: "N", stamina: 8 },
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "STAY");
  assert.equal(a.tunnel, undefined);
});

test("ratón: reevaluar y salir cuando el gato se aleja", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));

  const first = mouseObs(map, 1, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    cat: { x: 3, y: 3, facing: "N", stamina: 8 },
    bell: 2,
  });

  assert.equal(assertAction(act(first), first, map).move, "STAY");

  const away = mouseObs(map, 2, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    bell: 9,
  });

  assert.equal(assertAction(act(away), away, map).move, "S");
});

test("ratón: la última posición antigua no se trata como posición actual", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));

  const seen = mouseObs(map, 1, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    cat: { x: 3, y: 3, facing: "N", stamina: 8 },
    bell: 2,
  });

  assert.equal(assertAction(act(seen), seen, map).move, "STAY");

  const stale = mouseObs(map, 10, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    bell: null,
  });

  assert.equal(assertAction(act(stale), stale, map).move, "S");
});

test("ratón con queso: elegir el agujero de menor distancia transitable", () => {
  const map = makeMap(11, 9, [
    { x: 2, y: 2, entrance: { x: 2, y: 3 } },
    { x: 8, y: 6, entrance: { x: 8, y: 5 } },
  ]);

  const act = createBot34(setup("mouse", map));
  const start = { x: 5, y: 4 };

  const obs = mouseObs(map, 1, start.x, start.y, {
    you: {
      x: start.x,
      y: start.y,
      carrying: true,
      inHole: null,
      tunneling: null,
      heavy: false,
    },
  });

  const a = assertAction(act(obs), obs, map);

  const d0 = shortestFirst(map, start, map.holes[0].entrance);
  const d1 = shortestFirst(map, start, map.holes[1].entrance);

  const expected = shortestFirst(
    map,
    start,
    d0 &&
      (!d1 ||
        Math.abs(start.x - 2) + Math.abs(start.y - 3) <=
          Math.abs(start.x - 8) + Math.abs(start.y - 5))
      ? map.holes[0].entrance
      : map.holes[1].entrance,
  );

  assert.equal(a.move, expected);
  assert.ok(a.debug.includes("entregar"));
});

test("ratón sin queso: mantener exploración activa sin objetivo visible", () => {
  const map = makeMap(13, 9, []);
  const act = createBot34(setup("mouse", map));

  let pos = { x: 6, y: 4 };
  const visited = new Set();

  for (let turn = 1; turn <= 35; turn++) {
    visited.add(`${pos.x},${pos.y}`);

    const obs = mouseObs(map, turn, pos.x, pos.y);
    const a = assertAction(act(obs), obs, map);

    assert.notEqual(
      a.move,
      "STAY",
      `exploration should make progress at turn ${turn}`,
    );

    pos = movePosition(map, pos.x, pos.y, a, "mouse");
  }

  assert.ok(
    visited.size >= 15,
    `exploration covered only ${visited.size} tiles`,
  );
});

test("ratón: usar túnel para escapar del bloqueo, no por ubicación desconocida", () => {
  const map = makeMap();

  const blocked = createBot34(setup("mouse", map));

  const obs = mouseObs(map, 1, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    cat: { x: 3, y: 3, facing: "N", stamina: 8 },
    bell: 1,
  });

  const escape = assertAction(blocked(obs), obs, map);

  assert.equal(escape.move, "STAY");
  assert.equal(escape.tunnel, 1);

  const quiet = createBot34(setup("mouse", map));

  const quietObs = mouseObs(map, 1, 3, 2, {
    you: {
      x: 3,
      y: 2,
      carrying: false,
      inHole: 0,
      tunneling: null,
      heavy: false,
    },
    cheese: [],
  });

  const leave = assertAction(quiet(quietObs), quietObs, map);

  assert.equal(leave.move, "S");
  assert.equal(leave.tunnel, undefined);
});

test("ratón: recuperar queso soltado sin entrar en ciclo", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));
  const cheese = [[5, 4]];

  const firstObs = mouseObs(map, 1, 5, 4, {
    cheese,
    events: [{ type: "dropped", x: 5, y: 4 }],
  });

  const first = assertAction(act(firstObs), firstObs, map);

  assert.ok(DELTA[first.move]);

  const off = movePosition(map, 5, 4, first, "mouse");

  const secondObs = mouseObs(map, 2, off.x, off.y, { cheese });
  const second = assertAction(act(secondObs), secondObs, map);

  assert.equal(
    second.move,
    first.move === "N"
      ? "S"
      : first.move === "S"
        ? "N"
        : first.move === "E"
          ? "W"
          : "E",
  );

  const returned = movePosition(map, off.x, off.y, second, "mouse");

  assert.deepEqual(returned, { x: 5, y: 4 });

  const thirdObs = mouseObs(map, 3, 5, 4, {
    cheese: [[5, 4]],
  });

  const third = assertAction(act(thirdObs), thirdObs, map);

  assert.ok(!third.debug.includes("salir una vez"));
});

test("ratón: no acumular STAY en agujero cuando no hay amenaza inmediata", () => {
  const map = makeMap(9, 7, [{ x: 3, y: 2, entrance: { x: 3, y: 3 } }]);

  const act = createBot34(setup("mouse", map));
  let stayHidden = 0;

  for (let turn = 1; turn <= 40; turn++) {
    const obs = mouseObs(map, turn, 3, 2, {
      you: {
        x: 3,
        y: 2,
        carrying: false,
        inHole: 0,
        tunneling: null,
        heavy: false,
      },
      bell: null,
    });

    const a = assertAction(act(obs), obs, map);

    if (turn === 1) assert.equal(a.move, "S");
    if (a.move === "STAY") stayHidden++;
  }

  assert.ok(stayHidden <= 1, `safe hole produced ${stayHidden} STAY actions`);
});

test("gato visible sin queso: perseguir por ruta BFS", () => {
  const map = makeMap(11, 9, []);
  const act = createBot34(setup("cat", map));

  const obs = catObs(1, 1, 4, {
    mouse: { x: 5, y: 4, carrying: false },
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "E");
});

test("gato visible con queso: anticipar ruta de entrega", () => {
  const map = makeMap(11, 9, [{ x: 7, y: 2, entrance: { x: 7, y: 3 } }]);

  const act = createBot34(setup("cat", map));

  const obs = catObs(1, 5, 4, {
    mouse: { x: 4, y: 3, carrying: true },
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(
    a.move,
    shortestFirst(map, { x: 5, y: 4 }, map.holes[0].entrance),
  );

  assert.ok(a.debug.includes("intercept"));
});

test("gato ya en la salida: bloquear en vez de perseguir fuera de ruta", () => {
  const map = makeMap(11, 9, [{ x: 7, y: 2, entrance: { x: 7, y: 3 } }]);

  const act = createBot34(setup("cat", map));

  const obs = catObs(1, 7, 3, {
    mouse: { x: 4, y: 3, carrying: true },
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "STAY");
  assert.ok(a.debug.includes("bloquear"));
});

test("gato: conservar señal de entrega hasta poder investigarla", () => {
  const map = makeMap(11, 9, [{ x: 7, y: 6, entrance: { x: 7, y: 5 } }]);

  const act = createBot34(setup("cat", map));
  let result;

  for (let turn = 1; turn <= 7; turn++) {
    const obs = catObs(turn, 1, 1, {
      events: turn === 1 ? [{ type: "delivered", hole: 0 }] : [],
    });

    result = assertAction(act(obs), obs, map);
  }

  assert.ok(
    result.debug.includes("agujero"),
    `signal expired before investigation: ${result.debug}`,
  );
});

test("gato: seguir rastro reciente hacia su origen", () => {
  const map = makeMap(11, 9, []);
  const act = createBot34(setup("cat", map));

  const obs = catObs(1, 1, 4, {
    scent: [
      [5, 4, 0.95],
      [4, 4, 0.78],
    ],
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "E");
  assert.ok(a.debug.includes("rastro"));
});

test("gato: evitar inversión inmediata con rastros de intensidad alternante", () => {
  const map = makeMap(13, 9, []);
  const act = createBot34(setup("cat", map));

  let pos = { x: 2, y: 4 };
  let previous = null;
  let reversals = 0;

  for (let turn = 1; turn <= 20; turn++) {
    const obs = catObs(turn, pos.x, pos.y, {
      scent: [
        [7, 4, turn % 2 ? 0.95 : 0.9],
        [6, 4, turn % 2 ? 0.9 : 0.95],
        [5, 4, 0.82],
      ],
    });

    const a = assertAction(act(obs), obs, map);

    if (previous && pos.x === previous.x && pos.y === previous.y) {
      reversals++;
    }

    previous = { ...pos };
    pos = movePosition(map, pos.x, pos.y, a, "cat");
  }

  assert.ok(reversals <= 2, `scent target oscillated ${reversals} times`);
});

test("gato patrullando sin evidencia: cubrir mapa sin ciclo de dos casillas", () => {
  const map = makeMap(11, 9, []);
  const act = createBot34(setup("cat", map));

  let pos = { x: 5, y: 4 };
  let prev = null;
  let prev2 = null;
  let twoTileCycles = 0;

  for (let turn = 1; turn <= 80; turn++) {
    const obs = catObs(turn, pos.x, pos.y);
    const a = assertAction(act(obs), obs, map);

    const next = movePosition(map, pos.x, pos.y, a, "cat");

    if (
      prev2 &&
      next.x === prev2.x &&
      next.y === prev2.y &&
      (next.x !== pos.x || next.y !== pos.y)
    ) {
      twoTileCycles++;
    }

    prev2 = prev;
    prev = pos;
    pos = next;
  }

  assert.equal(twoTileCycles, 0);
});

test("gato: sprint en persecución recta cuando adelanta la captura", () => {
  const map = makeMap(11, 9, []);
  const act = createBot34(setup("cat", map));

  const obs = catObs(1, 1, 4, {
    mouse: { x: 3, y: 4, carrying: true },
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "E");
  assert.equal(a.sprint, true);
});

test("gato: mantener una emboscada en el punto donde consiguió una captura", () => {
  const map = makeMap(11, 9, [{ x: 1, y: 1, entrance: { x: 1, y: 2 } }]);

  const act = createBot34(setup("cat", map));

  const obs = catObs(20, 5, 4, {
    events: [{ type: "caught", x: 5, y: 4, respawnHole: 0 }],
  });

  const a = assertAction(act(obs), obs, map);

  assert.equal(a.move, "STAY");
  assert.ok(["N", "E", "S", "W"].includes(a.look));
  assert.ok(a.debug.includes("emboscada"));
});

test("ratón: evitar la zona donde fue capturado y rodear al gato", () => {
  const map = makeMap(11, 9, [{ x: 1, y: 1, entrance: { x: 1, y: 2 } }]);

  const act = createBot34(setup("mouse", map));

  const obs = mouseObs(map, 20, 4, 4, {
    cheese: [[6, 4]],
    events: [{ type: "caught", x: 5, y: 4, respawnHole: 0 }],
  });

  const a = assertAction(act(obs), obs, map);

  assert.notEqual(
    a.move,
    "E",
    "mouse should not step directly into the known capture tile",
  );
});
