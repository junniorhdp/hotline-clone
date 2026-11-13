import { isSolidAt } from './map.js';
import { COLORS, TAU, rand } from './utils.js';
import { pixelRect } from './sprites.js';

const MAX_PARTICLES = 700;
const MAX_SHELLS = 150;

// Partículas efímeras (chispas, polvo, gotas de sangre) + casquillos que se quedan en el suelo.
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

  // Astillas de la puerta al estamparla contra alguien (salen hacia donde gira la hoja).
  splinters(x, y, angle, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-0.8, 0.8);
      const s = rand(60, 260);
      const life = rand(0.25, 0.55);
      this.add({ type: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.5, 4) });
    }
  }

  blood(x, y, angle, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-0.6, 0.6);
      const s = rand(80, 320);
      const life = rand(0.12, 0.35);
      this.add({ type: 'blood', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.2, 3) });
    }
  }

  shell(x, y, angle) {
    if (this.shells.length >= MAX_SHELLS) this.shells.shift();
    const a = angle + rand(-0.35, 0.35);
    const s = rand(110, 190);
    this.shells.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rand(0, TAU), spin: rand(-25, 25) });
  }

  // `onBloodLand(x, y, size)` se llama cuando una gota "cae" para pintarla en la capa de sangre.
  update(dt, map, onBloodLand) {
    for (const p of this.list) {
      const drag = p.type === 'spark' ? 6 : p.type === 'dust' || p.type === 'chip' ? 4 : 3;
      const k = Math.exp(-drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'dust') p.size += dt * 6;
      if (p.type === 'blood' && isSolidAt(map, p.x, p.y)) p.life = 0;
      p.life -= dt;
      if (p.life <= 0 && p.type === 'blood' && !isSolidAt(map, p.x, p.y)) onBloodLand(p.x, p.y, p.size);
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

  // Casquillos: 2×1 píxeles de latón; horizontales o verticales según su giro.
  drawGround(ctx) {
    ctx.fillStyle = COLORS.shell;
    for (const s of this.shells) {
      const horizontal = Math.abs(Math.cos(s.rot)) > 0.5;
      pixelRect(ctx, s.x, s.y, horizontal ? 2 : 1, horizontal ? 1 : 2);
    }
  }

  // Todo son cuadrados alineados a la rejilla de píxeles: nada de círculos ni líneas suavizadas.
  draw(ctx) {
    ctx.save();
    for (const p of this.list) {
      const t = p.life / p.max;
      if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t;
        ctx.fillStyle = COLORS.spark;
        pixelRect(ctx, p.x, p.y);
        ctx.globalAlpha = t * 0.5;
        pixelRect(ctx, p.x - p.vx * 0.012, p.y - p.vy * 0.012);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = p.type === 'dust' ? t * 0.5 : p.type === 'chip' ? Math.min(1, t * 2) : 1;
        ctx.fillStyle = p.type === 'dust' ? COLORS.dust : p.type === 'chip' ? COLORS.door : COLORS.blood;
        const size = p.size > 3 ? 2 : 1;
        pixelRect(ctx, p.x, p.y, size, size);
      }
    }
    ctx.restore();
  }
}
