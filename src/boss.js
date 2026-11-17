import { Enemy } from './enemy.js';
import { moveAndSlide, lineOfSight, thickLineClear, castRay } from './map.js';
import { ENEMY_WEAPONS } from './weapons.js';
import { COLORS, angleDiff, clamp, closestOnSegment } from './utils.js';
import { drawText } from './pixelfont.js';
import { drawSprite, pixelRect, pixelDisc, WORLD_PX } from './sprites.js';

// EL EJECUTOR: jefe del último piso. Un matón hiper-acorazado que se queda quieto hasta oírte o verte y
// entonces encadena tres ataques con aviso (la ventana para esquivar o cubrirse):
//   EMBESTIDA  se agacha (línea roja en el suelo) y carga recto a gran velocidad. Mata si te alcanza, pero si
//              choca contra una pared o un mueble queda ATURDIDO (derribado y rematable). Las puertas las
//              revienta sin pararse: úsalas como cebo, no como refugio.
//   TAJO       a corta distancia: un barrido con los puños, mortal en un arco corto.
//   DESCARGA   escopeta de cinco perdigones con mira láser (solo si te ve: tras una esquina se cancela).
// La coraza cubre el frente (±70°): las balas normales rebotan y el cuerpo a cuerpo de frente no hace nada.
// Se le hiere por la espalda y los costados, y sobre todo con el arma que cambies a tiempo:
//   escopeta (de cerca hiere incluso de frente), bate/tubo/cuchillo por detrás, pistola/subfusil por detrás.
// Un arma lanzada, un portazo o un choque de su embestida lo derriban 2,4-2,6 s: entonces se le remata y la
// ejecución es lo que más daño hace. Tras levantarse es inmune a nuevos derribos 2,5 s (sin aturdimiento
// encadenado). Con menos del 60 % y del 30 % de vida acelera y encadena ataques.
export const BOSS_HP = 12;
const FRONT_ARC = Math.PI - 1.22;   // un golpe cuya dirección difiere más que esto del frente del jefe viene de frente
const STUN_CRASH = 2.4;
const STUN_THROWN = 2.6;
const STUN_IMMUNE = 2.5;
const CHARGE_SPEED = 430;
const CHARGE_TIME = 1.7;   // lo bastante largo para cruzar la arena entera: la embestida acaba en choque
const APPROACH = [78, 100, 124];     // velocidad al acercarse por fase
const WIND_CHARGE = [0.78, 0.62, 0.5];
const COOL = [1.0, 0.7, 0.45];
const BULLET_DMG = { gun: 1.5, smg: 0.6, shotgun: 0.9 };
const MELEE_DMG = { bat: 3, pipe: 2.5, rustpipe: 2.5, crowbar: 3, rustknife: 2, cleaver: 3.5, knife: 2 };
// Daño de la ejecución según cómo se remate (el último golpe; los previos hieren por `onWound`).
const EXEC_DMG = { stomp: 3, smash: 3, bat: 4.5, pipe: 3.5, rustpipe: 3.5, crowbar: 4, rustknife: 3.5, cleaver: 4.5, knife: 3.5, shoot: 3.5, blast: 4.5, burst: 3 };
const WOUND_DMG = 0.8;

export class Boss extends Enemy {
  constructor(x, y) {
    super(x, y, [{ x, y }], null, 'boss');
    this.r = 14;
    this.hp = BOSS_HP;
    this.maxHp = BOSS_HP;
    this.awake = false;
    this.mode = 'idle';      // idle | cool | windCharge | charge | windSlash | windVolley | recover | stunned
    this.modeT = 0;
    this.windTotal = 1;
    this.dir = 0;            // rumbo bloqueado de la embestida
    this.volleys = 0;
    this.flash = 0;          // destello al recibir daño (s)
    this.stunImmune = 0;
    this.stunTime = STUN_CRASH;
    this.gunDef = ENEMY_WEAPONS.shotgun; // para game.enemyShoot en la descarga
    this.corpseSprite = 'bossCorpse';
    this.corpseScale = 1.5;
    this.name = 'EL EJECUTOR';
  }

  get phase() {
    const f = this.hp / this.maxHp;
    return f > 0.6 ? 0 : f > 0.3 ? 1 : 2;
  }

  // Oye un ruido: despierta (el jefe no investiga, directamente viene a por ti).
  hear() {
    this.awake = true;
  }

  wake(game) {
    if (this.awake && this.mode !== 'idle') return;
    this.awake = true;
    this.mode = 'cool';
    this.modeT = 0.9;
    this.state = 'chase';
    game.playAt('alert', this.x, this.y);
    game.showCallout('¡EL EJECUTOR!', COLORS.blood, 2.4, 'JEFE DEL PISO');
    game.camera.addShake(8);
  }

  // --- Daño ---------------------------------------------------------------------------------------

  // ¿Viene el golpe (con dirección `angle`) de frente? Derribado, la coraza no cuenta.
  fromFront(angle) {
    return this.state !== 'down' && Math.abs(angleDiff(angle, this.angle)) > FRONT_ARC;
  }

  // Lo llama Game.killEnemy antes de matar. Devuelve true si el golpe lo mata (sigue el flujo normal); false si
  // solo lo hiere o rebota (el golpe se absorbe aquí).
  guardKill(cause, angle, game, src) {
    if (!this.awake) this.wake(game); // un disparo lo despierta aunque no te viera
    const front = this.fromFront(angle);
    const p = game.player;
    let dmg = 0;
    if (cause === 'execution') dmg = EXEC_DMG[p.exec ? p.exec.style : 'stomp'] ?? 3;
    else if (cause === 'bullet') {
      const t = (src && src.src) || 'gun';
      dmg = BULLET_DMG[t] ?? 1;
      if (front) dmg = t === 'shotgun' ? 0.3 : 0;
    } else if (cause === 'melee' || cause === 'fists') {
      const t = p.weapon && p.weapon.type;
      dmg = front ? 0 : (t ? MELEE_DMG[t] ?? 2 : 1.5);
    } else dmg = 1;
    if (dmg <= 0) { this.deflect(angle, game, cause); return false; }
    this.hp -= dmg;
    this.flash = 0.18;
    if (this.hp <= 0) return true;
    this.hurtFx(angle, game, cause === 'execution');
    if (cause === 'execution') this.timer = Math.max(this.timer, 1.4); // el remate no lo deja levantarse en el acto
    return false;
  }

  // Lo llama Game.knockDown. true = procede el derribo normal (aturdimiento); false = lo absorbe.
  guardKnock(cause, angle, game) {
    if (!this.awake) this.wake(game);
    if (this.state === 'down' || this.stunImmune > 0) { this.deflect(angle, game, cause); return false; }
    if (cause === 'fists') {
      // Los puños no lo derriban: por la espalda hacen cosquillas y de frente nada.
      if (this.fromFront(angle)) this.deflect(angle, game, cause);
      else { this.hp -= 0.5; this.flash = 0.12; this.hurtFx(angle, game, false); }
      return false;
    }
    this.stunTime = cause === 'thrown' ? STUN_THROWN : STUN_CRASH;
    return true;
  }

  // Golpe intermedio de una ejecución (cuchillo, tubo, ráfaga).
  onWound(style, game) {
    this.hp -= WOUND_DMG;
    this.flash = 0.12;
    if (this.hp <= 0.2) this.hp = 0.2; // el golpe de gracia lo da el último golpe de la ejecución
  }

  deflect(angle, game, cause) {
    const back = angle + Math.PI;
    game.particles.sparks(this.x + Math.cos(back) * this.r, this.y + Math.sin(back) * this.r, back, 8, 0.8);
    game.camera.addShake(cause === 'bullet' ? 1.5 : 4);
    game.playAt('ricochet', this.x, this.y);
    if (cause === 'melee' || cause === 'fists') game.player.cooldown = Math.max(game.player.cooldown, 0.3); // el golpe rebota: el jugador se resiente
  }

  hurtFx(angle, game, heavy) {
    if (game.goreOn) {
      game.particles.blood(this.x, this.y, angle, heavy ? 14 : 5, 0.8);
      if (heavy) game.splatBlood(this.x, this.y, angle, 0.8, 0.8);
    } else {
      game.particles.neon(this.x, this.y, angle, heavy ? 14 : 6, 0.9);
    }
    game.particles.sparks(this.x, this.y, angle + Math.PI, 5, 0.9);
    game.camera.addShake(heavy ? 10 : 4);
    game.hitstop = Math.max(game.hitstop, heavy ? 0.06 : 0.03);
    game.playAt('hit', this.x, this.y);
  }

  // Derribado (por un arma lanzada, un portazo o un choque): queda aturdido `stunTime` s.
  knockDown(angle, map) {
    super.knockDown(angle, map);
    this.timer = this.stunTime;
    this.mode = 'stunned';
    this.volleys = 0;
  }

  // --- IA -----------------------------------------------------------------------------------------

  update(dt, game) {
    const p = game.player, map = game.map;
    this.flash = Math.max(0, this.flash - dt);
    this.stunImmune = Math.max(0, this.stunImmune - dt);

    if (this.state === 'down') {
      if (this.executing) return; // el temblor del golpe que viene: el aturdimiento se congela
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'chase';
        this.mode = 'cool';
        this.modeT = 0.5;
        this.stunImmune = STUN_IMMUNE;
        game.playAt('alert', this.x, this.y);
        game.camera.addShake(5);
      }
      return;
    }

    const d = Math.hypot(p.x - this.x, p.y - this.y);
    this.sees = p.alive && this.canSee(p, map);
    if (!this.awake) {
      this.angle += Math.sin(game.time * 1.3) * dt * 0.7; // vigila despacio, de brazos cruzados
      if (this.sees || (p.alive && d < 150 && lineOfSight(map, this.x, this.y, p.x, p.y))) this.wake(game);
      return;
    }
    if (!p.alive) { this.mode = 'cool'; return; }

    this.modeT -= dt;
    const ph = this.phase;
    switch (this.mode) {
      case 'cool':
        this.approach(dt, game, d);
        if (this.modeT <= 0) this.pickAttack(game, d);
        break;
      case 'windCharge':
        // Sigue al jugador hasta el último 30 % del aviso: ese rumbo queda bloqueado (la ventana para esquivar).
        if (this.modeT > this.windTotal * 0.3) this.turnTowards(Math.atan2(p.y - this.y, p.x - this.x), 8, dt);
        if (this.modeT <= 0) { this.mode = 'charge'; this.modeT = CHARGE_TIME; this.dir = this.angle; game.playAt('knock', this.x, this.y); }
        break;
      case 'charge':
        this.doCharge(dt, game);
        break;
      case 'windSlash':
        this.turnTowards(Math.atan2(p.y - this.y, p.x - this.x), 12, dt);
        if (this.modeT <= 0) this.slash(game);
        break;
      case 'windVolley':
        if (this.modeT > this.windTotal * 0.3 || this.volleys > 0) this.turnTowards(Math.atan2(p.y - this.y, p.x - this.x), 9, dt);
        if (!this.sees && this.volleys === 0) { this.mode = 'cool'; this.modeT = 0.4; break; } // te perdió de vista: se cancela
        if (this.modeT <= 0) {
          game.enemyShoot(this);
          this.volleys--;
          if (this.volleys > 0) { this.modeT = 0.4; this.windTotal = 0.4; } else { this.mode = 'recover'; this.modeT = 0.35; }
        }
        break;
      case 'recover':
        if (this.modeT <= 0) { this.mode = 'cool'; this.modeT = COOL[ph]; }
        break;
      default:
        this.mode = 'cool';
        this.modeT = 0.5;
    }
  }

  approach(dt, game, d) {
    const p = game.player;
    if (d > 60) this.goTo(p.x, p.y, APPROACH[this.phase], dt, game.map);
    else this.turnTowards(Math.atan2(p.y - this.y, p.x - this.x), 8, dt);
  }

  pickAttack(game, d) {
    const p = game.player, map = game.map, ph = this.phase;
    const los = lineOfSight(map, this.x, this.y, p.x, p.y);
    if (d < 52) {
      this.mode = 'windSlash'; this.windTotal = this.modeT = 0.34 - ph * 0.04;
      game.playAt('aim', this.x, this.y);
      return;
    }
    const clear = los && thickLineClear(map, this.x, this.y, p.x, p.y, this.r);
    const roll = Math.random();
    if (clear && d > 110 && roll < 0.55 + ph * 0.15) {
      this.mode = 'windCharge'; this.windTotal = this.modeT = WIND_CHARGE[ph];
      game.playAt('alert', this.x, this.y);
      return;
    }
    if (los && d < 300) {
      this.mode = 'windVolley'; this.windTotal = this.modeT = 0.7 - ph * 0.1;
      this.volleys = ph === 2 ? 2 : 1;
      game.playAt('aim', this.x, this.y);
      return;
    }
    this.mode = 'cool'; this.modeT = 0.35; // no hay ataque posible: sigue acercándose
  }

  doCharge(dt, game) {
    const p = game.player, ph = this.phase;
    const sp = CHARGE_SPEED * (1 + 0.1 * ph);
    this.angle = this.dir;
    const cos = Math.cos(this.dir), sin = Math.sin(this.dir);
    const hit = moveAndSlide(game.map, this, cos * sp * dt, sin * sp * dt);
    if (Math.random() < 0.6) game.particles.dust(this.x - cos * 12, this.y - sin * 12, 1);
    if (p.alive && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 2) { game.killPlayer(this.dir); return; }
    // Las puertas se revientan sin pararle (si no están bloqueadas): úsalas de cebo, no de refugio.
    for (const door of game.doors) {
      const c = closestOnSegment(this.x, this.y, door.hx, door.hy, door.ex, door.ey);
      if (Math.hypot(this.x - c.x, this.y - c.y) > this.r + 3) continue;
      if (door.locked || door.closing) { this.crash(game); return; }
      door.kick(this.x - cos * 12, this.y - sin * 12);
      game.particles.splinters(c.x, c.y, this.dir, 8);
      game.camera.addShake(5);
    }
    if (hit.hitX || hit.hitY) { this.crash(game); return; }
    if (this.modeT <= 0) { this.mode = 'recover'; this.modeT = 0.7; } // se pasa de largo: queda expuesto un momento
  }

  // Choque contra una pared o un mueble: queda aturdido y a tu merced.
  crash(game) {
    this.stunTime = STUN_CRASH;
    this.knockDown(this.dir + Math.PI, game.map);
    game.particles.dust(this.x, this.y, 14);
    game.particles.sparks(this.x + Math.cos(this.dir) * this.r, this.y + Math.sin(this.dir) * this.r, this.dir + Math.PI, 10, 1);
    game.camera.addShake(16);
    game.fx.kick(0.8);
    game.hitstop = Math.max(game.hitstop, 0.08);
    game.playAt('knock', this.x, this.y);
    game.playAt('hit', this.x, this.y);
  }

  slash(game) {
    const p = game.player;
    this.mode = 'recover';
    this.modeT = 0.5;
    game.camera.addShake(3);
    game.playAt('knock', this.x, this.y);
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (p.alive && d < this.r + p.r + 30 && Math.abs(angleDiff(Math.atan2(p.y - this.y, p.x - this.x), this.angle)) < 1.1) {
      game.killPlayer(Math.atan2(p.y - this.y, p.x - this.x));
    }
  }

  // --- Dibujo -------------------------------------------------------------------------------------

  draw(ctx, time, game) {
    if (this.state === 'down') { this.drawDown(ctx, time); return; }
    // Avisos en el suelo: la línea de la embestida y la mira de la escopeta.
    if (this.mode === 'windCharge' || this.mode === 'windVolley') this.drawTelegraph(ctx, time, game);
    const winding = this.mode === 'windCharge' || this.mode === 'windSlash' || this.mode === 'windVolley';
    const sh = winding ? (Math.floor(time * 40) % 2 ? WORLD_PX : -WORLD_PX) : 0;
    const hot = this.flash > 0;
    const c = {
      out: '#0a0a0f', body: hot ? '#ffffff' : '#2b2b3a', plate: hot ? '#ffffff' : '#4a4a63',
      light: hot ? '#ffffff' : '#8a8aa8', visor: winding && Math.floor(time * 16) % 2 ? '#ffffff' : '#ff2e55',
    };
    ctx.save();
    ctx.translate(this.x + sh, this.y);
    ctx.rotate(this.angle);
    // Puños grandes por delante (el tajo los lleva adelante).
    const lunge = this.mode === 'windSlash' ? -6 : this.mode === 'recover' && this.modeT > 0.3 ? 8 : 0;
    drawSprite(ctx, 'fist', 16 + lunge, 11, 0, { scale: WORLD_PX * 1.4 });
    drawSprite(ctx, 'fist', 16 + lunge, -11, 0, { scale: WORLD_PX * 1.4 });
    const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    rect(-14, -14, 26, 28, c.out);          // torso con contorno
    rect(-12, -12, 22, 24, c.body);
    rect(-12, -12, 22, 4, c.plate);         // placas laterales
    rect(-12, 8, 22, 4, c.plate);
    rect(-6, -20, 16, 8, c.out);            // hombreras
    rect(-4, -18, 12, 5, c.light);
    rect(-6, 12, 16, 8, c.out);
    rect(-4, 13, 12, 5, c.light);
    rect(-12, -4, 4, 8, this.mode === 'windCharge' || this.mode === 'charge' ? '#ff2e55' : c.plate); // respiradero trasero
    ctx.fillStyle = c.out;
    pixelDisc(ctx, 2, 0, 8, WORLD_PX);       // casco
    ctx.fillStyle = c.plate;
    pixelDisc(ctx, 2, 0, 6, WORLD_PX);
    rect(6, -5, 6, 10, c.out);               // visor
    rect(8, -4, 3, 8, c.visor);
    ctx.restore();
    const icon = this.mode === 'windCharge' ? '!!' : this.mode === 'windVolley' ? '!' : '';
    if (icon) this.drawIcon(ctx, time, icon);
  }

  drawIcon(ctx, time, icon) {
    const bob = Math.round(Math.sin(time * 14)) * WORLD_PX;
    drawText(ctx, icon, this.x, this.y - this.r - 24 + bob, { color: COLORS.blood, scale: WORLD_PX, align: 'center' });
  }

  // Línea de embestida (roja, punteada, cada vez más densa) o mira de la escopeta.
  drawTelegraph(ctx, time, game) {
    const t = 1 - this.modeT / this.windTotal;
    const ang = this.angle;
    const reach = this.mode === 'windCharge' ? 520 : this.gunDef.range + 40;
    const len = castRay(game.map, this.x, this.y, ang, reach);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    ctx.save();
    ctx.fillStyle = this.mode === 'windCharge' ? '#ff2e55' : COLORS.laser;
    ctx.globalAlpha = 0.35 + t * 0.65;
    const gap = t > 0.6 ? 3 : 7;
    for (let dd = 20; dd < len; dd += gap) {
      const w = this.mode === 'windCharge' ? 2 : 1;
      pixelRect(ctx, this.x + cos * dd - w, this.y + sin * dd - w, w, w);
    }
    ctx.restore();
  }

  drawDown(ctx, time) {
    const shake = this.executing ? (Math.floor(time * 40) % 2 ? WORLD_PX : -WORLD_PX) : 0;
    drawSprite(ctx, 'bossCorpse', this.x + shake, this.y, this.angle, { scale: WORLD_PX * 1.5 });
    ctx.save();
    ctx.fillStyle = COLORS.spark;
    for (let i = 0; i < 4; i++) {
      const a = time * 6 + (i * Math.PI) / 2;
      pixelRect(ctx, this.x + Math.cos(a) * 14, this.y - 20 + Math.sin(a) * 4);
    }
    ctx.restore();
  }

  drawDebug(ctx, game) {
    super.drawDebug(ctx, game);
    drawText(ctx, `${this.mode.toUpperCase()} HP ${this.hp.toFixed(1)}`, this.x, this.y - 30, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
  }
}

// Barra de vida del jefe (HUD): arriba al centro mientras pelea. Se dibuja en píxeles de escena.
export function drawBossBar(ctx, boss, w, top) {
  const barW = Math.min(140, w - 40), x = Math.round(w / 2 - barW / 2);
  const f = clamp(boss.hp / boss.maxHp, 0, 1);
  drawText(ctx, boss.name, w / 2, top, { color: COLORS.blood, align: 'center' });
  ctx.fillStyle = '#140a24';
  ctx.fillRect(x - 1, top + 10, barW + 2, 7);
  ctx.fillStyle = '#3a1a3a';
  ctx.fillRect(x, top + 11, barW, 5);
  ctx.fillStyle = boss.flash > 0 ? '#ffffff' : f < 0.3 ? '#ff2e55' : f < 0.6 ? '#ff7a3a' : COLORS.blood;
  ctx.fillRect(x, top + 11, Math.round(barW * f), 5);
  // Marcas de fase (60 % y 30 %)
  ctx.fillStyle = '#140a24';
  for (const m of [0.3, 0.6]) ctx.fillRect(x + Math.round(barW * m), top + 11, 1, 5);
  if (boss.stunImmune <= 0 && boss.state === 'down') {
    drawText(ctx, 'ATURDIDO · REMÁTALO', w / 2, top + 19, { color: COLORS.text, align: 'center' });
  }
}

