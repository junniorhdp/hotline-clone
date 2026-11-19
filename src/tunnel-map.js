import { TILE } from './map.js';

// Datos puros del tramo de alcantarilla del piso 3 (sin dibujo ni DOM: los validadores de Node lo cargan). Un túnel de 46×13 casillas: muro doble por fuera, pasillo útil de
// 9 casillas de alto (filas 2-10) con un canal de agua poco profunda en el centro (filas 5-7), pilares de piedra de 2×2 que hacen de cobertura y de cebo para la embestida del
// cocodrilo, una escalera de bajada al oeste (donde apareces) y la de subida al este (la salida hacia el cuarto de servicio del edificio).
export const TUNNEL_W = 46, TUNNEL_H = 13;
export const TUNNEL_PILLARS = [[9, 3], [9, 8], [16, 5], [23, 3], [23, 8], [30, 5], [36, 3], [36, 8]]; // esquina superior izquierda de cada pilar 2×2
export const TUNNEL_SPAWN = { tx: 3, ty: 6 };      // donde apareces al bajar (junto a la escalera de bajada, en (2,6))
export const TUNNEL_DOWN = { tx: 2, ty: 6 };       // boca de la escalera por la que bajaste (decoración)
export const TUNNEL_LADDER = { tx: 43, ty: 6 };    // escalera de subida (salida): aquí se interactúa
// Ronda del cocodrilo por la fila 7 (despejada de pilares), en casillas: de un extremo al otro y vuelta.
export const CROC_ROUTE = [[12, 7], [21, 7], [28, 7], [34, 7]];
export const CROC_START = { tx: 21, ty: 7 };

const CELL_WALL = 1, CELL_PROP = 2; // iguales que en map.js

// Construye el mapa del túnel con la misma forma que los mapas de piso (lo leen el movimiento, la visión y las capas de dibujo).
export function buildTunnelMap() {
  const w = TUNNEL_W, h = TUNNEL_H;
  const grid = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) grid[ty * w + tx] = CELL_WALL;
  const zone = new Array(w * h).fill('sewerStone');
  for (let ty = 5; ty <= 7; ty++) for (let tx = 2; tx < w - 2; tx++) zone[ty * w + tx] = 'water';
  const props = [];
  for (const [x, y] of TUNNEL_PILLARS) {
    props.push({ type: 'pillar', x, y, w: 2, h: 2, solid: true });
    for (let j = y; j < y + 2; j++) for (let i = x; i < x + 2; i++) grid[j * w + i] = CELL_PROP;
  }
  props.push({ type: 'ladder', x: TUNNEL_DOWN.tx, y: TUNNEL_DOWN.ty, w: 1, h: 1, solid: false });
  props.push({ type: 'ladder', x: TUNNEL_LADDER.tx, y: TUNNEL_LADDER.ty, w: 1, h: 1, solid: false });
  for (const [x, y] of [[5, 3], [12, 9], [19, 3], [27, 9], [33, 4], [41, 9], [6, 9], [38, 4]]) props.push({ type: x % 2 ? 'debris' : 'trash', x, y, w: 1, h: 1, solid: false });
  const c = (t) => t * TILE + TILE / 2;
  return {
    w, h, grid, pixelW: w * TILE, pixelH: h * TILE, doors: [], dark: null, lights: [], reveal: 0, street: null, sewers: [], cameras: [], trap: null,
    floor: 'sewerStone', zone, props, tunnel: true,
    spawn: { x: c(TUNNEL_SPAWN.tx), y: c(TUNNEL_SPAWN.ty) },
    ladder: { tx: TUNNEL_LADDER.tx, ty: TUNNEL_LADDER.ty, x: c(TUNNEL_LADDER.tx), y: c(TUNNEL_LADDER.ty) },
    route: CROC_ROUTE.map(([tx, ty]) => ({ x: c(tx), y: c(ty) })),
    crocStart: { x: c(CROC_START.tx), y: c(CROC_START.ty) },
  };
}
