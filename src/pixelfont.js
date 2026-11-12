// Fuente bitmap 5×7 propia: todo el texto del juego se pinta píxel a píxel (sin antialiasing).
// Cada glifo son 7 filas de 5 columnas ('#' = píxel encendido). Las tildes y la Ñ se dibujan
// en 2 filas extra encima del glifo base, así que la celda completa mide 5×9.
const GLYPHS = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '####. ....# ....# .###. ....# ....# ####.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '.###. #.... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ....# .###.',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '¡': '..#.. ..... ..#.. ..#.. ..#.. ..#.. ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '¿': '..#.. ..... ..#.. .#... #.... #...# .###.',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '·': '..... ..... ..... ..#.. ..... ..... .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
  '%': '##..# ##.#. ...#. ..#.. .#... .#.## #..##',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  "'": '..#.. ..#.. ..... ..... ..... ..... .....',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
};
const ACUTE = ['...#.', '..#..'];
const TILDE = ['.##.#', '#..#.'];
const ACCENTED = { 'Á': ['A', ACUTE], 'É': ['E', ACUTE], 'Í': ['I', ACUTE], 'Ó': ['O', ACUTE], 'Ú': ['U', ACUTE], 'Ñ': ['N', TILDE] };

export const CELL_H = 9;     // 2 filas de tilde + 7 del glifo
const ADVANCE = 6;           // 5 px de glifo + 1 de separación
const SPACE_ADVANCE = 4;
const MAX_CACHE = 400;

// Devuelve las 9 filas del carácter (o null si no existe).
function glyphRows(ch) {
  if (ACCENTED[ch]) {
    const [base, accent] = ACCENTED[ch];
    return [...accent, ...GLYPHS[base].split(' ')];
  }
  const g = GLYPHS[ch];
  return g ? ['.....', '.....', ...g.split(' ')] : null;
}

export function measureText(text) {
  let w = 0;
  for (const ch of text.toUpperCase()) w += ch === ' ' ? SPACE_ADVANCE : ADVANCE;
  return Math.max(0, w - 1);
}

const cache = new Map();

// Rasteriza un texto (con sombra dura opcional de 1 px) en un canvas pequeño reutilizable.
function renderText(text, color, shadow) {
  const key = `${text}|${color}|${shadow}`;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > MAX_CACHE) cache.clear();
  const up = text.toUpperCase();
  c = document.createElement('canvas');
  c.width = measureText(up) + 2;
  c.height = CELL_H + 1;
  const ctx = c.getContext('2d');
  const paint = (ox, oy, fill) => {
    ctx.fillStyle = fill;
    let x = 0;
    for (const ch of up) {
      if (ch === ' ') { x += SPACE_ADVANCE; continue; }
      const rows = glyphRows(ch) || glyphRows('?');
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) if (row[rx] === '#') ctx.fillRect(x + rx + ox, ry + oy, 1, 1);
      });
      x += ADVANCE;
    }
  };
  if (shadow) paint(1, 1, shadow);
  paint(0, 0, color);
  cache.set(key, c);
  return c;
}

// Dibuja texto pixelado. (x, y) = esquina superior izquierda de la celda (incluye zona de tildes).
// `scale` multiplica el tamaño del píxel (en el HUD 1 = 1 píxel interno).
export function drawText(ctx, text, x, y, { color = '#f5f3ff', scale = 1, align = 'left', shadow = '#140a24' } = {}) {
  const img = renderText(String(text), color, shadow);
  const w = img.width * scale;
  const dx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.drawImage(img, Math.round(dx), Math.round(y), w, img.height * scale);
}
