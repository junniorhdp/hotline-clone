import { TILE, isSolidAt } from './map.js';
import { Pickup } from './weapons.js';
import { pixelRect, WORLD_PX } from './sprites.js';
import { drawText, measureText } from './pixelfont.js';
import { COLORS, clamp, seededRandom, hashString } from './utils.js';

// Vida de la calle (zona exterior de cada piso). Todo es opcional y no toca el combate:
//   · CONTENEDORES: se registran con PATEAR/INTERACTUAR; pueden esconder un TUBO OXIDADO (arma exclusiva de la calle, envenena).
//   · MONEDA: oculta en un rincón de la calle. MÁQUINA EXPENDEDORA: moneda → lata que da un buff temporal (`game.buff`).
//   · CABINA TELEFÓNICA: suena al llegar; al contestar da una pista o un reto opcional con bonus de puntos al acabar el piso.
//   · VAGABUNDO (NPC del callejón): no se le puede atacar; se asusta si te acercas armado o manchado de sangre.
// Las posiciones salen de map.street (generadas por withOutskirts); el estado que sobrevive a R vive en game.streetRun.

const INTERACT_GAP = 28;      // distancia (al borde del objeto) para poder interactuar
const COIN_RADIUS = 18;
const BUFF_TIME = 45;         // segundos de lata, contados solo dentro del edificio
const NPC_SCARE_DIST = 150, NPC_TALK_DIST = 90, NPC_ROAM = 36;

export function newStreetRun() {
  return { coinTaken: false, coins: 0, phoneDone: false, phoneLines: null, challenge: null };
}

const LORE = [
  'HAN CERRADO EL EDIFICIO CON TODOS DENTRO. LA ÚNICA SALIDA ES LA MOTO.',
  'EL EJECUTOR EMBISTE SIN PARAR... HASTA QUE SE ESTRELLA CONTRA UNA PARED.',
  'LOS CONTENEDORES GUARDAN MÁS QUE BASURA. REVISA LOS DE LA CALLE.',
  'ALGUIEN PERDIÓ UNA MONEDA POR LOS RINCONES. LA MÁQUINA SABE PARA QUÉ.',
  'ESE COCODRILO DE LA ALCANTARILLA... NO LO MOLESTES.',
  'ESA LATA DE LA MÁQUINA TE DA VELOCIDAD, PERO SOLO DENTRO DEL EDIFICIO.',
];
const CHALLENGES = [
  { id: 'nogun', bonus: 2000, text: () => 'TERMINA EL PISO SIN DISPARAR NI UNA VEZ.', check: (g) => !['gun', 'shotgun', 'smg'].some((t) => g.stats.uses[t]) },
  { id: 'fast', bonus: 1500, text: (g) => `DESPEJA EL EDIFICIO EN MENOS DE ${Math.round(g.par * 0.8)} S.`, check: (g) => g.time <= g.par * 0.8 },
  { id: 'combo', bonus: 1800, text: () => 'ENCADENA UN COMBO DE X4 O MÁS.', check: (g) => g.score.maxCombo >= 4 },
];
const NPC_CALM = ['NOCHE TRANQUILA...', '¿TIENES UNA MONEDA?', 'CUIDADO CON LA ALCANTARILLA...', 'LA MÁQUINA DE LA ACERA FUNCIONA.'];
const NPC_ARMED = ['¡NO QUIERO PROBLEMAS!', '¡GUARDA ESO, POR FAVOR!', '¡YO NO HE VISTO NADA!'];
const NPC_BLOOD = ['¡ESO ES SANGRE!', '¡ESTÁS CUBIERTO DE SANGRE!', '¡NO ME HAGAS DAÑO!'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Distancia de un punto al borde de un rectángulo centrado (0 si está dentro).
function gap(px, py, r) {
  const dx = Math.max(Math.abs(px - r.x) - r.w / 2, 0), dy = Math.max(Math.abs(py - r.y) - r.h / 2, 0);
  return Math.hypot(dx, dy);
}
function wrap(text, max) {
  const out = []; let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max) { out.push(line); line = word; } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

export class StreetLife {
  constructor(game) {
    this.game = game;
    this.clock = 0;
    this.dialog = null;                 // { lines, t }
    const m = game.map, st = m.street || {}, run = game.streetRun;
    const rnd = seededRandom(hashString(`${game.runId || 'x'}|${game.levelIndex}|street`));
    this.rnd = rnd;
    // Contenedores de la calle: el primero siempre guarda el tubo oxidado; los demás, a veces.
    this.dumpsters = m.props.filter((p) => p.type === 'dumpster').map((p, i) => ({
      kind: 'dumpster', x: (p.x + p.w / 2) * TILE, y: (p.y + p.h / 2) * TILE, w: p.w * TILE, h: p.h * TILE, open: false, loot: i === 0 || rnd() < 0.4,
    }));
    const box = (c) => (c ? { x: c.x, y: c.y, w: TILE, h: TILE } : null);
    this.vending = st.vending ? { kind: 'vending', ...box(st.vending) } : null;
    this.phone = st.phone ? { kind: 'phone', ...box(st.phone) } : null;
    this.npc = st.npc ? { home: { x: st.npc.x, y: st.npc.y }, x: st.npc.x, y: st.npc.y, scared: false, say: null, sayT: 0, sayCd: 1.5, face: -1, shiver: 0 } : null;
    this.coin = st.coin && !run.coinTaken ? { x: st.coin.x, y: st.coin.y } : null;
    this.ringT = 0.5;
  }

  get run() { return this.game.streetRun; }
  get ringing() { return !!this.phone && !this.game.entered && !this.run.phoneDone; }

  targets() { return [...this.dumpsters, this.vending, this.phone].filter(Boolean); }

  nearTarget() {
    const p = this.game.player;
    let best = null, bd = INTERACT_GAP;
    for (const t of this.targets()) { const d = gap(p.x, p.y, t); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.clock += dt;
    if (this.dialog) { this.dialog.t -= dt; if (this.dialog.t <= 0) this.dialog = null; }
    // Lata: solo corre dentro del edificio, mientras se juega.
    if (g.buff && g.inside && g.state === 'playing' && (g.buff.t -= dt) <= 0) {
      g.buff = null;
      g.addFloat(p.x, p.y - 16, 'LATA AGOTADA', '#9d8fb8');
    }
    if ((g.state !== 'playing' && g.state !== 'cleared') || !p.alive || g.panel) return;

    // Teléfono sonando (solo antes de entrar): un timbre cada ~1,8 s, audible desde lejos.
    if (this.ringing) {
      this.ringT -= dt;
      if (this.ringT <= 0) { this.ringT = 1.8; g.playAt('phoneRing', this.phone.x, this.phone.y, 1); }
    }
    // Moneda escondida.
    if (this.coin && Math.hypot(p.x - this.coin.x, p.y - this.coin.y) < COIN_RADIUS) {
      this.run.coinTaken = true; this.run.coins++;
      g.addFloat(this.coin.x, this.coin.y - 8, '¡MONEDA!', COLORS.enemy, 1, 1.2);
      g.playAt('coin', this.coin.x, this.coin.y, 1);
      this.coin = null;
    }
    this.updateNpc(dt);
    // Interacción: PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de patada).
    if (g.keys.pressed('kick') || g.keys.pressed('execute')) {
      const t = this.nearTarget();
      if (t) this.interact(t);
    }
  }

  interact(t) {
    const g = this.game, p = g.player;
    if (t.kind === 'dumpster') {
      if (t.open) { g.addFloat(t.x, t.y - 14, 'VACÍO', '#9d8fb8'); return; }
      t.open = true;
      g.sfx.play('knock');
      g.camera.addShake(3);
      g.particles.dust(t.x, t.y, 8);
      if (t.loot) {
        const ang = Math.atan2(p.y - t.y, p.x - t.x);
        const reach = (t.w > t.h ? t.h : t.w) / 2 + 10;
        const pk = new Pickup('rustpipe', t.x + Math.cos(ang) * reach, t.y + Math.sin(ang) * reach, 0);
        pk.throwAt(ang, 150);
        g.pickups.push(pk);
        g.addFloat(t.x, t.y - 14, '¡TUBO OXIDADO!', '#c2682a', 1, 1.4);
      } else g.addFloat(t.x, t.y - 14, 'SOLO BASURA', '#9d8fb8', 1, 1.1);
    } else if (t.kind === 'vending') {
      if (this.run.coins <= 0) { g.addFloat(t.x, t.y - 20, 'NECESITAS UNA MONEDA', COLORS.blood, 1, 1.3); g.sfx.play('empty'); return; }
      this.run.coins--;
      g.buff = { t: BUFF_TIME, max: BUFF_TIME };
      g.sfx.play('can');
      g.addFloat(t.x, t.y - 20, '¡LATA NEÓN! +VELOCIDAD +CADENCIA', COLORS.player, 1, 1.8);
    } else if (t.kind === 'phone') {
      if (this.dialog) { this.dialog = null; return; }
      this.answer();
    }
  }

  // Contesta la cabina: pista de lore o reto opcional (se resuelve al terminar el piso, ver settle()).
  answer() {
    const g = this.game, run = this.run;
    if (!run.phoneLines) {
      let ch = null;
      if (this.rnd() < 0.6) {
        const def = CHALLENGES[Math.floor(this.rnd() * CHALLENGES.length)];
        ch = { id: def.id, text: def.text(g), bonus: def.bonus };
        run.challenge = ch;
        run.phoneLines = ['RETO OPCIONAL:', ch.text, `RECOMPENSA: +${ch.bonus} PTS`];
      } else {
        run.phoneLines = ['PISTA:', LORE[Math.floor(this.rnd() * LORE.length)]];
      }
    }
    run.phoneDone = true;
    this.dialog = { lines: run.phoneLines, t: 8 };
    g.sfx.play('pickup');
  }

  // Al terminar el piso: ¿se cumplió el reto? Suma el bonus y devuelve { text, ok, bonus } (o null si no había reto).
  settle() {
    const g = this.game, run = this.run, ch = run.challenge;
    if (!ch) return null;
    const def = CHALLENGES.find((c) => c.id === ch.id);
    const ok = !!def && def.check(g);
    if (ok) g.score.addBonus(ch.bonus);
    run.challenge = null;
    return { text: ch.text, ok, bonus: ch.bonus };
  }

  // --- Vagabundo --------------------------------------------------------------------------------
  updateNpc(dt) {
    const n = this.npc;
    if (!n) return;
    const g = this.game, p = g.player, d = dist(p, n);
    n.sayT = Math.max(0, n.sayT - dt);
    n.sayCd = Math.max(0, n.sayCd - dt);
    const armed = !!p.weapon, bloody = p.bloodLevel >= 2;
    const scared = d < NPC_SCARE_DIST && (armed || bloody);
    if (scared && !n.scared) this.npcSay(bloody ? NPC_BLOOD : NPC_ARMED, 2.4);
    n.scared = scared;
    n.face = p.x >= n.x ? 1 : -1;
    let tx = n.home.x, ty = n.home.y, speed = 30;
    if (scared) {
      // Se aparta de ti sin salirse de su rincón (ni meterse en un mueble).
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      tx = clamp(n.x + Math.cos(a) * 40, n.home.x - NPC_ROAM, n.home.x + NPC_ROAM);
      ty = clamp(n.y + Math.sin(a) * 40, n.home.y - NPC_ROAM, n.home.y + NPC_ROAM);
      speed = 70;
      n.shiver += dt * 40;
      if (n.sayCd <= 0 && n.sayT <= 0) this.npcSay(bloody ? NPC_BLOOD : NPC_ARMED, 2.2);
    } else if (d < NPC_TALK_DIST && n.sayCd <= 0 && n.sayT <= 0) this.npcSay(NPC_CALM, 2.6);
    const dx = tx - n.x, dy = ty - n.y, len = Math.hypot(dx, dy);
    if (len > 2) {
      const step = Math.min(len, speed * dt);
      const nx = n.x + (dx / len) * step, ny = n.y + (dy / len) * step;
      if (!isSolidAt(g.map, nx, n.y)) n.x = nx;
      if (!isSolidAt(g.map, n.x, ny)) n.y = ny;
    }
  }

  npcSay(list, secs) {
    const n = this.npc;
    n.say = list[Math.floor(Math.random() * list.length)];
    n.sayT = secs;
    n.sayCd = secs + 3;
  }

  // --- Dibujo ------------------------------------------------------------------------------------
  // Mundo (tras la capa de muebles, bajo los personajes).
  draw(ctx) {
    const px = (x, y, ox, oy, w, h, col) => { ctx.fillStyle = col; pixelRect(ctx, x + ox * WORLD_PX, y + oy * WORLD_PX, w, h); };
    // Contenedores abiertos: se ve el interior oscuro y la tapa levantada.
    for (const t of this.dumpsters) {
      if (!t.open) continue;
      const hw = t.w / 2, hh = t.h / 2;
      ctx.fillStyle = '#07100a';
      pixelRect(ctx, t.x - hw + 4, t.y - hh + 4, (t.w - 8) / WORLD_PX, (t.h - 8) / WORLD_PX);
      ctx.fillStyle = '#9aa0b8';
      pixelRect(ctx, t.x - hw + 6, t.y - hh + 6, 3, 1); // un destello de lo que hay dentro
      ctx.fillStyle = '#3a7a50';
      if (t.w >= t.h) pixelRect(ctx, t.x - hw, t.y - hh - 6, t.w / WORLD_PX, 3);
      else pixelRect(ctx, t.x - hw - 6, t.y - hh, 3, t.h / WORLD_PX);
    }
    // Teléfono sonando: ondas parpadeantes a los lados de la cabina.
    if (this.ringing && Math.floor(this.clock * 3) % 2 === 0) {
      const ph = this.phone;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) px(ph.x, ph.y, side * (11 + k * 3) - 1, -2 - k, 1, 2 + k * 2, k === 2 ? '#05d9e8' : '#ffffff');
      }
    }
    // Moneda: un destello fino que se ve mejor de cerca (está "escondida").
    if (this.coin) {
      const p = this.game.player, near = Math.hypot(p.x - this.coin.x, p.y - this.coin.y) < 150;
      const tw = Math.floor(this.clock * 2.2) % 4;
      if (near || tw === 0) {
        const c = this.coin;
        px(c.x, c.y, -2, -2, 4, 4, '#b38600'); px(c.x, c.y, -1, -3, 2, 1, '#ffbe0b'); px(c.x, c.y, -1, 2, 2, 1, '#ffbe0b');
        px(c.x, c.y, -2, -2, 1, 1, '#fff6c8');
        if (tw === 0) { px(c.x, c.y, -1, -6, 1, 2, '#ffffff'); px(c.x, c.y, -1, 5, 1, 2, '#ffffff'); px(c.x, c.y, -6, -1, 2, 1, '#ffffff'); px(c.x, c.y, 4, -1, 2, 1, '#ffffff'); }
      }
    }
    if (this.npc) this.drawNpc(ctx);
  }

  // Vagabundo visto desde arriba: capucha, hombros con abrigo y una manta; tiembla y abre los ojos si está asustado.
  drawNpc(ctx) {
    const n = this.npc;
    const sh = n.scared ? Math.round(Math.sin(n.shiver) * 1) : 0;
    const x = Math.round(n.x) + sh * WORLD_PX, y = Math.round(n.y);
    const px = (ox, oy, w, h, col) => { ctx.fillStyle = col; pixelRect(ctx, x + ox * WORLD_PX, y + oy * WORLD_PX, w, h); };
    px(-6, 3, 13, 4, 'rgba(5,0,15,0.5)');            // sombra
    px(-6, -5, 13, 9, '#14100a');                     // contorno del abrigo
    px(-5, -4, 11, 7, '#5a4a38'); px(-5, -4, 11, 2, '#6e5c46');
    px(-3, 1, 7, 2, '#3a5a6a');                       // manta
    px(-3, -8, 7, 6, '#14100a');                      // capucha
    px(-2, -7, 5, 4, '#2a2018'); px(-2, -7, 5, 1, '#3a2c1c');
    const fx = n.face > 0 ? 1 : -2;
    px(fx, -6, 2, 2, '#d9a67a');                      // cara (mira hacia ti)
    px(fx, -6, 1, 1, n.scared ? '#ffffff' : '#140a24'); // ojo
    px(n.face > 0 ? 6 : -8, -1, 2, 3, '#d9a67a');    // mano
  }

  // Pantalla: avisos de interacción, burbuja del NPC, lata activa y cuadro del teléfono.
  drawHud(ctx, w, h) {
    const g = this.game;
    if (g.state !== 'playing' && g.state !== 'cleared') return;
    const cam = g.camera;
    const label = (text, wx, wy, color = COLORS.text) => {
      const s = cam.worldToScreen(wx, wy);
      const p = g.keepOnScreen(s.x, s.y, measureText(text), 8);
      drawText(ctx, text, p.x, p.y, { color, align: 'center', shadow: COLORS.background });
    };
    const key = g.hint(g.keys.label('kick'), 'PATEAR');
    const t = g.player.alive && !g.panel ? this.nearTarget() : null;
    if (t) {
      let txt;
      if (t.kind === 'dumpster') txt = t.open ? null : `${key} · REGISTRAR`;
      else if (t.kind === 'vending') txt = this.run.coins > 0 ? `${key} · USAR MONEDA` : 'MÁQUINA · FALTA UNA MONEDA';
      else txt = this.ringing ? `${key} · CONTESTAR` : `${key} · TELÉFONO`;
      if (txt) label(txt, t.x, t.y - t.h / 2 - 12, t.kind === 'phone' && this.ringing ? COLORS.player : COLORS.text);
    }
    const n = this.npc;
    if (n && n.sayT > 0 && n.say) {
      const s = cam.worldToScreen(n.x, n.y - 24);
      // La caja entera (texto + 4 px de relleno por lado) con margen de seguridad en los cuatro bordes.
      const tw = measureText(n.say), bp = g.keepOnScreen(s.x, s.y - 3, tw + 8, 13, 6);
      const bx = Math.round(bp.x - (tw + 8) / 2), by = Math.round(bp.y);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, tw + 8, 13);
      ctx.fillStyle = n.scared ? COLORS.blood : COLORS.player;
      ctx.fillRect(bx, by, tw + 8, 1); ctx.fillRect(bx, by + 12, tw + 8, 1); ctx.fillRect(bx, by, 1, 13); ctx.fillRect(bx + tw + 7, by, 1, 13);
      drawText(ctx, n.say, bx + 4, by + 3, { color: COLORS.text, shadow: null });
    }
    // Lata activa (arriba, al centro) o moneda guardada.
    const top = 5 + g.safe.t;
    if (g.buff) {
      const k = clamp(g.buff.t / g.buff.max, 0, 1), bw = 78, bx = Math.round(w / 2 - bw / 2);
      drawText(ctx, `LATA NEÓN ${Math.ceil(g.buff.t)}S`, w / 2, top, { color: COLORS.player, align: 'center' });
      ctx.fillStyle = '#140a24'; ctx.fillRect(bx, top + 10, bw, 3);
      ctx.fillStyle = COLORS.player; ctx.fillRect(bx, top + 10, Math.round(bw * k), 3);
      if (!g.inside) drawText(ctx, 'SE GASTA DENTRO DEL EDIFICIO', w / 2, top + 15, { color: '#9d8fb8', align: 'center' });
    } else if (this.run.coins > 0) {
      drawText(ctx, `MONEDA x${this.run.coins}`, w / 2, top, { color: COLORS.enemy, align: 'center' });
    }
    // Cuadro del teléfono (abajo, centrado, sobre la línea de controles).
    if (this.dialog) {
      const lines = [];
      this.dialog.lines.forEach((l, i) => wrap(l, Math.max(18, Math.floor((w - 40) / 6))).forEach((ln) => lines.push({ ln, head: i === 0 && this.dialog.lines.length > 1 })));
      const bw = Math.min(w - 16, Math.max(...lines.map((l) => measureText(l.ln))) + 16), bh = lines.length * 10 + 10;
      const bx = Math.round(w / 2 - bw / 2), by = Math.round(h - bh - 44);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.94)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = COLORS.player; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1);
      ctx.fillStyle = COLORS.wall; ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
      lines.forEach((l, i) => drawText(ctx, l.ln, Math.round(w / 2), by + 6 + i * 10, { color: l.head ? COLORS.player : COLORS.text, align: 'center' }));
    }
  }
}
