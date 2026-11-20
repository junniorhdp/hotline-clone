import { drawText, measureText } from './pixelfont.js';
import { talkBlips, voiceFor } from './comms.js';
import { AGENTS } from './portraits.js';
import { TILE, OUTSKIRT } from './map.js';
import { pixelRect } from './sprites.js';
import { hostileCivCount, friendlyCivCount } from './street.js';
import { drawHooks, drawMonitors, drawServiceRoom, drawKarmaStreet, drawBirdCoin, roomGeom, AMBER } from './lore-art.js';

// SISTEMA NARRATIVO DE PISTAS Y VIÑETAS. Piezas cortas y misteriosas entre bloques o pisos; este módulo decide CUÁNDO puede salir cada una y reproduce las viñetas.
//
// Reglas de ciclo de vida:
//  · cada pieza se dispara COMO MUCHO UNA VEZ POR PARTIDA: `seen` se vacía al empezar partida (`startRun`) y NO con R (`reset` no lo toca);
//  · si la partida empieza desde el selector de pisos, las piezas de pisos ANTERIORES al de salida se descartan (`startFloor`), para que no se acumulen;
//  · NUNCA en pleno combate: cada pieza declara los momentos en que puede salir (`moments`: llegada, selección de máscara, exploración tranquila, piso despejado, resultados) y no sale con enemigos alerta;
//  · se saltan manteniendo ESPACIO / ENTER 1,2 s (en táctil, el dedo): la mecánica de `Game.holdSkip` de las cinemáticas.
// Presupuesto de ritmo: por piso, como máximo 1 pieza de nivel A (escenas, ≤ 30 s en total) y 2 de nivel B (ambiente sin pausa ni texto) o C (interactivos a pie de objeto), con al menos
// SEP s entre piezas. `exempt` (el final) no consume presupuesto ni separación.
// Opción OPCIONES → JUEGO → PISTAS DE HISTORIA (`hintsOn`): en NO solo salen las piezas `skeleton` (V1, V7 y la llamada del piso 6) y NO se dibuja el decorado narrativo (cuarto de servicio, calle vacía).
export const SEP = 30;
const A = 'A', B = 'B', C = 'C';
const CALM = ['arrival', 'explore', 'cleared'];  // momentos en los que no puede haber enemigos en alerta
export const PIECES = {
  v1: { level: A, floor: 0, skeleton: true, moments: ['masks'] },                  // LA LISTA: tras el prólogo, antes de elegir máscara en el piso 1
  v2: { level: A, floor: 1, moments: ['arrival'] },                                // EL ASIENTO: al bajar de la moto en el piso 2
  v3: { level: A, floor: 2, moments: ['masks'] },                                  // LOS GANCHOS: selección de máscara del piso 3
  v4: { level: C, floor: 2, moments: ['explore'] },                                // ALGUIEN VIVIÓ AQUÍ: la radio del cuarto de servicio del piso 3
  call6: { level: A, floor: 5, skeleton: true, moments: ['cleared'] },             // LLAMADA DE CENTRAL: tras el jefe, con el piso despejado y el jugador en la calle
  v5: { level: A, floor: 7, moments: ['explore'] },                                // LA GRABACIÓN: los monitores del piso 8
  v6: { level: A, floor: 9, moments: ['arrival'] },                                // LA CALLE VACÍA: llegada al piso 10
  v4echo: { level: C, floor: 9, moments: ['explore'] },                            // el eco: la radio del cuarto de servicio del piso 10
  v7: { level: A, floor: 9, skeleton: true, exempt: true, moments: ['results'] },  // CARA O CRUZ: tras la salida del final, antes de los resultados
  pile: { level: B, floor: 4, moments: ['cleared'] },                              // LA PILA DE CUERPOS: al despejar el piso 5, con la puerta aún cerrada
  // Teléfonos de la calle: una llamada o grabación fija por piso (nivel C: interactivas a pie de objeto). El piso 6 no tiene: allí llama CENTRAL tras el jefe (`call6`).
  ph1: { level: C, floor: 0, moments: ['explore'] }, ph2: { level: C, floor: 1, moments: ['explore'] }, ph3: { level: C, floor: 2, moments: ['explore'] },
  ph4: { level: C, floor: 3, moments: ['explore'] }, ph5: { level: C, floor: 4, moments: ['explore'] }, ph7: { level: C, floor: 6, moments: ['explore'] },
  ph8: { level: C, floor: 7, moments: ['explore'] }, ph9: { level: C, floor: 8, moments: ['explore'] }, ph10: { level: C, floor: 9, moments: ['explore'] },
};

// --- Guiones de las viñetas (línea tecleada: `at` s, texto, color; `cues`: sonidos con las voces ya existentes; `draw`: arte propio; `textY`: fila del texto) -----------------------------------
const SCRIPTS = {
  // V1 · LA LISTA (7 s): negro, lluvia lejana y estática; «UNO.» (pausa 0,8 s) «DOS.» (pausa 1,6 s) y un cursor que parpadea EXACTAMENTE tres veces antes de apagarse; clic de máscara.
  v1: {
    dur: 7,
    lines: [{ at: 0.6, text: 'UNO.', color: AMBER }, { at: 1.7, text: 'DOS.', color: AMBER }],
    cursor: { row: 2, blinks: [[3.7, 4.15], [4.5, 4.95], [5.3, 5.75]] },
    cues: [{ at: 0, sound: 'rain', vol: 1 }, { at: 0.15, sound: 'empty', vol: 0.8 }, { at: 6.1, sound: 'maskOn', vol: 0.7 }],
  },
  // V3 · LOS GANCHOS (6 s): seis ganchos, cinco máscaras y el sexto vacío con la sombra de un águila (o el águila colgada si ya tienes la máscara de Rick).
  v3: {
    dur: 6, draw: 'hooks', textY: 0.62,
    lines: [{ at: 1.2, text: 'SEIS GANCHOS.', color: AMBER }, { at: 2.8, text: 'CINCO MÁSCARAS.', color: AMBER }],
    cues: [{ at: 0.2, sound: 'creak', vol: 0.7 }, { at: 3.6, sound: 'creak', vol: 0.5 }],
  },
  // V5 · LA GRABACIÓN (6 s): tres monitores; dos con estática y el tercero con una grabación vieja de un agente con máscara de águila que camina hacia la cámara y mira arriba. Silbido de cinta.
  v5: {
    dur: 6, draw: 'monitors', textY: 0.7, center: true,
    lines: [{ at: 1.4, text: 'ARCHIVO 03 · SUBSUELO', color: AMBER }],
    cues: [{ at: 0.1, sound: 'empty', vol: 0.6 }, { at: 0.3, sound: 'tapeWhine', vol: 1 }, { at: 4.2, sound: 'tapeWhine', vol: 0.6 }],
  },
  // V7 · CARA O CRUZ: una moneda gira sobre la mesa del cuarto de servicio, cada vez más despacio; justo antes de caer, corte a negro con el sonido de la moneda parándose; «UNO. DOS.» y nada más.
  v7: {
    dur: 10,
    lines: [{ at: 6.4, text: 'UNO. DOS.', color: AMBER }],
    cues: [{ at: 0.4, sound: 'coin', vol: 0.5 }, { at: 1.5, sound: 'coin', vol: 0.5 }, { at: 2.8, sound: 'coin', vol: 0.5 }, { at: 4.2, sound: 'coin', vol: 0.5 }, { at: 5.6, sound: 'coin', vol: 0.7 }],
    draw: 'coin', coinEnd: 5.6,
  },
};

// Viñeta a pantalla completa (se dibuja sobre cualquier estado y congela el juego mientras dura).
class Vignette {
  constructor(game, def, onEnd) {
    this.g = game; this.def = def; this.onEnd = onEnd;
    this.t = 0; this.cueIdx = 0; this.skipHold = 0; this.skipArm = false;
    this.voice = voiceFor(null, null); // voz de radio (CENTRAL)
  }

  update(dt) {
    const d = this.def, g = this.g, t0 = this.t;
    this.t += dt;
    if (g.holdSkip(this, dt)) this.t = d.dur;
    while (this.cueIdx < (d.cues || []).length && d.cues[this.cueIdx].at <= this.t) { const c = d.cues[this.cueIdx++]; g.sfx.play(c.sound, c.vol ?? 1, c.arg); }
    for (const L of d.lines || []) {
      const n = (t) => Math.max(0, Math.min(L.text.length, Math.floor((t - L.at) * 14)));
      talkBlips(g, this.voice, L.text, n(t0), n(this.t));
    }
    return this.t >= d.dur;
  }

  draw(ctx, w, h) {
    const d = this.def, g = this.g, t = this.t;
    const fade = Math.min(1, t / 0.3, Math.max(0, (d.dur - t) / 0.4));
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (d.draw === 'coin') this.drawCoin(ctx, w, h, t);
    else if (d.draw === 'hooks') drawHooks(ctx, w, h, t, g);
    else if (d.draw === 'monitors') drawMonitors(ctx, w, h, t);
    const scale = w >= 300 ? 2 : 1, y0 = Math.round(h * (d.textY || 0.42)), lh = 12 * scale + 6;
    (d.lines || []).forEach((L, i) => {
      const n = Math.max(0, Math.min(L.text.length, Math.floor((t - L.at) * 14)));
      const x = d.cursor ? Math.round(w / 2 - measureText('UNO.') * scale / 2) : Math.round(w / 2 - measureText(L.text) * scale / 2);   // V1: las líneas alineadas a la izquierda; el resto, centradas
      if (n > 0) drawText(ctx, L.text.slice(0, n), x, y0 + i * lh, { color: L.color, scale, shadow: null });
    });
    if (d.cursor && d.cursor.blinks.some(([a, b]) => t >= a && t < b)) {
      drawText(ctx, '_', Math.round(w / 2 - measureText('UNO.') * scale / 2), y0 + d.cursor.row * lh, { color: AMBER, scale, shadow: null });
    }
    ctx.restore();
    if (t > 0.8) g.drawSkipHint(ctx, w, h - 22 - g.safe.b, this);
  }

  // V7: una mesa oscura y una moneda que gira (se ve de canto y de cara; la marca del ave solo es nítida si ya tienes la máscara de Rick) hasta cortar a negro.
  drawCoin(ctx, w, h, t) {
    const end = this.def.coinEnd;
    if (t >= end) return;
    const g = this.g, cx = Math.round(w / 2), cy = Math.round(h * 0.52);
    ctx.fillStyle = '#14100a'; ctx.fillRect(0, cy + 10, w, h - cy - 10);       // mesa
    ctx.fillStyle = '#2a2218'; ctx.fillRect(0, cy + 10, w, 1);
    const k = Math.max(0, 1 - t / end), omega = 22 * k * k + 1.5, ang = t * omega * 0.9;  // gira cada vez más despacio
    const face = Math.abs(Math.cos(ang)), wd = Math.max(1, Math.round(16 * face));
    ctx.fillStyle = '#a8741a'; ctx.fillRect(cx - Math.ceil(wd / 2) - 1, cy - 9, wd + 2, 18);
    ctx.fillStyle = '#ffd166'; ctx.fillRect(cx - Math.floor(wd / 2), cy - 8, wd, 16);
    if (face > 0.75) {
      const rick = g.settings.isMaskUnlocked && g.settings.isMaskUnlocked('aguila');
      ctx.fillStyle = rick ? '#7a4f10' : '#c9971f';                              // el ave (nítida) o una marca borrosa
      ctx.fillRect(cx - 3, cy - 2, 6, 2); ctx.fillRect(cx - 1, cy - 4, 2, 6); if (rick) { ctx.fillRect(cx - 5, cy - 3, 2, 1); ctx.fillRect(cx + 3, cy - 3, 2, 1); }
    }
  }
}

export class Lore {
  constructor(game) {
    this.game = game;
    this.hintsOn = true;     // opción PISTAS DE HISTORIA
    this.seen = new Set();
    this.startFloor = 0; this.prologueRun = false;
    this.clock = 0; this.lastAt = -Infinity;
    this.floorCount = { A: 0, BC: 0 };
    this.callPending = false; // el teléfono de la calle suena con la llamada de CENTRAL (piso 6)
    this.seatCoin = null;     // V2: la moneda del asiento de la moto
    this.radio = null;        // V4: la radio del cuarto de servicio, mientras suena
    this.radioReady = false;  // ¿está el jugador junto a la radio y puede usarla?
    this.barrel = null;       // V6: el barril apagado del piso 10 (donde estaba la fogata)
    this.smokeT = 0;
    this.pile = null;         // la pila de cuerpos del piso 5: { x, y, barrel, helped[], coin, clicked, shock, windT }
    this.guiltSeen = false;   // ¿ha vomitado por culpa en esta partida? (variante de la grabación del piso 4)
    this.hushUntil = 0;       // silencio absoluto del walkie tras el vómito de impacto
  }

  // Partida nueva (o prólogo): todo vuelve a poder salir. El prólogo no cuenta como parte de la campaña.
  startRun(index, prologue) {
    this.seen.clear();
    this.startFloor = index; this.prologueRun = !!prologue;
    this.clock = 0; this.lastAt = -Infinity; this.callPending = false;
    this.radio = null; this.seatCoin = null; this.pile = null; this.guiltSeen = false; this.hushUntil = 0;
    this.enterFloor(index);
  }

  // Piso nuevo: el presupuesto por piso se renueva (con R NO: el mismo intento sigue gastando el suyo).
  enterFloor() { this.floorCount = { A: 0, BC: 0 }; this.callPending = false; this.radio = null; this.seatCoin = null; this.pile = null; }

  // ¿Puede salir ahora esta pieza? `moment`: 'arrival' | 'masks' | 'explore' | 'cleared' | 'results'.
  canFire(id, moment) {
    const P = PIECES[id], g = this.game;
    if (!P || this.seen.has(id) || this.prologueRun || g.testRange) return false;
    if (!this.hintsOn && !P.skeleton) return false;                 // con PISTAS DE HISTORIA en NO, solo el esqueleto
    if (P.floor < this.startFloor || P.floor !== g.levelIndex) return false; // pisos anteriores al de salida: descartada
    if (!P.moments.includes(moment)) return false;
    if (CALM.includes(moment) && g.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert'))) return false; // nunca en combate
    if (!P.exempt) {
      if (P.level === A ? this.floorCount.A >= 1 : this.floorCount.BC >= 2) return false;
      if (this.clock - this.lastAt < SEP) return false;
    }
    return true;
  }

  // Marca la pieza como vista y gasta presupuesto (se llama al dispararla).
  consume(id) {
    const P = PIECES[id];
    this.seen.add(id);
    if (P.exempt) return;
    if (P.level === A) this.floorCount.A++; else this.floorCount.BC++;
    this.lastAt = this.clock;
  }

  // Decorado narrativo del piso: el cuarto de servicio (pisos 3 y 10) y la calle vacía (piso 10).
  get decorOn() { return this.hintsOn && !this.prologueRun && !this.game.testRange && !this.game.prologue; }

  radioPos() { const G = roomGeom(this.game); return G ? G.radio : null; }

  update(dt) {
    this.clock += dt;
    const g = this.game, p = g.player;
    // Llamada de CENTRAL (piso 6): con el piso despejado y el jugador ya en la calle suena el teléfono. Solo suena; no cambia el objetivo ni nada más. Si no la coges, no se pierde ni obliga.
    this.callPending = !!(g.state === 'cleared' && p && p.alive && !g.inBuilding(p) && g.street && g.street.phone && this.canFire('call6', 'cleared'));
    // V2: la moneda del asiento desaparece al alejarte más de 4 m (128 u).
    if (this.seatCoin) {
      this.seatCoin.age += dt;
      if (p && Math.hypot(p.x - this.seatCoin.x, p.y - this.seatCoin.y) > 128 && this.seatCoin.age > 1) this.seatCoin = null;
    }
    this.updateRadio(dt);
    this.updatePile(dt);
    if (!p || g.state !== 'playing' || !p.alive || g.prologue) return;
    // V5: al acercarte por primera vez a los monitores de la sala de control (piso 8).
    if (g.levelIndex === 7 && g.inside && this.canFire('v5', 'explore')) {
      const mx = (43 + OUTSKIRT) * TILE + TILE / 2, my = (1 + OUTSKIRT) * TILE + TILE / 2;
      if (Math.hypot(p.x - mx, p.y - my) < 110) this.play('v5');
    }
    // Humo del barril apagado (piso 10).
    if (this.barrel && this.decorOn && g.levelIndex === 9) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.3; g.particles.smoke(this.barrel.x + (Math.random() - 0.5) * 6, this.barrel.y - 8); }
    }
  }

  // ¿Walkie en silencio absoluto? (3 s tras el vómito de impacto de la pila: sin estática ni clics)
  hushed() { return this.clock < this.hushUntil; }

  noteGuilt() { this.guiltSeen = true; }

  // Teléfonos mudos: en los pisos 3 y 10 el teléfono no suena (muerto / descolgado) pero se puede usar.
  phoneMute() { const i = this.game.levelIndex; return this.decorOn && (i === 2 || i === 9); }

  // ¿Puede sonar el teléfono? Con llamada fija pendiente, solo suena cuando la pieza puede salir (no durante los 30 s de separación ni sin presupuesto): así nunca se contesta una línea ocupada sin saberlo.
  phoneRingOk() {
    const g = this.game, id = `ph${g.levelIndex + 1}`;
    if (!this.decorOn || !PIECES[id] || this.seen.has(id)) return true;
    return this.canFire(id, 'explore');
  }

  // Llamada o grabación fija del teléfono de la calle del piso en curso (pisos 1-5 y 7-10), o null si no hay (piso 6, pistas en NO...).
  // Devuelve { lines } (gasta la pieza), { wait: true } si aún no toca (separación de 30 s o presupuesto) o null.
  phoneScript() {
    const g = this.game, idx = g.levelIndex, id = `ph${idx + 1}`;
    if (!this.decorOn || !PIECES[id] || this.seen.has(id)) return null;
    if (!this.canFire(id, 'explore')) return { wait: true };
    this.consume(id);
    return { lines: this.phoneLines(idx) };
  }

  phoneLines(idx) {
    const g = this.game, rec = g.civilianRecord;
    switch (idx) {
      case 0: return ['LÍNEA MUERTA:', 'Solo lluvia sobre el metal. Muy lejos, una radio cuenta: uno... dos...'];
      case 1: return ['LLAMADA:', 'Toque de queda a las doce. Las farolas de la Quinta llevan tres noches apagadas. Nadie las arregla.'];
      case 2: return ['SIN TONO.'];
      case 3: { const l = ['GRABACIÓN:', 'Si oyes esto, ya te pusieron la máscara. No te la quites dentro.']; if (this.guiltSeen) l.push('Yo también la sentí subir.'); return l; }
      case 4: return ['LLAMADA:', 'Uno, ya está. Dos, también. Falta uno. ¿Sabes cuál?', '(clic)'];
      case 6: return ['LLAMADA:', 'Apagón en el sur. La radio dice que es una avería. Los gatos huyeron antes de que se fuera la luz.'];
      case 7: return ['GRABACIÓN:', rec && rec.gifts > 0 ? 'Rick daba. Siempre daba.' : 'Rick nunca dio una.'];
      case 8: { const k = this.streetKind(); return ['LLAMADA:', k === 'good' ? 'Los de la Quinta se fueron anoche. Sin prisa. Dejaron las mantas dobladas.' : k === 'bad' || k === 'mixed' ? 'Faltan gente en la Quinta. Nadie los busca.' : 'La Quinta está vacía. Nadie sabe desde cuándo.']; }
      default: return ['LÍNEA ABIERTA.', '(respiración)', 'Alguien esperó.'];
    }
  }

  // --- LA PILA DE CUERPOS (piso 5) ---------------------------------------------------------------------------------------------------------------------------------------------------
  // Al despejar el piso 5, con la puerta aún cerrada (el jugador no ve la calle), la calle cambia según cómo trataste a los vagabundos, SIN tocar el karma ni los puntos (nada pasa por `markKilled`):
  //  · neutros y vivos → yacen (los de la fogata, en una pila junto al barril apagado y humeante; los sentados, donde estaban), con una moneda con el ave encima que no se puede coger;
  //  · a quien diste una moneda → no está: queda una manta doblada y una moneda sobre el barril (si ayudaste a todos no hay pila, solo mantas y el barril frío);
  //  · a quien heriste o mataste → se queda donde estaba.
  // Sin música (`silent`), sin fuego ni burbujas: solo viento, y a ~4 m de la pila un clic de radio. Los cuerpos son decorado (estado `dead` del vagabundo: no se golpea, no se da moneda).
  onCleared() {
    const g = this.game, st = g.street;
    if (g.levelIndex !== 4 || !this.decorOn || !st || !this.canFire('pile', 'cleared')) return;
    const f = st.fires[0], first = st.npcs[0];
    const barrel = f ? { x: f.x, y: f.y } : first ? { x: first.x, y: first.y } : null;
    if (!barrel) return;
    this.consume('pile');
    const PC = { x: barrel.x + 30, y: barrel.y + 22 };
    const helped = [], bodies = [];
    let k = 0;
    for (const n of [...st.npcs]) {
      n.mute = true; n.say = null; n.sayT = 0;
      if (n.gifted) { helped.push({ coat: n.look.coat }); st.npcs.splice(st.npcs.indexOf(n), 1); continue; }  // ayudado: ya no está
      if (n.hurtOnce || n.state === 'dead' || n.state === 'agony') continue;                                   // herido o muerto por el jugador: se queda donde estaba
      if (n.mode === 'fire') { n.x = PC.x + (k % 2 ? 9 : -9) + (Math.random() - 0.5) * 4; n.y = PC.y + k * 8 + (Math.random() - 0.5) * 2; k++; } // (apilados: se solapan en filas)
      n.state = 'dead'; n.say = null; n.sayT = 0;                                                                // neutro: yace (decorado)
      bodies.push(n);
    }
    st.fires = [];                                                                                              // el barril apagado
    const top = bodies.find((n) => n.mode === 'fire') || bodies[0];
    this.pile = { x: PC.x, y: PC.y, barrel, helped, bodies: bodies.length, coin: top ? { x: top.x, y: top.y - 2 } : null, clicked: false, shock: false, windT: 0 };
    g.sfx.setMusic('silent');
    g.sfx.play('wind', 0.9);
  }

  updatePile(dt) {
    const g = this.game, P = this.pile, p = g.player;
    if (!P || g.state !== 'cleared' || !p || !p.alive) return;
    P.windT -= dt;
    if (P.windT <= 0) { P.windT = 5; g.sfx.play('wind', 0.8); }                // solo viento
    this.smokeT -= dt;
    if (this.smokeT <= 0) { this.smokeT = 0.3; g.particles.smoke(P.barrel.x + (Math.random() - 0.5) * 6, P.barrel.y - 8); } // el barril humea
    if (!P.bodies) return;
    const d = Math.hypot(p.x - P.x, p.y - P.y);
    if (!P.clicked && d < 128 && !this.hushed()) { P.clicked = true; g.sfx.play('empty', 0.7); }   // a ~4 m: un clic de radio
    if (!P.shock && d < 120 && !p.vomit && !p.exec && !p.doorAnim) {                                // al verla: vómito de impacto (sin culpa, karma ni puntos)
      P.shock = true; P.clicked = true;
      p.startVomit(g, true);
      this.hushUntil = this.clock + 3;                                                                  // 3 s de silencio absoluto en el walkie
    }
  }

  // Lo que se dibuja de la pila (los cuerpos los dibuja la calle): la moneda con el ave encima (no se puede coger) y, por cada vagabundo ayudado, una manta doblada; la moneda sobre el barril.
  drawPile(ctx) {
    const P = this.pile;
    if (!P) return;
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x, y, w, h); };
    P.helped.forEach((hh, i) => { const x = P.barrel.x - 36 - i * 16, y = P.barrel.y + 12; px(x, y, 12, 5, '#14100a'); px(x + 1, y + 1, 10, 3, hh.coat); px(x + 1, y + 1, 10, 1, 'rgba(255,255,255,0.18)'); });
    if (P.helped.length) drawBirdCoin(ctx, P.barrel.x, P.barrel.y - 8, 0);
    if (P.coin) drawBirdCoin(ctx, P.coin.x, P.coin.y, 0.35 + 0.35 * Math.sin(performance.now() / 700));
  }

  // --- Viñetas ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  play(id, onEnd = null) {
    this.consume(id);
    const g = this.game;
    g.vignette = new Vignette(g, SCRIPTS[id], () => { this.lastAt = this.clock; if (onEnd) onEnd(); });
  }

  // Selección de máscara: V1 (piso 1) o V3 (piso 3).
  onMaskSelect() {
    if (this.canFire('v1', 'masks')) this.play('v1');
    else if (this.canFire('v3', 'masks')) this.play('v3');
  }

  // Antes de los resultados del último piso: V7. Devuelve true si se está reproduciendo (finishFloor continuará al acabar).
  beforeResults(next) {
    const g = this.game;
    if (g.levelIndex === 9 && g.endingDone && this.canFire('v7', 'results')) { this.play('v7', next); return true; }
    return false;
  }

  // Al terminar la llegada en moto (el agente ya ha bajado): V2 en el piso 2 o V6 en el piso 10.
  onArrived() {
    const g = this.game;
    if (g.prologue) return;
    if (this.canFire('v2', 'arrival')) this.startV2();
    else if (this.canFire('v6', 'arrival')) this.startV6();
  }

  // --- «Planos» (V2 y V6): la cámara se queda 2,5-3 s sobre algo, sin congelar el dibujo del mundo; se saltan manteniendo ---
  startShot(x, y, dur, cues, onEnd) {
    const g = this.game;
    g.shot = { x, y, dur, t: 0, cues, cueIdx: 0, onEnd, skipHold: 0, skipArm: false };
    g.camera.snap(x, y);
  }

  updateShot(dt) {
    const g = this.game, S = g.shot;
    S.t += dt;
    if (g.holdSkip(S, dt)) S.t = S.dur;
    while (S.cueIdx < S.cues.length && S.cues[S.cueIdx].at <= S.t) { const c = S.cues[S.cueIdx++]; g.sfx.play(c.sound, c.vol ?? 1); }
    g.camera.snap(S.x, S.y);
    g.particles.update(dt, g.map, (kind, p) => g.bake(kind, p));
    if (S.t >= S.dur) { g.shot = null; g.camera.snap(g.player.x, g.player.y); if (S.onEnd) S.onEnd(); return true; }
    return false;
  }

  drawShot(ctx, w, h) {
    const S = this.game.shot;
    if (!S) return;
    const g = this.game, k = Math.min(1, S.t / 0.3, Math.max(0, (S.dur - S.t) / 0.3)), bar = Math.round(16 * k);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
    if (S.t > 0.8) g.drawSkipHint(ctx, w, h - bar - 14 - g.safe.b, S);
  }

  // V2 · EL ASIENTO: al bajar de la moto en el piso 2, un plano de 2,5 s sobre el asiento trasero, con una moneda rayada con la silueta de un ave («tin» y destello). Sin texto.
  // La moneda no se puede coger y desaparece sola cuando te alejas más de 4 m.
  startV2() {
    const g = this.game, b = g.bike;
    this.consume('v2');
    this.seatCoin = { x: b.x - 4, y: b.y - 1, age: 0 };
    this.startShot(b.x, b.y, 2.5, [{ at: 0.4, sound: 'coin', vol: 0.8 }], () => { this.lastAt = this.clock; });
  }

  // V6 · LA CALLE VACÍA: al llegar al piso 10 la música se apaga y solo hay viento; plano de 3 s sobre el barril apagado (con su hilo de humo) y la tapa entreabierta; después, la frase del agente.
  // Los detalles de la calle (mantas, vela, monedas, zapato...) salen del karma confirmado: ver drawWorld.
  startV6() {
    const g = this.game, p = g.player, ag = AGENTS[p.gender] || AGENTS.male;
    this.consume('v6');
    g.sfx.setMusic('silent');
    const B = this.barrel || { x: p.x, y: p.y };
    this.startShot(B.x, B.y, 3, [{ at: 0, sound: 'wind', vol: 1 }], () => {
      this.lastAt = this.clock;
      g.addFloat(p.x, p.y - 24, p.gender === 'female' ? 'QUÉ SILENCIO.' : 'NO HAY NADIE.', ag.color, 1, 2.6);
    });
  }

  // Tras (re)crear el piso: la tapa de alcantarilla fija del piso 10 queda entreabierta (V6).
  onReset() {
    const g = this.game;
    this.pile = null; // con R el piso se rehace con los vagabundos vivos otra vez (la pieza ya está vista: no se repite)
    if (!(g.levelIndex === 9 && this.decorOn && g.sewer)) return;
    const c = g.sewer.covers.find((x) => x.fixed);
    if (c) { c.slide = 0.65; c.dir = 1; this.lid = { x: c.x, y: c.y }; }
  }

  // Karma confirmado → qué detalles muestra la calle vacía: 'good' | 'bad' | 'mixed' | 'none' (sin números ni avisos).
  streetKind() {
    const base = this.game.civilianBase;
    const bad = hostileCivCount(base) > 0, good = friendlyCivCount(base) > 0;
    return bad && good ? 'mixed' : bad ? 'bad' : good ? 'good' : 'none';
  }

  // --- Decorado en el mundo (se dibuja bajo las entidades) y radio del cuarto de servicio (V4 y su eco en el piso 10) -------------------------------------------------------------------------
  drawWorld(ctx) {
    const g = this.game, now = performance.now() / 1000;
    if (this.seatCoin) drawBirdCoin(ctx, this.seatCoin.x, this.seatCoin.y, Math.max(0, 1 - this.seatCoin.age / 0.8) * 0.9);
    if (!this.decorOn) return;
    this.drawPile(ctx);
    if (g.levelIndex === 9 && g.street && g.street.phone) {                          // piso 10: el auricular del teléfono cuelga descolgado, balanceándose
      const ph = g.street.phone, sw = Math.round(Math.sin(now * 1.4) * 1.5), P2 = (x, y, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x, y, w, h); };
      P2(ph.x + 10, ph.y - 4, 1, 6, '#14100a'); P2(ph.x + 10 + sw, ph.y + 8, 1, 4, '#14100a'); P2(ph.x + 8 + sw, ph.y + 14, 5, 3, '#14141e'); P2(ph.x + 9 + sw, ph.y + 15, 3, 1, '#6b6b85');
    }
    if (g.levelIndex === 2 || g.levelIndex === 9) {
      drawServiceRoom(ctx, g, g.levelIndex === 2 ? 3 : 10, now, 'floor');
      const R = this.radioPos();
      if (this.radioReady && R) drawText(ctx, `${g.hint(g.keys.label('kick'), 'BOTA')} · RADIO`, R.x, R.y - 34, { color: '#9be32a', scale: 2, align: 'center', shadow: '#140a24' });
    }
    if (g.levelIndex === 9 && this.barrel) drawKarmaStreet(ctx, g, this.barrel, this.lid, this.streetKind(), now);
  }

  // Lo que va colgado de la pared norte del cuarto de servicio (calendario y taquillas con el rótulo raspado): se dibuja DESPUÉS de la capa de paredes.
  drawWallDecor(ctx) {
    const g = this.game;
    if (!this.decorOn || !(g.levelIndex === 2 || g.levelIndex === 9)) return;
    drawServiceRoom(ctx, g, g.levelIndex === 2 ? 3 : 10, performance.now() / 1000, 'wall');
  }

  updateRadio(dt) {
    const g = this.game, p = g.player;
    if (this.radio) {
      const R = this.radio, t0 = R.t;
      R.t += dt;
      for (const L of R.lines) {
        const n = (t) => Math.max(0, Math.min(L.text.length, Math.floor((t - L.at) * 22)));
        talkBlips(g, R.voice, L.text, n(t0), n(R.t));
      }
      while (R.cueIdx < R.cues.length && R.cues[R.cueIdx] <= R.t) { R.cueIdx++; g.sfx.play('empty', 0.6); }
      if (R.t >= R.dur) this.radio = null;
    }
    this.radioReady = false;
    if (!this.decorOn || !p || !p.alive || g.state !== 'playing' || g.sewerRun || g.comms.cur) return;
    const id = g.levelIndex === 2 ? 'v4' : g.levelIndex === 9 ? 'v4echo' : null, R = this.radioPos();
    if (!id || !R || this.radio) return;
    if (Math.hypot(p.x - R.x, p.y - R.y) < 28 && this.canFire(id, 'explore')) {
      this.radioReady = true;
      if (g.keys.pressed('kick')) this.startRadio(id);
    }
  }

  // La radio: «Aquí base... ¿Me copian?» / «...¿Alguien?» y estática. En el piso 3 la voz es de radio, sin nombre; en el piso 10 es la VOZ y el NOMBRE del agente que controlas (el eco).
  startRadio(id) {
    const g = this.game, p = g.player, echo = id === 'v4echo', ag = AGENTS[p.gender] || AGENTS.male;
    this.consume(id);
    this.radio = {
      t: 0, dur: 7, cueIdx: 0, cues: [0.1, 3.4, 6.2],
      title: echo ? `${ag.name} · RADIO` : '??? · FRECUENCIA', color: echo ? ag.color : '#9d8fb8',
      voice: echo ? voiceFor(g.mask, p.gender) : voiceFor(null, null),
      lines: [{ at: 0.5, text: 'Aquí base... ¿Me copian?' }, { at: 3.5, text: '...¿Alguien?' }],
    };
    g.sfx.play('empty', 0.8);
  }

  drawHud(ctx, w, h) {
    const R = this.radio;
    if (!R) return;
    const g = this.game, bw = Math.min(w - 20, 250), bh = 34, bx = Math.round((w - bw) / 2), by = h - bh - 12 - g.safe.b;
    ctx.fillStyle = 'rgba(5, 0, 15, 0.92)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = R.color;
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    drawText(ctx, R.title, bx + 6, by + 4, { color: R.color, shadow: null });
    R.lines.forEach((L, i) => {
      const n = Math.max(0, Math.min(L.text.length, Math.floor((R.t - L.at) * 22)));
      if (n > 0) drawText(ctx, L.text.slice(0, n), bx + 6, by + 14 + i * 10, { color: '#f5f3ff', shadow: null });
    });
    if (R.t > 5.2) for (let i = 0; i < 24; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#4a4a5a' : '#8a8a9a'; ctx.fillRect(bx + 6 + Math.floor(Math.random() * (bw - 14)), by + 14 + Math.floor(Math.random() * 16), 3, 1); } // estática
  }

  // --- Llamada de CENTRAL (piso 6, tras el jefe) -------------------------------------------------------------------------------------------------------------------------------
  // Diálogo modal por teléfono (retrato de walkie): saltable manteniendo (cada línea también pasa con un clic). La réplica sobre las monedas es seca: `Eso pesa.` si llevas una en la mano y `Sin lastre.` si no.
  startCall() {
    const g = this.game, p = g.player;
    if (!this.canFire('call6', 'cleared')) return;
    this.consume('call6');
    this.callPending = false;
    const ag = AGENTS[p.gender] || AGENTS.male, vex = p.gender === 'female';
    const central = { name: 'CENTRAL', color: '#ffbe0b', tag: 'TELÉFONO', icon: 'phone' };
    const me = { name: ag.name, color: ag.color, tag: 'AGENTE', portrait: { mask: g.mask, gender: p.gender, level: g.goreOn ? p.bloodLevel : 0, bits: g.maskBits || [] } };
    const ph = g.street.phone, at = (o) => ({ x: o.x, y: o.y });
    const coin = g.streetRun && g.streetRun.coins > 0;
    const lines = [
      { speaker: central, text: 'Informe.', focus: at(ph) },
      { speaker: me, text: vex ? 'Seis limpio. El grandote no se levanta más.' : 'Piso seis despejado. El de la coraza ya no se levanta.', focus: at(p) },
      { speaker: central, text: 'Bien. Más rápido que el último.', focus: at(ph) },
      { speaker: me, text: '¿Qué último?', focus: at(p) },
      { speaker: central, text: 'Nadie. ...Olvídalo.', focus: at(ph) },
      { speaker: me, text: vex ? 'Esa voz no es la de siempre.' : 'Tu voz suena distinta esta noche.', focus: at(p) },
      { speaker: central, text: 'Es la línea. Está vieja. Como todo.', focus: at(ph) },
      { speaker: central, text: coin ? 'Eso pesa.' : 'Sin lastre.', focus: at(ph) },
      { speaker: central, text: 'Cuatro pisos. Después hablamos de la lista.', focus: at(ph) },
      { speaker: me, text: '¿Qué lista?', focus: at(p) },
    ];
    const onEnd = () => { this.lastAt = this.clock; g.sfx.play('empty', 0.8); };   // clic de línea cortada
    if (g.comms.say('lore:call6', lines, { urgent: true, skippable: true, onEnd })) g.comms.begin(g.comms.queue.shift());
  }
}
