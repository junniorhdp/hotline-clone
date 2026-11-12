// Puntuación, combos y rango por piso. El guardado de récords vive en scores-history.js.
export const COMBO_WINDOW = 3.5;  // s entre bajas para mantener el combo
const MAX_COMBO = 16;
const TIME_BONUS_PER_SECOND = 50; // por cada segundo por debajo del par
const POPUP_TIME = 1.1;

// Puntos base por estilo; se multiplican por el combo actual.
export const STYLE = {
  finisher: { points: 500, label: 'REMATE' },
  door: { points: 400, label: 'PORTAZO' },
  thrown: { points: 300, label: 'LANZAMIENTO' },
  melee: { points: 250, label: 'CUERPO A CUERPO' },
  bullet: { points: 150, label: 'DISPARO' },
  fists: { points: 100, label: 'DERRIBO' },
};

// Umbrales de rango sobre (puntos del piso / (enemigos × 600)).
const RANKS = [['S', 4], ['A', 2.5], ['B', 1.2], ['C', 0]];

export class Score {
  // `bestScore` = mejor puntuación guardada al empezar la partida (para detectar récord).
  constructor(bestScore = 0) {
    this.newRun(bestScore);
  }

  // Partida nueva desde el piso 1.
  newRun(bestScore = 0) {
    this.bestBefore = bestScore;
    this.total = 0;
    this.runMaxCombo = 0;
    this.startLevel();
  }

  get isRecord() {
    return this.total > this.bestBefore;
  }

  // Al empezar (o reintentar) un piso, el total vuelve a lo que había al entrar.
  startLevel() {
    this.levelStartTotal = this.total;
    this.restartLevel();
  }

  restartLevel() {
    this.total = this.levelStartTotal;
    this.levelScore = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.popups = [];
  }

  // Registra una baja/derribo con estilo. Devuelve los puntos ganados.
  register(kind, x, y) {
    const style = STYLE[kind];
    this.combo = this.comboTimer > 0 ? Math.min(MAX_COMBO, this.combo + 1) : 1;
    this.comboTimer = COMBO_WINDOW;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.runMaxCombo = Math.max(this.runMaxCombo, this.combo);
    const points = style.points * this.combo;
    this.levelScore += points;
    this.total += points;
    const comboText = this.combo > 1 ? ` x${this.combo}` : '';
    this.popups.push({ x, y, text: `+${points} ${style.label}${comboText}`, life: POPUP_TIME });
    return points;
  }

  // `comboRunning`: el temporizador del combo solo corre mientras se juega.
  update(dt, comboRunning = true) {
    if (comboRunning && this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.comboTimer = 0; this.combo = 0; }
    }
    for (const p of this.popups) { p.life -= dt; p.y -= 28 * dt; }
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  // Cierra el piso: bonus de tiempo y rango.
  finishLevel(time, par, enemyCount) {
    const timeBonus = Math.max(0, Math.round((par - time) * TIME_BONUS_PER_SECOND / 10) * 10);
    this.levelScore += timeBonus;
    this.total += timeBonus;
    this.combo = 0;
    this.comboTimer = 0;
    const ratio = this.levelScore / (Math.max(1, enemyCount) * 600);
    const rank = RANKS.find(([, min]) => ratio >= min)[0];
    return { rank, time, par, timeBonus, maxCombo: this.maxCombo, levelScore: this.levelScore, total: this.total, newRecord: this.isRecord };
  }
}
