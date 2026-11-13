import { segmentIntersectT } from './utils.js';

export const TILE = 32;
const CORNER_TOLERANCE = 8; // px que se "empuja" al jugador para entrar en huecos
const RAY_STEP = 4;
const PATROL_MAX_TILES = 7;

// Leyenda: # pared · . suelo · D puerta · P jugador · X salida (activa al despejar el piso)
//   E enemigo melee · A enemigo armado (patrulla en el eje más largo)
//   V enemigo melee · W enemigo armado (patrulla vertical forzada → patrullas cruzadas)
//   B bate · G pistola · S escopeta · K cuchillo · T tubo · M subfusil
//   ? arma aleatoria: primero las de `guaranteed`, el resto sorteadas de `loot`
// Los enemigos armados llevan subfusil con probabilidad `smgChance` (si no, pistola).
// `par` = tiempo objetivo en segundos (bonus de tiempo y rango).
// `floor` = suelo por defecto (pasillos); `zones` = habitaciones [tipo, x0, y0, x1, y1] con su suelo
// (concrete, brokenTiles, wood, carpet, bathTiles, metal); `props` = muebles [tipo, x, y, ancho, alto]
// en casillas (sólidos: SOLID_PROPS; decorativos: DECOR_PROPS). Los pisos se diseñan como edificio:
// pasillos de 2 casillas que conectan salas cerradas por puertas.
export const LEVELS = [
  {
    name: 'PISO 1 · RECEPCIÓN',
    floor: 'concrete',
    loot: ['bat', 'knife', 'gun', 'pipe'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.15,
    par: 50,
    rows: [
      '########################################',
      '#............#...........#......#......#',
      '#............#...........#......#......#',
      '#..P.........D...........#....?.#......#',
      '#............#...........#......#...A..#',
      '#X..B........#...E....?..#......#......#',
      '#............#...........#......#......#',
      '######D############D########D######D####',
      '#......................................#',
      '#.....................E................#',
      '######D############D############D#######',
      '#............#............#............#',
      '#............#............#............#',
      '#............#............#............#',
      '#............#............D............#',
      '#.......E....#............#......A.....#',
      '#............#..?.........#............#',
      '#............#............#............#',
      '########################################',
    ],
    zones: [
      ['brokenTiles', 1, 1, 12, 6], ['wood', 14, 1, 24, 6], ['bathTiles', 26, 1, 31, 6],
      ['metal', 33, 1, 38, 6], ['carpet', 1, 11, 12, 17], ['wood', 14, 11, 25, 17],
      ['metal', 27, 11, 38, 17],
    ],
    props: [
      ['counter', 8, 3, 3, 1], ['sofa', 12, 4, 1, 2], ['rug', 3, 1, 3, 2], ['debris', 10, 6, 1, 1],
      ['trash', 1, 1, 1, 1], ['desk', 15, 2, 2, 1], ['deskFlipped', 21, 3, 2, 1],
      ['cabinet', 24, 1, 1, 1], ['cabinet', 23, 1, 1, 1], ['papers', 17, 4, 1, 1],
      ['papers', 20, 2, 1, 1], ['toilet', 31, 1, 1, 1], ['toilet', 31, 5, 1, 1],
      ['sink', 26, 1, 1, 1], ['sink', 27, 1, 1, 1], ['stain', 28, 5, 1, 1], ['trash', 26, 6, 1, 1],
      ['crates', 33, 1, 1, 1], ['crates', 34, 1, 1, 1], ['crates', 33, 2, 1, 1],
      ['barrel', 38, 1, 1, 1], ['barrel', 38, 2, 1, 1], ['shelf', 38, 4, 1, 2],
      ['barrel', 12, 8, 1, 1], ['crates', 25, 9, 1, 1], ['debris', 8, 9, 1, 1],
      ['trash', 38, 9, 1, 1], ['stain', 30, 8, 1, 1], ['sofa', 2, 12, 2, 1], ['sofa', 2, 16, 2, 1],
      ['cashTable', 3, 14, 1, 1], ['tv', 10, 12, 1, 1], ['rug', 5, 13, 3, 2],
      ['trash', 12, 17, 1, 1], ['desk', 18, 13, 3, 1], ['cashTable', 23, 12, 2, 1],
      ['cabinet', 14, 11, 1, 1], ['cabinet', 15, 11, 1, 1], ['shelf', 24, 17, 2, 1],
      ['rug', 17, 14, 4, 2], ['tv', 34, 11, 1, 1], ['tv', 35, 11, 1, 1], ['tv', 36, 11, 1, 1],
      ['desk', 34, 12, 3, 1], ['crates', 38, 17, 1, 1], ['crates', 37, 17, 1, 1],
      ['barrel', 27, 17, 1, 1], ['papers', 30, 13, 1, 1],
    ],
  },
  {
    name: 'PISO 2 · OFICINAS',
    floor: 'concrete',
    loot: ['pipe', 'knife', 'gun', 'smg', 'shotgun'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.35,
    par: 75,
    rows: [
      '############################################',
      '#X........#.........#..#........#..........#',
      '#.........#.........#..#........#..........#',
      '#..P......#.........#..#....?...#.....A....#',
      '#.........D.........D..D........#..........#',
      '#.........#..E......#V.#........#..........#',
      '#......B..#.........#..#........#.?........#',
      '#.........#.........#..#........#..........#',
      '#####D#########D#####..####D#########D######',
      '#..........................................#',
      '#.........................E................#',
      '#####D#########D#####..####D#########D######',
      '#.........#.........#..#........#..........#',
      '#.........#.......?.#..#........#..........#',
      '#.........#.........#..#........#.......W..#',
      '#.........#.........D..#........D..........#',
      '#.........#.........#..D........#..........#',
      '#..E......#..E......#..#.....A..#..........#',
      '#.........#.........#..#........#..?.......#',
      '#.........#.........#..#........#..........#',
      '############################################',
    ],
    zones: [
      ['wood', 1, 1, 9, 7], ['carpet', 11, 1, 19, 7], ['bathTiles', 24, 1, 31, 7],
      ['wood', 33, 1, 42, 7], ['metal', 1, 12, 9, 19], ['carpet', 11, 12, 19, 19],
      ['metal', 24, 12, 31, 19], ['brokenTiles', 33, 12, 42, 19],
    ],
    props: [
      ['desk', 6, 2, 2, 1], ['cabinet', 9, 1, 1, 1], ['shelf', 1, 5, 1, 2], ['rug', 3, 5, 3, 2],
      ['desk', 12, 2, 2, 1], ['desk', 16, 2, 2, 1], ['deskFlipped', 12, 7, 2, 1],
      ['desk', 17, 7, 2, 1], ['papers', 15, 3, 1, 1], ['papers', 18, 5, 1, 1],
      ['counter', 25, 1, 4, 1], ['sink', 30, 1, 1, 1], ['cashTable', 25, 5, 1, 1],
      ['trash', 31, 7, 1, 1], ['stain', 29, 5, 1, 1], ['desk', 37, 5, 3, 1],
      ['cashTable', 40, 1, 2, 1], ['sofa', 42, 4, 1, 2], ['shelf', 33, 1, 2, 1],
      ['rug', 36, 4, 5, 3], ['shelf', 5, 13, 3, 1], ['shelf', 5, 15, 3, 1], ['cabinet', 1, 12, 1, 1],
      ['cabinet', 2, 12, 1, 1], ['crates', 9, 19, 1, 1], ['crates', 8, 19, 1, 1],
      ['papers', 7, 18, 1, 1], ['desk', 13, 14, 4, 1], ['tv', 19, 19, 1, 1], ['rug', 12, 13, 6, 3],
      ['shelf', 25, 13, 1, 2], ['shelf', 28, 13, 1, 2], ['shelf', 31, 12, 1, 2],
      ['barrel', 31, 19, 1, 1], ['sofa', 34, 13, 2, 1], ['sofa', 42, 16, 1, 2],
      ['cashTable', 36, 15, 1, 1], ['tv', 38, 12, 1, 1], ['debris', 39, 18, 1, 1],
      ['trash', 33, 19, 1, 1], ['barrel', 1, 9, 1, 1], ['crates', 42, 10, 1, 1],
      ['debris', 12, 10, 1, 1], ['stain', 33, 9, 1, 1], ['trash', 22, 19, 1, 1],
      ['debris', 21, 2, 1, 1],
    ],
  },
  {
    name: 'PISO 3 · ÁTICO',
    floor: 'concrete',
    loot: ['smg', 'shotgun', 'gun', 'pipe', 'knife'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.6,
    par: 100,
    rows: [
      '################################################',
      '#..........#..#..................#..#..........#',
      '#........?.#..#..................#..#..........#',
      '#..........D..#..................#..D..........#',
      '#..........#..#.....A............#..#..........#',
      '#...A......#..D..................D..#.....A....#',
      '#..........#..#..................#.V#..........#',
      '############..#..................#..############',
      '#..........#V.#...............?..#..#..........#',
      '#...E......#..#..................#..#.....E....#',
      '#..........D..#.........W........#..D..........#',
      '#..........#..#..................#..#........?.#',
      '#........?.#..#..................#..#..........#',
      '############..#..................#..############',
      '#..........#..#..................#..#..........#',
      '#..........#..D..................D..#..........#',
      '#..P.......D..#...A..............#..D..........#',
      '#..........#..#............E.....#..#.....A....#',
      '#.......B..#..#..................#..#..........#',
      '#X.........#..#..................#..#..........#',
      '################################################',
    ],
    zones: [
      ['metal', 1, 1, 10, 6], ['bathTiles', 1, 8, 10, 12], ['wood', 1, 14, 10, 19],
      ['carpet', 15, 1, 32, 19], ['metal', 37, 1, 46, 6], ['bathTiles', 37, 8, 46, 12],
      ['brokenTiles', 37, 14, 46, 19],
    ],
    props: [
      ['cashTable', 6, 1, 2, 1], ['crates', 1, 1, 1, 1], ['crates', 2, 1, 1, 1],
      ['shelf', 1, 3, 1, 2], ['toilet', 1, 8, 1, 1], ['toilet', 1, 11, 1, 1], ['sink', 6, 12, 1, 1],
      ['sink', 7, 12, 1, 1], ['stain', 3, 11, 1, 1], ['bed', 5, 14, 2, 2], ['tv', 1, 14, 1, 1],
      ['rug', 2, 17, 3, 2], ['trash', 10, 19, 1, 1], ['counter', 22, 1, 6, 1],
      ['cardTable', 18, 8, 2, 2], ['cardTable', 27, 4, 2, 2], ['cardTable', 28, 12, 2, 2],
      ['sofa', 16, 12, 2, 1], ['sofa', 30, 17, 2, 1], ['cashTable', 20, 18, 2, 1],
      ['tv', 32, 1, 1, 1], ['rug', 21, 6, 6, 3], ['papers', 26, 15, 1, 1], ['tv', 40, 1, 1, 1],
      ['tv', 41, 1, 1, 1], ['tv', 42, 1, 1, 1], ['desk', 40, 2, 3, 1], ['cabinet', 46, 1, 1, 1],
      ['counter', 40, 12, 4, 1], ['sink', 46, 8, 1, 1], ['trash', 37, 12, 1, 1],
      ['crates', 37, 19, 1, 1], ['crates', 38, 19, 1, 1], ['crates', 46, 14, 1, 1],
      ['crates', 46, 15, 1, 1], ['barrel', 44, 19, 1, 1], ['barrel', 45, 19, 1, 1],
      ['shelf', 39, 14, 3, 1], ['debris', 40, 17, 1, 1], ['crates', 13, 19, 1, 1],
      ['barrel', 34, 19, 1, 1], ['debris', 13, 1, 1, 1], ['stain', 35, 12, 1, 1],
      ['trash', 12, 19, 1, 1],
    ],
  },
];

// Muebles sólidos: bloquean movimiento, balas y visión como una pared (sirven de cobertura) y la
// IA los rodea con el pathfinding. El resto de tipos de `props` son decoración de suelo.
// El arte de cada tipo está en decor.js.
export const SOLID_PROPS = new Set(['desk', 'deskFlipped', 'counter', 'sofa', 'cashTable', 'shelf', 'tv',
  'cabinet', 'crates', 'barrel', 'toilet', 'sink', 'cardTable', 'bed']);
export const DECOR_PROPS = new Set(['rug', 'debris', 'trash', 'stain', 'papers']);
// Celdas de la cuadrícula: 0 suelo · 1 pared estructural · 2 mueble sólido.
const CELL_WALL = 1;
const CELL_PROP = 2;

const PICKUP_CHARS = { B: 'bat', G: 'gun', S: 'shotgun', K: 'knife', T: 'pipe', M: 'smg' };
const ENEMY_CHARS = {
  E: { armed: false, axis: 'auto' },
  A: { armed: true, axis: 'auto' },
  V: { armed: false, axis: 'vertical' },
  W: { armed: true, axis: 'vertical' },
};

// `rng` (0..1) decide las armas aleatorias; el juego pasa uno con semilla por partida y piso.
export function loadLevel(index = 0, rng = Math.random) {
  const def = LEVELS[index];
  const rows = def.rows;
  const h = rows.length;
  const w = rows[0].length;
  const grid = new Uint8Array(w * h);
  // `doors` lo rellena el juego con objetos Door: bloquean visión y balas (ver lineOfSight).
  const map = { w, h, grid, pixelW: w * TILE, pixelH: h * TILE, doors: [] };
  let player = null;
  let exit = null;
  const enemies = [];
  const weapons = [];
  const doors = [];
  const randomSlots = [];

  rows.forEach((row, ty) => {
    if (row.length !== w) throw new Error(`${def.name}: la fila ${ty} mide ${row.length}, se esperaba ${w}`);
    for (let tx = 0; tx < w; tx++) {
      const ch = row[tx];
      grid[ty * w + tx] = ch === '#' ? CELL_WALL : 0;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (ch === 'P') player = { x, y };
      else if (ch === 'X') exit = { x, y, tx, ty };
      else if (ch === 'D') doors.push({ tx, ty });
      else if (ENEMY_CHARS[ch]) enemies.push({ x, y, tx, ty, ...ENEMY_CHARS[ch] });
      else if (PICKUP_CHARS[ch]) weapons.push({ type: PICKUP_CHARS[ch], x, y });
      else if (ch === '?') randomSlots.push({ x, y });
    }
  });
  if (!player) throw new Error(`${def.name}: falta la posición del jugador (P)`);
  if (!exit) throw new Error(`${def.name}: falta la salida (X)`);

  // Zonas de suelo (habitaciones): rectángulos [tipo, x0, y0, x1, y1]; el resto usa `floor`.
  map.floor = def.floor;
  map.zone = new Array(w * h).fill(def.floor);
  for (const [type, x0, y0, x1, y1] of def.zones || []) {
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) map.zone[ty * w + tx] = type;
  }
  // Muebles [tipo, x, y, ancho, alto] en casillas. Los sólidos se marcan en la cuadrícula; se
  // valida que no pisen paredes, entidades, puertas ni otros muebles (error de diseño = excepción).
  const occupied = new Set(rows.flatMap((row, ty) => [...row].map((ch, tx) => (ch !== '.' ? ty * w + tx : -1))).filter((i) => i >= 0));
  map.props = (def.props || []).map(([type, x, y, pw = 1, ph = 1]) => {
    const solid = SOLID_PROPS.has(type);
    if (!solid && !DECOR_PROPS.has(type)) throw new Error(`${def.name}: mueble desconocido '${type}'`);
    for (let ty = y; ty < y + ph; ty++) {
      for (let tx = x; tx < x + pw; tx++) {
        const i = ty * w + tx;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h || grid[i] === CELL_WALL) throw new Error(`${def.name}: '${type}' (${x},${y}) sobre una pared`);
        if (!solid) continue;
        if (occupied.has(i) || grid[i] === CELL_PROP) throw new Error(`${def.name}: '${type}' (${x},${y}) tapa algo en (${tx},${ty})`);
        grid[i] = CELL_PROP;
      }
    }
    return { type, x, y, w: pw, h: ph, solid };
  });

  // Puerta horizontal si tiene paredes a izquierda y derecha; si no, vertical.
  for (const d of doors) d.horizontal = isStructuralWall(map, d.tx - 1, d.ty) && isStructuralWall(map, d.tx + 1, d.ty);
  for (const e of enemies) {
    e.patrol = autoPatrol(map, e.tx, e.ty, e.axis);
    e.weapon = e.armed ? (rng() < def.smgChance ? 'smg' : 'gun') : null;
  }
  // Huecos aleatorios barajados: los primeros reciben las armas garantizadas.
  for (let i = randomSlots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [randomSlots[i], randomSlots[j]] = [randomSlots[j], randomSlots[i]];
  }
  randomSlots.forEach((slot, i) => {
    const type = i < def.guaranteed.length ? def.guaranteed[i] : def.loot[Math.floor(rng() * def.loot.length)];
    weapons.push({ type, x: slot.x, y: slot.y });
  });
  return { name: def.name, par: def.par, map, player, exit, enemies, weapons, doors };
}

// Patrulla de ida y vuelta: en el eje más despejado, o en el vertical si se fuerza.
function autoPatrol(map, tx, ty, axis) {
  const span = (dx, dy) => {
    let n = 0;
    while (n < PATROL_MAX_TILES && !isWallTile(map, tx + dx * (n + 1), ty + dy * (n + 1))) n++;
    return n;
  };
  const l = span(-1, 0), r = span(1, 0), u = span(0, -1), d = span(0, 1);
  const c = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
  if (l + r === 0 && u + d === 0) return [c(tx, ty)];
  const horizontal = axis === 'vertical' ? u + d === 0 : l + r >= u + d;
  return horizontal ? [c(tx - l, ty), c(tx + r, ty)] : [c(tx, ty - u), c(tx, ty + d)];
}

// Obstáculo: pared estructural o mueble sólido (colisiones, balas, visión, pathfinding).
export function isWallTile(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.grid[ty * map.w + tx] !== 0;
}

// Solo las paredes del edificio (las que llevan tubo neón y proyectan sombra de muro).
export function isStructuralWall(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.grid[ty * map.w + tx] === CELL_WALL;
}

export function isSolidAt(map, x, y) {
  return isWallTile(map, Math.floor(x / TILE), Math.floor(y / TILE));
}

export function tileKey(map, x, y) {
  return Math.floor(y / TILE) * map.w + Math.floor(x / TILE);
}

// ¿La caja centrada en (x, y) con semitamaño hw/hh toca alguna pared?
export function rectHitsWall(map, x, y, hw, hh) {
  const x0 = Math.floor((x - hw) / TILE), x1 = Math.floor((x + hw) / TILE);
  const y0 = Math.floor((y - hh) / TILE), y1 = Math.floor((y + hh) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isWallTile(map, tx, ty)) return true;
    }
  }
  return false;
}

// Movimiento AABB por ejes separados (sliding) + empujón en esquinas.
// `e` necesita { x, y, r } (r = semitamaño de la hitbox).
export function moveAndSlide(map, e, dx, dy) {
  let hitX = false, hitY = false;
  if (dx) {
    e.x += dx;
    if (rectHitsWall(map, e.x, e.y, e.r, e.r)) {
      hitX = true;
      e.x = dx > 0
        ? Math.floor((e.x + e.r) / TILE) * TILE - e.r - 0.01
        : (Math.floor((e.x - e.r) / TILE) + 1) * TILE + e.r + 0.01;
      if (!dy) cornerNudge(map, e, Math.sign(dx), 0, Math.abs(dx));
    }
  }
  if (dy) {
    e.y += dy;
    if (rectHitsWall(map, e.x, e.y, e.r, e.r)) {
      hitY = true;
      e.y = dy > 0
        ? Math.floor((e.y + e.r) / TILE) * TILE - e.r - 0.01
        : (Math.floor((e.y - e.r) / TILE) + 1) * TILE + e.r + 0.01;
      if (!dx) cornerNudge(map, e, 0, Math.sign(dy), Math.abs(dy));
    }
  }
  return { hitX, hitY };
}

// Si estamos bloqueados pero a pocos px de un hueco, deslizamos en perpendicular hacia él.
function cornerNudge(map, e, dirX, dirY, amount) {
  const px = dirY !== 0 ? 1 : 0;
  const py = dirX !== 0 ? 1 : 0;
  for (let k = 1; k <= CORNER_TOLERANCE; k++) {
    for (const s of [1, -1]) {
      if (!rectHitsWall(map, e.x + px * s * k + dirX, e.y + py * s * k + dirY, e.r, e.r)) {
        const step = Math.min(k, amount);
        const nx = e.x + px * s * step, ny = e.y + py * s * step;
        if (!rectHitsWall(map, nx, ny, e.r, e.r)) { e.x = nx; e.y = ny; }
        return;
      }
    }
  }
}

export function lineOfSight(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / RAY_STEP);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolidAt(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return doorHitT(map, x0, y0, x1, y1) < 0;
}

// Primer cruce (t en 0..1) del segmento con alguna puerta, o -1.
export function doorHitT(map, x0, y0, x1, y1) {
  let best = -1;
  for (const door of map.doors) {
    const t = segmentIntersectT(x0, y0, x1, y1, door.hx, door.hy, door.ex, door.ey);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

// Línea de visión "gruesa": el cuerpo entero (radio r) cabe por el camino recto.
export function thickLineClear(map, x0, y0, x1, y1, r) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  const nx = (-(y1 - y0) / d) * r, ny = ((x1 - x0) / d) * r;
  return lineOfSight(map, x0, y0, x1, y1)
    && lineOfSight(map, x0 + nx, y0 + ny, x1 + nx, y1 + ny)
    && lineOfSight(map, x0 - nx, y0 - ny, x1 - nx, y1 - ny);
}

// Distancia hasta la primera pared en una dirección (para dibujar conos de visión).
export function castRay(map, x, y, angle, maxDist) {
  const cx = Math.cos(angle), cy = Math.sin(angle);
  let wall = maxDist;
  for (let d = 0; d < maxDist; d += RAY_STEP) {
    if (isSolidAt(map, x + cx * d, y + cy * d)) { wall = d; break; }
  }
  const t = doorHitT(map, x, y, x + cx * wall, y + cy * wall);
  return t >= 0 ? t * wall : wall;
}

// BFS en 4 direcciones sobre el grid. Devuelve puntos del mundo (sin la casilla inicial).
export function findPath(map, sx, sy, tx, ty) {
  const s = tileKey(map, sx, sy), goal = tileKey(map, tx, ty);
  if (isSolidAt(map, tx, ty)) return null;
  if (s === goal) return [];
  const prev = new Int32Array(map.w * map.h).fill(-1);
  const queue = [s];
  prev[s] = s;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % map.w, cy = (cur / map.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (isWallTile(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let c = goal; c !== s; c = prev[c]) {
    path.push({ x: (c % map.w) * TILE + TILE / 2, y: ((c / map.w) | 0) * TILE + TILE / 2 });
  }
  path.reverse();
  path[path.length - 1] = { x: tx, y: ty };
  return path;
}
