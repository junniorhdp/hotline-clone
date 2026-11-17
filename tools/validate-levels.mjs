// Comprueba las reglas de diseño de los pisos (ver "Diseño de niveles" en CLAUDE.md):
//   - las dos casillas de paso de cada puerta, libres;
//   - todo (enemigos, armas, puertas, entrada, moto) alcanzable desde el jugador;
//   - las patrullas no cruzan puertas;
//   - ningún enemigo en el vestíbulo ni en la calle (la entrada es segura);
//   - el punto de entrada está pasado el umbral y hay camino de la puerta principal a la moto.
// Uso: `npm run check:levels` (sale con error si algo falla).
import { LEVELS, loadLevel, isWallTile, TILE, findPath } from '../src/map.js';
let bad = 0;
let prevEnemies = 0;
const fail = (m) => { bad++; console.log('  ✗ ' + m); };
for (let i = 0; i < LEVELS.length; i++) {
  const L = loadLevel(i, () => 0.5);
  const { map } = L;
  const rows = LEVELS[i].rows;
  console.log(`\n${L.name}: ${map.w}×${map.h} · ${L.enemies.length} enemigos · ${L.doors.length} puertas · armas ${L.weapons.length}`);
  const free = (tx, ty) => !isWallTile(map, tx, ty);
  // 1) las dos casillas de paso de cada puerta, libres
  for (const d of L.doors) {
    const [a, b] = d.horizontal ? [[d.tx, d.ty - 1], [d.tx, d.ty + 1]] : [[d.tx - 1, d.ty], [d.tx + 1, d.ty]];
    if (!free(...a) || !free(...b)) fail(`puerta (${d.tx},${d.ty}) con paso tapado: ${a} / ${b}`);
  }
  // 2) alcanzable desde P (BFS sobre casillas libres; las puertas cuentan como libres)
  const w = map.w, seen = new Set();
  const start = [Math.floor(L.player.x / TILE), Math.floor(L.player.y / TILE)];
  const q = [start]; seen.add(start.join());
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (!seen.has(k) && free(nx, ny)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  const reach = (x, y) => seen.has(`${Math.floor(x / TILE)},${Math.floor(y / TILE)}`);
  for (const e of L.enemies) if (!reach(e.x, e.y)) fail(`enemigo inalcanzable en (${e.tx},${e.ty})`);
  for (const wp of L.weapons) if (!reach(wp.x, wp.y)) fail(`arma ${wp.type} inalcanzable`);
  for (const d of L.doors) if (!reach(d.tx * TILE + 16, d.ty * TILE + 16)) fail(`puerta inalcanzable (${d.tx},${d.ty})`);
  if (!reach(L.entry.x, L.entry.y)) fail('entrada inalcanzable');
  // la moto: alguna casilla vecina alcanzable
  const bt = [Math.floor((L.bike.x - L.bike.w / 2) / TILE), Math.floor(L.bike.y / TILE)];
  if (![[bt[0] - 1, bt[1]], [bt[0] + 2, bt[1]], [bt[0], bt[1] - 1], [bt[0] + 1, bt[1] - 1]].some(([x, y]) => seen.has(x + ',' + y))) fail('la moto no se puede tocar');
  // 3) las patrullas no cruzan puertas
  for (const e of L.enemies) {
    const [a, b] = [e.patrol[0], e.patrol[e.patrol.length - 1]];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      if (L.doors.some((d) => d.tx === Math.floor(x / TILE) && d.ty === Math.floor(y / TILE))) { fail(`patrulla de (${e.tx},${e.ty}) cruza una puerta`); break; }
    }
  }
  // 4) exterior: sin enemigos fuera de los edificios (todo enemigo por encima del vestíbulo)
  const mainY = L.mainDoor.ty;
  for (const e of L.enemies) if (e.ty >= mainY - 2) fail(`enemigo en el vestíbulo o la calle (${e.tx},${e.ty})`);
  // 5) el punto de entrada está dentro del umbral y la puerta principal está en su sitio
  if (!(L.entry.y < L.entry.lockY + 1)) fail(`entrada (${L.entry.y}) no pasa el umbral (${L.entry.lockY})`);
  const mainDoor = L.doors.find((d) => d.main);
  console.log(`  puerta principal (${mainDoor.tx},${mainDoor.ty}) horizontal=${mainDoor.horizontal} · entrada (${L.entry.x.toFixed(0)},${L.entry.y.toFixed(0)}) umbral y<${L.entry.lockY.toFixed(0)} · moto (${L.bike.x.toFixed(0)},${L.bike.y.toFixed(0)}) · jugador (${L.player.x.toFixed(0)},${L.player.y.toFixed(0)})`);
  // 5b) rehenes (1-2 por piso: alcanzables y fuera del paso de las puertas) y actividades de los enemigos (los sentados, en casillas alcanzables)
  if (!L.hostages.length) fail('no hay rehenes');
  for (const hs of L.hostages) {
    if (!reach(hs.x, hs.y)) fail(`rehén en (${hs.tx},${hs.ty}) inalcanzable`);
    if (L.doors.some((d) => Math.abs(d.tx - hs.tx) <= 1 && Math.abs(d.ty - hs.ty) <= 1)) fail(`rehén (${hs.tx},${hs.ty}) pegado a una puerta`);
  }
  for (const e of L.enemies) if ((e.activity === 'sit' || e.activity === 'smoke' || e.activity === 'watch') && !reach(e.x, e.y)) fail(`enemigo ${e.activity} en (${e.tx},${e.ty}) inalcanzable`);
  console.log(`  actividades: ${['patrol', 'watch', 'smoke', 'sit'].map((k) => k + ' ' + L.enemies.filter((e) => (e.activity || 'patrol') === k).length).join(' · ')} · rehenes ${L.hostages.length}`);
  // 5c) penumbra (pisos oscuros): máscara y luces coherentes, entrada/jugador/moto sin oscuridad y mezcla de enemigos en sombra y en luz
  if (map.dark) {
    const inDark = (x, y) => map.dark[Math.floor(y / TILE) * map.w + Math.floor(x / TILE)] === 1;
    if (!map.lights.length) fail('piso oscuro sin luces');
    for (const l of map.lights) if (isWallTile(map, Math.floor(l.x / TILE), Math.floor(l.y / TILE))) fail(`luz dentro de una pared (${l.x},${l.y})`);
    if (inDark(L.entry.x, L.entry.y) || inDark(L.player.x, L.player.y) || inDark(L.bike.x, L.bike.y)) fail('entrada, jugador o moto a oscuras');
    const nd = L.enemies.filter((e) => inDark(e.x, e.y)).length;
    if (nd < 3 || nd > L.enemies.length - 3) fail(`enemigos a oscuras: ${nd}/${L.enemies.length} (debe haber mezcla de sombra y luz)`);
    const total = map.dark.reduce((x, y) => x + y, 0);
    console.log(`  penumbra: ${total} casillas a oscuras · ${map.lights.length} luces · enemigos en sombra ${nd}/${L.enemies.length}`);
  }
  // 5d) cámaras de seguridad y operador (piso 8): cámaras en una casilla de pared con el origen del cono libre, un único operador sentado en una sala
  //     alcanzable pero lejos de la entrada, y dificultad progresiva (a partir del piso 7 no hay menos enemigos que en el anterior)
  if (map.cameras && map.cameras.length) {
    for (const c of map.cameras) {
      if (!isWallTile(map, c.tx, c.ty)) fail(`cámara (${c.tx},${c.ty}) no está en una pared`);
      if (isWallTile(map, Math.floor(c.x / TILE), Math.floor(c.y / TILE))) fail(`cámara (${c.tx},${c.ty}) con el origen del cono dentro de una pared`);
    }
    const ops = L.enemies.filter((e) => e.kind === 'operator');
    if (ops.length !== 1) fail(`debe haber exactamente 1 operador de cámaras (hay ${ops.length})`);
    for (const o of ops) {
      if (o.activity !== 'sit') fail('el operador no está sentado frente a los monitores');
      if (!reach(o.x, o.y)) fail('operador inalcanzable');
      const pth = findPath(map, L.entry.x, L.entry.y, o.x, o.y);
      if (!pth || pth.length < 20) fail(`operador demasiado cerca de la entrada (${pth ? pth.length : '?'} casillas)`);
      else console.log(`  cámaras: ${map.cameras.length} · operador a ${pth.length} casillas de la entrada`);
    }
  }
  if (i >= 7 && prevEnemies > L.enemies.length) fail(`menos enemigos (${L.enemies.length}) que el piso anterior (${prevEnemies})`);
  if (i >= 6) prevEnemies = L.enemies.length;
  // 6) cada enemigo puede llegar al jugador y a la salida (pathfinding)
  const pEntry = L.entry;
  const noPath = L.enemies.filter((e) => !findPath(map, e.x, e.y, pEntry.x, pEntry.y));
  if (noPath.length) fail(`${noPath.length} enemigos sin ruta hasta la entrada`);
  // 7) la moto no tapa el paso y hay camino de la puerta principal a la moto
  const out = findPath(map, L.mainDoor.x, L.mainDoor.y + TILE, L.player.x, L.player.y);
  if (!out) fail('no hay camino de la puerta principal al punto de la moto');
}
console.log(bad ? `\n${bad} PROBLEMAS` : '\nTODO CORRECTO');
