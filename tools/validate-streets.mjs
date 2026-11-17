// Comprueba la calle exterior de cada piso (generada al azar por partida y piso, ver withOutskirts en map.js) con muchas semillas:
//   - máquina expendedora, cabina y contenedores se pueden tocar desde una casilla libre alcanzable;
//   - 2 monedas alcanzables y fuera de los rincones que tapa el HUD; ≥ 3 vagabundos bien colocados; fogata; 3 alcantarillas;
//   - ninguna alcantarilla pegada a la fogata ni bajo el HUD.
// Se ejecuta con `npm run check:levels` (junto a validate-levels.mjs).
import { LEVELS, loadLevel, isWallTile, TILE } from '../src/map.js';

let bad = 0;
const fail = (m) => { bad++; console.log('  ✗ ' + m); };
const seeds = Array.from({ length: 20 }, (_, k) => (k + 0.5) / 20);
console.log('Calle exterior (20 semillas por piso)…');

for (let i = 0; i < LEVELS.length; i++) {
  for (const sd of seeds) {
    const L = loadLevel(i, () => sd), { map } = L, st = map.street;
    const tag = `piso ${i + 1} semilla ${sd}`;
    const solid = (tx, ty) => isWallTile(map, tx, ty);
    const start = [Math.floor(L.player.x / TILE), Math.floor(L.player.y / TILE)];
    const seen = new Set([start.join()]), q = [start];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (!seen.has(k) && !solid(nx, ny)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    const reach = (o) => seen.has(Math.floor(o.x / TILE) + ',' + Math.floor(o.y / TILE));
    const hud = (tx, ty) => ty <= 3 && (tx <= 7 || tx >= map.w - 9);
    // ¿hay una casilla libre alcanzable a menos de 28 u del borde del objeto (w × h unidades)?
    const touchable = (o, w, h) => {
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const tx = Math.floor(o.x / TILE) + dx, ty = Math.floor(o.y / TILE) + dy;
        if (!seen.has(tx + ',' + ty)) continue;
        const gx = Math.max(Math.abs(tx * TILE + 16 - o.x) - w / 2, 0), gy = Math.max(Math.abs(ty * TILE + 16 - o.y) - h / 2, 0);
        if (Math.hypot(gx, gy) < 28) return true;
      }
      return false;
    };
    if (!st.vending || !touchable(st.vending, TILE, TILE)) fail(`${tag}: máquina expendedora inaccesible`);
    if (!st.phone || !touchable(st.phone, TILE, TILE)) fail(`${tag}: cabina inaccesible`);
    for (const p of map.props) {
      if (p.type === 'dumpster' && !touchable({ x: (p.x + p.w / 2) * TILE, y: (p.y + p.h / 2) * TILE }, p.w * TILE, p.h * TILE)) fail(`${tag}: contenedor (${p.x},${p.y}) inaccesible`);
    }
    if (st.coins.length < 2) fail(`${tag}: faltan monedas`);
    for (const c of st.coins) {
      if (!reach(c) || solid(c.tx, c.ty)) fail(`${tag}: moneda (${c.tx},${c.ty}) inaccesible`);
      if (hud(c.tx, c.ty)) fail(`${tag}: moneda bajo el HUD`);
    }
    if (st.npcs.length < 3) fail(`${tag}: pocos vagabundos`);
    for (const n of st.npcs) if (!reach(n) || solid(n.tx, n.ty)) fail(`${tag}: vagabundo (${n.tx},${n.ty}) mal colocado`);
    if (!st.fire) fail(`${tag}: sin fogata`);
    if (map.sewers.length < 3) fail(`${tag}: faltan alcantarillas`);
    for (const sw of map.sewers) {
      if (!reach(sw)) fail(`${tag}: alcantarilla inaccesible`);
      if (hud(sw.tx, sw.ty)) fail(`${tag}: alcantarilla bajo el HUD`);
      if (st.fire && Math.abs(sw.tx - st.fire.tx) + Math.abs(sw.ty - st.fire.ty) < 7) fail(`${tag}: alcantarilla pegada a la fogata`);
    }
  }
}
console.log(bad ? `\n${bad} PROBLEMAS EN LA CALLE` : 'Calle exterior correcta');
process.exit(bad ? 1 : 0);
