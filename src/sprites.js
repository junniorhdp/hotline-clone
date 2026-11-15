// Sprites pixel art definidos como cuadrículas de texto y convertidos a bitmaps una sola vez.
// Todos miran hacia +X (derecha); se rotan al dibujar. 1 carácter = 1 píxel interno.
// En el mundo 1 píxel interno = 2 unidades (WORLD_PX), así que un sprite de 16×16 ocupa una casilla.
export const WORLD_PX = 2;

// Paleta de los sprites (coherente con COLORS de utils.js).
const PALETTE = {
  k: '#140a24', // contorno
  j: '#05d9e8', J: '#037f8c', L: '#9ff6ff', // cazadora del jugador
  s: '#f1b48a', S: '#c27a5a',               // piel
  y: '#ffbe0b', Y: '#b38600', u: '#ffe08a', // camisa enemigo (+ brillo)
  c: '#4b2a7a', C: '#2e1850', m: '#6a45a3', // gorra (+ brillo)
  v: '#5b4a2a', V: '#3a2f1a',               // chaleco
  p: '#c77dff', P: '#7b2cbf', q: '#efd9ff', // armas
  d: '#ff7ab8', D: '#b8326e',               // puerta
  w: '#fff6d6', o: '#ffd166',               // fogonazo / latón
  z: '#c9c3e6', Z: '#7a7499',               // metal (tubo)
  b: '#ffbe0b', B: '#b38600',               // cuerpo genérico (plantilla tumbado)
};

const DEFS = {
  // Vista cenital: hombros perpendiculares a la mirada, mangas hacia delante hasta los puños
  // y el hueco de la cabeza en el centro. La cabeza NO va aquí: la pinta encima `drawMaskHead`
  // con la máscara equipada (el hueco queda en el tono del contorno por si asoma una esquina).
  player: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkkkkJk...',
    '...kjjkkkkkkk...',
    '...kjjkkkkkkk...',
    '...kjjkkkkkkk...',
    '...kjjkkkkkkk...',
    '...kjjjkkkkJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // Patrulla: camisa amarilla y gorra con visera hacia delante.
  enemy: [
    '................',
    '................',
    '.....kkkk.......',
    '....kuyyykkk....',
    '....kuyyyyyYk...',
    '...kuyykkkkYk...',
    '...kyykcccCkk...',
    '...kyykcmcCCk...',
    '...kyykcccCCk...',
    '...kyykcccCkk...',
    '...kyyykkkkYk...',
    '....kyyyyyyYk...',
    '....kYyyykkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // Armado: chaleco oscuro sobre mangas amarillas, cabeza rapada.
  enemyArmed: [
    '................',
    '................',
    '.....kkkk.......',
    '....kyvvvkkk....',
    '....kyvvvyyYk...',
    '...kyvvkkkkVk...',
    '...kvvkssssSk...',
    '...kvvksssSSk...',
    '...kvvksssSSk...',
    '...kvvkssssSk...',
    '...kyvvkkkkVk...',
    '....kyvvvyyYk...',
    '....kVvvvkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // Plantilla de cuerpo tumbado (b/B = ropa); se recolorea para derribados y cadáveres.
  lying: [
    '................',
    '................',
    '................',
    '....kkkk........',
    '..kkbbbbk.kkk...',
    '.kbbbbbbbkssSk..',
    'kbbbbbbbbkssssk.',
    'kbbbbbbbbkssssk.',
    '.kBbbbbbbkSSSk..',
    '..kkBBBBk.kkk...',
    '....kkkk........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  fist: ['.kk.', 'kssk', 'kSSk', '.kk.'],
  bat: ['.......PPPPP.', 'PPPPPPPpqqqpP', '.......PPPPP.'],
  gun: ['PPPPPPPP', 'PqqqqqqP', 'PpPPPPPP', 'PP......'],
  shotgun: ['PPPP..........', 'PpqpPPPPPPPPPP', 'PPPPPPP.......'],
  knife: ['PPPpqqqqq', 'PPPpqqqq.'],
  pipe: ['kzzzzzzzzzzzzk', 'kZZZZZZZZZZZZk'],
  smg: ['PPPPPPPPPP', 'PqqqqqqqPP', 'PpPPpP....', 'PP..PP....', '....PP....'],
  door: ['dddddddddddddddd', 'dDDDDDDDDDDDDDDd', 'kkkkkkkkkkkkkkkk'],
  muzzle: ['..w..', '.wow.', 'wooow', '.wow.', '..w..'],
  arrow: ['j....', 'jj...', 'jjj..', 'jj...', 'j....'],
};

// --- Cabezas de las máscaras (vista cenital) ------------------------------------------------
// Cada máscara pinta SOLO la cabeza del jugador; el cuerpo (sprite `player`) es el mismo para
// todas, así la silueta sigue siendo la del protagonista. Son cuadrículas de 6 filas × 8 columnas
// que se dibujan encima del cuerpo con `drawMaskHead`, ya giradas al ángulo de apuntado:
//   - mirando a +X: la columna 0 es la nuca y la 7 el morro, que sobresale del cuerpo;
//   - simétricas respecto al eje de apuntado (fila 0↔5, 1↔4, 2↔3), para que el animal se
//     lea igual apunte a donde apunte;
//   - contorno `K` propio (#0a0a0f, más oscuro que el del cuerpo) en el morro y las puntas, que
//     es por donde la cabeza sobresale del cuerpo y toca el suelo; por detrás y por los lados el
//     recorte ya lo da la cazadora cian, y gastar ahí otro píxel de contorno dejaría la cara sin
//     sitio para los rasgos.
// Letras: K contorno · M base · R luz · N sombra · O claro (hocico, dientes, pico) · Q acento
// (ojos, nariz, rayas, visor). El color lo pone MASK_SKINS, con los mismos tonos que el retrato
// del menú (`MASKS` en masks.js) para que se reconozca la misma máscara.
const MASK_HEADS = {
  // NEÓN: casco liso, sin orejas, con el visor magenta cruzando todo el frente.
  neon: [
    '.MRMK...',
    'NMMMQQK.',
    'NMMMQQOK',
    'NMMMQQOK',
    'NMMMQQK.',
    '.MRMK...',
  ],
  // OSO: orejas redondas a los lados, ojos negros y hocico claro con la nariz al frente.
  oso: [
    '.MRK....',
    'NMMMQMK.',
    'NMMMOOQK',
    'NMMMOOQK',
    'NMMMQMK.',
    '.MRK....',
  ],
  // GUEPARDO: orejas en punta, manchas, rayas de lágrima y hocico crema.
  guepardo: [
    '.RK.....',
    'NMQMQMK.',
    'NMMMQOOK',
    'NMMMQOOK',
    'NMQMQMK.',
    '.RK.....',
  ],
  // TIBURÓN: cabeza en cuña (ancha por detrás, en punta por delante), ojillos negros a los
  // lados y morro blanco.
  tiburon: [
    'NMK.....',
    'NMMMQMK.',
    'NMMMMOOK',
    'NMMMMOOK',
    'NMMMQMK.',
    'NMK.....',
  ],
  // BÚHO: dos ojos ámbar enormes mirando al frente, pico naranja entre ellos y penachos detrás.
  buho: [
    '.MRK....',
    'NMMQQMK.',
    'NMMMMOOK',
    'NMMMMOOK',
    'NMMQQMK.',
    '.MRK....',
  ],
};

// Color de cada máscara: los mismos tonos que su retrato del menú, pero un punto más claros
// (desde arriba la cabeza está iluminada) y con contraste alto contra el suelo oscuro y contra
// la cazadora cian (por eso el visor de NEÓN es magenta y no cian).
const MASK_SKINS = {
  neon:     { K: '#0a0a0f', R: '#6a6a9e', M: '#4e4e78', N: '#2a2a40', O: '#ff9ed4', Q: '#ff2a85' },
  oso:      { K: '#0a0a0f', R: '#b07545', M: '#8a5530', N: '#5a3418', O: '#d9a878', Q: '#120c06' },
  guepardo: { K: '#0a0a0f', R: '#ffd089', M: '#ffb23f', N: '#c47a1a', O: '#fff1d0', Q: '#3a2006' },
  tiburon:  { K: '#0a0a0f', R: '#9fb0d6', M: '#7b8fb8', N: '#45557a', O: '#f5f3ff', Q: '#141a2c' },
  buho:     { K: '#0a0a0f', R: '#9b74c4', M: '#7a53a0', N: '#4a3066', O: '#ff8a3d', Q: '#ffd166' },
};

// La cabeza va delante del centro del cuerpo (como se ve desde arriba) y el morro sobresale un
// par de píxeles. Con 6 filas × 8 columnas a WORLD_PX cubre las columnas 6..13 y las filas 5..10
// del sprite del cuerpo: más estrecha que los hombros, así la cazadora sigue a la vista.
const HEAD_X = 2, HEAD_OX = 3, HEAD_OY = 3;

// Nombre del bitmap de la cabeza (las máscaras desconocidas usan la de NEÓN).
export function maskHead(maskId) {
  return MASK_HEADS[maskId] ? `head_${maskId}` : 'head_neon';
}

// Dibuja la cabeza de la máscara equipada sobre el cuerpo del jugador. Se llama con el contexto
// ya trasladado al jugador y girado a su ángulo de apuntado, así que la cabeza se pinta en
// coordenadas locales (mirando a +X) y gira con él.
export function drawMaskHead(ctx, maskId) {
  drawSprite(ctx, maskHead(maskId), HEAD_X, 0, 0, { ox: HEAD_OX, oy: HEAD_OY });
}

// Variantes recoloreadas de la plantilla "tumbado".
const RECOLORS = {
  enemyDown: ['lying', {}],
  enemyCorpse: ['lying', { b: '#8c6a00', B: '#5c4500', s: '#9a5a40', S: '#6e3c2a' }],
  armedCorpse: ['lying', { b: '#3a2f1a', B: '#241d10', s: '#9a5a40', S: '#6e3c2a' }],
  playerCorpse: ['lying', { b: '#037f8c', B: '#025a63', s: '#9a5a40', S: '#6e3c2a' }],
};

// Crea un bitmap a partir de filas de texto; `overrides` sustituye colores de la paleta base.
export function buildSprite(rows, overrides = {}) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = overrides[row[x]] || PALETTE[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

let cache = null;
export function sprites() {
  if (!cache) {
    cache = {};
    for (const [name, rows] of Object.entries(DEFS)) cache[name] = buildSprite(rows);
    for (const [name, [base, colors]] of Object.entries(RECOLORS)) cache[name] = buildSprite(DEFS[base], colors);
    for (const [id, rows] of Object.entries(MASK_HEADS)) cache[`head_${id}`] = buildSprite(rows, MASK_SKINS[id]);
  }
  return cache;
}

// Dibuja un sprite en coordenadas del mundo. (ox, oy) = píxel del sprite que cae en (x, y)
// (por defecto el centro). Se rota alrededor de ese punto.
export function drawSprite(ctx, name, x, y, angle = 0, { ox, oy, alpha = 1, scale = WORLD_PX } = {}) {
  const img = sprites()[name];
  const cx = ox ?? img.width / 2, cy = oy ?? img.height / 2;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(img, -cx * scale, -cy * scale, img.width * scale, img.height * scale);
  ctx.restore();
}

// Redondea una coordenada del mundo a la rejilla de píxeles internos.
export function snap(v) {
  return Math.round(v / WORLD_PX) * WORLD_PX;
}

// Rectángulo alineado a la rejilla de píxeles (w, h en píxeles internos).
export function pixelRect(ctx, x, y, w = 1, h = 1) {
  ctx.fillRect(snap(x), snap(y), w * WORLD_PX, h * WORLD_PX);
}

// Disco relleno hecho de filas de píxeles (r en píxeles de `unit`).
export function pixelDisc(ctx, cx, cy, r, unit = 1) {
  const R = Math.max(1, Math.round(r));
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.floor(Math.sqrt(R * R - dy * dy));
    ctx.fillRect((Math.round(cx) - half) * unit, (Math.round(cy) + dy) * unit, (half * 2 + 1) * unit, unit);
  }
}

// Línea de píxeles (Bresenham) en coordenadas enteras del canvas actual, sin antialiasing.
export function pixelLine(ctx, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
