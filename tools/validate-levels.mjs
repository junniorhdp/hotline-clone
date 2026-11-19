// Comprueba las reglas de diseño de los pisos (ver "Diseño de niveles" en CLAUDE.md):
//   - las dos casillas de paso de cada puerta, libres;
//   - todo (enemigos, armas, puertas, entrada, moto) alcanzable desde el jugador;
//   - las patrullas no cruzan puertas;
//   - ningún enemigo en el vestíbulo ni en la calle (la entrada es segura);
//   - el punto de entrada está pasado el umbral y hay camino de la puerta principal a la moto.
// Uso: `npm run check:levels` (sale con error si algo falla).
import { LEVELS, loadLevel, isWallTile, TILE, findPath } from '../src/map.js';
import { PROLOGUE_DEF } from '../src/prologue.js';
let bad = 0;
let prevEnemies = 0;
const fail = (m) => { bad++; console.log('  ✗ ' + m); };
// El prólogo (src/prologue.js) se valida como un piso más (índice LEVELS.length: usa los datos del piso 1 salvo `override`).
for (let n = 0; n <= LEVELS.length; n++) {
  const pro = n === LEVELS.length, i = pro ? 0 : n;
  const L = loadLevel(i, () => 0.5, pro ? PROLOGUE_DEF : null);
  const { map } = L;
  const rows = (pro ? PROLOGUE_DEF : LEVELS[i]).rows;
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
  if (!L.hostages.length && !L.noHostages) fail('no hay rehenes');
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
  // 5e) blindados (piso 9): al menos 2, con espacio para flanquearlos (casillas libres alrededor), una escopeta garantizada y barricadas en la sala
  const shields = L.enemies.filter((e) => e.kind === 'shield');
  if (shields.length) {
    if (shields.length < (i === 8 ? 2 : 1)) fail(`pocos blindados (${shields.length})`);
    for (const z of shields) {
      let free = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!isWallTile(map, z.tx + dx, z.ty + dy)) free++;
      if (free < 18) fail(`blindado en (${z.tx},${z.ty}) sin espacio para flanquearlo (${free}/25 libres)`);
    }
    if (!L.weapons.some((w) => w.type === 'shotgun')) fail('piso con blindados sin escopeta en el suelo');
    console.log(`  blindados: ${shields.length} · escopetas en el suelo ${L.weapons.filter((w) => w.type === 'shotgun').length}`);
  }
  // 5f) trampa de gas (piso 10): despacho sellable con 2 puertas alcanzables, ventilación en una pared con casilla exterior alcanzable desde la entrada, sin enemigos
  //     dentro y con un recorrido de la entrada a la ventilación que ni es trivial (≥ 10 casillas) ni excede el 70 % del tiempo del gas a velocidad base
  if (L.trap) {
    const T = L.trap, GAS_TIME = 60, BASE_SPEED = 228;
    if (T.doors.length !== 2) fail(`el despacho debe tener 2 puertas sellables (${T.doors.length})`);
    for (const d of T.doors) if (!L.doors.some((x) => x.tx === d.tx && x.ty === d.ty)) fail(`puerta del despacho (${d.tx},${d.ty}) no existe`);
    const insideRoom = (tx, ty) => tx >= T.room.x0 && tx <= T.room.x1 && ty >= T.room.y0 && ty <= T.room.y1;
    if (L.enemies.some((e) => insideRoom(e.tx, e.ty))) fail('hay enemigos dentro del despacho sellable');
    const v = T.vent;
    if (!isWallTile(map, v.tx, v.ty)) fail('la ventilación no está en una pared');
    if (isWallTile(map, Math.floor(v.sx / TILE), Math.floor(v.sy / TILE)) || insideRoom(Math.floor(v.sx / TILE), Math.floor(v.sy / TILE))) fail('la casilla exterior de la ventilación está ocupada o dentro del despacho');
    if (!(T.trigger.x1 >= T.trigger.x0 && T.trigger.y1 >= T.trigger.y0)) fail('el centro del despacho (disparador de la trampa) es vacío');
    const toVent = findPath(map, L.entry.x, L.entry.y, v.sx, v.sy);
    if (!toVent) fail('la ventilación es inalcanzable desde la entrada');
    else {
      const need = (toVent.length * TILE) / BASE_SPEED;
      if (toVent.length < 10) fail(`ventilación demasiado cerca de la entrada (${toVent.length} casillas)`);
      if (need > GAS_TIME * 0.7) fail(`ventilación demasiado lejos: ${need.toFixed(1)} s de recorrido > 70 % de ${GAS_TIME} s`);
      const toRoom = findPath(map, L.entry.x, L.entry.y, T.center.x, T.center.y);
      if (!toRoom) fail('el centro del despacho es inalcanzable desde la entrada');
      else console.log(`  trampa: entrada → despacho ${toRoom.length} casillas · entrada → ventilación ${toVent.length} casillas (${need.toFixed(1)} s de ${GAS_TIME})`);
    }
  }
  // 5g) fase final del piso 10: ambos finales alcanzables. LIMPIEZA: todos los enemigos llegan al despacho; PERÍMETRO: el punto exterior (calle, al sur de la puerta principal) y los 12
  //     puntos de aparición de oleadas (6 por extremo de la calle) son suelo libre y conectados entre sí por la calle
  if (L.trap && L.trap.ext) {
    const T = L.trap, free = (p) => !isWallTile(map, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (!free(T.ext)) fail('el punto exterior del perímetro está ocupado');
    for (const [side, list] of Object.entries(T.spawns)) {
      for (const sp of list) {
        if (!free(sp)) fail(`punto de aparición de oleada (${side}) ocupado en (${Math.floor(sp.x / TILE)},${Math.floor(sp.y / TILE)})`);
        else if (!findPath(map, sp.x, sp.y, T.ext.x, T.ext.y)) fail(`punto de aparición (${side}) sin camino hasta el perímetro`);
      }
    }
    const unreachable = L.enemies.filter((e) => !findPath(map, e.x, e.y, T.center.x, T.center.y)).length;
    if (unreachable) fail(`${unreachable} enemigos no pueden llegar al despacho (final LIMPIEZA)`);
    console.log('  fase final: perímetro y limpieza alcanzables (12 puntos de aparición de oleadas)');
  }
  // 5h) trampilla de la emboscada (piso 10): existe, sus 2×2 casillas son suelo libre y alcanzable fuera del despacho, sin enemigos ni puertas encima (a ≥ 2 casillas de cualquier puerta)
  if (L.trap) {
    const h = L.trap.hatch;
    if (!h) fail('el piso con trampa no tiene trampilla');
    else {
      const tiles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [h.tx + dx, h.ty + dy]);
      const R = L.trap.room;
      for (const [tx, ty] of tiles) {
        if (isWallTile(map, tx, ty)) fail(`la trampilla toca una pared o un mueble en (${tx},${ty})`);
        if (tx >= R.x0 && tx <= R.x1 && ty >= R.y0 && ty <= R.y1) fail('la trampilla está dentro del despacho');
        if (L.doors.some((d) => Math.abs(d.tx - tx) < 2 && Math.abs(d.ty - ty) < 2)) fail(`la trampilla está a menos de 2 casillas de una puerta ((${tx},${ty}))`);
        if (L.enemies.some((e) => e.tx === tx && e.ty === ty)) fail(`hay un enemigo sobre la trampilla (${tx},${ty})`);
      }
      if (!findPath(map, L.entry.x, L.entry.y, h.x, h.y)) fail('la trampilla es inalcanzable desde la entrada');
      else console.log('  trampilla: suelo libre, alcanzable y lejos de puertas');
    }
  }
  // 5i) final del piso 10: el detonador está en el despacho (suelo libre y alcanzable) y el punto de encuentro junto a la moto es suelo libre, alcanzable desde el despacho y desde la calle
  if (L.trap) {
    const T = L.trap, free = (p) => !isWallTile(map, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (!T.detonator) fail('el piso con trampa no tiene detonador');
    else {
      const R = T.room, d = T.detonator;
      if (!(d.tx >= R.x0 && d.tx <= R.x1 && d.ty >= R.y0 && d.ty <= R.y1)) fail('el detonador no está dentro del despacho');
      if (!free(d) || !findPath(map, L.entry.x, L.entry.y, d.x, d.y)) fail('el detonador está tapado o es inalcanzable');
    }
    const M = T.meet;
    if (!free(M) || !free({ x: M.x - 14, y: M.y }) || !free({ x: M.x + 14, y: M.y })) fail('el punto de encuentro (beso) está ocupado');
    else if (!findPath(map, T.center.x, T.center.y, M.x - 14, M.y)) fail('el punto de encuentro es inalcanzable desde el despacho');
    else if (!findPath(map, T.ext.x, T.ext.y, M.x + 14, M.y)) fail('el punto de encuentro es inalcanzable desde la calle');
    else console.log('  final: detonador y punto de encuentro alcanzables');
  }
  // 6) cada enemigo puede llegar al jugador y a la salida (pathfinding)
  const pEntry = L.entry;
  const noPath = L.enemies.filter((e) => !findPath(map, e.x, e.y, pEntry.x, pEntry.y));
  if (noPath.length) fail(`${noPath.length} enemigos sin ruta hasta la entrada`);
  // 7) la moto no tapa el paso y hay camino de la puerta principal a la moto
  const out = findPath(map, L.mainDoor.x, L.mainDoor.y + TILE, L.player.x, L.player.y);
  if (!out) fail('no hay camino de la puerta principal al punto de la moto');
}
console.log(bad ? `\n${bad} PROBLEMAS` : '\nTODO CORRECTO');
