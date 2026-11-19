import { TILE } from './map.js';
import { Pickup, WEAPON_DEFS, STREET_LOOT, inMeleeArc, segmentPointDistance } from './weapons.js';
import { Vagrant } from './npcs.js';
import { pixelRect, pixelDisc, WORLD_PX } from './sprites.js';
import { drawText, measureText } from './pixelfont.js';
import { COLORS, clamp, seededRandom, hashString } from './utils.js';

// Vida de la calle (zona exterior de cada piso). Todo es opcional y no toca el combate:
//   · CONTENEDORES: se registran con PATEAR/INTERACTUAR; pueden esconder un arma improvisada oxidada (STREET_LOOT: tubo, cuchillo, palanca).
//   · MONEDAS: 2 escondidas en rincones de la calle. MÁQUINA EXPENDEDORA: moneda → lata que da un buff temporal (`game.buff`).
//   · CABINA TELEFÓNICA: suena al llegar; al contestar da una pista o un reto opcional con bonus de puntos al acabar el piso.
//   · VAGABUNDOS (npcs.js): varios, sentados o junto a una fogata; se asustan si te acercas armado o con sangre; se les puede dañar
//     (huyen) pero cada civil dañado o muerto resta puntos al final del piso.
// Las posiciones salen de map.street (generadas al azar por partida y piso en map.js, ver withOutskirts); el estado que sobrevive a R vive en game.streetRun.

const INTERACT_GAP = 28;      // distancia (al borde del objeto) para poder interactuar
const COIN_RADIUS = 18;
const BUFF_TIME = 45;         // segundos de lata, contados solo dentro del edificio
const PENALTY_HURT = 400, PENALTY_KILL = 1500; // puntos que resta cada civil herido / muerto al final del piso
const GIFT_POINTS = 300;      // puntos por darle una moneda a un vagabundo
const GUILT_DELAY = 3;        // s hasta que el jugador vomita tras matar a un civil
const MOURN_RANGE = 340;      // los civiles que ven morir a otro (a menos de esto) entran en pánico profundo
const COIN_SHOW = 3.5;        // s que se ve el contador de monedas tras subir

export function newStreetRun() {
  return { taken: [], coins: 0, phoneDone: false, phoneLines: null, challenge: null };
}

const LORE = [
  'HAN CERRADO EL EDIFICIO CON TODOS DENTRO. LA ÚNICA SALIDA ES LA MOTO.',
  'EL EJECUTOR EMBISTE SIN PARAR... HASTA QUE SE ESTRELLA CONTRA UNA PARED.',
  'LOS CONTENEDORES GUARDAN MÁS QUE BASURA. REVISA LOS DE LA CALLE.',
  'ALGUIEN PERDIÓ UNAS MONEDAS POR LOS RINCONES. LA MÁQUINA SABE PARA QUÉ.',
  'ESE COCODRILO DE LA ALCANTARILLA... SI TE ACERCAS, MUERDE. A VECES SUELTA ALGO.',
  'ESA LATA DE LA MÁQUINA TE DA VELOCIDAD, PERO SOLO DENTRO DEL EDIFICIO.',
  'LOS VAGABUNDOS NO TIENEN LA CULPA DE NADA. NO LOS TOQUES.',
];
const CHALLENGES = [
  { id: 'nogun', bonus: 2000, text: () => 'TERMINA EL PISO SIN DISPARAR NI UNA VEZ.', check: (g) => !['gun', 'shotgun', 'smg'].some((t) => g.stats.uses[t]) },
  { id: 'fast', bonus: 1500, text: (g) => `DESPEJA EL EDIFICIO EN MENOS DE ${Math.round(g.par * 0.8)} S.`, check: (g) => g.time <= g.par * 0.8 },
  { id: 'combo', bonus: 1800, text: () => 'ENCADENA UN COMBO DE X4 O MÁS.', check: (g) => g.score.maxCombo >= 4 },
];

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
// Elige un tipo del catálogo con pesos.
function weighted(list, r) {
  let t = r * list.reduce((a, [, w]) => a + w, 0);
  for (const [type, w] of list) { if ((t -= w) < 0) return type; }
  return list[0][0];
}

export class StreetLife {
  constructor(game) {
    this.game = game;
    this.clock = 0;
    this.dialog = null;                 // { lines, t }
    const m = game.map, st = m.street || {}, run = game.streetRun;
    const rnd = seededRandom(hashString(`${game.runId || 'x'}|${game.levelIndex}|street`));
    this.rnd = rnd;
    // Contenedores: el primero siempre guarda un arma improvisada (tipo al azar con pesos); los demás, a veces.
    this.dumpsters = m.props.filter((p) => p.type === 'dumpster').map((p, i) => ({
      kind: 'dumpster', x: (p.x + p.w / 2) * TILE, y: (p.y + p.h / 2) * TILE, w: p.w * TILE, h: p.h * TILE, open: false,
      loot: i === 0 || rnd() < 0.45 ? weighted(STREET_LOOT, rnd()) : null,
    }));
    const box = (c) => (c ? { x: c.x, y: c.y, w: TILE, h: TILE } : null);
    this.vending = st.vending ? { kind: 'vending', ...box(st.vending) } : null;
    this.phone = st.phone ? { kind: 'phone', ...box(st.phone) } : null;
    // Los vagabundos no pueden entrar al edificio (zona vetada: su huella hasta la puerta principal).
    const z = game.entry.zone;
    const ban = { x0: z.x0, x1: z.x1, y0: z.y0, y1: game.entry.y + 2 * TILE };
    this.ban = ban;
    this.npcs = (st.npcs || []).map((d) => new Vagrant(d, ban, this));
    this.fires = st.fire ? [{ x: st.fire.x, y: st.fire.y }] : [];
    this.coins = (st.coins || []).map((c, i) => ({ id: i, x: c.x, y: c.y })).filter((c) => !run.taken.includes(c.id));
    this.extraCoins = 0;
    this.lastCoins = run.coins; this.coinFlash = 0; // contador de monedas: se muestra unos segundos cuando sube
    this.hurtSet = new Set(); this.killedSet = new Set();
    this.ringT = 0.5;
  }

  get run() { return this.game.streetRun; }
  get ringing() { return !!this.phone && !this.game.entered && !this.run.phoneDone; }

  // Objetivos de interacción: contenedores, máquina, cabina y, si llevas una moneda, los vagabundos a los que se les puede dar.
  targets() {
    const t = [...this.dumpsters, this.vending, this.phone].filter(Boolean);
    if (this.run.coins > 0) {
      for (const n of this.npcs) {
        if (!n.alive || !n.canGift) continue;
        n.tgt = n.tgt || { kind: 'npc', n, w: 12, h: 12 };
        n.tgt.x = n.x; n.tgt.y = n.y;
        t.push(n.tgt);
      }
    }
    return t;
  }

  nearTarget() {
    const p = this.game.player;
    let best = null, bd = INTERACT_GAP;
    for (const t of this.targets()) { const d = gap(p.x, p.y, t); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.clock += dt;
    if (this.run.coins > this.lastCoins) this.coinFlash = COIN_SHOW; // sube la cantidad: el contador aparece y se ilumina
    this.lastCoins = this.run.coins;
    this.coinFlash = Math.max(0, this.coinFlash - dt);
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
    // Monedas (escondidas o soltadas por el cocodrilo).
    for (const c of this.coins) {
      if (Math.hypot(p.x - c.x, p.y - c.y) >= COIN_RADIUS) continue;
      if (!c.temp) this.run.taken.push(c.id);
      this.run.coins++;
      g.addFloat(c.x, c.y - 8, '¡MONEDA!', COLORS.enemy, 1, 1.2);
      g.playAt('coin', c.x, c.y, 1);
      c.gone = true;
    }
    if (this.coins.some((c) => c.gone)) this.coins = this.coins.filter((c) => !c.gone);
    for (const n of this.npcs) n.update(dt, g);
    // Interacción: PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de patada).
    if (g.keys.pressed('kick') || g.keys.pressed('execute')) {
      const t = this.nearTarget();
      if (t) this.interact(t);
    }
  }

  // Ruido (disparo, golpe, patada) en (x, y): si viene del interior del edificio, los civiles de la calle que no ven al jugador lo oyen y sueltan una
  // línea de alerta indirecta (ver Vagrant.hearNoise).
  noise(x, y, radius) {
    const b = this.ban;
    if (!b || !(x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)) return;
    for (const n of this.npcs) n.hearNoise(x, y, radius);
  }

  // Una moneda suelta cerca de (x, y) (la deja el cocodrilo al morder).
  dropCoin(x, y) {
    this.coins.push({ id: 'x' + (this.extraCoins++), x, y, temp: true });
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
        const pk = new Pickup(t.loot, t.x + Math.cos(ang) * reach, t.y + Math.sin(ang) * reach, 0);
        pk.throwAt(ang, 150);
        g.pickups.push(pk);
        g.addFloat(t.x, t.y - 14, `¡${WEAPON_DEFS[t.loot].name}!`, '#c2682a', 1, 1.4);
      } else g.addFloat(t.x, t.y - 14, 'SOLO BASURA', '#9d8fb8', 1, 1.1);
    } else if (t.kind === 'vending') {
      if (this.run.coins <= 0) { g.addFloat(t.x, t.y - 38, 'NECESITAS UNA MONEDA', COLORS.blood, 1, 1.3); g.sfx.play('empty'); return; }
      this.run.coins--;
      g.buff = { t: BUFF_TIME, max: BUFF_TIME };
      g.sfx.play('can');
      g.addFloat(t.x, t.y - 38, '¡LATA NEÓN! +VELOCIDAD +CADENCIA', COLORS.player, 1, 1.8);
    } else if (t.kind === 'npc') {
      // Darle una moneda a un vagabundo: se pone feliz y agradecido y da puntos extra (una vez por persona).
      if (!t.n.gift()) return;
      if (g.civilianRecord) g.civilianRecord.gifts++;
      this.run.coins--;
      g.score.addBonus(GIFT_POINTS);
      g.sfx.play('coin');
      g.sfx.play('pickup', 0.7);
      g.addFloat(t.n.x, t.n.y - 26, `+${GIFT_POINTS} ¡BUENA ACCIÓN!`, COLORS.enemy, 1, 1.8);
    } else if (t.kind === 'phone') {
      if (this.dialog) { this.dialog = null; return; }
      this.answer();
    }
  }

  // Contesta la cabina: pista de lore o reto opcional (se resuelve al terminar el piso, ver settle()).
  answer() {
    const g = this.game, run = this.run;
    if (!run.phoneLines) {
      if (this.rnd() < 0.6) {
        const def = CHALLENGES[Math.floor(this.rnd() * CHALLENGES.length)];
        const ch = { id: def.id, text: def.text(g), bonus: def.bonus };
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

  // --- Civiles: daño y penalización -----------------------------------------------------------------
  // `def` = arma con la que se golpea (las oxidadas, con `poison`, envenenan: el civil cae, agoniza y muere con sangre verde).
  damage(n, dmg, angle, def = null) {
    const rec = this.game.civilianRecord;
    const g = this.game, poison = !!(def && def.poison);
    const res = poison ? n.poisonHit(g, angle, def.poisonTime) : n.hurt(g, dmg, angle);
    if (!res) return;
    if (res.first) { if (rec) rec.hurt++; this.hurtSet.add(n); g.addFloat(n.x, n.y - 22, `¡CIVIL${poison ? ' ENVENENADO' : ''}! -${PENALTY_HURT} AL FINAL`, COLORS.blood, 1, 1.6); }
    if (res.poisoned) this.startGuilt(); // herida mortal: la culpa empieza ya
  }

  // Un civil ha muerto (golpe, bala o veneno): penalización, culpa del jugador y pánico profundo en los demás.
  civilianDied(n) {
    const g = this.game;
    if (g.civilianRecord) g.civilianRecord.killed++;
    this.hurtSet.add(n); this.killedSet.add(n);
    g.addFloat(n.x, n.y - 30, `¡CIVIL ABATIDO! -${PENALTY_KILL} AL FINAL`, COLORS.blood, 1, 2);
    this.startGuilt();
    for (const m of this.npcs) if (m !== n && m.alive && Math.hypot(m.x - n.x, m.y - n.y) < MOURN_RANGE) m.mourn(n.x, n.y);
  }

  startGuilt() {
    if (!this.game.guilt) this.game.guilt = { t: GUILT_DELAY };
  }

  // Golpe cuerpo a cuerpo del jugador contra los civiles: puños 1 de daño, cualquier arma 2 (tienen 3 de vida). Devuelve true si golpeó a alguien.
  meleeHit(p, def) {
    let hit = false;
    const dmg = p.weapon ? 2 : 1;
    for (const n of this.npcs) {
      if (!n.alive || !inMeleeArc(p.x, p.y, p.angle, def, n)) continue;
      this.damage(n, dmg, p.angle, def);
      hit = true;
    }
    return hit;
  }

  // Una bala del jugador (la bala se detiene en el civil). Devuelve true si le dio a alguien.
  bulletHit(b) {
    for (const n of this.npcs) {
      if (!n.alive || segmentPointDistance(b.px, b.py, b.x, b.y, n.x, n.y) >= n.r + b.r) continue;
      this.damage(n, 3, Math.atan2(b.vy, b.vx));
      return true;
    }
    return false;
  }

  // Resumen para el final del piso: civiles heridos (no muertos), muertos y puntos que restan.
  civilianPenalty() {
    // Los que agonizan envenenados ya cuentan como muertos (no hay vuelta atrás) aunque el piso acabe antes de que mueran.
    const dying = [...this.hurtSet].filter((n) => n.state === 'agony' && !this.killedSet.has(n)).length;
    const killed = this.killedSet.size + dying, hurt = this.hurtSet.size - killed;
    return { hurt, killed, penalty: hurt * PENALTY_HURT + killed * PENALTY_KILL };
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
    // Fogatas en tambores: llamas que bailan y un resplandor naranja que ilumina el suelo.
    for (const f of this.fires) this.drawFire(ctx, f, px);
    // Teléfono sonando: ondas parpadeantes a los lados de la cabina.
    if (this.ringing && Math.floor(this.clock * 3) % 2 === 0) {
      const ph = this.phone;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) px(ph.x, ph.y, side * (11 + k * 3) - 1, -2 - k, 1, 2 + k * 2, k === 2 ? '#05d9e8' : '#ffffff');
      }
    }
    // Monedas: un destello fino que se ve mejor de cerca (están "escondidas"); las que suelta el cocodrilo brillan siempre.
    const p = this.game.player;
    for (const c of this.coins) {
      const near = c.temp || Math.hypot(p.x - c.x, p.y - c.y) < 150;
      const tw = Math.floor(this.clock * 2.2 + c.x * 0.01) % 4;
      if (!near && tw !== 0) continue;
      px(c.x, c.y, -2, -2, 4, 4, '#b38600'); px(c.x, c.y, -1, -3, 2, 1, '#ffbe0b'); px(c.x, c.y, -1, 2, 2, 1, '#ffbe0b');
      px(c.x, c.y, -2, -2, 1, 1, '#fff6c8');
      if (tw === 0) { px(c.x, c.y, -1, -6, 1, 2, '#ffffff'); px(c.x, c.y, -1, 5, 1, 2, '#ffffff'); px(c.x, c.y, -6, -1, 2, 1, '#ffffff'); px(c.x, c.y, 4, -1, 2, 1, '#ffffff'); }
    }
    for (const n of this.npcs) n.draw(ctx, this.clock);
  }

  drawFire(ctx, f, px) {
    const t = this.clock;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07 + 0.03 * Math.sin(t * 11);
    ctx.fillStyle = '#ff7a1a'; pixelDisc(ctx, f.x / WORLD_PX, f.y / WORLD_PX, 24, WORLD_PX);
    ctx.globalAlpha = 0.1 + 0.04 * Math.sin(t * 9 + 1);
    ctx.fillStyle = '#ffb21a'; pixelDisc(ctx, f.x / WORLD_PX, f.y / WORLD_PX, 14, WORLD_PX);
    ctx.restore();
    // llamas: columnas de píxeles de altura cambiante en tres capas
    for (let i = -3; i <= 3; i += 2) {
      const h = 3 + Math.floor(2.5 + 2.5 * Math.sin(t * 10 + i * 1.9)) + (i === 0 ? 2 : 0);
      px(f.x, f.y, i - 1, -3 - h, 2, h, '#ff5a1a');
      px(f.x, f.y, i - 1, -3 - Math.max(1, h - 2), 2, Math.max(1, h - 2), '#ffb21a');
      if (h > 4) px(f.x, f.y, i - 1, -3 - Math.floor(h / 2), 2, Math.floor(h / 2), '#fff1a0');
    }
    // chispas que suben
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.9 + k * 0.37) % 1;
      px(f.x, f.y, Math.round(Math.sin(t * 3 + k * 2) * 4), -10 - Math.round(ph * 12), 1, 1, ph < 0.6 ? '#ffd166' : '#ff7a1a');
    }
  }

  // Pantalla: avisos de interacción, burbujas de los vagabundos, lata activa y cuadro del teléfono.
  drawHud(ctx, w, h) {
    const g = this.game;
    if (g.state !== 'playing' && g.state !== 'cleared') return;
    const cam = g.camera;
    const label = (text, wx, wy, color = COLORS.text) => {
      const s = cam.worldToScreen(wx, wy);
      const p = g.keepOnScreen(s.x, s.y, measureText(text), 8);
      drawText(ctx, text, p.x, p.y, { color, align: 'center', shadow: COLORS.background });
    };
    const key = g.hint(g.keys.label('kick'), 'BOTA'); // en táctil: el botón superior (la bota) se enciende cuando hay algo con lo que interactuar
    const t = g.player.alive && !g.panel ? this.nearTarget() : null;
    if (t) {
      let txt;
      if (t.kind === 'dumpster') txt = t.open ? null : `${key} · REGISTRAR`;
      else if (t.kind === 'npc') txt = `${key} · DAR MONEDA`;
      else if (t.kind === 'vending') txt = this.run.coins > 0 ? `${key} · USAR MONEDA` : 'MÁQUINA · FALTA UNA MONEDA';
      else txt = this.ringing ? `${key} · CONTESTAR` : `${key} · TELÉFONO`;
      if (txt) label(txt, t.x, t.kind === 'npc' ? t.y + 14 : t.y - t.h / 2 - 12, t.kind === 'phone' && this.ringing ? COLORS.player : COLORS.text);
    }
    // Burbujas de los vagabundos (cajas enteras con margen de seguridad en los cuatro bordes).
    // Solo hablan a la vez los 2 más cercanos y las burbujas no se pisan (se apilan hacia arriba).
    const onScreen = (n) => { const q = cam.worldToScreen(n.x, n.y); return q.x > -4 && q.x < w + 4 && q.y > -4 && q.y < h + 4; }; // las burbujas son solo de los que se ven
    const talkers = this.npcs.filter((n) => n.alive && n.sayT > 0 && n.say && onScreen(n))
      .sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y)).slice(0, 2);
    const boxes = [];
    for (const n of talkers) {
      const s = cam.worldToScreen(n.x, n.y - 24);
      const tw = measureText(n.say), bp = g.keepOnScreen(s.x, s.y - 3, tw + 8, 13, 6);
      const bx = Math.round(bp.x - (tw + 8) / 2);
      let by = Math.round(bp.y);
      for (let k = 0; k < 4 && boxes.some((b) => Math.abs(b.y - by) < 15 && bx < b.x + b.w && bx + tw + 8 > b.x); k++) by -= 15;
      by = Math.max(by, 4 + g.safe.t);
      boxes.push({ x: bx, y: by, w: tw + 8 });
      ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, tw + 8, 13);
      ctx.fillStyle = n.state === 'mourn' ? '#7ad7ff' : n.state === 'happy' ? COLORS.enemy : n.scared ? COLORS.blood : COLORS.player;
      ctx.fillRect(bx, by, tw + 8, 1); ctx.fillRect(bx, by + 12, tw + 8, 1); ctx.fillRect(bx, by, 1, 13); ctx.fillRect(bx + tw + 7, by, 1, 13);
      drawText(ctx, n.say, bx + 4, by + 3, { color: COLORS.text, shadow: null });
    }
    // Lata activa (arriba, al centro) o monedas guardadas.
    const top = 5 + g.safe.t;
    if (g.buff) {
      const k = clamp(g.buff.t / g.buff.max, 0, 1), bw = 78, bx = Math.round(w / 2 - bw / 2);
      drawText(ctx, `LATA NEÓN ${Math.ceil(g.buff.t)}S`, w / 2, top, { color: COLORS.player, align: 'center' });
      ctx.fillStyle = '#140a24'; ctx.fillRect(bx, top + 10, bw, 3);
      ctx.fillStyle = COLORS.player; ctx.fillRect(bx, top + 10, Math.round(bw * k), 3);
      if (!g.inside) drawText(ctx, 'SE GASTA DENTRO DEL EDIFICIO', w / 2, top + 15, { color: '#9d8fb8', align: 'center' });
    }
    // Contador de monedas: aparece (y se ilumina) solo cuando sube la cantidad y se desvanece solo a los pocos segundos.
    if (this.coinFlash > 0) {
      const age = COIN_SHOW - this.coinFlash, fade = clamp(this.coinFlash / 0.8, 0, 1);
      const cx0 = 6 + g.safe.l + (g.input.touchMode ? 72 : 0), cy0 = 54 + g.safe.t; // en táctil, a la derecha del botón REINICIAR (que ocupa ese sitio)
      ctx.save();
      if (age < 0.6) { ctx.globalAlpha = fade * 0.45 * (1 - age / 0.6); ctx.fillStyle = '#ffbe0b'; ctx.fillRect(cx0 - 3, cy0 - 3, 44, 17); }
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#140a24'; ctx.fillRect(cx0, cy0, 10, 10);
      ctx.fillStyle = '#b38600'; ctx.fillRect(cx0 + 1, cy0 + 1, 8, 8);
      ctx.fillStyle = '#ffbe0b'; ctx.fillRect(cx0 + 2, cy0 + 2, 6, 6);
      ctx.fillStyle = '#fff6c8'; ctx.fillRect(cx0 + 3, cy0 + 3, 1, 3);
      drawText(ctx, `x${this.run.coins}`, cx0 + 14, cy0 - 1, { color: age < 0.6 ? '#ffffff' : COLORS.enemy, scale: age < 0.25 ? 3 : 2 });
      ctx.restore();
    }
    // Cuadro del teléfono (abajo, centrado).
    if (this.dialog) {
      // En táctil el cuadro va debajo del HUD y entre los botones de REINICIAR/PAUSA (izquierda) y la columna de botones de la derecha; en escritorio, abajo.
      const tm = g.input.touchMode && g.touch;
      const colL = tm ? g.safe.l + 80 : 8, colR = tm ? g.touch.rightColumn().x - 6 : w - 8;
      const aw = Math.max(120, colR - colL);
      const lines = [];
      this.dialog.lines.forEach((l, i) => wrap(l, Math.max(14, Math.floor((aw - 16) / 6))).forEach((ln) => lines.push({ ln, head: i === 0 && this.dialog.lines.length > 1 })));
      const bw = Math.min(aw, Math.max(...lines.map((l) => measureText(l.ln))) + 16), bh = lines.length * 10 + 10;
      const bx = tm ? Math.round(colL + (aw - bw) / 2) : Math.round(w / 2 - bw / 2), by = tm ? Math.round(36 + g.safe.t) : Math.round(h - bh - 14);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.94)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = COLORS.player; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1);
      ctx.fillStyle = COLORS.wall; ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
      lines.forEach((l, i) => drawText(ctx, l.ln, Math.round(bx + bw / 2), by + 6 + i * 10, { color: l.head ? COLORS.player : COLORS.text, align: 'center' }));
    }
  }
}

// Base para el futuro (piso 10): ¿ayudarían, serían neutrales o estorbarían los civiles de la calle en los flancos exteriores según cómo se ha tratado a los vagabundos durante la
// partida? `rec` = { hurt, killed, gifts } (heridos, muertos y monedas dadas). TODAS las reglas viven aquí: de momento no las usa nadie más que el debug (F1).
export function civiliansHelp(rec) {
  if (!rec) return 'neutral';
  if (rec.killed >= 1 || rec.hurt >= 2) return 'hinder';
  if (rec.gifts >= 2 && rec.hurt === 0) return 'help';
  return 'neutral';
}
