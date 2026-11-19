// PRUEBA DE HUMO del prólogo: un bot juega el prólogo entero sobre el bucle REAL del juego (sin teletransportes: mueve al jugador con las teclas, apunta y ataca)
// y comprueba que los flujos básicos avanzan y que no quedan cosas pegadas. Se ejecuta en el NAVEGADOR (el juego necesita canvas), con el servidor de desarrollo:
//
//   1. `npm run dev` y abrir http://localhost:5173/hotline-clone/
//   2. En la consola del navegador (F12):
//        (await import('/hotline-clone/tools/smoke-prologue.js')).run().then((r) => { console.table(r.checks); console.log(r.ok ? 'TODO CORRECTO' : 'HAY FALLOS', r.frames, 'pasos'); })
//
// Qué comprueba (cada línea es un `check` con ok / fallo): arranque del prólogo; entrada con la puerta cerrada por el agente (animación, cartel, agente intocable y dentro);
// un clic pasa directamente a la siguiente línea de diálogo; liberar al compañero (te sigue, con máscara y habla justo después); despejar (puerta pendiente → abrirla →
// «SALIDA ABIERTA»); salir en moto con el compañero SIN textos flotantes pegados (p. ej. «¡ESPERA A JACK!»); fin del prólogo (vuelve a la selección de máscara de la campaña
// y queda marcado como visto). Es una prueba de humo, no de dificultad: el jugador es invulnerable (`killPlayer` / `enemyStrike` anulados mientras corre).
// No toca récords ni estadísticas (el prólogo nunca los guarda); restaura la marca `neonrush.prologue.v1`.
import { findPath } from '../src/map.js';

const SEEN_KEY = 'neonrush.prologue.v1';

export async function run(g = window.game, { maxFrames = 60 * 360 } = {}) {
  if (!g) throw new Error('No hay window.game: abre el juego con `npm run dev` (en la build de producción no se expone)');
  const P = Object.getPrototypeOf(g), K = g.input.keys;
  const checks = [], log = [];
  const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info: String(info) }); if (!ok) log.push(`FALLO: ${name} ${info}`); };
  let frames = 0, click = 0, stage = 'inicio';
  const saved = { kp: g.killPlayer, es: g.enemyStrike, mw: g.mouseWorld, seen: localStorage.getItem(SEEN_KEY) };
  let aim = { x: 0, y: 0 }, path = null, pathT = 0, goal = null, freeTried = false;
  g.killPlayer = () => {};   // invulnerable (la prueba es de flujo, no de dificultad)
  g.enemyStrike = () => {};
  g.mouseWorld = () => aim;

  const keys = (dx, dy) => { ['KeyA', 'KeyD', 'KeyW', 'KeyS'].forEach((c) => K.delete(c)); if (dx > 3) K.add('KeyD'); if (dx < -3) K.add('KeyA'); if (dy > 3) K.add('KeyS'); if (dy < -3) K.add('KeyW'); };
  const release = () => { ['KeyA', 'KeyD', 'KeyW', 'KeyS'].forEach((c) => K.delete(c)); g.input.mouse.left = false; };
  // Desatasco: si en 45 pasos no se ha movido (p. ej. empujando la hoja de una puerta abierta, que un jugador rodearía), prueba a apartarse hacia arriba / abajo.
  let lastPos = { x: 0, y: 0, f: 0 }, jig = 0, jigDir = 1;
  const goTo = (x, y, stop = 12) => {
    const p = g.player;
    if (Math.hypot(x - p.x, y - p.y) < stop) { keys(0, 0); return true; }
    if (frames - lastPos.f >= 45) { if (Math.hypot(p.x - lastPos.x, p.y - lastPos.y) < 3) { jig = 30; jigDir = -jigDir; } lastPos = { x: p.x, y: p.y, f: frames }; }
    if (jig > 0) { jig--; keys(0, jigDir * 10); path = null; return false; }
    pathT -= 1 / 60;
    if (!path || pathT <= 0 || goal !== `${x},${y}`) { path = findPath(g.map, p.x, p.y, x, y); pathT = 0.4; goal = `${x},${y}`; }
    while (path && path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 10) path.shift();
    const n = (path && path[0]) || { x, y };
    keys(n.x - p.x, n.y - p.y);
    return false;
  };
  const clickNow = (gap = 40) => { if (frames - click > gap) { click = frames; g.input.mousePressed.left = true; return true; } return false; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { P.update.call(g, 1 / 60); g.input.endStep(); frames++; } };
  const until = (cond, max, onTick) => { for (let i = 0; i < max && frames < maxFrames; i++) { if (cond()) return true; if (onTick) onTick(); step(); } return cond(); };

  try {
    // --- A) arranque -------------------------------------------------------------------------------------------------
    stage = 'arranque';
    localStorage.removeItem(SEEN_KEY);
    g.fade = null; g.startRunAt(0, true); g.fade = null; g.maskIndex = 0; g.confirmMask();
    until(() => g.state === 'arriving', 30);
    until(() => g.state === 'playing', 600, () => { if (g.cine) g.cine.t = 999; });
    check('el prólogo arranca (prologue, estado playing, nombre)', g.prologue && g.state === 'playing' && /PRÓLOGO/.test(g.levelName), `${g.state} ${g.levelName}`);
    check('hay un compañero atado (rehén partner) y 4 enemigos', g.hostages.list.length === 1 && g.hostages.list[0].partner && g.hostages.list[0].state === 'tied' && g.enemies.length === 4);
    const h = g.hostages.list[0], door = g.mainDoor;

    // --- B) entrar: la puerta la cierra el agente ------------------------------------------------------------------
    stage = 'entrada';
    let sawAnim = false, invulnerable = null;
    until(() => g.inside && !g.player.doorAnim && sawAnim, 60 * 60, () => {
      if (g.comms.cur) { release(); clickNow(); return; }
      if (g.player.doorAnim) { sawAnim = true; release(); if (invulnerable === null) { const st = g.state; saved.kp.call(g, 0); invulnerable = g.state === st && g.player.alive; } return; }
      goTo(g.entry.x, g.entry.y - 14, 10);
    });
    release(); step(40);
    check('al entrar se reproduce la animación de cerrar la puerta', sawAnim);
    check('la puerta queda bloqueada, con el cartel PUERTA CERRADA, y el agente dentro', door.locked && g.player.y < door.cy && (g.callout ? /PUERTA CERRADA/.test(g.callout.text) : g.inside), `locked=${door.locked} y=${Math.round(g.player.y)} puerta=${Math.round(door.cy)}`);
    check('el agente es intocable mientras cierra la puerta', invulnerable === true);

    // --- C) un clic avanza directo ---------------------------------------------------------------------------------
    stage = 'dialogos';
    while (g.comms.cur) { release(); clickNow(10); step(); if (frames > maxFrames) break; }
    g.comms.say('smoke', [{ speaker: 'central', text: 'Primera línea larga, para que no termine de teclearse enseguida.' }, { speaker: 'central', text: 'Segunda.' }], { urgent: true });
    step(30);
    const first = g.comms.cur && g.comms.cur.text.slice(0, 8);
    g.input.mousePressed.left = true; step(1);
    check('un clic pasa directo a la siguiente línea (sin completar el texto)', first === 'Primera ' && g.comms.cur && g.comms.cur.text.startsWith('Segunda'), `${first} → ${g.comms.cur && g.comms.cur.text}`);
    g.input.mousePressed.left = true; step(20); g.input.mousePressed.left = true; step(2);
    check('al acabar las líneas, el diálogo se cierra y el mundo se reanuda', !g.comms.cur);

    // --- D) combate y liberar al compañero ------------------------------------------------------------------------
    stage = 'combate y compañero';
    let freedAt = -1, talkedAt = -1;
    const fight = () => {
      const p = g.player, alive = g.enemies.filter((e) => e.alive);
      if (g.state === 'scuffle') { if (frames % 3 === 0) g.input.mousePressed.left = true; return; }
      if (g.comms.cur) { release(); if (freedAt >= 0 && talkedAt < 0) talkedAt = frames; clickNow(); return; }
      if (p.doorAnim) { release(); return; }
      if (!p.weapon) { const pk = g.pickups.find((q) => q.alive && !q.flying && q.type === 'pipe'); if (pk && Math.hypot(pk.x - p.x, pk.y - p.y) < 500) { if (goTo(pk.x, pk.y, 14)) g.input.vpressed.add('throw'); return; } }
      const down = alive.find((e) => e.state === 'down' && Math.hypot(e.x - p.x, e.y - p.y) < 70);
      if (down) { aim = { x: down.x, y: down.y }; goTo(down.x, down.y, 20); g.input.vpressed.add('execute'); g.input.mouse.left = true; return; }
      if (h.state === 'tied' && !alive.some((e) => Math.hypot(e.x - h.x, e.y - h.y) < 200)) {
        if (goTo(h.x - 20, h.y, 8)) { aim = { x: h.x, y: h.y }; g.input.vpressed.add('kick'); if (!freeTried) { freeTried = true; freedAt = frames; } }
        return;
      }
      const t = alive.filter((e) => e.state !== 'down').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (!t) { release(); return; }
      aim = { x: t.x, y: t.y };
      if (Math.hypot(t.x - p.x, t.y - p.y) > (p.weapon ? 34 : 24)) { goTo(t.x, t.y, 24); g.input.mouse.left = false; } else { keys(0, 0); g.input.mouse.left = true; }
    };
    until(() => g.state === 'cleared', 60 * 150, fight);
    release();
    check('el compañero se libera y te sigue (o ya sale con el piso despejado)', freedAt >= 0 && ['follow', 'freed', 'waiting', 'exiting', 'ready'].includes(h.state), h.state);
    check('el compañero lleva la máscara cedida', h.masked === true);
    check('el compañero habla justo después de liberarlo (≤ 30 pasos)', freedAt >= 0 && talkedAt >= 0 && talkedAt - freedAt <= 30, `${talkedAt - freedAt} pasos`);
    check('se despeja el edificio (estado cleared)', g.state === 'cleared', g.state);

    // --- E) abrir la puerta de salida --------------------------------------------------------------------------------
    stage = 'salida';
    check('con el piso despejado la puerta sigue bloqueada y pendiente de abrir', door.locked && g.doorPending, `locked=${door.locked} pending=${g.doorPending}`);
    let sawOpen = false;
    until(() => !door.locked, 60 * 40, () => {
      if (g.comms.cur) { release(); clickNow(); return; }
      if (g.player.doorAnim) { release(); return; }
      goTo(g.entry.x, g.entry.y, 8);
    });
    step(30);
    sawOpen = g.callout && /SALIDA ABIERTA/.test(g.callout.text);
    check('el agente abre la puerta y sale el cartel SALIDA ABIERTA', !door.locked && (sawOpen || g.doorPending === false), `locked=${door.locked}`);

    // --- F) salir en moto sin textos pegados ---------------------------------------------------------------------
    stage = 'fuga';
    let stuckFloat = null, leavingFrames = 0, injected = false, rideState = null;
    const bx = g.bike.park.x + 12, by = g.bike.park.y - 30;
    until(() => g.state === 'masks' || g.state === 'results', 60 * 90, () => {
      if (g.state === 'leaving') {
        release();
        if (!injected) { injected = true; rideState = h.state; g.addFloat(g.player.x, g.player.y - 22, '¡ESPERA A TEST!', '#9be32a', 1, 1.4); }   // lo que pasaba con «¡ESPERA A JACK!»
        leavingFrames++;
        if (leavingFrames === 110) stuckFloat = g.floatingTexts.find((f) => /ESPERA A TEST/.test(f.text)) || null;
        return;
      }
      if (g.state !== 'cleared') return;
      if (g.comms.cur) { release(); clickNow(); return; }
      if (g.player.doorAnim) { release(); return; }
      goTo(bx, by, 6);
    });
    check('la fuga arranca con el compañero a bordo (riding)', injected && rideState === 'riding', `${rideState}`);
    check('los textos flotantes caducan durante la fuga (no queda «¡ESPERA A …!» pegado)', injected && stuckFloat === null);

    // --- G) fin ---------------------------------------------------------------------------------------------------------
    stage = 'fin';
    until(() => g.state === 'masks', 60 * 20);
    check('al acabar vuelve a la selección de máscara de la campaña (prologue apagado)', g.state === 'masks' && g.prologue === false, `${g.state} prologue=${g.prologue}`);
    check('el prólogo queda marcado como visto', localStorage.getItem(SEEN_KEY) === '1');
    check('no queda nada pegado en pantalla (sin textos flotantes ni diálogo)', g.floatingTexts.length === 0 && !g.comms.cur);
  } catch (e) {
    check(`excepción en la etapa «${stage}»`, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
  } finally {
    release();
    g.killPlayer = saved.kp; g.enemyStrike = saved.es; g.mouseWorld = saved.mw;
    if (saved.seen === null) localStorage.removeItem(SEEN_KEY); else localStorage.setItem(SEEN_KEY, saved.seen);
  }
  return { ok: checks.every((c) => c.ok), checks, log, frames };
}
