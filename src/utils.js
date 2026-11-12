export const TAU = Math.PI * 2;

// Paleta neón / synthwave. Todo color del juego sale de aquí.
export const COLORS = {
  background: '#0d0221',
  floorAlt: '#10042a',
  grid: 'rgba(5, 217, 232, 0.05)',
  wall: '#ff2a85',
  wallFill: 'rgba(255, 42, 133, 0.18)',
  door: '#ff7ab8',
  player: '#05d9e8',
  playerDark: '#037f8c',
  playerCorpse: '#04707a',
  enemy: '#ffbe0b',
  enemyDark: '#b38600',
  enemyCorpse: '#8c6a00',
  blood: '#d90429',
  weapon: '#c77dff',
  bullet: '#fff6d6',
  enemyBullet: '#ff5c5c',
  laser: '#d90429',
  spark: '#fff1a8',
  shell: '#ffd166',
  dust: '#b8a4d9',
  debug: '#00ff9f',
  text: '#f5f3ff',
};

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Diferencia angular más corta (a - b) en el rango [-PI, PI].
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function closestOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1) : 0;
  return { x: ax + vx * t, y: ay + vy * t };
}

// Intersección de los segmentos AB y CD. Devuelve t (0..1 sobre AB) o -1 si no se cruzan.
export function segmentIntersectT(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

// Generador pseudoaleatorio con semilla (LCG): misma semilla → misma secuencia en [0, 1).
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Hash FNV-1a de 32 bits: convierte un texto (p. ej. id de partida + piso) en semilla.
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
