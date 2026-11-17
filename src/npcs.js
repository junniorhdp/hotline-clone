import { moveAndSlide } from './map.js';
import { pixelRect, WORLD_PX } from './sprites.js';

// Vagabundos de la calle (civiles). Cada uno tiene su aspecto (`look`: género, abrigo, pelo, piel, gorro, objeto) y un modo:
//   'fire' = calentándose junto a una fogata en un tambor (mira al fuego) · 'sit' = sentado solo junto a un contenedor.
// Estados: idle (tranquilo) · scared (te acercas armado o manchado de sangre: tiembla y se aparta) · flee (le han hecho daño: huye despavorido)
//          · cower (tras huir, se queda asustado) · dead.
// No son enemigos: no entran en game.enemies ni puntúan; dañarlos (o matarlos) penaliza al final del piso (ver StreetLife.civilianPenalty).

const SCARE_DIST = 150, TALK_DIST = 90, ROAM = 30, MAX_HP = 3, FLEE_TIME = 5, FLEE_SPEED = 150;

const LINES = {
  fire: ['QUÉ FRÍO HACE...', 'ACÉRCATE AL FUEGO.', 'NOCHE LARGA...', 'ESTE TAMBOR ES MI CASA.'],
  sit: ['NOCHE TRANQUILA...', '¿TIENES UNA MONEDA?', 'CUIDADO CON LA ALCANTARILLA...', 'LA MÁQUINA DE LA ACERA FUNCIONA.'],
  armed: ['¡NO QUIERO PROBLEMAS!', '¡GUARDA ESO, POR FAVOR!', '¡YO NO HE VISTO NADA!'],
  blood: ['¡ESO ES SANGRE!', '¡ESTÁS CUBIERTO DE SANGRE!', '¡NO ME HAGAS DAÑO!'],
  hurt: ['¡AAAH!', '¡AUXILIO!', '¡NO, POR FAVOR!', '¡SOCORRO!'],
};

export class Vagrant {
  constructor(d, ban) {
    this.x = d.x; this.y = d.y;
    this.home = { x: d.x, y: d.y };
    this.look = d.look;
    this.mode = d.mode;
    this.fire = d.fire;
    this.ban = ban;
    this.r = 6;
    this.hp = MAX_HP;
    this.state = 'idle';
    this.hurtOnce = false;
    this.fleeT = 0;
    this.say = null; this.sayT = 0; this.sayCd = 1 + Math.random() * 2;
    this.shiver = Math.random() * 6;
    this.fx = d.fire ? Math.sign(d.fire.x - d.x) : 1; // hacia dónde mira (eje dominante)
    this.fy = 0;
    if (d.fire && Math.abs(d.fire.y - d.y) > Math.abs(d.fire.x - d.x)) { this.fx = 0; this.fy = Math.sign(d.fire.y - d.y); }
  }

  get alive() { return this.state !== 'dead'; }
  get scared() { return this.state === 'scared' || this.state === 'flee' || this.state === 'cower'; }

  inBan(x, y) { const b = this.ban; return !!b && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; }

  // Mueve con colisión (muebles, valla) y sin entrar al edificio.
  moveBy(game, dx, dy) {
    const ox = this.x, oy = this.y;
    moveAndSlide(game.map, this, dx, dy);
    if (this.inBan(this.x, this.y)) { this.x = ox; this.y = oy; }
  }

  sayOne(list, secs) {
    this.say = list[Math.floor(Math.random() * list.length)];
    this.sayT = secs;
    this.sayCd = secs + 3 + Math.random() * 2;
  }

  update(dt, game) {
    if (!this.alive) return;
    const p = game.player, d = Math.hypot(p.x - this.x, p.y - this.y);
    this.sayT = Math.max(0, this.sayT - dt);
    this.sayCd = Math.max(0, this.sayCd - dt);
    if (this.state === 'flee') {
      this.fleeT -= dt;
      this.shiver += dt * 50;
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      this.moveBy(game, Math.cos(a) * FLEE_SPEED * dt, Math.sin(a) * FLEE_SPEED * dt);
      this.fx = Math.cos(a) >= 0 ? 1 : -1; this.fy = 0;
      if (this.fleeT <= 0) this.state = 'cower';
      return;
    }
    const armed = !!p.weapon, bloody = p.bloodLevel >= 2;
    const scaredNow = (d < SCARE_DIST && (armed || bloody)) || (this.state === 'cower' && d < 200);
    if (scaredNow && this.state === 'idle') this.sayOne(bloody && !this.hurtOnce ? LINES.blood : LINES.armed, 2.4);
    this.state = scaredNow ? (this.hurtOnce ? 'cower' : 'scared') : 'idle';
    let tx = this.home.x, ty = this.home.y, speed = 30;
    if (scaredNow) {
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      tx = this.x + Math.cos(a) * 40; ty = this.y + Math.sin(a) * 40;
      tx = Math.max(this.home.x - ROAM, Math.min(this.home.x + ROAM, tx));
      ty = Math.max(this.home.y - ROAM, Math.min(this.home.y + ROAM, ty));
      speed = 70;
      this.shiver += dt * 40;
      if (this.sayCd <= 0 && this.sayT <= 0) this.sayOne(bloody ? LINES.blood : LINES.armed, 2.2);
      this.fx = p.x >= this.x ? 1 : -1; this.fy = 0;
    } else {
      if (this.mode === 'sit') { this.fx = p.x >= this.x ? 1 : -1; this.fy = 0; }
      if (d < TALK_DIST && this.sayCd <= 0 && this.sayT <= 0) this.sayOne(LINES[this.mode], 2.6);
    }
    const dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy);
    if (len > 2) { const st = Math.min(len, speed * dt); this.moveBy(game, (dx / len) * st, (dy / len) * st); }
  }

  // Daño al civil. Devuelve { killed, first } (first = primera vez que se le daña: para contar al civil herido una sola vez).
  hurt(game, dmg, angle) {
    if (!this.alive) return null;
    const first = !this.hurtOnce;
    this.hp -= dmg;
    this.hurtOnce = true;
    game.camera.addShake(3);
    game.sfx.play('hit', 0.8);
    if (this.hp <= 0) {
      this.state = 'dead';
      this.say = null; this.sayT = 0;
      game.bleed(this.x, this.y, angle, 1, 0.8);
      game.stainPlayer(0.8, angle);
      return { killed: true, first };
    }
    this.state = 'flee';
    this.fleeT = FLEE_TIME;
    this.sayOne(LINES.hurt, 1.8);
    game.bleed(this.x, this.y, angle, 0.4, 0.6);
    return { killed: false, first };
  }

  // Un golpe cuerpo a cuerpo del jugador (arco del arma) o una bala. Mismo criterio que con los enemigos.
  meleeHits(px, py, angle, def, inArc) { return this.alive && inArc(px, py, angle, def, this); }

  // --- Dibujo ------------------------------------------------------------------------------------
  draw(ctx, clock) {
    const L = this.look;
    const x = Math.round(this.x), y = Math.round(this.y);
    const sh = this.state === 'scared' || this.state === 'cower' || this.state === 'flee' ? Math.round(Math.sin(this.shiver)) : 0;
    const px = (ox, oy, w, h, col) => { ctx.fillStyle = col; pixelRect(ctx, x + (ox + sh) * WORLD_PX, y + oy * WORLD_PX, w, h); };
    const fem = L.gender === 'f';
    if (this.state === 'dead') { // tumbado y oscuro
      px(-7, -2, 15, 6, 'rgba(5,0,15,0.5)');
      px(-7, -3, 14, 6, '#14100a'); px(-6, -2, 12, 4, L.coat); px(-6, -2, 12, 4, 'rgba(0,0,0,0.45)');
      px(7, -2, 4, 4, '#14100a'); px(7, -1, 3, 2, L.skin); px(7, -1, 3, 2, 'rgba(0,0,0,0.4)');
      if (fem) px(7, 1, 4, 2, L.hair);
      return;
    }
    px(-6, 3, 13, 4, 'rgba(5,0,15,0.5)');                       // sombra
    const bw = fem ? 9 : 11;
    px(-(bw >> 1) - 1, -5, bw + 2, 9, '#14100a');                // contorno del abrigo
    px(-(bw >> 1), -4, bw, 7, L.coat); px(-(bw >> 1), -4, bw, 2, 'rgba(255,255,255,0.13)');
    if (L.item === 'blanket') px(-(bw >> 1), 1, bw, 3, '#3a5a6a');
    // brazos / manos: junto al fuego las manos se tienden hacia él
    if (this.mode === 'fire' && !this.scared) { px(this.fx * 5 + (this.fx ? 0 : -1), this.fy * 5 - 1, 2, 3, L.skin); px(this.fx * 5 + (this.fx ? 0 : 2), this.fy * 5 + 1, 2, 2, L.skin); }
    else px(this.fx >= 0 ? 6 : -8, -1, 2, 3, L.skin);
    if (L.item === 'bottle') px(this.fx >= 0 ? -8 : 7, 0, 2, 4, '#3a8a4a');
    // cabeza: pelo / gorro / capucha y la cara hacia donde mira
    px(-3, -8, 7, 6, '#14100a');
    const cap = L.hat;
    px(-2, -7, 5, 4, cap === 'hood' ? L.coat : fem ? L.hair : L.hair);
    if (fem) { px(-4, -7, 1, 7, L.hair); px(4, -7, 1, 7, L.hair); }          // melena a los lados
    if (cap === 'beanie') { px(-3, -8, 7, 2, '#a83a3a'); px(-3, -7, 7, 1, '#d85a5a'); }
    if (cap === 'cap') { px(-3, -8, 7, 2, '#2a3a6a'); }
    const faceX = this.fy ? -1 : this.fx > 0 ? 1 : -2, faceY = this.fy < 0 ? -9 : this.fy > 0 ? -5 : -6;
    if (!(this.fy < 0)) {
      px(faceX, faceY, this.fy ? 3 : 2, 2, L.skin);
      px(faceX, faceY, 1, 1, this.scared ? '#ffffff' : '#140a24');       // ojo (abierto de miedo)
      if (cap === 'cap') px(this.fy ? -1 : faceX + (this.fx > 0 ? 1 : -1), faceY - 1, this.fy ? 3 : 2, 1, '#1a2444'); // visera
      if (!fem && L.item !== 'blanket' && L.hat !== 'hood') px(faceX, faceY + 2, this.fy ? 3 : 2, 1, 'rgba(20,10,8,0.7)'); // barba
    }
    if (this.state === 'scared' || this.state === 'flee' || this.state === 'cower') { px(0, -13, 1, 3, '#05d9e8'); px(0, -9, 1, 1, '#05d9e8'); } // «!»
  }
}
