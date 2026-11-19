// Sprites pixel art definidos como cuadrículas de texto y convertidos a bitmaps una sola vez.
// Todos miran hacia +X (derecha); se rotan al dibujar. 1 carácter = 1 píxel interno.
// En el mundo 1 píxel interno = 2 unidades (WORLD_PX), así que un sprite de 16×16 ocupa una casilla.
import { COLORS, seededRandom, hashString } from './utils.js';

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
  e: '#c2682a', E: '#6e3a1a',               // óxido (tubo oxidado)
  n: '#7ad03a',                             // veneno
  b: '#ffbe0b', B: '#b38600',               // cuerpo genérico (plantilla tumbado)
  p: '#7a2f8f', P: '#4d1a63', t: '#ff4fa3',   // pelo violeta (cola de caballo) y goma
  q: '#ff4fa3',                              // raya rosa de la bomber femenina
  r: COLORS.blood,                           // huella de sangre (footMid y footDark la recolorean)
  1: '#4fbf4a', 2: '#2a7a3a', 3: '#a8f08a', 4: '#e8e6b0', 5: '#ffd23a', 7: '#ffffff', // cocodrilo
  6: '#d88a8a', 8: '#6a5a4a', // rata
};

// Cuerpo del jugador (plantilla): vista cenital, hombros perpendiculares a la mirada, mangas
// hacia delante hasta los puños y el hueco de la cabeza en el centro. La cabeza NO va aquí: la
// pinta encima `drawMaskHead`. La ropa se completa por máscara con `OUTFITS`:
//   h/H capucha de la sudadera, junto a la nuca (clara / en sombra) · x puños de las mangas.
const PLAYER_BODY = [
  '................',
  '................',
  '.....kkkk.......',
  '....kLjjjkkk....',
  '....kLjjjjjxk...',
  '...kLjjkkkkxk...',
  '...khHkkkkkkk...',
  '...khHkkkkkkk...',
  '...khHkkkkkkk...',
  '...khHkkkkkkk...',
  '...kjjjkkkkxk...',
  '....kjjjjjjxk...',
  '....kJjjjkkk....',
  '.....kkkk.......',
  '................',
  '................',
];

// Cuerpo FEMENINO (misma plantilla y mismas letras que PLAYER_BODY): hombros dos filas más estrechos (una por lado), bomber
// entallada con rayas rosas en las mangas (`q`) y en el dobladillo de la espalda (`q` en la columna 4). La cola de caballo no va
// aquí: es un sprite aparte (`ponytail`) que Player.draw balancea al correr y al girar. Solo cambia el aspecto: la hitbox,
// la velocidad y el daño son idénticos.
const PLAYER_BODY_F = [
  '................',
  '................',
  '................',
  '.....kkkkkkkk...',
  '....kLjjqqjxk...',
  '...kLjjkkkkxk...',
  '...kqHkkkkkkk...',
  '...kqHkkkkkkk...',
  '...kqHkkkkkkk...',
  '...kqHkkkkkkk...',
  '...kjjjkkkkxk...',
  '....kJjjqqjxk...',
  '.....kkkkkkkk...',
  '................',
  '................',
  '................',
];

const DEFS = {
  // Cola de caballo (de lado, la base a la derecha, pegada a la nuca; `t` = goma del pelo).
  ponytail: [
    '..kkkkkk..',
    '.kpppPPtk.',
    'kppppPPPtk',
    '.kpppPPtk.',
    '..kkkkkk..',
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
  // Moto vista desde arriba, mirando a +X (32×13 px = 64×26 unidades, casi toda su plaza de 2×1
  // casillas): ruedas con la banda de rodadura clara (si no, el neumático negro desaparece sobre el
  // asfalto), asiento oscuro, depósito neón, escape, faro y manillar cruzado.
  bike: [
    '.....................z..........',
    '.....................Z..........',
    '........kkkkkkkkkkkkkkkkk.......',
    '........kVVVVVVVVkjjjkjjk.......',
    'kkkkkkk.kVVVVVVVVkLLLkLjkkkkkkkk',
    'kZZZZZk.kVvvvvvvVkLLLkLjkkZZZZZk',
    'kzzzzzk.kVvvvvvvVkjjjkjjkZzzzzzk',
    'kZZZZZk.kVVVVVVVVkjjjkjjkkZZZZZk',
    'kkkkkkk.kVVVVVVVVkJJJkJJkkkkkkkk',
    '........kkkkkkkkkkkkkkkkk.......',
    '..........ZZZZZZZZz..k..........',
    '..........kkkkkkkk...Z..........',
    '.....................z..........',
  ],
  // Candado de la puerta principal bloqueada (5×5).
  lock: ['.zzz.', 'z...z', 'rrrrr', 'rrkrr', 'rrrrr'],
  // Bota del pisotón (remate sin arma), mirando a +X: banda cian en el talón, puntera clara.
  boot: ['.kkkkkk.', 'kjZZzzzk', 'kjZZzzzk', 'kjZZzzzk', '.kkkkkk.'],
  // Huella de suela, mirando a +X: talón (2 píxeles) y planta (3×3). 6×3 píxeles = 12×6 unidades.
  foot: ['...rr.', 'rr.rrr', '...rr.'],
  bat: ['.......PPPPP.', 'PPPPPPPpqqqpP', '.......PPPPP.'],
  gun: ['PPPPPPPP', 'PqqqqqqP', 'PpPPPPPP', 'PP......'],
  shotgun: ['PPPP..........', 'PpqpPPPPPPPPPP', 'PPPPPPP.......'],
  knife: ['PPPpqqqqq', 'PPPpqqqq.'],
  pipe: ['kzzzzzzzzzzzzk', 'kZZZZZZZZZZZZk'],
  rustpipe: ['kEeEeeZeEeeEnk', 'kEEeEEeEEZEEnk'],
  rustknife: ['EEEeZZZZZ', 'EEEEeeeeZ'],
  cleaver: ['..kkkkkkkkk..', 'vvvzzzzzzzzzk', 'VVvzzzzZZZZZk', '..kkkkkkkkk..'],
  crowbar: ['kZZZZZZZZZZZZkk', 'kzzzzzzzzzzZZEk', '...........EEk.'],
  smg: ['PPPPPPPPPP', 'PqqqqqqqPP', 'PpPPpP....', 'PP..PP....', '....PP....'],
  door: ['dddddddddddddddd', 'dDDDDDDDDDDDDDDd', 'kkkkkkkkkkkkkkkk'],
  muzzle: ['..w..', '.wow.', 'wooow', '.wow.', '..w..'],
  arrow: ['j....', 'jj...', 'jjj..', 'jj...', 'j....'],
  // Llave de la puerta principal (piso 3): anilla y paletón dorados con dientes.
  key: ['.kkk.........', 'kyuyk........', 'ky.ykkkkkkkk.', 'kyyykyyyyyyyk', '.kkkkkkkkykyk', '.........kkk.'],
  croc: crocGrid(),
  // Rata de la alcantarilla (10×3 px), mirando a +X: cola rosada, cuerpo pardo y hocico.
  rat: ['...kkkk...', '66k8888kk6', '...kkkk...'],
};

// Cocodrilo del tramo de alcantarilla (piso 3), mirando a +X: cola, cuerpo con patas, cabeza con ojos y hocico dentado. Se genera por perfil de ancho
// (simétrico arriba-abajo) para no escribir 36×13 píxeles a mano. 1 verde · 2 oscuro · 3 lomo · 4 vientre · 5 ojo · 7 dientes.
function crocGrid() {
  const cols = 36, rows = 13, cy = 6;
  const hw = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3,                       // cola
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,                      // cuerpo
    3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1];                           // cabeza y hocico
  const g = Array.from({ length: rows }, () => Array(cols).fill('.'));
  const legs = new Set([11, 12, 13, 19, 20, 21]);
  for (let c = 0; c < cols; c++) {
    for (let r = cy - hw[c]; r <= cy + hw[c]; r++) {
      const d = Math.abs(r - cy);
      const edge = d === hw[c] || c === 0 || c === cols - 1 || (hw[c - 1] ?? -1) < d || (hw[c + 1] ?? -1) < d;
      let ch = edge ? 'k' : '1';
      if (!edge) {
        if (r === cy && c >= 2 && c <= 27) ch = '3';                                 // lomo
        else if (d === 2 && c % 3 === 0 && c > 8 && c < 24) ch = '2';                // escudos
        else if (d >= hw[c] - 1 && c > 9) ch = '2';                                  // flancos en sombra
      }
      if (edge && c >= 30 && c <= 34 && d === hw[c]) ch = c % 2 ? '7' : 'k';        // dientes
      g[r][c] = ch;
    }
  }
  for (const c of legs) for (const s of [-1, 1]) { g[cy + s * 5][c] = '2'; g[cy + s * 6][c] = 'k'; g[cy + s * 4][c] = '1'; }
  for (const s of [-1, 1]) { g[cy + s * 2][27] = '5'; g[cy + s * 2][28] = 'k'; g[cy + s][34] = '2'; } // ojos y fosas nasales
  return g.map((row) => row.join(''));
}

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
  // SIN MÁSCARA (el jugador antes de ponérsela, al llegar en moto): pelo oscuro de arriba y piel en
  // la frente y la nariz. No es una máscara: no está en MASKS, solo la dibuja `Player`.
  bare: [
    '.NMMM...',
    'NMRMMQ..',
    'NMMMMOOQ',
    'NMMMMOOQ',
    'NMRMMQ..',
    '.NMMM...',
  ],
  // NEÓN: gallo. Desde arriba la cresta roja recorre el centro de la cabeza de atrás a delante
  // y el pico ámbar sale en punta por el morro; las plumas claras quedan a los lados.
  neon: [
    '.MMMK...',
    'NMMMKMK.',
    'NQQQQOOK',
    'NQQQQOOK',
    'NMMMKMK.',
    '.MMMK...',
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
  bare:     { K: '#0a0a0f', R: '#6b4a75', M: '#3b2440', N: '#24152b', O: '#f1b48a', Q: '#c27a5a' },
  neon:     { K: '#0a0a0f', R: '#ffffff', M: '#ece8ff', N: '#b3abd6', O: '#ffbe0b', Q: '#ff2e55' },
  oso:      { K: '#0a0a0f', R: '#b07545', M: '#8a5530', N: '#5a3418', O: '#d9a878', Q: '#120c06' },
  guepardo: { K: '#0a0a0f', R: '#ffd089', M: '#ffb23f', N: '#c47a1a', O: '#fff1d0', Q: '#3a2006' },
  tiburon:  { K: '#0a0a0f', R: '#9fb0d6', M: '#7b8fb8', N: '#45557a', O: '#f5f3ff', Q: '#141a2c' },
  buho:     { K: '#0a0a0f', R: '#9b74c4', M: '#7a53a0', N: '#4a3066', O: '#ff8a3d', Q: '#ffd166' },
};

// Ropa de cada máscara. La cazadora cian es la identidad del protagonista y el contraste contra
// el suelo oscuro, así que se mantiene; lo que cambia es la sudadera que asoma tras la nuca
// (capucha h/H) y los puños (x), con el color de la máscara. NEÓN es el atuendo clásico, todo cian.
const HOOD = { h: '#5a5a72', H: '#3a3a4e' };
const OUTFITS = {
  bare_f:   { h: '#05d9e8', H: '#05d9e8', x: '#037f8c' }, // (para que exista body_bare_f; no se usa)
  bare:     { h: '#05d9e8', H: '#05d9e8', x: '#037f8c' }, // (solo para que exista body_bare; no se usa)
  neon:     { h: '#05d9e8', H: '#05d9e8', x: '#037f8c' },
  oso:      { ...HOOD, x: '#a0693f' },
  guepardo: { ...HOOD, x: '#ff9d2e' },
  tiburon:  { ...HOOD, x: '#9fb0d6' },
  buho:     { ...HOOD, x: '#9b74c4' },
};

// Sin máscara y femenina: la misma cabeza que `bare` con el pelo violeta.
MASK_HEADS.bare_f = MASK_HEADS.bare;
MASK_SKINS.bare_f = { ...MASK_SKINS.bare, R: '#b04ab8', M: '#7a2f8f', N: '#4d1a63' };

// La cabeza va delante del centro del cuerpo (como se ve desde arriba) y el morro sobresale un
// par de píxeles. Con 6 filas × 8 columnas a WORLD_PX cubre las columnas 6..13 y las filas 5..10
// del sprite del cuerpo: más estrecha que los hombros, así la cazadora sigue a la vista.
const HEAD_X = 2, HEAD_OX = 3, HEAD_OY = 3;

// Nombre del bitmap de la cabeza (las máscaras desconocidas usan la de NEÓN). `level` = nivel de
// sangre (0 = limpia; ver BLOOD_LEVELS).
export function maskHead(maskId, level = 0) {
  return `head_${MASK_HEADS[maskId] ? maskId : 'neon'}${bloodSuffix(level)}`;
}

// Dibuja la cabeza de la máscara equipada sobre el cuerpo del jugador. Se llama con el contexto
// ya trasladado al jugador y girado a su ángulo de apuntado, así que la cabeza se pinta en
// coordenadas locales (mirando a +X) y gira con él.
export function drawMaskHead(ctx, maskId, level = 0) {
  drawSprite(ctx, maskHead(maskId, level), HEAD_X, 0, 0, { ox: HEAD_OX, oy: HEAD_OY });
}

// --- Sangre sobre el personaje -----------------------------------------------------------------
// Con las bajas, el jugador se va manchando: hay BLOOD_LEVELS niveles de sangre y para cada uno
// (y cada máscara) se hornea una variante del cuerpo y de la cabeza con manchas encima. Al dibujar
// solo se elige el bitmap, así que no cuesta nada por fotograma.
//   - Cada nivel cubre una fracción exacta de la ropa o el pelaje (`fractions`): en el nivel
//     máximo el cuerpo va empapado (75 %) y la cabeza muy manchada (60 %).
//   - Hay tres tipos de mancha: racimos alrededor de `k` centros repartidos (los más antiguos se
//     llenan primero, con borde irregular), goterones (`clots`: bloques de hasta 2×2 que aparecen
//     a ciertos niveles) y gotas sueltas (`drops`).
//   - **La sangre envejece**: cada mancha recuerda en qué nivel nació; la recién salpicada es
//     rojo vivo, al nivel siguiente se oscurece y después se coagula. Así el nivel máximo es sobre
//     todo oscuro, con lo último brillando, y los rasgos rojos de la máscara (la cresta del
//     gallo) siguen destacando sobre la sangre vieja.
//   - Solo caen sobre píxeles de ropa o pelaje (`BODY_STAINABLE`, `HEAD_STAINABLE`): nunca sobre
//     contornos, ojos, hocico, pico ni cresta, así la máscara sigue siendo reconocible.
//   - Cada nivel contiene al anterior (la sangre solo se acumula) y son deterministas: semilla
//     por máscara, siempre las mismas manchas en el mismo orden.
export const BLOOD_LEVELS = 5;
const BODY_STAINABLE = 'jJLhHx';
const HEAD_STAINABLE = 'MRN';
const BODY_BLOOD = { k: 5, fractions: [0.1, 0.22, 0.38, 0.55, 0.75], clots: [0, 1, 1, 2, 3], drops: 0.8 };
const HEAD_BLOOD = { k: 3, fractions: [0.12, 0.25, 0.38, 0.5, 0.6], clots: [0, 0, 1, 1, 1], drops: 0.4 };

// Ruido fijo por celda y centro (borde irregular, brillos): mismo valor siempre.
function cellNoise(x, y, i) {
  return (((x * 73856093) ^ (y * 19349663) ^ (i * 83492791)) >>> 0) % 1000 / 1000;
}

// Dónde pueden ir las manchas de una cuadrícula y en qué orden se llenan: `k` centros bien
// repartidos (cada uno, el más lejano de 8 candidatos a los ya elegidos); cada celda se ordena por
// lo cerca que está de algún centro (los primeros centros cuentan antes) y los goterones y las
// gotas sueltas siguen otro orden fijo.
function planBlood(rows, stainable, seedText, k) {
  const cells = [];
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (stainable.includes(row[x])) cells.push({ x, y }); });
  const rng = seededRandom(hashString(seedText));
  const centers = [];
  for (let i = 0; i < k; i++) {
    let best = null, bestDist = -1;
    for (let t = 0; t < 8; t++) {
      const c = cells[Math.floor(rng() * cells.length)];
      const d = centers.length ? Math.min(...centers.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) : 0;
      if (d > bestDist) { best = c; bestDist = d; }
    }
    centers.push(best);
  }
  const scored = cells.map((c) => ({
    c,
    score: Math.min(...centers.map((p, i) => Math.hypot(p.x - c.x, p.y - c.y) + i * 0.55 + (cellNoise(c.x, c.y, i) - 0.5) * 1.2)),
    drop: rng(),
  }));
  return {
    n: cells.length,
    keys: new Set(cells.map((c) => `${c.x},${c.y}`)),
    order: [...scored].sort((a, b) => a.score - b.score).map((o) => o.c),
    drops: [...scored].sort((a, b) => a.drop - b.drop).map((o) => o.c),
  };
}

// En qué nivel nace cada mancha: Map 'x,y' → { level, kind } con kind 'main' | 'clot' | 'single'.
// Se construye nivel a nivel sobre lo ya manchado, así que la sangre solo se acumula.
function bloodTimeline(plan, { fractions, clots, drops }) {
  const born = new Map();
  let nextOrder = 0, nextDrop = 0, clotsDone = 0, singlesDone = 0;
  const free = (c) => !born.has(`${c.x},${c.y}`);
  const nextFreeDrop = () => {
    while (nextDrop < plan.drops.length && !free(plan.drops[nextDrop])) nextDrop++;
    return plan.drops[nextDrop++];
  };
  for (let level = 1; level <= BLOOD_LEVELS; level++) {
    while (clotsDone < clots[level - 1]) {          // goterones: bloque de hasta 2×2
      const c = nextFreeDrop();
      if (!c) break;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const key = `${c.x + dx},${c.y + dy}`;
        if (plan.keys.has(key) && !born.has(key)) born.set(key, { level, kind: 'clot' });
      }
      clotsDone++;
    }
    while (singlesDone < Math.floor(level * drops)) { // gotas sueltas
      const c = nextFreeDrop();
      if (!c) break;
      born.set(`${c.x},${c.y}`, { level, kind: 'single' });
      singlesDone++;
    }
    const target = Math.max(level, Math.round(fractions[level - 1] * plan.n));
    while (born.size < target && nextOrder < plan.order.length) { // racimos
      const c = plan.order[nextOrder++];
      if (free(c)) born.set(`${c.x},${c.y}`, { level, kind: 'main' });
    }
  }
  return born;
}

// Píxeles manchados a un nivel: Map 'x,y' → color. Lo recién nacido es rojo vivo (con algún brillo
// húmedo), una generación después se oscurece y luego se coagula; los goterones son oscuros.
function bloodAtLevel(timeline, level) {
  const out = new Map();
  for (const [key, { level: born, kind }] of timeline) {
    if (born > level) continue;
    const age = level - born;
    let color;
    if (kind === 'clot') color = age === 0 ? COLORS.bloodDark : COLORS.gore;
    else if (kind === 'single') color = age === 0 ? COLORS.blood : COLORS.bloodDark;
    else if (age === 0) {
      const [x, y] = key.split(',').map(Number);
      color = cellNoise(y, x, 7) < 0.14 ? COLORS.bloodWet : COLORS.blood;
    } else color = age === 1 ? COLORS.bloodMid : COLORS.bloodDark;
    out.set(key, color);
  }
  return out;
}

// Copia de un bitmap con la sangre encima.
function withBlood(base, pixels) {
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0);
  for (const [key, color] of pixels) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

// Nombre del bitmap del cuerpo / la cabeza con el nivel de sangre dado (0 = limpio).
const bloodSuffix = (level) => (level > 0 ? `_b${Math.min(BLOOD_LEVELS, level | 0)}` : '');
export function playerBody(maskId, level = 0, gender = 'male') {
  return `body_${gender === 'female' ? 'f_' : ''}${MASK_HEADS[maskId] ? maskId : 'neon'}${bloodSuffix(level)}`;
}

// Variantes recoloreadas de la plantilla "tumbado".
const RECOLORS = {
  enemyDown: ['lying', {}],
  enemyCorpse: ['lying', { b: '#8c6a00', B: '#5c4500', s: '#9a5a40', S: '#6e3c2a' }],
  // Corredor (rosa, cuerpo a cuerpo) y guardia pesado (chaleco granate y mangas de acero).
  enemyRunner: ['enemy', { y: '#ff4fa3', Y: '#a31f66', u: '#ffc2e0', c: '#05d9e8', C: '#037f8c', m: '#9ff6ff' }],
  enemyOperator: ['enemy', { y: '#2ab7a9', Y: '#187a70' }], // operador de cámaras: camisa verde azulada
  enemyShield: ['enemyArmed', { v: '#3d4f66', V: '#202b38', y: '#8fa3ba', Y: '#566a82' }], // blindado: chaleco y mangas de acero azulado
  enemyHeavy: ['enemyArmed', { v: '#8a1c2b', V: '#4a0f18', y: '#6b6b85', Y: '#3a3a52' }],
  runnerCorpse: ['lying', { b: '#a31f66', B: '#6b1243', s: '#9a5a40', S: '#6e3c2a' }],
  shieldCorpse: ['lying', { b: '#202b38', B: '#10161d', s: '#9a5a40', S: '#6e3c2a' }],
  heavyCorpse: ['lying', { b: '#4a0f18', B: '#2a0710', s: '#9a5a40', S: '#6e3c2a' }],
  bossCorpse: ['lying', { b: '#2b2b3a', B: '#14141e', s: '#9a5a40', S: '#6e3c2a' }],
  armedCorpse: ['lying', { b: '#3a2f1a', B: '#241d10', s: '#9a5a40', S: '#6e3c2a' }],
  playerCorpse: ['lying', { b: '#037f8c', B: '#025a63', s: '#9a5a40', S: '#6e3c2a' }],
  // La huella se oscurece al enfriarse: rojo vivo, medio y coagulado.
  // La puerta principal es cian (abierta) o roja (bloqueada); la sombra de la moto, una silueta oscura.
  doorMain: ['door', { d: '#9ff6ff', D: '#05d9e8' }],
  doorLocked: ['door', { d: '#ff2e55', D: '#8a0f2c' }],
  bikeShadow: ['bike', { k: '#05000f', V: '#05000f', v: '#05000f', j: '#05000f', L: '#05000f', J: '#05000f', Z: '#05000f', z: '#05000f', w: '#05000f' }],
  footMid: ['foot', { r: COLORS.bloodMid }],
  footDark: ['foot', { r: COLORS.bloodDark }],
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
    for (const [id, rows] of Object.entries(MASK_HEADS)) {
      cache[`head_${id}`] = buildSprite(rows, MASK_SKINS[id]);
      cache[`body_${id}`] = buildSprite(PLAYER_BODY, OUTFITS[id]);
      // Todas las variantes con sangre se hornean ahora, una vez: dibujar no cuesta más por ello.
      const headBlood = bloodTimeline(planBlood(rows, HEAD_STAINABLE, `head:${id}`, HEAD_BLOOD.k), HEAD_BLOOD);
      const bodyBlood = bloodTimeline(planBlood(PLAYER_BODY, BODY_STAINABLE, `body:${id}`, BODY_BLOOD.k), BODY_BLOOD);
      // Cuerpo femenino (mismo reparto de sangre por nivel, sobre su propia plantilla).
      const colorsF = { ...OUTFITS[id], q: '#ff4fa3' };
      cache[`body_f_${id}`] = buildSprite(PLAYER_BODY_F, colorsF);
      const bodyBloodF = bloodTimeline(planBlood(PLAYER_BODY_F, BODY_STAINABLE, `bodyf:${id}`, BODY_BLOOD.k), BODY_BLOOD);
      for (let level = 1; level <= BLOOD_LEVELS; level++) {
        cache[`head_${id}_b${level}`] = withBlood(cache[`head_${id}`], bloodAtLevel(headBlood, level));
        cache[`body_${id}_b${level}`] = withBlood(cache[`body_${id}`], bloodAtLevel(bodyBlood, level));
        cache[`body_f_${id}_b${level}`] = withBlood(cache[`body_f_${id}`], bloodAtLevel(bodyBloodF, level));
      }
    }
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
