import { rectHitsWall, isSolidAt } from './map.js';
import { COLORS, TAU, angleDiff } from './utils.js';
import { drawSprite, pixelDisc, pixelRect, WORLD_PX } from './sprites.js';

// `knockdown: true` = derriba en vez de matar (luego hay que rematar).
export const WEAPON_DEFS = {
  fists: { name: 'PUÑOS', melee: true, knockdown: true, range: 24, arc: Math.PI * 0.55, cooldown: 0.32, swingTime: 0.12, shake: 1.5 },
  bat: { name: 'BATE', melee: true, knockdown: false, range: 40, arc: Math.PI * 0.85, cooldown: 0.42, swingTime: 0.18, shake: 3 },
  gun: { name: 'PISTOLA', melee: false, cooldown: 0.2, maxAmmo: 6, bulletSpeed: 1000, pellets: 1, spread: 0.02, range: Infinity, shake: 4, sound: 'shot', noise: 520 },
  // Escopeta: varios perdigones con dispersión y alcance corto.
  shotgun: { name: 'ESCOPETA', melee: false, cooldown: 0.65, maxAmmo: 4, bulletSpeed: 900, pellets: 6, spread: 0.3, range: 270, shake: 7, sound: 'shotgun', noise: 620 },
  // Cuchillo (máscara TIBURÓN): melee letal, rápido y de corto alcance.
  knife: { name: 'CUCHILLO', melee: true, knockdown: false, range: 30, arc: Math.PI * 0.6, cooldown: 0.25, swingTime: 0.1, shake: 2 },
  // Tubo de hierro: letal como el bate pero más rápido y con algo menos de alcance.
  pipe: { name: 'TUBO', melee: true, knockdown: false, range: 36, arc: Math.PI * 0.75, cooldown: 0.3, swingTime: 0.13, shake: 2.5 },
  // Tubo oxidado (solo se encuentra en los contenedores de la calle): no mata de golpe, NOQUEA e INTOXICA (`poison`): el enemigo
  // cae, no se levanta y muere solo a los ~3,6 s (o lo rematas antes), con sangre verde tóxica (ver Game.poisonEnemy). Contra el jefe pega como un tubo.
  rustpipe: { name: 'TUBO OXIDADO', melee: true, knockdown: false, poison: true, range: 36, arc: Math.PI * 0.75, cooldown: 0.34, swingTime: 0.13, shake: 2.5 },
  // Cuchillo oxidado (contenedores): corto y MUY rápido; igual que el tubo oxidado noquea e intoxica, pero el veneno es más corto (2,2 s).
  rustknife: { name: 'CUCHILLO OXIDADO', melee: true, knockdown: false, poison: true, poisonTime: 2.2, range: 28, arc: Math.PI * 0.6, cooldown: 0.22, swingTime: 0.1, shake: 2 },
  // Palanca (contenedores): pesada y sin veneno; derriba siempre (no mata) con un arco amplio y deja al enemigo aturdido un 60 % más de tiempo
  // (más ventana para rematar o huir). Lenta de recuperar.
  crowbar: { name: 'PALANCA', melee: true, knockdown: true, downMul: 1.6, range: 38, arc: Math.PI * 0.9, cooldown: 0.46, swingTime: 0.17, shake: 4 },
  // Cuchillo de carnicero: EXCLUSIVO de la máscara BLADE (tiburón), que empieza cada piso con él; no está en el reparto de armas ni en los contenedores.
  // Ventajas sobre el cuchillo normal: más alcance (38 contra 30), arco más amplio, golpe más pesado y una EJECUCIÓN mucho más rápida (2 hachazos en 0,44 s
  // contra 3 puñaladas en 0,7 s); contra el jefe quita más vida. Los enemigos no lo recogen.
  cleaver: { name: 'CUCHILLO DE CARNICERO', melee: true, knockdown: false, range: 38, arc: Math.PI * 0.8, cooldown: 0.27, swingTime: 0.12, shake: 3.5 },
  // Subfusil: automático (`auto`: dispara mientras se mantiene el clic), poco preciso.
  smg: { name: 'SUBFUSIL', melee: false, auto: true, cooldown: 0.075, maxAmmo: 30, bulletSpeed: 950, pellets: 1, spread: 0.12, range: Infinity, shake: 1.6, sound: 'smg', noise: 560 },
};

// Armas de los enemigos. El wind-up (mira láser) es la ventana para cubrirse tras una esquina;
// después disparan `burst` balas separadas `burstInterval` s y esperan `cooldown`.
export const ENEMY_WEAPONS = {
  gun: { range: 320, windup: 0.38, cooldown: 0.7, bulletSpeed: 650, spread: 0.05, burst: 1, burstInterval: 0, dropAmmo: 4, sound: 'enemyShot' },
  smg: { range: 280, windup: 0.45, cooldown: 0.95, bulletSpeed: 600, spread: 0.13, burst: 4, burstInterval: 0.09, dropAmmo: 12, sound: 'smg' },
  // Escopeta del guardia pesado: cinco perdigones en abanico (`fan`), alcance corto y mucho aviso.
  shotgun: { range: 250, windup: 0.55, cooldown: 1.2, bulletSpeed: 640, spread: 0.06, burst: 1, burstInterval: 0, dropAmmo: 2, sound: 'shotgun', pellets: 5, fan: 0.3, bulletRange: 270 },
};

// Categorías de armamento (matriz de combate, ver Game.enemyStrike): `unarmed` (puños), `blunt` (bate, tubo),
// `blade` (cuchillo) y `gun` (pistola, escopeta, subfusil). `null`/undefined = puños.
const CATEGORY = { bat: 'blunt', pipe: 'blunt', rustpipe: 'blunt', crowbar: 'blunt', rustknife: 'blade', cleaver: 'blade', knife: 'blade', gun: 'gun', shotgun: 'gun', smg: 'gun' };
export function weaponCategory(type) {
  return CATEGORY[type] || 'unarmed';
}

// Armas cuerpo a cuerpo que pueden llevar los enemigos: alcance extra sobre el hueco normal (`reach`) y tiempo
// de preparación del golpe (`windup`, la ventana para esquivar o adelantarse). El bate llega más lejos y tarda más.
export const ENEMY_MELEE = {
  bat: { reach: 22, windup: 0.28 },
  pipe: { reach: 19, windup: 0.22 },
  knife: { reach: 12, windup: 0.16 },
};

const THROW_DECEL = 900;      // px/s² de frenado del arma lanzada
const HURT_THROW_SPEED = 160; // por encima de esto, el arma lanzada derriba

// ¿El objetivo está dentro del arco de un ataque cuerpo a cuerpo?
export function inMeleeArc(ax, ay, angle, def, target) {
  const dx = target.x - ax, dy = target.y - ay;
  const d = Math.hypot(dx, dy);
  if (d > def.range + target.r) return false;
  if (d < target.r + 6) return true;
  return Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= def.arc / 2;
}

export function segmentPointDistance(x0, y0, x1, y1, px, py) {
  const vx = x1 - x0, vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((px - x0) * vx + (py - y0) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x0 + vx * t - px, y0 + vy * t - py);
}

// Dibuja un arma en coordenadas locales; (x, y) es la empuñadura y apunta hacia +X.
// Píxel del sprite que hace de empuñadura (el resto del arma se extiende hacia +X).
const GRIP = { bat: [1, 1], gun: [1, 2], shotgun: [3, 1], knife: [1, 1], pipe: [1, 1], rustpipe: [1, 1], rustknife: [1, 1], crowbar: [1, 1], cleaver: [1, 1], smg: [1, 1] };

export function drawWeaponShape(ctx, type, x, y, angle, dim = false, scale = WORLD_PX) {
  const [ox, oy] = GRIP[type];
  drawSprite(ctx, type, x, y, angle, { ox, oy, alpha: dim ? 0.45 : 1, scale });
}

// Arma en el suelo o volando tras ser lanzada.
export class Pickup {
  constructor(type, x, y, ammo = WEAPON_DEFS[type].maxAmmo || 0) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.r = 6;
    this.ammo = ammo;
    this.vx = 0;
    this.vy = 0;
    this.angle = Math.random() * TAU;
    this.spin = 0;
    this.flying = false;
    this.alive = true;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get hurts() {
    return this.flying && this.speed > HURT_THROW_SPEED;
  }

  throwAt(angle, speed) {
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.spin = 20;
    this.flying = true;
  }

  bounce() {
    this.vx *= -0.3;
    this.vy *= -0.3;
  }

  // Devuelve true si ha rebotado con fuerza contra una pared (para polvo/sonido).
  update(dt, map) {
    if (!this.flying) return false;
    const sp = this.speed;
    const steps = Math.max(1, Math.ceil((sp * dt) / 4));
    const sdt = dt / steps;
    let bounced = false;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx * sdt;
      if (rectHitsWall(map, nx, this.y, this.r, this.r)) { bounced = true; this.vx *= -0.35; } else this.x = nx;
      const ny = this.y + this.vy * sdt;
      if (rectHitsWall(map, this.x, ny, this.r, this.r)) { bounced = true; this.vy *= -0.35; } else this.y = ny;
    }
    this.angle += this.spin * dt;
    const cur = this.speed;
    const next = Math.max(0, cur - THROW_DECEL * dt);
    if (next < 25) {
      this.flying = false;
      this.vx = this.vy = 0;
    } else {
      this.vx *= next / cur;
      this.vy *= next / cur;
      this.spin *= next / cur;
    }
    return bounced && sp > 150;
  }

  draw(ctx, time) {
    if (!this.flying) {
      // Halo pixelado pulsante para que se vea que se puede recoger.
      ctx.save();
      ctx.globalAlpha = 0.16 + Math.sin(time * 5) * 0.08;
      ctx.fillStyle = COLORS.weapon;
      pixelDisc(ctx, this.x / WORLD_PX, this.y / WORLD_PX, 6, WORLD_PX);
      ctx.restore();
    }
    const empty = WEAPON_DEFS[this.type].maxAmmo > 0 && this.ammo <= 0;
    drawWeaponShape(ctx, this.type, this.x - Math.cos(this.angle) * 8, this.y - Math.sin(this.angle) * 8, this.angle, empty);
  }
}

export class Bullet {
  // owner: 'player' (daña enemigos) o 'enemy' (daña al jugador)
  constructor(x, y, angle, speed, owner = 'player', range = Infinity) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.owner = owner;
    this.range = range;      // px recorridos antes de desaparecer (perdigones)
    this.traveled = 0;
    this.alive = true;
    this.hitWall = false;
    this.r = 2;
  }

  update(dt, map) {
    this.px = this.x;
    this.py = this.y;
    this.traveled += Math.hypot(this.vx, this.vy) * dt;
    if (this.traveled > this.range) { this.alive = false; return; }
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 4));
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      if (isSolidAt(map, this.x, this.y)) {
        // Retrocede un paso para que las chispas salgan del lado visible de la pared.
        this.x -= (this.vx * dt) / steps;
        this.y -= (this.vy * dt) / steps;
        this.alive = false;
        this.hitWall = true;
        return;
      }
    }
  }

  draw(ctx) {
    // Proyectil de 2×2 píxeles con estela de píxeles que se desvanece.
    const color = this.owner === 'enemy' ? COLORS.enemyBullet : COLORS.bullet;
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.25 * (4 - i);
      pixelRect(ctx, this.x - this.vx * 0.006 * i, this.y - this.vy * 0.006 * i);
    }
    ctx.globalAlpha = 1;
    pixelRect(ctx, this.x - WORLD_PX, this.y - WORLD_PX, 2, 2);
    ctx.restore();
  }
}

// Armas improvisadas que se encuentran en los contenedores de la calle (reparto con pesos). Todas son cuerpo a cuerpo y exclusivas del exterior.
export const STREET_LOOT = [['rustpipe', 4], ['rustknife', 3], ['crowbar', 3]];
