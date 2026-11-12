import { rand } from './utils.js';

// Escala la escena de baja resolución a la pantalla (sin suavizado) y aplica el post-proceso
// CRT/VHS: aberración cromática (copias roja/azul desplazadas píxeles internos enteros),
// banda VHS, scanlines alineadas con cada fila de píxeles y viñeta.
export class ScreenFx {
  constructor() {
    this.enabled = true;
    this.lite = false;  // sin aberración cromática (rendimiento)
    this.glitch = 0;   // 0..1, sube en impactos y decae solo
    this.bandY = 0;
    this.red = document.createElement('canvas');
    this.blue = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.view = { x: 0, y: 0, w: 1, h: 1, scale: 1 };
  }

  // sceneW/H = resolución interna; view = rectángulo de pantalla donde se dibuja escalada.
  resize(sceneW, sceneH, screenW, screenH, view) {
    this.view = view;
    for (const c of [this.red, this.blue]) {
      c.width = sceneW;
      c.height = sceneH;
    }
    this.overlay.width = screenW;
    this.overlay.height = screenH;
    const ctx = this.overlay.getContext('2d');
    // Una línea oscura en el tercio inferior de cada fila de píxeles internos.
    const lineH = Math.max(1, Math.round(view.scale / 3));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (let row = 0; row < sceneH; row++) {
      const y = Math.round(view.y + (row + 1) * view.scale) - lineH;
      ctx.fillRect(view.x, y, view.w, lineH);
    }
    const g = ctx.createRadialGradient(screenW / 2, screenH / 2, Math.min(screenW, screenH) * 0.35, screenW / 2, screenH / 2, Math.max(screenW, screenH) * 0.75);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, screenW, screenH);
  }

  kick(amount) {
    this.glitch = Math.min(1, this.glitch + amount);
  }

  tint(canvas, scene, color) {
    const c = canvas.getContext('2d');
    c.globalCompositeOperation = 'copy';
    c.drawImage(scene, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = color;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
  }

  compose(ctx, scene, dt) {
    const { x, y, w, h, scale } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(scene, x, y, w, h);
    if (!this.enabled) return;

    this.glitch = Math.max(0, this.glitch - dt * 3);
    // Modo ligero (`lite`, lo activa el juego si va lento): sin aberración cromática, que es lo
    // más caro (dos copias tintadas de la escena por fotograma). Scanlines y VHS se mantienen.
    if (!this.lite) {
      // El desplazamiento va en píxeles internos enteros: la franja de color también es "pixel art".
      const off = Math.round(1 + this.glitch * 3) * scale;
      this.tint(this.red, scene, '#ff0033');
      this.tint(this.blue, scene, '#2244ff');
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + this.glitch * 0.22;
      ctx.drawImage(this.red, x - off, y, w, h);
      ctx.drawImage(this.blue, x + off, y, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Banda VHS: una franja de filas internas que baja y se desplaza a saltos de píxel.
    const sh = scene.height;
    this.bandY = (this.bandY + dt * 22) % (sh + 20);
    const bh = Math.round(3 + this.glitch * 10);
    const by = Math.floor(this.bandY) - 10;
    if (by >= 0 && by + bh <= sh) {
      const jitter = Math.round(rand(-1, 1) * (1 + this.glitch * 4)) * scale;
      ctx.drawImage(scene, 0, by, scene.width, bh, x + jitter, y + by * scale, w, bh * scale);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(x, y + by * scale, w, bh * scale);
    }

    ctx.drawImage(this.overlay, 0, 0);
  }
}
