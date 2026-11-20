import { isSolidAt } from './map.js';
import { COLORS, TAU, rand } from './utils.js';
import { pixelRect, drawSprite } from './sprites.js';

const MAX_PARTICLES = 900;
const MAX_SHELLS = 150;
const NEON = [COLORS.player, COLORS.wall, COLORS.door, COLORS.neonLight];
export const GIB_COLORS = [COLORS.flesh, COLORS.gore, COLORS.bone]; // carne · coágulo · hueso
// Sangre TÓXICA (verde óxido): la de las bajas del tubo oxidado y demás armas con veneno. Misma estructura que la roja.
export const TOXIC = { blood: '#7fb81e', mid: '#5f8f18', dark: '#3d5c12', wet: '#c6ee55' };
export const RED = { blood: COLORS.blood, mid: COLORS.bloodMid, dark: COLORS.bloodDark, wet: COLORS.bloodWet };
// Vómito del jugador (culpa): amarillo verdoso apagado.
export const VOMIT = { blood: '#a8b43a', mid: '#8a9630', dark: '#5e6a22', wet: '#d4de6a' };
// Paleta de un valor `tox` (true = tóxica, un objeto = esa paleta, falsy = roja).
export const palOf = (t) => (t === true ? TOXIC : t || RED);
export const TOXIC_GIBS = ['#6f9a1a', '#3d5c12', '#b9d77a'];
const TOXIC_NEON = ['#9be32a', '#c6ee55', '#5f8f18', '#e7ff9a'];

// Partículas efímeras (chispas, polvo, sangre, restos, chispas de neón) + casquillos que se
// quedan en el suelo. Las gotas y los restos, al caer, se hornean en la capa de sangre.
export class Particles {
  constructor() {
    this.list = [];
    this.shells = [];
  }

  clear() {
    this.list.length = 0;
    this.shells.length = 0;
  }

  add(p) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  sparks(x, y, angle, count = 8, spread = 0.6) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread, spread);
      const s = rand(180, 520);
      const life = rand(0.08, 0.22);
      this.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life });
    }
  }

  dust(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand(15, 70);
      const life = rand(0.35, 0.75);
      this.add({ type: 'dust', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(2, 4) });
    }
  }

  // Humo suave que sube despacio (cigarrillos): gotas de polvo gris de vida larga que casi no se desplazan por los lados.
  smoke(x, y) {
    const life = rand(0.9, 1.5);
    this.add({ type: 'dust', x, y, vx: rand(-8, 8), vy: -rand(10, 24), life, max: life, size: rand(2, 3) });
  }

  // Llamarada de una explosión (final del piso 10): bocanada naranja que sube y se apaga rápido.
  fire(x, y) {
    const life = rand(0.5, 1.2), cols = ['#ffd166', '#ff9a1a', '#ff5a1a', '#c1272d'];
    this.add({ type: 'dust', color: cols[Math.floor(Math.random() * cols.length)], x, y, vx: rand(-46, 46), vy: -rand(14, 60), life, max: life, size: rand(2.8, 4.2) });
  }

  // Gas tóxico (piso 10): nube verde que sube y se expande despacio.
  gas(x, y) {
    const life = rand(1.4, 2.4);
    this.add({ type: 'dust', color: '#7ddc3a', x, y, vx: rand(-10, 10), vy: rand(-10, 10), life, max: life, size: rand(2.5, 3.6) });
  }

  // Astillas de la puerta al estamparla contra alguien (salen hacia donde gira la hoja).
  splinters(x, y, angle, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-0.8, 0.8);
      const s = rand(60, 260);
      const life = rand(0.25, 0.55);
      this.add({ type: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.5, 4) });
    }
  }

  // Rocío de sangre en cono (`wide` = semiapertura en rad). Mezcla niebla fina (muchas gotas
  // rápidas) con gotas gordas (pocas, lentas y más abiertas) para que cada baja salpique distinto.
  blood(x, y, angle, count = 10, wide = 0.6, tox = false) {
    for (let i = 0; i < count; i++) {
      const heavy = Math.random() < 0.22;
      const a = angle + rand(-wide, wide) * (heavy ? 1.4 : 1);
      const s = heavy ? rand(60, 210) : rand(120, 430);
      const life = heavy ? rand(0.22, 0.5) : rand(0.1, 0.32);
      this.add({ type: 'blood', tox, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        size: heavy ? rand(3.2, 4.6) : rand(1.1, 2.6) });
    }
  }

  // Restos: trozos que salen despedidos, rebotan en las paredes, van soltando gotas por el
  // camino (rastro) y al pararse quedan pegados al suelo.
  gibs(x, y, angle, count = 4, wide = 0.9, tox = false) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-wide, wide);
      const s = rand(110, 330);
      const life = rand(0.35, 0.75);
      const kind = Math.random() < 0.2 ? 2 : Math.random() < 0.5 ? 1 : 0; // hueso · coágulo · carne
      this.add({ type: 'gib', kind, tox, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(2, 3.4), trail: 0 });
    }
  }

  // Chispas de neón del impacto letal: cian y magenta, aditivas y más largas que las del disparo.
  neon(x, y, angle, count = 10, wide = 1.1, tox = false) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-wide, wide);
      const s = rand(180, 560);
      const life = rand(0.12, 0.34);
      const pal = tox ? TOXIC_NEON : NEON;
      this.add({ type: 'neon', color: pal[(Math.random() * pal.length) | 0], x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life });
    }
  }

  // Todo lo que sale de una baja: sangre hacia donde va el golpe, un poco hacia atrás (la herida
  // de entrada), restos y neón. `power` ≈ 1 (disparo), más en melé y remate; `wide` = apertura.
  gore(x, y, angle, power = 1, wide = 0.55, tox = false) {
    this.blood(x, y, angle, Math.round(20 * power), wide, tox);
    this.blood(x, y, angle + Math.PI, Math.round(6 * power), 0.9, tox);
    this.gibs(x, y, angle, Math.round(rand(3, 5) * power), Math.max(wide, 0.8), tox);
    this.neon(x, y, angle, Math.round(11 * power), Math.max(wide, 1), tox);
  }

  // Baja SIN sangre (ajuste "sangre: no"): el mismo impacto, pero solo chispas de neón, chispas
  // de metal y un poco de humo. No deja nada permanente en el suelo ni en las paredes.
  cleanKill(x, y, angle, power = 1, wide = 0.55) {
    this.neon(x, y, angle, Math.round(18 * power), Math.max(wide, 1));
    this.neon(x, y, angle + Math.PI, Math.round(6 * power), 0.9);
    this.sparks(x, y, angle, Math.round(8 * power), Math.max(wide, 0.7));
    this.dust(x, y, Math.round(6 * power));
  }

  shell(x, y, angle) {
    if (this.shells.length >= MAX_SHELLS) this.shells.shift();
    const a = angle + rand(-0.35, 0.35);
    const s = rand(110, 190);
    this.shells.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rand(0, TAU), spin: rand(-25, 25) });
  }

  // `bake(kind, p)` pinta en la capa de sangre cuando algo "cae": kind = 'drop' (una gota),
  // 'gib' (un resto que se para) o 'trail' (gota del rastro de un resto en vuelo).
  update(dt, map, bake) {
    for (const p of this.list) {
      if (p.type === 'gib') { this.updateGib(p, dt, map, bake); continue; }
      const drag = p.type === 'spark' ? 6 : p.type === 'dust' || p.type === 'chip' ? 4 : 3;
      const k = Math.exp(-drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'dust') p.size += dt * 6;
      if (p.type === 'blood' && isSolidAt(map, p.x, p.y)) p.life = 0;
      p.life -= dt;
      if (p.life <= 0 && p.type === 'blood' && !isSolidAt(map, p.x, p.y)) bake('drop', p);
    }
    this.list = this.list.filter((p) => p.life > 0);

    for (const s of this.shells) {
      if (Math.abs(s.vx) + Math.abs(s.vy) < 2) continue;
      const k = Math.exp(-5 * dt);
      s.vx *= k;
      s.vy *= k;
      s.spin *= k;
      const nx = s.x + s.vx * dt;
      if (isSolidAt(map, nx, s.y)) s.vx *= -0.5; else s.x = nx;
      const ny = s.y + s.vy * dt;
      if (isSolidAt(map, s.x, ny)) s.vy *= -0.5; else s.y = ny;
      s.rot += s.spin * dt;
    }
  }

  updateGib(p, dt, map, bake) {
    const k = Math.exp(-4.5 * dt);
    p.vx *= k;
    p.vy *= k;
    const nx = p.x + p.vx * dt;
    if (isSolidAt(map, nx, p.y)) p.vx *= -0.45; else p.x = nx;
    const ny = p.y + p.vy * dt;
    if (isSolidAt(map, p.x, ny)) p.vy *= -0.45; else p.y = ny;
    p.trail -= dt;
    if (p.trail <= 0 && Math.abs(p.vx) + Math.abs(p.vy) > 40) {
      p.trail = 0.035;
      bake('trail', p);
    }
    p.life -= dt;
    if (p.life <= 0) bake('gib', p);
  }

  // Casquillos: 2×1 píxeles de latón; horizontales o verticales según su giro.
  drawGround(ctx) {
    ctx.fillStyle = COLORS.shell;
    for (const s of this.shells) {
      const horizontal = Math.abs(Math.cos(s.rot)) > 0.5;
      pixelRect(ctx, s.x, s.y, horizontal ? 2 : 1, horizontal ? 1 : 2);
    }
  }

  // Todo son cuadrados alineados a la rejilla de píxeles: nada de círculos ni líneas suavizadas.
  // Dos pasadas (normales y aditivas): cambiar de modo de mezcla en cada partícula sería caro.
  draw(ctx) {
    ctx.save();
    for (const p of this.list) {
      if (p.type === 'spark' || p.type === 'neon') continue;
      const t = p.life / p.max;
      ctx.globalAlpha = p.type === 'dust' ? t * 0.5 : p.type === 'chip' ? Math.min(1, t * 2) : 1;
      if (p.type === 'gib') {
        ctx.fillStyle = (p.tox ? TOXIC_GIBS : GIB_COLORS)[p.kind];
        const size = p.size > 2.7 ? 2 : 1;
        pixelRect(ctx, p.x, p.y, size, size);
        continue;
      }
      ctx.fillStyle = p.type === 'dust' ? (p.color || COLORS.dust) : p.type === 'chip' ? COLORS.door : p.tox ? palOf(p.tox).blood : COLORS.blood;
      const size = p.size > 3 ? 2 : 1;
      pixelRect(ctx, p.x, p.y, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      if (p.type !== 'spark' && p.type !== 'neon') continue;
      const t = p.life / p.max;
      ctx.fillStyle = p.type === 'neon' ? p.color : COLORS.spark;
      ctx.globalAlpha = t;
      pixelRect(ctx, p.x, p.y);
      ctx.globalAlpha = t * 0.5;
      pixelRect(ctx, p.x - p.vx * 0.012, p.y - p.vy * 0.012);
      if (p.type === 'neon') pixelRect(ctx, p.x - p.vx * 0.024, p.y - p.vy * 0.024); // estela más larga
    }
    ctx.restore();
  }
}

const MAX_PRINTS = 90;

// Huellas de sangre en el suelo (decals que se desvanecen). No van a la capa de sangre porque esa
// es permanente y las huellas tienen que borrarse solas: son una lista corta que se dibuja cada
// fotograma, justo encima de las baldosas y la sangre y debajo de los personajes.
//   - `intensity` (0..1) es la posición en la secuencia: la primera pisada tras manchar las
//     suelas es 1 (rojo vivo) y la última casi 0 (un rastro apenas visible). También elige el
//     tono (vivo / medio / coagulado) y cuánto dura.
//   - Con los segundos cada huella se aclara: aguanta el 40 % de su vida y luego se desvanece
//     hasta desaparecer (las más intensas duran más: de 6 a 14 s).
export class Footprints {
  constructor() {
    this.list = [];
  }

  clear() {
    this.list.length = 0;
  }

  add(x, y, angle, intensity, tox = false) {
    if (this.list.length >= MAX_PRINTS) this.list.shift();
    this.list.push({ x, y, angle, intensity, tox, age: 0, life: 6 + 8 * intensity });
  }

  // Compacta en el sitio (sin crear un array nuevo cada fotograma).
  update(dt) {
    let n = 0;
    for (const p of this.list) {
      p.age += dt;
      if (p.age < p.life) this.list[n++] = p;
    }
    this.list.length = n;
  }

  draw(ctx) {
    for (const p of this.list) {
      const alpha = p.intensity * Math.min(1, (1 - p.age / p.life) / 0.6);
      if (alpha < 0.03) continue;
      const tone = p.intensity > 0.66 ? '' : p.intensity > 0.33 ? 'Mid' : 'Dark';
      const sprite = (p.tox ? 'footG' : 'foot') + tone; // verde si pisó sangre tóxica
      drawSprite(ctx, sprite, p.x, p.y, p.angle, { alpha });
    }
  }
}
