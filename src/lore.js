import { drawText, measureText } from './pixelfont.js';
import { talkBlips, voiceFor } from './comms.js';
import { COLORS } from './utils.js';
import { AGENTS } from './portraits.js';

// SISTEMA NARRATIVO DE PISTAS Y VIÑETAS (infraestructura base). Piezas cortas y misteriosas entre bloques o pisos; este módulo decide CUÁNDO puede salir cada una y reproduce las viñetas.
//
// Reglas de ciclo de vida:
//  · cada pieza se dispara COMO MUCHO UNA VEZ POR PARTIDA: `seen` se vacía al empezar partida (`startRun`) y NO con R (`reset` no lo toca);
//  · si la partida empieza desde el selector de pisos, las piezas de pisos ANTERIORES al de salida se descartan (`startFloor`), para que no se acumulen;
//  · NUNCA en pleno combate: cada pieza declara los momentos en que puede salir (`moments`: llegada, selección de máscara, piso despejado, resultados) y no sale con enemigos alerta;
//  · se saltan manteniendo ESPACIO / ENTER 1,2 s (en táctil, el dedo): la mecánica de `Game.holdSkip` de las cinemáticas.
// Presupuesto de ritmo: por piso, como máximo 1 pieza de nivel A (escenas, ≤ 30 s en total) y 2 de nivel B (ambiente sin pausa ni texto) o C (interactivos a pie de objeto), con al menos
// SEP s entre piezas. `exempt` (el final) no consume presupuesto ni separación.
// Opción OPCIONES → JUEGO → PISTAS DE HISTORIA (`hintsOn`): en NO solo salen las piezas `skeleton` (V1, V7 y la llamada del piso 6).
// Registro de piezas: `floor` = índice de piso (0-9) en el que salen. Las marcadas `todo` están previstas pero aún sin contenido (V2-V6): al añadirlas basta con llamar a `canFire` / `consume`.
export const SEP = 30;
const A = 'A', B = 'B', C = 'C';
export const PIECES = {
  v1: { level: A, floor: 0, skeleton: true, moments: ['masks'] },                 // LA LISTA: tras el prólogo, antes de elegir máscara en el piso 1
  v2: { level: A, floor: 1, moments: ['arrival'], todo: true },                   // EL ASIENTO
  v3: { level: A, floor: 2, moments: ['masks'], todo: true },                     // LOS GANCHOS
  v4: { level: C, floor: 2, moments: ['arrival'], todo: true },                   // ALGUIEN VIVIÓ AQUÍ (cuarto de servicio del piso 3)
  call6: { level: A, floor: 5, skeleton: true, moments: ['cleared'] },            // LLAMADA DE CENTRAL: tras el jefe, con el piso despejado y el jugador en la calle
  v5: { level: C, floor: 7, moments: ['arrival'], todo: true },                   // LA GRABACIÓN
  v6: { level: A, floor: 9, moments: ['arrival'], todo: true },                   // LA CALLE VACÍA
  v7: { level: A, floor: 9, skeleton: true, exempt: true, moments: ['results'] }, // CARA O CRUZ: tras la salida del final, antes de los resultados
};

// --- Guiones de las viñetas (línea tecleada: `at` s, texto, color; `cues`: sonidos con las voces ya existentes) ---------------------------------------------------------------------
const AMBER = '#ffbe0b';
const SCRIPTS = {
  // V1 · LA LISTA: negro, estática y clic de radio; «UNO.» «DOS.» y un cursor que parpadea EXACTAMENTE tres veces antes de apagarse (la tercera línea no llega). Clic de máscara.
  v1: {
    dur: 8.4,
    lines: [{ at: 1.0, text: 'UNO.', color: AMBER }, { at: 3.0, text: 'DOS.', color: AMBER }],
    cursor: { row: 2, blinks: [[5.0, 5.5], [5.9, 6.4], [6.8, 7.3]] },
    cues: [{ at: 0.2, sound: 'empty', vol: 0.8 }, { at: 7.5, sound: 'maskOn', vol: 0.7 }],
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
    const scale = w >= 300 ? 2 : 1, y0 = Math.round(h * 0.42), lh = 12 * scale + 6;
    (d.lines || []).forEach((L, i) => {
      const n = Math.max(0, Math.min(L.text.length, Math.floor((t - L.at) * 14)));
      if (n > 0) drawText(ctx, L.text.slice(0, n), Math.round(w / 2 - measureText(L.text) * scale / 2), y0 + i * lh, { color: L.color, scale, shadow: null });
    });
    if (d.cursor && d.cursor.blinks.some(([a, b]) => t >= a && t < b)) {
      const txt = '_', row = d.cursor.row;
      drawText(ctx, txt, Math.round(w / 2 - measureText('UNO.') * scale / 2), y0 + row * lh, { color: AMBER, scale, shadow: null });
    }
    ctx.restore();
    if (t > 0.8) g.drawSkipHint(ctx, w, h - 22 - g.safe.b, this);
  }

  // V7: una mesa oscura y una moneda que gira (se ve de canto y de cara; la marca del ave solo es legible si ya tienes la máscara de Rick) hasta cortar a negro.
  drawCoin(ctx, w, h, t) {
    const end = this.def.coinEnd;
    if (t >= end) return;
    const g = this.g, cx = Math.round(w / 2), cy = Math.round(h * 0.52);
    ctx.fillStyle = '#14100a'; ctx.fillRect(0, cy + 10, w, h - cy - 10);       // mesa
    ctx.fillStyle = '#2a2218'; ctx.fillRect(0, cy + 10, w, 1);
    const k = Math.max(0, 1 - t / end), omega = 22 * k * k + 1.5, ang = (t / 1) * omega * 0.9;  // gira cada vez más despacio
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
  }

  // Partida nueva (o prólogo): todo vuelve a poder salir. El prólogo no cuenta como parte de la campaña.
  startRun(index, prologue) {
    this.seen.clear();
    this.startFloor = index; this.prologueRun = !!prologue;
    this.clock = 0; this.lastAt = -Infinity; this.callPending = false;
    this.enterFloor(index);
  }

  // Piso nuevo: el presupuesto por piso se renueva (con R NO: el mismo intento sigue gastando el suyo).
  enterFloor() { this.floorCount = { A: 0, BC: 0 }; this.callPending = false; }

  // ¿Puede salir ahora esta pieza? `moment`: 'arrival' | 'masks' | 'cleared' | 'results'.
  canFire(id, moment) {
    const P = PIECES[id], g = this.game;
    if (!P || this.seen.has(id) || this.prologueRun || g.testRange) return false;
    if (!this.hintsOn && !P.skeleton) return false;                 // con PISTAS DE HISTORIA en NO, solo el esqueleto
    if (P.floor < this.startFloor || P.floor !== g.levelIndex) return false; // pisos anteriores al de salida: descartada
    if (!P.moments.includes(moment)) return false;
    if (moment === 'cleared' && g.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert'))) return false; // nunca en combate
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

  update(dt) {
    this.clock += dt;
    const g = this.game, p = g.player;
    // Llamada de CENTRAL (piso 6): con el piso despejado y el jugador ya en la calle suena el teléfono. Solo suena; no cambia el objetivo ni nada más. Si no la coges, no se pierde ni obliga.
    this.callPending = !!(g.state === 'cleared' && p && p.alive && !g.inBuilding(p) && g.street && g.street.phone && this.canFire('call6', 'cleared'));
  }

  // --- Viñetas ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  play(id, onEnd = null) {
    this.consume(id);
    const g = this.game;
    g.vignette = new Vignette(g, SCRIPTS[id], () => { this.lastAt = this.clock; if (onEnd) onEnd(); });
  }

  onMaskSelect() {                       // V1 al abrir la selección de máscara del piso 1
    if (this.canFire('v1', 'masks')) this.play('v1');
  }

  // Antes de los resultados del último piso: V7. Devuelve true si se está reproduciendo (finishFloor continuará al acabar).
  beforeResults(next) {
    const g = this.game;
    if (g.levelIndex === 9 && g.endingDone && this.canFire('v7', 'results')) { this.play('v7', next); return true; }
    return false;
  }

  // --- Llamada de CENTRAL (piso 6, tras el jefe) -------------------------------------------------------------------------------------------------------------------------------
  // Diálogo modal por teléfono (retrato de walkie): saltable manteniendo (cada línea también pasa con un clic). La réplica sobre las monedas es seca: `Eso pesa.` si llevas una en la mano y `Sin lastre.` si no.
  startCall() {
    const g = this.game, p = g.player;
    if (!this.canFire('call6', 'cleared')) return;
    this.consume('call6');
    this.callPending = false;
    const ag = AGENTS[p.gender] || AGENTS.male, vex = p.gender === 'female';
    const central = { name: 'CENTRAL', color: '#ffbe0b', tag: 'TELÉFONO' };
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
