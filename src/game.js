import { Input } from './input.js';
import { LEVELS, TILE, loadLevel, isSolidAt, isStructuralWall, castRay, doorHitT } from './map.js';
import { renderFloor, renderWalls, renderProps } from './decor.js';
import { Score, COMBO_WINDOW } from './score.js';
import { MASKS, maskEffects, maskIcon } from './masks.js';
import { ScoreHistory, FloorStats, MAX_ENTRIES, newRunId, formatDate } from './scores-history.js';
import { Menu } from './menu.js';
import { TouchControls } from './touch.js';
import { Settings } from './settings.js';
import { Boss, drawBossBar } from './boss.js';
import { buildOptionsMenu, buildPauseMenu } from './options-menu.js';
import { Player, bloodLevelFor, FINISH_RANGE } from './player.js';
import { Enemy } from './enemy.js';
import { Door, ENEMY_PUSH_SPEED } from './doors.js';
import { Pickup, Bullet, ENEMY_WEAPONS, segmentPointDistance } from './weapons.js';
import { Particles, Footprints, GIB_COLORS } from './particles.js';
import { Sfx } from './audio.js';
import { ScreenFx } from './effects.js';
import { drawSprite, pixelDisc, pixelRect, BLOOD_LEVELS, WORLD_PX } from './sprites.js';
import { drawText, measureText, CELL_H } from './pixelfont.js';
import { COLORS, TAU, rand, clamp, angleDiff, closestOnSegment, seededRandom, hashString } from './utils.js';

const STEP = 1 / 60;       // paso fijo de simulación (60 FPS)
const MAX_FRAME = 0.25;    // evita la "espiral de la muerte" tras cambiar de pestaña
const CAMERA_LERP = 8;
const CAMERA_LOOKAHEAD = 0.2;   // fracción de la distancia al ratón que la cámara se adelanta
const MAX_LOOKAHEAD = 70;       // tope en unidades del mundo: el jugador nunca se va al borde
const MAX_SHAKE = 16;
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

// Hit-stop: segundos que se congela la simulación en cada tipo de impacto. Las bajas cuerpo a
// cuerpo y los remates (40-60 ms) se notan más que un disparo.
// Forcejeo (ver enemyStrike): zoom de cámara, empuje por pulsación, fuerza base del enemigo (barra/s), endurecimiento
// por forcejeo en el piso, tope y tiempo máximo.
const SCUFFLE = { zoom: 2, push: 0.1, base: 0.33, fatigue: 0.22, maxMult: 2.2, timeout: 7.5 };
const HITSTOP = { kill: 0.05, melee: 0.055, execution: 0.07, knock: 0.035, doorKnock: 0.07, playerDeath: 0.12 };
// Cómo se siente cada tipo de baja: `power` = cantidad de sangre y restos, `wide` = semiapertura
// del salpicado (rad; π = en todas direcciones), `shake` = sacudida de cámara, `stop` = hit-stop
// y `fx` = patada del CRT. Un disparo sale en cono estrecho; la melé abre el arco; el remate
// revienta en todas direcciones.
const KILL_FEEL = {
  bullet: { power: 1, wide: 0.55, shake: 7, stop: HITSTOP.kill, fx: 0.45 },
  melee: { power: 1.35, wide: 0.9, shake: 10, stop: HITSTOP.melee, fx: 0.65 },
  // Ejecución de un derribado: el charco más grande, el salpicado más abierto y la sacudida más
  // fuerte del juego. Hacia donde va el golpe (de jugador a enemigo) sale lo más denso.
  execution: { power: 2.2, wide: 1.3, shake: 14, stop: HITSTOP.execution, fx: 1 },
};
// Llegada y fuga en moto (cinemáticas, en segundos).
const BIKE_START_X = -64;       // la moto entra desde fuera de la pantalla, por la izquierda
const ARRIVE_RIDE = 1.9;        // lo que tarda en llegar y frenar en su plaza
const ARRIVE_DISMOUNT = 0.55;   // el jugador baja y se coloca en la acera
const LEAVE_BOARD = 0.4;        // el jugador se sube a la moto
const LEAVE_RIDE = 1.35;        // la moto acelera hasta salir de la pantalla
const MOUNT_MARGIN = 18;        // a esta distancia del borde de la moto se monta
const CINE_BAR = 14;            // alto (px internos) de las barras de cine
const lerp = (a, b, t) => a + (b - a) * t;
const CORPSE_STEP_RADIUS = 14;  // a esta distancia del centro de un cadáver ya lo pisas
const MAX_POOLS = 60;           // charcos de baja que se recuerdan para las suelas
const INTRO_BANNER_TIME = 2.2;
const FADE_TIME = 0.25;        // segundos de cada mitad del fundido (salida y entrada)
const RANK_COLORS = { S: COLORS.player, A: COLORS.weapon, B: COLORS.enemy, C: COLORS.blood };

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.base = 1 / WORLD_PX;  // 1 píxel interno = 2 unidades del mundo
    this.mul = 1;              // zoom dinámico (forcejeo: ×2); se acerca a `mulTarget` suavemente
    this.mulTarget = 1;
    this.shake = 0;
    this.ox = 0;
    this.oy = 0;
    this.viewW = 1;
    this.viewH = 1;
  }

  get zoom() { return this.base * this.mul; }

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
    this.mul += (this.mulTarget - this.mul) * (1 - Math.exp(-9 * dt));
    if (Math.abs(this.mulTarget - this.mul) < 0.003) this.mul = this.mulTarget;
    const t = this.clampTarget(tx, ty);
    const k = 1 - Math.exp(-(this.mulTarget > 1 ? 16 : CAMERA_LERP) * dt);
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
    this.prints = new Footprints(); // huellas de sangre (se desvanecen; ver Footprints)
    this.pools = [];                // charcos de baja: { x, y, r } en unidades del mundo
    this.sfx = new Sfx();
    this.fx = new ScreenFx();
    this.history = new ScoreHistory();
    this.score = new Score(this.history.best());
    // Sangre del personaje: se acumula con las bajas DEL PISO. Al reintentar con R se conserva (el
    // jugador reaparece como murió); al pasar de piso (`goToLevel`) y al empezar partida empieza limpia.
    this.gore = 0;
    // Edificio: el piso empieza en la calle. Al cruzar el umbral (`inside`) se bloquea la puerta
    // principal hasta despejarlo; `entered` y `entryWeapon` recuerdan ese momento para que R
    // reaparezca dentro, sin repetir la llegada.
    this.inside = false;
    this.entered = false;
    this.entryWeapon = null;
    this.cine = null;      // cinemática en curso: { kind: 'arrive' | 'leave', t }
    this.callout = null;   // aviso grande temporal: { text, color, t, max, sub }
    this.scuffle = null;   // forcejeo en curso: { e, bar, t, mult, ... } (estado 'scuffle')
    this.scuffleCount = 0; // forcejeos de este piso: cada uno endurece al enemigo (se conserva con R)
    this.scuffleGrace = 0; // s de inmunidad al cuerpo a cuerpo tras un forcejeo
    this.scuffleI = 0;     // 0..1: intensidad del filtro "VS" (suaviza la entrada y la salida)
    this.goalAge = 0;      // s desde que el cartel de piso completado se apagó (anima el objetivo)
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
    this.settings = new Settings(this); // ajustes guardados (settings.js); `applyAll` los aplica al final del constructor
    this.panel = null;   // menú modal abierto (OPCIONES / PAUSA, options-menu.js): congela el juego
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
    this.settings.applyAll();
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
    this.scuffleCount = 0;
    this.gore = 0; // el siguiente piso se empieza limpio: ropa y máscara sin sangre
    this.entered = false;
    this.entryWeapon = null;
    this.reset({ arrival: true });
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
    this.reset({ arrival: true });
    this.beginArrival();
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
    if (!this.input.touchMode || this.fade || this.panel) return [];
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
    if (this.state !== 'menu' || this.menu.screen !== 'title' || this.fade || this.panel) return;
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

  // Crea el enemigo de una casilla del mapa según su tipo (ver ENEMY_CHARS en map.js).
  makeEnemy(e) {
    if (e.kind === 'boss') return new Boss(e.x, e.y);
    const weapon = e.weapon ? { type: e.weapon, ammo: ENEMY_WEAPONS[e.weapon].dropAmmo } : null;
    return new Enemy(e.x, e.y, e.patrol, weapon, e.kind);
  }

  // --- Menús modales (options-menu.js): OPCIONES y PAUSA -------------------------------------
  openOptions(onBack = () => this.closePanel()) {
    this.panel = buildOptionsMenu(this, onBack);
  }

  openPause() {
    this.panel = buildPauseMenu(this);
  }

  closePanel() {
    this.panel = null;
    this.player.cooldown = Math.max(this.player.cooldown, 0.25); // que el toque de cerrar no se vuelva un golpe
  }

  drawPanel(ctx, w, h) {
    if (this.panel) this.panel.draw(ctx, w, h);
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
    this.sfx.setMusic('menu');
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
    this.gore = 0;
    this.scuffleCount = 0;
    this.levelIndex = index;
    this.entered = false;
    this.entryWeapon = null;
    this.reset({ arrival: true });
    this.openMaskSelect();
  }

  openMenu(screen = 'title') {
    this.state = 'menu';
    this.showRecords = false;
    this.menu.open(screen);
    this.sfx.setMusic('menu');
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

  // Reconstruye el piso. Tres casos:
  //  - `arrival: true`: el piso desde el principio (la selección de máscara y `confirmMask`, que
  //    después llama a `beginArrival`): el jugador en la acera, sin máscara, y la moto aparcada.
  //  - Reintento (R) tras haber entrado: reaparece justo dentro, con la máscara puesta, el arma con
  //    la que cruzó el umbral y la puerta ya bloqueada. R no repite la llegada: tiene que ser instantáneo.
  //  - Reintento sin haber entrado todavía: otra vez en la acera, sin cinemática.
  reset({ arrival = false } = {}) {
    // Armas aleatorias con semilla por partida y piso: al reintentar (R) todo sigue en su sitio;
    // en una partida nueva cambian.
    this.sfx.stopMoto(0.05); // R, piso nuevo...: si la moto sonaba, se corta limpia
    const level = loadLevel(this.levelIndex, seededRandom(hashString(`${this.runId}:${this.levelIndex}`)));
    this.levelName = level.name;
    this.strobe = level.strobe;   // el club: luces estroboscópicas (opción `strobeEnabled`)
    this.hasBoss = level.boss;
    this.par = level.par;
    this.map = level.map;
    const retryInside = !arrival && this.entered;
    const start = retryInside ? level.entry : level.player;
    this.player = new Player(start.x, start.y, maskEffects(this.mask), this.mask.id, retryInside);
    this.player.angle = -Math.PI / 2; // mira al edificio
    if (retryInside) this.player.weapon = this.entryWeapon ? { ...this.entryWeapon } : null;
    this.player.bloodLevel = this.goreOn ? bloodLevelFor(this.gore) : 0;
    this.spawn = { x: level.player.x, y: level.player.y }; // la acera, junto a la moto
    this.entry = level.entry;
    this.bike = { park: { x: level.bike.x, y: level.bike.y }, w: level.bike.w, h: level.bike.h, x: level.bike.x, y: level.bike.y, riding: false };
    this.inside = retryInside;
    this.cine = null;
    this.callout = null;
    this.goalAge = 0;
    this.scuffle = null;      // si se reinicia en pleno forcejeo: cámara y audio vuelven a la normalidad
    this.scuffleGrace = 0;
    this.camera.mul = this.camera.mulTarget = 1;
    this.sfx.setSlowMo(false);
    this.enemies = level.enemies.map((e) => this.makeEnemy(e));
    this.pickups = level.weapons.map((w) => new Pickup(w.type, w.x, w.y));
    this.doors = level.doors.map((d) => new Door(d.tx, d.ty, d.horizontal, d.main));
    this.mainDoor = this.doors.find((d) => d.main);
    if (retryInside) this.mainDoor.locked = true;
    this.map.doors = this.doors;
    this.bullets = [];
    this.particles.clear();
    this.prints.clear();
    this.pools = [];
    // masks (selección) | arriving (llega en moto) | playing (fuera o dentro: ver `inside`) | dead |
    // cleared (despejado: vuelve a la moto) | leaving (se sube y se va) | results
    this.state = 'playing';
    this.time = 0;
    this.hitstop = 0;
    this.results = null;
    this.showRecords = false;
    this.bannerTimer = INTRO_BANNER_TIME;
    this.sfx.setMusic(retryInside ? 'action' : 'menu'); // la música de combate empieza al entrar

    // Las capas estáticas solo se regeneran al cambiar de piso.
    if (this.layersLevel !== this.levelIndex) {
      this.layersLevel = this.levelIndex;
      this.floorLayer = renderFloor(this.map);
      const { walls, glow } = renderWalls(this.map);
      this.wallLayer = walls;
      this.glowLayer = glow;
      this.propsLayer = renderProps(this.map); // muebles sólidos
      // Sangre a media resolución: 1 píxel de la capa = 1 píxel interno en pantalla.
      this.bloodLayer = document.createElement('canvas');
      this.bloodLayer.width = this.map.pixelW / WORLD_PX;
      this.bloodLayer.height = this.map.pixelH / WORLD_PX;
      this.bloodCtx = this.bloodLayer.getContext('2d');
      this.bloodCtx.imageSmoothingEnabled = false;
      // Sangre sobre las paredes: se dibuja DESPUÉS de las paredes (la capa de sangre del suelo
      // queda debajo de ellas).
      this.wallBloodLayer = document.createElement('canvas');
      this.wallBloodLayer.width = this.bloodLayer.width;
      this.wallBloodLayer.height = this.bloodLayer.height;
      this.wallBloodCtx = this.wallBloodLayer.getContext('2d');
      this.wallBloodCtx.imageSmoothingEnabled = false;
    }
    this.bloodCtx.clearRect(0, 0, this.bloodLayer.width, this.bloodLayer.height);
    this.wallBloodCtx.clearRect(0, 0, this.wallBloodLayer.width, this.wallBloodLayer.height);
    this.wallBloodDirty = false; // hasta la primera mancha en pared ni se dibuja la capa
    this.stains = 0;             // salpicaduras permanentes de este piso (se ve en F1)
    this.camera.setBounds(this.map.pixelW, this.map.pixelH);
    this.camera.snap(this.player.x, this.player.y);
  }

  update(dt) {
    const input = this.input;
    // Primero los controles táctiles: traducen los dedos a teclas/clics que se leen abajo.
    this.touch.update(dt);
    // Filtro VS: entra y sale con suavidad (también al resolverse el forcejeo o reiniciar).
    this.scuffleI += ((this.state === 'scuffle' ? 1 : 0) - this.scuffleI) * (1 - Math.exp(-9 * dt));
    if (this.scuffleI < 0.005) this.scuffleI = 0;
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
    // Menú modal abierto (OPCIONES / PAUSA): el juego está congelado y solo él lee la entrada.
    if (this.panel) { this.panel.update(); return; }
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
    // Esc (o el icono de pausa en táctil): PAUSA. Solo con el piso en juego, fuera o dentro del edificio.
    if ((this.state === 'playing' || this.state === 'cleared') && back) { this.openPause(); return; }
    // R es instantáneo a propósito (sin fundido): reintentar debe ser inmediato.
    if (input.wasPressed('KeyR')) { this.restartLevel(); return; }
    if (this.state === 'dead' && confirm) { this.transition(() => this.endRun(false)); return; }

    if (this.state === 'results') {
      if (confirm) this.transition(() => this.advance());
      return;
    }

    if (this.state === 'scuffle') { this.updateScuffle(dt); return; }

    if (this.state === 'arriving' || this.state === 'leaving') {
      this.updateCine(dt, confirm || input.mousePressed.left);
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      // Las teclas globales ya se han procesado arriba: se descartan para no repetirlas.
      for (const code of ['F1', 'KeyM', 'KeyV']) this.input.pressed.delete(code);
      return false;
    }

    this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    this.scuffleGrace = Math.max(0, this.scuffleGrace - dt);
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    this.goalAge = this.state === 'cleared' && !this.callout ? this.goalAge + dt : 0;
    if (this.state === 'playing' && this.inside) this.time += dt; // el reloj corre dentro del edificio
    this.score.update(dt, this.state === 'playing');
    if (this.player.alive) this.player.update(dt, this);
    for (const e of this.enemies) if (e.alive) e.update(dt, this);

    this.updateDoors(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.particles.update(dt, this.map, (kind, p) => this.bake(kind, p));
    this.prints.update(dt);

    this.bullets = this.bullets.filter((b) => b.alive);
    this.pickups = this.pickups.filter((p) => p.alive);

    // Cruzar el umbral (dos casillas dentro de la puerta principal, ya fuera del barrido de la hoja)
    // activa el combate: no hay salida hasta despejar el edificio.
    if (this.state === 'playing' && !this.inside && this.player.alive && this.player.y < this.entry.lockY) this.beginLockdown();
    if (this.state === 'playing' && this.inside && this.enemies.every((e) => !e.alive)) {
      this.state = 'cleared';
      // Se acabó la adrenalina: `setMusic('empty')` corta la música con el frenazo de cinta y
      // abre el ambiente del edificio vacío, que acompaña hasta la moto. La puerta se desbloquea.
      this.sfx.setMusic('empty');
      this.mainDoor.unlock();
      this.sfx.play('unlock');
      this.showCallout('PISO COMPLETADO', COLORS.player, 2.8, '¡EDIFICIO LIMPIO!'); // el objetivo (REGRESA A LA MOTO) sale al apagarse
    }
    if (this.state === 'cleared' && this.player.alive && this.touchingBike()) this.startLeaving();

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

  // --- Llegada, bloqueo y fuga en moto ------------------------------------------------------------
  // Flujo del piso: masks → arriving (llega en moto) → playing fuera → cruza el umbral y el edificio
  // se bloquea (`inside`) → despeja → cleared (la puerta se abre) → vuelve a la moto → leaving → results.

  // La moto entra desde la izquierda con el jugador encima, frena en su plaza y él baja a la acera.
  beginArrival() {
    const b = this.bike, p = this.player;
    this.state = 'arriving';
    this.cine = { kind: 'arrive', t: 0 };
    b.x = BIKE_START_X;
    b.y = b.park.y;
    b.riding = true;
    p.x = b.x - 4;
    p.y = b.y;
    p.angle = 0;
    this.camera.snap(b.x, b.y);
    this.sfx.playMotoArrival({ ride: ARRIVE_RIDE, dismount: ARRIVE_DISMOUNT });
  }

  // Las dos cinemáticas. `skip` (Espacio/Enter/clic/toque) las salta. La cámara sigue a la moto
  // mientras va montada y al jugador el resto del tiempo.
  updateCine(dt, skip) {
    const c = this.cine, b = this.bike, p = this.player;
    c.t += dt;
    if (c.kind === 'arrive') {
      const end = ARRIVE_RIDE + ARRIVE_DISMOUNT;
      if (skip && c.t < end) {
        this.sfx.stopMoto(0.12);
        c.t = end;
      }
      if (c.t < ARRIVE_RIDE) {
        const k = 1 - Math.pow(1 - c.t / ARRIVE_RIDE, 3); // frena suave al llegar
        b.x = lerp(BIKE_START_X, b.park.x, k);
        p.x = b.x - 4;
        p.y = b.y;
        if (k < 0.92 && Math.random() < 0.5) this.particles.dust(b.x - 24, b.y + rand(-4, 4), 1);
      } else if (c.t < end) {
        const k = (c.t - ARRIVE_RIDE) / ARRIVE_DISMOUNT, e = k * k * (3 - 2 * k);
        b.x = b.park.x;
        b.riding = false;
        p.x = lerp(b.park.x - 4, this.spawn.x, e);
        p.y = lerp(b.park.y, this.spawn.y, e);
        p.angle = (-Math.PI / 2) * e;
      } else {
        b.x = b.park.x;
        b.riding = false;
        p.x = this.spawn.x;
        p.y = this.spawn.y;
        p.angle = -Math.PI / 2;
        this.cine = null;
        this.state = 'playing';
        this.bannerTimer = INTRO_BANNER_TIME;
      }
    } else {
      if (skip) {
        this.sfx.stopMoto(0.2); // sin esperar a que se aleje: directo a resultados
        this.finishLeaving();
        return;
      }
      if (c.t < LEAVE_BOARD) {
        const k = c.t / LEAVE_BOARD, e = k * k * (3 - 2 * k);
        p.x = lerp(c.from.x, b.park.x - 4, e);
        p.y = lerp(c.from.y, b.park.y, e);
        p.angle = c.from.angle + angleDiff(0, c.from.angle) * e;
      } else {
        const t2 = c.t - LEAVE_BOARD;
        const accel = (2 * (this.map.pixelW + 120 - b.park.x)) / (LEAVE_RIDE * LEAVE_RIDE);
        b.riding = true;
        b.x = b.park.x + 0.5 * accel * t2 * t2;
        p.x = b.x - 4;
        p.y = b.y;
        p.angle = 0;
        if (Math.random() < 0.6) this.particles.dust(b.x - 24, b.y + rand(-4, 4), 1);
        if (t2 >= LEAVE_RIDE) { this.finishLeaving(); return; }
      }
    }
    const follow = b.riding ? b : p;
    this.camera.update(dt, follow.x, follow.y);
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
  }

  // ¿Toca el jugador la moto? Se monta al rozar su borde (es un mueble sólido: no se la puede pisar).
  touchingBike() {
    const b = this.bike, p = this.player;
    return Math.abs(p.x - b.park.x) < b.w / 2 + p.r + MOUNT_MARGIN && Math.abs(p.y - b.park.y) < b.h / 2 + p.r + MOUNT_MARGIN;
  }

  // --- Forcejeo cuerpo a cuerpo ("estilo VS") -----------------------------------------------------
  // El golpe de un enemigo cuerpo a cuerpo (grunt o corredor) que te alcanza DE FRENTE (dentro de ~100° de
  // hacia donde miras) ya no mata: empieza un forcejeo. Por la espalda, o si estás rematando, sigue siendo
  // letal. El mundo se congela, la cámara hace zoom ×2 sobre los dos y la música baja de tono y velocidad
  // (cinta que se frena). Hay que aporrear ATACAR (clic, Espacio, E, Enter o tocar el botón / el joystick)
  // para empujar la barra; el enemigo la empuja de vuelta con una fuerza que sube con cada forcejeo del piso
  // (+22 % cada uno, tope ×2,2) y con picos periódicos. Barra llena: contraataque brutal (remate). Barra a 0
  // o 7,5 s sin llegar a la mitad: te ejecuta (estado 'dead', R reintenta).
  enemyStrike(e, angle) {
    const p = this.player;
    if (this.state !== 'playing' || !p.alive) return;
    if (this.scuffleGrace > 0) { e.attackCd = 0.4; return; } // acaba de forcejear: ese golpe no cuenta
    const frontal = Math.abs(angleDiff(angle + Math.PI, p.angle)) < 1.75;
    if (frontal && !p.exec && (e.kind === 'grunt' || e.kind === 'runner')) this.startScuffle(e, angle);
    else this.killPlayer(angle);
  }

  startScuffle(e, angle) {
    const p = this.player;
    this.scuffleCount++;
    const mult = Math.min(SCUFFLE.maxMult, 1 + SCUFFLE.fatigue * (this.scuffleCount - 1));
    this.scuffle = { e, angle, bar: 0.5, t: 0, mult, surge: 0, nextSurge: 1.0, presses: 0, shake: 0 };
    this.state = 'scuffle';
    p.angle = angle + Math.PI; // se miran a la cara
    p.swing = 0; p.moving = false;
    e.angle = angle; e.windup = 0; e.aim = 0;
    this.camera.mulTarget = SCUFFLE.zoom;
    this.sfx.setSlowMo(true);
    this.sfx.play('scuffleIn');
    this.camera.addShake(10);
    this.fx.kick(1);
    this.hitstop = 0;
    this.touch.haptic([20, 30, 40]);
  }

  updateScuffle(dt) {
    const sc = this.scuffle, p = this.player, e = sc.e, input = this.input;
    if (!sc || !e.alive || !p.alive) { this.endScuffle(); return; }
    sc.t += dt;
    // Pulsaciones nuevas este paso (flancos, no mantener): el botón/clic de ataque o sus equivalentes.
    let n = 0;
    if (input.tapAttack) n++;
    if (input.mousePressed.left) n++;
    for (const k of ['Space', 'KeyE', 'Enter']) if (input.wasPressed(k)) n++;
    if (n) {
      sc.bar = Math.min(1, sc.bar + n * SCUFFLE.push);
      sc.presses += n;
      sc.shake = 1;
      this.sfx.play('knock', 0.45);
      this.particles.dust((p.x + e.x) / 2, (p.y + e.y) / 2, 2);
      this.touch.haptic(10);
      if (sc.bar >= 1) { this.winScuffle(); return; } // la pulsación que llena la barra gana, antes de que el empuje la baje
    }
    // El enemigo empuja de vuelta; cada ~1,3 s tiene un pico (×1,8 durante 0,4 s).
    sc.nextSurge -= dt;
    if (sc.nextSurge <= 0) { sc.surge = 0.4; sc.nextSurge = 1.3; }
    sc.surge = Math.max(0, sc.surge - dt);
    sc.bar -= SCUFFLE.base * sc.mult * (sc.surge > 0 ? 1.8 : 1) * dt;
    sc.shake = Math.max(0, sc.shake - dt * 8);
    this.fx.kick(0.3);
    // Cámara sobre el punto medio; la pelea tiembla más cuanto más igualada.
    const mx = (p.x + e.x) / 2, my = (p.y + e.y) / 2;
    this.camera.update(dt, mx, my);
    this.camera.addShake(0.4 + sc.shake * 1.2);
    this.particles.update(dt * 0.35, this.map, (kind, pt) => this.bake(kind, pt));
    if (sc.bar >= 1) this.winScuffle();
    else if (sc.bar <= 0) this.loseScuffle();
    else if (sc.t >= SCUFFLE.timeout) (sc.bar > 0.5 ? this.winScuffle() : this.loseScuffle());
  }

  // Sale del forcejeo: cámara y música vuelven a la normalidad (suavemente: ver Camera.update y Sfx.slow).
  endScuffle() {
    this.scuffle = null;
    if (this.state === 'scuffle') this.state = 'playing';
    this.camera.mulTarget = 1;
    this.sfx.setSlowMo(false);
    this.player.cooldown = Math.max(this.player.cooldown, 0.3);
  }

  winScuffle() {
    const sc = this.scuffle, e = sc.e, p = this.player;
    const angle = Math.atan2(e.y - p.y, e.x - p.x);
    this.endScuffle();
    this.scuffleGrace = 0.6;
    p.startSwing(p.def);
    this.killEnemy(e, angle, 'execution'); // el contraataque es un remate brutal
    this.sfx.play('scuffleWin');
    this.camera.addShake(22);
    this.fx.kick(1);
    this.hitstop = Math.max(this.hitstop, 0.14);
    this.showCallout('¡CONTRAATAQUE!', COLORS.player, 1.0);
    this.touch.haptic([30, 20, 60]);
  }

  loseScuffle() {
    const sc = this.scuffle, e = sc.e, p = this.player;
    const angle = Math.atan2(p.y - e.y, p.x - e.x);
    this.endScuffle();
    this.killPlayer(angle); // el enemigo lo ejecuta: R reintenta el piso (restartLevel)
  }

  // Filtro "VS" sobre la escena (viñeta escalonada de alto contraste, tinte neón agresivo, destellos de color en
  // los bordes y barras de cine). Todo en bloques de píxeles; entra y sale con `scuffleI`.
  drawScuffleFx(ctx) {
    const I = this.scuffleI;
    if (I <= 0) return;
    const w = this.scene.width, h = this.scene.height;
    ctx.save();
    // Tinte: magenta/cian que alterna con el pulso del forcejeo
    const beat = Math.floor(performance.now() / 120) % 2;
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = I * 0.3;
    ctx.fillStyle = beat ? '#ff2a85' : '#05d9e8';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // Viñeta escalonada
    const t = Math.max(3, Math.round(Math.min(w, h) * 0.05));
    ctx.fillStyle = '#05000f';
    for (let k = 0; k < 7; k++) {
      ctx.globalAlpha = I * (0.78 - k * 0.11);
      ctx.fillRect(0, k * t, w, t);
      ctx.fillRect(0, h - (k + 1) * t, w, t);
      ctx.fillRect(0, k * t, t, h - 2 * k * t);
      ctx.fillRect(w - (k + 1) * t, k * t, t, h - 2 * k * t);
    }
    // Bandas de color en los laterales (cian izquierda = tú, magenta derecha = ellos)
    const bw = Math.round(3 * I);
    ctx.globalAlpha = I * (0.55 + 0.35 * beat);
    ctx.fillStyle = '#05d9e8'; ctx.fillRect(0, 0, bw, h);
    ctx.fillStyle = '#ff2a85'; ctx.fillRect(w - bw, 0, bw, h);
    // Barras de cine arriba y abajo
    const bh = Math.round(I * 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05000f';
    ctx.fillRect(0, 0, w, bh); ctx.fillRect(0, h - bh, w, bh);
    ctx.fillStyle = '#05d9e8'; ctx.fillRect(0, bh, w, 1);
    ctx.fillStyle = '#ff2a85'; ctx.fillRect(0, h - bh - 1, w, 1);
    ctx.restore();
  }

  // Interfaz del duelo: retratos enfrentados con un gran "VS" central y una barra de tensión (cian = tú,
  // magenta = enemigo) con marcador, que late más rápido cuanto más cerca está de perderse.
  drawScuffleUI(ctx) {
    const sc = this.scuffle;
    if (this.state !== 'scuffle' || !sc) return;
    const w = this.scene.width, h = this.scene.height, s = this.safe, cx = Math.round(w / 2);
    const now = performance.now();
    const danger = sc.bar < 0.3;
    const pulse = Math.floor(now / (danger ? 70 : 130)) % 2;
    ctx.save();
    // Retratos y VS
    const topY = 16 + s.t;
    const frame = (x, color) => {
      ctx.fillStyle = '#05000f'; ctx.fillRect(x - 2, topY - 2, 40, 40);
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, topY - 2, 40, 1); ctx.fillRect(x - 2, topY + 37, 40, 1);
      ctx.fillRect(x - 2, topY - 2, 1, 40); ctx.fillRect(x + 37, topY - 2, 1, 40);
    };
    const px = cx - 78, ex = cx + 42;
    frame(px, COLORS.player); frame(ex, COLORS.wall);
    ctx.drawImage(maskIcon(this.mask), px, topY, 36, 36);
    drawSprite(ctx, sc.e.sprite || 'enemy', ex + 18, topY + 18, 0, { scale: 2 });
    const vs = 'VS', vsScale = 4;
    const jx = pulse ? 1 : -1;
    drawText(ctx, vs, cx - 1 + jx, topY + 2, { color: COLORS.player, scale: vsScale, align: 'center', shadow: null });
    drawText(ctx, vs, cx + 1 - jx, topY + 3, { color: COLORS.wall, scale: vsScale, align: 'center', shadow: null });
    drawText(ctx, vs, cx, topY + 2, { color: '#ffffff', scale: vsScale, align: 'center', shadow: null });
    // Barra de tensión
    const barW = Math.max(110, Math.min(220, Math.round(w * 0.46))), barH = 9 + (danger && pulse ? 2 : 0);
    const bx = cx - Math.round(barW / 2), by = h - 52 - s.b;
    ctx.fillStyle = '#05000f'; ctx.fillRect(bx - 2, by - 2 - (barH - 9) / 2, barW + 4, barH + 4);
    ctx.fillStyle = danger && pulse ? '#ff2e55' : '#3a2a55';
    ctx.fillRect(bx - 2, by - 2 - (barH - 9) / 2, barW + 4, 1);
    ctx.fillRect(bx - 2, by + barH + 1 - (barH - 9) / 2, barW + 4, 1);
    const fill = Math.round(barW * clamp(sc.bar, 0, 1));
    ctx.fillStyle = '#ff2a85'; ctx.fillRect(bx, by, barW, 9);
    ctx.fillStyle = '#05d9e8'; ctx.fillRect(bx, by, fill, 9);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + fill - 1, by - 3, 3, 15); // marcador del choque
    ctx.fillStyle = '#05000f'; ctx.fillRect(bx + Math.round(barW / 2), by, 1, 9);
    // Chispas del choque: puntos que saltan del marcador
    for (let i = 0; i < 4; i++) {
      const a = now / 60 + i * 1.7;
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ffbe0b';
      ctx.fillRect(bx + fill + Math.round(Math.cos(a) * 5), by + 4 + Math.round(Math.sin(a * 1.3) * 7), 1, 1);
    }
    // Texto: urgencia + resistencia del enemigo (sube con cada forcejeo del piso)
    const label = this.hint('¡APORREA CLIC / ESPACIO!', '¡APORREA ATACAR!');
    if (pulse || !danger) drawText(ctx, label, cx, by - 26, { color: pulse ? '#ffffff' : COLORS.enemy, scale: this.fitScale(label, w - 40, 2), align: 'center' });
    const res = 'RESISTENCIA X' + sc.mult.toFixed(1).replace('.', ',');
    drawText(ctx, res, cx, by + 16, { color: sc.mult > 1.2 ? COLORS.blood : '#9d8fb8', align: 'center' });
    ctx.restore();
  }

  // Etiqueta/acción del botón táctil ATACAR: un derribado a tiro (REMATAR, el mismo objetivo que el
  // indicador), la moto con el edificio limpio (MOTO), una puerta delante (PATEAR) o, por defecto,
  // ATACAR. `ready` = hay una acción contextual disponible.
  touchAction() {
    const p = this.player;
    if (!p.alive || p.exec) return { id: 'attack', label: 'ATACAR', ready: false };
    if (p.executionTarget(this)) return { id: 'execute', label: 'REMATAR', ready: true };
    if (this.state === 'cleared' && this.bike) {
      const b = this.bike, m = MOUNT_MARGIN * 3;
      if (Math.abs(p.x - b.park.x) < b.w / 2 + p.r + m && Math.abs(p.y - b.park.y) < b.h / 2 + p.r + m) {
        return { id: 'mount', label: 'MOTO', ready: true };
      }
    }
    const door = this.doors.some((d) => d.inKickRange(p.x, p.y, p.angle));
    return door ? { id: 'kick', label: 'PATEAR', ready: true } : { id: 'attack', label: 'ATACAR', ready: false };
  }

  // Edificio despejado y de vuelta en la moto: se sube y se va; al salir de la pantalla, los resultados.
  startLeaving() {
    const p = this.player;
    this.state = 'leaving';
    this.cine = { kind: 'leave', t: 0, from: { x: p.x, y: p.y, angle: p.angle } };
    this.sfx.playMotoDeparture({ board: LEAVE_BOARD, ride: LEAVE_RIDE });
  }

  finishLeaving() {
    this.cine = null;
    this.transition(() => this.finishFloor());
  }

  // El jugador cruzó el umbral: se pone la máscara, la puerta principal se cierra de golpe y se
  // bloquea (el portazo y los efectos llegan cuando acaba de cerrarse: `slamEffects`) y empieza el
  // combate. Se anota el arma con la que entra para que R reaparezca igual.
  beginLockdown() {
    const p = this.player;
    this.inside = true;
    this.entered = true;
    p.putOnMask(this);
    this.entryWeapon = p.weapon ? { type: p.weapon.type, ammo: p.weapon.ammo } : null;
    this.mainDoor.lock();
    this.sfx.setMusic('action');
  }

  slamEffects(door) {
    this.playAt('lockdown', door.cx, door.cy);
    this.particles.dust(door.cx, door.cy, 10);
    this.particles.sparks(door.cx, door.cy, -Math.PI / 2, 12, 1.2);
    this.camera.addShake(8);
    this.fx.kick(0.8);
    this.showCallout('SALIDAS BLOQUEADAS', COLORS.blood);
  }

  showCallout(text, color, seconds = 2.4, sub = null) {
    this.callout = { text, color, t: seconds, max: seconds, sub };
  }

  // Puertas: primero los enemigos y AL FINAL el jugador, que tiene prioridad absoluta: su empujón
  // impone el giro (y bloquea la puerta), así que un enemigo nunca le gana ni le empuja.
  updateDoors(dt) {
    for (const door of this.doors) {
      door.update(dt);
      if (door.slammed) { door.slammed = false; this.slamEffects(door); }
      for (const e of this.enemies) {
        if (!e.standing) continue;
        const hit = door.collide(e, this.map, { pushSpeed: ENEMY_PUSH_SPEED, canPush: () => e.doorContact() });
        if (hit === 'knock') this.doorKnock(door, e);
      }
      if (!this.player.alive) continue;
      const wasClosed = Math.abs(door.offset) < 0.5 && !door.fast;
      if (door.collide(this.player, this.map, { player: true }) === 'push' && wasClosed && door.creakCd <= 0) {
        // Empujón del jugador: la puerta se abre de golpe (y derriba a quien esté detrás).
        this.playAt('kick', door.cx, door.cy, 0.6);
        this.particles.dust(door.cx, door.cy, 5);
        this.camera.addShake(1.5);
        door.creakCd = 0.4;
      }
    }
  }

  // Puerta estampada contra un enemigo: derribo con más contundencia que un golpe normal.
  doorKnock(door, e) {
    const away = Math.atan2(e.y - door.cy, e.x - door.cx);
    this.knockDown(e, away, 'door');
    const swing = door.angle + (door.angVel > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.particles.splinters((door.hx + door.ex) / 2, (door.hy + door.ey) / 2, swing, 12);
    this.particles.dust(e.x, e.y, 6);
    this.camera.addShake(5);
    this.fx.kick(0.35);
    this.hitstop = Math.max(this.hitstop, HITSTOP.doorKnock);
    this.playAt('kick', e.x, e.y);
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
            this.killEnemy(e, Math.atan2(b.vy, b.vx), 'bullet', b);
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
  killEnemy(e, angle, cause = 'bullet', src = null) {
    if (!e.alive) return;
    // El jefe absorbe los golpes que no lo matan (coraza, vida): ver Boss.guardKill.
    if (e.guardKill && !e.guardKill(cause, angle, this, src)) return;
    const feel = KILL_FEEL[cause] || KILL_FEEL.bullet;
    e.alive = false;
    this.addScore(cause, e);
    this.dropWeapon(e);
    e.corpse = { x: e.x + Math.cos(angle) * 8, y: e.y + Math.sin(angle) * 8 }; // donde se estampa el cadáver
    this.bleed(e.x, e.y, angle, feel.power, feel.wide);
    this.stainPlayer(feel.power, angle);
    this.drawCorpse(e.x, e.y, angle, e.corpseSprite || (e.armed ? 'armedCorpse' : 'enemyCorpse'), e.corpseScale || 1);
    this.camera.addShake(feel.shake);
    this.fx.kick(feel.fx);
    this.hitstop = Math.max(this.hitstop, feel.stop);
    if (cause === 'execution') this.sfx.play('crunch');
    else this.sfx.play('hit', 0.85);
  }

  // Cada baja salpica al jugador: la sangre acumulada sube con la fuerza del golpe (más en melé y
  // remate) y, al pasar al siguiente nivel, unas gotas caen sobre él para que se note el cambio.
  // Ajuste "sangre" (settings.js). Apagado: ni manchas, ni huellas, ni sangre sobre el personaje; las bajas
  // sueltan chispas de neón y humo (`particles.cleanKill`). Lo ya dibujado en el suelo se queda hasta el
  // siguiente reinicio del piso (la capa de sangre también lleva los cadáveres), pero las capas de las
  // paredes, las huellas y la sangre del personaje se ocultan al instante.
  get goreOn() {
    return this.settings.get('goreEnabled') !== false;
  }

  refreshGore() {
    if (!this.player) return;
    this.player.bloodLevel = this.goreOn ? bloodLevelFor(this.gore) : 0;
    if (!this.goreOn) { this.prints.clear(); this.player.soles = 0; }
  }

  stainPlayer(power, angle) {
    this.gore += power; // se sigue contando: si se vuelve a activar la sangre, el personaje la recupera
    if (!this.goreOn) return;
    const level = bloodLevelFor(this.gore);
    if (level === this.player.bloodLevel) return;
    this.player.bloodLevel = level;
    this.particles.blood(this.player.x, this.player.y, angle + Math.PI, 5, 1.2);
  }

  // ¿Pisa (x, y) sangre fresca? Un cadáver o un charco de baja: empapa las suelas del jugador.
  bloodUnderfoot(x, y) {
    if (!this.goreOn) return false;
    for (const e of this.enemies) {
      if (!e.alive && e.corpse && Math.hypot(e.corpse.x - x, e.corpse.y - y) < CORPSE_STEP_RADIUS) return true;
    }
    for (const p of this.pools) if (Math.hypot(p.x - x, p.y - y) < p.r) return true;
    return false;
  }

  // Todo el desangrado de una baja: partículas (sangre, restos, chispas de neón), charco y
  // regueros en el suelo y salpicaduras en las paredes de enfrente. Lo permanente se queda hasta
  // que se reinicia el piso.
  bleed(x, y, angle, power, wide) {
    if (!this.goreOn) { this.particles.cleanKill(x, y, angle, power, wide); return; }
    this.particles.gore(x, y, angle, power, wide);
    this.splatBlood(x, y, angle, power, wide);
    this.splatWalls(x, y, angle, power, wide);
  }

  addScore(cause, e) {
    this.score.register(cause, e.x, e.y - 14);
    if (this.score.combo > 1) this.sfx.play('combo', 1, this.score.combo);
  }

  // Golpe intermedio de una ejecución (cuchillo, tubo, ráfaga): hiere sin matar. Salpica un poco, hace
  // temblar al derribado y suena; sin sangre (ajuste) salen chispas de neón.
  woundEnemy(e, angle, style) {
    if (e.onWound) e.onWound(style, this);
    if (this.goreOn) {
      this.particles.blood(e.x, e.y, angle, style === 'burst' ? 6 : 9, 0.8);
      this.splatBlood(e.x, e.y, angle, 0.4, 0.6);
    } else {
      this.particles.neon(e.x, e.y, angle, 8, 0.9);
    }
    this.stainPlayer(0.35, angle);
    this.camera.addShake(4);
    this.hitstop = Math.max(this.hitstop, 0.03);
    this.sfx.play(style === 'knife' ? 'hit' : 'crunch', 0.6);
  }

  knockDown(e, angle, cause = 'fists') {
    if (!e.standing) return;
    if (e.guardKnock && !e.guardKnock(cause, angle, this)) return;
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
    p.cancelExecution(); // si lo matan a mitad de un remate, el derribado no se queda congelado
    this.state = 'dead';
    this.bleed(p.x, p.y, angle, 1.3, 0.7);
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
    if (best.locked || best.closing) {
      // Bloqueada: no cede. Un golpe sordo y nada más.
      this.camera.addShake(1.5);
      this.particles.dust(best.cx, best.cy, 4);
      this.sfx.play('empty');
      return true;
    }
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
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const angle = e.angle + (pellets > 1 ? rand(-def.fan, def.fan) : rand(-def.spread, def.spread));
      const speed = def.bulletSpeed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      this.bullets.push(new Bullet(bx, by, angle, speed, 'enemy', def.bulletRange || Infinity));
    }
    this.particles.sparks(e.x + cos * 20, e.y + sin * 20, e.angle, def.burst > 1 ? 4 : 6, 0.45);
    this.particles.shell(e.x + cos * 6, e.y + sin * 6, e.angle + Math.PI / 2);
    this.playAt(def.sound, e.x, e.y);
    this.camera.addShake(def.burst > 1 ? 1 : pellets > 1 ? 5 : 2);
  }

  makeNoise(x, y, radius) {
    for (const e of this.enemies) {
      if (e.alive && Math.hypot(e.x - x, e.y - y) < radius) e.hear(x, y);
    }
  }

  // --- Capa de sangre (media resolución: 1 píxel = 2 unidades del mundo) ---------------

  // Algo llega al suelo y se queda para siempre: una gota (con su estela corta en la dirección en
  // la que viajaba, así el salpicado tiene dirección), un resto que se para (con su mancha) o
  // una gota del rastro que va dejando un resto en vuelo.
  bake(kind, p) {
    if (!this.goreOn) return; // gotas que ya iban en el aire al apagar la sangre
    const ctx = this.bloodCtx;
    const x = Math.round(p.x / WORLD_PX), y = Math.round(p.y / WORLD_PX);
    if (kind === 'trail') {
      ctx.fillStyle = Math.random() < 0.5 ? COLORS.bloodDark : COLORS.blood;
      ctx.fillRect(x, y, 1, 1);
      return;
    }
    if (kind === 'gib') {
      ctx.fillStyle = COLORS.bloodDark;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = GIB_COLORS[p.kind];
      ctx.fillRect(x, y, 2, 2);
      return;
    }
    const heavy = p.size > 2.2;
    ctx.fillStyle = heavy ? COLORS.blood : COLORS.bloodMid;
    const s = heavy ? 2 : 1;
    ctx.fillRect(x, y, s, s);
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 70) {
      const len = Math.min(heavy ? 4 : 2, Math.floor(speed / 60));
      for (let i = 1; i <= len; i++) ctx.fillRect(Math.round(x + (p.vx / speed) * i), Math.round(y + (p.vy / speed) * i), 1, 1);
    }
  }

  // Charco, charcos satélite, gotas en cono, regueros y arrastre, todo en píxeles. `power` es la
  // cantidad (más en melé y remate) y `wide` la semiapertura del salpicado. Solo se borra al
  // reiniciar el piso.
  splatBlood(x, y, angle, power = 1, wide = 0.55) {
    const ctx = this.bloodCtx;
    const px = x / WORLD_PX, py = y / WORLD_PX;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.stains++;
    ctx.save();
    ctx.fillStyle = COLORS.bloodDark;
    const poolR = rand(5, 7) * power;
    pixelDisc(ctx, px + cos * 3, py + sin * 3, poolR);
    this.pools.push({ x: x + cos * 6, y: y + sin * 6, r: poolR * WORLD_PX * 0.9 });
    if (this.pools.length > MAX_POOLS) this.pools.shift();
    ctx.fillStyle = COLORS.blood;
    pixelDisc(ctx, px + cos * 3 - 1, py + sin * 3 - 1, rand(3.5, 5) * power);
    // Charcos satélite: salpicaduras gordas que han caído más lejos.
    for (let i = 0, n = 2 + Math.floor(power * 2); i < n; i++) {
      const a = angle + rand(-wide, wide), d = rand(8, 20) * power;
      ctx.fillStyle = Math.random() < 0.5 ? COLORS.bloodDark : COLORS.blood;
      pixelDisc(ctx, px + Math.cos(a) * d, py + Math.sin(a) * d, rand(1, 2.2));
    }
    for (let i = 0; i < 34 * power; i++) {
      const d = rand(3, 30) * power;
      const a = angle + rand(-wide, wide);
      ctx.fillStyle = Math.random() < 0.3 ? COLORS.bloodDark : COLORS.blood;
      const s = d < 12 ? 2 : 1;
      ctx.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d), s, s);
    }
    // Regueros: líneas de píxeles en la dirección del golpe, gruesas al principio y con una
    // gota al final. Son más y más largos cuanto más fuerte es la baja.
    const spread = Math.min(wide * 0.55, 1.6);
    for (let i = 0, n = 3 + Math.floor(rand(0, 3) * power); i < n; i++) {
      const a = angle + rand(-spread, spread);
      const len = rand(12, 32) * power;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.fillStyle = COLORS.blood;
      for (let d = 0; d < len; d++) {
        const thick = d < len * 0.4 ? 2 : 1;
        ctx.fillRect(Math.round(px + ca * d), Math.round(py + sa * d), thick, thick);
      }
      ctx.fillStyle = COLORS.bloodDark;
      ctx.fillRect(Math.round(px + ca * len), Math.round(py + sa * len), 2, 2);
    }
    ctx.restore();
    this.bloodSmear(px, py, angle, rand(10, 22) * power);
  }

  // Arrastre de sangre desde el punto del impacto hacia donde cae el cuerpo (que se estampa
  // encima): pincelada gruesa que se afina, con huecos como de pincel seco.
  bloodSmear(px, py, angle, len) {
    const ctx = this.bloodCtx;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let d = 0; d < len; d++) {
      if (Math.random() < 0.12) continue;
      ctx.fillStyle = d % 5 < 2 ? COLORS.bloodDark : COLORS.blood;
      const thick = d < len * 0.55 ? 2 : 1;
      ctx.fillRect(Math.round(px + cos * d), Math.round(py + sin * d), thick, thick);
    }
  }

  // Salpicaduras en las paredes: un abanico de rayos desde la baja hacia donde va el golpe; donde
  // un rayo llega a una pared del edificio (no a un mueble ni a una puerta) queda una mancha, más
  // grande cuanto más cerca. Cuanto más fuerte es la baja, más lejos llega la sangre.
  splatWalls(x, y, angle, power = 1, wide = 0.55) {
    const reach = 150 * power + 40;
    for (let i = 0, n = Math.round(7 + 4 * power); i < n; i++) {
      const a = angle + rand(-wide, wide);
      const d = castRay(this.map, x, y, a, reach);
      if (d >= reach) continue;
      const hx = x + Math.cos(a) * (d + 0.5), hy = y + Math.sin(a) * (d + 0.5);
      if (!isStructuralWall(this.map, Math.floor(hx / TILE), Math.floor(hy / TILE))) continue;
      this.wallSplat(hx / WORLD_PX, hy / WORLD_PX, a, 1 - d / reach, power);
    }
  }

  // Una mancha en la capa de paredes (coordenadas en píxeles): mancha central con borde oscuro,
  // gotas alrededor (sobre todo hacia donde iba la sangre) y regueros en esa dirección. Cada
  // píxel se comprueba contra la pared para no salirse de ella.
  wallSplat(px, py, angle, near, power) {
    const ctx = this.wallBloodCtx, map = this.map;
    const onWall = (cx, cy) => isStructuralWall(map, Math.floor((cx * WORLD_PX) / TILE), Math.floor((cy * WORLD_PX) / TILE));
    const put = (x, y, color, s = 1) => {
      const X = Math.round(x), Y = Math.round(y);
      if (!onWall(X, Y) || !onWall(X + s - 1, Y + s - 1)) return;
      ctx.fillStyle = color;
      ctx.fillRect(X, Y, s, s);
    };
    const disc = (cx, cy, r, color) => {
      const R = Math.max(1, Math.round(r));
      for (let dy = -R; dy <= R; dy++) {
        const half = Math.floor(Math.sqrt(R * R - dy * dy));
        for (let dx = -half; dx <= half; dx++) put(cx + dx, cy + dy, color);
      }
    };
    this.wallBloodDirty = true;
    this.stains++;
    const r = 1.5 + near * 2.5 * Math.min(power, 1.6);
    disc(px, py, r, COLORS.bloodDark);
    disc(px, py, r - 1, COLORS.blood);
    put(px - 1, py - 1, COLORS.bloodWet);
    for (let i = 0, n = Math.round((5 + near * 9) * power); i < n; i++) {
      const a = Math.random() < 0.6 ? angle + rand(-1.2, 1.2) : rand(0, TAU);
      const d = rand(r + 1, r + 8);
      put(px + Math.cos(a) * d, py + Math.sin(a) * d, Math.random() < 0.3 ? COLORS.bloodDark : COLORS.blood);
    }
    for (let i = 0, n = 1 + Math.floor(rand(0, 2.5)); i < n; i++) {
      const a = angle + rand(-0.4, 0.4);
      const len = 2 + near * 6 * rand(0.5, 1.2);
      for (let d = 0; d < len; d++) put(px + Math.cos(a) * d, py + Math.sin(a) * d, d < len * 0.6 ? COLORS.blood : COLORS.bloodDark);
    }
  }

  // El cadáver es el sprite tumbado estampado (rotado, sin suavizado) en la capa de sangre.
  drawCorpse(x, y, angle, sprite, scale = 1) {
    const ctx = this.bloodCtx;
    ctx.save();
    ctx.translate(Math.round((x + Math.cos(angle) * 8) / WORLD_PX), Math.round((y + Math.sin(angle) * 8) / WORLD_PX));
    drawSprite(ctx, sprite, 0, 0, angle, { scale });
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
    if (this.goreOn) this.prints.draw(ctx); // sobre baldosas y sangre, bajo todo lo demás
    this.drawBike(ctx);
    this.drawObjectiveMarker(ctx);
    this.particles.drawGround(ctx);
    // Muebles sobre la sangre (lo que cae debajo queda oculto) y bajo los personajes.
    ctx.drawImage(this.propsLayer, 0, 0, pixelW, pixelH);
    for (const e of this.enemies) if (e.alive && e.state === 'down') e.draw(ctx, this.time, this);
    this.drawExecuteMarks(ctx);
    this.drawLockMark(ctx);
    for (const p of this.pickups) p.draw(ctx, this.time);
    for (const b of this.bullets) b.draw(ctx);
    for (const e of this.enemies) if (e.standing) e.draw(ctx, this.time, this);
    if (this.player.alive) {
      if (this.state === 'playing' || this.state === 'cleared') this.player.drawAim(ctx, this);
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
    if (this.wallBloodDirty && this.goreOn) ctx.drawImage(this.wallBloodLayer, 0, 0, pixelW, pixelH);

    if (this.debug) this.renderDebug(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawStrobe(ctx);
    this.drawScuffleFx(ctx);
    this.renderHud(ctx);
    this.drawScuffleUI(ctx);
    this.drawFade(ctx);

    this.fx.compose(this.ctx, this.scene, this.frameDt);
  }

  // Casilla de salida parpadeante + flecha alrededor del jugador apuntando hacia ella.
  // La moto: sombra y sprite. Va montada por el jugador en la llegada y la fuga (el jugador se
  // dibuja encima, con las demás figuras); el resto del tiempo está aparcada en su plaza.
  drawBike(ctx) {
    const b = this.bike;
    if (!b) return;
    drawSprite(ctx, 'bikeShadow', b.x + 3, b.y + 3, 0, { alpha: 0.5 });
    drawSprite(ctx, 'bike', b.x, b.y, 0);
  }

  // Marco neón con flecha hacia lo que toca hacer: entrar por la puerta principal (fuera, antes de
  // cruzar el umbral) y, ya despejado el edificio, volver a la moto.
  drawObjectiveMarker(ctx) {
    const p = this.player;
    if (!p.alive || !this.mainDoor) return;
    let r = null;
    if (this.state === 'playing' && !this.inside) {
      const d = this.mainDoor;
      r = { x: d.cx - TILE / 2, y: d.cy - TILE / 2, w: TILE, h: TILE, label: 'ENTRADA', below: true };
    } else if (this.state === 'cleared') {
      const b = this.bike;
      r = { x: b.park.x - b.w / 2, y: b.park.y - b.h / 2, w: b.w, h: b.h, label: 'MOTO', below: false };
    }
    if (!r) return;
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    ctx.save();
    ctx.fillStyle = COLORS.player;
    ctx.globalAlpha = blink ? 0.4 : 0.2;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    // Marco de 1 píxel.
    ctx.fillRect(r.x, r.y, r.w, WORLD_PX);
    ctx.fillRect(r.x, r.y + r.h - WORLD_PX, r.w, WORLD_PX);
    ctx.fillRect(r.x, r.y, WORLD_PX, r.h);
    ctx.fillRect(r.x + r.w - WORLD_PX, r.y, WORLD_PX, r.h);
    ctx.restore();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    drawText(ctx, r.label, cx, r.below ? r.y + r.h + 4 : r.y - CELL_H * WORLD_PX - 2, { color: COLORS.player, scale: WORLD_PX, align: 'center' });
    if (Math.hypot(cx - p.x, cy - p.y) > 60) {
      const a = Math.atan2(cy - p.y, cx - p.x);
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

  // Marca de remate: corchetes neón rojo/blanco sobre el derribado al que se va a golpear (los demás
  // derribados al alcance, más tenues). Parpadean más rápido cuando está a punto de levantarse y,
  // durante la ejecución, se cierran sobre él al ritmo de la carga. Es el mismo objetivo que elige
  // `player.executionTarget`, así que lo marcado es exactamente a quien se golpea.
  drawExecuteMarks(ctx) {
    const p = this.player;
    if (!p.alive || this.state === 'dead') return;
    const target = p.exec ? p.exec.target : p.executionTarget(this);
    const now = performance.now();
    ctx.save();
    for (const e of this.enemies) {
      if (!e.alive || e.state !== 'down') continue;
      const isTarget = e === target;
      if (!isTarget && Math.hypot(e.x - p.x, e.y - p.y) - e.r >= FINISH_RANGE) continue;
      const urgent = e.timer < 0.9 && !e.executing;
      const blink = Math.floor(now / (urgent ? 70 : 130)) % 2;
      const executing = p.exec && p.exec.target === e;
      const half = executing ? 14 - 8 * Math.min(1, p.exec.t / p.exec.spec.hits[Math.min(p.exec.hitIdx, p.exec.spec.hits.length - 1)]) : 13 + blink;
      ctx.globalAlpha = isTarget ? 1 : 0.4;
      ctx.fillStyle = executing && p.exec.hit ? '#ffffff' : blink ? COLORS.text : COLORS.enemyBullet;
      const x0 = e.x - half, x1 = e.x + half, y0 = e.y - half, y1 = e.y + half;
      pixelRect(ctx, x0, y0, 3, 1); pixelRect(ctx, x0, y0, 1, 3);
      pixelRect(ctx, x1 - 6, y0, 3, 1); pixelRect(ctx, x1 - 2, y0, 1, 3);
      pixelRect(ctx, x0, y1 - 2, 3, 1); pixelRect(ctx, x0, y1 - 6, 1, 3);
      pixelRect(ctx, x1 - 6, y1 - 2, 3, 1); pixelRect(ctx, x1 - 2, y1 - 6, 1, 3);
    }
    ctx.restore();
  }

  // Marca del objetivo fijado por la asistencia de apuntado táctil: un anillo de neón con cuatro segmentos
  // que gira despacio bajo el enemigo, más cuatro marcas fijas, para saber a quién se va a dar antes de
  // disparar. Solo en táctil y mientras el joystick derecho apunta y hay objetivo (`touch.lock`).
  drawLockMark(ctx) {
    const e = this.touch.lock;
    if (!this.input.touchMode || !e || !e.alive || !this.player.alive || this.panel) return;
    const t = performance.now() / 1000, R = 15;
    const firing = this.input.aimFiring || this.input.attackHeld;
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 4; i++) {
      const a = t * 1.6 + (i * Math.PI) / 2;
      ctx.fillStyle = i % 2 ? COLORS.text : (firing ? COLORS.enemyBullet : COLORS.wall);
      for (let k = -2; k <= 2; k++) {
        const b = a + k * 0.16;
        pixelRect(ctx, e.x + Math.cos(b) * R - 1, e.y + Math.sin(b) * R - 1, 2, 2);
      }
    }
    ctx.fillStyle = firing ? COLORS.enemyBullet : COLORS.wall;
    for (const [dx, dy] of [[0, -R - 5], [0, R + 3], [-R - 5, 0], [R + 3, 0]]) pixelRect(ctx, e.x + dx, e.y + dy, 2, 2);
    ctx.restore();
  }

  // La etiqueta de la tecla sobre el derribado al que se va a golpear (en la escena, no en el mundo,
  // para que el texto salga nítido).
  drawExecutePrompt(ctx) {
    const p = this.player;
    if (!p.alive || p.exec || this.state === 'dead') return;
    const e = p.executionTarget(this);
    if (!e) return;
    const s = this.camera.worldToScreen(e.x, e.y + 22); // debajo: los popups de puntos flotan por encima
    const blink = Math.floor(performance.now() / 130) % 2;
    drawText(ctx, this.hint('E · CLIC', 'REMATAR'), s.x, s.y, { color: blink ? COLORS.text : COLORS.enemyBullet, align: 'center' });
  }

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
        MASKS.find((m) => m.id === e.mask)?.name || e.maskName || '-', formatDate(e.date)];
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
  // Luces estroboscópicas del club (piso 4): sobre la escena, una pulsación de color neón a cada tiempo
  // (cian, magenta, violeta, ámbar) con un destello blanco corto en los golpes fuertes y un parpadeo rápido
  // muy suave. Nunca supera el 22 % de opacidad, y se puede apagar en Opciones (`LUCES ESTROBOSCÓPICAS`)
  // por si molesta (fotosensibilidad). Solo con el piso en juego.
  drawStrobe(ctx) {
    if (!this.strobe || !this.settings.get('strobeEnabled') || this.panel) return;
    if (this.state !== 'playing' && this.state !== 'cleared') return;
    const t = performance.now() / 1000, beat = 0.46;
    const i = Math.floor(t / beat), f = (t / beat) % 1;
    const colors = ['#05d9e8', '#ff2a85', '#9b5cff', '#ffbe0b'];
    const pulse = Math.max(0, 1 - f * 3.2);                 // decae rápido tras cada tiempo
    const flash = i % 4 === 0 && f < 0.1 ? 0.1 : 0;         // destello blanco en el primer tiempo de cada compás
    const w = this.scene.width, h = this.scene.height;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.04 + pulse * 0.18;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(0, 0, w, h);
    if (flash) { ctx.globalAlpha = flash; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    // Haces de luz: dos barras diagonales del color contrario que barren la pista.
    ctx.globalAlpha = 0.05 + pulse * 0.05;
    ctx.fillStyle = colors[(i + 2) % colors.length];
    const sweep = Math.round(((t * 40) % (w + 60)) - 30);
    for (let k = 0; k < h; k += 2) ctx.fillRect(sweep + Math.round(k * 0.35), k, 5, 2);
    ctx.restore();
  }

  // Cartel grande (SALIDAS BLOQUEADAS, PISO COMPLETADO): una franja oscura se abre desde el centro con
  // filos de neón, el texto entra deslizándose con doble sombra rosa/cian y un destello lo barre; el
  // subtítulo aparece después y todo se desvanece al final. Ocupa el centro: el objetivo va aparte.
  drawCallout(ctx, w, h) {
    const c = this.callout;
    if (!c) return;
    const age = c.max - c.t;
    const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    const open = ease(age / 0.22), fade = clamp(c.t / 0.4, 0, 1);
    const scale = this.fitScale(c.text, w - 24, 3);
    const textH = CELL_H * scale, subH = c.sub ? CELL_H + 5 : 0;
    const bandH = Math.round((textH + subH + 14) * open);
    const cx = Math.round(w / 2), cy = Math.round(h * 0.34);
    const y0 = cy - Math.round(bandH / 2);
    ctx.save();
    ctx.globalAlpha = 0.8 * fade;
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(0, y0, w, bandH);
    ctx.globalAlpha = fade;
    ctx.fillStyle = c.color;
    ctx.fillRect(0, y0, w, 1);
    ctx.fillRect(0, y0 + bandH - 1, w, 1);
    ctx.globalAlpha = 0.3 * fade;
    ctx.fillRect(0, y0 + 2, w, 1);
    ctx.fillRect(0, y0 + bandH - 3, w, 1);
    if (open > 0.7) {
      const slide = Math.round((1 - ease((age - 0.12) / 0.3)) * w * 0.35);
      const tx = cx - slide, ty = y0 + 7;
      ctx.globalAlpha = fade * clamp((age - 0.1) / 0.15, 0, 1);
      drawText(ctx, c.text, tx + 2, ty + 1, { color: COLORS.wall, scale, align: 'center', shadow: null });
      drawText(ctx, c.text, tx - 1, ty, { color: COLORS.player, scale, align: 'center', shadow: null });
      drawText(ctx, c.text, tx, ty, { color: COLORS.text, scale, align: 'center', shadow: null });
      if (c.sub) {
        ctx.globalAlpha = fade * clamp((age - 0.45) / 0.25, 0, 1);
        drawText(ctx, c.sub, cx, ty + textH + 4, { color: c.color, align: 'center' });
      }
      // Destello: una barra clara cruza el cartel una vez, justo cuando el texto ya está.
      const sweep = (age - 0.35) / 0.4;
      if (sweep > 0 && sweep < 1) {
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(sweep * (w + 24)) - 12, y0 + 1, 6, bandH - 2);
      }
    }
    ctx.restore();
  }

  // Objetivo de piso despejado: un panel abajo en el centro (desliza hacia arriba al aparecer, con
  // flecha parpadeante y borde que late). Solo sale cuando el cartel grande ya se ha ido.
  drawGoalPanel(ctx, w, h) {
    if (this.state !== 'cleared' || this.callout) return;
    const text = 'REGRESA A LA MOTO';
    const e = 1 - Math.pow(1 - clamp(this.goalAge / 0.3, 0, 1), 3);
    const scale = this.fitScale(text, w - 60, 2);
    const tw = measureText(text) * scale, th = CELL_H * scale;
    const pw = tw + 34, ph = th + 12;
    const x = Math.round(w / 2 - pw / 2);
    // En escritorio, por encima de la línea de controles de abajo (dos filas de texto).
    const bottom = this.input.touchMode ? 10 : 10 + 2 * (CELL_H + 2);
    const y = Math.round(h - this.safe.b - bottom - ph + (1 - e) * (ph + 14 + bottom));
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
    ctx.save();
    ctx.globalAlpha = 0.85 * e;
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(x, y, pw, ph);
    ctx.globalAlpha = (0.5 + 0.5 * pulse) * e;
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(x, y, pw, 1);
    ctx.fillRect(x, y + ph - 1, pw, 1);
    ctx.fillRect(x, y, 1, ph);
    ctx.fillRect(x + pw - 1, y, 1, ph);
    ctx.globalAlpha = e;
    // Flecha (triángulo de píxeles) parpadeante a la izquierda: apunta hacia la moto.
    if (Math.floor(performance.now() / 250) % 2 === 0) {
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 8 + i, y + Math.round(ph / 2) - 4 + i, 1, 8 - 2 * i);
    }
    drawText(ctx, text, x + 20 + Math.round(tw / 2), y + 6, { color: COLORS.player, scale, align: 'center' });
    ctx.restore();
  }

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
      this.drawPanel(ctx, w, h);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'masks') {
      this.drawMaskSelect(ctx, w, h);
      if (this.showRecords) this.drawRecordsOverlay(ctx, w, h);
      this.touch.drawScreenButtons(ctx);
      this.drawToast(ctx);
      this.drawPanel(ctx, w, h);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'gameover') {
      this.drawGameOver(ctx, w, h);
      this.touch.drawScreenButtons(ctx);
      this.drawPanel(ctx, w, h);
      this.drawCrosshair(ctx);
      return;
    }
    this.drawPopups(ctx);
    this.drawExecutePrompt(ctx);
    const boss = this.enemies.find((e) => e.kind === 'boss' && e.alive && e.awake);
    if (boss && this.state !== 'cleared') drawBossBar(ctx, boss, w, 32 + this.safe.t);

    // Márgenes del HUD: separación fija + zona segura (muesca / esquinas redondeadas).
    const L = 6 + this.safe.l, R = w - 6 - this.safe.r, T = this.safe.t;
    const def = p.def;
    let weaponText = def.name;
    if (p.weapon && def.maxAmmo) weaponText += `  ${p.weapon.ammo}/${def.maxAmmo}`;
    drawText(ctx, weaponText, L, 4 + T, { color: COLORS.player, scale: 2 });
    // Miniatura de la máscara equipada (12×12 a ×2) con su nombre.
    ctx.fillStyle = '#140a24';
    ctx.fillRect(L - 1, 24 + T, 26, 26);
    ctx.globalAlpha = p.masked ? 1 : 0.4; // en la mano todavía: se apaga hasta ponérsela
    ctx.drawImage(maskIcon(this.mask), L, 25 + T, 24, 24);
    ctx.globalAlpha = 1;
    drawText(ctx, this.mask.name, L + 28, 25 + T, { color: '#9d8fb8' });
    // Brutalidad: una gota por nivel de sangre que lleva el personaje.
    for (let i = 0; i < (this.goreOn ? BLOOD_LEVELS : 0); i++) {
      ctx.fillStyle = i < p.bloodLevel ? COLORS.blood : '#3a1a3a';
      ctx.fillRect(L + 28 + i * 6, 34 + T, 4, 3);
    }
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
      drawText(ctx, `ESCENA ${w}X${h} · ESCALA ${this.view.scale} · MÁSCARA ${this.mask.id} · MANCHAS ${this.stains} · SANGRE ${this.player.bloodLevel} (${this.gore.toFixed(1)}) · PISADAS ${this.prints.list.length} · SUELAS ${this.player.soles} · ${this.inside ? 'DENTRO' : 'FUERA'} PUERTA ${this.mainDoor.locked ? 'BLOQUEADA' : this.mainDoor.closing ? 'CERRANDO' : 'LIBRE'}`, L, 65 + T, { color: COLORS.debug });
    }

    const cx = Math.round(w / 2);
    if (this.bannerTimer > 0 && this.state === 'playing') {
      ctx.globalAlpha = Math.min(1, this.bannerTimer);
      drawText(ctx, this.levelName, cx, Math.round(h * 0.28), { color: COLORS.wall, scale: this.fitScale(this.levelName, w - 12), align: 'center' });
      ctx.globalAlpha = 1;
    }
    // Objetivo de cada fase (parpadea): entrar y, despejado el edificio, volver a la moto.
    const goal = this.state === 'playing' && !this.inside && this.bannerTimer <= 0 ? 'ENTRA AL EDIFICIO' : null;
    if (goal && Math.floor(performance.now() / 300) % 3 !== 0) {
      // Debajo del bloque de puntuación (termina en y≈67) para no solaparse con él.
      drawText(ctx, goal, cx, 72 + T, { color: COLORS.player, scale: this.fitScale(goal, w - 12), align: 'center' });
    }
    this.drawCallout(ctx, w, h);
    this.drawGoalPanel(ctx, w, h);
    // Cinemáticas: barras negras arriba y abajo y cómo saltarlas.
    if (this.state === 'arriving' || this.state === 'leaving') {
      ctx.fillStyle = '#05000f';
      ctx.fillRect(0, 0, w, CINE_BAR);
      ctx.fillRect(0, h - CINE_BAR, w, CINE_BAR);
      drawText(ctx, this.hint('ESPACIO · CLIC: SALTAR', 'TOCA: SALTAR'), cx, h - CINE_BAR + 4, { color: '#9d8fb8', align: 'center' });
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

    this.drawPanel(ctx, w, h);
    this.drawCrosshair(ctx);
  }
}
