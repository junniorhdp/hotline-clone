import { moveAndSlide, lineOfSight } from './map.js';
import { pixelRect, WORLD_PX } from './sprites.js';

// Vagabundos de la calle (civiles). Cada uno tiene su aspecto (`look`: género, abrigo, pelo, piel, gorro, objeto) y un modo:
//   'fire' = calentándose junto a una fogata en un tambor (mira al fuego) · 'sit' = sentado solo junto a un contenedor.
// Estados:
//   idle    tranquilo · scared  te acercas armado o manchado de sangre: tiembla y se aparta
//   flee    le han hecho daño: huye despavorido · cower  tras huir, se queda acobardado
//   agony   envenenado por un arma oxidada: cae al suelo y agoniza hasta morir (sangre verde)
//   mourn   ha visto morir a otro civil: pánico profundo, corre junto al cuerpo y se acurruca llorando
//   happy   le has dado una moneda: feliz y agradecido (con corazón) · dead
// No son enemigos: no entran en game.enemies ni puntúan; dañarlos o matarlos va al karma invisible (ver newKarma en street.js) y provoca la culpa (vómito), pero no puntúa ni penaliza.

const SCARE_DIST = 150, TALK_DIST = 90, ROAM = 30, MAX_HP = 3, FLEE_TIME = 5, FLEE_SPEED = 150, HAPPY_TIME = 7, MOURN_SPEED = 55, MOURN_GAP = 24;

const LINES = {
  fire: ['QUÉ FRÍO HACE...', 'ACÉRCATE AL FUEGO.', 'NOCHE LARGA...', 'ESTE TAMBOR ES MI CASA.'],
  sit: ['NOCHE TRANQUILA...', '¿TIENES UNA MONEDA?', 'CUIDADO CON LA ALCANTARILLA...', 'LA MÁQUINA DE LA ACERA FUNCIONA.'],
  armed: ['¡NO QUIERO PROBLEMAS!', '¡GUARDA ESO, POR FAVOR!', '¡YO NO HE VISTO NADA!'],
  blood: ['¡ESO ES SANGRE!', '¡ESTÁS CUBIERTO DE SANGRE!', '¡NO ME HAGAS DAÑO!'],
  hurt: ['¡AAAH!', '¡AUXILIO!', '¡NO, POR FAVOR!', '¡SOCORRO!'],
  mourn: ['¡NO, NO, NO...!', 'SNIF... SNIF...', '¿POR QUÉ LO HICISTE?', 'ESTABA VIVO... ESTABA VIVO...', 'DIOS MÍO...'],
  // Ruido que viene del edificio sin ver al jugador (disparos, golpes): alerta indirecta.
  alert: ['¿ESCUCHASTE ESO?', 'VIENE DE ADENTRO...', '¿DISPAROS?', 'ALGO PASA AHÍ DENTRO...', 'MEJOR NO ASOMARSE...'],
  happy: ['¡GRACIAS, GRACIAS!', '¡DIOS TE BENDIGA!', '¡QUÉ BUENA PERSONA!', 'ESTO ME SALVA LA NOCHE.'],
};

export class Vagrant {
  constructor(d, ban, street = null) {
    this.x = d.x; this.y = d.y;
    this.home = { x: d.x, y: d.y };
    this.look = d.look;
    this.mode = d.mode;
    this.fire = d.fire;
    this.ban = ban;
    this.street = street;           // StreetLife: se le avisa cuando muere (civilianDied)
    this.r = 6;
    this.hp = MAX_HP;
    this.state = 'idle';
    this.hurtOnce = false;
    this.toxic = false;             // lo han herido con un arma oxidada: su sangre es verde
    this.gifted = false;            // ya ha recibido su moneda
    this.fleeT = 0;
    this.poison = 0; this.agonyAngle = 0; this.tickT = 0;
    this.happyT = 0;
    this.seesPlayer = true;         // ¿ve ahora mismo al jugador? (en la calle sí; dentro del edificio solo con línea de visión)
    this.alertT = 0;                // s con el «?» de alerta indirecta
    this.mournAt = null;            // dónde está el cuerpo del que ha visto morir
    this.say = null; this.sayT = 0; this.sayCd = 1 + Math.random() * 2;
    this.shiver = Math.random() * 6;
    this.fx = d.fire ? Math.sign(d.fire.x - d.x) : 1; // hacia dónde mira (eje dominante)
    this.fy = 0;
    if (d.fire && Math.abs(d.fire.y - d.y) > Math.abs(d.fire.x - d.x)) { this.fx = 0; this.fy = Math.sign(d.fire.y - d.y); }
  }

  get alive() { return this.state !== 'dead'; }
  get scared() { return this.state === 'scared' || this.state === 'flee' || this.state === 'cower' || this.state === 'mourn'; }
  // ¿Se le puede dar una moneda ahora? (una sola vez, y no si está herido, de duelo o muerto)
  get canGift() { return !this.gifted && (this.state === 'idle' || this.state === 'scared'); }

  inBan(x, y) { const b = this.ban; return !!b && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; }

  // Mueve con colisión (muebles, valla) y sin entrar al edificio.
  moveBy(game, dx, dy) {
    const ox = this.x, oy = this.y;
    moveAndSlide(game.map, this, dx, dy);
    if (this.inBan(this.x, this.y)) { this.x = ox; this.y = oy; }
  }

  sayOne(list, secs) {
    if (this.mute) return; // calle muda (la pila de cuerpos del piso 5, ver lore.js)
    this.say = list[Math.floor(Math.random() * list.length)];
    this.sayT = secs;
    this.sayCd = secs + 3 + Math.random() * 2;
  }

  // Han matado a otro civil cerca: pánico profundo. Corre junto al cuerpo y se acurruca llorando (si no está huyendo aún: entonces, al acabar).
  mourn(x, y) {
    if (!this.alive || this.state === 'agony') return;
    this.mournAt = { x, y };
    this.mournedOnce = true;
    if (this.state !== 'flee') { this.state = 'mourn'; this.sayT = 0; this.sayCd = 0.3; }
  }

  update(dt, game) {
    if (!this.alive) return;
    const p = game.player, d = Math.hypot(p.x - this.x, p.y - this.y);
    this.sayT = Math.max(0, this.sayT - dt);
    this.sayCd = Math.max(0, this.sayCd - dt);
    this.alertT = Math.max(0, this.alertT - dt);
    // Visión: el jugador dentro del edificio (huella entre muros) solo se ve con línea de visión directa (puertas abiertas; las paredes y las puertas cerradas la cortan).
    this.seesPlayer = !this.inBan(p.x, p.y) || (d < 280 && lineOfSight(game.map, p.x, p.y, this.x, this.y));
    if (this.state === 'agony') {            // envenenado: agoniza en el suelo y suelta gotas verdes
      this.poison -= dt;
      this.shiver += dt * 30;
      this.tickT -= dt;
      if (this.tickT <= 0) { this.tickT = 0.4; game.particles.blood(this.x, this.y, Math.random() * 6.28, 2, 3, true); }
      if (this.poison <= 0) this.die(game, this.agonyAngle);
      return;
    }
    if (this.state === 'flee') {
      this.fleeT -= dt;
      this.shiver += dt * 50;
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      this.moveBy(game, Math.cos(a) * FLEE_SPEED * dt, Math.sin(a) * FLEE_SPEED * dt);
      this.fx = Math.cos(a) >= 0 ? 1 : -1; this.fy = 0;
      if (this.fleeT <= 0) this.state = this.mournAt ? 'mourn' : 'cower';
      return;
    }
    if (this.state === 'mourn') { this.updateMourn(dt, game); return; }
    if (this.state === 'happy') {            // agradecido: se queda en su sitio, mira al jugador y no se asusta
      this.happyT -= dt;
      this.fx = p.x >= this.x ? 1 : -1; this.fy = 0;
      if (this.sayCd <= 0 && this.sayT <= 0 && d < 140) this.sayOne(LINES.happy, 2.6);
      if (this.happyT <= 0) this.state = 'idle';
      return;
    }
    const armed = !!p.weapon, bloody = p.bloodLevel >= 2;
    const sees = this.seesPlayer;   // sin verlo no reaccionan a su arma ni a su sangre, ni le hablan
    const scaredNow = sees && ((d < SCARE_DIST && (armed || bloody)) || (this.state === 'cower' && d < 200));
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
      if (sees && d < TALK_DIST && this.sayCd <= 0 && this.sayT <= 0) this.sayOne(LINES[this.mode], 2.6);
    }
    const dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy);
    if (len > 2) { const st = Math.min(len, speed * dt); this.moveBy(game, (dx / len) * st, (dy / len) * st); }
  }

  // Duelo: va hasta el cuerpo y, junto a él, se queda acurrucado temblando y llorando (frases entrecortadas y lágrimas).
  updateMourn(dt, game) {
    const b = this.mournAt;
    const dx = b.x - this.x, dy = b.y - this.y, len = Math.hypot(dx, dy);
    this.shiver += dt * 36;
    this.crouch = len <= MOURN_GAP + 6;
    if (len > MOURN_GAP) { const st = Math.min(len - MOURN_GAP, MOURN_SPEED * dt); this.moveBy(game, (dx / len) * st, (dy / len) * st); }
    this.fx = dx >= 0 ? 1 : -1; this.fy = 0;
    if (this.sayCd <= 0 && this.sayT <= 0) {
      this.sayOne(LINES.mourn, 2.8);
      game.playAt('sob', this.x, this.y, 0.7);
    }
  }

  // Ruido dentro del edificio (disparo, golpe fuerte) que le llega al civil de la calle SIN ver al jugador: no sabe qué pasa, solo que
  // viene de adentro. Mira hacia el edificio, se pone en alerta (aparece un «?») y suelta una frase de alerta indirecta.
  hearNoise(nx, ny, radius) {
    if (!this.alive || this.seesPlayer || this.sayCd > 0 || this.sayT > 0) return;
    if (this.state !== 'idle' && this.state !== 'scared' && this.state !== 'cower' && this.state !== 'happy') return;
    if (Math.hypot(this.x - nx, this.y - ny) > Math.max(radius * 1.2, 320)) return;
    this.sayOne(LINES.alert, 2.6);
    this.alertT = 3;
    this.fx = nx >= this.x ? 1 : -1; this.fy = 0;
  }

  // Daño al civil. Devuelve { killed, first } (first = primera vez que se le daña: para contar al civil herido una sola vez).
  hurt(game, dmg, angle, tox = false) {
    if (!this.alive || this.state === 'agony') return null;
    const first = !this.hurtOnce;
    this.hp -= dmg;
    this.hurtOnce = true;
    if (tox) this.toxic = true;
    game.camera.addShake(3);
    game.sfx.play('hit', 0.8);
    if (this.hp <= 0) { this.die(game, angle); return { killed: true, first }; }
    this.state = 'flee';
    this.fleeT = FLEE_TIME;
    this.sayOne(LINES.hurt, 1.8);
    game.bleed(this.x, this.y, angle, 0.4, 0.6, tox);
    return { killed: false, first };
  }

  // Golpe de un arma oxidada (con veneno): cae al suelo intoxicado y agoniza `time` s hasta morir (no hay forma de salvarlo).
  poisonHit(game, angle, time = 3.6) {
    if (!this.alive || this.state === 'agony') return null;
    const first = !this.hurtOnce;
    this.hurtOnce = true;
    this.toxic = true;
    this.state = 'agony';
    this.poison = time;
    this.agonyAngle = angle;
    this.tickT = 0;
    this.mournAt = null;
    this.sayOne(LINES.hurt, 1.8);
    game.camera.addShake(3);
    game.sfx.play('hit', 0.8);
    if (game.goreOn) game.particles.blood(this.x, this.y, angle, 8, 0.8, true);
    return { killed: false, poisoned: true, first };
  }

  // Muere: sangre (verde si estaba intoxicado), cuerpo tumbado y el resto de civiles se enteran.
  die(game, angle) {
    this.state = 'dead';
    this.say = null; this.sayT = 0;
    game.bleed(this.x, this.y, angle, 1, 0.8, this.toxic);
    if (Math.hypot(game.player.x - this.x, game.player.y - this.y) < 90) game.stainPlayer(0.8, angle, this.toxic);
    if (this.street) this.street.civilianDied(this);
  }

  // Le dan una moneda: feliz y agradecido unos segundos.
  gift() {
    if (!this.canGift) return false;
    this.gifted = true;
    this.state = 'happy';
    this.happyT = HAPPY_TIME;
    this.sayOne(LINES.happy, 3);
    return true;
  }

  // Un golpe cuerpo a cuerpo del jugador (arco del arma) o una bala. Mismo criterio que con los enemigos.
  meleeHits(px, py, angle, def, inArc) { return this.alive && inArc(px, py, angle, def, this); }

  // --- Dibujo ------------------------------------------------------------------------------------
  draw(ctx, clock) {
    const L = this.look;
    const x = Math.round(this.x), y = Math.round(this.y);
    const st = this.state;
    const sh = st === 'scared' || st === 'cower' || st === 'flee' || st === 'mourn' ? Math.round(Math.sin(this.shiver)) : 0;
    const px = (ox, oy, w, h, col) => { ctx.fillStyle = col; pixelRect(ctx, x + (ox + sh) * WORLD_PX, y + oy * WORLD_PX, w, h); };
    const fem = L.gender === 'f';
    if (st === 'dead' || st === 'agony') {        // tumbado y oscuro (el que agoniza se retuerce y gotea veneno)
      const tw = st === 'agony' ? Math.round(Math.sin(this.shiver) * 1) : 0;
      px(-7, -2 + tw, 15, 6, 'rgba(5,0,15,0.5)');
      px(-7, -3 + tw, 14, 6, '#14100a'); px(-6, -2 + tw, 12, 4, L.coat); px(-6, -2 + tw, 12, 4, st === 'dead' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.2)');
      px(7, -2 + tw, 4, 4, '#14100a'); px(7, -1 + tw, 3, 2, L.skin); px(7, -1 + tw, 3, 2, st === 'dead' ? 'rgba(0,0,0,0.4)' : 'rgba(122,208,58,0.35)');
      if (fem) px(7, 1 + tw, 4, 2, L.hair);
      if (st === 'agony') { px(-6, -3 + tw, 12, 6, 'rgba(122,208,58,0.22)'); px(2, -4 + tw - (Math.floor(clock * 5) % 3), 1, 1, '#9be32a'); px(-3, -4 + tw - (Math.floor(clock * 4 + 1) % 3), 1, 1, '#c6ee55'); }
      return;
    }
    const oy = this.crouch && st === 'mourn' ? 3 : 0;   // acurrucado: más bajo y encogido
    const o = (v) => v + oy;
    px(-6, 3, 13, 4, 'rgba(5,0,15,0.5)');                       // sombra
    const bw = fem ? 9 : 11;
    px(-(bw >> 1) - 1, o(-5), bw + 2, 9 - oy, '#14100a');        // contorno del abrigo
    px(-(bw >> 1), o(-4), bw, 7 - oy, L.coat); px(-(bw >> 1), o(-4), bw, 2, 'rgba(255,255,255,0.13)');
    if (L.item === 'blanket') px(-(bw >> 1), o(1), bw, Math.max(1, 3 - oy), '#3a5a6a');
    // brazos / manos: junto al fuego las manos se tienden hacia él; de duelo se cubren la cara
    if (st === 'mourn') { px(-5, o(-8), 2, 4, L.skin); px(4, o(-8), 2, 4, L.skin); }
    else if (this.mode === 'fire' && !this.scared) { px(this.fx * 5 + (this.fx ? 0 : -1), this.fy * 5 - 1, 2, 3, L.skin); px(this.fx * 5 + (this.fx ? 0 : 2), this.fy * 5 + 1, 2, 2, L.skin); }
    else px(this.fx >= 0 ? 6 : -8, -1, 2, 3, L.skin);
    if (L.item === 'bottle' && st !== 'mourn') px(this.fx >= 0 ? -8 : 7, 0, 2, 4, '#3a8a4a');
    // cabeza: pelo / gorro / capucha y la cara hacia donde mira
    px(-3, o(-8), 7, 6, '#14100a');
    const cap = L.hat;
    px(-2, o(-7), 5, 4, cap === 'hood' ? L.coat : L.hair);
    if (fem) { px(-4, o(-7), 1, 7 - oy, L.hair); px(4, o(-7), 1, 7 - oy, L.hair); }          // melena a los lados
    if (cap === 'beanie') { px(-3, o(-8), 7, 2, '#a83a3a'); px(-3, o(-7), 7, 1, '#d85a5a'); }
    if (cap === 'cap') { px(-3, o(-8), 7, 2, '#2a3a6a'); }
    const faceX = this.fy ? -1 : this.fx > 0 ? 1 : -2, faceY = o(this.fy < 0 ? -9 : this.fy > 0 ? -5 : -6);
    if (!(this.fy < 0)) {
      px(faceX, faceY, this.fy ? 3 : 2, 2, L.skin);
      px(faceX, faceY, 1, 1, this.scared || st === 'mourn' ? '#ffffff' : '#140a24');       // ojo (abierto de miedo)
      if (cap === 'cap') px(this.fy ? -1 : faceX + (this.fx > 0 ? 1 : -1), faceY - 1, this.fy ? 3 : 2, 1, '#1a2444'); // visera
      if (!fem && L.item !== 'blanket' && L.hat !== 'hood') px(faceX, faceY + 2, this.fy ? 3 : 2, 1, 'rgba(20,10,8,0.7)'); // barba
      if (st === 'happy') px(faceX, faceY + 1, this.fy ? 3 : 2, 1, '#8a2a2a'); // sonrisa
    }
    if (this.alertT > 0 && st === 'idle') { px(-1, -14, 3, 1, '#ffbe0b'); px(1, -13, 1, 2, '#ffbe0b'); px(0, -11, 2, 1, '#ffbe0b'); px(0, -9, 1, 1, '#ffbe0b'); } // «?» de alerta
    if (st === 'mourn') {            // lágrimas que caen
      for (let k = 0; k < 2; k++) { const ph = (clock * 2.2 + k * 0.5) % 1; px(faceX + (k ? 1 : 0), faceY + 2 + Math.round(ph * 7), 1, 1, ph < 0.7 ? '#7ad7ff' : '#3a7aa8'); }
    } else if (st === 'scared' || st === 'flee' || st === 'cower') { px(0, -13, 1, 3, '#05d9e8'); px(0, -9, 1, 1, '#05d9e8'); } // «!»
    else if (st === 'happy') {       // corazón que sube y baja
      const hy = -14 - Math.round(Math.sin(clock * 5) * 1);
      px(-3, hy, 2, 1, '#ff4fa3'); px(1, hy, 2, 1, '#ff4fa3'); px(-3, hy + 1, 6, 1, '#ff4fa3'); px(-2, hy + 2, 4, 1, '#ff4fa3'); px(-1, hy + 3, 2, 1, '#ff4fa3');
      px(-3, hy, 1, 1, '#ffb0d8');
    }
  }
}
