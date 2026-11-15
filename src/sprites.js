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

// --- Jugador: una cabeza por máscara --------------------------------------------------------
// Cada máscara tiene su sprite completo del jugador: el cuerpo (cazadora cian, mangas hacia
// delante y hombros perpendiculares a la mirada) es idéntico en todas para que la silueta siga
// leyéndose como el protagonista; lo único que cambia es la cabeza, que es lo que se ve desde
// la vista cenital. Las cuadrículas solo definen la forma y usan letras genéricas a las que
// cada máscara da color en MASK_SKINS:
//   R luz (arriba-izquierda) · M base · N sombra (abajo-derecha) · O claro · Q acento
// Mirando a +X, el frente de la cabeza es la columna 12: ahí van visores, hocicos y picos.
// Las orejas y penachos asoman por encima del cuello (filas 5 y 10).
const MASK_DEFS = {
  // NEÓN: casco liso y visor magenta de lado a lado, con el borde encendido. Sin orejas.
  neon: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkMMRJk...',
    '...kjjkRMMMMk...',
    '...kjjkRMMQQOk..',
    '...kjjkNMMQQOk..',
    '...kjjkNNMMMk...',
    '...kjjjkMNNJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // OSO: cabezón pardo y redondo, hocico claro y nariz negra asomando al frente.
  oso: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkMRRJk...',
    '...kjjkRMMMMk...',
    '...kjjkRMMOOQk..',
    '...kjjkNMMOOQk..',
    '...kjjkNNMMMk...',
    '...kjjjkNNMJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // GUEPARDO: naranja, orejas oscuras asomando por detrás y las dos rayas de lágrima
  // flanqueando el hocico crema.
  guepardo: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkQMRJk...',
    '...kjjkRMMQQk...',
    '...kjjkRMMOOOk..',
    '...kjjkNMMOOOk..',
    '...kjjkNNMQQk...',
    '...kjjjkQMNJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // TIBURÓN: cabeza en cuña gris azulada, morro blanco en punta y aleta dorsal oscura
  // asomando por detrás.
  tiburon: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkkMRJk...',
    '...kjjkRMMMMk...',
    '...kjjQQMMOOOk..',
    '...kjjQQNMOOOk..',
    '...kjjkNNMMMk...',
    '...kjjjkkNNJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
  // BÚHO: cabeza morada ancha, dos ojos ámbar en las esquinas delanteras y el pico naranja
  // entre ellos.
  buho: [
    '................',
    '................',
    '.....kkkk.......',
    '....kLjjjkkk....',
    '....kLjjjjjJk...',
    '...kLjjkMRRJk...',
    '...kjjkRMMQQk...',
    '...kjjkRMMMMOk..',
    '...kjjkNMMMMOk..',
    '...kjjkNMMQQk...',
    '...kjjjkNNNJk...',
    '....kjjjjjjJk...',
    '....kJjjjkkk....',
    '.....kkkk.......',
    '................',
    '................',
  ],
};

// Color de cada máscara: alto contraste contra el fondo oscuro y, sobre todo, contra la
// cazadora cian del propio jugador (por eso el visor de NEÓN es magenta y no cian).
const MASK_SKINS = {
  neon:     { R: '#7878ae', M: '#4e4e78', N: '#2a2a44', O: '#ff9ed4', Q: '#ff2a85' },
  oso:      { R: '#c88a58', M: '#a06840', N: '#6b3d1f', O: '#e8c49a', Q: '#1f1208' },
  guepardo: { R: '#ffd089', M: '#ffb23f', N: '#c47a1a', O: '#fff1d0', Q: '#4a2a08' },
  tiburon:  { R: '#9fb0d6', M: '#6c7fa8', N: '#45557a', O: '#f5f3ff', Q: '#3c4a6e' },
  buho:     { R: '#9b74c4', M: '#7a53a0', N: '#4a3366', O: '#ff8a3d', Q: '#ffd166' },
};

// Nombre del sprite del jugador con una máscara puesta (las máscaras desconocidas usan NEÓN).
export function playerSprite(maskId) {
  return MASK_DEFS[maskId] ? `player_${maskId}` : 'player_neon';
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
    for (const [id, rows] of Object.entries(MASK_DEFS)) cache[`player_${id}`] = buildSprite(rows, MASK_SKINS[id]);
  }
  return cache;
}

const upright = new Map();
// Copia de un sprite mirando hacia arriba (-Y), para los iconos de menú y HUD: se hornea una
// vez girando el bitmap de partida 90°, así el icono nunca puede divergir de lo que se ve en el
// piso. El giro es de 90° exactos alrededor del centro, así que no desplaza ni difumina píxeles.
export function uprightSprite(name) {
  if (!upright.has(name)) {
    const img = sprites()[name];
    const c = document.createElement('canvas');
    c.width = img.height;
    c.height = img.width;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    upright.set(name, c);
  }
  return upright.get(name);
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
