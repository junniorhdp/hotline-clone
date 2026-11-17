import { findPath, moveAndSlide } from './map.js';
import { segmentPointDistance } from './weapons.js';
import { pixelRect, WORLD_PX } from './sprites.js';
import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';

// Rehenes atados a sillas en algunas salas del edificio (los coloca loadLevel: ver placeHostages en map.js).
//   · Se LIBERAN con PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de la bota) estando cerca: +1500 puntos y corren a la entrada del edificio.
//   · Los DISPAROS del jugador los hieren: la bala se detiene en el rehén y lo mata (−2000 puntos al final del piso, y la culpa del protagonista:
//     se quita la máscara y vomita, ver Game.guilt). Los golpes cuerpo a cuerpo NO les hacen nada: la forma segura de limpiar una sala con rehenes.
//     (No hay explosiones en el juego.) Las balas enemigas los atraviesan: solo cuenta lo que dispara el jugador.
// Estados: tied → freed (corre a la entrada) → safe (a salvo, desaparece) · dead.
const RESCUE_POINTS = 1500, KILL_PENALTY = 2000;
const INTERACT_GAP = 22;        // distancia al borde del rehén para liberarlo
const RUN_SPEED = 120;

const TIED = ['¡MMMPH! ¡MMM!', '¡MMM-MMM!', '(SOLLOZOS...)', '¡MMMPH!', '¡MMM! ¡MMM!'];
const FREED = ['¡GRACIAS!', '¡ME SALVASTE!', '¡CUIDADO, HAY MÁS!', '¡NO ME DEJES AQUÍ!'];

class Hostage {
  constructor(d) {
    this.x = d.x; this.y = d.y;
    this.look = d.look;
    this.facing = d.facing;
    this.r = 7;
    this.state = 'tied';
    this.say = null; this.sayT = 0; this.sayCd = 0.5 + Math.random();
    this.path = null; this.pathT = 0;
    this.shiver = Math.random() * 6;
    this.fade = 1;
  }
  get alive() { return this.state === 'tied' || this.state === 'freed'; }
}

export class Hostages {
  constructor(game, data = []) {
    this.game = game;
    this.list = data.map((d) => new Hostage(d));
    this.clock = 0;
  }

  get total() { return this.list.length; }

  // El rehén atado más cercano que se puede liberar desde donde está el jugador (o null).
  nearTarget() {
    const p = this.game.player;
    let best = null, bd = INTERACT_GAP;
    for (const h of this.list) {
      if (h.state !== 'tied') continue;
      const d = Math.hypot(p.x - h.x, p.y - h.y) - h.r;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  update(dt) {
    const g = this.game, p = g.player, map = g.map;
    this.clock += dt;
    if (this.list.length === 0) return;
    const hot = g.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert')); // hay pelea: tiemblan más
    for (const h of this.list) {
      h.sayT = Math.max(0, h.sayT - dt);
      h.sayCd = Math.max(0, h.sayCd - dt);
      if (h.state === 'tied') {
        h.shiver += dt * (hot ? 45 : 14);
        // Gimen amordazados cuando el jugador está cerca.
        if (p.alive && h.sayCd <= 0 && h.sayT <= 0 && Math.hypot(p.x - h.x, p.y - h.y) < 150) { h.say = TIED[Math.floor(Math.random() * TIED.length)]; h.sayT = 2.2; h.sayCd = 4 + Math.random() * 3; }
      } else if (h.state === 'freed') {
        // Corre a la entrada del edificio y allí se pone a salvo.
        const e = g.entry;
        if (Math.hypot(e.x - h.x, e.y - h.y) < 26) { h.state = 'safe'; g.addFloat(h.x, h.y - 18, '¡A SALVO!', '#9be32a', 1, 1.4); continue; }
        h.pathT -= dt;
        if (!h.path || h.pathT <= 0) { h.path = findPath(map, h.x, h.y, e.x, e.y); h.pathT = 0.6; }
        const path = h.path;
        if (path) {
          while (path.length && Math.hypot(path[0].x - h.x, path[0].y - h.y) < 8) path.shift();
          if (path.length) {
            const dx = path[0].x - h.x, dy = path[0].y - h.y, d = Math.hypot(dx, dy) || 1;
            moveAndSlide(map, h, (dx / d) * RUN_SPEED * dt, (dy / d) * RUN_SPEED * dt);
            h.facing = Math.atan2(dy, dx);
          }
        }
        h.shiver += dt * 30;
      }
      if (h.state === 'safe') h.fade = Math.max(0, h.fade - dt * 2);
    }
    // Liberar: PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de la bota) junto a un rehén atado.
    if ((g.state === 'playing' || g.state === 'cleared') && p.alive && !g.panel && !p.exec && !p.vomit && (g.keys.pressed('kick') || g.keys.pressed('execute'))) {
      const t = this.nearTarget();
      if (t) this.free(t);
    }
  }

  free(h) {
    const g = this.game;
    h.state = 'freed';
    h.say = FREED[Math.floor(Math.random() * FREED.length)]; h.sayT = 2.4; h.sayCd = 6;
    g.score.addBonus(RESCUE_POINTS);
    g.sfx.play('unlock');
    g.sfx.play('pickup', 0.8);
    g.addFloat(h.x, h.y - 20, `¡REHÉN LIBERADO! +${RESCUE_POINTS}`, '#9be32a', 1, 1.8);
    g.particles.dust(h.x, h.y, 6);
  }

  // Una bala del jugador: la bala se detiene en el rehén y lo mata (−2000 al final del piso y culpa). Devuelve true si le dio a alguien.
  bulletHit(b) {
    for (const h of this.list) {
      if (!h.alive || segmentPointDistance(b.px, b.py, b.x, b.y, h.x, h.y) >= h.r + b.r) continue;
      this.kill(h, Math.atan2(b.vy, b.vx));
      return true;
    }
    return false;
  }

  kill(h, angle) {
    const g = this.game;
    h.state = 'dead';
    h.say = null; h.sayT = 0;
    g.bleed(h.x, h.y, angle, 1, 0.8);
    if (Math.hypot(g.player.x - h.x, g.player.y - h.y) < 120) g.stainPlayer(0.8, angle);
    g.camera.addShake(8);
    g.sfx.play('hit');
    g.addFloat(h.x, h.y - 22, `¡REHÉN ABATIDO! -${KILL_PENALTY} AL FINAL`, COLORS.blood, 1, 2.2);
    g.street.startGuilt(); // culpa: a los 3 s el protagonista se quita la máscara y vomita (ver Game.guilt)
  }

  // Resumen para el final del piso.
  summary() {
    const saved = this.list.filter((h) => h.state === 'freed' || h.state === 'safe').length;
    const killed = this.list.filter((h) => h.state === 'dead').length;
    return { total: this.list.length, saved, killed, penalty: killed * KILL_PENALTY };
  }

  // --- Dibujo ---------------------------------------------------------------------------------------
  draw(ctx) {
    for (const h of this.list) {
      if (h.state === 'safe' && h.fade <= 0) continue;
      this.drawOne(ctx, h);
    }
  }

  drawOne(ctx, h) {
    const L = h.look, x = Math.round(h.x), y = Math.round(h.y);
    const tied = h.state === 'tied', dead = h.state === 'dead';
    const sh = (tied || h.state === 'freed') ? Math.round(Math.sin(h.shiver)) : 0;
    const a = h.state === 'safe' ? h.fade : 1;
    ctx.save();
    ctx.globalAlpha = a;
    const px = (ox, oy, w, hh, col) => { ctx.fillStyle = col; pixelRect(ctx, x + (ox + sh) * WORLD_PX, y + oy * WORLD_PX, w, hh); };
    if (dead) {                                   // tumbado junto a la silla caída
      px(-8, 3, 16, 5, 'rgba(5,0,15,0.5)');
      px(-9, -2, 5, 9, '#14100a'); px(-8, -1, 3, 7, '#5b4a2a');            // silla caída
      px(-4, -3, 12, 7, '#14100a'); px(-3, -2, 10, 5, L.shirt); px(-3, -2, 10, 5, 'rgba(0,0,0,0.4)');
      px(8, -2, 4, 5, '#14100a'); px(8, -1, 3, 3, L.skin); px(8, -1, 3, 3, 'rgba(0,0,0,0.4)');
      ctx.restore();
      return;
    }
    px(-6, 4, 14, 4, 'rgba(5,0,15,0.5)');                                    // sombra
    if (tied) {                                  // silla (respaldo detrás) y asiento
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(h.facing);
      ctx.fillStyle = '#14100a'; pixelRect(ctx, -16, -10, 5, 20);
      ctx.fillStyle = '#5b4a2a'; pixelRect(ctx, -15, -9, 3, 18);
      ctx.fillStyle = '#3a2f1a'; pixelRect(ctx, -12, -8, 14, 16);
      ctx.restore();
    }
    // cuerpo (camisa), cabeza con pelo y la cara con una mordaza
    px(-6, -5, 12, 10, '#14100a'); px(-5, -4, 10, 8, L.shirt); px(-5, -4, 10, 2, 'rgba(255,255,255,0.18)');
    px(-3, -8, 7, 6, '#14100a'); px(-2, -7, 5, 4, L.hair);
    if (L.gender === 'f') { px(-4, -7, 1, 7, L.hair); px(4, -7, 1, 7, L.hair); }
    const fx = Math.cos(h.facing) >= 0 ? 1 : -2;
    px(fx, -6, 2, 2, L.skin);
    if (tied) {
      px(fx, -6, 2, 1, '#e8e4f0');                                          // mordaza
      px(-6, -3, 12, 1, '#b8864a'); px(-6, 1, 12, 1, '#b8864a');           // cuerdas
      px(-7, -1, 2, 3, L.skin);                                              // manos atadas a la espalda
      px(0, -12, 1, 3, '#ffbe0b'); px(0, -8, 1, 1, '#ffbe0b');              // «!» de socorro
    }
    ctx.restore();
  }

  // Pantalla: aviso de liberar y burbujas (frases amordazadas / de gratitud).
  drawHud(ctx, w, h) {
    const g = this.game;
    if (this.list.length === 0 || (g.state !== 'playing' && g.state !== 'cleared')) return;
    const cam = g.camera;
    const t = g.player.alive && !g.panel ? this.nearTarget() : null;
    if (t) {
      const txt = `${g.hint(g.keys.label('kick'), 'BOTA')} · LIBERAR`;
      const s = cam.worldToScreen(t.x, t.y + 20);
      const p = g.keepOnScreen(s.x, s.y, measureText(txt), 8);
      drawText(ctx, txt, p.x, p.y, { color: '#9be32a', align: 'center', shadow: COLORS.background });
    }
    for (const hs of this.list) {
      if (!hs.alive || hs.sayT <= 0 || !hs.say) continue;
      const s = cam.worldToScreen(hs.x, hs.y - 26);
      if (s.x < -4 || s.x > w + 4 || s.y < -4 || s.y > h + 4) continue;
      const tw = measureText(hs.say), bp = g.keepOnScreen(s.x, s.y - 3, tw + 8, 13, 6);
      const bx = Math.round(bp.x - (tw + 8) / 2), by = Math.round(bp.y);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, tw + 8, 13);
      ctx.fillStyle = hs.state === 'freed' ? '#9be32a' : '#ffbe0b';
      ctx.fillRect(bx, by, tw + 8, 1); ctx.fillRect(bx, by + 12, tw + 8, 1); ctx.fillRect(bx, by, 1, 13); ctx.fillRect(bx + tw + 7, by, 1, 13);
      drawText(ctx, hs.say, bx + 4, by + 3, { color: COLORS.text, shadow: null });
    }
  }
}
