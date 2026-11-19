// PRUEBA DE CRUCE DE PUERTAS: comprueba que los enemigos no se atascan al cruzar las puertas de los pisos. Para cada puerta de cada piso, y en AMBOS sentidos, coloca
// 3 enemigos corrientes (grunt / corredor) a un lado, en persecución hacia un objetivo al otro, y mide cuánto tardan en llegar con el movimiento y las puertas REALES del juego
// (sin teletransportes). Si no llegan en `limit` s, repite ese cruce con `retryLimit` s para distinguir una ruta lenta de un atasco de verdad. Se ejecuta en el NAVEGADOR (necesita el
// juego completo), con el servidor de desarrollo:
//
//   1. `npm run dev` y abrir http://localhost:5173/hotline-clone/
//   2. En la consola del navegador (F12):
//        (await import('/hotline-clone/tools/smoke-doors.js')).run().then((r) => { console.table(r.fails); console.log(r.ok ? 'TODO CORRECTO' : 'HAY ATASCOS', r.tested, 'cruces'); })
//      (opciones: `run(game, { levels: [3], enemies: 3, limit: 12, retryLimit: 45 })`; `levels` son índices 0-9)
//
// Excluye la puerta principal y las que SELLA la trampa del piso 10 (`trap.doors`): esas se bloquean a propósito cuando el jugador pisa el despacho (la prueba coloca al jugador
// dentro, así que dispararía la trampa y parecería un atasco; fue el falso positivo de la puerta (18,5)). Las coordenadas que imprime son las de `LEVELS` (sin el anillo de calle).
// Limitaciones: solo enemigos normales (no blindados, pesados ni jefe), solo persecución (no patrulla ni alarmas con grupos grandes) y es una simulación, no una partida.
// Un atasco de verdad = no llegan ni con `retryLimit` s (p. ej. el barril y la caja del piso 4 que estrechaban el pasillo junto a una puerta). Tarda unos minutos con los 10 pisos.
import { isWallTile } from '../src/map.js';

const O = 6, T = 32;   // OUTSKIRT (anillo de calle) y tamaño de casilla

export async function run(g = window.game, { levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], enemies = 3, limit = 12, retryLimit = 45 } = {}) {
  if (!g) throw new Error('No hay window.game: abre el juego con `npm run dev` (en la build de producción no se expone)');
  const P = Object.getPrototypeOf(g);
  const saved = { kp: g.killPlayer, es: g.enemyStrike };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { P.update.call(g, 1 / 60); g.input.endStep(); } };
  const solid = (x, y) => isWallTile(g.map, x, y);
  const fails = [], slow = [];
  let tested = 0, skipped = 0;

  const setup = (lvl) => {
    g.fade = null; g.startRunAt(lvl, false); g.fade = null;
    g.maskIndex = 0; g.confirmMask();
    if (g.maskPhase === 'support') { g.maskIndex = 1; g.confirmMask(); }   // pisos con compañero (piso 10): segunda fase de máscara
    step(20); if (g.cine) g.cine.t = 999; step(250);
    g.killPlayer = () => {}; g.enemyStrike = () => {}; g.inside = true;
  };
  const trial = (lvl, doorPos, dir, seconds) => {
    setup(lvl);
    const pool = g.enemies.filter((e) => e.kind === 'grunt' || e.kind === 'runner');
    g.enemies.forEach((e) => { e.alive = false; e.x = -500; e.y = -500; });
    const door = g.doors.find((x) => x.tx === doorPos.tx && x.ty === doorPos.ty);
    const dx = door.horizontal ? 0 : 1, dy = door.horizontal ? 1 : 0;
    const pick = (s) => { for (const k of [3, 4, 2]) { const x = door.tx + dx * k * s, y = door.ty + dy * k * s; if (!solid(x, y)) return [x, y]; } return null; };
    const A = pick(dir), B = pick(-dir);
    if (!A || !B) return null;
    const E = pool.slice(0, enemies);
    E.forEach((e, i) => {
      e.alive = true; e.x = A[0] * T + 16 - (i ? dx * dir * i * 12 : 0); e.y = A[1] * T + 16 - (i ? dy * dir * i * 12 : 0);
      if (solid(Math.floor(e.x / T), Math.floor(e.y / T))) { e.x = A[0] * T + 16; e.y = A[1] * T + 16; }   // (que ninguno nazca dentro de un mueble)
      e.state = 'chase'; e.activity = 'patrol'; e.coverOk = false; e.gunDef = null; e.weapon = null; e.armed = false; e.timer = 0; e.path = null; e.scared = false;
    });
    const tx = B[0] * T + 16, ty = B[1] * T + 16, t = E.map(() => -1);
    for (let f = 0; f < 60 * seconds; f++) {
      g.player.x = tx; g.player.y = ty;
      E.forEach((e, i) => { if (e.state !== 'chase' && e.state !== 'down') e.state = 'chase'; e.target = { x: tx, y: ty }; if (t[i] < 0 && Math.hypot(e.x - tx, e.y - ty) < 60) t[i] = Math.round(f / 60); });
      step();
      if (t.every((x) => x >= 0)) break;
    }
    return { t, fin: E.map((e) => `${Math.floor(e.x / T) - O},${Math.floor(e.y / T) - O}`).join(' ') };
  };

  try {
    for (const lvl of levels) {
      setup(lvl);
      const pool = g.enemies.filter((e) => e.kind === 'grunt' || e.kind === 'runner');
      if (pool.length < enemies) { skipped++; continue; }
      const sealed = (g.trap ? g.trap.doors : []).map((d) => `${d.tx},${d.ty}`);
      const doors = g.doors.filter((d) => !d.main && d.tx >= O && d.ty >= O && !sealed.includes(`${d.tx},${d.ty}`)).map((d) => ({ tx: d.tx, ty: d.ty }));
      for (const d of doors) {
        for (const dir of [1, -1]) {
          const r = trial(lvl, d, dir, limit);
          if (!r) continue;
          tested++;
          if (r.t.some((x) => x < 0)) {
            const r2 = trial(lvl, d, dir, retryLimit);
            const stuck = !r2 || r2.t.some((x) => x < 0);
            (stuck ? fails : slow).push({ piso: lvl + 1, puerta: `(${d.tx - O},${d.ty - O})`, sentido: dir > 0 ? '+' : '-', [`${limit}s`]: r.t.join('/'), [`${retryLimit}s`]: r2 ? r2.t.join('/') : '?', quedanEn: stuck && r2 ? r2.fin : '' });
          }
        }
      }
    }
  } finally {
    g.killPlayer = saved.kp; g.enemyStrike = saved.es;
  }
  return { ok: fails.length === 0, tested, skipped, fails, slow };
}
