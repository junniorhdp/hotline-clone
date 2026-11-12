import { COLORS, segmentIntersectT, seededRandom } from './utils.js';

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
export const LEVELS = [
  {
    name: 'PISO 1 · RECEPCIÓN',
    floor: 'checker',
    loot: ['bat', 'knife', 'gun', 'pipe'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.15,
    par: 50,
    rows: [
      '########################################',
      '#......#...............#...............#',
      '#..P...#...............#...............#',
      '#......#.......E.......#.......?.......#',
      '#......#...............#...............#',
      '#..B...D...............D.......A.......#',
      '#......#...............#...............#',
      '#......#...............#...............#',
      '####D#####..#######..#######D###########',
      '#.........................#............#',
      '#....?....................#......A.....#',
      '#.....######....######....#............#',
      '#.....#..............#....D............#',
      '#.....#......E.......#....#............#',
      '#.....#..............#....#............#',
      '#.....######....######....#............#',
      '#...E.....................#.....?......#',
      '#X........................#............#',
      '########################################',
    ],
  },
  {
    name: 'PISO 2 · OFICINAS',
    floor: 'carpet',
    loot: ['pipe', 'knife', 'gun', 'smg', 'shotgun'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.35,
    par: 75,
    rows: [
      '############################################',
      '#P....#..............#.......#.............#',
      '#.....#..............#.......#......A......#',
      '#.....D.....E........D...?...D.............#',
      '#.....#..............#.......#.............#',
      '#..B..#..............#.......#.............#',
      '###D###########D######.......####D##########',
      '#..........V...............E...............#',
      '#..........................................#',
      '#....................A.............?.......#',
      '#..........................................#',
      '#######D########..#########D######..########',
      '#..............#..#..............#..#......#',
      '#....?.........#..#......W.......#..#......#',
      '#..............D..D..............D..D..?...#',
      '#......E.......#..#..............#..#......#',
      '#..............#..#.......E......#..#......#',
      '#..............#..#..............#..#......#',
      '#X.............#..#..............#..#......#',
      '#..............#..#..............#..#......#',
      '############################################',
    ],
  },
  {
    name: 'PISO 3 · ÁTICO',
    floor: 'wood',
    loot: ['smg', 'shotgun', 'gun', 'pipe', 'knife'],
    guaranteed: ['pipe', 'smg'],
    smgChance: 0.6,
    par: 100,
    rows: [
      '################################################',
      '#P...#...........#..........#...........#......#',
      '#....D.....A.....D....?.....D.....W.....D......#',
      '#....#...........#..........#...........#......#',
      '#.B..#.....E.....#..........#...........#......#',
      '###D######D########D#####D##########D#######D###',
      '#..............................................#',
      '#....##......##......##......##......##........#',
      '#.........................E......V......A......#',
      '#..............................................#',
      '#....##......##......##......##......##........#',
      '#........W..........?..........................#',
      '#..............................................#',
      '#..............................................#',
      '######D#######D#########D########D########D#####',
      '#..........#........#.........#........#.......#',
      '#....E.....#...A....#....?....#...A....#...E...#',
      '#..........D........#.........D........#.......#',
      '#..........#........#.........#........#...?...#',
      '#X.........#........#.........#........#.......#',
      '################################################',
    ],
  },
];

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
      grid[ty * w + tx] = ch === '#' ? 1 : 0;
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

  // Puerta horizontal si tiene paredes a izquierda y derecha; si no, vertical.
  for (const d of doors) d.horizontal = isWallTile(map, d.tx - 1, d.ty) && isWallTile(map, d.tx + 1, d.ty);
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
  map.floor = def.floor;
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

export function isWallTile(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.grid[ty * map.w + tx] === 1;
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
// --- Render estático del nivel en pixel art -------------------------------------------
// Las capas se pintan a media resolución (1 píxel = 2 unidades del mundo, una casilla = 16 px)
// y se dibujan escaladas ×2 sin suavizado: cada píxel cae en un píxel interno de pantalla.
const PX = TILE / 2;


function makeLayer(map) {
  const c = document.createElement('canvas');
  c.width = map.w * PX;
  c.height = map.h * PX;
  return c;
}

const FLOORS = {
  // Baldosas a cuadros con juntas, manchas y grietas.
  checker(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        ctx.fillStyle = (cx + cy) % 2 ? '#271246' : '#1c0c33';
        ctx.fillRect(x0 + cx * 8, y0 + cy * 8, 8, 8);
      }
    }
    ctx.fillStyle = '#12071f';
    ctx.fillRect(x0, y0, PX, 1);
    ctx.fillRect(x0, y0, 1, PX);
    if (rnd() < 0.25) {
      // grieta diagonal
      let x = x0 + 2 + Math.floor(rnd() * 10), y = y0 + 2 + Math.floor(rnd() * 10);
      for (let i = 0; i < 5; i++) { ctx.fillRect(x, y, 1, 1); x += rnd() < 0.5 ? 1 : 0; y += 1; }
    }
  },
  // Moqueta de oficina con ruido de trama y rayas diagonales.
  carpet(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    ctx.fillStyle = '#151233';
    ctx.fillRect(x0, y0, PX, PX);
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const gx = x0 + x, gy = y0 + y;
        if ((gx + gy) % 8 === 0) { ctx.fillStyle = '#1e1947'; ctx.fillRect(gx, gy, 1, 1); continue; }
        const r = rnd();
        if (r < 0.12) { ctx.fillStyle = '#1b1740'; ctx.fillRect(gx, gy, 1, 1); }
        else if (r < 0.2) { ctx.fillStyle = '#0f0c26'; ctx.fillRect(gx, gy, 1, 1); }
      }
    }
  },
  // Tablones de madera horizontales con vetas y juntas desplazadas.
  wood(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    for (let p = 0; p < 4; p++) {
      const y = y0 + p * 4;
      const row = ty * 4 + p;
      ctx.fillStyle = row % 2 ? '#321836' : '#2b1430';
      ctx.fillRect(x0, y, PX, 4);
      ctx.fillStyle = '#1a0b1f';
      ctx.fillRect(x0, y + 3, PX, 1);
      const seam = (row * 7 + 3) % 16;
      if (tx % 2 === row % 2) ctx.fillRect(x0 + seam, y, 1, 3);
      ctx.fillStyle = '#3d1f42';
      for (let i = 0; i < 3; i++) if (rnd() < 0.5) ctx.fillRect(x0 + Math.floor(rnd() * PX), y + 1, 2, 1);
    }
  },
};

export function renderFloor(map) {
  const c = makeLayer(map);
  const ctx = c.getContext('2d');
  const rnd = seededRandom(map.w * 977 + map.h * 131); // desgaste siempre igual
  const paint = FLOORS[map.floor] || FLOORS.checker;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (isWallTile(map, tx, ty)) continue;
      paint(ctx, tx, ty, rnd);
      // Suciedad: píxeles sueltos más oscuros.
      ctx.fillStyle = 'rgba(5, 0, 15, 0.35)';
      for (let i = 0; i < 4; i++) if (rnd() < 0.6) ctx.fillRect(tx * PX + Math.floor(rnd() * PX), ty * PX + Math.floor(rnd() * PX), 1, 1);
    }
  }
  // Sombras duras: cada pared proyecta su forma desplazada abajo-derecha sobre el suelo.
  ctx.fillStyle = 'rgba(5, 0, 15, 0.6)';
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (isWallTile(map, tx, ty)) ctx.fillRect(tx * PX + 3, ty * PX + 3, PX, PX);
    }
  }
  return c;
}

// Las paredes se dibujan encima de entidades y sangre, así la sangre nunca "mancha" muros.
// Devuelve { walls, glow }: la capa de glow se suma ('lighter') antes de las paredes.
export function renderWalls(map) {
  const walls = makeLayer(map);
  const glow = makeLayer(map);
  const ctx = walls.getContext('2d');
  const g = glow.getContext('2d');
  const edges = [];

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!isWallTile(map, tx, ty)) continue;
      const x0 = tx * PX, y0 = ty * PX;
      // Cara superior: ladrillo oscuro con juntas y brillo arriba-izquierda.
      ctx.fillStyle = '#2a0d3a';
      ctx.fillRect(x0, y0, PX, PX);
      ctx.fillStyle = '#1d0829';
      for (let r = 0; r < 4; r++) {
        ctx.fillRect(x0, y0 + r * 4 + 3, PX, 1);
        const off = (r + ty) % 2 ? 4 : 12;
        ctx.fillRect(x0 + off, y0 + r * 4, 1, 3);
      }
      ctx.fillStyle = '#3c1450';
      for (let r = 0; r < 4; r++) ctx.fillRect(x0, y0 + r * 4, PX, 1);

      // Bordes que dan al suelo: tubo neón de 2 px (brillante + medio).
      const open = {
        top: !isWallTile(map, tx, ty - 1), bottom: !isWallTile(map, tx, ty + 1),
        left: !isWallTile(map, tx - 1, ty), right: !isWallTile(map, tx + 1, ty),
      };
      const neon = (x, y, w, h, ix, iy) => {
        ctx.fillStyle = '#ff2a85';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#9c1a5a';
        ctx.fillRect(x + ix, y + iy, w, h);
        edges.push([x, y, w, h]);
      };
      if (open.top) neon(x0, y0, PX, 1, 0, 1);
      if (open.bottom) neon(x0, y0 + PX - 1, PX, 1, 0, -1);
      if (open.left) neon(x0, y0, 1, PX, 1, 0);
      if (open.right) neon(x0 + PX - 1, y0, 1, PX, -1, 0);
    }
  }

  // Glow: los mismos bordes con desenfoque; al escalar sin suavizado queda un halo "en bloques".
  g.shadowColor = COLORS.wall;
  g.shadowBlur = 6;
  g.fillStyle = COLORS.wall;
  for (let pass = 0; pass < 2; pass++) for (const [x, y, w, h] of edges) g.fillRect(x, y, w, h);
  return { walls, glow };
}
