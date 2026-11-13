import { moveAndSlide, lineOfSight, thickLineClear, castRay, findPath, tileKey } from './map.js';
import { ENEMY_WEAPONS, drawWeaponShape } from './weapons.js';
import { COLORS, TAU, angleDiff, clamp } from './utils.js';
import { drawSprite, pixelRect, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';

export const VIEW_DIST = 340;
export const FOV = Math.PI * 0.6;
const CLOSE_SENSE = 36;      // a esta distancia te detectan aunque estés a su espalda
const PATROL_SPEED = 70;
const INVESTIGATE_SPEED = 120;
const CHASE_SPEED = 172;
const REACTION_TIME = 0.3;   // pausa entre verte y empezar a perseguir
const ATTACK_REACH = 14;     // hueco entre cuerpos para poder golpear
const WINDUP = 0.22;         // preparación del puñetazo (ventana para esquivar)
const ATTACK_COOLDOWN = 0.4;
const SEARCH_TIME = 2.5;
const DOWN_TIME = 3.2;       // segundos noqueado antes de levantarse
const KNOCKBACK = 14;
const ARRIVE_DIST = 6;
const REPATH_TIME = 0.4;
// Puertas: al toparse con una, el enemigo se para un instante antes de empujarla (despacio, ver
// ENEMY_PUSH_SPEED en doors.js) en vez de abrirla de golpe como si tuviera superfuerza.
const DOOR_PAUSE = 0.45;        // patrullando / investigando
const DOOR_PAUSE_CHASE = 0.25;  // persiguiendo
const DOOR_PUSH_WINDOW = 1.2;   // s durante los que puede empujar tras la pausa

export class Enemy {
  // weapon: null (cuerpo a cuerpo) o { type: 'gun', ammo } para el enemigo armado
  constructor(x, y, patrol, weapon = null) {
    this.x = x;
    this.y = y;
    this.r = 10;
    this.patrol = patrol;
    this.weapon = weapon;
    this.armed = !!weapon;  // el sprite con chaleco se mantiene aunque suelte el arma
    this.gunDef = weapon ? ENEMY_WEAPONS[weapon.type] : null;
    this.burstLeft = 0;     // balas que quedan de la ráfaga en curso
    this.burstTimer = 0;
    this.doorWait = 0;      // pausa ante una puerta (s)
    this.doorPushTime = 0;  // ventana en la que ya puede empujarla (s)
    this.wp = 0;
    this.wait = 0.5;
    this.state = 'patrol'; // patrol | alert | chase | investigate | search | down
    this.alive = true;
    this.target = null;    // última posición conocida del jugador / del ruido
    this.timer = 0;
    this.sees = false;
    this.windup = 0;       // preparación del golpe cuerpo a cuerpo
    this.aim = 0;          // preparación del disparo (enemigo armado)
    this.attackCd = 0;
    this.path = null;
    this.pathKey = -1;
    this.repath = 0;
    const first = patrol[0];
    this.angle = Math.atan2(first.y - y, first.x - x) || 0;
  }

  get standing() {
    return this.alive && this.state !== 'down';
  }

  canSee(p, map) {
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > VIEW_DIST) return false;
    if (d > CLOSE_SENSE && Math.abs(angleDiff(Math.atan2(dy, dx), this.angle)) > FOV / 2) return false;
    return lineOfSight(map, this.x, this.y, p.x, p.y);
  }

  hear(x, y) {
    if (this.state === 'chase' || this.state === 'alert' || this.state === 'down') return;
    this.target = { x, y };
    this.state = 'investigate';
    this.path = null;
  }

  // Derribado: suelta el arma (lo gestiona Game) y queda en el suelo un rato.
  knockDown(angle, map) {
    this.state = 'down';
    this.timer = DOWN_TIME;
    this.windup = this.aim = this.burstLeft = 0;
    this.doorWait = this.doorPushTime = 0;
    this.path = null;
    this.angle = angle;
    moveAndSlide(map, this, Math.cos(angle) * KNOCKBACK, Math.sin(angle) * KNOCKBACK);
  }

  update(dt, game) {
    if (this.state === 'down') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'alert';
        this.timer = REACTION_TIME;
        this.target = { x: game.player.x, y: game.player.y };
      }
      return;
    }

    const p = game.player;
    this.sees = p.alive && this.canSee(p, game.map);
    if (this.sees) {
      this.target = { x: p.x, y: p.y };
      if (this.state !== 'alert' && this.state !== 'chase') {
        this.state = 'alert';
        this.timer = REACTION_TIME;
        game.playAt('alert', this.x, this.y);
      }
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.doorWait > 0) {
      this.doorWait -= dt;
      if (this.doorWait <= 0) this.doorPushTime = DOOR_PUSH_WINDOW;
    } else {
      this.doorPushTime = Math.max(0, this.doorPushTime - dt);
    }

    switch (this.state) {
      case 'patrol': this.updatePatrol(dt, game.map); break;
      case 'alert':
        this.turnTowards(Math.atan2(this.target.y - this.y, this.target.x - this.x), 14, dt);
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      case 'chase': this.updateChase(dt, game); break;
      case 'investigate':
        if (this.goTo(this.target.x, this.target.y, INVESTIGATE_SPEED, dt, game.map)) this.startSearch();
        break;
      case 'search':
        this.angle += 2.2 * dt;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'patrol'; this.path = null; }
        break;
    }
  }

  startSearch() {
    this.state = 'search';
    this.timer = SEARCH_TIME;
    this.windup = this.aim = this.burstLeft = 0;
  }

  updatePatrol(dt, map) {
    if (this.wait > 0) {
      this.wait -= dt;
      this.angle += Math.sin(this.wait * 5) * dt * 1.5;
      return;
    }
    const wp = this.patrol[this.wp];
    if (this.goTo(wp.x, wp.y, PATROL_SPEED, dt, map)) {
      this.wp = (this.wp + 1) % this.patrol.length;
      this.wait = 1;
    }
  }

  updateChase(dt, game) {
    const p = game.player;
    // Sin jugador vivo o sin última posición conocida (no debería ocurrir): a buscar.
    if (!p.alive || !this.target) { this.startSearch(); return; }

    // Si te pierde de vista, el wind-up se cancela: por eso cubrirse tras una esquina funciona.
    if (!this.sees) {
      // Una ráfaga cortada a medias deja un pequeño respiro antes de volver a apuntar.
      if (this.burstLeft > 0) this.attackCd = this.gunDef.cooldown * 0.5;
      this.windup = this.aim = this.burstLeft = 0;
      if (this.goTo(this.target.x, this.target.y, CHASE_SPEED, dt, game.map)) this.startSearch();
      return;
    }

    const angleToPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    const d = Math.hypot(p.x - this.x, p.y - this.y);

    if (this.weapon) {
      const def = this.gunDef;
      // Ráfaga en curso (subfusil): sigue disparando mientras te vea, girando despacio.
      if (this.burstLeft > 0) {
        this.turnTowards(angleToPlayer, 5, dt);
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          game.enemyShoot(this);
          this.burstLeft--;
          this.burstTimer = def.burstInterval;
          if (this.burstLeft === 0) this.attackCd = def.cooldown;
        }
        return;
      }
      if (d < def.range) {
        this.turnTowards(angleToPlayer, 9, dt);
        if (this.attackCd <= 0) {
          if (this.aim === 0) game.playAt('aim', this.x, this.y);
          this.aim += dt;
          if (this.aim >= def.windup) {
            this.aim = 0;
            this.burstLeft = def.burst;
            this.burstTimer = 0;
          }
        }
        return;
      }
      this.aim = 0;
      this.goTo(p.x, p.y, CHASE_SPEED, dt, game.map);
      return;
    }

    if (d < this.r + p.r + ATTACK_REACH) {
      this.turnTowards(angleToPlayer, 16, dt);
      if (this.attackCd <= 0) {
        this.windup += dt;
        if (this.windup >= WINDUP) {
          this.windup = 0;
          this.attackCd = ATTACK_COOLDOWN;
          game.killPlayer(angleToPlayer);
        }
      }
      return;
    }
    this.windup = 0;
    this.goTo(p.x, p.y, CHASE_SPEED, dt, game.map);
  }

  // Va hacia (tx, ty): en línea recta si el cuerpo cabe, si no siguiendo una ruta BFS.
  // Devuelve true al llegar.
  goTo(tx, ty, speed, dt, map) {
    if (Math.hypot(tx - this.x, ty - this.y) < ARRIVE_DIST) return true;
    let nx = tx, ny = ty;
    if (thickLineClear(map, this.x, this.y, tx, ty, this.r)) {
      this.path = null;
    } else {
      const key = tileKey(map, tx, ty);
      this.repath -= dt;
      if (!this.path || key !== this.pathKey || this.repath <= 0) {
        this.path = findPath(map, this.x, this.y, tx, ty);
        this.pathKey = key;
        this.repath = REPATH_TIME;
      }
      const path = this.path;
      if (path) {
        while (path.length && Math.hypot(path[0].x - this.x, path[0].y - this.y) < ARRIVE_DIST) path.shift();
        while (path.length > 1 && thickLineClear(map, this.x, this.y, path[1].x, path[1].y, this.r)) path.shift();
        if (path.length) { nx = path[0].x; ny = path[0].y; }
      }
    }
    this.moveToward(nx, ny, speed, dt, map);
    return false;
  }

  // Llamado por la puerta al tocarla: ¿puede empujarla ya? Si no, empieza la pausa.
  doorContact() {
    if (this.doorPushTime > 0) return true;
    if (this.doorWait <= 0) this.doorWait = this.state === 'chase' ? DOOR_PAUSE_CHASE : DOOR_PAUSE;
    return false;
  }

  moveToward(tx, ty, speed, dt, map) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    // Parado ante una puerta: solo se gira hacia donde va.
    if (this.doorWait > 0) {
      if (d > 0.001) this.turnTowards(Math.atan2(dy, dx), 7, dt);
      return;
    }
    if (d < 0.001) return;
    const step = Math.min(speed * dt, d);
    this.turnTowards(Math.atan2(dy, dx), this.state === 'chase' ? 12 : 7, dt);
    moveAndSlide(map, this, (dx / d) * step, (dy / d) * step);
  }

  turnTowards(target, rate, dt) {
    this.angle += clamp(angleDiff(target, this.angle), -rate * dt, rate * dt);
  }

  draw(ctx, time, game) {
    if (this.state === 'down') { this.drawDown(ctx, time); return; }

    // Mira láser durante el wind-up del disparo: avisa de que va a disparar.
    if (this.aim > 0) {
      // Línea de puntos pixelada que se va llenando: avisa de que va a disparar.
      const t = this.aim / this.gunDef.windup;
      const len = castRay(game.map, this.x, this.y, this.angle, this.gunDef.range + 80);
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      ctx.save();
      ctx.fillStyle = COLORS.laser;
      ctx.globalAlpha = 0.35 + t * 0.65;
      const gap = t > 0.7 ? 4 : 8;
      for (let d = 16; d < len; d += gap) pixelRect(ctx, this.x + cos * d, this.y + sin * d);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.save();
    ctx.rotate(this.angle);
    // Puños; durante la preparación del golpe el brazo se echa hacia atrás.
    const wind = this.windup / WINDUP;
    if (this.weapon) {
      drawSprite(ctx, 'fist', 10, 6);
      drawWeaponShape(ctx, this.weapon.type, 10, 6, 0);
    } else {
      drawSprite(ctx, 'fist', 10 - wind * 8, 8);
      drawSprite(ctx, 'fist', 10, -8);
    }
    drawSprite(ctx, this.armed ? 'enemyArmed' : 'enemy', 0, 0);
    ctx.restore();

    const icon = this.state === 'alert' || this.state === 'chase' ? '!'
      : this.state === 'investigate' || this.state === 'search' ? '?' : '';
    if (icon) {
      const bob = Math.round(Math.sin(time * 10)) * WORLD_PX;
      drawText(ctx, icon, 0, -this.r - 22 + bob, { color: icon === '!' ? COLORS.blood : COLORS.enemy, scale: WORLD_PX, align: 'center' });
    }
    ctx.restore();
  }

  // Tumbado boca arriba con "estrellitas" pixeladas girando: se puede rematar.
  drawDown(ctx, time) {
    drawSprite(ctx, 'enemyDown', this.x, this.y, this.angle);
    ctx.save();
    ctx.fillStyle = COLORS.spark;
    for (let i = 0; i < 3; i++) {
      const a = time * 6 + (i * TAU) / 3;
      pixelRect(ctx, this.x + Math.cos(a) * 9, this.y - 16 + Math.sin(a) * 3);
    }
    ctx.restore();
  }

  drawDebug(ctx, game) {
    ctx.lineWidth = 2;
    if (this.state === 'down') {
      ctx.strokeStyle = COLORS.debug;
      ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (this.timer / DOWN_TIME));
      ctx.stroke();
      drawText(ctx, `DOWN ${this.timer.toFixed(1)}`, this.x, this.y + this.r + 4, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
      return;
    }

    const map = game.map;
    // Cono de visión recortado por paredes y puertas.
    const rays = 28;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    for (let i = 0; i <= rays; i++) {
      const a = this.angle - FOV / 2 + (FOV * i) / rays;
      const d = castRay(map, this.x, this.y, a, VIEW_DIST);
      ctx.lineTo(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fillStyle = this.sees ? 'rgba(217, 4, 41, 0.18)' : 'rgba(255, 190, 11, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 190, 11, 0.5)';
    ctx.stroke();

    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, CLOSE_SENSE, 0, TAU);
    ctx.stroke();
    if (this.weapon) {
      ctx.strokeStyle = 'rgba(217, 4, 41, 0.35)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.gunDef.range, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Línea de visión hacia el jugador.
    const p = game.player;
    if (p.alive && Math.hypot(p.x - this.x, p.y - this.y) < VIEW_DIST) {
      ctx.strokeStyle = this.sees ? COLORS.debug : 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    if (this.path && this.path.length) {
      ctx.strokeStyle = COLORS.weapon;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      for (const n of this.path) ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 190, 11, 0.6)';
    for (const w of this.patrol) {
      ctx.beginPath();
      ctx.moveTo(w.x - 3, w.y - 3); ctx.lineTo(w.x + 3, w.y + 3);
      ctx.moveTo(w.x + 3, w.y - 3); ctx.lineTo(w.x - 3, w.y + 3);
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.debug;
    ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
    const extra = this.aim > 0 ? ` AIM ${this.aim.toFixed(2)}` : this.windup > 0 ? ` WINDUP ${this.windup.toFixed(2)}` : '';
    drawText(ctx, this.state + (this.weapon ? ' [GUN]' : '') + extra, this.x, this.y + this.r + 4, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
  }
}
