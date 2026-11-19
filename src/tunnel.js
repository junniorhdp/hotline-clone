import { moveAndSlide, lineOfSight } from './map.js';
import { renderFloor, renderWalls, renderProps } from './decor.js';
import { drawSprite, pixelRect, pixelDisc, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';
import { COLORS, angleDiff, rand } from './utils.js';
import { buildTunnelMap } from './tunnel-map.js';

// TRAMO DE ALCANTARILLA del piso 3 (estado 'sewer'). Al forzar la tapa de la entrada con la palanca se baja a un túnel corto con colisiones: pilares de piedra, un canal de
// agua, tuberías y una escalera al otro extremo que sube al cuarto de servicio del edificio. Un COCODRILO (invulnerable) hace la ronda por el túnel:
//   · patrulla despacio por la fila despejada (`patrol`) y te ve si estás en su cono de visión con línea de visión (o muy cerca, aunque le des la espalda);
//   · al verte se detiene y avisa (`alert`, línea roja en el suelo; el rumbo se bloquea en el último tramo del aviso) y EMBISTE en línea recta (`charge`, 420 u/s);
//   · si choca con un pilar o una pared queda aturdido (`crash`) y puedes pasar; si no choca, recupera el aliento (`recover`) y vuelve a la ronda;
//   · un arma LANZADA a sus ojos lo CIEGA (`blind`; la palanca 5 s, otra arma 2,5 s): ya no te ve y no hace daño; es la salida más segura.
// Tocarlo con la ronda, el aviso, la embestida o al recuperarse es mortal (R reaparece en la calle: no se había entrado todavía). Aquí no hay enemigos ni armas del suelo.
const VIEW = 230, CONE = 1.05, NEAR = 78;      // alcance de la vista, medio ángulo del cono (rad) y radio de «lo oigo/lo huelo» aunque esté a su espalda
const PATROL_SPEED = 56, CHARGE_SPEED = 420;
const WINDUP = 0.7, LOCK_AT = 0.45, CHARGE_MAX = 0.95, RECOVER = 0.8, CRASH = 2.3;
const BLIND_CROWBAR = 5, BLIND_OTHER = 2.5;
const HEAD = 24;                               // distancia del centro a la cabeza
const BODY_R = 13, HEAD_R = 11, EYE_R = 14;    // radios de contacto (cuerpo y cabeza) y de la zona de los ojos para el arma lanzada
const LADDER_REACH = 44;                       // distancia al centro de la escalera para poder subir

class Croc {
  constructor(map) {
    this.map = map;
    this.x = map.crocStart.x; this.y = map.crocStart.y;
    this.r = BODY_R - 1;                       // semitamaño de colisión con las paredes (moveAndSlide)
    this.angle = Math.PI;
    this.mode = 'patrol';
    this.t = 0;
    this.leg = 0; this.dirStep = 1;            // ronda: índice del tramo y sentido
    this.lock = 0;                             // rumbo bloqueado de la embestida
    this.hold = 0;                             // pausa al girar en los extremos de la ronda
    this.charged = 0;
    this.blindT = 0;
    this.wander = 0;
    this.seen = false;
  }

  get head() { return { x: this.x + Math.cos(this.angle) * HEAD, y: this.y + Math.sin(this.angle) * HEAD }; }
  get lethal() { return this.mode === 'patrol' || this.mode === 'alert' || this.mode === 'charge' || this.mode === 'recover'; }

  // ¿Ve al jugador? Cono delante, con línea de visión, o muy cerca (le des o no la espalda).
  sees(p) {
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > VIEW || !lineOfSight(this.map, this.x, this.y, p.x, p.y)) return false;
    if (d < NEAR) return true;
    return Math.abs(angleDiff(Math.atan2(p.y - this.y, p.x - this.x), this.angle)) < CONE;
  }

  blind(seconds, run, game) {
    this.mode = 'blind'; this.t = 0; this.blindT = seconds; this.wander = 0;
    game.playAt('crocDown', this.x, this.y, 1);
    game.addFloat(this.x, this.y - 30, '¡EN LOS OJOS!', '#ffffff', 2, 1.2);
    game.camera.addShake(8); game.fx.kick(0.4);
    game.particles.sparks(this.head.x, this.head.y, this.angle, 10, 0.6);
  }

  update(dt, p, run, game) {
    this.t += dt;
    const m = this.map;
    const step = (speed, ang) => moveAndSlide(m, this, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt);
    if (this.mode === 'patrol') {
      const tgt = m.route[this.leg];
      if (this.hold > 0) this.hold -= dt;
      else {
        const dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy);
        if (d < 8) {                                   // fin del tramo: espera, gira y sigue por el siguiente
          const next = this.leg + this.dirStep;
          if (next < 0 || next >= m.route.length) this.dirStep = -this.dirStep;
          this.leg = Math.max(0, Math.min(m.route.length - 1, this.leg + this.dirStep));
          this.hold = 0.9;
        } else {
          const want = Math.atan2(dy, dx);
          this.angle += angleDiff(want, this.angle) * Math.min(1, dt * 4);
          step(PATROL_SPEED, this.angle);
        }
      }
      if (p.alive && this.sees(p)) {
        this.mode = 'alert'; this.t = 0; game.playAt('crocUp', this.x, this.y, 1); game.addFloat(this.x, this.y - 30, '¡GRRR!', '#ff2e55', 2, 0.9);
        if (!run.hinted) { run.hinted = true; game.addFloat(p.x, p.y - 34, p.weapon ? `LÁNZALE ${p.weapon.type === 'crowbar' ? 'LA PALANCA' : 'EL ARMA'} A LOS OJOS · ${game.hint(game.keys.label('throw'), 'LANZAR')}` : 'ESQUIVA: QUE SE ESTRELLE CONTRA UN PILAR', '#ffffff', 1, 2.6); }
      }
    } else if (this.mode === 'alert') {
      if (this.t < LOCK_AT) this.angle += angleDiff(Math.atan2(p.y - this.y, p.x - this.x), this.angle) * Math.min(1, dt * 14); // se encara contigo
      else this.lock = this.angle;
      if (this.t >= WINDUP) { this.mode = 'charge'; this.t = 0; this.charged = 0; game.camera.addShake(3); }
    } else if (this.mode === 'charge') {
      const ang = this.lock;
      this.angle = ang;
      const hit = step(CHARGE_SPEED, ang);
      this.charged += dt;
      if (Math.random() < 0.7) game.particles.dust(this.x - Math.cos(ang) * 26 + rand(-4, 4), this.y - Math.sin(ang) * 26 + rand(-4, 4), 1);
      if (hit.hitX || hit.hitY) {                      // choca con un pilar o una pared: aturdido
        this.mode = 'crash'; this.t = 0;
        game.camera.addShake(14); game.fx.kick(0.5);
        game.playAt('knock', this.x, this.y, 1);
        game.particles.dust(this.x + Math.cos(ang) * 20, this.y + Math.sin(ang) * 20, 12);
        game.particles.sparks(this.x + Math.cos(ang) * 24, this.y + Math.sin(ang) * 24, ang + Math.PI, 8, 0.5);
        game.addFloat(this.x, this.y - 30, '¡AL PILAR!', '#ffbe0b', 2, 1.1);
      } else if (this.charged >= CHARGE_MAX) { this.mode = 'recover'; this.t = 0; }
    } else if (this.mode === 'recover') {
      if (this.t >= RECOVER) { this.mode = 'patrol'; this.t = 0; }
    } else if (this.mode === 'crash') {
      if (this.t >= CRASH) { this.mode = 'patrol'; this.t = 0; }
    } else if (this.mode === 'blind') {
      this.blindT -= dt;
      this.wander -= dt;
      if (this.wander <= 0) { this.wander = rand(0.3, 0.7); this.angle += rand(-1.4, 1.4); }
      step(34, this.angle);                            // tambalea sin rumbo
      if (this.blindT <= 0) { this.mode = 'patrol'; this.t = 0; }
    }
    // Mordisco: solo con el cocodrilo en condiciones de hacerlo (no aturdido ni ciego).
    if (p.alive && this.lethal) {
      const h = this.head;
      if (Math.hypot(p.x - this.x, p.y - this.y) < BODY_R + p.r - 2 || Math.hypot(p.x - h.x, p.y - h.y) < HEAD_R + p.r - 2) this.bite(p, game);
    }
  }

  bite(p, game) {
    const ang = Math.atan2(p.y - this.y, p.x - this.x);
    game.playAt('crocSnap', this.x, this.y, 1);
    game.addFloat(this.x, this.y - 30, '¡CLAC!', '#ffffff', 2, 0.9);
    game.deathMsg = 'DEVORADO POR EL COCODRILO';
    game.killPlayer(ang);
  }

  draw(ctx, clock) {
    drawSprite(ctx, 'croc', this.x, this.y, this.angle);
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const at = (f, l) => ({ x: this.x + ca * f - sa * l, y: this.y + sa * f + ca * l });
    if (this.mode === 'alert') {                        // línea de aviso en el suelo hasta donde va a embestir
      const blink = Math.floor(clock * 14) % 2 === 0;
      ctx.fillStyle = blink ? '#ff2e55' : '#ff7a9a';
      for (let d = HEAD + 6; d < 300; d += 10) { const q = at(d, 0); pixelRect(ctx, q.x - 1, q.y - 1, 1, 1); }
      const a = at(10, 0); drawText(ctx, '!', a.x, a.y - 34, { color: '#ff2e55', scale: WORLD_PX, align: 'center' });
    } else if (this.mode === 'blind') {                 // ojos tapados y estrellitas
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) { const e = at(19, s * 4); pixelRect(ctx, e.x - 1, e.y - 1, 2, 2); }
      for (let k = 0; k < 3; k++) { const ph = clock * 5 + k * 2.1; const q = at(14, 0); pixelRect(ctx, q.x + Math.cos(ph) * 14, q.y + Math.sin(ph) * 14 - 8, 1, 1); }
    } else if (this.mode === 'crash') {
      ctx.fillStyle = '#ffbe0b';
      for (let k = 0; k < 4; k++) { const ph = clock * 4 + k * 1.6; const q = at(14, 0); pixelRect(ctx, q.x + Math.cos(ph) * 16, q.y + Math.sin(ph) * 10 - 12, 2, 1); }
    }
  }
}

// Estado del tramo: el mapa del túnel, sus capas ya dibujadas, el cocodrilo y la escalera de subida.
export class SewerRun {
  constructor(game) {
    this.map = buildTunnelMap();
    this.clock = 0;
    this.nearLadder = false;
    this.hinted = false;                       // el aviso de «lánzale el arma» sale una sola vez
    this.croc = new Croc(this.map);
    this.build();
    // Reflejos en el agua (posiciones fijas con fase propia).
    this.glints = [];
    for (let i = 0; i < 46; i++) this.glints.push({ x: 70 + Math.random() * (this.map.pixelW - 140), y: 5 * 32 + 6 + Math.random() * 3 * 32 - 12, ph: Math.random() * 6 });
  }

  // Capas estáticas (suelo, paredes con tuberías, muebles) y las de sangre (a media resolución, como las del piso).
  build() {
    const m = this.map, PX = 16;
    this.floorLayer = renderFloor(m);
    this.propsLayer = renderProps(m);
    const { walls, glow } = renderWalls(m);
    const wc = walls.getContext('2d');
    wc.fillStyle = '#05030a';                                             // el borde del mapa (la «valla» de la calle) aquí es roca negra
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) if (tx === 0 || ty === 0 || tx === m.w - 1 || ty === m.h - 1) wc.fillRect(tx * PX, ty * PX, PX, PX);
    for (const ty of [1, m.h - 2]) {                                      // tuberías a lo largo de las dos paredes largas, con juntas y válvulas
      for (let tx = 2; tx < m.w - 2; tx++) {
        const x0 = tx * PX, y0 = ty * PX + (ty === 1 ? 5 : 3);
        wc.fillStyle = '#140a24'; wc.fillRect(x0, y0 - 1, PX, 6);
        wc.fillStyle = '#4a5a6e'; wc.fillRect(x0, y0, PX, 4);
        wc.fillStyle = '#7a8aa0'; wc.fillRect(x0, y0, PX, 1);
        wc.fillStyle = '#2a3342'; wc.fillRect(x0, y0 + 3, PX, 1);
        if (tx % 6 === 2) { wc.fillStyle = '#2a3342'; wc.fillRect(x0 + 6, y0 - 2, 3, 8); wc.fillStyle = '#ff2e55'; wc.fillRect(x0 + 6, y0 - 3, 3, 2); }
      }
    }
    this.wallLayer = walls;
    this.glowLayer = glow;
    this.bloodLayer = document.createElement('canvas');
    this.bloodLayer.width = m.pixelW / WORLD_PX; this.bloodLayer.height = m.pixelH / WORLD_PX;
    this.bloodCtx = this.bloodLayer.getContext('2d'); this.bloodCtx.imageSmoothingEnabled = false;
    this.wallBloodLayer = document.createElement('canvas');
    this.wallBloodLayer.width = this.bloodLayer.width; this.wallBloodLayer.height = this.bloodLayer.height;
    this.wallBloodCtx = this.wallBloodLayer.getContext('2d'); this.wallBloodCtx.imageSmoothingEnabled = false;
  }

  update(dt, game) {
    this.clock += dt;
    const p = game.player;
    // Arma lanzada a los ojos: ciega al cocodrilo (la palanca más tiempo) y rebota. El cuerpo no sufre daño: es invulnerable.
    const c = this.croc;
    for (const w of game.pickups) {
      if (!w.flying || !w.hurts || !w.alive) continue;
      const h = c.head;
      if (Math.hypot(w.x - h.x, w.y - h.y) < EYE_R + w.r) {
        c.blind(w.type === 'crowbar' ? BLIND_CROWBAR : BLIND_OTHER, this, game);
        w.bounce();
      } else if (Math.hypot(w.x - c.x, w.y - c.y) < BODY_R + w.r) { w.bounce(); game.sfx.play('ricochet', 0.6); game.particles.sparks(w.x, w.y, Math.atan2(-w.vy, -w.vx), 5, 0.4); }
    }
    if (p.alive) c.update(dt, p, this, game);
    const l = this.map.ladder;
    this.nearLadder = p.alive && Math.hypot(p.x - l.x, p.y - l.y) < LADDER_REACH;
    if (this.nearLadder && (game.keys.pressed('kick') || game.keys.pressed('execute'))) game.climbLadder();
  }

  // Capas bajo los personajes: reflejos del agua y la luz que cae por el pozo de la escalera de subida.
  drawBelow(ctx) {
    ctx.fillStyle = '#7fe8ff';
    ctx.globalAlpha = 0.5;
    for (const g of this.glints) if (Math.sin(this.clock * 2.4 + g.ph) > 0.55) pixelRect(ctx, g.x, g.y, 3, 1);
    ctx.globalAlpha = 1;
    const l = this.map.ladder;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffe08a';
    for (const [r, a] of [[26, 0.05], [18, 0.07], [11, 0.1]]) { ctx.globalAlpha = a + 0.015 * Math.sin(this.clock * 3); pixelDisc(ctx, l.x / WORLD_PX, l.y / WORLD_PX, r, WORLD_PX); }
    ctx.restore();
  }

  drawCroc(ctx) { this.croc.draw(ctx, this.clock); }
}
