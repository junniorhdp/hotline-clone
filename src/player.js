import { moveAndSlide, lineOfSight, isSolidAt, castRay } from './map.js';
import { WEAPON_DEFS, Bullet, Pickup, inMeleeArc, drawWeaponShape } from './weapons.js';
import { COLORS, TAU } from './utils.js';
import { drawSprite, sprites, pixelRect, WORLD_PX } from './sprites.js';
import { DEFAULT_EFFECTS } from './masks.js';

const SPEED = 210;
const PICKUP_RADIUS = 30;
const THROW_SPEED = 720;
const NOISE_RADIUS_KICK = 260;
const FINISH_RANGE = 34;      // distancia (además del radio) para rematar; cubre el empuje del derribo
const STEP_INTERVAL = 0.3;
const KICK_COOLDOWN = 0.35;
const AIM_MAX_DIST = 360;    // largo máximo del indicador de apuntado (armas de alcance ilimitado)
const AIM_START = 18;        // el indicador empieza en la boca del arma
const AIM_DOT_SPACING = 10;

export class Player {
  // `perks` = efectos de la máscara elegida (ver maskEffects en masks.js).
  constructor(x, y, perks = DEFAULT_EFFECTS) {
    this.x = x;
    this.y = y;
    this.r = 10;
    this.angle = 0;
    this.perks = perks;
    // null = puños, o { type, ammo }
    const start = perks.startWeapon;
    this.weapon = start ? { type: start, ammo: WEAPON_DEFS[start].maxAmmo || 0 } : null;
    this.cooldown = 0;
    this.swing = 0;
    this.swingDur = 1;
    this.punchSide = 1;
    this.muzzle = 0;
    this.noAmmoFlash = 0;
    this.stepTimer = 0;
    this.bumpCd = 0;
    this.alive = true;
  }

  get def() {
    return WEAPON_DEFS[this.weapon ? this.weapon.type : 'fists'];
  }

  update(dt, game) {
    const { input, map } = game;
    let mx = 0, my = 0;
    if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
    // Teclado: dirección normalizada (velocidad completa). Joystick: analógico, la velocidad
    // es proporcional a cuánto se empuja.
    let mag = 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
    } else if (input.moveAxis.x || input.moveAxis.y) {
      mag = Math.min(1, Math.hypot(input.moveAxis.x, input.moveAxis.y));
      mx = input.moveAxis.x / (mag || 1);
      my = input.moveAxis.y / (mag || 1);
    }

    this.bumpCd = Math.max(0, this.bumpCd - dt);
    if (mx || my) {
      const speed = SPEED * this.perks.speedMul * mag;
      const hit = moveAndSlide(map, this, mx * speed * dt, my * speed * dt);
      if ((hit.hitX || hit.hitY) && this.bumpCd <= 0) {
        game.particles.dust(this.x + (hit.hitX ? Math.sign(mx) * this.r : 0), this.y + (hit.hitY ? Math.sign(my) * this.r : 0), 4);
        this.bumpCd = 0.35;
      }
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        game.sfx.play('step', 0.8);
        this.stepTimer = STEP_INTERVAL;
      }
    } else {
      this.stepTimer = 0.05;
    }

    if (input.touchMode) {
      // Táctil: mira con el joystick derecho; si no se usa, mira hacia donde camina.
      if (input.aimActive) this.angle = input.aimAngle;
      else if (mx || my) this.angle = Math.atan2(my, mx);
    } else {
      const m = game.mouseWorld();
      this.angle = Math.atan2(m.y - this.y, m.x - this.x);
    }

    this.cooldown -= dt;
    this.swing = Math.max(0, this.swing - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.noAmmoFlash = Math.max(0, this.noAmmoFlash - dt);

    // Melee y subfusil: se puede mantener pulsado. Pistola/escopeta: un clic, un disparo.
    // Joystick derecho mantenido: ataca con cualquier arma al ritmo de su cadencia; un toque
    // rápido en él o en el botón ATACAR (`tapAttack`) da un único ataque; ATACAR mantenido
    // (`attackHeld`) ataca de forma continua.
    const wantsAttack = input.aimFiring || input.tapAttack || input.attackHeld
      || (this.def.melee || this.def.auto ? input.mouse.left : input.mousePressed.left);
    if (wantsAttack && this.cooldown <= 0) {
      this.attack(game);
      input.tapAttack = false;
    }
    if (input.mousePressed.right) this.throwOrPickup(game);
    if (input.wasPressed('KeyE') && this.cooldown <= 0) this.kick(game);
  }

  startSwing(def) {
    this.swing = this.swingDur = def.swingTime || 0.14;
    this.punchSide *= -1;
  }

  attack(game) {
    const def = this.def;
    this.cooldown = def.cooldown;

    // 1) Remate: con cualquier arma, si hay un enemigo derribado a los pies.
    const downed = game.enemies.find((e) => e.alive && e.state === 'down'
      && Math.hypot(e.x - this.x, e.y - this.y) < FINISH_RANGE + e.r);
    if (downed) {
      this.startSwing(def);
      game.killEnemy(downed, Math.atan2(downed.y - this.y, downed.x - this.x), 'finisher');
      return;
    }

    // 2) Golpe cuerpo a cuerpo: los puños derriban, el bate mata.
    if (def.melee) {
      this.startSwing(def);
      game.sfx.play('swing');
      let hit = false;
      for (const e of game.enemies) {
        if (!e.alive || e.state === 'down') continue;
        if (inMeleeArc(this.x, this.y, this.angle, def, e) && lineOfSight(game.map, this.x, this.y, e.x, e.y)) {
          // Con la máscara OSO los puños también matan al instante.
          if (def.knockdown && !this.perks.meleeLethal) game.knockDown(e, this.angle, 'fists');
          else game.killEnemy(e, this.angle, 'melee');
          hit = true;
        }
      }
      // Si no hay a quién pegar pero hay una puerta delante, el golpe es una patada.
      if (!hit) game.kickDoor(this);
      game.camera.addShake(def.shake);
      return;
    }

    // 3) Disparo (pistola: 1 bala; escopeta: varios perdigones de alcance corto).
    if (this.weapon.ammo <= 0) {
      this.noAmmoFlash = 0.6;
      game.sfx.play('empty');
      return;
    }
    this.weapon.ammo--;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    let bx = this.x + cos * 14, by = this.y + sin * 14;
    if (isSolidAt(game.map, bx, by)) { bx = this.x; by = this.y; }
    for (let i = 0; i < def.pellets; i++) {
      const a = this.angle + (Math.random() - 0.5) * def.spread * this.perks.spreadMul * 2;
      const speed = def.bulletSpeed * this.perks.bulletSpeedMul * (def.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      game.bullets.push(new Bullet(bx, by, a, speed, 'player', def.range));
    }
    game.particles.sparks(this.x + cos * 22, this.y + sin * 22, this.angle, def.pellets > 1 ? 14 : 7, 0.45);
    game.particles.shell(this.x + cos * 6, this.y + sin * 6, this.angle + Math.PI / 2);
    game.sfx.play(def.sound);
    this.muzzle = 0.05;
    game.camera.addShake(def.shake);
    game.fx.kick(def.pellets > 1 ? 0.45 : 0.25);
    game.makeNoise(this.x, this.y, def.noise);
  }

  kick(game) {
    if (game.kickDoor(this)) {
      this.cooldown = KICK_COOLDOWN;
      game.makeNoise(this.x, this.y, NOISE_RADIUS_KICK);
    }
  }

  throwOrPickup(game) {
    if (this.weapon) {
      let px = this.x + Math.cos(this.angle) * 12;
      let py = this.y + Math.sin(this.angle) * 12;
      if (isSolidAt(game.map, px, py)) { px = this.x; py = this.y; }
      const p = new Pickup(this.weapon.type, px, py, this.weapon.ammo);
      p.angle = this.angle;
      p.throwAt(this.angle, THROW_SPEED);
      game.pickups.push(p);
      game.sfx.play('throw');
      this.weapon = null;
      this.cooldown = 0.15;
      return;
    }

    let best = null, bestDist = PICKUP_RADIUS;
    for (const p of game.pickups) {
      if (p.flying) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    if (best) {
      this.weapon = { type: best.type, ammo: best.ammo };
      best.alive = false;
      game.sfx.play('pickup');
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const def = this.def;

    if (this.weapon) {
      let swingOffset = 0;
      if (def.melee && this.swing > 0) {
        const t = 1 - this.swing / this.swingDur;
        swingOffset = (t - 0.5) * def.arc * this.punchSide;
      }
      ctx.save();
      ctx.rotate(swingOffset);
      drawSprite(ctx, 'fist', 10, 6);
      drawWeaponShape(ctx, this.weapon.type, 10, 6, 0, def.maxAmmo > 0 && this.weapon.ammo <= 0);
      if (this.muzzle > 0) drawSprite(ctx, 'muzzle', 10 + sprites()[this.weapon.type].width * 2, 6);
      ctx.restore();
    } else {
      // Puños: el que golpea se adelanta.
      const t = this.swing > 0 ? Math.sin((1 - this.swing / this.swingDur) * Math.PI) : 0;
      for (const side of [1, -1]) {
        const reach = side === this.punchSide ? t * 12 : 0;
        drawSprite(ctx, 'fist', 10 + reach, side * 8);
      }
    }

    drawSprite(ctx, 'player', 0, 0);
    ctx.restore();
  }

  // Indicador de apuntado (PC y móvil), en el mundo y en píxeles:
  // - armas de fuego: línea de puntos desde el arma hasta la primera pared, puerta o enemigo,
  //   limitada al alcance; la escopeta añade dos líneas tenues con su apertura; sin munición
  //   la línea se apaga;
  // - cuerpo a cuerpo: arco de puntos con el alcance y la amplitud del golpe.
  drawAim(ctx, game) {
    const def = this.def;
    ctx.save();
    ctx.fillStyle = COLORS.player;
    if (def.melee) {
      const r = def.range + 4;
      const steps = Math.max(5, Math.round((def.arc * r) / 5));
      ctx.globalAlpha = 0.75;
      for (let i = 0; i <= steps; i++) {
        const a = this.angle - def.arc / 2 + (def.arc * i) / steps;
        pixelRect(ctx, this.x + Math.cos(a) * r - 1, this.y + Math.sin(a) * r - 1);
      }
      ctx.restore();
      return;
    }

    const empty = this.weapon.ammo <= 0;
    const reach = Math.min(def.range, AIM_MAX_DIST);
    const lineLength = (angle, stopAtEnemies) => {
      let len = Math.min(castRay(game.map, this.x, this.y, angle, reach), reach);
      if (!stopAtEnemies) return len;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const dx = e.x - this.x, dy = e.y - this.y;
        const along = dx * cos + dy * sin;
        if (along > 0 && along < len && Math.abs(dy * cos - dx * sin) < e.r) len = along;
      }
      return len;
    };
    // size = lado del punto en píxeles internos.
    const dots = (angle, len, spacing, alpha, size) => {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let d = AIM_START; d < len; d += spacing) {
        ctx.globalAlpha = alpha * (1 - (d / len) * 0.4);
        pixelRect(ctx, this.x + cos * d - size, this.y + sin * d - size, size, size);
      }
    };

    if (empty) ctx.fillStyle = '#7d6f98';
    const len = lineLength(this.angle, true);
    dots(this.angle, len, AIM_DOT_SPACING, empty ? 0.45 : 0.95, 2);
    if (def.pellets > 1 && !empty) {
      const spread = def.spread * this.perks.spreadMul;
      for (const side of [-1, 1]) dots(this.angle + spread * side, lineLength(this.angle + spread * side, false), AIM_DOT_SPACING, 0.6, 1);
    }
    // Mira al final de la línea (donde impactaría): esquinas de un cuadrado de 9×9 píxeles con
    // contorno oscuro para que se lea sobre cualquier suelo.
    if (!empty) {
      const ex = this.x + Math.cos(this.angle) * len, ey = this.y + Math.sin(this.angle) * len;
      const part = (dx, dy, w, h) => pixelRect(ctx, ex + dx * WORLD_PX, ey + dy * WORLD_PX, w, h);
      const shapes = [
        [-4, -4, 3, 1], [-4, -4, 1, 3], [2, -4, 3, 1], [4, -4, 1, 3],
        [-4, 4, 3, 1], [-4, 2, 1, 3], [2, 4, 3, 1], [4, 2, 1, 3], [0, 0, 1, 1],
      ];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#140a24';
      for (const [dx, dy, w, h] of shapes) part(dx - 1, dy - 1, w + 2, h + 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.player;
      for (const [dx, dy, w, h] of shapes) part(dx, dy, w, h);
    }
    ctx.restore();
  }

  drawDebug(ctx) {
    const def = this.def;
    ctx.strokeStyle = COLORS.debug;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
    if (def.melee) {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.arc(this.x, this.y, def.range, this.angle - def.arc / 2, this.angle + def.arc / 2);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, PICKUP_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = COLORS.blood;
    ctx.beginPath();
    ctx.arc(this.x, this.y, FINISH_RANGE + this.r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
