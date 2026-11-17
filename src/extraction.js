import { TILE, isWallTile } from './map.js';
import { pixelRect, WORLD_PX } from './sprites.js';
import { BikeExit } from './exits.js';

// Auto de extracción: cuando el jugador sale a la calle con 2 o más rehenes liberados, un auto llega por el oeste (la valla se abre), se detiene junto a la
// acera, los rehenes se suben uno a uno y arranca hacia el este perdiéndose de vista, mientras el jugador se va en su moto (ver Hostages y Game.startLeaving).
// Todo es visual: el auto no colisiona con nada. Fases: wait → arrive → idle (espera a que los rehenes lleguen) → board → depart → gone.
const WAIT = 0.9, ARRIVE = 1.7, HOLD = 0.45, IDLE_MAX = 10;
const LEN = 72, WID = 30;                 // tamaño del auto en unidades del mundo (≈ 36 × 15 píxeles)

export class ExtractionCar {
  constructor(game) {
    const m = game.map, b = game.bike;
    this.W = m.pixelW;
    const rowT = Math.floor(b.park.y / TILE), rowE = m.h - 2;
    // Carril: la primera fila de calle (debajo de la de la moto) libre de punta a punta; si no hay, la segunda.
    const clear = (r) => { for (let tx = 1; tx < m.w - 1; tx++) if (isWallTile(m, tx, r)) return false; return true; };
    let row = rowT + 1;
    for (let r = rowT + 1; r <= rowE; r++) if (clear(r)) { row = r; break; }
    this.row = row;
    this.y = row * TILE + TILE / 2;
    this.stopX = Math.max(160, Math.min(this.W - 200, game.entry.x + 130)); // junto a la acera, a la altura de la puerta principal
    this.x = -LEN;
    this.phase = 'wait';
    this.t = 0;
    this.v = 0;
    this.idleT = 0;
    this.fired = {};
    this.lights = true;
  }

  // Dónde se colocan los rehenes (en la acera, al norte del auto) según su número de orden.
  slot(i, n) {
    return { x: this.stopX - ((n - 1) * 15) / 2 + i * 15, y: this.y - 34 };
  }

  // ¿Atropella a (x, y, r)? Solo mientras el auto se mueve de verdad (llegando o saliendo), no con el auto parado esperando a los rehenes.
  hits(x, y, r) {
    if ((this.phase !== 'arrive' && this.phase !== 'depart') || this.v < 60) return false;
    return Math.abs(x - this.x) < LEN / 2 + 2 + r * 0.5 && Math.abs(y - this.y) < WID / 2 + 2 + r * 0.5;
  }

  get busy() { return this.phase !== 'depart' && this.phase !== 'gone'; }

  update(dt, game, hostages) {
    this.t += dt;
    const ph = this.phase;
    if (ph === 'wait') {
      if (this.t >= WAIT) { this.phase = 'arrive'; this.t = 0; game.playAt('carPass', this.stopX, this.y, 1); }
    } else if (ph === 'arrive') {
      const k = Math.min(1, this.t / ARRIVE), e = 1 - (1 - k) * (1 - k) * (1 - k); // frena suave al llegar
      this.x = -LEN + (this.stopX + LEN) * e;
      this.v = (1 - k) * 420;
      if (k < 0.85 && Math.random() < 0.6) game.particles.dust(this.x - LEN / 2, this.y + (Math.random() - 0.5) * 10, 1);
      if (k >= 1) { this.phase = 'idle'; this.t = 0; this.v = 0; }
    } else if (ph === 'idle') {
      this.idleT += dt;
      if (hostages.allReady() || this.idleT > IDLE_MAX) { this.phase = 'board'; this.t = 0; hostages.startBoarding(); }
    } else if (ph === 'board') {
      if (hostages.allBoarded()) { this.phase = 'hold'; this.t = 0; }
    } else if (ph === 'hold') {
      if (this.t >= HOLD) { this.phase = 'depart'; this.t = 0; game.playAt('carAway', this.x, this.y, 1); }
    } else if (ph === 'depart') {
      this.v += 330 * dt;
      this.x += this.v * dt;
      if (Math.random() < 0.7) game.particles.dust(this.x - LEN / 2 - 4, this.y + (Math.random() - 0.5) * 12, 1);
      if (Math.random() < 0.5) game.particles.neon(this.x - LEN / 2, this.y, Math.PI + (Math.random() - 0.5) * 0.4, 1, 0.2);
      if (this.x > this.W + LEN + 60) this.phase = 'gone';
    }
  }

  // ¿Está cerca de un extremo de la calle? (para dibujar la valla abierta por donde entra o sale)
  nearWest() { return this.phase !== 'gone' && this.x < 80; }
  nearEast() { return this.phase === 'depart' && this.x > this.W - 120; }

  // Dibujo (después de las paredes: pasa por las aberturas de la valla). Mira hacia el este.
  draw(ctx, time, game) {
    if (this.phase === 'gone') return;
    const x = Math.round(this.x), y = Math.round(this.y);
    const px = (ox, oy, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x + ox, y + oy, w, h); };
    ctx.save();
    if (this.nearWest()) BikeExit.drawGap(ctx, game, 'west');
    if (this.nearEast()) BikeExit.drawGap(ctx, game, 'east');
    // sombra y faros (cono de luz aditivo) si se mueve
    px(-34, 12, 72, 8, 'rgba(5,0,15,0.5)');
    if (this.phase === 'arrive' || this.phase === 'depart') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff2b0';
      for (let i = 0; i < 16; i++) {
        ctx.globalAlpha = 0.2 * (1 - i / 16);
        const half = 3 + i * 1.6;
        pixelRect(ctx, x + 36 + i * 7, y - half, 4, Math.max(1, Math.round((2 * half) / WORLD_PX)));
      }
      ctx.restore(); ctx.save();
    }
    // carrocería: azul noche con contorno, techo claro con franja de neón, parabrisas y lunetas
    px(-36, -14, 74, 28, '#0a0a14');                // contorno
    px(-34, -12, 70, 24, '#1d2b4a');                // carrocería
    px(-34, -12, 70, 4, '#2e4a7a');                 // luz de arriba
    px(-30, -9, 8, 18, '#0e1830');                  // capó trasero
    px(-14, -10, 30, 20, '#2e4a7a'); px(-12, -8, 26, 16, '#3a5a90'); // techo
    px(-12, -1, 26, 2, '#05d9e8');                  // franja de neón del techo
    px(16, -10, 6, 20, '#7ad7ff'); px(16, -10, 2, 20, '#bfeaff'); // parabrisas
    px(-22, -9, 4, 18, '#5a8ab8');                  // luneta trasera
    px(32, -10, 4, 6, '#ffe08a'); px(32, 4, 4, 6, '#ffe08a'); // faros delanteros
    px(-36, -10, 2, 6, '#ff2a4a'); px(-36, 4, 2, 6, '#ff2a4a'); // luces traseras
    // ruedas
    for (const wx of [-26, 18]) { px(wx, -16, 12, 3, '#05050a'); px(wx, 13, 12, 3, '#05050a'); }
    // cartel luminoso del techo (parpadea mientras espera)
    if (this.phase === 'idle' || this.phase === 'board' || this.phase === 'hold') {
      px(-2, -5, 10, 10, Math.floor(time * 4) % 2 ? '#ffbe0b' : '#b38600');
    }
    // puerta abierta (lado norte) mientras suben los rehenes
    if (this.phase === 'board') px(-4, -20, 14, 6, '#3a5a90');
    ctx.restore();
  }
}
