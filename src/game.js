import { Input } from './input.js';
import { LEVELS, TILE, loadLevel, renderFloor, renderWalls, isSolidAt, doorHitT } from './map.js';
import { Score, COMBO_WINDOW } from './score.js';
import { MASKS, maskEffects, maskIcon } from './masks.js';
import { ScoreHistory, FloorStats, MAX_ENTRIES, newRunId, formatDate } from './scores-history.js';
import { Menu } from './menu.js';
import { TouchControls } from './touch.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Door } from './doors.js';
import { Pickup, Bullet, ENEMY_WEAPONS, segmentPointDistance } from './weapons.js';
import { Particles } from './particles.js';
import { Sfx } from './audio.js';
import { ScreenFx } from './effects.js';
import { drawSprite, pixelDisc, WORLD_PX } from './sprites.js';
import { drawText, measureText, CELL_H } from './pixelfont.js';
import { COLORS, TAU, rand, clamp, closestOnSegment, seededRandom, hashString } from './utils.js';

const STEP = 1 / 60;       // paso fijo de simulación (60 FPS)
const MAX_FRAME = 0.25;    // evita la "espiral de la muerte" tras cambiar de pestaña
const CAMERA_LERP = 8;
const CAMERA_LOOKAHEAD = 0.2;   // fracción de la distancia al ratón que la cámara se adelanta
const MAX_LOOKAHEAD = 70;       // tope en unidades del mundo: el jugador nunca se va al borde
const MAX_SHAKE = 14;
const HEARING_DIST = 700;  // a partir de aquí los sonidos lejanos apenas se oyen

// Resolución interna del pixel art: ~216 px de alto con escala ENTERA (píxeles siempre nítidos).
// Se elige el factor entero más cercano a pantalla/216 y la altura se ajusta a lo que cabe exacto
// (p. ej. 1080 px → ×5 = 216; 636 px → ×3 = 212), así no quedan franjas negras.
const TARGET_INTERNAL_H = 216;
const INTERNAL_MIN_H = 160;
const INTERNAL_MIN_W = 256;
const INTERNAL_MAX_W = 560;
const INTERNAL_MAX_H = 320;     // en vertical la escena no crece sin límite
const TOUCH_LOOKAHEAD = 50;     // adelanto de cámara (mundo) en modo táctil
const LOW_FPS = 45;              // por debajo, durante LOW_FPS_SECONDS seguidos → efectos ligeros
const LOW_FPS_SECONDS = 3;
const COARSE_POINTER = window.matchMedia?.('(pointer: coarse)').matches ?? false;

// Hit-stop: segundos que se congela la simulación en cada tipo de impacto.
const HITSTOP = { kill: 0.05, finisher: 0.08, knock: 0.035, playerDeath: 0.12 };
const INTRO_BANNER_TIME = 2.2;
const FADE_TIME = 0.25;        // segundos de cada mitad del fundido (salida y entrada)
const RANK_COLORS = { S: COLORS.player, A: COLORS.weapon, B: COLORS.enemy, C: COLORS.blood };

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1 / WORLD_PX;  // 1 píxel interno = 2 unidades del mundo
    this.shake = 0;
    this.ox = 0;
    this.oy = 0;
    this.viewW = 1;
    this.viewH = 1;
  }

  // viewW/H en píxeles internos.
  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  setBounds(w, h) {
    this.boundsW = w;
    this.boundsH = h;
  }

  // Evita enseñar el vacío fuera del mapa; si el mapa cabe entero en pantalla, lo centra.
  clampTarget(x, y) {
    const halfW = this.viewW / 2 / this.zoom, halfH = this.viewH / 2 / this.zoom;
    return {
      x: this.boundsW > halfW * 2 ? clamp(x, halfW, this.boundsW - halfW) : this.boundsW / 2,
      y: this.boundsH > halfH * 2 ? clamp(y, halfH, this.boundsH - halfH) : this.boundsH / 2,
    };
  }

  snap(x, y) {
    const t = this.clampTarget(x, y);
    this.x = t.x;
    this.y = t.y;
    this.shake = 0;
  }

  addShake(amount) {
    this.shake = Math.min(MAX_SHAKE, this.shake + amount);
  }

  update(dt, tx, ty) {
    const t = this.clampTarget(tx, ty);
    const k = 1 - Math.exp(-CAMERA_LERP * dt);
    this.x += (t.x - this.x) * k;
    this.y += (t.y - this.y) * k;
    this.shake = Math.max(0, this.shake - 40 * dt);
    this.ox = rand(-1, 1) * this.shake;
    this.oy = rand(-1, 1) * this.shake;
  }

  // Desplazamiento redondeado a píxeles internos enteros: así el pixel art no "tiembla".
  get offsetX() { return Math.round(this.viewW / 2 - (this.x + this.ox) * this.zoom); }
  get offsetY() { return Math.round(this.viewH / 2 - (this.y + this.oy) * this.zoom); }

  screenToWorld(sx, sy) {
    return { x: (sx - this.offsetX) / this.zoom, y: (sy - this.offsetY) / this.zoom };
  }

  worldToScreen(x, y) {
    return { x: x * this.zoom + this.offsetX, y: y * this.zoom + this.offsetY };
  }

  apply(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.offsetX, this.offsetY);
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Todo se dibuja en `scene` y luego ScreenFx lo compone en el canvas visible.
    this.scene = document.createElement('canvas');
    this.sceneCtx = this.scene.getContext('2d');
    this.input = new Input(canvas);
    this.camera = new Camera();
    this.particles = new Particles();
    this.sfx = new Sfx();
    this.fx = new ScreenFx();
    this.history = new ScoreHistory();
    this.score = new Score(this.history.best());
    this.runId = newRunId();
    this.showRecords = false;
    this.levelIndex = 0;
    this.debug = false;
    this.acc = 0;
    this.last = 0;
    this.frameDt = 0;
    this.fps = 0;
    this.frames = 0;
    this.fpsTimer = 0;
    this.loop = this.loop.bind(this);
    this.floorStats = new FloorStats();
    this.menu = new Menu(this);
    this.touch = new TouchControls(this);
    this.toast = null;
    // Elemento invisible que lee las zonas seguras CSS (env(safe-area-inset-*)).
    this.safeProbe = document.createElement('div');
    this.safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;'
      + 'pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) '
      + 'env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(this.safeProbe);
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.fade = null;
    this.mask = MASKS[0];
    this.maskIndex = 0;
    // En móvil la barra del navegador cambia el alto visible y se puede girar la pantalla.
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    this.resize();
    this.reset();
    this.openMenu();
  }

  // El canvas se dimensiona en píxeles FÍSICOS (CSS × devicePixelRatio): en pantallas de
  // densidad 2× o 3× el navegador no reescala la imagen y el pixel art sigue nítido.
  // Escala entera elegida sobre píxeles físicos, garantizando que la escena quepa entera
  // (si no, en pantallas estrechas se perderían los lados). `view` = rectángulo físico.
  resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const sw = Math.round(cssW * dpr), sh = Math.round(cssH * dpr);
    let scale = Math.max(1, Math.round(sh / TARGET_INTERNAL_H));
    while (scale > 1 && (sh / scale < INTERNAL_MIN_H || sw / scale < INTERNAL_MIN_W)) scale--;
    const ih = Math.min(Math.floor(sh / scale), INTERNAL_MAX_H);
    const iw = Math.min(Math.floor(sw / scale), INTERNAL_MAX_W);
    const w = iw * scale, h = ih * scale;
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.view = { x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2), w, h, scale };
    this.canvas.width = sw;
    this.canvas.height = sh;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scene.width = iw;
    this.scene.height = ih;
    this.sceneCtx.imageSmoothingEnabled = false; // cambiar el tamaño reinicia el estado del contexto
    this.ctx.imageSmoothingEnabled = false;
    this.camera.resize(iw, ih);
    this.fx.resize(iw, ih, sw, sh, this.view);
    // Zonas seguras del sistema (muesca, esquinas, barra de inicio) en píxeles internos.
    const cs = getComputedStyle(this.safeProbe);
    const k = dpr / scale;
    const inset = (v) => Math.ceil((parseFloat(v) || 0) * k);
    this.safe = { t: inset(cs.paddingTop), r: inset(cs.paddingRight), b: inset(cs.paddingBottom), l: inset(cs.paddingLeft) };
  }

  // Coordenadas CSS relativas al canvas (ratón o dedo) → píxeles internos de la escena.
  toInternal(cssX, cssY) {
    const v = this.view;
    return { x: (cssX * this.dpr - v.x) / v.scale, y: (cssY * this.dpr - v.y) / v.scale };
  }

  mouseInternal() {
    return this.toInternal(this.input.mouse.x, this.input.mouse.y);
  }

  // Juego apaisado obligatorio en dispositivos táctiles: en vertical se pausa y se pide girar.
  get needsRotate() {
    return this.cssH > this.cssW && (this.input.touchMode || COARSE_POINTER);
  }

  mouseWorld() {
    const m = this.mouseInternal();
    return this.camera.screenToWorld(m.x, m.y);
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  // Paso fijo: acumulamos tiempo real y simulamos en trozos de 1/60 s.
  loop(now) {
    const frame = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    this.frameDt = frame;
    this.acc += frame;
    while (this.acc >= STEP) {
      // update() devuelve false durante el hit-stop: las pulsaciones se conservan para el
      // siguiente paso en vez de perderse (un clic justo tras un impacto sigue contando).
      if (this.update(STEP) !== false) this.input.endStep();
      this.acc -= STEP;
    }
    this.render();

    this.frames++;
    this.fpsTimer += frame;
    if (this.fpsTimer >= 1) {
      this.fps = this.frames;
      this.frames = 0;
      this.fpsTimer -= 1;
      this.checkPerformance();
    }
    requestAnimationFrame(this.loop);
  }

  // Entra en un piso nuevo (el total de puntos acumulado se conserva) pasando antes por la
  // selección de máscara.
  goToLevel(index) {
    this.levelIndex = index;
    this.score.startLevel();
    this.reset();
    this.openMaskSelect();
  }

  // --- Selección de máscara ---------------------------------------------------------------
  // El piso ya está cargado detrás (se ve atenuado); al confirmar se recarga con la pasiva.

  openMaskSelect() {
    this.state = 'masks';
    this.maskIndex = MASKS.indexOf(this.mask);
    // Posición inicial del ratón: solo un movimiento real cambia la selección.
    this.maskMouse = this.mouseInternal();
  }

  confirmMask() {
    this.mask = MASKS[this.maskIndex];
    this.reset();
    this.player.cooldown = 0.3; // que el clic de confirmar no se convierta en un golpe
    this.sfx.play('pickup');
  }

  // Rectángulos de las tarjetas (en píxeles internos), compartidos por el dibujo y el ratón.
  maskLayout() {
    const w = this.scene.width, h = this.scene.height, n = MASKS.length, gap = 6;
    const cardW = clamp(Math.floor((w - 16 - gap * (n - 1)) / n), 40, 78);
    const iconScale = clamp(Math.min(Math.floor((cardW - 12) / 12), Math.floor((h - 130) / 12)), 2, 5);
    const cardH = 12 * iconScale + 24;
    const x0 = Math.round((w - (n * cardW + (n - 1) * gap)) / 2);
    const cards = MASKS.map((_, i) => ({ x: x0 + i * (cardW + gap), y: 36, w: cardW, h: cardH }));
    return { cards, iconScale, bottom: 36 + cardH };
  }

  updateMaskSelect() {
    const input = this.input, n = MASKS.length;
    const prev = this.maskIndex;
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.maskIndex = (this.maskIndex + n - 1) % n;
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.maskIndex = (this.maskIndex + 1) % n;

    // Ratón: pasar por encima selecciona (solo si se ha movido), clic confirma.
    const m = this.mouseInternal();
    const moved = Math.hypot(m.x - this.maskMouse.x, m.y - this.maskMouse.y) > 0.5;
    this.maskMouse = m;
    const hovered = this.maskLayout().cards.findIndex((c) => m.x >= c.x && m.x < c.x + c.w && m.y >= c.y && m.y < c.y + c.h);
    if (hovered >= 0 && moved) this.maskIndex = hovered;
    if (this.maskIndex !== prev) this.sfx.play('empty');

    // En táctil, el primer toque en una máscara solo la elige (para leer su pasiva); tocar la
    // ya elegida empieza el piso.
    if (input.touchMode && input.mousePressed.left && hovered >= 0 && hovered !== prev) return;
    if (input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter')
      || (input.mousePressed.left && hovered >= 0)) {
      if (hovered >= 0 && input.mousePressed.left) this.maskIndex = hovered;
      this.transition(() => this.confirmMask());
    }
  }

  // --- Botones táctiles de pantalla ----------------------------------------------------------
  // Solo en modo táctil, en las pantallas donde con teclado se usan Esc / R / Enter / T.
  // `key` es la tecla que "pulsan" (TouchControls la inyecta): reutilizan la misma lógica.
  screenButtons() {
    if (!this.input.touchMode || this.fade) return [];
    const w = this.scene.width, h = this.scene.height, s = this.safe;
    const sized = (id, label, key, accent) => ({ id, label, key, accent, ...this.touch.buttonSize(label) });
    // Fila de botones centrada en horizontal.
    const row = (items, y) => {
      const bs = items.map((it) => sized(...it));
      let x = Math.round(w / 2 - (bs.reduce((sum, b) => sum + b.w, 0) + 8 * (bs.length - 1)) / 2);
      for (const b of bs) { b.x = x; b.y = y; x += b.w + 8; }
      return bs;
    };
    const bottomY = h - 6 - s.b - this.touch.buttonSize('X').h;
    if (this.showRecords) return row([['close', 'CERRAR', 'Escape']], bottomY);
    if (this.state === 'masks') {
      const back = { ...sized('back', 'VOLVER', 'Escape'), x: 6 + s.l, y: 6 + s.t };
      const records = sized('records', 'RÉCORDS', 'KeyT');
      return [back, { ...records, x: w - 6 - s.r - records.w, y: 6 + s.t }];
    }
    if (this.state === 'dead') {
      return row([['retry', 'REINTENTAR', 'KeyR', COLORS.player], ['end', 'TERMINAR', 'Enter', COLORS.blood],
        ['records', 'RÉCORDS', 'KeyT']], Math.round(h / 2) + 8);
    }
    if (this.state === 'gameover') {
      return row([['again', 'NUEVA PARTIDA', 'Enter', COLORS.player], ['menu', 'MENÚ', 'Escape']], bottomY);
    }
    return [];
  }

  // Texto de ayuda según el modo de control.
  hint(desktop, touch) {
    return this.input.touchMode ? touch : desktop;
  }

  // --- Rendimiento ------------------------------------------------------------------------------
  // Si durante LOW_FPS_SECONDS seguidos (con la pestaña visible) va por debajo de LOW_FPS, se
  // pasa a efectos "ligeros" (sin aberración cromática, lo más caro). Solo una vez por sesión.
  checkPerformance() {
    if (this.fx.lite || !this.fx.enabled || this.perfAdjusted) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) { this.lowFpsSeconds = 0; return; }
    this.lowFpsSeconds = this.fps < LOW_FPS ? (this.lowFpsSeconds || 0) + 1 : 0;
    if (this.lowFpsSeconds >= LOW_FPS_SECONDS) {
      this.fx.lite = true;
      this.perfAdjusted = true;
      this.showToast('EFECTOS REDUCIDOS PARA GANAR FLUIDEZ');
    }
  }

  showToast(text, seconds = 3) {
    this.toast = { text, t: seconds };
  }

  drawToast(ctx) {
    if (!this.toast) return;
    this.toast.t -= this.frameDt;
    if (this.toast.t <= 0) { this.toast = null; return; }
    const w = this.scene.width, y = Math.round(this.scene.height * 0.62);
    ctx.globalAlpha = Math.min(1, this.toast.t * 2);
    ctx.fillStyle = 'rgba(13, 2, 33, 0.85)';
    ctx.fillRect(0, y - 3, w, CELL_H + 5);
    drawText(ctx, this.toast.text, Math.round(w / 2), y, { color: COLORS.enemy, align: 'center' });
    ctx.globalAlpha = 1;
  }

  // La pantalla completa solo se puede pedir dentro del propio evento del usuario (no desde el
  // bucle del juego): por eso el botón del título se atiende aquí, en el `pointerup`.
  onPointerUp(e) {
    if (this.state !== 'menu' || this.menu.screen !== 'title' || this.fade) return;
    const r = this.menu.fullscreenRect();
    if (!r) return;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.toInternal(e.clientX - rect.left, e.clientY - rect.top);
    if (p.x < r.x || p.x >= r.x + r.w || p.y < r.y || p.y >= r.y + r.h) return;
    this.sfx.play('pickup');
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {})) // solo Android
      .catch(() => {});
  }

  // Reintenta el piso actual (R): los puntos vuelven a los que había al entrar.
  restartLevel() {
    this.score.restartLevel();
    this.reset();
  }

  // Tras la pantalla de resultados: siguiente piso, o fin de partida si era el último.
  advance() {
    if (this.levelIndex + 1 < LEVELS.length) this.goToLevel(this.levelIndex + 1);
    else this.endRun(true);
  }

  // --- Partidas y Top 5 --------------------------------------------------------------------

  // Entrada del Top 5 para la partida en curso (se actualiza al avanzar: misma `id`).
  saveRun(completed) {
    if (this.score.total <= 0) return 0; // una partida sin puntos no ocupa hueco en el Top 5
    return this.history.record({
      id: this.runId,
      score: this.score.total,
      floor: this.levelIndex + 1,
      completed,
      combo: this.score.runMaxCombo,
      mask: this.mask.id,
      maskName: this.mask.name,
      date: Date.now(),
    });
  }

  // Fin de partida: edificio completado o muerte definitiva (Enter en la pantalla de muerte).
  endRun(completed) {
    const position = this.saveRun(completed);
    this.runSummary = { completed, score: this.score.total, position, newRecord: this.score.isRecord };
    this.state = 'gameover';
    this.showRecords = false;
    this.sfx.setMusic('clear');
    if (position) this.sfx.play('clear');
  }

  newRun() {
    this.startRunAt(0);
  }

  // Al pisar la salida (con la pantalla ya en negro): resultados, Top 5 y estadísticas del piso.
  finishFloor() {
    this.state = 'results';
    this.results = this.score.finishLevel(this.time, this.par, this.enemies.length);
    this.results.last = this.levelIndex === LEVELS.length - 1;
    // Se guarda al completar cada piso: si se cierra la pestaña, el progreso ya cuenta.
    this.results.position = this.saveRun(this.results.last);
    this.floorStats.record(this.levelIndex + 1, this.results.rank, this.results.levelScore);
  }

  // Partida nueva empezando en el piso `index` (desde el menú o el selector de pisos).
  startRunAt(index) {
    this.runId = newRunId();
    this.score.newRun(this.history.best());
    this.levelIndex = index;
    this.reset();
    this.openMaskSelect();
  }

  openMenu(screen = 'title') {
    this.state = 'menu';
    this.showRecords = false;
    this.menu.open(screen);
    this.sfx.setMusic('clear');
  }

  // --- Transiciones (fundido a negro con barrido neón) --------------------------------------
  // `action` se ejecuta con la pantalla en negro. Mientras dura, el juego está congelado y la
  // entrada se ignora. Un fundido en curso no admite otro (evita dobles pulsaciones).

  transition(action, duration = FADE_TIME) {
    if (this.fade) return;
    this.fade = { phase: 'out', t: 0, duration, action };
  }

  updateFade(dt) {
    const f = this.fade;
    f.t += dt;
    if (f.t < f.duration) return;
    if (f.phase === 'out') {
      f.action();
      f.phase = 'in';
      f.t = 0;
    } else {
      this.fade = null;
    }
  }

  drawFade(ctx) {
    const f = this.fade;
    if (!f) return;
    const k = clamp(f.t / f.duration, 0, 1);
    const a = f.phase === 'out' ? k : 1 - k;
    const w = this.scene.width, h = this.scene.height;
    ctx.globalAlpha = a;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    // Barrido: una línea rosa y una cian que recorren la pantalla con el fundido.
    const y = Math.round(f.phase === 'out' ? k * h : (1 - k) * h);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(0, h - y, w, 1);
  }

  reset() {
    // Armas aleatorias con semilla por partida y piso: al reintentar (R) todo sigue en su sitio;
    // en una partida nueva cambian.
    const level = loadLevel(this.levelIndex, seededRandom(hashString(`${this.runId}:${this.levelIndex}`)));
    this.levelName = level.name;
    this.par = level.par;
    this.exit = level.exit;
    this.map = level.map;
    this.player = new Player(level.player.x, level.player.y, maskEffects(this.mask));
    this.enemies = level.enemies.map((e) => new Enemy(e.x, e.y, e.patrol,
      e.weapon ? { type: e.weapon, ammo: ENEMY_WEAPONS[e.weapon].dropAmmo } : null));
    this.pickups = level.weapons.map((w) => new Pickup(w.type, w.x, w.y));
    this.doors = level.doors.map((d) => new Door(d.tx, d.ty, d.horizontal));
    this.map.doors = this.doors;
    this.bullets = [];
    this.particles.clear();
    this.state = 'playing'; // masks (selección) | playing | dead | cleared (ve a la salida) | results
    this.time = 0;
    this.hitstop = 0;
    this.results = null;
    this.showRecords = false;
    this.bannerTimer = INTRO_BANNER_TIME;
    this.sfx.setMusic('action');

    // Las capas estáticas solo se regeneran al cambiar de piso.
    if (this.layersLevel !== this.levelIndex) {
      this.layersLevel = this.levelIndex;
      this.floorLayer = renderFloor(this.map);
      const { walls, glow } = renderWalls(this.map);
      this.wallLayer = walls;
      this.glowLayer = glow;
      // Sangre a media resolución: 1 píxel de la capa = 1 píxel interno en pantalla.
      this.bloodLayer = document.createElement('canvas');
      this.bloodLayer.width = this.map.pixelW / WORLD_PX;
      this.bloodLayer.height = this.map.pixelH / WORLD_PX;
      this.bloodCtx = this.bloodLayer.getContext('2d');
      this.bloodCtx.imageSmoothingEnabled = false;
    }
    this.bloodCtx.clearRect(0, 0, this.bloodLayer.width, this.bloodLayer.height);
    this.camera.setBounds(this.map.pixelW, this.map.pixelH);
    this.camera.snap(this.player.x, this.player.y);
  }

  update(dt) {
    const input = this.input;
    // Primero los controles táctiles: traducen los dedos a teclas/clics que se leen abajo.
    this.touch.update(dt);
    // En vertical (táctil) todo queda en pausa hasta que se gire el dispositivo.
    if (this.needsRotate) return;
    // Estas teclas funcionan siempre, incluso durante el hit-stop o muerto.
    if (input.wasPressed('F1')) this.debug = !this.debug;
    if (input.wasPressed('KeyM')) this.sfx.toggleMute();
    // V: completos ↔ desactivados (si estaban en modo ligero automático, vuelve a completos).
    if (input.wasPressed('KeyV')) {
      if (this.fx.lite) { this.fx.lite = false; this.fx.enabled = true; } else this.fx.enabled = !this.fx.enabled;
    }
    const confirm = input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter');
    const back = input.wasPressed('Escape');

    if (this.fade) { this.updateFade(dt); return; }
    if (this.state === 'menu') { this.menu.update(); return; }
    if (this.state === 'gameover') {
      if (confirm) this.transition(() => this.newRun());
      else if (back) this.transition(() => this.openMenu());
      return;
    }
    // Panel del Top 5 (T) en la selección de máscara y en la pantalla de muerte.
    if ((this.state === 'masks' || this.state === 'dead') && input.wasPressed('KeyT')) this.showRecords = !this.showRecords;
    if (this.showRecords && back) { this.showRecords = false; return; }
    if (this.state === 'masks') {
      if (back) this.transition(() => this.openMenu());
      else if (!this.showRecords) this.updateMaskSelect();
      return;
    }
    // R es instantáneo a propósito (sin fundido): reintentar debe ser inmediato.
    if (input.wasPressed('KeyR')) { this.restartLevel(); return; }
    if (this.state === 'dead' && confirm) { this.transition(() => this.endRun(false)); return; }

    if (this.state === 'results') {
      if (confirm) this.transition(() => this.advance());
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      // Las teclas globales ya se han procesado arriba: se descartan para no repetirlas.
      for (const code of ['F1', 'KeyM', 'KeyV']) this.input.pressed.delete(code);
      return false;
    }

    this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    if (this.state === 'playing') this.time += dt;
    this.score.update(dt, this.state === 'playing');
    if (this.player.alive) this.player.update(dt, this);
    for (const e of this.enemies) if (e.alive) e.update(dt, this);

    this.updateDoors(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.particles.update(dt, this.map, (x, y, size) => this.bakeDrop(x, y, size));

    this.bullets = this.bullets.filter((b) => b.alive);
    this.pickups = this.pickups.filter((p) => p.alive);

    if (this.state === 'playing' && this.enemies.every((e) => !e.alive)) {
      this.state = 'cleared';
      this.sfx.setMusic('clear');
      this.sfx.play('clear');
    }
    if (this.state === 'cleared' && this.player.alive
      && Math.floor(this.player.x / TILE) === this.exit.tx && Math.floor(this.player.y / TILE) === this.exit.ty) {
      this.transition(() => this.finishFloor());
    }

    let tx = this.player.x, ty = this.player.y;
    if (this.player.alive) {
      // Se adelanta hacia donde apuntas, pero con tope: con la vista más cerrada el
      // jugador debe seguir siendo el centro de la acción.
      let lx, ly;
      if (this.input.touchMode) {
        // En táctil no hay ratón: se adelanta en la dirección en la que mira el jugador.
        lx = Math.cos(this.player.angle) * TOUCH_LOOKAHEAD;
        ly = Math.sin(this.player.angle) * TOUCH_LOOKAHEAD;
      } else {
        const m = this.mouseWorld();
        lx = (m.x - tx) * CAMERA_LOOKAHEAD;
        ly = (m.y - ty) * CAMERA_LOOKAHEAD;
      }
      const len = Math.hypot(lx, ly);
      if (len > MAX_LOOKAHEAD) { lx *= MAX_LOOKAHEAD / len; ly *= MAX_LOOKAHEAD / len; }
      tx += lx;
      ty += ly;
    }
    this.camera.update(dt, tx, ty);
  }

  updateDoors(dt) {
    for (const door of this.doors) {
      door.update(dt);
      if (this.player.alive && door.collide(this.player, this.map) === 'push' && door.creakCd <= 0) {
        this.playAt('creak', door.cx, door.cy);
        door.creakCd = 0.8;
      }
      for (const e of this.enemies) {
        if (!e.standing) continue;
        if (door.collide(e, this.map) === 'knock') {
          this.knockDown(e, Math.atan2(e.y - door.cy, e.x - door.cx), 'door');
        }
      }
    }
  }

  updateBullets(dt) {
    const p = this.player;
    for (const b of this.bullets) {
      b.update(dt, this.map);

      // Las puertas paran las balas.
      const t = doorHitT(this.map, b.px, b.py, b.x, b.y);
      if (t >= 0) {
        b.x = b.px + (b.x - b.px) * t;
        b.y = b.py + (b.y - b.py) * t;
        b.alive = false;
        b.hitWall = true;
      }

      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (segmentPointDistance(b.px, b.py, b.x, b.y, e.x, e.y) < e.r + b.r) {
            this.killEnemy(e, Math.atan2(b.vy, b.vx), 'bullet');
            b.alive = false;
            b.hitWall = false;
            break;
          }
        }
      } else if (p.alive && segmentPointDistance(b.px, b.py, b.x, b.y, p.x, p.y) < p.r + b.r) {
        this.killPlayer(Math.atan2(b.vy, b.vx));
        b.alive = false;
        b.hitWall = false;
      }

      if (b.hitWall) {
        const back = Math.atan2(-b.vy, -b.vx);
        this.particles.sparks(b.x, b.y, back, 6, 0.9);
        this.particles.dust(b.x, b.y, 3);
        this.playAt('ricochet', b.x, b.y);
      }
    }
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      if (p.update(dt, this.map)) {
        this.particles.dust(p.x, p.y, 3);
        this.playAt('knock', p.x, p.y, 0.3);
      }
      if (!p.flying) continue;

      // Rebote contra puertas.
      for (const door of this.doors) {
        const c = closestOnSegment(p.x, p.y, door.hx, door.hy, door.ex, door.ey);
        if (Math.hypot(p.x - c.x, p.y - c.y) < p.r + 2) {
          p.bounce();
          p.x += p.vx * dt * 2;
          p.y += p.vy * dt * 2;
        }
      }

      // Un arma lanzada derriba (no mata).
      if (!p.hurts) continue;
      for (const e of this.enemies) {
        if (e.standing && Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r + 2) {
          this.knockDown(e, Math.atan2(p.vy, p.vx), 'thrown');
          p.bounce();
          break;
        }
      }
    }
  }

  // Volumen según la distancia al jugador.
  playAt(name, x, y, volume = 1) {
    const d = Math.hypot(x - this.player.x, y - this.player.y);
    this.sfx.play(name, volume * clamp(1 - d / HEARING_DIST, 0.12, 1));
  }

  dropWeapon(e) {
    if (!e.weapon) return;
    const p = new Pickup(e.weapon.type, e.x, e.y, e.weapon.ammo);
    p.throwAt(rand(0, TAU), 120);
    this.pickups.push(p);
    e.weapon = null;
  }

  // `cause` es el estilo de la baja para la puntuación (ver STYLE en score.js).
  killEnemy(e, angle, cause = 'bullet') {
    if (!e.alive) return;
    const finisher = cause === 'finisher';
    e.alive = false;
    this.addScore(cause, e);
    this.dropWeapon(e);
    this.splatBlood(e.x, e.y, angle, finisher ? 1.4 : 1);
    this.particles.blood(e.x, e.y, angle, finisher ? 18 : 12);
    this.drawCorpse(e.x, e.y, angle, e.armed ? 'armedCorpse' : 'enemyCorpse');
    this.camera.addShake(finisher ? 8 : 6);
    this.fx.kick(finisher ? 0.6 : 0.4);
    this.hitstop = finisher ? HITSTOP.finisher : HITSTOP.kill;
    this.sfx.play('hit', finisher ? 1 : 0.85);
  }

  addScore(cause, e) {
    this.score.register(cause, e.x, e.y - 14);
    if (this.score.combo > 1) this.sfx.play('combo', 1, this.score.combo);
  }

  knockDown(e, angle, cause = 'fists') {
    if (!e.standing) return;
    e.knockDown(angle, this.map);
    this.addScore(cause, e);
    this.dropWeapon(e);
    this.particles.dust(e.x, e.y, 6);
    this.camera.addShake(3);
    this.fx.kick(0.2);
    this.hitstop = Math.max(this.hitstop, HITSTOP.knock);
    this.playAt('knock', e.x, e.y);
  }

  killPlayer(angle) {
    if (this.state !== 'playing' || !this.player.alive) return;
    const p = this.player;
    p.alive = false;
    this.state = 'dead';
    this.splatBlood(p.x, p.y, angle, 1.2);
    this.particles.blood(p.x, p.y, angle, 16);
    this.drawCorpse(p.x, p.y, angle, 'playerCorpse');
    if (p.weapon) this.pickups.push(new Pickup(p.weapon.type, p.x, p.y, p.weapon.ammo));
    this.camera.addShake(10);
    this.fx.kick(1);
    this.hitstop = HITSTOP.playerDeath;
    this.sfx.play('death');
  }

  // Patada a la puerta que haya delante del jugador. Devuelve true si había puerta.
  kickDoor(player) {
    let best = null, bestDist = Infinity;
    for (const door of this.doors) {
      if (!door.inKickRange(player.x, player.y, player.angle)) continue;
      const d = Math.hypot(door.cx - player.x, door.cy - player.y);
      if (d < bestDist) { best = door; bestDist = d; }
    }
    if (!best) return false;
    best.kick(player.x, player.y);
    this.particles.dust(best.cx, best.cy, 8);
    this.camera.addShake(3);
    this.sfx.play('kick');
    return true;
  }

  enemyShoot(e) {
    const cos = Math.cos(e.angle), sin = Math.sin(e.angle);
    let bx = e.x + cos * 14, by = e.y + sin * 14;
    if (isSolidAt(this.map, bx, by)) { bx = e.x; by = e.y; }
    const def = e.gunDef;
    const angle = e.angle + rand(-def.spread, def.spread);
    this.bullets.push(new Bullet(bx, by, angle, def.bulletSpeed, 'enemy'));
    this.particles.sparks(e.x + cos * 20, e.y + sin * 20, e.angle, def.burst > 1 ? 4 : 6, 0.45);
    this.particles.shell(e.x + cos * 6, e.y + sin * 6, e.angle + Math.PI / 2);
    this.playAt(def.sound, e.x, e.y);
    this.camera.addShake(def.burst > 1 ? 1 : 2);
  }

  makeNoise(x, y, radius) {
    for (const e of this.enemies) {
      if (e.alive && Math.hypot(e.x - x, e.y - y) < radius) e.hear(x, y);
    }
  }

  // --- Capa de sangre (media resolución: 1 píxel = 2 unidades del mundo) ---------------

  bakeDrop(x, y, size) {
    const ctx = this.bloodCtx;
    ctx.fillStyle = size > 2.2 ? COLORS.blood : '#9e0320';
    const s = size > 2.2 ? 2 : 1;
    ctx.fillRect(Math.round(x / WORLD_PX), Math.round(y / WORLD_PX), s, s);
  }

  // Charco + salpicaduras + regueros, todo en píxeles. Solo se borra al reiniciar.
  splatBlood(x, y, angle, power = 1) {
    const ctx = this.bloodCtx;
    const px = x / WORLD_PX, py = y / WORLD_PX;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.save();
    ctx.fillStyle = '#7a0218';
    pixelDisc(ctx, px + cos * 3, py + sin * 3, rand(5, 7) * power);
    ctx.fillStyle = COLORS.blood;
    pixelDisc(ctx, px + cos * 3 - 1, py + sin * 3 - 1, rand(3.5, 5) * power);
    for (let i = 0; i < 30 * power; i++) {
      const d = rand(3, 28) * power;
      const a = angle + rand(-0.55, 0.55);
      ctx.fillStyle = Math.random() < 0.3 ? '#7a0218' : COLORS.blood;
      const s = d < 12 ? 2 : 1;
      ctx.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d), s, s);
    }
    // Regueros: líneas de píxeles en la dirección del golpe.
    ctx.fillStyle = COLORS.blood;
    for (let i = 0; i < 3; i++) {
      const a = angle + rand(-0.3, 0.3);
      const len = rand(12, 32) * power;
      for (let d = 0; d < len; d++) ctx.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d), 1, 1);
    }
    ctx.restore();
  }

  // El cadáver es el sprite tumbado estampado (rotado, sin suavizado) en la capa de sangre.
  drawCorpse(x, y, angle, sprite) {
    const ctx = this.bloodCtx;
    ctx.save();
    ctx.translate(Math.round((x + Math.cos(angle) * 8) / WORLD_PX), Math.round((y + Math.sin(angle) * 8) / WORLD_PX));
    drawSprite(ctx, sprite, 0, 0, angle, { scale: 1 });
    ctx.restore();
  }

  // --- Render ---------------------------------------------------------------------------

  render() {
    const ctx = this.sceneCtx;
    const { pixelW, pixelH } = this.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);

    if (this.needsRotate) {
      this.drawRotatePrompt(ctx);
      this.fx.compose(this.ctx, this.scene, this.frameDt);
      return;
    }

    // En el menú no se dibuja el piso: el fondo synthwave lo pinta el propio menú.
    if (this.state === 'menu') {
      this.renderHud(ctx);
      this.drawFade(ctx);
      this.fx.compose(this.ctx, this.scene, this.frameDt);
      return;
    }

    this.camera.apply(ctx);
    ctx.drawImage(this.floorLayer, 0, 0, pixelW, pixelH);
    ctx.drawImage(this.bloodLayer, 0, 0, pixelW, pixelH);
    if (this.state === 'cleared') this.drawExit(ctx);
    this.particles.drawGround(ctx);
    for (const e of this.enemies) if (e.alive && e.state === 'down') e.draw(ctx, this.time, this);
    for (const p of this.pickups) p.draw(ctx, this.time);
    for (const b of this.bullets) b.draw(ctx);
    for (const e of this.enemies) if (e.standing) e.draw(ctx, this.time, this);
    if (this.player.alive) {
      this.player.drawAim(ctx, this);
      this.player.draw(ctx);
    }
    this.particles.draw(ctx);
    for (const d of this.doors) d.draw(ctx);
    // Glow neón sumado antes de las paredes: el halo se derrama sobre suelo y personajes.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this.glowLayer, 0, 0, pixelW, pixelH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.wallLayer, 0, 0, pixelW, pixelH);

    if (this.debug) this.renderDebug(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderHud(ctx);
    this.drawFade(ctx);

    this.fx.compose(this.ctx, this.scene, this.frameDt);
  }

  // Casilla de salida parpadeante + flecha alrededor del jugador apuntando hacia ella.
  drawExit(ctx) {
    const ex = this.exit;
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const x0 = ex.tx * TILE, y0 = ex.ty * TILE;
    ctx.save();
    ctx.fillStyle = COLORS.player;
    ctx.globalAlpha = blink ? 0.4 : 0.2;
    ctx.fillRect(x0, y0, TILE, TILE);
    ctx.globalAlpha = 1;
    // Marco de 1 píxel con esquinas marcadas.
    ctx.fillRect(x0, y0, TILE, WORLD_PX);
    ctx.fillRect(x0, y0 + TILE - WORLD_PX, TILE, WORLD_PX);
    ctx.fillRect(x0, y0, WORLD_PX, TILE);
    ctx.fillRect(x0 + TILE - WORLD_PX, y0, WORLD_PX, TILE);
    ctx.restore();
    drawText(ctx, 'SALIDA', ex.x, y0 - CELL_H * WORLD_PX - 2, { color: COLORS.player, scale: WORLD_PX, align: 'center' });

    const p = this.player;
    if (p.alive && Math.hypot(ex.x - p.x, ex.y - p.y) > 60) {
      const a = Math.atan2(ex.y - p.y, ex.x - p.x);
      drawSprite(ctx, 'arrow', p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, a);
    }
  }

  renderDebug(ctx) {
    for (const e of this.enemies) if (e.alive) e.drawDebug(ctx, this);
    for (const d of this.doors) d.drawDebug(ctx);
    if (this.player.alive) this.player.drawDebug(ctx);
    ctx.strokeStyle = COLORS.debug;
    ctx.lineWidth = 2;
    for (const p of this.pickups) ctx.strokeRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    for (const b of this.bullets) ctx.strokeRect(b.x - 2, b.y - 2, 4, 4);
  }

  // --- HUD (en píxeles internos, todo con la fuente bitmap) -----------------------------

  drawPopups(ctx) {
    for (const pop of this.score.popups) {
      const s = this.camera.worldToScreen(pop.x, pop.y);
      ctx.globalAlpha = Math.min(1, pop.life * 2);
      drawText(ctx, pop.text, s.x, s.y - CELL_H, { color: COLORS.text, align: 'center', shadow: COLORS.wall });
    }
    ctx.globalAlpha = 1;
  }

  // Multiplicador + barra de píxeles que se vacía: el tiempo para encadenar otra baja.
  drawComboMeter(ctx, w) {
    const s = this.score;
    if (s.comboTimer <= 0) return;
    const t = s.comboTimer / COMBO_WINDOW;
    const color = t < 0.3 ? COLORS.blood : COLORS.wall;
    drawText(ctx, `X${s.combo} COMBO`, w / 2, 4, { color: COLORS.text, scale: 2, align: 'center', shadow: color });
    const barW = 80, barX = Math.round(w / 2 - barW / 2), barY = 26;
    ctx.fillStyle = '#140a24';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
    ctx.fillStyle = 'rgba(245, 243, 255, 0.15)';
    ctx.fillRect(barX, barY, barW, 3);
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, Math.round(barW * t), 3);
  }

  drawResults(ctx, w, h) {
    const r = this.results;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.85)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const rankScale = h >= 240 ? 7 : 6;
    // Bloque completo ≈ 170 px: se centra en vertical si sobra sitio.
    const top = Math.max(6, Math.round((h - (14 + CELL_H * rankScale + 6 + 7 * 11 + 30)) / 2));
    drawText(ctx, `${this.levelName} · DESPEJADO`, cx, top, { color: COLORS.wall, align: 'center' });

    const rankColor = RANK_COLORS[r.rank];
    ctx.save();
    ctx.shadowColor = rankColor;
    ctx.shadowBlur = 12;
    // Sin sombra dura: escalada rompería la silueta de la letra; basta con el glow.
    drawText(ctx, r.rank, cx, top + 12, { color: rankColor, scale: rankScale, align: 'center', shadow: null });
    ctx.restore();

    const lines = [
      ['MÁSCARA', this.mask.name],
      ['TIEMPO', `${r.time.toFixed(2)} S (PAR ${r.par} S)`],
      ['COMBO MÁXIMO', `X${r.maxCombo}`],
      ['BONUS DE TIEMPO', `+${r.timeBonus.toLocaleString('es')}`],
      ['PUNTOS DEL PISO', r.levelScore.toLocaleString('es')],
      ['PUNTUACIÓN TOTAL', r.total.toLocaleString('es')],
      ['RÉCORD', this.bestScore.toLocaleString('es')],
    ];
    let y = top + 12 + CELL_H * rankScale + 6;
    for (const [label, value] of lines) {
      drawText(ctx, label, cx - 6, y, { color: '#9d8fb8', align: 'right' });
      drawText(ctx, value, cx + 6, y, { color: COLORS.text });
      y += 11;
    }
    y += 4;
    if (r.newRecord) {
      drawText(ctx, '¡NUEVO RÉCORD!', cx, y, { color: this.recordColor(), align: 'center' });
      y += 12;
    } else if (r.position) {
      drawText(ctx, `TOP ${MAX_ENTRIES} · PUESTO #${r.position}`, cx, y, { color: COLORS.enemy, align: 'center' });
      y += 12;
    }
    if (Math.floor(performance.now() / 400) % 2 === 0) {
      const prompt = r.last
        ? this.hint('FIN DEL EDIFICIO · ESPACIO / ENTER: VER RÉCORDS', 'FIN DEL EDIFICIO · TOCA PARA VER LOS RÉCORDS')
        : this.hint('ESPACIO / ENTER → SIGUIENTE PISO · R REPETIR', 'TOCA PARA CONTINUAR');
      drawText(ctx, prompt, cx, y, { color: COLORS.player, align: 'center' });
    }
  }

  // Récord mostrado: el mejor guardado o la partida actual si ya lo supera.
  get bestScore() {
    return Math.max(this.history.best(), this.score.total);
  }

  // Color neón alternante para los avisos de récord.
  recordColor() {
    return Math.floor(performance.now() / 180) % 2 ? COLORS.enemy : COLORS.wall;
  }

  // Tabla del Top 5 centrada en `y`. Resalta la fila de la partida `highlightId`.
  drawRecordsTable(ctx, w, y, highlightId) {
    const cols = [
      { label: '#', x: 0 }, { label: 'PUNTOS', x: 70, align: 'right' }, { label: 'PISO', x: 82 },
      { label: 'COMBO', x: 116 }, { label: 'MÁSCARA', x: 152 }, { label: 'FECHA', x: 208 },
    ];
    const tableW = 292;
    const x0 = Math.round((w - tableW) / 2);
    cols.forEach((c) => drawText(ctx, c.label, x0 + c.x, y, { color: '#9d8fb8', align: c.align || 'left' }));
    ctx.fillStyle = '#3a2a55';
    ctx.fillRect(x0, y + 10, tableW, 1);
    y += 14;
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const e = this.history.entries[i];
      const rowY = y + i * 11;
      if (!e) {
        drawText(ctx, `${i + 1}.  ---`, x0, rowY, { color: '#4a3d66' });
        continue;
      }
      const mine = e.id === highlightId;
      if (mine) {
        ctx.fillStyle = 'rgba(255, 42, 133, 0.25)';
        ctx.fillRect(x0 - 3, rowY - 1, tableW + 6, 11);
        if (Math.floor(performance.now() / 300) % 2) drawText(ctx, '>', x0 - 10, rowY, { color: COLORS.wall });
      }
      const color = mine ? COLORS.player : COLORS.text;
      const floor = e.completed ? 'FIN' : e.floor ? `${e.floor}/${LEVELS.length}` : '-';
      const values = [`${i + 1}.`, e.score.toLocaleString('es'), floor, e.date ? `X${e.combo}` : '-',
        e.maskName || '-', formatDate(e.date)];
      cols.forEach((c, k) => drawText(ctx, values[k], x0 + c.x, rowY, { color, align: c.align || 'left' }));
    }
  }

  // Fin de partida: puntuación, aviso de récord / Top 5 y la tabla completa.
  drawGameOver(ctx, w, h) {
    const s = this.runSummary;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.9)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const title = s.completed ? '¡EDIFICIO COMPLETADO!' : 'FIN DE LA PARTIDA';
    drawText(ctx, title, cx, 6, { color: s.completed ? COLORS.player : COLORS.blood, scale: this.fitScale(title, w - 12), align: 'center' });
    drawText(ctx, `${s.score.toLocaleString('es')} PTS`, cx, 28, { color: COLORS.text, scale: 2, align: 'center', shadow: COLORS.wall });

    if (s.newRecord) {
      ctx.save();
      const color = this.recordColor();
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      drawText(ctx, '¡NUEVO RÉCORD!', cx, 50, { color, scale: 2, align: 'center', shadow: null });
      ctx.restore();
      // Destellos de píxeles alrededor del aviso.
      ctx.fillStyle = COLORS.spark;
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(cx + rand(-95, 95)), Math.round(rand(48, 70)), 1, 1);
    } else if (s.position) {
      drawText(ctx, `¡ENTRAS EN EL TOP ${MAX_ENTRIES}! PUESTO #${s.position}`, cx, 54, { color: COLORS.enemy, align: 'center' });
    } else {
      drawText(ctx, `NO ENTRA EN EL TOP ${MAX_ENTRIES}`, cx, 54, { color: '#7d6f98', align: 'center' });
    }

    drawText(ctx, 'MEJORES PARTIDAS', cx, 78, { color: COLORS.wall, align: 'center' });
    this.drawRecordsTable(ctx, w, 92, this.runId);
    if (Math.floor(performance.now() / 400) % 2 === 0) {
      // En táctil esta zona la ocupan los botones NUEVA PARTIDA / MENÚ.
      if (!this.input.touchMode) drawText(ctx, 'ESPACIO / ENTER: NUEVA PARTIDA · ESC: MENÚ', cx, h - 14, { color: COLORS.player, align: 'center' });
    }
  }

  // Panel del Top 5 que se abre con T (selección de máscara y pantalla de muerte).
  drawRecordsOverlay(ctx, w, h) {
    ctx.fillStyle = 'rgba(13, 2, 33, 0.92)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const top = Math.max(10, Math.round(h / 2 - 60));
    drawText(ctx, 'MEJORES PARTIDAS', cx, top, { color: COLORS.wall, scale: 2, align: 'center' });
    if (!this.history.entries.length) drawText(ctx, 'TODAVÍA NO HAY PARTIDAS GUARDADAS', cx, top + 26, { color: '#7d6f98', align: 'center' });
    this.drawRecordsTable(ctx, w, top + 38, this.runId);
    if (!this.input.touchMode) drawText(ctx, 'T / ESC: CERRAR', cx, top + 38 + 14 + MAX_ENTRIES * 11 + 10, { color: COLORS.player, align: 'center' });
  }

  // Pantalla de selección: tarjetas con el icono de cada máscara, la elegida resaltada en neón
  // y la descripción de su pasiva debajo. El piso se ve atenuado al fondo.
  drawMaskSelect(ctx, w, h) {
    ctx.fillStyle = 'rgba(13, 2, 33, 0.82)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const title = 'ELIGE TU MÁSCARA';
    drawText(ctx, title, cx, 6, { color: COLORS.wall, scale: this.fitScale(title, w - 12), align: 'center' });
    drawText(ctx, `PRÓXIMO: ${this.levelName}`, cx, 24, { color: '#9d8fb8', align: 'center' });

    const { cards, iconScale, bottom } = this.maskLayout();
    const bob = Math.floor(performance.now() / 300) % 2;
    MASKS.forEach((mask, i) => {
      const c = cards[i];
      const sel = i === this.maskIndex;
      const y = c.y - (sel ? bob : 0);
      ctx.save();
      if (sel) { ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 10; }
      ctx.fillStyle = sel ? COLORS.wall : '#3a2a55';
      ctx.fillRect(c.x, y, c.w, c.h);
      ctx.restore();
      ctx.fillStyle = sel ? '#2a0d3a' : '#1a0d2e';
      ctx.fillRect(c.x + 1, y + 1, c.w - 2, c.h - 2);
      const size = 12 * iconScale;
      ctx.globalAlpha = sel ? 1 : 0.55;
      ctx.drawImage(maskIcon(mask), Math.round(c.x + (c.w - size) / 2), y + 6, size, size);
      ctx.globalAlpha = 1;
      drawText(ctx, mask.name, c.x + c.w / 2, y + 10 + size, { color: sel ? COLORS.text : '#7d6f98', align: 'center' });
    });

    const mask = MASKS[this.maskIndex];
    let y = bottom + 8;
    drawText(ctx, mask.name, cx, y, { color: COLORS.player, scale: 2, align: 'center' });
    y += 22;
    for (const line of mask.passive) {
      drawText(ctx, line, cx, y, { color: COLORS.text, align: 'center' });
      y += 11;
    }
    if (Math.floor(performance.now() / 400) % 2 === 0) {
      drawText(ctx, this.hint('FLECHAS / RATÓN: ELEGIR · ESPACIO / ENTER: EMPEZAR', 'TOCA UNA MÁSCARA: ELEGIR · OTRA VEZ: EMPEZAR'),
        cx, h - 14 - this.safe.b, { color: COLORS.player, align: 'center' });
    }
    // En táctil, VOLVER y RÉCORDS son botones (arriba).
    if (!this.input.touchMode) drawText(ctx, 'T: MEJORES PARTIDAS · ESC: MENÚ', cx, h - 26, { color: '#7d6f98', align: 'center' });
  }

  // Escala de texto más grande (hasta `preferred`) con la que el texto cabe en `maxW`.
  fitScale(text, maxW, preferred = 2) {
    let s = preferred;
    while (s > 1 && measureText(text) * s > maxW) s--;
    return s;
  }

  // Pantalla "gira el dispositivo": un móvil pixelado que alterna vertical/horizontal.
  drawRotatePrompt(ctx) {
    const w = this.scene.width, h = this.scene.height;
    const cx = Math.round(w / 2), cy = Math.round(h / 2) - 20;
    const landscape = Math.floor(performance.now() / 700) % 2 === 1;
    const pw = landscape ? 44 : 24, ph = landscape ? 24 : 44;
    const x = cx - pw / 2, y = cy - ph / 2;
    ctx.fillStyle = landscape ? COLORS.player : COLORS.wall;
    ctx.fillRect(x, y, pw, ph);
    ctx.fillStyle = '#140a24';
    ctx.fillRect(x + 2, y + 2, pw - 4, ph - 4);
    ctx.fillStyle = landscape ? COLORS.player : COLORS.wall;
    if (landscape) ctx.fillRect(x + pw - 4, cy - 2, 1, 4); else ctx.fillRect(cx - 2, y + ph - 4, 4, 1);
    const title = 'GIRA EL DISPOSITIVO';
    drawText(ctx, title, cx, cy + 32, { color: COLORS.wall, scale: this.fitScale(title, w - 12), align: 'center' });
    drawText(ctx, 'NEON RUSH SE JUEGA EN HORIZONTAL', cx, cy + 56, { color: '#9d8fb8', align: 'center' });
  }

  // Mira de píxeles con contorno oscuro (el cursor del sistema está oculto por CSS).
  // En táctil no hay puntero que seguir: no se dibuja.
  drawCrosshair(ctx) {
    if (this.input.touchMode) return;
    const m = this.mouseInternal();
    const x = Math.round(m.x), y = Math.round(m.y);
    const arms = [[-5, 0, 3, 1], [3, 0, 3, 1], [0, -5, 1, 3], [0, 3, 1, 3]];
    ctx.fillStyle = '#140a24';
    for (const [dx, dy, w, h] of arms) ctx.fillRect(x + dx - 1, y + dy - 1, w + 2, h + 2);
    ctx.fillStyle = COLORS.player;
    for (const [dx, dy, w, h] of arms) ctx.fillRect(x + dx, y + dy, w, h);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(x, y, 1, 1);
  }

  renderHud(ctx) {
    const w = this.scene.width, h = this.scene.height;
    const p = this.player;
    if (this.state === 'menu') {
      this.menu.draw(ctx, w, h);
      this.drawToast(ctx);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'masks') {
      this.drawMaskSelect(ctx, w, h);
      if (this.showRecords) this.drawRecordsOverlay(ctx, w, h);
      this.touch.drawScreenButtons(ctx);
      this.drawToast(ctx);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'gameover') {
      this.drawGameOver(ctx, w, h);
      this.touch.drawScreenButtons(ctx);
      this.drawCrosshair(ctx);
      return;
    }
    this.drawPopups(ctx);

    // Márgenes del HUD: separación fija + zona segura (muesca / esquinas redondeadas).
    const L = 6 + this.safe.l, R = w - 6 - this.safe.r, T = this.safe.t;
    const def = p.def;
    let weaponText = def.name;
    if (p.weapon && def.maxAmmo) weaponText += `  ${p.weapon.ammo}/${def.maxAmmo}`;
    drawText(ctx, weaponText, L, 4 + T, { color: COLORS.player, scale: 2 });
    // Miniatura de la máscara equipada (12×12 a ×2) con su nombre.
    ctx.fillStyle = '#140a24';
    ctx.fillRect(L - 1, 24 + T, 26, 26);
    ctx.drawImage(maskIcon(this.mask), L, 25 + T, 24, 24);
    drawText(ctx, this.mask.name, L + 28, 25 + T, { color: '#9d8fb8' });
    if (p.noAmmoFlash > 0) drawText(ctx, 'SIN MUNICIÓN', L + 28, 37 + T, { color: COLORS.blood });

    const alive = this.enemies.filter((e) => e.alive).length;
    drawText(ctx, `ENEMIGOS ${alive}/${this.enemies.length}`, R, 4 + T, { color: COLORS.enemy, align: 'right' });
    drawText(ctx, `${this.score.total.toLocaleString('es')} PTS`, R, 15 + T, { color: COLORS.text, scale: 2, align: 'right', shadow: COLORS.wall });
    drawText(ctx, `RÉCORD ${this.bestScore.toLocaleString('es')}`, R, 36 + T, { color: this.score.isRecord ? COLORS.enemy : '#9d8fb8', align: 'right' });
    drawText(ctx, this.levelName, R, 47 + T, { color: '#9d8fb8', align: 'right' });
    const flags = [this.sfx.muted && 'SONIDO OFF', !this.fx.enabled && 'EFECTOS OFF', this.fx.enabled && this.fx.lite && 'EFECTOS LIGEROS']
      .filter(Boolean).join(' · ');
    if (flags) drawText(ctx, flags, R, 58 + T, { color: '#9d8fb8', align: 'right' });

    this.drawComboMeter(ctx, w);

    // En táctil esa zona es de los joysticks: la ayuda de teclado no se muestra.
    if (!this.input.touchMode) {
      drawText(ctx, 'WASD MOVER · CLIC IZQ ATACAR · CLIC DER RECOGER/LANZAR', 6, h - 24, { color: '#7d6f98' });
      drawText(ctx, 'E PATADA · R REINICIAR · F1 DEBUG · M SONIDO · V EFECTOS', 6, h - 13, { color: '#7d6f98' });
    }

    if (this.debug) {
      drawText(ctx, `DEBUG · ${this.fps} FPS · BALAS ${this.bullets.length} · PART ${this.particles.list.length} · CASQ ${this.particles.shells.length}`, L, 54 + T, { color: COLORS.debug });
      drawText(ctx, `ESCENA ${w}X${h} · ESCALA ${this.view.scale} · MÁSCARA ${this.mask.id}`, L, 65 + T, { color: COLORS.debug });
    }

    const cx = Math.round(w / 2);
    if (this.bannerTimer > 0 && this.state === 'playing') {
      ctx.globalAlpha = Math.min(1, this.bannerTimer);
      drawText(ctx, this.levelName, cx, Math.round(h * 0.28), { color: COLORS.wall, scale: this.fitScale(this.levelName, w - 12), align: 'center' });
      ctx.globalAlpha = 1;
    }
    if (this.state === 'cleared' && Math.floor(performance.now() / 300) % 3 !== 0) {
      const msg = '¡PISO DESPEJADO! VE A LA SALIDA';
      // Debajo del bloque de puntuación (termina en y≈67) para no solaparse con él.
      drawText(ctx, msg, cx, 72 + T, { color: COLORS.player, scale: this.fitScale(msg, w - 12), align: 'center' });
    }
    if (this.state === 'dead') {
      // En táctil la franja crece para alojar los botones REINTENTAR / TERMINAR / RÉCORDS.
      const touch = this.input.touchMode;
      const bandH = touch ? 26 + 8 + this.touch.buttonSize('X').h + 8 : 52;
      ctx.fillStyle = 'rgba(13, 2, 33, 0.6)';
      ctx.fillRect(0, Math.round(h / 2) - 26, w, bandH);
      drawText(ctx, 'HAS MUERTO', cx, Math.round(h / 2) - 22, { color: COLORS.blood, scale: this.fitScale('HAS MUERTO', w - 12, 3), align: 'center' });
      if (!touch) drawText(ctx, 'R REINTENTAR PISO · ENTER TERMINAR PARTIDA · T RÉCORDS', cx, Math.round(h / 2) + 10, { color: COLORS.text, align: 'center' });
      if (this.showRecords) this.drawRecordsOverlay(ctx, w, h);
      this.touch.drawScreenButtons(ctx);
    }
    this.touch.draw(ctx);
    if (this.state === 'results') this.drawResults(ctx, w, h);
    this.drawToast(ctx);

    this.drawCrosshair(ctx);
  }
}
