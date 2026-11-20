import { Input } from './input.js';
import { LEVELS, TILE, loadLevel, isSolidAt, isStructuralWall, isWallTile, lineOfSight, castRay, doorHitT, findPath, moveAndSlide } from './map.js';
import { renderFloor, renderWalls, renderProps, renderDark } from './decor.js';
import { Score, COMBO_WINDOW } from './score.js';
import { MASKS, maskEffects, maskIcon } from './masks.js';
import { ScoreHistory, FloorStats, MAX_ENTRIES, INITIALS_MAX, newRunId, formatDate } from './scores-history.js';
import { Menu } from './menu.js';
import { TouchControls } from './touch.js';
import { Settings } from './settings.js';
import { KeyBinds } from './keybinds.js';
import { Boss, drawBossBar } from './boss.js';
import { bloodyMaskPortrait, PORTRAIT_PAD, BLOOD_DROPS, villainPortrait, villainDef, AGENTS, drawGenderIcon, drawAgentPreview, drawPadlock } from './portraits.js';
import { Ads } from './ads.js';
import { Sewer } from './sewer.js';
import { civLine, allyLine } from './barks.js';
import { CivAlly } from './civally.js';
import { SewerRun } from './tunnel.js';
import { BikeExit, EXIT_EXTRA } from './exits.js';
import { StreetLife, newStreetRun } from './street.js';
import { Hostages } from './hostages.js';
import { PROLOGUE_DEF } from './prologue.js';
import { PrologueFlow } from './prologue-flow.js';
import { Comms, drawTalkingMask, voiceFor, talkBlips } from './comms.js';
import { Lore } from './lore.js';
import { weaponCategory } from './weapons.js';
import { buildOptionsMenu, buildPauseMenu } from './options-menu.js';
import { Player, bloodLevelFor, FINISH_RANGE } from './player.js';
import { Enemy, resetAiBudget, AI, setAiLevel } from './enemy.js';
import { SecurityCams } from './cameras.js';
import { ShieldGuard } from './shield.js';
const GAS_TIME = 60;        // s hasta que el gas mata al agente atrapado en el despacho (piso 10)
const VENT_TIME = 1.5;       // s que hay que mantener PATEAR/INTERACTUAR junto a la ventilación para romperla
// Emboscada de la trampilla (fase final, LIMPIEZA): si al elegir el rol quedan menos de AMBUSH_MIN enemigos vivos, la trampilla se abre y salen estos refuerzos (siempre ≥ 3).
const AMBUSH_MIN = 3;
const DETONATE_TIME = 1.5;   // s que hay que mantener PATEAR/INTERACTUAR junto al detonador (LIMPIEZA)
const ENDING_BLASTS = 16;    // explosiones de la secuencia final
const AMBUSH = [{ kind: 'grunt', weapon: 'smg' }, { kind: 'grunt', weapon: 'gun' }, { kind: 'runner' }, { kind: 'heavy', weapon: 'shotgun' }];
const FINAL_KEEP = 6;        // enemigos que quedan al reintentar la fase final con R (los 6 más lejos del despacho)
// Oleadas del perímetro (piso 10): cada enemigo aparece por un extremo de la calle ('w' oeste, 'e' este) y va a por el jugador.
const WAVES = [
  [{ side: 'w', kind: 'grunt', melee: 'bat' }, { side: 'e', kind: 'grunt', weapon: 'gun' }, { side: 'w', kind: 'grunt', melee: 'pipe' }, { side: 'e', kind: 'grunt', weapon: 'gun' }],
  [{ side: 'w', kind: 'runner' }, { side: 'e', kind: 'runner' }, { side: 'w', kind: 'heavy', weapon: 'shotgun' }, { side: 'e', kind: 'grunt', weapon: 'smg' }, { side: 'w', kind: 'shield', weapon: 'smg' }, { side: 'e', kind: 'grunt', weapon: 'smg' }],
];
const RUNOVER_FLIGHT = 0.7; // s que tarda el jugador atropellado en estamparse contra la «pantalla»
const ALARM_REACH = 18; // casillas de recorrido (a través de puertas) a las que llega un grito de alerta
import { Door, ENEMY_PUSH_SPEED } from './doors.js';
import { Pickup, Bullet, ENEMY_WEAPONS, WEAPON_DEFS, CIV_WEAPONS, segmentPointDistance, weaponGore, newWeaponBlood, stainWeaponBlood } from './weapons.js';
import { Particles, Footprints, GIB_COLORS, TOXIC, RED, TOXIC_GIBS, VOMIT, palOf } from './particles.js';
import { Sfx } from './audio.js';
import { ScreenFx } from './effects.js';
import { drawSprite, pixelDisc, pixelRect, BLOOD_LEVELS, WORLD_PX, playerBody, drawMaskHead, civHostileColors } from './sprites.js';
import { drawText, measureText, CELL_H } from './pixelfont.js';
import { civiliansHelp, newKarma, cloneKarma, hostileCivCount, friendlyCivCount } from './street.js';
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
// Arcoíris del estado de adrenalina (máscara del HUD): colores algo oscuros y saturados para no confundirse con la sangre verde.
const RAINBOW = ['#c4163a', '#d9611a', '#d9b81a', '#2fa82f', '#1a8ad9', '#4a2ad9', '#a02ad9'];
const RAINBOW_SIZE = 40; // lado del patrón (cubre el marco al girar)
let rainbowCache = null;
// Patrón cónico de bandas de píxeles (2 vueltas del espectro), hecho una sola vez; se dibuja girado cada fotograma.
function rainbowPattern() {
  if (rainbowCache) return rainbowCache;
  const c = document.createElement('canvas');
  c.width = c.height = RAINBOW_SIZE;
  const cx = c.getContext('2d');
  const sectors = RAINBOW.length * 2, h = RAINBOW_SIZE / 2;
  for (let py = 0; py < RAINBOW_SIZE; py++) {
    for (let px = 0; px < RAINBOW_SIZE; px++) {
      const a = Math.atan2(py + 0.5 - h, px + 0.5 - h) + Math.PI;
      cx.fillStyle = RAINBOW[Math.floor((a / (Math.PI * 2)) * sectors) % RAINBOW.length];
      cx.fillRect(px, py, 1, 1);
    }
  }
  rainbowCache = c;
  return c;
}

const POISON_TIME = 3.6; // s que agoniza un noqueado por veneno antes de morir
const KILL_FEEL = {
  bullet: { power: 1, wide: 0.55, shake: 7, stop: HITSTOP.kill, fx: 0.45 },
  melee: { power: 1.35, wide: 0.9, shake: 10, stop: HITSTOP.melee, fx: 0.65 },
  // Ejecución de un derribado: el charco más grande, el salpicado más abierto y la sacudida más
  // fuerte del juego. Hacia donde va el golpe (de jugador a enemigo) sale lo más denso.
  execution: { power: 2.2, wide: 1.3, shake: 14, stop: HITSTOP.execution, fx: 1 },
  poison: { power: 1, wide: 0.7, shake: 4, stop: 0.03, fx: 0.25 }, // muere envenenado (tubo oxidado)
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

// ¿Hay una línea de avisos (SONIDO OFF, EFECTOS LIGEROS...) bajo los puntos de arriba a la derecha? (los textos que esquivan el HUD se bajan lo justo)
const flagsOn = (g) => !!(g.sfx.muted || !g.fx.enabled || (g.fx.enabled && g.fx.lite));

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
    this.sfx.isLite = () => this.fx && this.fx.lite; // la música omite sus capas extra en móviles flojos (efectos ligeros)
    this.fx = new ScreenFx();
    this.history = new ScoreHistory();
    this.score = new Score(this.history.best());
    // Sangre del personaje: se acumula con las bajas DEL PISO. Al reintentar con R se conserva (el
    // jugador reaparece como murió); al pasar de piso (`goToLevel`) y al empezar partida empieza limpia.
    this.resetStains();
    // Edificio: el piso empieza en la calle. Al cruzar el umbral (`inside`) se bloquea la puerta
    // principal hasta despejarlo; `entered` y `entryWeapon` recuerdan ese momento para que R
    // reaparezca dentro, sin repetir la llegada.
    this.inside = false;
    this.entered = false;
    this.entryWeapon = null;
    this.cine = null;      // cinemática en curso: { kind: 'arrive' | 'leave', t }
    this.exit = null;      // salida de la moto elegida al azar para la fuga (portón, carril lateral o salto): ver exits.js
    this.callout = null;   // aviso grande temporal: { text, color, t, max, sub }
    this.scuffle = null;   // forcejeo en curso: { e, bar, t, mult, ... } (estado 'scuffle')
    this.scuffleCount = 0; // forcejeos de este piso: cada uno endurece al enemigo (se conserva con R)
    this.scuffleGrace = 0; // s de inmunidad al cuerpo a cuerpo tras un forcejeo
    this.scuffleI = 0;     // 0..1: intensidad del filtro "VS" (suaviza la entrada y la salida)
    this.floatingTexts = []; // textos tácticos que suben y se desvanecen: { x, y, text, color, t, max } (ver addFloat)
    this.goalAge = 0;      // s desde que el cartel de piso completado se apagó (anima el objetivo)
    this.runId = newRunId();
    this.showRecords = false;
    this.levelIndex = 0;
    this.comms = new Comms(this); // líneas cortas de lore no modales (prólogo)
    this.lore = new Lore(this);   // piezas narrativas cortas entre pisos (viñetas, llamadas y pistas): ver lore.js
    this.vignette = null;         // viñeta a pantalla completa en curso
    this.shot = null;             // plano de cámara narrativo en curso
    this.flow = new PrologueFlow(this); // lógica y estado del prólogo / tutorial (instrucciones, salto, fin): prologue-flow.js
    this.finalExit = null; this.ladderRoom = null; this.climb = null; this.emerge = null; this.descent = null; this.sewerRun = null; this.sewerStash = null; this.sewerRoute = null; this.keyRoute = false; this.hasKey = false; this.keyDrop = null; this.keyHintAt = 0; this.shutAt = 0; // piso 3: entrada por la alcantarilla y llave de salida
    this.cineK = 0; // 0..1: cuánto están puestas las barras de cine de llegada / fuga (anima las barras y el fundido del HUD)
    this.testRangeDef = null; // definición del campo de pruebas: la inyecta main.js SOLO en desarrollo (import dinámico), nunca en el build publicado
    this.testRange = false; // CAMPO DE PRUEBAS (testrange.js): nivel exclusivo para probar armas, fuera de la campaña
    this.prologue = false; // tutorial aparte del piso 1 (ver prologue.js): sin resultados, récords ni estadísticas de campaña
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
    this.keys = new KeyBinds(this.input); // controles de PC reasignables (keybinds.js); los guarda Settings
    this.carrierColors = { guepardo: '#ff9d2e', tiburon: '#9fb0d6', buho: '#b36bff' };
    this.settings = new Settings(this); // ajustes guardados (settings.js); `applyAll` los aplica al final del constructor
    this.keys.onChange = () => this.settings.save();
    this.ads = new Ads(this); // gestor de pausa para un SDK de anuncios (ads.js); sin SDK no hace nada
    this.stats = this.newStats(); // estadísticas del intento (ver recordAttack / statsSummary)
    this.bpal = RED;       // paleta de sangre en uso (roja; verde tóxica para las bajas del tubo oxidado)
    this.guilt = null;     // culpa por haber matado a un civil: { t } cuenta atrás hasta que el jugador vomita (ver Player.startVomit)
    this.buff = null;      // lata de la máquina expendedora: { t, max } (+velocidad, +cadencia; solo esta partida)
    this.streetRun = newStreetRun(); // moneda, teléfono y reto del piso (sobrevive a R; se reinicia por piso)
    this.maskDrops = [];   // máscaras caídas de un portador: { x, y, mask, t } (ver dropMask)
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
    // Anuncio en pantalla (ads.js): la simulación NO avanza (y el audio está silenciado); se sigue dibujando el último fotograma.
    if (this.ads.active) { this.acc = 0; this.render(); requestAnimationFrame(this.loop); return; }
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
    this.lore.enterFloor(index); // presupuesto de piezas narrativas por piso
    this.sfx.pickTrack(); // pista de combate del piso nuevo (sin repetir la última); con R se conserva
    this.levelIndex = index;
    this.streetRun = newStreetRun();
    this.civilianBase = cloneKarma(this.civilianRecord); // el karma CONFIRMADO al entrar al piso: lo ocurrido en el piso anterior ya cuenta; R descarta lo del piso en curso
    this.trapRetry = false; this.finalRetry = false; this.finalRole = null; this.trapCheckpoint = null; this.finalCheckpoint = null;
    this.score.startLevel();
    this.scuffleCount = 0;
    this.resetStains(); // el siguiente piso se empieza limpio: ropa y máscara sin sangre
    this.entered = false;
    this.entryWeapon = null;
    this.reset({ arrival: true });
    this.openMaskSelect();
  }

  // --- Selección de máscara ---------------------------------------------------------------
  // El piso ya está cargado detrás (se ve atenuado); al confirmar se recarga con la pasiva.

  openMaskSelect() {
    this.state = 'masks';
    this.maskPhase = 'main'; // 'main' | 'support' (pisos con compañero: primero la tuya y luego la de apoyo)
    this.maskIndex = this.maskList.indexOf(this.mask);
    // Posición inicial del ratón: solo un movimiento real cambia la selección.
    this.maskMouse = this.mouseInternal();
    this.lore.onMaskSelect(); // V1 (la lista) la primera vez, en el piso 1
  }

  confirmMask() {
    if (!this.isMaskUnlocked(this.maskList[this.maskIndex])) this.maskIndex = this.maskList.findIndex((m) => this.isMaskUnlocked(m));
    // Piso con compañero (`duo`): tras elegir la tuya se elige la MÁSCARA DE APOYO (distinta, si hay más de una desbloqueada).
    if (LEVELS[this.levelIndex].duo) {
      const free = this.maskList.filter((m) => this.isMaskUnlocked(m)).length;
      if (this.maskPhase !== 'support') {
        this.mainMaskIndex = this.maskIndex;
        this.maskPhase = 'support';
        this.maskIndex = this.maskList.findIndex((m, i) => i !== this.mainMaskIndex && this.isMaskUnlocked(m));
        if (this.maskIndex < 0) this.maskIndex = this.mainMaskIndex;
        this.sfx.play('pickup');
        return;
      }
      if (this.maskIndex === this.mainMaskIndex && free > 1) { this.deniedMask(); return; }
      this.partnerMaskIndex = this.maskIndex;
      this.maskIndex = this.mainMaskIndex;
      this.maskPhase = 'main';
    }
    this.mask = this.maskList[this.maskIndex];
    this.reset({ arrival: true });
    this.beginArrival();
    this.player.cooldown = 0.3; // que el clic de confirmar no se convierta en un golpe
    this.sfx.play('pickup');
  }

  // Rectángulos de las tarjetas (en píxeles internos), compartidos por el dibujo y el ratón.
  // Composición de ELIGE TU MÁSCARA (de arriba abajo): título (y 6) · subtítulo (y 25) · selector de agente JACK / VEX (y 36) ·
  // las 5 tarjetas de máscara · una franja con el visor de vista previa del agente a la izquierda y el nombre y la pasiva de la máscara a su
  // derecha · una sola línea de ayuda al pie. Las tarjetas se reducen lo justo para que quepa la franja (iconScale 2..5).
  maskLayout() {
    const w = this.scene.width, h = this.scene.height, n = this.maskList.length, gap = 6, sf = this.safe;
    const cardW = clamp(Math.floor((w - 16 - gap * (n - 1)) / n), 40, 78);
    const touch = this.input.touchMode;
    const bh = touch ? Math.max(16, Math.round(this.touch.px(36))) : 14, bw = 74;
    const selY = 37;
    const cardsTop = selY + bh + 8;
    const bandH = 64, footer = 16 + sf.b;
    const avail = h - cardsTop - 8 - bandH - footer;
    const iconScale = clamp(Math.min(Math.floor((cardW - 12) / 12), Math.floor((avail - 22) / 12)), 2, 5);
    const cardH = 12 * iconScale + 22;
    const x0 = Math.round((w - (n * cardW + (n - 1) * gap)) / 2);
    const cards = this.maskList.map((_, i) => ({ x: x0 + i * (cardW + gap), y: cardsTop, w: cardW, h: cardH }));
    const genders = [
      { id: 'male', x: Math.round(w / 2 - bw - 4), y: selY, w: bw, h: bh },
      { id: 'female', x: Math.round(w / 2 + 4), y: selY, w: bw, h: bh },
    ];
    const bandTop = Math.min(cardsTop + cardH + 8, h - footer - bandH);
    const prevW = 64, descW = clamp(w - 16 - prevW - 10, 130, 222);
    const bx = Math.round((w - (prevW + 10 + descW)) / 2);
    return { cards, iconScale, bottom: cardsTop + cardH, genders, bandTop, preview: { x: bx, y: bandTop, w: prevW, h: bandH }, descCx: Math.round(bx + prevW + 10 + descW / 2) };
  }

  // ¿Se puede usar la máscara? (STRIKE, BLADE y GHOST hasta abatir a su portador; ver settings.unlockMask)
  isMaskUnlocked(mask) {
    return this.settings.isMaskUnlocked(mask.id);
  }

  // Máscaras de la selección: las de siempre y las SECRETAS ya encontradas (RICK: ver lootRick).
  get maskList() { return MASKS.filter((m) => !m.secret || this.settings.isMaskUnlocked(m.id)); }

  maskLockHint(mask) {
    return `BUSCA AL PORTADOR EN PISO ${mask.lockFloor}`;
  }

  // Intentar empezar con una máscara bloqueada: sacudida, sonido y la pista en rojo (no se entra al piso).
  deniedMask() {
    this.maskDenied = performance.now();
    this.sfx.play('empty');
    this.camera.addShake(2);
  }

  pickGender(id) {
    if (this.maskPhase === 'support' && LEVELS[this.levelIndex].duo) { this.deniedMask(); return; } // el primer protagonista ya está elegido: el equipo es mixto, el compañero es el otro
    if (this.gender === id) return;
    this.settings.set('playerGender', id); // se guarda y llama a setGender
    this.sfx.play('pickup');
  }

  updateMaskSelect() {
    const input = this.input, n = this.maskList.length;
    if (this.prologue && this.flow.updateMaskSkip(input)) return; // saltar exige MANTENER P (o el botón táctil): ver PrologueFlow
    const prev = this.maskIndex;
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.maskIndex = (this.maskIndex + n - 1) % n;
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.maskIndex = (this.maskIndex + 1) % n;
    // Agente (solo cosmético): Q / ↑ / W = JACK · E / ↓ / S = VEX, o tocar / pulsar su botón.
    const wantMale = input.wasPressed('KeyQ') || input.wasPressed('ArrowUp') || input.wasPressed('KeyW');
    const wantFemale = input.wasPressed('KeyE') || input.wasPressed('ArrowDown') || input.wasPressed('KeyS');
    if (wantMale) this.pickGender('male');
    else if (wantFemale) this.pickGender('female');

    // Ratón: pasar por encima selecciona (solo si se ha movido), clic confirma.
    const m = this.mouseInternal();
    const moved = Math.hypot(m.x - this.maskMouse.x, m.y - this.maskMouse.y) > 0.5;
    this.maskMouse = m;
    const lay = this.maskLayout();
    const hovered = lay.cards.findIndex((c) => m.x >= c.x && m.x < c.x + c.w && m.y >= c.y && m.y < c.y + c.h);
    if (input.mousePressed.left) {
      const gb = lay.genders.find((b) => m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h);
      if (gb) { this.pickGender(gb.id); return; } // clic / toque en JACK o VEX: no empieza el piso
    }
    if (hovered >= 0 && moved) this.maskIndex = hovered;
    if (this.maskIndex !== prev) this.sfx.play('empty');

    // En táctil, el primer toque en una máscara solo la elige (para leer su pasiva); tocar la
    // ya elegida empieza el piso.
    if (input.touchMode && input.mousePressed.left && hovered >= 0 && hovered !== prev) return;
    if (input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter')
      || (input.mousePressed.left && hovered >= 0)) {
      if (hovered >= 0 && input.mousePressed.left) this.maskIndex = hovered;
      if (!this.isMaskUnlocked(this.maskList[this.maskIndex])) { this.deniedMask(); return; } // bloqueada: se puede mirar pero no elegir
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
      // En el prólogo el botón de saltar ocupa el hueco de RÉCORDS (arriba a la derecha): en otro sitio pisaba las tarjetas de máscara.
      if (this.prologue) {
        const skip = sized('skip', w < 360 ? 'SALTAR' : 'SALTAR (MANTÉN)', 'KeyP', COLORS.enemy);
        return [back, { ...skip, x: w - 6 - s.r - skip.w, y: 6 + s.t }];
      }
      const list = [back, { ...records, x: w - 6 - s.r - records.w, y: 6 + s.t }];
      return list;
    }
    if (this.state === 'dead') {
      return row([['retry', 'REINTENTAR', 'KeyR', COLORS.player], ['end', this.endAskActive() ? '¿SEGURO?' : 'TERMINAR', 'Escape', COLORS.blood],
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
    const en = e.kind === 'shield' ? new ShieldGuard(e.x, e.y, e.patrol, weapon, e.melee) : new Enemy(e.x, e.y, e.patrol, weapon, e.kind, e.melee);
    // Portador: solo si su máscara aún no está desbloqueada (si no, es un enemigo normal).
    if (e.carrier && !this.settings.isMaskUnlocked(e.carrier)) en.setCarrier(e.carrier);
    if (e.dummy) en.dummy = true; // maniquí del campo de pruebas
    if (e.keyCarrier) en.hasKey = true; // lleva la llave de la puerta principal (piso 3): la suelta al caer
    if (e.scared) en.scared = true; // asustado: se paraliza al verte (prólogo; ver Enemy.freeze)
    if (e.activity && e.activity !== 'patrol') en.setActivity(e.activity, e.seatAngle ?? null); // fumando, sentado o vigilando (ver placeActivities en map.js)
    return en;
  }

  // Agente (JACK = 'male' / VEX = 'female'): SOLO cosmético. Cambia el sprite del jugador, su retrato en el duelo VS y el tono de su voz
  // (`sfx.voice`); no toca velocidad, hitbox, daño ni pasivas, que son de las máscaras.
  get gender() {
    return this.settings.get('playerGender') === 'female' ? 'female' : 'male';
  }

  setGender(v) {
    const g = v === 'female' ? 'female' : 'male';
    for (const pl of [this.player, this.partner]) if (pl) pl.gender = pl.agentId === 'main' ? g : (g === 'female' ? 'male' : 'female'); // el compañero es el otro agente
    this.sfx.voice = this.player && this.player.gender === 'female' ? 1.22 : 1;
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
  endAskActive() { return performance.now() - (this.endAskAt || 0) < 3000; }

  restartLevel() {
    const retry = () => {
      this.score.restartLevel();
      // R rebobina la calle: los civiles vuelven a estar vivos y sin su moneda, y el karma al confirmado, así que las monedas que diste en este piso vuelven contigo (si no, se perdían sin que el gesto contara).
      if (this.streetRun && this.streetRun.giftSpent) { this.streetRun.coins += this.streetRun.giftSpent; this.streetRun.giftSpent = 0; }
      this.reset();
    };
    // PUNTO DE ANUNCIO: tras X muertes (ads.js). Sin SDK conectado es instantáneo; con SDK el anuncio sale antes del reintento.
    if (this.state === 'dead' && this.ads.countDeath()) this.ads.triggerInterstitial(retry);
    else retry();
  }

  // Tras la pantalla de resultados: siguiente piso, o fin de partida si era el último.
  advance() {
    // PUNTO DE ANUNCIO: entre pisos (ads.js). Sin SDK conectado continúa al instante.
    this.ads.triggerInterstitial(() => {
      if (this.levelIndex + 1 < LEVELS.length) this.goToLevel(this.levelIndex + 1);
      else this.endRun(true);
    });
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
      initials: this.history.lastInitials() || null, // hasta que se firme, lleva la última firma usada
    });
  }

  // Fin de partida: edificio completado o muerte definitiva (Enter en la pantalla de muerte).
  endRun(completed) {
    const position = this.saveRun(completed);
    this.runSummary = { completed, score: this.score.total, position, newRecord: this.score.isRecord };
    this.showRecords = false;
    this.sfx.setMusic('menu');
    if (position) {
      // Entra en la tabla: antes de enseñarla, se pide la firma (iniciales de arcade).
      this.startInitials(position);
      this.sfx.play('clear');
    } else if (!completed) {
      // Abandonar tras morir SIN entrar al Top 5: directo al menú con un aviso breve (la tabla de récords es para quien bate algo o termina el edificio).
      this.openMenu();
      this.showToast(`FIN DE PARTIDA · PISO ${this.levelIndex + 1} · ${this.score.total.toLocaleString('es')} PTS`, 3);
    } else {
      this.state = 'gameover';
    }
  }

  // --- Firma del récord (iniciales de arcade) -----------------------------------------------------
  // Estado 'initials': hasta INITIALS_MAX caracteres A-Z / 0-9 / blanco. PC: escribir (A-Z, 0-9; Espacio = blanco),
  // Retroceso borra, flechas ↑/↓ cambian la letra de la casilla y ←/→ de casilla, Enter confirma. Táctil (y también con
  // ratón): botones ▲ ▼ sobre y bajo cada casilla, ⌫ y un gran CONFIRMAR, sin teclado del sistema. La última firma
  // usada sale preseleccionada. Al confirmar se guarda en la entrada (`history.setInitials`) y se enseña la tabla.
  startInitials(position) {
    const last = this.history.lastInitials();
    const chars = Array.from({ length: INITIALS_MAX }, (_, i) => last[i] || ' ');
    this.initials = { chars, cursor: Math.min(last.length, INITIALS_MAX - 1), position, shake: 0 };
    this.state = 'initials';
    this.input.pressed.clear(); // la tecla con la que se murió no se escribe
  }

  initialsText() {
    return this.initials.chars.join('').trim();
  }

  // Casillas y botones (compartido por dibujo y puntero). Tamaño pensado para el dedo en táctil.
  initialsLayout() {
    const w = this.scene.width, h = this.scene.height, s = this.safe;
    const touch = this.input.touchMode;
    const cell = touch ? clamp(Math.round(this.touch.px(46)), 22, 38) : 24;
    const gap = 6, n = INITIALS_MAX;
    const rowW = n * cell + (n - 1) * gap;
    const x0 = Math.round((w - rowW) / 2);
    const slotH = Math.round(cell * 1.25), arrH = Math.round(cell * 0.7);
    const yUp = Math.max(66, Math.round(h * 0.3)) + s.t;
    const yS = yUp + arrH + 3, yD = yS + slotH + 3, yB = yD + arrH + 8;
    const slots = [], ups = [], downs = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cell + gap);
      ups.push({ x, y: yUp, w: cell, h: arrH });
      slots.push({ x, y: yS, w: cell, h: slotH });
      downs.push({ x, y: yD, w: cell, h: arrH });
    }
    const bh = arrH + 4, backW = Math.round(cell * 1.5);
    const back = { x: x0, y: yB, w: backW, h: bh };
    const ok = { x: x0 + backW + gap, y: yB, w: rowW - backW - gap, h: bh };
    return { slots, ups, downs, back, ok, cell, rowW, x0, yB, bh };
  }

  cycleInitial(i, dir) {
    const set = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const st = this.initials;
    const k = set.indexOf(st.chars[i]);
    st.chars[i] = set[(k + dir + set.length) % set.length];
    st.cursor = i;
    this.sfx.play('empty');
  }

  typeInitial(ch) {
    const st = this.initials;
    st.chars[st.cursor] = ch;
    st.cursor = Math.min(INITIALS_MAX - 1, st.cursor + 1);
    this.sfx.play('pickup');
  }

  backInitial() {
    const st = this.initials;
    if (st.chars[st.cursor] !== ' ') st.chars[st.cursor] = ' ';
    else if (st.cursor > 0) { st.cursor--; st.chars[st.cursor] = ' '; }
    this.sfx.play('empty');
  }

  confirmInitials() {
    const st = this.initials, name = this.initialsText();
    if (!name) { st.shake = 1; this.sfx.play('empty'); return; } // al menos una letra
    this.history.setInitials(this.runId, name);
    this.initials = null;
    this.state = 'gameover';
    this.sfx.play('clear');
  }

  updateInitials(dt) {
    const st = this.initials, input = this.input;
    st.shake = Math.max(0, st.shake - dt * 4);
    for (const code of input.pressed) {
      let m;
      if ((m = /^Key([A-Z])$/.exec(code))) this.typeInitial(m[1]);
      else if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) this.typeInitial(m[1]);
      else if (code === 'Space') this.typeInitial(' ');
      else if (code === 'Backspace' || code === 'Delete') this.backInitial();
      else if (code === 'ArrowUp') this.cycleInitial(st.cursor, 1);
      else if (code === 'ArrowDown') this.cycleInitial(st.cursor, -1);
      else if (code === 'ArrowLeft') st.cursor = Math.max(0, st.cursor - 1);
      else if (code === 'ArrowRight') st.cursor = Math.min(INITIALS_MAX - 1, st.cursor + 1);
      else if (code === 'Enter' || code === 'NumpadEnter') { this.confirmInitials(); return; }
    }
    // Ratón / toque: ▲ ▼ sobre cada casilla, tocar una casilla la selecciona, ⌫ y CONFIRMAR.
    if (input.mousePressed.left) {
      const L = this.initialsLayout(), m = this.mouseInternal();
      const inside = (r) => m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
      for (let i = 0; i < INITIALS_MAX; i++) {
        if (inside(L.ups[i])) this.cycleInitial(i, 1);
        else if (inside(L.downs[i])) this.cycleInitial(i, -1);
        else if (inside(L.slots[i])) { st.cursor = i; this.sfx.play('empty'); }
      }
      if (inside(L.back)) { this.backInitial(); this.touch.haptic(8); }
      else if (inside(L.ok)) { this.confirmInitials(); this.touch.haptic(15); }
    }
  }

  // Pantalla "¡NUEVO RÉCORD! INGRESA TUS INICIALES" estilo máquina recreativa.
  drawInitials(ctx, w, h) {
    const st = this.initials, s = this.runSummary;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.94)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2), now = performance.now();
    const title = s.newRecord ? '¡NUEVO RÉCORD!' : `¡ENTRAS EN EL TOP ${MAX_ENTRIES}!`;
    ctx.save();
    const tc = this.recordColor();
    ctx.shadowColor = tc;
    ctx.shadowBlur = 10;
    drawText(ctx, title, cx, 8 + this.safe.t, { color: tc, scale: this.fitScale(title, w - 12, 2), align: 'center', shadow: null });
    ctx.restore();
    drawText(ctx, 'INGRESA TUS INICIALES', cx, 28 + this.safe.t, { color: COLORS.text, scale: this.fitScale('INGRESA TUS INICIALES', w - 12, 2), align: 'center', shadow: COLORS.wall });
    drawText(ctx, `${this.placeLabel(st.position)} · ${s.score.toLocaleString('es')} PTS`, cx, 49 + this.safe.t, { color: COLORS.enemy, align: 'center' });

    const L = this.initialsLayout();
    const tri = (r, up, color) => {
      // Triángulo de píxeles (▲ / ▼) centrado en el botón.
      const rows = Math.max(3, Math.min(8, Math.floor(r.h * 0.5)));
      ctx.fillStyle = color;
      for (let k = 0; k < rows; k++) {
        const wd = 2 * (up ? k : rows - 1 - k) + 1;
        ctx.fillRect(Math.round(r.x + r.w / 2 - wd / 2), Math.round(r.y + r.h / 2 - rows / 2 + k), wd, 1);
      }
    };
    const box = (r, color, fill) => {
      ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
      ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    };
    const shake = st.shake > 0 ? (Math.floor(now / 40) % 2 ? 2 : -2) * st.shake : 0;
    for (let i = 0; i < INITIALS_MAX; i++) {
      const sel = i === st.cursor, blink = Math.floor(now / 350) % 2 === 0;
      box(L.ups[i], sel ? COLORS.wall : '#3a2a55', '#140a24'); tri(L.ups[i], true, sel ? COLORS.wall : '#7d6f98');
      box(L.downs[i], sel ? COLORS.wall : '#3a2a55', '#140a24'); tri(L.downs[i], false, sel ? COLORS.wall : '#7d6f98');
      const r = { x: L.slots[i].x + shake, y: L.slots[i].y, w: L.slots[i].w, h: L.slots[i].h };
      box(r, sel ? COLORS.player : '#3a2a55', sel ? '#16103a' : '#0d0221');
      const ch = st.chars[i];
      ctx.save();
      if (sel) { ctx.shadowColor = COLORS.player; ctx.shadowBlur = 8; }
      if (ch !== ' ') {
        const sc = L.cell >= 30 ? 4 : 3;
        drawText(ctx, ch, r.x + r.w / 2, r.y + Math.round((r.h - CELL_H * sc) / 2), { color: sel ? '#ffffff' : COLORS.player, scale: sc, align: 'center', shadow: null });
      } else if (!sel || blink) {
        ctx.fillStyle = sel ? COLORS.player : '#4a3d66';
        ctx.fillRect(r.x + 4, r.y + r.h - 7, r.w - 8, 2); // casilla vacía: guion bajo
      }
      ctx.restore();
    }
    // ⌫ (flecha izquierda con "x") y CONFIRMAR
    box(L.back, '#7d6f98', '#140a24');
    ctx.fillStyle = COLORS.text;
    const by = Math.round(L.back.y + L.back.h / 2), bx = Math.round(L.back.x + L.back.w / 2);
    for (let k = 0; k < 4; k++) ctx.fillRect(bx - 8 + k, by - 3 + k, 1, 7 - 2 * k); // punta de flecha
    ctx.fillRect(bx - 4, by - 1, 12, 3);
    const okReady = !!this.initialsText();
    const pulse = okReady && Math.floor(now / 250) % 2 === 0;
    ctx.save();
    if (okReady) { ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 9; }
    box(L.ok, okReady ? (pulse ? '#ffffff' : COLORS.wall) : '#3a2a55', okReady ? '#2a0d3a' : '#140a24');
    ctx.restore();
    const okTxt = 'CONFIRMAR';
    drawText(ctx, okTxt, L.ok.x + L.ok.w / 2, L.ok.y + Math.round((L.ok.h - CELL_H * this.fitScale(okTxt, L.ok.w - 8, 2)) / 2),
      { color: okReady ? COLORS.text : '#4a3d66', scale: this.fitScale(okTxt, L.ok.w - 8, 2), align: 'center', shadow: null });
    if (!this.input.touchMode) {
      drawText(ctx, 'ESCRIBE · FLECHAS: LETRA Y CASILLA · RETROCESO: BORRAR · ENTER: CONFIRMAR', cx, h - 12 - this.safe.b, { color: '#7d6f98', align: 'center' });
    }
  }

  placeLabel(n) {
    return ['1ST', '2ND', '3RD', '4TH', '5TH'][n - 1] || `${n}TH`;
  }

  newRun() {
    this.startRunAt(0);
  }

  // Al pisar la salida (con la pantalla ya en negro): resultados, Top 5 y estadísticas del piso.
  finishFloor() {
    if (this.prologue) { this.endPrologue(); return; } // el prólogo no tiene resultados ni guarda nada
    if (this.lore.beforeResults(() => this.finishFloor())) return; // V7 (cara o cruz) antes de los resultados del último piso
    this.state = 'results';
    this.resultsAge = 0;
    const challenge = this.street.settle(); // reto de la cabina telefónica (suma su bonus antes del rango)
    // (Los civiles ya no puntúan ni penalizan: lo que hiciste con ellos queda en el karma invisible, que se confirma aquí al completar el piso: ver goToLevel.)
    // Rehenes abatidos por el jugador: −2000 cada uno (los liberados ya sumaron +1500 al soltarlos).
    const hs = this.hostages.summary();
    hs.penalty = Math.min(hs.penalty, Math.max(0, this.score.levelScore));
    if (hs.penalty > 0) this.score.addBonus(-hs.penalty);
    this.results = this.score.finishLevel(this.time, this.par, this.enemies.length);
    this.results.challenge = challenge;
    this.results.hostages = hs.total > 0 ? hs : null;
    this.results.last = this.levelIndex === LEVELS.length - 1;
    this.results.stats = this.statsSummary(); // el panel se queda fijo aunque luego se reinicie el estado
    // Se guarda al completar cada piso: si se cierra la pestaña, el progreso ya cuenta.
    this.results.position = this.saveRun(this.results.last);
    this.floorStats.record(this.levelIndex + 1, this.results.rank, this.results.levelScore);
  }

  // Dibuja `fn(ctx)` con el HUD atenuado según las barras de cine (`cineK`): visible del todo sin ellas, nada con ellas, y a medias mientras se deslizan
  // (en una capa aparte, porque el HUD asigna `globalAlpha` por su cuenta).
  fadeHud(ctx, w, h, fn) {
    const a = 1 - this.cineK;
    if (a >= 0.995) { fn(ctx); return; }
    if (a <= 0.005) return;
    if (!this._hudLayer || this._hudLayer.width !== w || this._hudLayer.height !== h) {
      this._hudLayer = document.createElement('canvas');
      this._hudLayer.width = w; this._hudLayer.height = h;
    }
    const hc = this._hudLayer.getContext('2d');
    hc.imageSmoothingEnabled = false;
    hc.clearRect(0, 0, w, h);
    fn(hc);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(this._hudLayer, 0, 0);
    ctx.restore();
  }

  // Nivel de IA enemiga (opción IA ENEMIGA): TONTOS / PROMEDIO / GENIOS; ver AI en enemy.js.
  setAiLevel(v) { setAiLevel(v); }

  // ¿Animación del agente al cerrar / abrir la puerta principal? (opción ANIMACIÓN DE LA PUERTA)
  get doorAnimOn() { return this.settings.get('doorAnim') !== false; }

  // --- Prólogo: delegadores finos (la lógica y el estado viven en PrologueFlow, `game.flow`) ---------------------------
  prologueLine(id) { this.flow.line(id); }          // línea de lore por momento (la usa Hostages al liberar al compañero)
  updatePrologue(dt) { this.flow.update(dt); }
  drawTutorial(ctx) { this.flow.drawTutorial(ctx); }
  endPrologue() { this.flow.end(); }                // fin del prólogo (huida en moto): campaña
  skipPrologue() { this.flow.skip(); }              // saltarlo (P mantenida, botón táctil o pausa)

  // Partida nueva empezando en el piso `index` (desde el menú o el selector de pisos).
  // CAMPO DE PRUEBAS: se entra directo (sin selección de máscara, llegada en moto ni bloqueo): ya dentro, con la máscara puesta y sin arma. Nada de lo que pase aquí se guarda.
  startTestRange() {
    if (!this.testRangeDef) return; // el nivel solo se carga en desarrollo (main.js): en el build publicado no existe
    this.sfx.pickTrack();
    this.runId = newRunId();
    this.prologue = false; this.testRange = true;
    this.comms.forget(); this.flow.forget();
    this.buff = null;
    this.streetRun = newStreetRun();
    this.civilianBase = newKarma();
    this.trapRetry = false; this.finalRetry = false; this.finalRole = null; this.trapCheckpoint = null; this.finalCheckpoint = null;
    this.score.newRun(this.history.best());
    this.resetStains();
    this.scuffleCount = 0;
    this.levelIndex = 0;
    this.mask = this.mask || MASKS[0];
    this.entered = true;
    this.entryWeapon = null;
    this.reset();
    this.showCallout('CAMPO DE PRUEBAS', COLORS.player, 3.2, 'ELIGE UN ARMA DEL MOSTRADOR · LOS MANIQUÍES NO SE MUEVEN');
  }

  startRunAt(index, prologue = false) {
    this.lore.startRun(index, prologue); // piezas narrativas: otra partida, vuelven a poder salir (y las de pisos anteriores al de salida se descartan)
    this.sfx.pickTrack(); // pista de combate de la partida nueva (sin repetir la última)
    this.runId = newRunId();
    this.prologue = prologue; this.testRange = false;
    this.comms.forget(); this.flow.forget();
    this.buff = null;
    this.streetRun = newStreetRun();
    this.civilianBase = newKarma(); // el karma con los civiles se acumula durante toda la partida (y se confirma al completar cada piso)
    this.trapRetry = false; this.finalRetry = false; this.finalRole = null; this.trapCheckpoint = null; this.finalCheckpoint = null;
    this.score.newRun(this.history.best());
    this.resetStains();
    this.scuffleCount = 0;
    this.levelIndex = index;
    this.entered = false;
    this.entryWeapon = null;
    this.reset({ arrival: true });
    this.openMaskSelect();
  }

  openMenu(screen = 'title') {
    if (this.sewerRun) this.restoreFromSewer();
    this.state = 'menu';
    this.prologue = false; this.testRange = false;
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
    this.descent = null; this.climb = null; this.emerge = null; this.finalExit = null;
    if (this.sewerRun) this.restoreFromSewer(); // R dentro del túnel: se vuelve a la calle (aún no se había entrado al edificio)
    if (this.swapped) { this.swapBundles(); this.swapped = false; } // R: vuelve a controlar al primer agente con su máscara y su sangre
    // Armas aleatorias con semilla por partida y piso: al reintentar (R) todo sigue en su sitio;
    // en una partida nueva cambian.
    this.sfx.stopMoto(0.05); // R, piso nuevo...: si la moto sonaba, se corta limpia
    const level = loadLevel(this.levelIndex, seededRandom(hashString(`${this.runId}:${this.levelIndex}`)), this.prologue ? PROLOGUE_DEF : this.testRange ? this.testRangeDef : null);
    if (this.prologue) this.flow.dressPartner(level); // el compañero es el otro agente (la otra máscara se la cedes al liberarlo)
    this.levelName = level.name;
    this.dark = level.dark;       // piso en penumbra (ver map.dark y renderDark)
    this.strobe = level.strobe;   // el club: luces estroboscópicas (opción `strobeEnabled`)
    this.hasBoss = level.boss;
    this.par = level.par;
    this.map = level.map;
    this.ladderRoom = level.ladderRoom || null; // piso 10: el compañero llega por la escalera de un cuarto de servicio (ver beginTrap / updateRadio)
    this.sewerRoute = level.sewerRoute; this.keyRoute = !!level.key; this.hasKey = false; this.keyDrop = null; // piso 3: ver beginSewer / dropKey
    const retryInside = !arrival && this.entered;
    const start = retryInside ? (level.sewerRoute ? level.sewerRoute.service : level.entry) : level.player; // con la ruta de la alcantarilla, R reaparece en el cuarto de servicio
    this.player = new Player(start.x, start.y, maskEffects(this.mask), this.mask.id, retryInside);
    this.player.gender = this.gender;
    this.player.agentId = 'main';
    this.sfx.voice = this.gender === 'female' ? 1.22 : 1;
    this.player.angle = -Math.PI / 2; // mira al edificio
    if (retryInside) this.player.weapon = this.entryWeapon ? { ...this.entryWeapon } : null;
    this.player.bloodLevel = this.goreOn ? bloodLevelFor(this.gore) : 0;
    // Compañero del relevo (pisos `duo`, o con la tecla de debug P): el otro agente, quieto y vulnerable hasta que se le pasa el control.
    this.partner = null;
    this.duoOn = !!level.duo || !!this.debugDuo;
    if (this.duoOn) this.makePartner(retryInside ? level.entry : level.player);
    this.spawn = { x: level.player.x, y: level.player.y }; // la acera, junto a la moto
    this.entry = level.entry;
    this.bike = { park: { x: level.bike.x, y: level.bike.y }, w: level.bike.w, h: level.bike.h, x: level.bike.x, y: level.bike.y, riding: false };
    this.inside = retryInside;
    this.cine = null;
    this.callout = null;
    this.goalAge = 0;
    this.floatingTexts.length = 0;
    this.stats = this.newStats();
    this.maskDrops.length = 0;
    this.scuffle = null;      // si se reinicia en pleno forcejeo: cámara y audio vuelven a la normalidad
    this.scuffleGrace = 0;
    this.camera.mul = this.camera.mulTarget = 1;
    this.sfx.setSlowMo(false);
    this.enemies = level.enemies.map((e) => this.makeEnemy(e));
    this.allies = []; // aliados civiles de la fase final del piso 10 (karma bueno: ver spawnAllies)
    this.levelEnemyCount = this.enemies.length;
    this.rangeSlots = level.rangeSlots ? level.rangeSlots.map((s) => ({ ...s, t: 0 })) : null; this.rangeDefs = this.testRange ? level.enemies : null; // campo de pruebas: huecos de armas y definiciones para reaparecer los maniquís // (los refuerzos de la trampilla se añaden después: ver spawnAmbushEnemy)
    this.pickups = level.weapons.map((w) => new Pickup(w.type, w.x, w.y));
    this.doors = level.doors.map((d) => new Door(d.tx, d.ty, d.horizontal, d.main));
    this.mainDoor = this.doors.find((d) => d.main);
    if (retryInside || level.sewerRoute) this.mainDoor.locked = true; // (piso 3: la puerta principal está cerrada por dentro desde el principio)
    this.map.doors = this.doors;
    this.bullets = [];
    this.particles.clear();
    this.prints.clear();
    this.sewer = new Sewer(this.map.sewers); // easter egg: cocodrilo en la alcantarilla (la tapa de la entrada real se dibuja cerrada y nunca lo suelta: ver Sewer.update)
    this.lore.onReset(); // la tapa fija del piso 10 queda entreabierta (V6)
    this.sewer.bind(this);
    this.guilt = null;
    this.street = new StreetLife(this); // contenedores, moneda, máquina, cabina y vagabundo de la calle
    this.runover = null; // atropello en curso (ver runOver)
    this.deathMsg = null; // mensaje propio de la pantalla de muerte (compañero caído)
    this.leaveAsk = 0;   // rehenes sin rescatar de los que se avisa junto a la moto (0 = nada que avisar)
    this.cams = new SecurityCams(this, level.cameras || []); // cámaras de seguridad y operador (piso 8)
    this.comms.clear(); this.flow.resetAttempt(); this.doorPending = false;
    this.hostages = new Hostages(this, level.hostages || []); // rehenes atados a sillas dentro del edificio (ver hostages.js)
    this.pools = [];
    // masks (selección) | arriving (llega en moto) | playing (fuera o dentro: ver `inside`) | dead |
    // cleared (despejado: vuelve a la moto) | leaving (se sube y se va) | results
    this.state = 'playing';
    this.time = 0;
    this.hitstop = 0;
    this.results = null;
    this.showRecords = false;
    this.bannerTimer = INTRO_BANNER_TIME;
    this.sfx.setMusic(retryInside && !this.testRange ? 'action' : 'menu'); // la música de combate empieza al entrar (el campo de pruebas, siempre tranquilo)

    // Las capas estáticas solo se regeneran al cambiar de piso O de partida: la calle exterior es distinta en cada partida (runId),
    // y con R (mismo piso y partida) se conservan.
    const layersKey = `${this.levelIndex}${this.prologue ? 'p' : ''}${this.testRange ? 't' : ''}:${this.runId}`;
    if (this.layersLevel !== layersKey) {
      this.layersLevel = layersKey;
      this.floorLayer = renderFloor(this.map);
      const { walls, glow } = renderWalls(this.map);
      this.wallLayer = walls;
      this.glowLayer = glow;
      this.propsLayer = renderProps(this.map); // muebles sólidos
      this.darkLayer = this.map.dark ? renderDark(this.map) : null; // penumbra y charcos de neón (piso 7)
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
    // Trampa de gas (piso 10): hasta que el primer agente entre en el despacho el compañero aún no ha llegado (`away`). Reintentar con R tras empezar la trampa
    // vuelve a la fase 2: primer agente atrapado y gas a 45 s, control en el compañero a la entrada.
    this.trap = level.trap ? { ...level.trap, state: 'idle', t: GAS_TIME, hold: 0, cough: 1.2, victim: null, fade: 0 } : null;
    this.asphyx = null;
    this.endAskAt = 0;
    this.ending = null; this.rider = null; this.endingRide = false; this.endingDone = false; // final: detonación, huida, beso y salida en moto
    this.destroyed = 0; this.sunset = 0; this.blasts = []; this.hearts = []; this.flashT = 0; this.detHold = 0; this.detNear = false;
    this.hatch = level.trap && level.trap.hatch ? { ...level.trap.hatch, state: 'closed', open: 0, used: false } : null; // trampilla de la emboscada
    this.ambush = null;
    this.final = null; this.reunion = null; // fase final (reencuentro y rol): ver beginFinal
    this.civilianRecord = cloneKarma(this.civilianBase || newKarma()); // los civiles vuelven a empezar con R: el karma, al confirmado en la entrada al piso
    if (this.trap) {
      if (this.partner) this.partner.away = true;
      if (this.finalRetry && this.finalRole && retryInside) this.beginFinal(this.finalRole, true); // el rol elegido se conserva con R
      else if (this.trapRetry && retryInside) this.beginTrap(true);
    }
    this.camera.snap(this.player.x, this.player.y);
  }

  update(dt) {
    const input = this.input;
    const cineTo = this.state === 'arriving' || this.state === 'leaving' ? 1 : 0;   // barras de cine: se deslizan y el HUD se desvanece / reaparece
    this.cineK += (cineTo - this.cineK) * (1 - Math.exp(-7 * dt));
    if (Math.abs(cineTo - this.cineK) < 0.01) this.cineK = cineTo;
    // Primero los controles táctiles: traducen los dedos a teclas/clics que se leen abajo.
    this.touch.update(dt);
    // Filtro VS: entra y sale con suavidad (también al resolverse el forcejeo o reiniciar).
    this.scuffleI += ((this.state === 'scuffle' ? 1 : 0) - this.scuffleI) * (1 - Math.exp(-9 * dt));
    if (this.scuffleI < 0.005) this.scuffleI = 0;
    // En vertical (táctil) todo queda en pausa hasta que se gire el dispositivo.
    if (this.needsRotate) return;
    // Estas teclas funcionan siempre, incluso durante el hit-stop o muerto.
    if (input.wasPressed('F1') && this.state !== 'initials') this.debug = !this.debug;
    // Debug (con F1 activo): P = aparece / desaparece el compañero · L = relevo de control.
    if (this.debug && input.wasPressed('KeyP')) this.toggleDebugPartner();
    if (this.debug && input.wasPressed('KeyL')) this.swapControl();
    const typing = this.state === 'initials'; // escribiendo la firma: M, V y F1 son letras
    if (input.wasPressed('KeyM') && !typing) this.sfx.toggleMute();
    // V: completos ↔ desactivados (si estaban en modo ligero automático, vuelve a completos).
    if (input.wasPressed('KeyV') && !typing) {
      if (this.fx.lite) { this.fx.lite = false; this.fx.enabled = true; } else this.fx.enabled = !this.fx.enabled;
    }
    const confirm = input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter');
    const back = input.wasPressed('Escape');

    this.lore.update(dt);
    if (this.fade) { this.updateFade(dt); return; }
    // Menú modal abierto (OPCIONES / PAUSA): el juego está congelado y solo él lee la entrada.
    if (this.panel) { this.panel.update(); return; }
    if (this.shot) { this.lore.updateShot(dt); return; } // plano de cámara narrativo (V2, V6): se salta manteniendo
    if (this.vignette) { if (this.vignette.update(dt)) { const v = this.vignette; this.vignette = null; if (v.onEnd) v.onEnd(); } return; } // viñeta narrativa: congela el juego (se salta manteniendo)
    if (this.state === 'menu') { this.menu.update(); return; }
    if (this.state === 'initials') { this.updateInitials(dt); return; }
    if (this.state === 'gameover') {
      if (confirm) this.transition(() => this.newRun());
      else if (back) this.transition(() => this.openMenu());
      return;
    }
    // Panel del Top 5 (T) en la selección de máscara y en la pantalla de muerte.
    if ((this.state === 'masks' || this.state === 'dead') && input.wasPressed('KeyT')) this.showRecords = !this.showRecords;
    if (this.showRecords && back) { this.showRecords = false; return; }
    if (this.state === 'masks') {
      if (back && this.maskPhase === 'support') { this.maskPhase = 'main'; this.maskIndex = this.mainMaskIndex; this.sfx.play('empty'); } // vuelve a elegir la tuya
      else if (back) this.transition(() => this.openMenu());
      else if (!this.showRecords) this.updateMaskSelect();
      return;
    }
    // Esc (o el icono de pausa en táctil): PAUSA. Solo con el piso en juego, fuera o dentro del edificio.
    if ((this.state === 'playing' || this.state === 'cleared' || this.state === 'sewer') && back) { this.openPause(); return; }
    // R es instantáneo a propósito (sin fundido): reintentar debe ser inmediato.
    if (input.wasPressed('KeyR')) { this.restartLevel(); return; }
    // Terminar la partida tras morir: ESC (lejos de Espacio y Enter, que se pulsan sin querer) y hay que pulsarlo DOS veces en 3 s: así no se pierde el progreso del piso por error. R reintenta.
    if (this.state === 'dead' && back) {
      if (this.endAskActive()) { this.endAskAt = 0; this.transition(() => (this.prologue ? this.openMenu() : this.endRun(false))); } // el prólogo no guarda récords
      else { this.endAskAt = performance.now(); this.sfx.play('empty'); }
      return;
    }

    if (this.state === 'results') {
      this.resultsAge += dt;
      // Solo ENTER continúa (no Espacio, que se aprieta sin querer) y no antes de 0,8 s; en táctil, tocar inyecta Enter.
      if ((input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) && this.resultsAge > 0.8) this.transition(() => this.advance());
      return;
    }

    if (this.sewerRun && this.state === 'dead') { this.updateSewerDead(dt); return; } // muerto en el túnel: solo corre lo visual
    if (this.state === 'sewer' && this.comms.cur) { this.comms.step(dt, confirm || input.mousePressed.left); return; } // diálogo en el túnel (RICK)
    if (this.state === 'descend') { this.updateDescend(dt); return; }
    if (this.state === 'ascend') { this.updateAscend(dt); return; }
    if (this.state === 'emerge') { this.updateEmerge(dt); return; }
    if (this.state === 'sewer') { this.updateSewer(dt); return; }
    if (this.comms.cur) { if (this.comms.cur.skippable && this.holdSkip(this.comms, dt)) this.comms.skipAll(); else this.comms.step(dt, confirm || input.mousePressed.left); return; } // línea de comunicación del prólogo: el mundo se congela (como la radio del piso 10)
    if (this.state === 'ambush') { this.updateAmbush(dt); return; }
    if (this.state === 'exit') { this.updateExit(dt, confirm || input.mousePressed.left); return; }
    if (this.state === 'ending') { this.updateEnding(dt, input.down('Enter')); return; }
    if (this.state === 'radio') { this.updateRadio(dt, confirm || input.mousePressed.left); return; }
    if (this.state === 'reunion') { this.updateReunion(dt); return; }
    if (this.state === 'role') { this.updateRoleSelect(); return; }
    if (this.state === 'scuffle') { this.updateScuffle(dt); return; }

    if (this.state === 'arriving' || this.state === 'leaving') {
      this.updateCine(dt, (confirm || input.mousePressed.left) && !this.endingRide); // la salida del final no se salta con Espacio
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
    this.updateMaskDrops(dt);
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    if (this.prologue) this.updatePrologue(dt);
    if (this.player.alive && !this.asphyx) this.player.update(dt, this);
    if (this.final && this.state === 'playing') this.updateFinal(dt);
    else if (this.state === 'playing' && this.trap && this.trap.state === 'done' && this.partner && this.partner.immortal) this.updateAlly(dt); // el liberado cubre la zona hasta el reencuentro
    if (this.partner && this.partner.alive) { this.partner.idleUpdate(dt); (this.partnerPos ||= {}).x = this.partner.x; this.partnerPos.y = this.partner.y; } // el inactivo queda donde está (también al reintentar con R)
    this.barkCd = Math.max(0, (this.barkCd || 0) - dt);
    if (this.map.reveal > 0) this.map.reveal -= dt;
    resetAiBudget(this.input.touchMode); // tope de rutas y búsquedas de cobertura por fotograma (reparte el coste de las alarmas)
    for (const e of this.enemies) if (e.alive) e.update(dt, this);
    for (const a of this.allies) if (a.alive) a.update(dt, this);
    this.cams.update(dt);

    this.updateDoors(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.particles.update(dt, this.map, (kind, p) => this.bake(kind, p));
    this.prints.update(dt);
    this.sewer.update(dt, this);
    this.street.update(dt);
    this.hostages.update(dt);
    // Atropello: el auto de extracción en marcha arrolla al jugador que se le cruza.
    const car = this.hostages.car;
    if (car && this.player.alive && (this.state === 'playing' || this.state === 'cleared') && car.hits(this.player.x, this.player.y, this.player.r)) this.runOver(car);
    if (this.runover) this.stepRunover(dt);
    if (this.asphyx) this.stepAsphyx(dt);
    // Culpa: 3 s después de matar (o herir de muerte) a un civil, el jugador se quita la máscara y vomita (vulnerable y quieto).
    if (this.guilt) {
      const gp = this.player;
      if (!gp.alive || this.state === 'dead') this.guilt = null;
      else if ((this.state === 'playing' || this.state === 'cleared') && !this.panel && !gp.exec && !gp.vomit && (this.guilt.t -= dt) <= 0) { this.guilt = null; this.lore.noteGuilt(); gp.startVomit(this); }
    }

    this.bullets = this.bullets.filter((b) => b.alive);
    this.pickups = this.pickups.filter((p) => p.alive);

    // Cruzar el umbral (dos casillas dentro de la puerta principal, ya fuera del barrido de la hoja)
    // activa el combate: no hay salida hasta despejar el edificio.
    // El bloqueo solo salta al cruzar el umbral HACIA DENTRO: y por encima del umbral Y dentro de la huella del edificio
    // (la calle de arriba y de los lados también tiene y < lockY, y ahí no se bloquea nada).
    this.updateKey(dt);
    if (this.testRange) this.updateRange(dt);
    if (this.state === 'playing' && !this.inside && this.player.alive && this.inBuilding(this.player) && !this.sewerRoute) this.beginLockdown(); // (con la ruta de la alcantarilla se entra por la escalera: ver endSewer)
    if (this.trap) this.updateTrap(dt);
    if (this.doorPending && !this.doorAnimOn && this.keyOk()) { this.doorPending = false; this.mainDoor.unlock(); this.sfx.play('unlock'); } // (se desactivó la animación con la puerta pendiente)
    if (this.state === 'cleared' && this.doorPending && this.keyOk() && this.player.alive && !this.player.doorAnim && !this.player.vomit && !this.player.exec
      && Math.hypot(this.player.x - this.mainDoor.cx, this.player.y - this.mainDoor.cy) < 84) { this.doorPending = false; this.player.startDoorAnim(this, 'open', this.mainDoor); }
    if (this.state === 'playing' && this.inside && !this.testRange && this.enemies.every((e) => !e.alive) && (!this.trap || (this.trap.state === 'done' && this.final && this.final.done))) { // con trampa: resolverla, reencontrarse y ganar la fase final antes de dar el piso por despejado
      this.state = 'cleared';
      // Se acabó la adrenalina: `setMusic('empty')` corta la música con el frenazo de cinta y
      // abre el ambiente del edificio vacío, que acompaña hasta la moto. La puerta se desbloquea.
      this.sfx.setMusic('empty');
      // La puerta principal la abre el agente al llegar a ella (animación; `doorPending`). En el piso 10 (trampa y final con la carrera de los dos agentes y el rehén de la IA) se abre sola.
      if (this.trap || (!this.doorAnimOn && this.keyOk())) { this.mainDoor.unlock(); this.sfx.play('unlock'); } else this.doorPending = true; // (con llave por recoger la puerta sigue cerrada)
      this.showCallout('PISO COMPLETADO', COLORS.player, 2.8, '¡EDIFICIO LIMPIO!'); // el objetivo (REGRESA A LA MOTO) sale al apagarse
      this.lore.onCleared(); // la pila de cuerpos del piso 5 (con la puerta aún cerrada)
    }
    // Junto a la moto con el piso despejado: si no quedan rehenes atados, la fuga arranca sola; si quedan, solo se AVISA (el rescate es opcional) y el jugador decide:
    // ESPACIO / F (BOTA en táctil) para irse igualmente, o volver a por ellos.
    this.leaveAsk = 0;
    if (this.trap && this.state === 'cleared') this.updateEndingTrigger(dt); // piso 10: la salida es el FINAL (detonar y huir en pareja), no volver a la moto sin más
    if (!this.trap && this.state === 'cleared' && this.player.alive && this.touchingBike()) {
      const miss = this.hostages.pending();
      if (miss === 0) this.startLeaving();
      else {
        this.leaveAsk = miss;
        if (this.keys.pressed('kick') || this.keys.pressed('execute')) this.startLeaving();
      }
    }

    let tx = this.player.x, ty = this.player.y;
    if (this.player.alive) {
      // Se adelanta hacia donde apuntas, pero con tope: con la vista más cerrada el
      // jugador debe seguir siendo el centro de la acción.
      const o = this.lookOffset(dt);
      tx += o.x;
      ty += o.y;
    }
    if (this.asphyx && this.trap && this.trap.victim) { tx = this.trap.victim.x; ty = this.trap.victim.y; } // la cámara viaja al agente que se asfixia
    if (this.prologue) [tx, ty] = this.flow.cameraFocus(tx, ty); // instrucción nueva: la cámara se desplaza suave hacia el objetivo
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
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null; // los carteles (p. ej. FIN) también caducan durante las cinemáticas
    for (const f of this.floatingTexts) f.t -= dt; // (y los textos flotantes: antes se quedaban congelados en pantalla, p. ej. «¡ESPERA A JACK!» al salir en la moto)
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
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
        this.lore.onArrived(); // V2 (el asiento) / V6 (la calle vacía)
      }
    } else {
      if (skip) {
        this.sfx.stopMoto(0.2); // sin esperar a que se aleje: directo a resultados
        this.finishLeaving();
        return;
      }
      this.hostages.stepExtraction(dt); // el auto de extracción arranca mientras el jugador se va en su moto
      if (c.t < LEAVE_BOARD) {
        const k = c.t / LEAVE_BOARD, e = k * k * (3 - 2 * k);
        p.x = lerp(c.from.x, b.park.x - 4, e);
        p.y = lerp(c.from.y, b.park.y, e);
        p.angle = c.from.angle + angleDiff(0, c.from.angle) * e;
        this.hostages.rideUpdate(e, b);
        this.rideRider(e);
      } else {
        const t2 = c.t - LEAVE_BOARD, ex = this.exit;
        b.riding = true;
        ex.place(t2, b, this);                       // trayectoria, giro y salto de la salida elegida
        this.hostages.rideUpdate(1, b);              // el rehén (si hay uno) va detrás del protagonista
        this.rideRider(1);                           // y, en el final, el otro agente
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        p.x = b.x - 4 * ca;
        p.y = b.y - 4 * sa - b.z;
        p.angle = b.angle;
        // Escape: polvo y humo gris que se quedan atrás (más denso al arrancar) y chispas de neón cian/magenta.
        if (!b.z && Math.random() < 0.6) this.particles.dust(b.x - 24 * ca + rand(-4, 4), b.y - 24 * sa + rand(-4, 4), 1);
        const smoke = t2 < 0.35 ? 3 : 1;
        for (let i = 0; i < smoke; i++) this.particles.dust(b.x - (20 + rand(0, 6)) * ca + rand(-2, 2), b.y - (20 + rand(0, 6)) * sa + rand(-2, 2), 1);
        if (Math.random() < 0.45) this.particles.neon(b.x - 22 * ca, b.y - 22 * sa - b.z, b.angle + Math.PI + rand(-0.3, 0.3), 1, 0.25);
        if (t2 >= ex.dur) { this.finishLeaving(); return; }
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

  // --- Matriz de combate cuerpo a cuerpo y forcejeo ("estilo VS") ------------------------------------
  // Cuando un enemigo te alcanza con su golpe (`Enemy.updateChase` → `enemyStrike`), el resultado sale de la categoría de
  // armamento de cada uno (`weaponCategory`: unarmed | blunt | blade | gun; una pistola sin balas cuenta como puños):
  //
  //   TÚ \ ÉL        unarmed (puños)        blunt / blade (bate, tubo, cuchillo)
  //   unarmed        FORCEJEO (puños)        te mata (arma superior)
  //   blunt / blade  matas tú (superior)     FORCEJEO (choque de armas)
  //   gun con balas  DISPARO DE PÁNICO       DISPARO DE PÁNICO
  //
  // El disparo de pánico abate al enemigo a quemarropa (1 bala, pausa de recuperación 0,5 s). Un golpe por la espalda,
  // un enemigo con arma de fuego o estar rematando mata siempre. Es determinista: sin probabilidades.
  // El forcejeo congela el mundo, hace zoom ×2 y baja la música (ver abajo); hay que aporrear ATACAR para empujar la
  // barra y la resistencia del enemigo sube con cada forcejeo del piso (+22 %, tope ×2,2).
  enemyStrike(e, angle) {
    if (this.player.doorAnim) return; // intocable mientras cierra / abre la puerta
    const p = this.player;
    if (this.state !== 'playing' || !p.alive) return;
    if (this.scuffleGrace > 0) { e.attackCd = 0.4; return; } // acaba de forcejear: ese golpe no cuenta
    if (e.civ) { this.killPlayer(angle, e); return; }         // civil hostil: sin forcejeo (son muchos): su golpe te mata y el tuyo, si llega antes, los mata a ellos
    const frontal = Math.abs(angleDiff(angle + Math.PI, p.angle)) < 1.75;
    const pc = this.playerCategory(), ec = e.category;
    if (!frontal || p.exec || ec === 'gun' || e.kind === 'boss') { this.killPlayer(angle, e); return; }
    if (pc === 'gun') this.defensiveShot(e);
    else if (pc === 'unarmed' && ec === 'unarmed') this.startScuffle(e, angle, 'fists');
    else if (pc !== 'unarmed' && ec !== 'unarmed') this.startScuffle(e, angle, 'clash');
    else if (pc !== 'unarmed') this.playerCounter(e);   // arma tuya contra sus puños: resuelves tú
    else this.killPlayer(angle, e);                     // sus armas contra tus puños: resuelve él
  }

  // Categoría de lo que lleva el jugador. Una pistola/escopeta/subfusil sin balas es un palo: cuenta como puños.
  playerCategory() {
    const w = this.player.weapon;
    if (!w) return 'unarmed';
    const c = weaponCategory(w.type);
    return c === 'gun' && w.ammo <= 0 ? 'unarmed' : c;
  }

  // Disparo instintivo a quemarropa: abate al enemigo que se te echa encima de frente. Gasta 1 bala y deja al
  // jugador una pausa de recuperación (no puede atacar durante 0,5 s) con el retroceso del arma.
  defensiveShot(e) {
    const p = this.player, w = p.weapon, def = p.def;
    const angle = Math.atan2(e.y - p.y, e.x - p.x);
    p.angle = angle;
    w.ammo--;
    this.recordAttack(w.type, true);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.particles.sparks(p.x + cos * 18, p.y + sin * 18, angle, 9, 0.5);
    this.particles.shell(p.x + cos * 6, p.y + sin * 6, angle + Math.PI / 2);
    this.sfx.play(def.sound);
    p.muzzle = 0.07;
    p.recoil = p.recoilMax = 0.3;
    p.cooldown = Math.max(p.cooldown, 0.5);
    this.makeNoise(p.x, p.y, def.noise);
    this.killEnemy(e, angle, 'bullet');
    this.stainWeapon(1.0, !!e.toxic); // disparo de pánico a quemarropa: el arma se mancha
    this.camera.addShake(10);
    this.fx.kick(0.6);
    this.showCallout('¡DISPARO DE PÁNICO!', COLORS.enemy, 0.8);
    this.addFloat(e.x, e.y - 20, '¡QUEMARROPA!', COLORS.enemy, 1, 1.1);
    this.touch.haptic([20, 20, 30]);
  }

  // Tu arma (bate, tubo o cuchillo) contra sus puños: te adelantas y lo abates antes de que acabe de golpear.
  playerCounter(e) {
    const p = this.player;
    const angle = Math.atan2(e.y - p.y, e.x - p.x);
    p.angle = angle;
    p.startSwing(p.def);
    this.sfx.play('swing');
    this.recordAttack(p.weapon ? p.weapon.type : 'fists', true);
    this.killEnemy(e, angle, 'melee');
    this.camera.addShake(8);
    p.cooldown = Math.max(p.cooldown, 0.25);
  }

  startScuffle(e, angle, mode = 'fists') {
    const p = this.player;
    this.scuffleCount++;
    const mult = Math.min(SCUFFLE.maxMult, 1 + SCUFFLE.fatigue * (this.scuffleCount - 1)) * (e.scuffleBonus || 1);
    // mode 'fists' = puño contra puño; 'clash' = choque de armas (chispas de metal si hay un cuchillo, astillas si son
    // contundentes). `label` es el titular de la pantalla VS.
    const pt = p.weapon && p.weapon.type, et = e.meleeWeapon;
    const names = (t) => (WEAPON_DEFS[t] ? WEAPON_DEFS[t].name : 'PUÑOS');
    const label = mode === 'clash' ? `${names(pt)} CONTRA ${names(et)}` : 'PUÑO CONTRA PUÑO';
    const metal = mode === 'clash' && (weaponCategory(pt) === 'blade' || weaponCategory(et) === 'blade');
    this.scuffle = { e, angle, mode, label, metal, bar: 0.5, t: 0, mult, surge: 0, nextSurge: 1.0, presses: 0, shake: 0 };
    this.state = 'scuffle';
    p.angle = angle + Math.PI; // se miran a la cara
    p.swing = 0; p.moving = false;
    e.angle = angle; e.windup = 0; e.aim = 0;
    this.camera.mulTarget = SCUFFLE.zoom;
    this.sfx.setSlowMo(true);
    this.sfx.play('scuffleIn');
    if (mode === 'clash') this.sfx.play(metal ? 'ricochet' : 'hit');
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
    for (const a of ['attack', 'kick', 'execute']) if (this.keys.pressed(a)) n++; // ATACAR, PATEAR y REMATAR valen
    if (n) {
      sc.bar = Math.min(1, sc.bar + n * SCUFFLE.push);
      sc.presses += n;
      sc.shake = 1;
      const mx0 = (p.x + e.x) / 2, my0 = (p.y + e.y) / 2;
      if (sc.mode === 'clash') {
        // Choque de armas: chispas de metal (cuchillo) o astillas y golpe seco (bate, tubo).
        if (sc.metal) { this.particles.sparks(mx0, my0, rand(0, TAU), 10, Math.PI); this.sfx.play('ricochet', 0.5); }
        else { this.particles.splinters(mx0, my0, rand(0, TAU), 6); this.sfx.play('hit', 0.45); }
      } else {
        this.sfx.play('knock', 0.45);
        this.particles.dust(mx0, my0, 2);
      }
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
    this.killPlayer(angle, e); // el enemigo lo ejecuta: R reintenta el piso (restartLevel)
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
      ctx.fillStyle = '#05000f'; ctx.fillRect(x - 2, topY - 2, 60, 60);
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, topY - 2, 60, 1); ctx.fillRect(x - 2, topY + 57, 60, 1);
      ctx.fillRect(x - 2, topY - 2, 1, 60); ctx.fillRect(x + 57, topY - 2, 1, 60);
    };
    const px = cx - 112, ex = cx + 54;
    const vdef = villainDef(sc.e.kind);
    frame(px, COLORS.player); frame(ex, vdef.frame);
    // Tú: el retrato de tu máscara con la sangre que llevas (nivel 0 si la sangre está desactivada).
    ctx.drawImage(bloodyMaskPortrait(this.mask, this.goreOn ? this.player.bloodLevel : 0, this.player.gender, this.maskBits), px, topY, 56, 56);
    // Él: un rostro en penumbra por tipo de enemigo; los ojos parpadean de vez en cuando.
    ctx.drawImage(villainPortrait(sc.e.kind), ex + 4, topY + 4, 48, 48);
    ctx.fillStyle = 'rgba(5, 0, 15, 0.22)';
    ctx.fillRect(ex + 4, topY + 28, 48, 24);
    if (Math.floor(now / 140) % 16 === 0) {
      ctx.fillStyle = '#07050d';
      for (const [x, y] of vdef.eyes) ctx.fillRect(ex + 4 + x * 4, topY + 4 + y * 4, 4, 4);
    }
    const vs = 'VS', vsScale = 5;
    const jx = pulse ? 1 : -1;
    drawText(ctx, vs, cx - 1 + jx, topY + 10, { color: COLORS.player, scale: vsScale, align: 'center', shadow: null });
    drawText(ctx, vs, cx + 1 - jx, topY + 11, { color: vdef.frame, scale: vsScale, align: 'center', shadow: null });
    drawText(ctx, vs, cx, topY + 10, { color: '#ffffff', scale: vsScale, align: 'center', shadow: null });
    // Titular del duelo (quién contra quién)
    drawText(ctx, sc.label, cx, topY + 62, { color: sc.mode === 'clash' ? COLORS.enemy : '#ffffff', align: 'center' });
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
    const label = this.hint(`¡APORREA ${this.keys.label('attack')} / ${this.keys.label('kick')}!`, '¡APORREA ATACAR!');
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
    if (this.sewerRun) return this.sewerRun.nearLadder ? { id: 'interact', label: 'SUBIR', ready: true } : this.sewerRun.lootNear ? { id: 'interact', label: 'REGISTRAR', ready: true } : { id: 'attack', label: 'ATACAR', ready: false }; // túnel: escalera, el cuerpo o lanzar la palanca
    if (p.executionTarget(this)) return { id: 'execute', label: 'REMATAR', ready: true };
    if (this.state === 'cleared' && this.bike) {
      const b = this.bike, m = MOUNT_MARGIN * 3;
      if (Math.abs(p.x - b.park.x) < b.w / 2 + p.r + m && Math.abs(p.y - b.park.y) < b.h / 2 + p.r + m) {
        return { id: 'mount', label: 'MOTO', ready: true };
      }
    }
    if (this.lore.radioReady) return { id: 'interact', label: 'RADIO', ready: true };
    if (this.ventNear()) return { id: 'interact', label: 'ROMPER', ready: true };
    if (this.detNear && this.state === 'cleared') return { id: 'interact', label: 'DETONAR', ready: true }; // piso 10: activar el detonador // piso 10: romper la ventilación (toques repetidos)
    const door = this.doors.some((d) => d.inKickRange(p.x, p.y, p.angle));
    if (door) return { id: 'kick', label: 'PATEAR', ready: true };
    // Algo de la calle con lo que interactuar (contenedor, máquina, cabina, vagabundo con moneda): enciende el botón superior (ver StreetLife.nearTarget).
    if ((this.state === 'playing' || this.state === 'cleared') && ((this.street && this.street.nearTarget()) || (this.hostages && this.hostages.nearTarget()))) return { id: 'interact', label: 'INTERACTUAR', ready: true };
    return { id: 'attack', label: 'ATACAR', ready: false };
  }

  // Edificio despejado y de vuelta en la moto: se sube y se va; al salir de la pantalla, los resultados.
  startLeaving(force = false) {
    if (this.trap && !force) return; // en el piso 10 solo se sale por el final (ver startEnding)
    // Culpa pendiente (o vomitando): el piso no se cierra hasta que el jugador haya vomitado. Si se intenta subir a la moto con la culpa en cuenta
    // atrás, el vómito empieza ya y la fuga arranca cuando termina (el jugador sigue junto a la moto).
    if (this.guilt || this.player.vomit) { if (this.guilt) this.guilt.t = 0; return; }
    this.hostages.refresh(true); // repartir con los rehenes rescatados AHORA: 1 → moto, 2 o más → auto (ninguno en la moto)
    // Extracción de rehenes: la fuga espera a que el rehén esté junto a la moto o a que los rehenes estén en el auto (ver Hostages.extractionBusy).
    if (this.hostages.extractionBusy()) {
      if (performance.now() - (this.waitHintAt || 0) > 1500) { this.waitHintAt = performance.now(); const pw = this.prologue && this.hostages.list.find((x) => x.partner && x.state !== 'dead'); this.addFloat(this.player.x, this.player.y - 22, pw ? `¡ESPERA A ${AGENTS[pw.agent].name}!` : '¡ESPERA A LOS REHENES!', '#9be32a', 1, 1.4); }
      return;
    }
    this.hostages.boardBike(); // un solo rehén liberado: se sube a la moto detrás del protagonista
    const p = this.player;
    this.state = 'leaving';
    // Salida al azar (33 % cada una): portón en la valla sur, carril lateral o salto sobre una rampa (ver exits.js). La cámara amplía sus límites
    // en esa dirección para seguir a la moto fuera del mapa.
    this.exit = force ? new BikeExit('gate', this) : BikeExit.random(this); // el final sale por el portón
    if (!this.exit.ok) this.exit = new BikeExit('lane', this);
    const m = this.map;
    this.camera.setBounds(m.pixelW + (this.exit.kind === 'lane' ? EXIT_EXTRA : 0), m.pixelH + (this.exit.kind === 'lane' ? 0 : EXIT_EXTRA));
    this.cine = { kind: 'leave', t: 0, from: { x: p.x, y: p.y, angle: p.angle } };
    this.sfx.playMotoDeparture({ board: LEAVE_BOARD, ride: this.exit.dur });
  }

  finishLeaving() {
    this.cine = null;
    this.exit = null;
    this.transition(() => this.finishFloor());
  }

  // El jugador cruzó el umbral: se pone la máscara, la puerta principal se cierra de golpe y se
  // bloquea (el portazo y los efectos llegan cuando acaba de cerrarse: `slamEffects`) y empieza el
  // combate. Se anota el arma con la que entra para que R reaparezca igual.
  inBuilding(p) {
    const z = this.entry.zone;
    return p.y < this.entry.lockY && p.y > z.y0 && p.x > z.x0 && p.x < z.x1;
  }

  beginLockdown() {
    const p = this.player;
    this.inside = true;
    this.entered = true;
    p.putOnMask(this);
    this.entryWeapon = p.weapon ? { type: p.weapon.type, ammo: p.weapon.ammo } : null;
    p.startDoorAnim(this, 'close', this.mainDoor); // el agente se gira y cierra la puerta tras de sí (la hoja se cierra y bloquea a mitad de la animación)
    this.sfx.setMusic('action');
  }

  slamEffects(door) {
    this.playAt('lockdown', door.cx, door.cy);
    this.particles.dust(door.cx, door.cy, 10);
    this.particles.sparks(door.cx, door.cy, -Math.PI / 2, 12, 1.2);
    this.camera.addShake(8);
    this.fx.kick(0.8);
    // La puerta la cierra el agente (que no salga la mafia): el cartel lo dice así en todos los pisos. Las puertas del despacho sellado tienen su propio cartel (¡TRAMPA!).
    if (door.main) this.showCallout('PUERTA CERRADA', COLORS.blood, 2.4, `${AGENTS[this.gender].name} CIERRA: QUE NO SALGA NADIE`);
  }

  // --- Piso 3: entrada por la alcantarilla y llave de salida ----------------------------------------------------------------------------------
  // La puerta principal está cerrada por dentro. Hay que sacar una palanca de la basura (la lleva el contenedor marcado), forzar la tapa de la alcantarilla de la calle que es la
  // entrada real, cruzar un túnel con un cocodrilo (estado 'sewer', ver tunnel.js) y subir por una escalera al cuarto de servicio del edificio, donde empieza el combate. Para salir
  // hay que recoger la llave que lleva uno de los enemigos (brilla en el suelo al caer): sin ella la puerta no se abre (`FALTA LA LLAVE`).
  keyOk() { return !this.keyRoute || this.hasKey; }

  // Aviso al empujar o patear la puerta principal cerrada (con enfriamiento): al principio «cerrada por dentro»; al despejar, sin la llave, «falta la llave».
  doorShut(door) {
    const now = performance.now();
    if (now - this.shutAt < 1400) return;
    if (!this.sewerRoute) return;
    if (!this.entered) { this.shutAt = now; this.addFloat(door.cx, door.cy - 30, 'PUERTA CERRADA POR DENTRO', COLORS.blood, 1, 1.8); } // (el golpe sordo lo da kickDoor)
    else if (this.state === 'cleared' && !this.keyOk()) this.keyMissing();
  }

  // Solo al intentar abrir o patear la puerta (kickDoor): acercarse o rozarla no avisa; el panel y el marcador ya guían.
  keyMissing() {
    const now = performance.now();
    if (now - this.keyHintAt < 1800) return;
    this.keyHintAt = now;
    this.addFloat(this.mainDoor.cx, this.mainDoor.cy - 30, 'FALTA LA LLAVE', COLORS.blood, 1, 1.8);
  }

  // El enemigo que llevaba la llave cae: queda en el suelo con un brillo llamativo hasta recogerla.
  dropKey(e) {
    this.keyDrop = { x: e.x, y: e.y, t: 0 };
    this.addFloat(e.x, e.y - 22, '¡LLAVE!', '#ffd23a', 2, 1.6);
    this.particles.neon(e.x, e.y, 0, 12, Math.PI * 2);
    this.sfx.play('pickup', 0.8);
  }

  updateKey(dt) {
    const k = this.keyDrop;
    if (!k) return;
    k.t += dt;
    const p = this.player;
    if (!p.alive || (this.state !== 'playing' && this.state !== 'cleared') || Math.hypot(p.x - k.x, p.y - k.y) > 20) return;
    this.keyDrop = null;
    this.hasKey = true;
    this.addFloat(p.x, p.y - 22, '¡TIENES LA LLAVE!', '#ffd23a', 2, 1.8);
    this.sfx.play('pickup'); this.sfx.play('unlock', 0.5);
    this.particles.neon(p.x, p.y, 0, 14, Math.PI * 2);
  }

  drawKey(ctx) {
    const t = performance.now() / 1000;
    const k = this.keyDrop;
    if (k) {                                                   // la llave caída: anillos de luz que laten, destellos y la llave flotando
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffd23a';
      for (const [r, a] of [[30, 0.07], [20, 0.1], [12, 0.14]]) { ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(t * 6)); pixelDisc(ctx, k.x / WORLD_PX, k.y / WORLD_PX, r, WORLD_PX); }
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) { const ph = (t * 1.3 + i * 0.25) % 1; pixelRect(ctx, k.x + Math.cos(i * 1.7 + t) * 16, k.y - 6 - ph * 22, 1, 1); }
      drawSprite(ctx, 'key', k.x, k.y - 4 + Math.round(Math.sin(t * 4) * 2), 0);
    }
    for (const e of this.enemies) {                           // el que la lleva: una llavecita sobre la cabeza
      if (e.alive && e.hasKey && e.state !== 'down') drawSprite(ctx, 'key', e.x, e.y - 22, 0, { scale: 1 });
    }
  }

  // --- Tramo de alcantarilla (estado 'sewer') -------------------------------------------------------------------------------------------------
  // Animación de bajar (estado 'descend', ~2,6 s sin control): el agente se coloca al borde de la tapa, clava la palanca y hace fuerza TRES veces (la tapa se desliza a tirones, con
  // chispas, polvo y sacudida), da un paso sobre la abertura y se hunde en ella; después, fundido al túnel. Es invulnerable (no es 'playing') y la palanca se guarda mientras
  // tanto (se ve clavada bajo la tapa) y se le devuelve al llegar (`beginSewer`).
  descendSewer() {
    if (this.fade || this.state !== 'playing' || this.descent) return;
    const lid = this.sewer.covers.find((c) => c.entrance), p = this.player;
    if (!lid) { this.transition(() => this.beginSewer(), 0.4); return; }
    lid.face = 0; lid.dir = this.sewer.pickDir(lid, this);
    const side = (d) => !isSolidAt(this.map, lid.x - d * 26, lid.y + 2) && !isSolidAt(this.map, lid.x - d * 40, lid.y + 2);
    if (!side(lid.dir) && side(-lid.dir)) lid.dir = -lid.dir; // el agente se pone en el lado con sitio
    const d = lid.dir;
    this.descent = { t: 0, lid, d, from: { x: p.x, y: p.y }, stand: { x: lid.x - d * 26, y: lid.y + 2 }, weapon: p.weapon, heaves: -1, sink: 0 };
    p.weapon = null;
    this.state = 'descend';
    this.callout = null; this.floatingTexts.length = 0;
  }

  updateDescend(dt) {
    const D = this.descent, p = this.player, lid = D.lid, d = D.d;
    const PRY0 = 0.4, PRY1 = 1.6, WALK1 = 2.0, SINK1 = 2.65;
    const ease = (k) => k * k * (3 - 2 * k);
    D.t += dt;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    p.angle = d > 0 ? 0 : Math.PI;
    if (D.t < PRY0) {                                                          // se coloca al borde de la tapa
      const k = ease(D.t / PRY0);
      p.x = D.from.x + (D.stand.x - D.from.x) * k; p.y = D.from.y + (D.stand.y - D.from.y) * k;
    } else if (D.t < PRY1) {                                                   // palanca: tres tirones
      const k = (D.t - PRY0) / (PRY1 - PRY0), h = Math.min(2, Math.floor(k * 3)), f = k * 3 - h;
      if (h > D.heaves) {                                                      // arranque de cada tirón
        D.heaves = h;
        this.sfx.play(h === 2 ? 'manholeScrape' : 'knock', 0.9);
        this.camera.addShake(4 + h * 2);
        this.particles.dust(lid.x - d * 14, lid.y, 6);
        this.particles.sparks(lid.x - d * 20, lid.y, d > 0 ? Math.PI : 0, 6, 0.5);
        this.addFloat(lid.x, lid.y - 26, h === 0 ? '¡ARGH!' : h === 1 ? '¡MÁS!' : '¡CEDE!', '#ffffff', 1, 0.8);
      }
      p.x = D.stand.x - d * 4 * Math.sin(Math.min(1, f * 1.4) * Math.PI); p.y = D.stand.y; // el cuerpo se echa atrás al tirar
      lid.slide = (h + ease(Math.min(1, f * 1.6))) / 3;                         // la tapa avanza a tirones
    } else if (D.t < WALK1) {                                                  // la tapa queda abierta y da un paso sobre el hueco
      lid.slide = 1;
      const k = ease((D.t - PRY1) / (WALK1 - PRY1));
      p.x = D.stand.x + (lid.x - D.stand.x) * k; p.y = D.stand.y + (lid.y - 6 - D.stand.y) * k;
    } else if (D.t < SINK1) {                                                  // se hunde en la abertura
      lid.slide = 1;
      D.sink = ease((D.t - WALK1) / (SINK1 - WALK1));
      p.x = lid.x; p.y = lid.y - 6;
      if (D.sink > 0.5 && !D.splash) { D.splash = true; this.sfx.play('crocDown', 0.5); this.particles.dust(lid.x, lid.y, 8); }
    } else if (!this.fade) this.transition(() => this.beginSewer(), 0.3);
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.camera.update(dt, p.x, p.y);
  }

  // El agente que se hunde: se dibuja desplazado hacia abajo y recortado por el borde de la abertura (solo se ve lo que queda por encima).
  drawPlayerBody(ctx) {
    const D = this.descent, E = this.emerge;
    if (this.state === 'exit' && this.finalExit && this.finalExit.out === this.player) return; // lo dibuja drawExit
    if (this.state === 'emerge' && E && E.sink > 0) this.drawThroughHole(ctx, this.player, E.hole, E.sink); // asoma de la boca de la escalera
    else if (this.state === 'descend' && D && D.sink > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(D.lid.x - 120, D.lid.y - 160, 240, 160 + 12); ctx.clip();
      ctx.translate(0, D.sink * 34);
      this.player.draw(ctx);
      ctx.restore();
    } else this.player.draw(ctx);
  }

  // La palanca clavada bajo el borde de la tapa, que cabecea con cada tirón.
  drawDescent(ctx) {
    const D = this.descent;
    if (this.state !== 'descend' || !D || D.t < 0.3 || D.t > 1.9) return;
    const lid = D.lid, p = this.player, d = D.d;
    const edge = lid.x + d * lid.slide * 32 - d * 22;
    const tip = { x: edge, y: lid.y + 1 }, hand = { x: p.x + d * 10, y: p.y + 3 };
    const rock = D.t < 1.6 ? Math.sin(D.t * 22) * 0.07 : 0;
    drawSprite(ctx, 'crowbar', hand.x, hand.y, Math.atan2(tip.y - hand.y, tip.x - hand.x) + rock, { ox: 3, oy: 2 });
  }

  // Cambia el mundo por el túnel: mapa, puertas, enemigos, armas del suelo, balas y capas de sangre se guardan en `sewerStash` y se restauran al subir (o en reset / openMenu).
  beginSewer() {
    const run = new SewerRun(this), p = this.player;
    if (this.descent) { p.weapon = this.descent.weapon; this.descent = null; } // la palanca vuelve a la mano
    this.sewerRun = run;
    this.sewerStash = { map: this.map, doors: this.doors, enemies: this.enemies, pickups: this.pickups, bullets: this.bullets, pools: this.pools,
      bloodLayer: this.bloodLayer, bloodCtx: this.bloodCtx, wallBloodLayer: this.wallBloodLayer, wallBloodCtx: this.wallBloodCtx, wallBloodDirty: this.wallBloodDirty,
      bw: this.map.pixelW, bh: this.map.pixelH };
    this.map = run.map; this.doors = []; this.enemies = []; this.pickups = []; this.bullets = []; this.pools = [];
    this.bloodLayer = run.bloodLayer; this.bloodCtx = run.bloodCtx; this.wallBloodLayer = run.wallBloodLayer; this.wallBloodCtx = run.wallBloodCtx; this.wallBloodDirty = false;
    p.x = run.map.spawn.x; p.y = run.map.spawn.y; p.angle = 0;
    this.state = 'sewer';
    this.camera.setBounds(run.map.pixelW, run.map.pixelH);
    this.camera.snap(p.x, p.y);
    this.floatingTexts.length = 0; this.prints.clear(); this.particles.clear(); // (nada de la calle se arrastra al túnel)
    this.showCallout('ALCANTARILLA', COLORS.player, 2.2, 'CUIDADO CON EL COCODRILO');
    this.sfx.setMusic('menu');
  }

  restoreFromSewer() {
    const s = this.sewerStash;
    this.sewerRun = null; this.sewerStash = null;
    if (!s) return;
    this.map = s.map; this.doors = s.doors; this.enemies = s.enemies; this.pickups = s.pickups; this.bullets = s.bullets; this.pools = s.pools;
    this.bloodLayer = s.bloodLayer; this.bloodCtx = s.bloodCtx; this.wallBloodLayer = s.wallBloodLayer; this.wallBloodCtx = s.wallBloodCtx; this.wallBloodDirty = s.wallBloodDirty;
    this.camera.setBounds(s.bw, s.bh);
  }

  // La máscara secreta de RICK, en el cuerpo que devoraba el cocodrilo (alcantarilla del piso 3): al registrarlo (el cocodrilo ya no está encima: se fue tras ti, está ciego o aturdido)
  // se desbloquea (`settings.unlockMask`, se guarda) y habla el agente. Una sola vez por visita.
  lootRick() {
    const run = this.sewerRun;
    if (!run || run.looted) return;
    run.looted = true;
    const isNew = this.settings.unlockMask('aguila'), mask = MASKS.find((m) => m.id === 'aguila'), p = this.player;
    this.sfx.play('clear'); this.sfx.play('pickup');
    this.particles.neon(p.x, p.y, 0, 16, Math.PI * 2);
    this.camera.addShake(5);
    if (isNew) this.addFloat(p.x, p.y - 30, `¡MÁSCARA ${mask.name} DESBLOQUEADA!`, '#e0a82a', 2, 3);
    const me = { name: AGENTS[this.gender].name, color: AGENTS[this.gender].color, portrait: { mask: this.mask, gender: this.gender, level: this.goreOn ? p.bloodLevel : 0, bits: this.maskBits || [] } };
    if (this.comms.say('rick', [{ speaker: me, text: 'Ahí terminó Rick… pobre hombre, hizo un gran trabajo.' }], { urgent: true })) this.comms.begin(this.comms.queue.shift());
  }

  // Animación de subir (estado 'ascend', ~1,7 s sin control e invulnerable; el cocodrilo se queda quieto): el agente se pega a la escalera, sube peldaño a peldaño (el sprite se
  // acerca a la cámara y se funde en la luz del pozo, con un destello) y fundido al cuarto de servicio, donde sale por la boca de la escalera (`updateEmerge`).
  climbLadder() {
    if (this.fade || this.state !== 'sewer') return;
    const l = this.sewerRun.map.ladder, p = this.player;
    this.climb = { t: 0, from: { x: p.x, y: p.y }, to: { x: l.x - 4, y: l.y }, rungs: -1 };
    this.state = 'ascend';
    this.callout = null; this.floatingTexts.length = 0;
    p.angle = -Math.PI / 2;
  }

  updateAscend(dt) {
    const C = this.climb, p = this.player, ease = (k) => k * k * (3 - 2 * k);
    const REACH = 0.4, UP = 1.5;
    C.t += dt;
    p.angle = -Math.PI / 2;
    this.sewerRun.amb.update(dt, this); this.sewerRun.clock += dt; // el túnel sigue vivo (goteras, ratas); el cocodrilo, quieto
    if (C.t < REACH) {                                           // se pega a la escalera
      const k = ease(C.t / REACH);
      p.x = C.from.x + (C.to.x - C.from.x) * k; p.y = C.from.y + (C.to.y - C.from.y) * k;
    } else if (C.t < UP) {                                       // sube: un peldaño cada 0,22 s
      p.x = C.to.x; p.y = C.to.y;
      const r = Math.floor((C.t - REACH) / 0.22);
      if (r > C.rungs) { C.rungs = r; this.sfx.play('knock', 0.3); this.particles.dust(p.x, p.y, 1); }
    } else if (!this.fade) { this.sfx.play('pickup'); this.sfx.play('manholeScrape', 0.5); this.transition(() => this.endSewer(), 0.3); }
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.camera.update(dt, p.x, p.y);
  }

  // El agente en el túnel: normal, o subiendo por la escalera (se agranda hacia la cámara y se desvanece en la luz).
  drawClimber(ctx) {
    const C = this.climb, p = this.player;
    if (this.state !== 'ascend' || !C || C.t < 0.4) { p.draw(ctx); return; }
    const k = Math.min(1, (C.t - 0.4) / 1.1), s = 1 + 0.45 * k * k, bob = Math.sin((C.t - 0.4) * 14.3) * 1.5;
    ctx.save();
    ctx.translate(p.x, p.y + bob - k * 8); ctx.scale(s, s); ctx.translate(-p.x, -p.y);
    ctx.globalAlpha = 1 - 0.85 * k * k;
    p.draw(ctx);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.35 * k * k;                              // destello del pozo al llegar arriba
    pixelDisc(ctx, p.x / WORLD_PX, p.y / WORLD_PX, 16, WORLD_PX);
    ctx.restore();
  }

  // Sube al cuarto de servicio: se restaura el edificio y el agente sale por la boca de la escalera (`emerge`, ~1,3 s: asoma, sale y se pone la máscara). `inside`/`entered` y el
  // arma de entrada se fijan ya, así que R durante la salida reaparece en el cuarto de servicio. La puerta principal ya estaba bloqueada.
  endSewer() {
    this.restoreFromSewer();
    const p = this.player, sv = this.sewerRoute.service, ld = this.sewerRoute.ladder;
    this.climb = null;
    p.x = ld.x; p.y = ld.y; p.angle = 0;
    this.state = 'emerge';
    this.emerge = { t: 0, from: { x: ld.x, y: ld.y }, to: { x: sv.x, y: sv.y }, hole: { x: ld.x, y: ld.y }, sink: 1 };
    this.inside = true; this.entered = true;
    this.entryWeapon = p.weapon ? { type: p.weapon.type, ammo: p.weapon.ammo } : null;
    this.camera.setBounds(this.map.pixelW, this.map.pixelH);
    this.camera.snap(sv.x, sv.y);
    this.floatingTexts.length = 0; this.prints.clear(); this.particles.clear();
    this.sfx.play('manholeScrape', 0.4);
  }

  updateEmerge(dt) {
    const E = this.emerge, p = this.player, ease = (k) => k * k * (3 - 2 * k);
    const RISE = 0.7, STEP = 1.1;
    E.t += dt;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    if (E.t < RISE) {                                            // asoma por la boca de la escalera
      E.sink = 1 - ease(E.t / RISE);
      if (E.t > 0.35 && !E.dust) { E.dust = true; this.particles.dust(E.hole.x, E.hole.y, 8); this.camera.addShake(3); }
    } else if (E.t < STEP) {                                     // sale de la boca y se pone en el cuarto
      E.sink = 0;
      const k = ease((E.t - RISE) / (STEP - RISE));
      p.x = E.from.x + (E.to.x - E.from.x) * k; p.y = E.from.y + (E.to.y - E.from.y) * k;
      p.angle = -Math.PI / 2 * k;
    } else {                                                     // arriba: máscara, combate y reloj
      this.emerge = null;
      this.state = 'playing';
      p.x = E.to.x; p.y = E.to.y; p.angle = -Math.PI / 2;
      p.putOnMask(this);
      this.particles.dust(p.x, p.y, 6);
      this.showCallout('¡ESTÁS DENTRO!', COLORS.blood, 2.4, 'SUBES POR LA ESCALERA DEL CUARTO DE SERVICIO');
      this.sfx.setMusic('action');
    }
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.camera.update(dt, p.x, p.y);
  }

  updateSewer(dt) {
    const p = this.player, run = this.sewerRun;
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    this.barkCd = Math.max(0, (this.barkCd || 0) - dt);
    if (p.alive) p.update(dt, this);
    this.updatePickups(dt);
    this.updateBullets(dt);
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.prints.update(dt);
    run.update(dt, this);
    this.bullets = this.bullets.filter((b) => b.alive);
    this.pickups = this.pickups.filter((q) => q.alive);
    this.followCamera(dt);
  }

  updateSewerDead(dt) {
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.camera.update(dt, this.player.x, this.player.y);
  }

  // Cámara del jugador con el adelanto hacia donde apunta (la misma lógica que el bucle normal).
  followCamera(dt) {
    const o = this.lookOffset(dt);
    this.camera.update(dt, this.player.x + o.x, this.player.y + o.y);
  }

  // Desplazamiento de la cámara respecto al jugador (mirada adelantada). Normal: en PC una fracción de la distancia al cursor y en táctil un adelanto fijo hacia donde mira, con tope.
  // Con la máscara RICK (`perks.lookAhead` > 1) el foco va MUCHO más lejos, SIN tocar el zoom ni el tamaño de los sprites: en PC hacia el cursor (×2,4, tope 168 u); en táctil hacia
  // donde apuntas con el joystick derecho (125 u), o hacia donde empujas el izquierdo (95 u), o hacia donde mira en reposo (70 u). El desplazamiento se suaviza aparte (`lookS`,
  // constante 0,16 s) y se limita a ~60 % de media pantalla, así el jugador nunca sale de un margen seguro; los límites del nivel los aplica `Camera.clampTarget`.
  lookOffset(dt) {
    const p = this.player, k = p.perks ? p.perks.lookAhead : 1, inp = this.input;
    let lx, ly;
    if (!(k > 1)) {                                                // el comportamiento de siempre
      this.lookS = null;
      if (inp.touchMode) { lx = Math.cos(p.angle) * TOUCH_LOOKAHEAD; ly = Math.sin(p.angle) * TOUCH_LOOKAHEAD; }
      else { const m = this.mouseWorld(); lx = (m.x - p.x) * CAMERA_LOOKAHEAD; ly = (m.y - p.y) * CAMERA_LOOKAHEAD; }
      const len = Math.hypot(lx, ly);
      if (len > MAX_LOOKAHEAD) { lx *= MAX_LOOKAHEAD / len; ly *= MAX_LOOKAHEAD / len; }
      return { x: lx, y: ly };
    }
    let cap = MAX_LOOKAHEAD * k;
    if (inp.touchMode) {
      const mv = inp.moveAxis, mm = Math.hypot(mv.x, mv.y);
      if (inp.aimActive) { lx = Math.cos(inp.aimAngle) * TOUCH_LOOKAHEAD * 2.5; ly = Math.sin(inp.aimAngle) * TOUCH_LOOKAHEAD * 2.5; }
      else if (mm > 0.2) { lx = (mv.x / mm) * TOUCH_LOOKAHEAD * 1.9; ly = (mv.y / mm) * TOUCH_LOOKAHEAD * 1.9; }
      else { lx = Math.cos(p.angle) * TOUCH_LOOKAHEAD * 1.4; ly = Math.sin(p.angle) * TOUCH_LOOKAHEAD * 1.4; }
    } else {
      const m = this.mouseWorld();
      lx = (m.x - p.x) * CAMERA_LOOKAHEAD * k; ly = (m.y - p.y) * CAMERA_LOOKAHEAD * k;
    }
    const cam = this.camera, safe = 0.6 * Math.min(cam.viewW, cam.viewH) / 2 / cam.zoom;   // el jugador siempre queda dentro del 60 % de media pantalla
    cap = Math.min(cap, safe);
    const len = Math.hypot(lx, ly);
    if (len > cap) { lx *= cap / len; ly *= cap / len; }
    const s = this.lookS || (this.lookS = { x: 0, y: 0 }), a = 1 - Math.exp(-dt / 0.16);   // suavizado: sin saltos bruscos al mover el ratón o el stick
    s.x += (lx - s.x) * a; s.y += (ly - s.y) * a;
    return { x: s.x, y: s.y };
  }

  // Dibujo del túnel (misma tubería que `render`: capas con la cámara, HUD y efectos de pantalla).
  renderSewer(ctx) {
    const run = this.sewerRun, { pixelW, pixelH } = this.map;
    this.camera.apply(ctx);
    ctx.drawImage(run.floorLayer, 0, 0, pixelW, pixelH);
    run.drawBelow(ctx);
    ctx.drawImage(this.bloodLayer, 0, 0, pixelW, pixelH);
    if (this.goreOn) this.prints.draw(ctx);
    this.particles.drawGround(ctx);
    ctx.drawImage(run.propsLayer, 0, 0, pixelW, pixelH);
    for (const q of this.pickups) q.draw(ctx, this.time);
    run.drawCroc(ctx);
    for (const b of this.bullets) b.draw(ctx);
    if (this.player.alive) { if (this.state === 'sewer') this.player.drawAim(ctx, this); this.drawClimber(ctx); }
    this.particles.draw(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(run.glowLayer, 0, 0, pixelW, pixelH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(run.wallLayer, 0, 0, pixelW, pixelH);
    if (this.wallBloodDirty && this.goreOn) ctx.drawImage(this.wallBloodLayer, 0, 0, pixelW, pixelH);
    this.drawObjectiveMarker(ctx); // sobre las paredes: la escalera está pegada al muro este y su rótulo no se corta
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(6, 40, 10, 0.26)';                     // ambiente: aire húmedo verde
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    this.renderHud(ctx);
    if (run.lootNear && this.state === 'sewer' && !this.panel && !this.comms.cur) {              // el cuerpo que devoraba el cocodrilo (RICK)
      const b = run.amb.bodies.find((q) => q.feed), s = this.camera.worldToScreen(b.x, b.y - 26), txt = `${this.hint(this.keys.label('kick'), 'BOTA')} · REGISTRAR EL CUERPO`, q = this.keepOnScreen(s.x, s.y, measureText(txt), 8);
      drawText(ctx, txt, q.x, q.y, { color: COLORS.text, align: 'center', shadow: COLORS.background });
    }
    if (run.nearLadder && this.state === 'sewer' && !this.panel) {     // aviso de la escalera
      const l = run.map.ladder, s = this.camera.worldToScreen(l.x, l.y - 26), txt = `${this.hint(this.keys.label('kick'), 'BOTA')} · SUBIR`, q = this.keepOnScreen(s.x, s.y, measureText(txt), 8);
      drawText(ctx, txt, q.x, q.y, { color: COLORS.text, align: 'center', shadow: COLORS.background });
    }
    this.drawFade(ctx);
    this.fx.compose(this.ctx, this.scene, this.frameDt);
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
      for (const e of this.allies.length ? this.enemies.concat(this.allies) : this.enemies) {
        if (!e.standing) continue;
        const hit = door.collide(e, this.map, { pushSpeed: ENEMY_PUSH_SPEED, canPush: () => e.doorContact() });
        if (hit === 'knock') this.doorKnock(door, e);
        else if (hit === 'push' && door.creakCd <= 0) { this.playAt('doorSoft', door.cx, door.cy, 0.6); door.creakCd = 0.5; } // un enemigo abre una puerta
      }
      if (!this.player.alive) continue;
      const wasClosed = Math.abs(door.offset) < 0.5 && !door.fast;
      const hitDoor = door.collide(this.player, this.map, { player: true });
      if (hitDoor === 'push' && wasClosed && door.creakCd <= 0) {
        // Empujón del jugador: la puerta se abre de golpe (y derriba a quien esté detrás).
        this.playAt('doorSoft', door.cx, door.cy, 0.8);
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
    this.playAt('doorKick', e.x, e.y);
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
        if (!this.sewerRun && this.street.bulletHit(b)) { b.alive = false; b.hitWall = false; continue; } // civil de la calle: la bala se detiene en él
        if (!this.sewerRun && this.hostages.bulletHit(b)) { b.alive = false; b.hitWall = false; continue; } // rehén: la bala lo mata (penalización y culpa)
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (segmentPointDistance(b.px, b.py, b.x, b.y, e.x, e.y) < e.r + b.r) {
            this.recordShotHit(b.shot);
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
      } else if (this.allies.some((a) => a.alive && !a.rise && segmentPointDistance(b.px, b.py, b.x, b.y, a.x, a.y) < a.r + b.r)) {
        const a = this.allies.find((q) => q.alive && !q.rise && segmentPointDistance(b.px, b.py, b.x, b.y, q.x, q.y) < q.r + b.r);
        this.allyHit(a, Math.atan2(b.vy, b.vx)); // las balas enemigas alcanzan a los aliados civiles (la tapa de alcantarilla aguanta)
        b.alive = false;
        b.hitWall = false;
      } else if (this.partner && this.partner.alive && !this.partner.away && segmentPointDistance(b.px, b.py, b.x, b.y, this.partner.x, this.partner.y) < this.partner.r + b.r) {
        this.killPartner(Math.atan2(b.vy, b.vx)); // las balas enemigas también alcanzan al compañero inactivo
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
          if (this.goreOn) { p.blood = p.blood || newWeaponBlood(); stainWeaponBlood(p.blood, 0.8, !!e.toxic); } // el arma lanzada se mancha al impactar
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
    if (e.weapon) {
      const p = new Pickup(e.weapon.type, e.x, e.y, e.weapon.ammo);
      p.throwAt(rand(0, TAU), 120);
      this.pickups.push(p);
      e.weapon = null;
    }
    if (e.meleeWeapon) {
      const p = new Pickup(e.meleeWeapon, e.x, e.y, 0);
      p.throwAt(rand(0, TAU), 120);
      this.pickups.push(p);
      e.meleeWeapon = null;
      e.refreshMelee();
    }
  }

  // `cause` es el estilo de la baja para la puntuación (ver STYLE en score.js).
  // Charco de vómito del jugador (culpa): misma capa del suelo, paleta amarillo verdosa y sin manchar las suelas.
  vomitSplat(x, y, angle, power) {
    this.bpal = VOMIT;
    this.splatBlood(x, y, angle, power, 0.5, false);
    this.bpal = RED;
  }

  // Tubo oxidado (y demás armas con `poison`): no mata, NOQUEA e INTOXICA. El enemigo cae al suelo y no se levanta;
  // agoniza POISON_TIME (3,6 s) y muere solo (causa 'poison', sangre verde) salvo que lo remates antes (ejecución, sangre verde también).
  // Contra el jefe no se usa (ver Player.attack): pega como un arma normal.
  poisonEnemy(e, angle, time = POISON_TIME) {
    if (!e.alive) return;
    e.toxic = true; // toda su sangre será verde
    if (e.poison > 0) { e.poison = Math.max(e.poison, time * 0.7); return; }
    e.poison = time;
    e.poisonAngle = angle;
    e.poisonTick = 0;
    const armed = !!(e.weapon || e.meleeWeapon);
    if (e.standing) { e.knockDown(angle, this.map); this.dropWeapon(e); } // noqueado: suelta el arma y queda en el suelo
    this.addFloat(e.x, e.y - 18, 'INTOXICADO', '#9be32a', 1, 1.3);
    if (armed) this.addFloat(e.x, e.y - 30, '¡DESARME!', COLORS.player, 1, 1.0);
    if (this.goreOn) this.particles.blood(e.x, e.y, angle, 8, 0.8, true);
    this.particles.dust(e.x, e.y, 5);
    this.camera.addShake(4);
    this.fx.kick(0.2);
    this.hitstop = Math.max(this.hitstop, HITSTOP.knock);
    this.playAt('knock', e.x, e.y);
  }

  // ¿Esta baja es "tóxica" (sangre verde)? El enemigo intoxicado, o rematado/golpeado con un arma con veneno en la mano.
  isToxicKill(e, cause) {
    if (e.toxic || cause === 'poison') return true;
    const w = this.player.weapon, def = w && WEAPON_DEFS[w.type];
    return !!(def && def.poison && (cause === 'execution' || cause === 'melee'));
  }

  // Burbujas verdes subiendo sobre los enemigos envenenados.
  drawPoison(ctx) {
    for (const e of this.enemies) {
      if (!e.alive || !(e.poison > 0)) continue;
      ctx.fillStyle = 'rgba(122, 208, 58, 0.22)';
      pixelDisc(ctx, e.x / WORLD_PX, e.y / WORLD_PX, 9, WORLD_PX);
      ctx.fillStyle = '#7ad03a';
      for (let k = 0; k < 3; k++) {
        const ph = (this.time * 1.6 + k * 0.33) % 1;
        pixelRect(ctx, e.x + (k - 1) * 8 + Math.sin(this.time * 5 + k * 2) * 3, e.y - 6 - ph * 18, 1, 1);
      }
    }
  }

  killEnemy(e, angle, cause = 'bullet', src = null) {
    if (!e.alive) return;
    // El jefe absorbe los golpes que no lo matan (coraza, vida): ver Boss.guardKill.
    if (e.guardKill && !e.guardKill(cause, angle, this, src)) return;
    const feel = KILL_FEEL[cause] || KILL_FEEL.bullet;
    e.alive = false;
    this.stats.kills++;
    this.addScore(cause, e);
    this.dropWeapon(e);
    if (e.carrier) this.dropMask(e);
    if (e.hasKey) this.dropKey(e);
    e.corpse = { x: e.x + Math.cos(angle) * 8, y: e.y + Math.sin(angle) * 8 }; // donde se estampa el cadáver
    const tox = this.isToxicKill(e, cause);
    const wd = this.player.weapon && WEAPON_DEFS[this.player.weapon.type];
    const power = feel.power * ((cause === 'melee' || cause === 'execution') && wd && wd.gore ? wd.gore : 1); // el bate con clavos (`gore`) es más sangriento
    this.bleed(e.x, e.y, angle, power, feel.wide, tox);
    this.stainPlayer(power, angle, tox);
    // El arma que llevas se mancha con lo que mata: golpe, remate o disparo TUYO (las balas del aliado no manchan tu arma).
    if (cause === 'melee' || cause === 'execution' || (cause === 'bullet' && src && src.src && !src.ally && this.player.weapon && src.src === this.player.weapon.type)) this.stainWeapon(power, tox);
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
    weaponGore.on = this.goreOn; // las armas manchadas también se apagan con la opción de sangre
    if (!this.player) return;
    this.player.bloodLevel = this.goreOn ? bloodLevelFor(this.gore) : 0;
    if (this.partner) this.partner.bloodLevel = this.goreOn ? bloodLevelFor(this.partnerBlood.gore) : 0;
    if (!this.goreOn) { this.prints.clear(); this.player.soles = 0; }
  }

  // Vuelve a dejar limpio al personaje (piso nuevo o partida nueva): sangre acumulada y la mezcla de colores de su máscara.
  resetStains() {
    this.gore = 0;       // total de sangre (roja + verde)
    this.goreGreen = 0;  // parte verde tóxica
    this.maskBits = [];  // por cada gota de la máscara del HUD: 1 verde, 0 roja (ver bloodyMaskPortrait)
    this.accG = 0; this.accT = 0; // lo acumulado desde el último nivel (decide el color de las manchas nuevas)
    this.soakAt = 0;
    this.partnerBlood = { gore: 0, goreGreen: 0, maskBits: [], accG: 0, accT: 0 }; // la sangre del agente que NO se controla (se intercambia con la anterior en el relevo)
    this.partnerPos = null; this.partnerMaskIndex = this.partnerMaskIndex ?? null;
  }

  // `tox`: la sangre que te mancha es verde tóxica. Las manchas nuevas de la máscara toman el color de lo que las ha causado, así que
  // la máscara acaba reflejando la mezcla de fluidos (rojo y verde) que has acumulado.
  stainPlayer(power, angle, tox = false) {
    this.gore += power; // se sigue contando: si se vuelve a activar la sangre, el personaje la recupera
    if (tox) this.goreGreen += power;
    this.accT += power;
    if (tox) this.accG += power;
    const level = bloodLevelFor(this.gore);
    const need = BLOOD_DROPS[level];
    if (this.maskBits.length < need) {
      const frac = this.accT > 0 ? this.accG / this.accT : 0;
      while (this.maskBits.length < need) this.maskBits.push(Math.random() < frac ? 1 : 0);
      this.accG = this.accT = 0;
    }
    if (!this.goreOn) return;
    if (level === this.player.bloodLevel) return;
    this.player.bloodLevel = level;
    this.particles.blood(this.player.x, this.player.y, angle + Math.PI, 5, 1.2, tox);
  }

  // Pisar un charco (o un cadáver) mancha un poco, como mucho cada 1,4 s, con el color del fluido.
  soak(tox, angle) {
    const now = performance.now();
    if (now - this.soakAt < 1400) return;
    this.soakAt = now;
    this.stainPlayer(0.2, angle + Math.PI, tox);
  }

  // ¿Pisa (x, y) sangre fresca? Un cadáver o un charco de baja: empapa las suelas del jugador.
  bloodUnderfoot(x, y) {
    if (!this.goreOn) return 0;
    for (const e of this.enemies) {
      if (!e.alive && e.corpse && Math.hypot(e.corpse.x - x, e.corpse.y - y) < CORPSE_STEP_RADIUS) return e.toxic ? 2 : 1;
    }
    for (const p of this.pools) if (Math.hypot(p.x - x, p.y - y) < p.r) return p.tox ? 2 : 1;
    return 0;
  }

  // Todo el desangrado de una baja: partículas (sangre, restos, chispas de neón), charco y
  // regueros en el suelo y salpicaduras en las paredes de enfrente. Lo permanente se queda hasta
  // que se reinicia el piso.
  // `tox`: sangre verde tóxica (paleta `TOXIC`) en vez de roja, en partículas, charcos y paredes.
  bleed(x, y, angle, power, wide, tox = false) {
    if (!this.goreOn) { this.particles.cleanKill(x, y, angle, power, wide); return; }
    this.particles.gore(x, y, angle, power, wide, tox);
    this.bpal = palOf(tox);
    this.splatBlood(x, y, angle, power, wide);
    this.splatWalls(x, y, angle, power, wide);
    this.bpal = RED;
  }

  addScore(cause, e) {
    this.score.register(cause, e.x, e.y - 14);
    if (this.score.combo > 1) {
      this.sfx.play('combo', 1, this.score.combo);
      // El multiplicador activo sube junto al enemigo: más caliente cuanto más alto.
      const c = this.score.combo;
      this.addFloat(e.x + 12, e.y - 4, `x${c}`, c >= 5 ? COLORS.blood : c >= 3 ? COLORS.enemy : COLORS.player, c >= 4 ? 2 : 1);
    }
  }

  // --- Estadísticas del intento (panel de resultados y de muerte) ---------------------------------------------------
  // attacks = golpes cuerpo a cuerpo (sin patadas a puertas ni ejecuciones) + disparos; hits = golpes que conectan + disparos
  // cuyas balas alcanzan a alguien; uses = veces que se ha usado cada arma (la favorita es la más usada); kills = bajas.
  newStats() {
    return { attacks: 0, hits: 0, kills: 0, shotSeq: 1, hitShots: new Set(), uses: {} };
  }

  // Registra un ataque con el arma `type` ('fists' para los puños). Devuelve el id del disparo (para marcar sus aciertos).
  recordAttack(type, hit) {
    const st = this.stats;
    st.attacks++;
    st.uses[type] = (st.uses[type] || 0) + 1;
    if (hit) st.hits++;
    return st.shotSeq++;
  }

  recordShotHit(shotId) {
    if (shotId && !this.stats.hitShots.has(shotId)) { this.stats.hitShots.add(shotId); this.stats.hits++; }
  }

  // Resumen para mostrar: tiempo (m:ss), precisión (%, '--' si no se atacó), bajas y arma favorita.
  statsSummary() {
    const st = this.stats;
    const t = Math.max(0, Math.floor(this.time));
    const fav = Object.entries(st.uses).sort((a, b) => b[1] - a[1])[0];
    return {
      time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
      accuracy: st.attacks > 0 ? `${Math.round((st.hits / st.attacks) * 100)}%` : '--',
      kills: st.kills,
      favorite: fav ? (WEAPON_DEFS[fav[0]] ? WEAPON_DEFS[fav[0]].short || WEAPON_DEFS[fav[0]].name : fav[0].toUpperCase()) : '--', // nombre corto si lo tiene (cabe en el panel)
    };
  }

  // Mini panel flotante (marco neón, 4 líneas) en (x, y); devuelve su alto.
  // Líneas del panel: etiqueta + valor. La etiqueta del arma es corta ("MÁS USADA") para dejar sitio a nombres largos.
  statsRows(sum) {
    return [['TIEMPO', sum.time], ['PRECISIÓN', sum.accuracy], ['BAJAS', String(sum.kills)], ['MÁS USADA', sum.favorite]];
  }

  // Ancho del panel: el de siempre (156) o el que haga falta para que etiqueta y valor de cada línea no se solapen (tope 190).
  statsPanelWidth(sum) {
    const need = Math.max(...this.statsRows(sum).map(([l, v]) => measureText(`${l}:`) + measureText(v) + 22));
    return clamp(Math.ceil(need), 156, 190);
  }

  drawStatsPanel(ctx, x, y, sum) {
    const w = this.statsPanelWidth(sum), h = 53;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    drawText(ctx, 'ESTADÍSTICAS', x + w / 2, y + 4, { color: '#9d8fb8', align: 'center' });
    this.statsRows(sum).forEach(([label, value], i) => {
      const ry = y + 15 + i * 9;
      drawText(ctx, `${label}:`, x + 6, ry, { color: '#9d8fb8' });
      drawText(ctx, value, x + w - 6, ry, { color: COLORS.text, align: 'right' });
    });
    return h;
  }

  // Recompensa del PORTADOR: al abatirlo su máscara cae al suelo con un brillo neón y se DESBLOQUEA de forma permanente (se guarda al
  // instante en settings: no hace falta recogerla; recogerla solo da el último destello). Texto flotante, ráfaga de neón y sonido.
  dropMask(e) {
    const mask = MASKS.find((m) => m.id === e.carrier);
    if (!mask) return;
    const isNew = this.settings.unlockMask(mask.id);
    this.maskDrops.push({ x: e.x, y: e.y, mask, t: 0 });
    this.particles.neon(e.x, e.y, 0, 24, Math.PI);
    this.sfx.play('clear');
    this.camera.addShake(6);
    if (isNew) this.addFloat(e.x, e.y - 34, `¡MÁSCARA ${mask.name} DESBLOQUEADA!`, e.aura || COLORS.enemy, 1, 2.8);
  }

  updateMaskDrops(dt) {
    const p = this.player;
    for (const d of this.maskDrops) {
      d.t += dt;
      if (!d.taken && p.alive && Math.hypot(p.x - d.x, p.y - d.y) < 20) {
        d.taken = true;
        this.particles.neon(d.x, d.y, 0, 18, Math.PI);
        this.sfx.play('pickup');
      }
    }
    this.maskDrops = this.maskDrops.filter((d) => !d.taken);
  }

  drawMaskDrops(ctx) {
    for (const d of this.maskDrops) {
      const k = 0.5 + 0.5 * Math.sin(d.t * 6), bob = Math.round(Math.sin(d.t * 3) * 2);
      const col = (this.carrierColors || {})[d.mask.id] || '#ff9d2e';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.15 + 0.15 * k;
      pixelDisc(ctx, d.x, d.y, 11, WORLD_PX);
      ctx.globalAlpha = 0.3 + 0.2 * k;
      pixelDisc(ctx, d.x, d.y, 7, WORLD_PX);
      ctx.restore();
      ctx.drawImage(maskIcon(d.mask), Math.round(d.x - 12), Math.round(d.y - 12 + bob), 24, 24);
    }
  }

  // Texto táctico flotante en el mundo (¡QUEMARROPA!, ¡DESARME!, x3…): sube unos 24 u, entra con un "pop" a doble tamaño y se
  // desvanece al final. Solo dibujo (drawFloatingTexts); no afecta a la jugabilidad.
  // Frase de un enemigo sobre su cabeza (texto flotante). Como mucho una cada 0,9 s en toda la partida (así varios enemigos no se pisan ni hacen spam) y
  // nunca la misma dos veces seguidas; `force` (¡CADÁVER!) se salta el límite. Solo en pantalla y con jugador vivo.
  bark(e, text, force = false) {
    if (!text || !this.player.alive) return;
    if (!force && (this.barkCd > 0 || text === this.lastBark)) return;
    this.barkCd = 0.9;
    this.lastBark = text;
    this.addFloat(e.x, e.y - 24, text, COLORS.enemy, 1, 1.5);
  }

  addFloat(x, y, text, color = COLORS.text, scale = 1, life = 0.9) {
    if (this.floatingTexts.length > 14) this.floatingTexts.shift();
    this.floatingTexts.push({ x, y, text, color, scale, t: life, max: life });
  }

  // Centro (x) y arriba (y) de un texto de ancho `tw` y alto `th`, corregidos para que quepa entero en la pantalla, con un margen
  // y respetando las zonas seguras. Sirve a textos flotantes, popups de puntos, avisos y burbujas (nunca salen cortados).
  keepOnScreen(x, y, tw, th, margin = 4) {
    const w = this.scene.width, h = this.scene.height, sf = this.safe;
    const touch = this.input.touchMode && this.touch;
    // En táctil, los textos que caen a la altura de la columna de botones de la derecha (ATACAR / LANZAR / acción) se quedan a su izquierda.
    let right = w - sf.r - margin;
    if (touch) { const col = this.touch.rightColumn(); if (y + th > col.y - 2) right = Math.min(right, col.x - 4); }
    const cx = clamp(x, sf.l + margin + tw / 2, Math.max(sf.l + margin + tw / 2, right - tw / 2));
    let cy = clamp(y, sf.t + margin, Math.max(sf.t + margin, h - sf.b - margin - th));
    // Y esquivan el HUD de las esquinas de arriba (izquierda: arma, máscara y, en táctil, REINICIAR/PAUSA; derecha: puntos): se bajan por debajo.
    const rz = { x: w - sf.r - 134, b: (flagsOn(this) ? 31 : 22) + sf.t }, lz = { x: sf.l + (touch ? 78 : 118), b: (touch ? 84 : 52) + sf.t };
    for (let k = 0; k < 2; k++) {
      if (cx + tw / 2 > rz.x && cy < rz.b) cy = rz.b;
      if (cx - tw / 2 < lz.x && cy < lz.b) cy = lz.b;
    }
    return { x: cx, y: Math.min(cy, Math.max(sf.t + margin, h - sf.b - margin - th)) };
  }

  drawFloatingTexts(ctx) {
    for (const f of this.floatingTexts) {
      const age = f.max - f.t;
      const s = this.camera.worldToScreen(f.x, f.y - age * 26);
      ctx.globalAlpha = Math.min(1, f.t * 4);
      const sc = age < 0.1 ? f.scale + 1 : f.scale;
      const p = this.keepOnScreen(s.x, s.y, measureText(f.text) * sc, CELL_H * sc);
      drawText(ctx, f.text, p.x, p.y, { color: f.color, scale: sc, align: 'center', shadow: COLORS.background });
    }
    ctx.globalAlpha = 1;
  }

  // Golpe intermedio de una ejecución (cuchillo, tubo, ráfaga): hiere sin matar. Salpica un poco, hace
  // temblar al derribado y suena; sin sangre (ajuste) salen chispas de neón.
  woundEnemy(e, angle, style) {
    if (e.onWound) e.onWound(style, this);
    if (this.goreOn) {
      const tox = this.isToxicKill(e, 'execution');
      this.particles.blood(e.x, e.y, angle, style === 'burst' ? 6 : 9, 0.8, tox);
      this.bpal = palOf(tox);
      this.splatBlood(e.x, e.y, angle, 0.4, 0.6);
      this.bpal = RED;
    } else {
      this.particles.neon(e.x, e.y, angle, 8, 0.9);
    }
    this.stainPlayer(0.35, angle, this.isToxicKill(e, 'execution'));
    this.stainWeapon(0.4, this.isToxicKill(e, 'execution')); // los golpes intermedios del remate también manchan el arma
    this.camera.addShake(4);
    this.hitstop = Math.max(this.hitstop, 0.03);
    this.sfx.play(style === 'knife' ? 'hit' : 'crunch', 0.6);
  }

  knockDown(e, angle, cause = 'fists') {
    if (!e.standing) return;
    if (e.guardKnock && !e.guardKnock(cause, angle, this)) return;
    const armed = !!(e.weapon || e.meleeWeapon);
    e.knockDown(angle, this.map);
    this.addScore(cause, e);
    this.dropWeapon(e);
    if (cause === 'thrown') this.addFloat(e.x, e.y - 18, armed ? '¡DESARME!' : '¡GOLPE!', COLORS.player, 1, 1.0);
    this.particles.dust(e.x, e.y, 6);
    this.camera.addShake(3);
    this.fx.kick(0.2);
    this.hitstop = Math.max(this.hitstop, HITSTOP.knock);
    this.playAt('knock', e.x, e.y);
  }

  // --- Compañero y relevo (pisos `duo`; ver docs/prompt-nivel-10-climax.md, tanda A) -------------------------------------------------------------------------
  // `player` es el agente activo y `partner` el otro: queda quieto, visible y vulnerable (los enemigos lo ven y lo atacan). `swapControl` los intercambia (también
  // su máscara y su sangre). R vuelve a empezar con el primer agente al mando y el compañero donde estaba.
  defaultPartnerMask() {
    const cur = this.maskList.indexOf(this.mask);
    const i = this.maskList.findIndex((m, k) => k !== cur && this.isMaskUnlocked(m));
    return i >= 0 ? i : cur;
  }

  makePartner(start) {
    if (this.partnerMaskIndex == null) this.partnerMaskIndex = this.defaultPartnerMask();
    this.partnerMask = this.maskList[this.partnerMaskIndex];
    const pos = this.partnerPos || { x: start.x + 26, y: start.y };
    const t = new Player(pos.x, pos.y, maskEffects(this.partnerMask), this.partnerMask.id, true);
    t.agentId = 'support';
    t.gender = this.gender === 'female' ? 'male' : 'female';
    t.angle = -Math.PI / 2;
    t.bloodLevel = this.goreOn ? bloodLevelFor(this.partnerBlood.gore) : 0;
    this.partner = t;
  }

  toggleDebugPartner() {
    if (this.state !== 'playing' && this.state !== 'cleared') return;
    if (this.partner) { this.partner = null; this.debugDuo = false; this.duoOn = false; this.addFloat(this.player.x, this.player.y - 24, 'SIN COMPAÑERO', COLORS.text, 1, 1); return; }
    if (this.swapped) return;
    this.debugDuo = true; this.duoOn = true; this.partnerPos = null; this.partnerMaskIndex = null;
    this.makePartner({ x: this.player.x, y: this.player.y });
    this.addFloat(this.partner.x, this.partner.y - 24, 'COMPAÑERO', COLORS.player, 1, 1.2);
  }

  // Intercambia la máscara y la sangre acumulada del agente activo y del compañero (el HUD y el dibujo siguen a `this.mask`/`this.gore`).
  swapBundles() {
    for (const k of ['gore', 'goreGreen', 'maskBits', 'accG', 'accT']) { const t = this[k]; this[k] = this.partnerBlood[k]; this.partnerBlood[k] = t; }
    [this.mask, this.partnerMask] = [this.partnerMask, this.mask];
  }

  // Relevo: el control pasa al otro agente en un fotograma (cámara al instante, 0,25 s sin atacar para que la pulsación no se vuelva un golpe).
  swapControl(force = false) {
    const a = this.player, b = this.partner;
    if (!b || !b.alive || !a.alive) return false;
    if (!force && ((this.state !== 'playing' && this.state !== 'cleared') || a.exec || a.vomit || this.panel)) return false;
    a.cancelExecution();
    this.player = b; this.partner = a;
    // Quien vuelve a ser jugador deja de ser el aliado de IA: pierde la inmortalidad y la munición infinita (queda con un cargador normal).
    b.immortal = false;
    if (b.weapon && b.weapon.ammo >= 9999) b.weapon = { type: b.weapon.type, ammo: WEAPON_DEFS[b.weapon.type].maxAmmo };
    this.swapBundles();
    this.swapped = !this.swapped;
    b.cooldown = Math.max(b.cooldown, 0.25);
    this.sfx.voice = b.gender === 'female' ? 1.22 : 1;
    this.camera.snap(b.x, b.y);
    this.addFloat(b.x, b.y - 26, `RELEVO: ${this.mask.name}`, COLORS.player, 1, 1.4);
    this.sfx.play('pickup');
    this.fx.kick(0.3);
    this.touch.haptic(20);
    return true;
  }

  // --- Fase final del piso 10 (tanda C): reencuentro, elección de rol y asalto final -----------------------------------------------------------------------
  // El jugador (el compañero) llega hasta el agente rescatado → cinemática de REENCUENTRO → elección de ROL: LIMPIEZA (te quedas dentro con el primer agente; el compañero
  // cubre desde la calle) o PERÍMETRO (te quedas fuera con el compañero frente a 2 oleadas; el primer agente limpia dentro). El aliado lo lleva la IA (`updateAlly`) y es inmortal.
  agentMasks() {
    const mainActive = this.player.agentId === 'main';
    return { main: mainActive ? this.mask : this.partnerMask, support: mainActive ? this.partnerMask : this.mask, mainP: mainActive ? this.player : this.partner, supportP: mainActive ? this.partner : this.player };
  }

  startReunion() {
    this.state = 'reunion';
    this.reunion = { t: 0 };
    const a = this.player, b = this.partner;
    a.angle = Math.atan2(b.y - a.y, b.x - a.x); b.angle = a.angle + Math.PI;
    this.showCallout('REENCUENTRO', COLORS.player, 2.2, '¡LO HICIMOS!');
    this.addFloat((a.x + b.x) / 2, Math.min(a.y, b.y) - 26, '¡ESTÁS BIEN!', COLORS.player, 1, 1.8);
    this.sfx.play('pickup');
    this.maskMouse = this.mouseInternal();
  }

  updateReunion(dt) {
    const R = this.reunion, a = this.player, b = this.partner;
    R.t += dt;
    this.callout && (this.callout.t -= dt) <= 0 && (this.callout = null);
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    this.camera.update(dt, (a.x + b.x) / 2, (a.y + b.y) / 2);
    if (R.t >= 2.4) { this.state = 'role'; this.roleIndex = 0; this.roleT = 0; this.callout = null; }
  }

  roleLayout() {
    const w = this.scene.width, h = this.scene.height, sf = this.safe, gap = 8, cw = Math.floor((w - 24 - gap) / 2), top = 36, ch = Math.max(90, h - top - 22 - sf.b);
    return [0, 1].map((i) => ({ x: 12 + i * (cw + gap), y: top, w: cw, h: ch }));
  }

  updateRoleSelect() {
    const input = this.input;
    this.roleT = (this.roleT || 0) + 1 / 60;
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.roleIndex = 0;
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.roleIndex = 1;
    const m = this.mouseInternal(), cards = this.roleLayout();
    const moved = Math.hypot(m.x - this.maskMouse.x, m.y - this.maskMouse.y) > 0.5;
    this.maskMouse = m;
    const hov = cards.findIndex((c) => m.x >= c.x && m.x < c.x + c.w && m.y >= c.y && m.y < c.y + c.h);
    if (hov >= 0 && moved) this.roleIndex = hov;
    if (this.roleT < 0.5) return; // que la pulsación que cerró la cinemática no confirme sola
    if (input.touchMode && input.mousePressed.left && hov >= 0 && hov !== this.roleIndex) { this.roleIndex = hov; return; } // táctil: el primer toque elige, el segundo confirma
    const ok = input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || (input.mousePressed.left && hov >= 0);
    if (!ok) return;
    if (hov >= 0 && input.mousePressed.left) this.roleIndex = hov;
    this.chooseRole(this.roleIndex);
  }

  chooseRole(idx) {
    this.state = 'playing';
    this.player.cooldown = 0.3;
    this.sfx.play('pickup');
    this.beginFinal(idx === 0 ? 'limpieza' : 'perimetro', false);
  }

  // Empieza el asalto final con el rol elegido. `retry` (R): la trampa ya está resuelta, ambos agentes en el despacho y solo quedan los FINAL_KEEP enemigos más lejos de él.
  beginFinal(role, retry = false) {
    const T = this.trap;
    if (!T || !this.partner) return;
    if (retry) {
      T.state = 'done'; T.fade = 0; T.t = GAS_TIME;
      for (const d of T.doors) { const door = this.doors.find((x) => x.tx === d.tx && x.ty === d.ty); if (door) { door.locked = false; door.closing = false; door.offset = 0; door.angVel = 0; } }
      this.partner.away = false;
      this.player.x = T.center.x - 24; this.player.y = T.center.y; this.partner.x = T.center.x + 24; this.partner.y = T.center.y;
      this.inside = true;
    }
    this.trapRetry = false;
    if (this.trapCheckpoint && !retry) { this.trapCheckpoint.total = this.score.total; this.trapCheckpoint.levelScore = this.score.levelScore; } // R en la fase final conserva los puntos de este momento
    else if (this.trapCheckpoint) { this.score.total = this.trapCheckpoint.total; this.score.levelScore = this.trapCheckpoint.levelScore; }
    this.finalRole = role; this.finalRetry = true;
    const want = role === 'limpieza' ? 'main' : 'support';
    if (this.player.agentId !== want) this.swapControl(true);
    const ext = T.ext, out = role === 'limpieza' ? this.partner : this.player, animated = !retry && !!this.ladderRoom && !!T.manhole;
    if (!animated) { out.x = ext.x; out.y = ext.y; out.angle = -Math.PI / 2; } // (R: directo a la calle; con animación, el agente de apoyo sale por la alcantarilla: ver beginExit)
    const ally = this.partner;
    ally.immortal = true; ally.weapon = { type: 'smg', ammo: 9999 }; ally.fireCd = 0; ally.path = null; ally.pathT = 0;
    if (retry) {                                                      // R en la fase final: se vuelve al PUNTO DE REPETICIÓN (restoreFinalCheckpoint); sin él, los 6 enemigos más lejos
      if (this.finalCheckpoint) this.restoreFinalCheckpoint(role);
      else {
        const far = this.enemies.filter((e) => e.alive).sort((p, q) => Math.hypot(q.x - T.center.x, q.y - T.center.y) - Math.hypot(p.x - T.center.x, p.y - T.center.y));
        far.slice(FINAL_KEEP).forEach((e) => { e.alive = false; });
      }
    }
    this.final = { role, wave: 0, stage: 'wait', timer: 3.5, done: false, montage: null, ambushPending: false, civ: this.makeCivCast(), civScene: false, allyScene: false, civPending: false, civRumble: null, civT: 0, civShout: 3 };
    this.final.civPending = this.final.civ.length > 0; this.final.civScene = this.final.civPending;
    // Emboscada: solo si juegas LIMPIEZA (dentro) y al elegirlo quedan menos de AMBUSH_MIN enemigos vivos; con 3 o más no ocurre nunca (y con R, que deja 6, tampoco).
    if (role === 'limpieza' && this.hatch && !this.hatch.used && this.enemies.filter((e) => e.alive).length < AMBUSH_MIN) this.final.ambushPending = true;
    // Civiles hostiles en LIMPIEZA: tras la emboscada de la trampilla (o a los pocos segundos si no hay emboscada) suben por la escalera del cuarto de servicio.
    this.final.civT = this.final.civPending ? (this.hatch && this.hatch.used ? 4 : this.final.ambushPending ? 5.5 : 8) : 0;
    if (animated) this.beginExit(out, role); else this.startFinalPlay(role, retry);
  }

  // Arranque del asalto final tras situar a los agentes (directo en un reintento, o al acabar la salida animada).
  startFinalPlay(role, retry = false) {
    if (role === 'perimetro') this.supplyDrop(true); // quien defiende la calle empieza armado y con armas a mano
    this.spawnAllies(role); // karma bueno: civiles ayudados que pelean a tu lado (y mafiosos extra); también tras R
    if (!retry) this.captureFinalCheckpoint(); // PUNTO DE REPETICIÓN de la fase final: así empieza el asalto (ver captureFinalCheckpoint)
    this.camera.snap(this.player.x, this.player.y);
  }

  // --- Campo de pruebas: reposición de armas y reaparición de maniquís -------------------------------------------------------------------------------
  // Cada hueco del mostrador repone su arma 0,8 s después de que se coja (así se pueden probar todas, las veces que haga falta); los maniquís caídos reaparecen en su sitio a los 2,5 s
  // (un enemigo nuevo: vida y escudo completos, limpio de veneno), con un destello de neón.
  updateRange(dt) {
    if (this.rangeSlots) {
      for (const s of this.rangeSlots) {
        if (this.pickups.some((k) => k.alive && k.type === s.type && Math.hypot(k.x - s.x, k.y - s.y) < 22)) { s.t = 0; continue; }
        s.t += dt;
        if (s.t >= 0.8) { s.t = 0; this.pickups.push(new Pickup(s.type, s.x, s.y)); this.particles.neon(s.x, s.y, 0, 8, Math.PI * 2); }
      }
    }
    if (this.rangeDefs) {
      for (let i = 0; i < this.rangeDefs.length; i++) {
        const e = this.enemies[i];
        if (!e || e.alive) continue;
        e.respT = (e.respT || 0) + dt;
        if (e.respT < 2.5) continue;
        const n = this.makeEnemy(this.rangeDefs[i]);
        this.enemies[i] = n;
        this.particles.neon(n.x, n.y, 0, 10, Math.PI * 2);
      }
    }
  }

  // Los nombres de las armas sobre el mostrador del campo de pruebas.
  drawRangeLabels(ctx) {
    if (!this.testRange || !this.rangeSlots) return;
    this.rangeSlots.forEach((s, i) => {          // en dos alturas alternas: los nombres largos no se pisan con los de al lado
      const d = WEAPON_DEFS[s.type], name = d.short || d.name;
      drawText(ctx, name, s.x, s.y + 12 + (i % 2) * 14, { color: '#9d8fb8', scale: WORLD_PX, align: 'center' });
    });
  }

  // PUNTO DE REPETICIÓN DE LA FASE FINAL: se captura al empezar el asalto (rol elegido y salida hecha) y otra vez al TERMINAR la emboscada de la trampilla (los refuerzos ya van a por ti).
  // R vuelve exactamente a ese momento: los mismos enemigos vivos, en su sitio y con la MISMA conciencia (los que ya iban a por ti siguen yendo a por ti, no «olvidan»), los refuerzos de
  // la trampilla ya fuera y en persecución (la emboscada no se repite) y el agente con el ARMA con la que empezó (y su munición), no con las manos vacías.
  captureFinalCheckpoint() {
    const p = this.player;
    this.finalCheckpoint = {
      role: this.finalRole, px: p.x, py: p.y,
      weapon: p.weapon ? { type: p.weapon.type, ammo: p.weapon.ammo, blood: p.weapon.blood ? { ...p.weapon.blood } : null } : null,
      ambushDone: !!(this.hatch && this.hatch.used),
      enemies: this.enemies.map((e, i) => (e.alive ? { i, ambushIdx: e.ambushIdx, x: e.x, y: e.y, angle: e.angle, aware: e.state === 'chase' || e.state === 'alert' || !!e.alarmed } : null)).filter(Boolean),
    };
  }

  // Mancha el arma que lleva el jugador (rojo o verde según el fluido) y la hace escalar de nivel con más impactos. Cada arma conserva su historial (ver weapons.js).
  stainWeapon(power, tox = false) {
    const w = this.player && this.player.weapon;
    if (!w || !this.goreOn) return;
    stainWeaponBlood(w.blood || (w.blood = newWeaponBlood()), power, tox);
  }

  // El enemigo sabe dónde estás (como los refuerzos al salir de la trampilla): persecución, alarmado y con la mira en ti.
  alertEnemy(e) {
    const p = this.player;
    e.found = true; e.alarmed = true; e.state = 'chase'; e.target = { x: p.x, y: p.y }; e.attackCd = 0.8;
  }

  restoreFinalCheckpoint(role) {
    const cp = this.finalCheckpoint, n0 = this.levelEnemyCount, p = this.player;
    const keep = new Set(cp.enemies.filter((c) => c.ambushIdx === undefined && c.i < n0).map((c) => c.i));
    this.enemies.forEach((e, i) => { if (i < n0 && !keep.has(i)) e.alive = false; });
    if (cp.ambushDone && this.hatch) { this.hatch.used = true; this.hatch.state = 'open'; this.hatch.open = 1; } // la trampilla ya está abierta y no se repite la emboscada
    if (role === 'limpieza' && cp.role === 'limpieza') { p.x = cp.px; p.y = cp.py; p.angle = -Math.PI / 2; }     // dentro: donde estabas
    p.weapon = cp.weapon ? { ...cp.weapon } : null;                                                              // y con tu arma, no sin ella
    for (const c of cp.enemies) {
      if (c.ambushIdx !== undefined) this.spawnAmbushEnemy(c.ambushIdx, { x: c.x, y: c.y });                    // refuerzo de la trampilla (siempre en persecución)
      else if (c.i < n0) { const e = this.enemies[c.i]; e.x = c.x; e.y = c.y; e.angle = c.angle; e.path = null; if (c.aware) this.alertEnemy(e); }
    }
  }

  // --- Salida del agente de apoyo al elegir el rol (estado 'exit', ~5 s, Espacio / Enter / clic la salta tras 0,8 s) -------------------------------------------------------
  // La puerta principal está cerrada, así que el agente que se queda fuera (siempre el de apoyo: el compañero en LIMPIEZA, tú en PERÍMETRO) se va como llegó: 1) corre a la salida del
  // despacho (cámara en él), 2) corte: baja por la escalera del cuarto de servicio (se hunde en la boca, con peldaños), 3) corte: en la calle la tapa de la alcantarilla se desliza a
  // tirones, asoma y se pone en su puesto junto a la puerta (`trap.ext`). Después empieza el asalto (`startFinalPlay`).
  beginExit(out, role) {
    const name = (AGENTS[out.gender] || AGENTS.male).name;
    this.finalExit = { t: 0, out, role, from: { x: out.x, y: out.y }, stage: 0, rung: -1, lid: null };
    this.state = 'exit';
    this.callout = null;
    this.showCallout(role === 'limpieza' ? `${name} SALE A LA CALLE` : 'SALES A LA CALLE', COLORS.player, 2.6, role === 'limpieza' ? 'POR LA ALCANTARILLA · CUBRIRÁ EL PERÍMETRO' : 'POR LA ALCANTARILLA · DEFIENDE LA CALLE');
    this.sfx.play('pickup');
  }

  updateExit(dt, skip) {
    const X = this.finalExit, out = X.out, L = this.ladderRoom, T = this.trap, M = T.manhole, ext = T.ext;
    const ease = (k) => k * k * (3 - 2 * k), clamp01 = (v) => Math.max(0, Math.min(1, v));
    const CUT1 = 1.0, CUT2 = 2.7, END = 5.0;
    X.t += dt;
    if (X.t < END && this.holdSkip(X, dt)) X.t = END;
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    X.flash = Math.max(0, 1 - Math.min(Math.abs(X.t - CUT1), Math.abs(X.t - CUT2)) / 0.14); // corte con fundido rápido a negro
    let fx = out.x, fy = out.y;
    if (X.t < CUT1) {                                           // 1) corre hacia la salida del despacho
      const k = ease(X.t / CUT1);
      out.x = X.from.x; out.y = X.from.y + 150 * k; out.angle = Math.PI / 2;
      fx = out.x; fy = out.y;
    } else if (X.t < CUT2) {                                    // 2) cuarto de servicio: llega a la boca y baja por la escalera
      if (X.stage < 1) { X.stage = 1; out.x = L.service.x; out.y = L.service.y; out.angle = Math.PI; X.rung = -1; this.camera.snap(L.ladder.x, L.ladder.y); } // (los cortes de cámara son secos)
      const u = X.t - CUT1;
      if (u < 0.4) { const k = ease(u / 0.4); out.x = L.service.x + (L.ladder.x - L.service.x) * k; out.y = L.service.y + (L.ladder.y - L.service.y) * k; X.sink = 0; }
      else { out.x = L.ladder.x; out.y = L.ladder.y; X.sink = ease(clamp01((u - 0.4) / 1.0)); const r = Math.floor((u - 0.4) / 0.25); if (r > X.rung && X.sink < 1) { X.rung = r; this.sfx.play('knock', 0.3); } }
      fx = L.ladder.x; fy = L.ladder.y;
    } else if (X.t < END) {                                     // 3) la calle: la tapa cede, asoma y sale
      if (X.stage < 2) {
        X.stage = 2; X.rung = -1; X.lid = this.sewer.covers.find((c) => c.tx === M.tx && c.ty === M.ty) || null;
        if (X.lid) { X.lid.face = 0; X.lid.dir = this.sewer.pickDir(X.lid, this); X.lid.slide = 0; }
        out.x = M.x; out.y = M.y; out.angle = -Math.PI / 2; X.sink = 1; this.camera.snap(M.x, M.y);
        this.sfx.play('manholeScrape', 0.8); this.camera.addShake(4); this.particles.dust(M.x, M.y, 8);
      }
      const u = X.t - CUT2;
      if (X.lid) X.lid.slide = ease(clamp01(u / 0.7));
      if (u < 0.7) { X.sink = 1; }
      else if (u < 1.8) { X.sink = 1 - ease((u - 0.7) / 1.1); const r = Math.floor((u - 0.7) / 0.27); if (r > X.rung && X.sink > 0) { X.rung = r; this.sfx.play('knock', 0.3); } if (u > 1.1 && !X.dust) { X.dust = true; this.particles.dust(M.x, M.y, 8); this.camera.addShake(3); } }
      else { X.sink = 0; const k = ease(clamp01((u - 1.8) / 0.5)); out.x = M.x + (ext.x - M.x) * k; out.y = M.y + (ext.y - M.y) * k; }
      fx = X.sink > 0 ? M.x : out.x; fy = X.sink > 0 ? M.y : out.y;
    }
    this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    this.camera.update(dt, fx, fy);
    if (X.t >= END) {                                           // fin: en su puesto de la calle y empieza el asalto
      out.x = ext.x; out.y = ext.y; out.angle = -Math.PI / 2;
      if (X.lid) X.lid.slide = 1;
      this.finalExit = null;
      this.state = 'playing';
      this.player.cooldown = 0.3;
      this.startFinalPlay(X.role);
    }
  }

  // Dibuja al agente que sale: corriendo, hundiéndose por la escalera o asomando de la alcantarilla (con las manos en el borde).
  drawExit(ctx) {
    const X = this.finalExit;
    if (!X || this.state !== 'exit') return;
    const out = X.out, hole = X.t < 1.0 ? null : X.t < 2.7 ? this.ladderRoom.ladder : this.trap.manhole;
    if (hole && X.sink > 0 && X.sink < 1) this.drawThroughHole(ctx, out, hole, X.sink);
    else if (!hole || X.sink === 0) out.draw(ctx);
  }

  // Un agente que sube (sink 1 → 0) o baja (0 → 1) por una boca: recortado por el borde del hueco, desplazado hacia abajo, algo más pequeño cuanto más hondo y con las manos
  // agarradas al borde mientras asoma.
  drawThroughHole(ctx, agent, hole, sink, fn = null) {
    const s = 0.82 + 0.18 * (1 - sink);
    ctx.save();
    ctx.beginPath(); ctx.rect(hole.x - 120, hole.y - 160, 240, 176); ctx.clip();
    ctx.translate(agent.x, agent.y + sink * 28); ctx.scale(s, s); ctx.translate(-agent.x, -agent.y);
    if (fn) fn(); else agent.draw(ctx);
    ctx.restore();
    if (sink > 0.12 && sink < 0.92) {                           // las manos sobre el borde de la boca
      for (const side of [-1, 1]) {
        const x = hole.x + side * 11, y = hole.y + 8;
        ctx.fillStyle = '#140a24'; pixelRect(ctx, x - 3, y - 2, 4, 3);
        ctx.fillStyle = '#f1b48a'; pixelRect(ctx, x - 2, y - 1, 2, 2);
      }
    }
  }


  updateFinal(dt) {
    const F = this.final;
    this.updateAlly(dt);
    if (F.ambushPending) { F.ambushPending = false; this.startAmbush(); return; } // antes de comprobar si el piso está despejado
    if (F.done) return;
    this.updateCivs(dt);
    if (F.role === 'limpieza') { if (!F.civPending && !F.civRumble && this.enemies.every((e) => !e.alive)) F.done = true; return; }
    // PERÍMETRO: oleadas por la calle; al caer la segunda, el compañero termina la limpieza interior
    const waveAlive = this.enemies.some((e) => e.alive && e.wave === F.wave);
    if (F.stage === 'wait') { F.timer -= dt; if (F.timer <= 0) this.spawnWave(1); }
    else if (F.stage === 'fight' && !waveAlive) {
      if (F.wave < WAVES.length) { F.stage = 'gap'; F.timer = 5; this.supplyDrop(false); this.addFloat(this.player.x, this.player.y - 26, `OLEADA ${F.wave}/${WAVES.length} DERROTADA`, COLORS.player, 1, 1.6); }
      else { F.stage = 'secure'; F.montage = { t: 0 }; this.showCallout('PERÍMETRO ASEGURADO', COLORS.player, 2.6, 'TU COMPAÑERO TERMINA LA LIMPIEZA'); this.sfx.play('unlock'); }
    } else if (F.stage === 'gap') {
      F.timer -= dt;
      if (F.timer <= 0) { if (F.civPending && F.wave === 1) this.spawnCivGroup(); else this.spawnWave(F.wave + 1); } // entre la 1.ª y la 2.ª oleada llegan los civiles (si los hay)
    } else if (F.stage === 'civ') {
      if (!this.enemies.some((e) => e.alive && e.civ)) { F.stage = 'gap'; F.timer = 3.5; this.supplyDrop(false); }
    }
    else if (F.stage === 'secure') {
      F.montage.t -= dt;
      if (F.montage.t <= 0) {
        const left = this.enemies.find((e) => e.alive && !e.wave);
        if (left) { F.montage.t = 0.3; this.killEnemy(left, Math.random() * 6.28, 'bullet'); } else F.done = true;
      }
    }
  }

  // Suministros en la calle junto a quien defiende el perímetro: al empezar un subfusil en la mano y escopeta, pistola, bate y subfusil por el suelo; entre oleadas, más escopeta y subfusil.
  supplyDrop(initial) {
    const pl = this.player;
    if (initial && !pl.weapon) pl.weapon = { type: 'smg', ammo: 30 };
    const types = initial ? ['shotgun', 'smg', 'gun', 'bat'] : ['shotgun', 'smg', 'smg'];
    types.forEach((type, i) => {
      let at = { x: pl.x, y: pl.y };
      for (let k = 0; k < 14; k++) {
        const a = (i / types.length) * TAU + k * 0.6, r = 42 + (k >> 2) * 14, x = pl.x + Math.cos(a) * r, y = pl.y + Math.sin(a) * r;
        if (!isSolidAt(this.map, x, y) && !isSolidAt(this.map, x + 9, y) && !isSolidAt(this.map, x - 9, y) && !isSolidAt(this.map, x, y + 9) && !isSolidAt(this.map, x, y - 9)) { at = { x, y }; break; }
      }
      this.pickups.push(new Pickup(type, at.x, at.y));
      this.particles.neon(at.x, at.y, Math.random() * TAU, 5, 3);
    });
    this.sfx.play('pickup');
    this.addFloat(pl.x, pl.y - 26, '¡SUMINISTROS!', COLORS.enemy, 1, 1.6);
  }

  // --- El final del piso 10 (tanda E): detonación, huida en pareja, beso y salida en moto ------------------------------------------------------------------
  // Con la fase final ganada (`final.done`): en LIMPIEZA el jugador activa el DETONADOR del despacho (mantener PATEAR/INTERACTUAR 1,5 s); en PERÍMETRO lo hace solo el agente
  // interior (IA) a los 3,2 s. Entonces: el edificio estalla (16 explosiones escalonadas, la destrucción crece sobre su huella), el agente interior CORRE hasta la moto mientras el
  // otro le espera, se encuentran (beso con zoom ×2, corazones y el edificio ardiendo detrás, la música se calma), el atardecer tiñe la pantalla y se van juntos en la moto (el
  // otro agente va detrás) por el portón: `FIN`. Solo cinemática: no se puede perder. Mantener ENTER 1,2 s salta a la salida (Espacio no).
  updateEndingTrigger(dt) {
    const F = this.final, T = this.trap;
    if (!F || !F.done || this.ending || this.endingDone) return;
    if (this.updateFarewell(dt)) return; // con aliados vivos, primero la despedida
    if (F.role === 'perimetro') { F.autoT = (F.autoT ?? 3.2) - dt; if (F.autoT <= 0) this.startEnding(); return; }
    const d = T.detonator, p = this.player;
    this.detNear = !!(d && p.alive && Math.hypot(p.x - d.x, p.y - d.y) < 34);
    const held = this.keys.down('kick') || this.keys.down('execute'), tap = this.keys.pressed('kick') || this.keys.pressed('execute');
    if (this.detNear && held) this.detHold += dt;
    else if (this.detNear && tap) this.detHold += 0.45;
    else this.detHold = Math.max(0, this.detHold - dt * 0.8);
    if (this.detHold >= DETONATE_TIME) this.startEnding();
  }

  startEnding() {
    this.allies = [];
    const F = this.final, T = this.trap, inter = F.role === 'limpieza';
    const runner = inter ? this.player : this.partner, waiter = inter ? this.partner : this.player, M = T.meet;
    this.endingDone = true; this.detNear = false; this.detHold = 0;
    this.state = 'ending';
    this.callout = null; this.leaveAsk = 0;
    const path = findPath(this.map, runner.x, runner.y, M.x - 14, M.y) || [{ x: M.x - 14, y: M.y }];
    const times = [];
    for (let i = 0; i < ENDING_BLASTS; i++) times.push(0.9 + i * 0.42 + Math.random() * 0.25);
    const wpath = findPath(this.map, waiter.x, waiter.y, M.x + 14, M.y) || [{ x: M.x + 14, y: M.y }]; // el que espera también sigue una ruta (si el jugador entró al edificio al abrirse la puerta, rodea las paredes)
    this.ending = { t: 0, phase: 'run', runner, waiter, path, wpath, blastT: times, nextBlast: 0, kissT: 0, skipHold: 0, heartT: 0 };
    this.showCallout('¡DETONACIÓN ARMADA!', COLORS.blood, 1.8, 'CORRED HACIA LA MOTO');
    this.sfx.play('lockdown');
    this.sfx.setMusic('action');
    this.camera.addShake(8);
    this.touch.haptic([60, 40, 60]);
  }

  walkPath(a, path, speed, dt) {
    while (path.length && Math.hypot(path[0].x - a.x, path[0].y - a.y) < 8) path.shift();
    if (!path.length) return true;
    const dx = path[0].x - a.x, dy = path[0].y - a.y, d = Math.hypot(dx, dy) || 1;
    moveAndSlide(this.map, a, (dx / d) * speed * dt, (dy / d) * speed * dt);
    a.angle = Math.atan2(dy, dx);
    return false;
  }

  updateEnding(dt, skipKey) {
    const E = this.ending, T = this.trap, M = T.meet, z = this.entry.zone;
    E.t += dt;
    E.skipHold = skipKey ? E.skipHold + dt : 0;
    if (E.skipHold > 1.2) { this.skipEnding(); return; }
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    this.particles.update(dt, this.map, (kind, p) => this.bake(kind, p));
    this.flashT = Math.max(0, this.flashT - dt);
    for (const b of this.blasts) b.t += dt;
    this.blasts = this.blasts.filter((b) => b.t < b.max);
    for (const h of this.hearts) { h.t += dt; h.y -= 22 * dt; }
    this.hearts = this.hearts.filter((h) => h.t < 1.8);
    // Explosiones escalonadas por toda la huella del edificio (las últimas, más grandes)
    while (E.nextBlast < E.blastT.length && E.t >= E.blastT[E.nextBlast]) {
      const size = 0.8 + (E.nextBlast / E.blastT.length) * 0.9;
      // 6 de cada 10 estallan cerca del corredor (para que se vean y se sientan), el resto por toda la huella del edificio
      const bx0 = z.x0 + 40, bx1 = z.x1 - 40, by0 = z.y0 + 40, by1 = this.mainDoor.cy - 24;
      let bx, by;
      if (E.phase === 'run' && Math.random() < 0.6) { bx = clamp(E.runner.x + rand(-130, 130), bx0, bx1); by = clamp(E.runner.y + rand(-120, 30), by0, by1); }
      else { bx = bx0 + Math.random() * (bx1 - bx0); by = by0 + Math.random() * (by1 - by0); }
      this.blast(bx, by, size);
      E.nextBlast++;
    }
    this.destroyed = clamp((E.t - 1.6) / 9, 0, 1); // el edificio se va viniendo abajo
    this.sunset = clamp((E.t - 2.5) / 8, 0, 1);    // y el cielo se tiñe de atardecer
    let fx, fy;
    if (E.phase === 'run') {
      // Salvaguarda: si la carrera se alarga (atascado contra algo, ruta imposible), se coloca a los dos en el punto de encuentro para que la secuencia siga.
      if (E.t > 14 && (E.path.length || E.wpath.length)) { E.path.length = 0; E.wpath.length = 0; E.runner.x = M.x - 14; E.runner.y = M.y; E.waiter.x = M.x + 14; E.waiter.y = M.y; }
      const arrived = this.walkPath(E.runner, E.path, 260, dt);
      if (!E.runner.exec && Math.random() < 0.5) this.particles.dust(E.runner.x, E.runner.y, 1);
      // el otro agente sale a su encuentro hasta el punto de la moto
      const wx = M.x + 14, wy = M.y;
      const wArrived = this.walkPath(E.waiter, E.wpath, 200, dt);
      fx = arrived ? (E.runner.x + E.waiter.x) / 2 : E.runner.x; fy = arrived ? (E.runner.y + E.waiter.y) / 2 : E.runner.y;
      if (arrived && wArrived) { // se encuentran: el beso
        E.phase = 'kiss'; E.kissT = 0;
        E.runner.x = M.x - 12; E.runner.y = M.y; E.waiter.x = M.x + 12; E.waiter.y = M.y;
        E.runner.angle = 0; E.waiter.angle = Math.PI;
        this.camera.mulTarget = 2; // zoom ×2 (múltiplo exacto: el pixel art sigue nítido)
        this.sfx.setMusic('menu');
        this.callout = null;
      }
    } else {
      E.kissT += dt; E.heartT -= dt;
      fx = (E.runner.x + E.waiter.x) / 2; fy = (E.runner.y + E.waiter.y) / 2;
      if (E.heartT <= 0) { E.heartT = 0.32; this.hearts.push({ x: fx + (Math.random() - 0.5) * 20, y: fy - 12, t: 0 }); }
      if (E.kissT >= 3.2) { this.camera.mulTarget = 1; this.beginEndingRide(); return; }
    }
    this.camera.update(dt, fx, fy);
  }

  blast(x, y, size) {
    this.blasts.push({ x, y, t: 0, max: 0.7 + size * 0.5, r: 16 + size * 18 });
    for (let i = 0; i < 10; i++) this.particles.fire(x + rand(-12, 12), y + rand(-12, 12));
    this.particles.sparks(x, y, Math.random() * TAU, 12, 3.14);
    this.particles.dust(x, y, 8);
    this.camera.addShake(5 + size * 5);
    this.playAt('blast', x, y, Math.min(1, 0.5 + size * 0.22)); // (las explosiones se solapan: las pequeñas suenan menos)
    if (size > 1.4 && this.settings.get('strobeEnabled')) this.flashT = 0.08; // el destello respeta la opción de luces estroboscópicas
  }

  skipEnding() {
    const E = this.ending, M = this.trap.meet;
    this.destroyed = 1; this.sunset = 1; this.blasts = []; this.hearts = [];
    E.runner.x = M.x - 12; E.runner.y = M.y; E.waiter.x = M.x + 12; E.waiter.y = M.y;
    this.camera.mulTarget = 1;
    this.beginEndingRide();
  }

  // De la escena del beso a la salida: el agente que controlas conduce y el otro va detrás (rider); mismo recorrido de la fuga normal por el portón.
  beginEndingRide() {
    const E = this.ending;
    this.rider = this.player === E.runner ? E.waiter : E.runner;
    this.rider.rideFrom = { x: this.rider.x, y: this.rider.y };
    this.ending = null;
    this.endingRide = true;
    this.sfx.setMusic('menu');
    this.startLeaving(true);
    this.showCallout('FIN', COLORS.player, 3.2, 'NEON RUSH');
  }

  rideRider(k) {
    const r = this.rider;
    if (!r) return;
    const b = this.bike, a = b.angle || 0, z = b.z || 0;
    const rx = b.x - 18 * Math.cos(a), ry = b.y - 18 * Math.sin(a) - z;
    r.x = lerp(r.rideFrom.x, rx, k); r.y = lerp(r.rideFrom.y, ry, k);
    r.angle = a;
  }

  // Destrucción del edificio (tinte de humo y brasas sobre su huella), bolas de fuego y corazones (en el mundo, tras las paredes).
  drawEnding(ctx) {
    if (!(this.destroyed > 0 || this.blasts.length || this.hearts.length)) return;
    ctx.save();
    if (this.destroyed > 0) {
      const z = this.entry.zone, x0 = z.x0, y0 = z.y0, w = z.x1 - z.x0, h = this.mainDoor.cy + TILE / 2 - z.y0, k = this.destroyed, t = performance.now() / 1000;
      ctx.fillStyle = `rgba(28,10,6,${0.55 * k})`; ctx.fillRect(x0, y0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,90,20,${0.1 * k})`; ctx.fillRect(x0, y0, w, h);
      for (let i = 0; i < 26; i++) { // brasas: posiciones fijas que parpadean
        const hx = Math.sin(i * 91.7) * 0.5 + 0.5, hy = Math.sin(i * 47.3 + 2) * 0.5 + 0.5;
        if (Math.sin(t * (3 + (i % 5)) + i) > 0.1 - k * 0.4) { ctx.fillStyle = i % 3 ? '#ff7a1a' : '#ffd166'; ctx.globalAlpha = 0.35 + 0.4 * k; pixelRect(ctx, x0 + hx * w, y0 + hy * h, 2, 2); }
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.blasts) { // bolas de fuego que se expanden y se apagan
      const k = b.t / b.max, r = (b.r * (0.35 + 0.9 * Math.sqrt(k))) / WORLD_PX;
      ctx.globalAlpha = 0.34 * (1 - k); ctx.fillStyle = '#ff7a1a'; pixelDisc(ctx, b.x, b.y, r, WORLD_PX);
      ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = '#ffd166'; pixelDisc(ctx, b.x, b.y, r * 0.55, WORLD_PX);
      ctx.globalAlpha = 0.5 * (1 - k) * (1 - k); ctx.fillStyle = '#ffffff'; pixelDisc(ctx, b.x, b.y, r * 0.25, WORLD_PX);
    }
    ctx.globalCompositeOperation = 'source-over';
    const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
    for (const h of this.hearts) { // corazones que suben
      ctx.globalAlpha = Math.max(0, 1 - h.t / 1.8);
      HEART.forEach((row, j) => { for (let i = 0; i < 7; i++) if (row[i] === '#') { ctx.fillStyle = j < 2 && i < 3 ? '#ff8ab8' : '#ff2a85'; pixelRect(ctx, h.x + (i - 3) * WORLD_PX, h.y + j * WORLD_PX, 1, 1); } });
    }
    ctx.restore();
  }

  // Atardecer: bandas cálidas sobre toda la pantalla (naranja arriba, magenta abajo) y el destello corto de las explosiones grandes (solo con las luces estroboscópicas activadas).
  drawSunset(ctx, w, h) {
    if (this.sunset > 0) {
      const bands = 8, bh = Math.ceil(h / bands);
      for (let i = 0; i < bands; i++) {
        const f = i / (bands - 1);
        ctx.fillStyle = `rgba(${255},${Math.round(140 - 98 * f)},${Math.round(60 + 73 * f)},${(0.2 - 0.08 * f) * this.sunset})`;
        ctx.fillRect(0, i * bh, w, bh);
      }
    }
    if (this.flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${0.2 * (this.flashT / 0.08)})`; ctx.fillRect(0, 0, w, h); }
    if (this.state === 'exit' && this.finalExit && this.finalExit.t > 0.8) this.drawSkipHint(ctx, w, h - CINE_BAR + 4, this.finalExit); // salida del agente de apoyo
    // Pista para saltar la cinemática (mantener ENTER) con su barra
    const E = this.ending;
    if (E && this.state === 'ending') {
      const txt = this.hint('MANTÉN ENTER: SALTAR', 'ESPERA...'), cx = Math.round(w / 2), y = h - CINE_BAR + 4;
      drawText(ctx, txt, cx, y, { color: '#9d8fb8', align: 'center' });
      if (E.skipHold > 0) { ctx.fillStyle = '#05000f'; ctx.fillRect(cx - 41, y + 10, 82, 4); ctx.fillStyle = COLORS.player; ctx.fillRect(cx - 40, y + 11, Math.round(80 * Math.min(1, E.skipHold / 1.2)), 2); }
    }
  }

  // Aviso junto al detonador (LIMPIEZA): qué mantener y una barra de progreso.
  drawDetonatorHud(ctx, w, h) {
    if (!this.trap || this.state !== 'cleared' || !this.detNear || this.ending) return;
    const d = this.trap.detonator, s = this.camera.worldToScreen(d.x, d.y + 22);
    const msg = this.hint(`MANTÉN ${this.keys.label('kick')} · DETONAR EL EDIFICIO`, 'BOTA (TOCA VARIAS VECES) · DETONAR'), p = this.keepOnScreen(s.x, s.y, measureText(msg), 8);
    drawText(ctx, msg, p.x, p.y, { color: COLORS.blood, align: 'center', shadow: COLORS.background });
    if (this.detHold > 0) { const bw = 40, bx = Math.round(p.x - bw / 2), by = Math.round(p.y + 11); ctx.fillStyle = '#05000f'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5); ctx.fillStyle = COLORS.blood; ctx.fillRect(bx, by, Math.round(bw * Math.min(1, this.detHold / DETONATE_TIME)), 3); }
  }

  // Cinemática de la emboscada (no se puede saltar; dura ~3,7 s y no usa destellos): la cámara va a la trampilla, que tiembla y suelta polvo; se abre de golpe y salen los refuerzos de uno en uno.
  startAmbush() {
    this.hatch.used = true;
    this.callout = null; // el cartel del rol no tapa la trampilla
    this.hatch.state = 'rumble';
    this.state = 'ambush';
    this.ambush = { t: 0, spawned: 0, rumbleAt: 0 };
    this.sfx.play('lockdown');
  }

  updateAmbush(dt) {
    const A = this.ambush, H = this.hatch;
    A.t += dt;
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    this.particles.update(dt, this.map, (kind, p) => this.bake(kind, p)); // el polvo y las chispas siguen moviéndose
    this.camera.update(dt, H.x, H.y);
    if (H.state === 'rumble') {
      if (A.t - A.rumbleAt > 0.18) { A.rumbleAt = A.t; this.camera.addShake(1.5); this.particles.dust(H.x + (Math.random() - 0.5) * 56, H.y + (Math.random() - 0.5) * 56, 1); }
      if (A.t >= 1.4) { // la tapa sale despedida
        H.state = 'open'; H.open = 0;
        this.sfx.play('unlock'); this.sfx.play('crunch');
        this.camera.addShake(11);
        this.particles.dust(H.x, H.y, 16);
        this.particles.sparks(H.x, H.y, -Math.PI / 2, 14, 1.2);
        this.showCallout('¡EMBOSCADA!', COLORS.blood, 2.4, 'REFUERZOS POR LA TRAMPILLA');
      }
    } else H.open = Math.min(1, H.open + dt * 4);
    const next = 1.7 + A.spawned * 0.3;
    if (H.state === 'open' && A.spawned < AMBUSH.length && A.t >= next) this.spawnAmbushEnemy(A.spawned++);
    if (A.spawned >= AMBUSH.length && A.t >= 1.7 + AMBUSH.length * 0.3 + 0.9) { this.ambush = null; this.state = 'playing'; this.captureFinalCheckpoint(); } // nuevo punto de repetición: la pelea empieza aquí
  }

  spawnAmbushEnemy(i, at = null) {      // `at`: reaparición desde el punto de repetición (sin efectos)
    const H = this.hatch, d = AMBUSH[i];
    const a = (i / AMBUSH.length) * TAU + 0.6, x = at ? at.x : H.x + Math.cos(a) * 14, y = at ? at.y : H.y + Math.sin(a) * 14;
    const en = this.makeEnemy({ x, y, patrol: [{ x, y }], weapon: d.weapon || null, kind: d.kind, melee: null });
    en.ambush = true; en.ambushIdx = i;
    this.enemies.push(en);
    this.alertEnemy(en);
    if (!at) { this.particles.dust(x, y, 6); this.playAt('alert', x, y, 1); }
  }

  // La trampilla abierta (sobre el suelo, bajo los personajes): el hueco con una escalera, un resplandor y la tapa levantada de canto.
  drawHatch(ctx) {
    const H = this.hatch;
    if (!H || H.state === 'closed') return;
    const x0 = H.tx * TILE, y0 = H.ty * TILE;
    ctx.save();
    const jit = H.state === 'rumble' ? (Math.floor(performance.now() / 45) % 2 ? 1 : -1) : 0; // temblor antes de abrirse
    if (H.state === 'open') {
      ctx.fillStyle = '#15121f'; pixelRect(ctx, x0 + 2, y0 + 2, 30, 30);
      ctx.fillStyle = '#02020a'; pixelRect(ctx, x0 + 4, y0 + 4, 26, 26);
      ctx.fillStyle = '#0e0e1c'; pixelRect(ctx, x0 + 4, y0 + 4, 26, 3); pixelRect(ctx, x0 + 4, y0 + 4, 3, 26);
      ctx.fillStyle = '#4a4a62'; for (let k = 0; k < 4; k++) pixelRect(ctx, x0 + 12, y0 + 9 + k * 5, 10, 1); // peldaños
      ctx.fillStyle = '#3a3a52'; pixelRect(ctx, x0 + 11, y0 + 8, 1, 17); pixelRect(ctx, x0 + 22, y0 + 8, 1, 17);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#ff7a1a'; pixelRect(ctx, x0 + 4, y0 + 4, 26, 26); // luz de abajo
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const lid = Math.max(2, Math.round(28 * (1 - H.open))); // la tapa gira sobre su bisagra (arriba): se ve cada vez más de canto
      ctx.fillStyle = '#15121f'; pixelRect(ctx, x0 + 2, y0 - lid / 1, 30, lid + 1);
      ctx.fillStyle = '#4e4e68'; pixelRect(ctx, x0 + 3, y0 - lid + 1, 28, lid - 1);
      ctx.fillStyle = '#3a3a52'; pixelRect(ctx, x0 + 5, y0 - lid + 3, 24, Math.max(1, lid - 5));
    } else { // temblor: la placa vibra y se levanta un poco por los bordes
      ctx.fillStyle = '#15121f'; pixelRect(ctx, x0 + jit, y0, 32, 32);
      ctx.fillStyle = '#4e4e68'; pixelRect(ctx, x0 + 1 + jit, y0 + 1, 30, 30);
      ctx.fillStyle = '#02020a'; pixelRect(ctx, x0 + 30, y0 + 4, 2, 26); pixelRect(ctx, x0 + 4, y0 + 30, 26, 2); // rendija oscura
    }
    ctx.restore();
  }

  spawnWave(n) {
    const F = this.final, p = this.player, T = this.trap, used = { w: 0, e: 0 };
    F.wave = n; F.stage = 'fight';
    for (const d of WAVES[n - 1]) {
      const sp = T.spawns[d.side][used[d.side]++ % 6];
      const en = this.makeEnemy({ x: sp.x, y: sp.y, patrol: [{ x: sp.x, y: sp.y }], weapon: d.weapon || null, kind: d.kind, melee: d.melee || null });
      en.wave = n; en.found = true; en.alarmed = true; en.state = 'chase'; en.target = { x: p.x, y: p.y }; en.attackCd = 0.6;
      this.enemies.push(en);
      this.particles.dust(sp.x, sp.y, 6);
    }
    this.showCallout(`OLEADA ${n}/${WAVES.length}`, COLORS.blood, 2.2, '¡REFUERZOS EN LA CALLE!');
    this.playAt('alert', p.x, p.y, 1);
    this.camera.addShake(5);
  }

  // --- Civiles hostiles de la fase final (karma invisible, tanda 2) ------------------------------------------------------------------------------------
  // Si en los pisos anteriores se hizo daño a civiles (`civilianBase`, el karma CONFIRMADO: ver street.js hostileCivCount), en la fase final llegan civiles ANÓNIMOS reclutados por la mafia:
  // cuerpo a cuerpo con armas de la calle, mensajes crueles, mortales (sin forcejeo) y de la misma vida que cualquiera (caen de un golpe). Defenderse no tiene castigo (son enemigos).
  // Determinista (semilla de la partida y el piso): R (punto de repetición de la fase final) repite el mismo reparto. LIMPIEZA: suben uno a uno por la escalera del cuarto de servicio
  // (la misma por la que llegó el compañero) y cruzan el edificio; PERÍMETRO: entran por los dos extremos de la calle entre la 1.ª y la 2.ª oleada.
  makeCivCast() {
    const n = hostileCivCount(this.civilianBase);
    if (!n) return [];
    const rng = seededRandom(hashString(`${this.runId}:civ:${this.levelIndex}`));
    const off = rng() < 0.5 ? 0 : 1;                // los lados se alternan (empezando por uno al azar): nunca todos por el mismo extremo
    return Array.from({ length: n }, (_, i) => ({ weapon: CIV_WEAPONS[Math.floor(rng() * CIV_WEAPONS.length)], side: (i + off) % 2 ? 'w' : 'e' }));
  }

  makeCivEnemy(c, x, y) {
    const p = this.player;
    const en = this.makeEnemy({ x, y, patrol: [{ x, y }], weapon: null, kind: 'civ', melee: c.weapon });
    en.found = true; en.alarmed = true; en.state = 'chase'; en.target = { x: p.x, y: p.y }; en.attackCd = 0.6; en.wave = 'civ';
    en.speedMul = 1 + Math.min(0.15, 0.02 * (this.final ? this.final.civ.length : 0)); // cuanto peor el karma, más rápidos
    this.enemies.push(en);
    return en;
  }

  spawnCivGroup() {                                // PERÍMETRO: por los extremos de la calle
    const F = this.final, T = this.trap, p = this.player, used = { w: 0, e: 0 };
    F.civPending = false; F.stage = 'civ';
    for (const c of F.civ) {
      const sp = T.spawns[c.side][used[c.side]++ % 6];
      this.makeCivEnemy(c, sp.x, sp.y);
      this.particles.dust(sp.x, sp.y, 5);
    }
    this.showCallout('¡VIENE MÁS GENTE!', COLORS.blood, 2.2, 'POR LOS DOS LADOS DE LA CALLE');
    this.playAt('alert', p.x, p.y, 1);
    this.camera.addShake(4);
  }

  // SOLO DESARROLLO (`npm run dev`): salta directo a la fase final del piso 10 con un karma de civiles de prueba, sin jugar la campaña. Uso desde la consola (F12):
  //   game.devFinal('malo', 'limpieza')   ·   game.devFinal('bueno', 'perimetro')   ·   'mixto' = ambos   ·   role: 'limpieza' | 'perimetro'
  // Deja 2 enemigos vivos (como si ya hubieras limpiado casi todo), la trampa resuelta y el rol elegido; la partida es la normal (no se guarda nada si abandonas).
  devFinal(karma = 'malo', role = 'limpieza') {
    if (!import.meta.env.DEV) return;
    const look = (i) => ({ gender: i % 2 ? 'f' : 'm', coat: ['#5a4a38', '#3a4a5a', '#5a3a4a', '#4a5a3a', '#6a5a2a', '#3a3a4a'][i % 6], hair: ['#2a1a0a', '#6a4a1a', '#aaaaaa'][i % 3], skin: '#c9966a', hat: ['none', 'beanie', 'cap', 'hood'][i % 4], item: 'none' });
    const bad = karma === 'malo' || karma === 'mixto', good = karma === 'bueno' || karma === 'mixto';
    const step = (n) => { for (let i = 0; i < n; i++) { Game.prototype.update.call(this, 1 / 60); this.input.endStep(); } };
    this.fade = null; this.startRunAt(9, false); this.fade = null;
    this.maskIndex = 0; this.confirmMask(); if (this.maskPhase === 'support') { this.maskIndex = 1; this.confirmMask(); }
    step(20); if (this.cine) this.cine.t = 999; step(250);
    this.civilianBase = { hurt: bad ? 1 : 0, killed: bad ? 3 : 0, gifts: good ? 4 : 0, helped: good ? [0, 1, 2, 3].map(look) : [] };
    this.civilianRecord = cloneKarma(this.civilianBase);
    const T = this.trap;
    this.inside = true; this.entered = true; this.player.putOnMask(this);
    this.enemies.filter((e) => e.alive).slice(2).forEach((e) => this.killEnemy(e, 0, 'bullet'));
    step(3); this.player.x = T.center.x; this.player.y = T.center.y; step(2);
    for (let i = 0; i < 500 && this.state !== 'playing'; i++) step(1);
    this.trapSolved(); step(2); this.startReunion(); for (let i = 0; i < 200 && this.state !== 'role'; i++) step(1);
    this.chooseRole(role === 'perimetro' ? 1 : 0);
  }

  // --- Aliados civiles (karma invisible, tanda 3) ---------------------------------------------------------------------------------------------------
  // Con buen karma (`civilianBase.helped`: los civiles a los que diste una moneda, con su aspecto; tope 6) vienen a pelear a tu lado en la fase final: en LIMPIEZA suben por la escalera del
  // cuarto de servicio, en PERÍMETRO esperan en la calle junto a la puerta. Misma vida que un personaje (caen de un golpe) y matan a un enemigo de un golpe. Para igualar las armas de
  // la mafia: los enemigos te prefieren a ti (solo se vuelven contra un aliado si te pierden de vista o lo tienen mucho más cerca), apuntan un 30 % más despacio contra ellos, uno de cada
  // tres lleva una tapa de alcantarilla (escudo frontal que aguanta 3 impactos) y la mafia manda 1 mafioso extra por cada 2 aliados. Con karma mixto salen aliados y civiles hostiles.
  spawnAllies(role) {
    this.allies = [];
    const n = friendlyCivCount(this.civilianBase);
    if (!n) return;
    const T = this.trap, rng = seededRandom(hashString(`${this.runId}:ally:${this.levelIndex}`)), L = this.ladderRoom && this.ladderRoom.ladder;
    for (let i = 0; i < n; i++) {
      const weapon = CIV_WEAPONS[Math.floor(rng() * CIV_WEAPONS.length)];
      let x, y;
      if (role === 'limpieza' && L) { x = L.x; y = L.y; }
      else { x = T.ext.x + (i - (n - 1) / 2) * 26; y = T.ext.y + 14 + (i % 2) * 18; if (isSolidAt(this.map, x, y)) { x = T.ext.x; y = T.ext.y; } }
      const a = new CivAlly(x, y, weapon, this.civilianBase.helped[i], i % 2 === 1);
      if (role === 'limpieza' && L) a.rise = { t: -(1 + i * 0.7) };                  // suben uno tras otro por la escalera, tras un instante de golpes
      this.allies.push(a);
    }
    // Mafiosos extra: 1 por cada 2 aliados (en LIMPIEZA salen por la trampilla —o la escalera—, en PERÍMETRO por los extremos de la calle, con la 1.ª oleada).
    const extra = Math.floor(n / 3), kinds = [{ kind: 'grunt', weapon: 'smg' }, { kind: 'grunt', weapon: 'gun' }, { kind: 'runner' }, { kind: 'heavy', weapon: 'shotgun' }], H = this.hatch;
    for (let i = 0; i < extra; i++) {
      const d = kinds[i % kinds.length];
      let x, y;
      if (role === 'limpieza') { const o = H || { x: L.x, y: L.y }; x = o.x + Math.cos(i * 2.1) * 20; y = o.y + Math.sin(i * 2.1) * 20; }
      else { const sp = T.spawns[i % 2 ? 'w' : 'e'][i % 6]; x = sp.x; y = sp.y; }
      const en = this.makeEnemy({ x, y, patrol: [{ x, y }], weapon: d.weapon || null, kind: d.kind });
      this.alertEnemy(en);
      if (role === 'perimetro') en.wave = 1;
      this.enemies.push(en);
    }
    if (extra) this.addFloat(this.player.x, this.player.y - 30, '¡LA MAFIA REFUERZA!', COLORS.blood, 1, 1.8);
    if (this.final) this.final.allyScene = true; // escena de su llegada (ver civScene)
  }

  // Lo que dice cada agente (personalidad): JACK sereno y agradecido, VEX seca y con ironía. `key` = ally | hostile | thanks | leaveIn | leaveOut.
  agentSays(key) {
    const vex = (this.player.gender === 'female');
    const T = {
      ally: [ '¡Ustedes! No tenían por qué venir... Gracias.', 'Vaya, vaya. No pedí refuerzos... pero los acepto.' ],
      hostile: [ 'No quería esto... pero no pienso morir aquí.', 'Qué pena. Yo tampoco quería esto. Vengan, entonces.' ],
      thanks: [ 'Sin ustedes no lo habría logrado. Gracias, de verdad.', 'No suelo dar las gracias... pero lo hicieron bien. Gracias.' ],
      leaveIn: [ 'Salgan de aquí, amigos. Todo esto va a volar.', 'Fuera de aquí, ya. Esto va a volar por los aires.' ],
      leaveOut: [ 'Aléjense del edificio, amigos. Va a estallar.', 'Lejos del edificio, ¡ya! Va a estallar.' ],
    };
    return T[key][vex ? 1 : 0];
  }

  // Retrato de un civil para las cajas de diálogo (ayudado: su aspecto; hostil: los colores de su variante).
  civPortrait(kind, who) {
    if (kind === 'ally') {
      const l = who.look, hat = l.hat === 'beanie' ? '#6a2a2a' : l.hat === 'cap' ? '#2a3a5a' : l.hat === 'hood' ? '#2a2a3a' : null;
      return { civ: { coat: l.coat, hair: l.hair, skin: l.skin, hat, visor: l.hat === 'cap' }, hostile: false };
    }
    const c = civHostileColors(who.civVariant || 0);
    return { civ: { coat: c.coat, hair: '#2a1a0a', skin: '#c9966a', hat: c.hat, visor: false }, hostile: true };
  }

  // ESCENAS DE LLEGADA (karma invisible): al aparecer los civiles se congela el mundo y hablan con la caja de texto junto a su cara (la cámara va a quien habla), para que se sepa
  // a quién se tiene delante: los AMIGOS (cian: te devuelven la moneda) o los HOSTILES (rojo: la mafia los recluta). Con karma mixto salen las dos, una tras otra (primero los amigos, que
  // llegan al empezar; los hostiles más tarde). Una sola vez por partida (R no las repite).
  civScene(kind, first) {
    const p = this.player, ag = AGENTS[p.gender] || AGENTS.male, F = this.final;
    const me = { name: ag.name, color: ag.color, tag: 'AGENTE', portrait: { mask: this.mask, gender: p.gender, level: this.goreOn ? p.bloodLevel : 0, bits: this.maskBits || [] } };
    const at = (o) => ({ x: o.x, y: o.y });
    let lines, onEnd;
    if (kind === 'ally') {
      const al = this.allies.filter((a) => a.alive), a1 = al[0], a2 = al[1] || al[0];
      const sp = (a) => ({ name: 'AMIGO', color: COLORS.player, tag: 'DE LA CALLE', portrait: this.civPortrait('ally', a) });
      lines = [
        { speaker: sp(a1), text: '¡Eh, tú! ¿Te acuerdas de la moneda? Hoy te devolvemos el favor.', focus: at(a1) },
        { speaker: me, text: this.agentSays('ally'), focus: at(p) },
        { speaker: sp(a2), text: F && F.civ.length ? 'Ojo: la mafia ha reclutado a otros como nosotros. ¡Pero aquí estamos!' : 'Nadie nos había tratado así. ¡Vamos con ustedes!', focus: at(a2) },
      ];
      onEnd = () => this.showCallout('¡TE AYUDAN!', COLORS.player, 2.4, 'LOS CIVILES A LOS QUE AYUDASTE');
    } else {
      const hs = this.enemies.filter((e) => e.alive && e.civ), h1 = first || hs[0], h2 = hs[hs.length - 1] || h1;
      const sp = (h) => ({ name: 'CIVIL', color: '#ff2a4a', tag: 'DE LA MAFIA', portrait: this.civPortrait('hostile', h) });
      const killed = this.civilianBase && this.civilianBase.killed > 0, al = this.allies.find((a) => a.alive);
      lines = [
        { speaker: sp(h1), text: p.gender === 'female' ? (killed ? '¡Es ella! ¡La que mató a los nuestros!' : '¡Ahí está! ¡La que nos hizo daño en la calle!') : (killed ? '¡Es él! ¡El que mató a los nuestros!' : '¡Ahí está! ¡El que nos hizo daño en la calle!'), focus: at(h1) },
        { speaker: sp(h2), text: 'La mafia nos da de comer. Hoy cobramos tu deuda.', focus: at(h2) },
        { speaker: me, text: this.agentSays('hostile'), focus: at(p) },
      ];
      if (al) lines.push({ speaker: { name: 'AMIGO', color: COLORS.player, tag: 'DE LA CALLE', portrait: this.civPortrait('ally', al) }, text: '¡Tranquilo! ¡Nosotros te cubrimos!', focus: at(al) });
      onEnd = () => this.showCallout('¡TE ATACAN!', '#ff2a4a', 2.4, 'CIVILES AL SERVICIO DE LA MAFIA');
    }
    if (this.comms.say(`civscene:${kind}`, lines, { urgent: true, onEnd })) this.comms.begin(this.comms.queue.shift());
  }

  // DESPEDIDA (final del piso 10): con la fase final ganada y aliados civiles vivos, antes de la detonación se dan las gracias (ellos a ti y tú a ellos) y se van: por la escalera
  // del cuarto de servicio en LIMPIEZA, por la calle en PERÍMETRO. La detonación no empieza hasta que se han ido (o a los 16 s).
  updateFarewell(dt) {
    const F = this.final;
    if (F.farewell === 'done') return false;
    const al = this.allies.filter((a) => a.alive && !a.gone);
    if (!F.farewell) {
      if (!al.length) { F.farewell = 'done'; return false; }
      if (this.state !== 'cleared' || !this.comms.idle()) return true;
      F.farewell = 'talk'; F.farewellT = 0;
      this.farewellScene(al);
      return true;
    }
    if (F.farewell === 'leave') {
      F.farewellT += dt;
      if (!al.length || F.farewellT > 16) { F.farewell = 'done'; this.allies = []; return false; }
    }
    return true;
  }

  farewellScene(al) {
    const p = this.player, ag = AGENTS[p.gender] || AGENTS.male, T = this.trap, a1 = al[0], a2 = al[1] || al[0];
    const me = { name: ag.name, color: ag.color, tag: 'AGENTE', portrait: { mask: this.mask, gender: p.gender, level: this.goreOn ? p.bloodLevel : 0, bits: this.maskBits || [] } };
    const sp = (a) => ({ name: 'AMIGO', color: COLORS.player, tag: 'DE LA CALLE', portrait: this.civPortrait('ally', a) });
    const at = (o) => ({ x: o.x, y: o.y });
    const lines = [
      { speaker: sp(a1), text: '¡Se acabó! Bien hecho, amigo.', focus: at(a1) },
      { speaker: me, text: this.agentSays('thanks'), focus: at(p) },
      { speaker: sp(a2), text: p.gender === 'female' ? 'Tú nos miraste a los ojos cuando nadie lo hacía. Gracias, jefa.' : 'Tú nos diste una moneda y un poco de respeto. Gracias a ti.', focus: at(a2) },
      { speaker: me, text: this.agentSays(al.some((q) => this.inBuilding(q)) ? 'leaveIn' : 'leaveOut'), focus: at(p) },
      { speaker: sp(a1), text: p.gender === 'female' ? '¡Cuídate, jefa! ¡Nos vemos en la calle!' : '¡Cuídate, amigo! ¡Nos vemos en la calle!', focus: at(a1) },
    ];
    const L = this.ladderRoom && this.ladderRoom.ladder;
    const onEnd = () => {
      this.final.farewell = 'leave'; this.final.farewellT = 0;
      for (const a of this.allies) {
        if (!a.alive) continue;
        if (this.final.role === 'limpieza' && L) a.leave = { x: L.x, y: L.y, hole: true, t: 0 };
        else { const sp2 = T.spawns[a.x < T.center.x ? 'w' : 'e'][0]; a.leave = { x: sp2.x, y: sp2.y, hole: false, t: 0 }; }
      }
      this.showCallout('¡GRACIAS!', COLORS.player, 2, 'SE VAN ANTES DE LA EXPLOSIÓN');
    };
    if (!this.comms.say('civscene:farewell', lines, { urgent: true, onEnd })) { this.final.farewell = 'done'; return; }
    this.comms.begin(this.comms.queue.shift());
  }

  // Marca de quién es quién: un halo y un marcador sobre la cabeza, rojo para los civiles hostiles y cian para los aliados.
  drawCivMark(ctx, e, color) {
    const k = 0.5 + 0.5 * Math.sin(this.time * 6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14 + 0.12 * k; pixelDisc(ctx, e.x, e.y, 14 + Math.round(k * 2), WORLD_PX);
    ctx.globalAlpha = 0.3; pixelDisc(ctx, e.x, e.y, 9, WORLD_PX);
    ctx.restore();
    const y = e.y - e.r - 14 + Math.round(Math.sin(this.time * 5)) * 2;
    ctx.fillStyle = '#140a24'; pixelRect(ctx, e.x - 4, y - 1, 9, 1); pixelRect(ctx, e.x - 3, y, 7, 1); pixelRect(ctx, e.x - 2, y + 1, 5, 1); pixelRect(ctx, e.x - 1, y + 2, 3, 1); pixelRect(ctx, e.x, y + 3, 1, 1);
    ctx.fillStyle = color; pixelRect(ctx, e.x - 3, y, 7, 1); pixelRect(ctx, e.x - 2, y + 1, 5, 1); pixelRect(ctx, e.x - 1, y + 2, 3, 1); pixelRect(ctx, e.x, y + 2, 1, 1);
  }

  // El aliado más cercano (en pie, a la vista y a ≤ 260 u) hacia el que un enemigo puede volverse en vez de ir a por ti.
  allyFor(e) {
    let best = null, bd = 260;
    for (const a of this.allies) {
      if (!a.alive || a.rise) continue;
      const d = Math.hypot(a.x - e.x, a.y - e.y);
      if (d < bd && lineOfSight(this.map, e.x, e.y, a.x, a.y)) { bd = d; best = a; }
    }
    return best;
  }

  // Un enemigo golpea (cuerpo a cuerpo o bala) a un aliado: la tapa aguanta los impactos de frente; si no, cae de un golpe.
  allyHit(a, angle) {
    if (!a.alive) return;
    if (a.shield > 0 && Math.abs(angleDiff(angle + Math.PI, a.angle)) < 1.1) {
      a.shield--;
      this.particles.sparks(a.x + Math.cos(a.angle) * 12, a.y + Math.sin(a.angle) * 12, a.angle, 8, 1);
      this.playAt('ricochet', a.x, a.y, 0.8);
      if (!a.shield) this.addFloat(a.x, a.y - 22, '¡LA TAPA CEDIÓ!', COLORS.enemy, 1, 1.2);
      return;
    }
    a.alive = false;
    a.corpse = { x: a.x, y: a.y };
    this.bleed(a.x, a.y, angle, 1, 0.7);
    this.drawCorpse(a.x, a.y, angle, 'civCorpse');
    this.camera.addShake(5);
    this.playAt('hit', a.x, a.y, 0.8);
  }

  // Un aliado golpea a un enemigo: lo mata de un golpe (sin puntos ni sangre en ti); los acorazados (escudo, jefe) solo se derriban.
  allyStrike(a, e) {
    const ang = Math.atan2(e.y - a.y, e.x - a.x);
    this.playAt('hit', e.x, e.y, 0.7);
    if (e.guardKill) { this.knockDown(e, ang, 'melee'); return; }
    if (!e.alive) return;
    e.alive = false;
    this.dropWeapon(e);
    if (e.hasKey) this.dropKey(e);
    e.corpse = { x: e.x + Math.cos(ang) * 8, y: e.y + Math.sin(ang) * 8 };
    this.bleed(e.x, e.y, ang, 1.35, 0.9);
    this.drawCorpse(e.x, e.y, ang, e.corpseSprite || (e.armed ? 'armedCorpse' : 'enemyCorpse'), e.corpseScale || 1);
    this.camera.addShake(6);
  }

  // LIMPIEZA: cuenta atrás (solo en juego, así no corre durante la cinemática de la trampilla), ruidos en la alcantarilla y los civiles suben de uno en uno.
  updateCivs(dt) {
    const F = this.final;
    if (F.allyScene && this.comms.idle()) {          // llegada de los aliados: escena con diálogo (los que suben por la escalera, cuando ya asoman)
      const a = this.allies.find((q) => q.alive && (!q.rise || q.rise.t > 0.55));
      if (a) { F.allyScene = false; this.civScene('ally', a); return; }
    }
    if (F.civScene && !F.allyScene && this.comms.idle()) { // llegada de los hostiles (tras la de los aliados si los hay: con karma mixto salen dos escenas seguidas, una buena y otra mala)
      const c = this.enemies.find((q) => q.alive && q.civ && (!q.rise || q.rise.t > 0.55));
      if (c) { F.civScene = false; this.civScene('hostile', c); return; }
    }
    if (F.role === 'limpieza' && F.civPending && !F.ambushPending) {
      F.civT -= dt;
      if (F.civT <= 0 && this.ladderRoom) {
        F.civPending = false;
        F.civRumble = { t: 0, spawned: 0 };
        this.showCallout('RUIDOS EN LA ALCANTARILLA', COLORS.blood, 2.4, 'ALGUIEN SUBE');
        const L = this.ladderRoom.ladder; this.playAt('manholeScrape', L.x, L.y, 1);
      }
    }
    const K = F.civRumble;
    if (K) {                                       // 1,5 s de golpes en la escalera y después, uno cada 0,7 s
      K.t += dt;
      const L = this.ladderRoom.ladder;
      if (K.t < 1.5) { if (Math.floor(K.t / 0.3) !== Math.floor((K.t - dt) / 0.3)) { this.playAt('knock', L.x, L.y, 1); this.camera.addShake(0.8); } }
      else if (K.spawned < F.civ.length && K.t >= 1.5 + K.spawned * 0.7) {
        const en = this.makeCivEnemy(F.civ[K.spawned++], L.x, L.y);
        en.rise = { t: 0 }; en.state = 'chase';
        this.particles.dust(L.x, L.y, 6); this.playAt('knock', L.x, L.y, 1);
      }
      if (K.spawned >= F.civ.length) F.civRumble = null;
    }
    F.allyShout = (F.allyShout ?? 4) - dt;
    if (F.allyShout <= 0) {
      F.allyShout = 5 + Math.random() * 3;
      const al = this.allies.filter((a) => a.alive && !a.rise);
      if (al.length) { const a = al[Math.floor(Math.random() * al.length)]; this.addFloat(a.x, a.y - 24, allyLine(this.lastBark), COLORS.player, 1, 1.5); }
    }
    F.civShout -= dt;                               // de vez en cuando, uno de los que ya vienen a por ti grita algo cruel
    if (F.civShout <= 0) {
      F.civShout = 2.4 + Math.random() * 1.6;
      const alive = this.enemies.filter((e) => e.alive && e.civ && !e.rise);
      if (alive.length) this.bark(alive[Math.floor(Math.random() * alive.length)], civLine(this.civilianBase ? this.civilianBase.killed : 0, this.lastBark));
    }
  }

  // Un civil hostil subiendo por la escalera (se hunde y asoma como los agentes: ver drawThroughHole).
  drawRising(ctx, e) {
    const hole = this.ladderRoom ? this.ladderRoom.ladder : { x: e.x, y: e.y };
    this.drawThroughHole(ctx, e, hole, Math.min(1, Math.max(0, 1 - e.rise.t / 0.9)), () => e.draw(ctx, this.time, this));
  }

  // IA del aliado (el agente que no controlas): dispara a todo enemigo con visión a ≤ 300 u; en PERÍMETRO avanza por el edificio hacia el enemigo interior más cercano
  // (BFS cada 0,7 s); en LIMPIEZA se queda en su puesto de la calle. Inmortal.
  updateAlly(dt) {
    const F = this.final, a = this.partner, map = this.map;
    if (!a || !a.alive) return;
    a.fireCd = Math.max(0, (a.fireCd || 0) - dt);
    let tgt = null, bd = 300;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'down') continue;
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d < bd && lineOfSight(map, a.x, a.y, e.x, e.y)) { bd = d; tgt = e; }
    }
    if (tgt) {
      a.angle = Math.atan2(tgt.y - a.y, tgt.x - a.x);
      if (a.fireCd <= 0) { this.allyShoot(a); a.fireCd = 0.26; }
    }
    if (!F || F.role !== 'perimetro' || F.done || (tgt && bd < 150)) return; // sin fase final (liberado, antes del reencuentro): se queda en su sitio
    let goal = null, gd = Infinity;
    for (const e of this.enemies) if (e.alive && !e.wave) { const d = Math.hypot(e.x - a.x, e.y - a.y); if (d < gd) { gd = d; goal = e; } }
    if (!goal) return;
    a.pathT = (a.pathT || 0) - dt;
    if (!a.path || a.pathT <= 0) { a.path = findPath(map, a.x, a.y, goal.x, goal.y); a.pathT = 0.7; }
    const path = a.path;
    if (!path) return;
    while (path.length && Math.hypot(path[0].x - a.x, path[0].y - a.y) < 8) path.shift();
    if (!path.length) return;
    const dx = path[0].x - a.x, dy = path[0].y - a.y, d = Math.hypot(dx, dy) || 1;
    moveAndSlide(map, a, (dx / d) * 130 * dt, (dy / d) * 130 * dt);
    if (!tgt) a.angle = Math.atan2(dy, dx);
  }

  allyShoot(a) {
    const def = WEAPON_DEFS.smg, cos = Math.cos(a.angle), sin = Math.sin(a.angle);
    let bx = a.x + cos * 14, by = a.y + sin * 14;
    if (isSolidAt(this.map, bx, by)) { bx = a.x; by = a.y; }
    const bl = new Bullet(bx, by, a.angle + (Math.random() - 0.5) * def.spread * 2, def.bulletSpeed, 'player', def.range);
    bl.src = 'smg'; bl.ally = true; // (las balas del aliado no manchan tu arma)
    this.bullets.push(bl);
    this.particles.sparks(a.x + cos * 22, a.y + sin * 22, a.angle, 5, 0.45);
    this.playAt(def.sound, a.x, a.y, 0.7);
    a.muzzle = 0.05;
  }

  drawFinalHud(ctx, w, h) {
    const F = this.final;
    if (!F || this.state !== 'playing') return;
    const cx = Math.round(w / 2), y = 38 + this.safe.t;
    let txt;
    if (F.role === 'limpieza') return; // (el jugador ya sabe que eligió LIMPIEZA: sin texto)
    else if (F.stage === 'wait') txt = `PERÍMETRO · OLEADA 1 EN ${Math.ceil(F.timer)}`;
    else if (F.stage === 'gap') txt = `OLEADA ${F.wave + 1} EN ${Math.ceil(F.timer)}`;
    else if (F.stage === 'secure') txt = 'PERÍMETRO ASEGURADO';
    else txt = `PERÍMETRO · OLEADA ${F.wave}/${WAVES.length}`;
    drawText(ctx, txt, cx, y, { color: COLORS.player, align: 'center', shadow: COLORS.background });
  }

  // Pantalla de ELIGE TU ROL FINAL: dos tarjetas con el agente y su máscara, el rol y lo que hace el otro.
  drawRoleSelect(ctx, w, h) {
    ctx.fillStyle = 'rgba(13, 2, 33, 0.88)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2), title = 'ELIGE TU ROL FINAL';
    drawText(ctx, title, cx, 5, { color: COLORS.wall, scale: this.fitScale(title, w - 12, 2), align: 'center' });
    drawText(ctx, 'EL OTRO AGENTE LO LLEVA LA IA (INMORTAL)', cx, 24, { color: '#9d8fb8', align: 'center' });
    const A = this.agentMasks(), cards = this.roleLayout(), now = performance.now();
    const name = (p) => (AGENTS[p.gender] || AGENTS.male).name;
    const info = [
      { role: 'LIMPIEZA', agent: A.mainP, mask: A.main, lines: ['ENTRAS A LIMPIAR EL EDIFICIO', `${name(A.supportP)} CUBRE DESDE LA CALLE`, 'GANAS AL CAER TODOS'] },
      { role: 'PERÍMETRO', agent: A.supportP, mask: A.support, lines: ['TE QUEDAS FUERA: 2 OLEADAS', `${name(A.mainP)} LIMPIA DENTRO`, 'GANAS AL SOBREVIVIR'] },
    ];
    cards.forEach((c, i) => {
      const sel = this.roleIndex === i, ag = AGENTS[info[i].agent.gender] || AGENTS.male;
      ctx.fillStyle = sel ? ag.tint : '#140a24'; ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = sel ? ag.color : '#3a2a5a';
      ctx.fillRect(c.x, c.y, c.w, 1); ctx.fillRect(c.x, c.y + c.h - 1, c.w, 1); ctx.fillRect(c.x, c.y, 1, c.h); ctx.fillRect(c.x + c.w - 1, c.y, 1, c.h);
      if (sel) { ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, 1); }
      const pv = { x: c.x + Math.round((c.w - 64) / 2), y: c.y + 6, w: 64, h: 64 };
      drawAgentPreview(ctx, pv, info[i].mask.id, info[i].agent.gender, now);
      const ty = pv.y + pv.h + 5;
      drawText(ctx, `${ag.name} · ${info[i].mask.name}`, c.x + c.w / 2, ty, { color: sel ? ag.color : '#7d6f98', align: 'center' });
      drawText(ctx, info[i].role, c.x + c.w / 2, ty + 11, { color: sel ? COLORS.text : '#7d6f98', scale: this.fitScale(info[i].role, c.w - 8, 2), align: 'center' });
      info[i].lines.forEach((l, k) => drawText(ctx, l, c.x + c.w / 2, ty + 29 + k * 9, { color: sel ? '#c9bfe0' : '#5b4f78', scale: 1, align: 'center' }));
    });
    drawText(ctx, this.hint('FLECHAS: ELEGIR · ESPACIO / ENTER: CONFIRMAR', 'TOCA UNA TARJETA · TÓCALA DE NUEVO PARA CONFIRMAR'), cx, h - 12 - this.safe.b, { color: '#9d8fb8', align: 'center' });
  }

  civiliansHelp() { return civiliansHelp(this.civilianRecord); }

  // --- Trampa de gas del piso 10 (tanda B: docs/prompt-nivel-10-climax.md) -----------------------------------------------------------------------
  // idle → (el primer agente pisa el centro del despacho) → gas → (el compañero rompe la ventilación) → done | (tiempo 0) → failed (asfixia).
  ventNear() {
    const T = this.trap, p = this.player;
    if (!T || T.state !== 'gas' || !p.alive) return false;
    const r = T.room, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    return Math.hypot(p.x - T.vent.sx, p.y - T.vent.sy) < 30 && !(tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1); // fuera del despacho
  }

  beginTrap(retry = false) {
    const T = this.trap, a = this.player, b = this.partner;
    if (!T || T.state !== 'idle' || !b) return;
    T.victim = a; T.hold = 0; T.cough = 1.2; T.fade = 1; T.t = GAS_TIME;
    this.trapRetry = true;
    // PUNTO DE REPETICIÓN: al empezar la trampa (fase 2) se guarda cómo está el piso. R vuelve aquí (no al principio del piso): los enemigos ya abatidos siguen abatidos y los puntos
    // son los de ese momento. Se conserva hasta elegir el rol final (`beginFinal`, que lo actualiza); ni resolver la trampa lo borra.
    if (!retry) this.trapCheckpoint = { dead: this.enemies.map((e, i) => (e.alive ? -1 : i)).filter((i) => i >= 0), total: this.score.total, levelScore: this.score.levelScore };
    else if (this.trapCheckpoint) this.applyCheckpoint();
    for (const d of T.doors) {
      const door = this.doors.find((x) => x.tx === d.tx && x.ty === d.ty);
      if (!door) continue;
      if (retry) { door.locked = true; door.closing = false; door.offset = 0; door.angVel = 0; } else door.lock(); // reintento: ya selladas
    }
    const arrive = this.ladderRoom ? this.ladderRoom.service : this.entry; // sin escalera, por la entrada del edificio
    b.x = arrive.x; b.y = arrive.y; b.angle = -Math.PI / 2;
    if (this.ladderRoom && !retry) { b.x = this.ladderRoom.ladder.x; b.y = this.ladderRoom.ladder.y; b.angle = 0; } // primera vez: espera bajo la boca de la escalera (se ve al cortar la cámara)
    if (retry) { // fase 2 directa (R): sin cinemática, el gas ya corre
      a.x = T.center.x; a.y = T.center.y;
      b.away = false;
      T.state = 'gas';
      this.swapControl(true);
      this.sfx.play('lockdown');
      this.showTrapInstruction();
      return;
    }
    // Primera vez: mini cinemática por WALKIE-TALKIE (el reloj aún no corre): el atrapado avisa a su compañero por su nombre y este responde; luego el control pasa a él.
    T.state = 'radio';
    b.away = !!this.ladderRoom; // con escalera: no se ve hasta que sale de ella (updateRadio); sin ella, ya está en la entrada
    a.cancelExecution();
    const nameA = (AGENTS[a.gender] || AGENTS.male).name, nameB = (AGENTS[b.gender] || AGENTS.male).name;
    this.state = 'radio';
    const legs = !!(this.ladderRoom && T.manhole);   // la llegada del compañero se ve desde FUERA: corre por la calle, fuerza la tapa de la alcantarilla y baja; corte: sube por la escalera del cuarto de servicio
    this.radioCine = {
      t: 0, end: legs ? 8.0 : 5.0, split: 2.9, split2: legs ? 5.7 : 2.9, legs, cut: false, inside: false, sinkViz: null,
      lines: [
        { who: a, mask: this.mask, level: a.bloodLevel, bits: [...this.maskBits], lines: [`¡${nameB}, ME HAN ENCERRADO,`, 'HAY GAS!'], from: 0.35 },   // el retrato lleva la sangre (roja / verde) que el agente tiene encima
        { who: b, mask: this.partnerMask, level: b.bloodLevel, bits: [...this.partnerBlood.maskBits], lines: [`¡AGUANTA, ${nameA}!`, '¡VOY PARA ALLÁ!'], from: legs ? 3.0 : 3.1 },
      ],
    };
    this.showCallout('¡TRAMPA!', COLORS.blood, 2.2, 'GAS TÓXICO · SALA SELLADA');
    this.camera.addShake(10);
    this.fx.kick(0.8);
    this.sfx.play('lockdown');
    this.touch.haptic([60, 40, 60]);
  }

  // SALTO DELIBERADO de una cinemática (radio de la trampa y salida del rol): hay que MANTENER Espacio / Enter (en táctil, mantener el dedo) 1,2 s, y solo cuenta si se empieza a apretar
  // DESPUÉS de que arrancó (el clic o el toque con el que venías peleando, o un dedo que ya estaba en los joysticks, no la salta por accidente). `C.skipHold` alimenta la barra.
  holdSkip(C, dt) {
    const inp = this.input, held = inp.down('Space') || inp.down('Enter') || inp.down('NumpadEnter') || (inp.touchMode && inp.touches && inp.touches.size > 0);
    if (!held) { C.skipArm = true; C.skipHold = 0; return false; }
    if (!C.skipArm) return false;                      // sigue apretando lo que ya apretaba al empezar
    C.skipHold = (C.skipHold || 0) + dt;
    return C.skipHold >= 1.2;
  }

  // Pista y barra de «mantén para saltar» (abajo, sobre la barra de cine).
  drawSkipHint(ctx, w, y, C) {
    const txt = this.hint('MANTÉN ESPACIO: SALTAR', 'MANTÉN EL DEDO: SALTAR'), cx = Math.round(w / 2);
    drawText(ctx, txt, cx, y, { color: '#9d8fb8', align: 'center' });
    if (C.skipHold > 0) { ctx.fillStyle = '#05000f'; ctx.fillRect(cx - 41, y + 10, 82, 4); ctx.fillStyle = COLORS.player; ctx.fillRect(cx - 40, y + 11, Math.round(80 * Math.min(1, C.skipHold / 1.2)), 2); }
  }

  // Cinemática de radio: el mundo congelado (salvo las puertas, que acaban de sellarse), cámara en el atrapado y luego en el compañero; Espacio/Enter/clic la salta.
  updateRadio(dt, skip) {
    const R = this.radioCine, a = this.trap.victim, b = this.partner;
    const before = R.t;
    R.t += dt;
    const talk = [...R.lines].reverse().find((L) => R.t >= L.from);   // la línea que se está tecleando: un chirrido retro por letra (voz según su máscara)
    if (talk) {
      const txt = talk.lines.join(' '), n = (t) => Math.max(0, Math.min(txt.length, Math.floor((t - talk.from) * 30)));
      talkBlips(this, voiceFor(talk.mask, talk.who.gender), txt, n(before), n(R.t));
    }
    this.updateDoors(dt); // los portazos terminan de cerrarse
    if (this.callout && (this.callout.t -= dt) <= 0) this.callout = null;
    for (const f of this.floatingTexts) f.t -= dt;
    this.floatingTexts = this.floatingTexts.filter((f) => f.t > 0);
    for (const L of R.lines) if (before < L.from && R.t >= L.from) { this.sfx.play('empty'); this.sfx.play('pickup', 0.6); } // chasquido de radio al empezar cada línea
    const toLadder = () => {                                                         // corte a la escalera del cuarto de servicio: sube y asoma (misma animación que el piso 3)
      const L = this.ladderRoom;
      R.inside = true; R.sinkViz = null;
      this.camera.setBounds(this.map.pixelW, this.map.pixelH);
      b.away = false; b.x = L.ladder.x; b.y = L.ladder.y;
      R.emerge = { t: 0, sink: 1, dust: false, rung: -1 };
      this.sfx.play('manholeScrape', 0.5);
      this.camera.snap(b.x, b.y);
    };
    if (!R.cut && R.t >= R.split) {                                                  // corte al compañero
      R.cut = true;
      if (R.legs) {                                                                  // 1) en la CALLE: llega corriendo a la boca de alcantarilla (misma tapa por la que saldrá un agente al elegir el rol)
        const M = this.trap.manhole, lid = this.sewer.covers.find((c) => c.tx === M.tx && c.ty === M.ty) || null, ext = this.trap.ext;
        if (lid) { lid.face = 0; lid.dir = this.sewer.pickDir(lid, this); lid.slide = 0; }
        const d = lid ? lid.dir : 1, stand = { x: M.x - d * 26, y: M.y + 2 };
        R.st = { t: 0, lid, d, M, stand, from: { x: M.x - 280, y: ext.y }, corner: { x: stand.x, y: ext.y }, heaves: -1 };
        b.away = false; b.x = R.st.from.x; b.y = R.st.from.y; b.angle = 0;
        this.showCallout(`${(AGENTS[b.gender] || AGENTS.male).name} LLEGA POR LA CALLE`, COLORS.player, 2.6, 'PUERTA CERRADA · ENTRA POR LA ALCANTARILLA');
        this.camera.setBounds(this.map.pixelW, this.map.pixelH + 170);   // la calle está pegada al borde sur: se amplía el límite para poder subir el encuadre sobre la caja de radio
        this.camera.snap(b.x, b.y + 110);
      } else if (this.ladderRoom) toLadder();
      else this.camera.snap(b.x, b.y);
    }
    if (R.st && !R.inside) {                                                         // tramo de calle: corre · fuerza la tapa (3 tirones) · pisa el hueco · baja
      const S = R.st, u = (S.t += dt), k = (v) => v * v * (3 - 2 * v), c01 = (v) => Math.max(0, Math.min(1, v)), M = S.M;
      if (u < 0.9) {                                                                 // corre por la acera hacia la boca
        const q = k(u / 0.9);
        if (q < 0.8) { const w = q / 0.8; b.x = S.from.x + (S.corner.x - S.from.x) * w; b.y = S.from.y; b.angle = 0; }
        else { const w = (q - 0.8) / 0.2; b.x = S.corner.x; b.y = S.from.y + (S.stand.y - S.from.y) * w; b.angle = Math.PI / 2; }
        if (Math.random() < 0.5) this.particles.dust(b.x - 8, b.y + 6, 1);
      } else if (u < 1.9) {                                                          // tres tirones: la tapa cede a golpes
        const t2 = (u - 0.9) / 1.0, h = Math.min(2, Math.floor(t2 * 3)), f = t2 * 3 - h;
        b.x = S.stand.x - S.d * 4 * Math.sin(Math.min(1, f * 1.4) * Math.PI); b.y = S.stand.y; b.angle = S.d > 0 ? 0 : Math.PI;
        if (h > S.heaves) {
          S.heaves = h; this.sfx.play(h === 2 ? 'manholeScrape' : 'knock', 0.9); this.camera.addShake(3 + h * 2);
          this.particles.dust(M.x - S.d * 14, M.y, 6); this.particles.sparks(M.x - S.d * 20, M.y, S.d > 0 ? Math.PI : 0, 6, 0.5);
        }
        if (S.lid) S.lid.slide = (h + k(Math.min(1, f * 1.6))) / 3;
      } else if (u < 2.2) {                                                          // paso sobre el hueco
        if (S.lid) S.lid.slide = 1;
        const q = k((u - 1.9) / 0.3); b.x = S.stand.x + (M.x - S.stand.x) * q; b.y = S.stand.y + (M.y - 6 - S.stand.y) * q;
      } else {                                                                       // baja: se hunde en la abertura
        b.x = M.x; b.y = M.y - 6;
        const sk = k(c01((u - 2.2) / 0.55)); R.sinkViz = { hole: M, sink: sk };
        if (sk > 0.5 && !S.splash) { S.splash = true; this.sfx.play('crocDown', 0.5); this.particles.dust(M.x, M.y, 8); }
      }
    }
    if (R.legs && !R.inside && R.t >= R.split2) toLadder();                         // 2) corte: dentro, sube por la escalera
    if (R.emerge) {                                                                  // 0-0,7 s asoma · 0,7-1,1 s sale y se pone de pie en el cuarto
      const E = R.emerge, L = this.ladderRoom, k = (v) => v * v * (3 - 2 * v);
      E.t += dt;                                                                 // 0-0,35 s se oye subir (peldaños) · 0,35-1,45 s asoma con las manos en el borde · 1,45-1,95 s sale y se pone en pie
      if (E.t < 0.35) E.sink = 1;
      else if (E.t < 1.45) E.sink = 1 - k((E.t - 0.35) / 1.1);
      else { E.sink = 0; const q = k(Math.min(1, (E.t - 1.45) / 0.5)); b.x = L.ladder.x + (L.service.x - L.ladder.x) * q; b.y = L.ladder.y + (L.service.y - L.ladder.y) * q; b.angle = -Math.PI / 2 * q; }
      const r = Math.floor(E.t / 0.27);
      if (r > E.rung && E.t < 1.45) { E.rung = r; this.sfx.play('knock', 0.3); this.camera.addShake(1.2); }    // un golpe seco por peldaño
      if (E.t > 0.8 && !E.dust) { E.dust = true; this.particles.dust(L.ladder.x, L.ladder.y, 8); this.camera.addShake(3); }
      this.particles.update(dt, this.map, (kind, pt) => this.bake(kind, pt));
    }
    const f = R.cut ? b : a;
    this.camera.update(dt, f.x, f.y + (R.st && !R.inside ? 110 : 0)); // en la calle, el encuadre queda por encima de la caja de radio
    if (this.holdSkip(R, dt)) R.t = R.end;
    if (R.t >= R.end) this.endRadio();
  }

  endRadio() {
    const T = this.trap;
    this.camera.setBounds(this.map.pixelW, this.map.pixelH);
    if (this.ladderRoom) { const b = this.partner, L = this.ladderRoom; b.away = false; b.x = L.service.x; b.y = L.service.y; b.angle = -Math.PI / 2; } // (si se saltó la cinemática, ya está en el cuarto)
    this.radioCine = null;
    T.state = 'gas'; T.t = GAS_TIME; T.hold = 0; T.cough = 1.2; T.fade = 1;
    this.state = 'playing';
    this.swapControl(true);
    this.showTrapInstruction();
  }

  // Instrucción táctica para quien pasa a controlar al compañero: cartel destacado + marcador en el mapa (ver drawObjectiveMarker) + guía permanente bajo el temporizador.
  showTrapInstruction() {
    const T = this.trap, name = (AGENTS[(T.victim || this.partner).gender] || AGENTS.male).name;
    this.showCallout(`¡SALVA A ${name}!`, COLORS.blood, 3.6, `ROMPE LA VENTILACIÓN · ${T.vent.face === 'e' ? 'PARED ESTE DEL DESPACHO' : 'PARED SUR DEL DESPACHO'}`);
  }

  // Rumbo y distancia hasta la ventilación desde el jugador (para la guía en pantalla).
  ventGuide() {
    const T = this.trap, p = this.player, dx = T.vent.sx - p.x, dy = T.vent.sy - p.y;
    const dirs = ['ESTE', 'SURESTE', 'SUR', 'SUROESTE', 'OESTE', 'NOROESTE', 'NORTE', 'NORESTE'];
    const dir = dirs[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    return `${dir} · ${Math.round(Math.hypot(dx, dy) / TILE)} CASILLAS`;
  }

  // Caja de diálogo del walkie-talkie (abajo, sobre las barras de cine): retrato y nombre del que habla, texto que se teclea y un walkie con la antena parpadeando.
  drawRadioBox(ctx, w, h) {
    const R = this.radioCine;
    if (!R || this.state !== 'radio') return;
    const cur = [...R.lines].reverse().find((L) => R.t >= L.from);
    if (!cur) return;
    const ag = AGENTS[cur.who.gender] || AGENTS.male;
    const bh = 46, bw = Math.min(w - 20, 330), bx = Math.round((w - bw) / 2), by = h - CINE_BAR - bh - 6 - this.safe.b;
    ctx.fillStyle = 'rgba(5, 0, 15, 0.92)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ag.color;
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    // El retrato mueve la boca al hablar igual que en los diálogos del prólogo (con la sangre roja / verde del agente): ver drawTalkingMask.
    const full = cur.lines.join(' '), typedN = Math.min(full.length, Math.max(0, Math.floor((R.t - cur.from) * 30)));
    cur.text = full;
    cur.portrait = { mask: cur.mask, gender: cur.who.gender, level: this.goreOn ? cur.level || 0 : 0, bits: cur.bits || [] };
    drawTalkingMask(ctx, cur, bx + 5, by + 6, typedN, typedN < full.length);
    ctx.fillStyle = ag.color; ctx.fillRect(bx + 4, by + 5, 34, 1); ctx.fillRect(bx + 4, by + 38, 34, 1); ctx.fillRect(bx + 4, by + 5, 1, 34); ctx.fillRect(bx + 37, by + 5, 1, 34);
    drawText(ctx, `${ag.name} · RADIO`, bx + 44, by + 5, { color: ag.color });
    // texto tecleado (30 caracteres por segundo)
    let left = Math.floor((R.t - cur.from) * 30);
    cur.lines.forEach((ln, i) => {
      const part = ln.slice(0, Math.max(0, left));
      left -= ln.length;
      if (part) drawText(ctx, part, bx + 44, by + 17 + i * 10, { color: COLORS.text, shadow: null });
    });
    // walkie: cuerpo, antena y piloto que parpadea
    const wx = bx + bw - 14, wy = by + 6;
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx, wy + 5, 8, 14);
    ctx.fillStyle = '#6b6b85'; ctx.fillRect(wx + 1, wy + 6, 6, 12);
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx + 5, wy, 1, 6);
    ctx.fillStyle = Math.floor(R.t * 6) % 2 ? '#ff2a4a' : '#7d3a4a'; ctx.fillRect(wx + 4, wy - 1, 3, 2);
    if (R.t > 0.8) { drawText(ctx, this.hint('MANTÉN ESPACIO: SALTAR', 'MANTÉN EL DEDO: SALTAR'), bx + bw - 6, by + bh - 20, { color: '#7d6f98', align: 'right' }); if (R.skipHold > 0) { ctx.fillStyle = '#05000f'; ctx.fillRect(bx + bw - 86, by + bh - 9, 80, 3); ctx.fillStyle = COLORS.player; ctx.fillRect(bx + bw - 86, by + bh - 9, Math.round(80 * Math.min(1, R.skipHold / 1.2)), 3); } }
  }

  updateTrap(dt) {
    const T = this.trap, p = this.player;
    if (T.state === 'idle') {
      const q = T.trigger, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (this.state === 'playing' && this.inside && p.alive && p.agentId === 'main' && tx >= q.x0 && tx <= q.x1 && ty >= q.y0 && ty <= q.y1) this.beginTrap(false);
      return;
    }
    if (T.state === 'done') {
      T.fade = Math.max(0, T.fade - dt * 0.4); // el gas se disipa despacio
      const pt = this.partner;
      if (!this.final && !this.reunion && this.state === 'playing' && p.alive && pt && pt.alive && Math.hypot(p.x - pt.x, p.y - pt.y) < 46) this.startReunion(); // reencuentro
      return;
    }
    if (T.state !== 'gas' || this.state !== 'playing') return; // el reloj corre solo jugando (se congela en forcejeos, menús y pausa: update no llega aquí)
    const victim = T.victim;
    if (!p.exec) T.t -= dt; // y se congela en las ejecuciones
    // Ventilación: mantener PATEAR/INTERACTUAR junto a la pared (en táctil, 3-4 toques).
    const near = this.ventNear();
    const tap = this.keys.pressed('kick') || this.keys.pressed('execute');
    const held = this.keys.down('kick') || this.keys.down('execute');
    if (near && held) T.hold += dt;
    else if (near && tap) T.hold += 0.4;
    else T.hold = Math.max(0, T.hold - dt * 0.6);
    if (near && T.hold > 0 && Math.random() < 0.5) this.particles.sparks(T.vent.sx, T.vent.sy - 14, -Math.PI / 2, 2, 0.7);
    if (T.hold >= VENT_TIME) { this.trapSolved(); return; }
    // Gas en el despacho y tos del agente atrapado
    T.cough -= dt;
    if (victim && victim.alive && T.cough <= 0) {
      T.cough = 1.6 + Math.random() * 1.4;
      const sc = this.camera.worldToScreen(victim.x, victim.y);
      if (sc.x > 0 && sc.x < this.scene.width && sc.y > 0 && sc.y < this.scene.height) { // la tos solo se ve si el agente está en pantalla (si no, el texto se clavaría en el borde)
        this.addFloat(victim.x, victim.y - 26, ['¡COF!', '¡COF, COF!', '¡AGH!'][Math.floor(Math.random() * 3)], '#9be32a', 1, 1.1);
        this.camera.addShake(2);
      }
    }
    if (Math.random() < 0.5) { const r = T.room; this.particles.gas((r.x0 + Math.random() * (r.x1 - r.x0 + 1)) * TILE, (r.y0 + Math.random() * (r.y1 - r.y0 + 1)) * TILE); }
    if (T.t <= 0) this.trapFail();
  }

  // Restaura el punto de repetición de la trampa: los abatidos siguen abatidos (mismo orden de `enemies`: el piso se recarga con la misma semilla) y los puntos son los guardados.
  applyCheckpoint() {
    const cp = this.trapCheckpoint;
    for (const i of cp.dead) if (this.enemies[i]) this.enemies[i].alive = false;
    this.score.total = cp.total; this.score.levelScore = cp.levelScore;
  }

  trapSolved() {
    const T = this.trap, left = Math.max(0, Math.round(T.t));
    T.state = 'done'; T.fade = 1; T.hold = 0; // (trapRetry se mantiene: si te matan antes de elegir el rol final, R vuelve a la fase 2, que es el punto de repetición)
    for (const d of T.doors) { const door = this.doors.find((x) => x.tx === d.tx && x.ty === d.ty); if (door) door.unlock(); }
    this.particles.sparks(T.vent.sx, T.vent.sy - 14, -Math.PI / 2, 24, 1.4);
    this.particles.dust(T.vent.sx, T.vent.sy - 10, 14);
    this.camera.addShake(14);
    this.fx.kick(0.8);
    this.sfx.play('unlock');
    this.sfx.play('crunch');
    const bonus = 1000 + left * 20;
    this.score.addBonus(bonus);
    this.showCallout('VENTILACIÓN ROTA', COLORS.player, 2.6, `EL GAS SE DISIPA · +${bonus}`);
    const v = T.victim;
    if (v && v.alive) {
      // El agente liberado se defiende solo hasta el reencuentro: pasa a ser el aliado de IA (inmortal, subfusil sin límite, dispara a todo enemigo con visión).
      v.immortal = true; v.weapon = { type: 'smg', ammo: 9999 }; v.fireCd = 0.4;
      this.addFloat(v.x, v.y - 26, '¡ESTOY BIEN! ¡TE CUBRO!', COLORS.player, 1, 1.8);
    }
  }

  // Tiempo agotado: el agente atrapado se asfixia (la cámara viaja hasta él, cae, la pantalla se apaga en verde) y sale la pantalla de muerte.
  trapFail() {
    const T = this.trap;
    T.state = 'failed';
    this.state = 'dead';
    this.deathMsg = 'SE QUEDÓ SIN AIRE';
    this.asphyx = { t: 0, fell: false };
    this.camera.addShake(4);
  }

  stepAsphyx(dt) {
    const A = this.asphyx, v = this.trap && this.trap.victim;
    A.t += dt;
    if (v && !A.fell && A.t >= 1.3) {
      A.fell = true;
      v.alive = false;
      this.drawCorpse(v.x, v.y, 0.6, 'playerCorpse');
      this.camera.addShake(8);
      this.sfx.play('death');
    }
  }

  // Gas en pantalla: tinte verde y viñeta que se cierran con el tiempo (no estorban al que controlas: el gas está en el despacho), y la cinemática de asfixia.
  drawGas(ctx, w, h) {
    const T = this.trap, A = this.asphyx;
    if (!T || (T.state !== 'gas' && T.state !== 'done' && T.state !== 'failed')) return;
    const k = T.state === 'done' ? T.fade * (1 - T.t / GAS_TIME) : T.state === 'failed' ? 1 : 1 - T.t / GAS_TIME;
    if (k <= 0.005) return;
    ctx.save();
    ctx.fillStyle = `rgba(70,200,60,${0.03 + 0.14 * k})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { // viñeta escalonada (más ancha cuanto más gas)
      const inset = i * 3, a = (0.07 + 0.1 * k) * (1 - i / 6) * (0.5 + k);
      ctx.fillStyle = `rgba(8,40,10,${a})`;
      ctx.fillRect(inset, inset, w - 2 * inset, 3); ctx.fillRect(inset, h - 3 - inset, w - 2 * inset, 3);
      ctx.fillRect(inset, inset, 3, h - 2 * inset); ctx.fillRect(w - 3 - inset, inset, 3, h - 2 * inset);
    }
    if (A) { ctx.fillStyle = `rgba(10,50,10,${Math.min(0.88, A.t / 2.2 * 0.88)})`; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }

  // Temporizador del gas (arriba al centro): cifra grande y barra; rojo y parpadeante bajo 10 s.
  drawTrapHud(ctx, w, h) {
    const T = this.trap;
    if (!T || T.state !== 'gas' || this.state !== 'playing') return;
    const cx = Math.round(w / 2), t = Math.max(0, T.t), low = t < 10, y = 38 + this.safe.t;
    const col = low ? (Math.floor(performance.now() / 180) % 2 ? COLORS.blood : '#ffffff') : '#9be32a';
    const txt = `GAS ${Math.ceil(t)}`;
    drawText(ctx, txt, cx, y, { color: col, scale: 2, align: 'center', shadow: COLORS.background });
    const bw = 90, bx = cx - bw / 2, by = y + 17;
    ctx.fillStyle = '#05000f'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
    ctx.fillStyle = col; ctx.fillRect(bx, by, Math.round(bw * (t / GAS_TIME)), 4);
    // Guía: qué hacer y hacia dónde (hasta que se llega a la ventilación)
    if (!this.ventNear() && this.player.agentId === 'support') {
      const nm = (AGENTS[(T.victim || this.partner).gender] || AGENTS.male).name;
      drawText(ctx, `SALVA A ${nm}: ROMPE LA VENTILACIÓN`, cx, by + 8, { color: COLORS.enemy, align: 'center', shadow: COLORS.background });
      drawText(ctx, `VENTILACIÓN: ${this.ventGuide()}`, cx, by + 18, { color: '#9be32a', align: 'center', shadow: COLORS.background });
    }
    // Aviso junto a la ventilación
    if (this.ventNear()) {
      const s = this.camera.worldToScreen(T.vent.sx, T.vent.sy + 20), msg = this.hint(`MANTÉN ${this.keys.label('kick')} · ROMPER VENTILACIÓN`, 'BOTA (TOCA VARIAS VECES) · ROMPER');
      const p = this.keepOnScreen(s.x, s.y, measureText(msg), 8);
      drawText(ctx, msg, p.x, p.y, { color: '#9be32a', align: 'center', shadow: COLORS.background });
      if (T.hold > 0) { const bw2 = 40, bx2 = Math.round(p.x - bw2 / 2), by2 = Math.round(p.y + 11); ctx.fillStyle = '#05000f'; ctx.fillRect(bx2 - 1, by2 - 1, bw2 + 2, 5); ctx.fillStyle = '#9be32a'; ctx.fillRect(bx2, by2, Math.round(bw2 * Math.min(1, T.hold / VENT_TIME)), 3); }
    }
  }

  // Rejilla de ventilación en la cara sur de la pared del despacho (sobre las paredes): chapa con ranuras; al romperse queda un hueco oscuro que expulsa humo.
  drawVent(ctx) {
    const T = this.trap;
    if (!T) return;
    const v = T.vent, east = v.face === 'e', broken = T.state === 'done';
    const x = east ? v.x + TILE / 2 - 3 : v.x, y = east ? v.y : v.y + TILE / 2 - 10;
    ctx.save();
    if (east) { ctx.translate(x, y); ctx.rotate(-Math.PI / 2); ctx.translate(-x, -y); } // la rejilla se dibuja de lado en la cara este (mismo dibujo girado)
    ctx.fillStyle = '#0a0a14'; pixelRect(ctx, x - 12, y - 2, 12, 6);
    if (broken) {
      ctx.fillStyle = '#02020a'; pixelRect(ctx, x - 10, y - 1, 10, 5);
      ctx.fillStyle = '#3a3a52'; pixelRect(ctx, x - 12, y + 4, 3, 1); pixelRect(ctx, x + 6, y + 2, 4, 1);
      if (Math.random() < 0.08) this.particles.smoke(east ? v.sx : x + (Math.random() - 0.5) * 12, east ? v.sy : y);
    } else {
      ctx.fillStyle = '#6b6b85'; pixelRect(ctx, x - 11, y - 1, 11, 5);
      ctx.fillStyle = '#14141e'; for (let i = 0; i < 4; i++) pixelRect(ctx, x - 10, y + i, 9, 1);
      const on = T.state === 'gas' && Math.floor(performance.now() / 300) % 2;
      ctx.fillStyle = on ? '#7ddc3a' : '#3a3a52'; pixelRect(ctx, x + 1, y - 2, 2, 2); // piloto: parpadea mientras hay gas
    }
    ctx.restore();
  }

  // El compañero inactivo cae de un golpe (bala o cuerpo a cuerpo): Game Over con su propio mensaje.
  killPartner(angle, killer = null) {
    const t = this.partner;
    if (!t || !t.alive || t.immortal || this.state !== 'playing') return; // (en la fase final el aliado es inmortal: la IA no puede pagar su torpeza)
    t.alive = false;
    this.state = 'dead';
    this.deathMsg = 'TU COMPAÑERO HA CAÍDO';
    const kd = killer && killer.meleeWeapon && WEAPON_DEFS[killer.meleeWeapon];
    this.bleed(t.x, t.y, angle, 1.3, 0.7, !!(kd && kd.poison)); // arma oxidada: sangre verde
    this.drawCorpse(t.x, t.y, angle, 'playerCorpse');
    this.camera.addShake(10);
    this.fx.kick(1);
    this.hitstop = HITSTOP.playerDeath;
    this.sfx.play('death');
  }

  partnerStrike(e) {
    const t = this.partner;
    if (t) this.killPartner(Math.atan2(t.y - e.y, t.x - e.x), e);
  }

  // `killer`: el enemigo que lo mata (si lo hay). Con un ARMA OXIDADA en la mano (`poison`: tubo o cuchillo oxidados) la muerte sangra VERDE tóxica; con cualquier otra, roja como siempre.
  killPlayer(angle, killer = null) {
    if ((this.state !== 'playing' && this.state !== 'sewer') || !this.player.alive || this.player.doorAnim) return; // (el agente es intocable mientras cierra / abre la puerta: ~0,8 s sin control; ver Player.startDoorAnim)
    const p = this.player;
    p.alive = false;
    p.cancelExecution(); // si lo matan a mitad de un remate, el derribado no se queda congelado
    p.vomit = null;
    this.state = 'dead';
    const kd = killer && killer.meleeWeapon && WEAPON_DEFS[killer.meleeWeapon];
    this.bleed(p.x, p.y, angle, 1.3, 0.7, !!(kd && kd.poison));
    this.drawCorpse(p.x, p.y, angle, 'playerCorpse');
    if (p.weapon) { const pk = new Pickup(p.weapon.type, p.x, p.y, p.weapon.ammo); pk.blood = p.weapon.blood || null; this.pickups.push(pk); }
    this.camera.addShake(10);
    this.fx.kick(1);
    this.hitstop = HITSTOP.playerDeath;
    this.sfx.play('death');
    this.sfx.play('grunt', 0.9);
  }

  // Atropello exagerado por el auto de extracción: el jugador sale despedido hacia la cámara, se estampa contra la «pantalla» (mancha de sangre y de
  // máscara en el cristal, que gotea) y la pantalla de muerte lo celebra con una burla en vez de HAS MUERTO. Solo es visual y de mensaje: R reintenta como siempre.
  runOver(car) {
    const p = this.player;
    p.alive = false;
    p.cancelExecution();
    p.vomit = null;
    this.state = 'dead';
    this.callout = null; // el cartel PISO COMPLETADO no tapa la burla
    this.bleed(p.x, p.y, 0, 1.4, 1);
    if (p.weapon) this.pickups.push(new Pickup(p.weapon.type, p.x, p.y, p.weapon.ammo));
    const blobs = [];
    for (let i = 0; i < 52; i++) {
      const a = Math.random() * TAU, rr = Math.pow(Math.random(), 0.7);
      blobs.push({ a, rr, s: 2 + Math.floor(Math.random() * 6), drip: Math.random() < 0.3 ? 8 + Math.random() * 26 : 0, tox: false });
    }
    const MSGS = ['ATROPELLADO POR TUS ALIADOS', 'EL RESCATE SALIÓ BIEN. PARA ELLOS', 'GRACIAS POR SALVARNOS. ¡CRUNCH!', 'TAXI... Y AL PARABRISAS', 'LOS REHENES VIVEN. TÚ NO'];
    this.runover = { t: 0, x: p.x, y: p.y, a0: p.angle, spin: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 4), blobs, hit: false, msg: MSGS[Math.floor(Math.random() * MSGS.length)] };
    this.camera.addShake(12);
    this.fx.kick(1);
    this.sfx.play('death');
    this.sfx.play('hit');
    this.touch.haptic([40, 30, 90]);
  }

  // Avanza el vuelo (0,7 s hacia la cámara); al estamparse: sacudida, destello y crujido.
  stepRunover(dt) {
    const ro = this.runover;
    ro.t += dt;
    if (!ro.hit && ro.t >= RUNOVER_FLIGHT) {
      ro.hit = true;
      this.camera.addShake(22);
      this.fx.kick(1);
      this.sfx.play('crunch');
      this.sfx.play('hit');
    }
  }

  // Pantalla: el jugador (con su máscara y su ropa) crece y gira hacia la cámara; al impactar queda una mancha en el cristal con grietas, restos de
  // máscara y regueros que resbalan despacio. Va bajo la franja de la pantalla de muerte.
  drawRunover(ctx, w, h) {
    const ro = this.runover;
    if (!ro) return;
    const s0 = this.camera.worldToScreen(ro.x, ro.y), cx = w / 2, cy = h * 0.42;
    const k = Math.min(1, ro.t / RUNOVER_FLIGHT), e = k * k;
    if (!ro.hit) {
      const px = Math.round(s0.x + (cx - s0.x) * e), py = Math.round(s0.y + (cy - s0.y) * e - Math.sin(k * Math.PI) * 18);
      const sc = 1 + e * (Math.max(w, h) / 22);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ro.a0 + ro.spin * ro.t);
      ctx.scale(sc / WORLD_PX, sc / WORLD_PX);
      drawSprite(ctx, playerBody(this.mask.id, this.goreOn ? this.player.bloodLevel : 0, this.player.gender), 0, 0);
      drawMaskHead(ctx, this.mask.id, this.goreOn ? this.player.bloodLevel : 0);
      ctx.restore();
      return;
    }
    // Impacto: destello que se apaga y la mancha en el cristal.
    const age = ro.t - RUNOVER_FLIGHT, R = Math.min(w, h) * 0.34;
    if (age < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - age / 0.12)})`; ctx.fillRect(0, 0, w, h); }
    // restos de la máscara (la cabeza grande aplastada contra el cristal, desvaneciéndose despacio) y de la cazadora
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, 0.85 - age * 0.12);
    ctx.translate(Math.round(cx), Math.round(cy + Math.min(age * 6, 14)));
    ctx.rotate(ro.a0 + ro.spin * RUNOVER_FLIGHT);
    const sc = 1 + (Math.max(w, h) / 22);
    ctx.scale(sc / WORLD_PX, sc / WORLD_PX);
    drawSprite(ctx, playerBody(this.mask.id, 0, this.player.gender), 0, 0);
    drawMaskHead(ctx, this.mask.id, 0);
    ctx.restore();
    // sangre: salpicadura radial + regueros
    for (const b of ro.blobs) {
      const x = Math.round(cx + Math.cos(b.a) * b.rr * R), y = Math.round(cy + Math.sin(b.a) * b.rr * R);
      ctx.fillStyle = b.rr > 0.75 ? COLORS.bloodMid : b.s > 4 ? COLORS.blood : COLORS.bloodDark;
      ctx.fillRect(x, y, b.s, b.s);
      if (b.drip) { const len = Math.min(b.drip, age * 5 + 2); ctx.fillStyle = COLORS.bloodDark; ctx.fillRect(x + (b.s >> 1), y + b.s, 1 + (b.s > 4 ? 1 : 0), Math.round(len)); }
    }
    // grietas del cristal (rayos de píxeles desde el punto de impacto)
    ctx.fillStyle = 'rgba(220,240,255,0.55)';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.4, len = R * (0.7 + ((i * 37) % 10) / 14);
      for (let d = 4; d < len; d += 3) ctx.fillRect(Math.round(cx + Math.cos(a) * d + Math.sin(d * 0.9) * 1.2), Math.round(cy + Math.sin(a) * d), 1, 1);
    }
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
      if (best.main) this.doorShut(best);
      this.camera.addShake(1.5);
      this.particles.dust(best.cx, best.cy, 4);
      this.sfx.play('doorThud');
      return true;
    }
    best.kick(player.x, player.y);
    this.particles.dust(best.cx, best.cy, 8);
    this.camera.addShake(3);
    this.sfx.play('doorKick');   // golpe seco, grave y fuerte (mucho más que abrir caminando)
    return true;
  }

  enemyShoot(e) {
    const cos = Math.cos(e.angle), sin = Math.sin(e.angle);
    let bx = e.x + cos * 14, by = e.y + sin * 14;
    if (isSolidAt(this.map, bx, by)) { bx = e.x; by = e.y; }
    const def = e.gunDef;
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const sp = def.spread * AI.spread; // puntería según el nivel de IA enemiga (TONTOS dispersan más, GENIOS menos)
      const angle = e.angle + (pellets > 1 ? rand(-def.fan, def.fan) : rand(-sp, sp));
      const speed = def.bulletSpeed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      this.bullets.push(new Bullet(bx, by, angle, speed, 'enemy', def.bulletRange || Infinity));
    }
    this.particles.sparks(e.x + cos * 20, e.y + sin * 20, e.angle, def.burst > 1 ? 4 : 6, 0.45);
    this.particles.shell(e.x + cos * 6, e.y + sin * 6, e.angle + Math.PI / 2);
    this.playAt(def.sound, e.x, e.y);
    this.camera.addShake(def.burst > 1 ? 1 : pellets > 1 ? 5 : 2);
  }

  makeNoise(x, y, radius) {
    // Un ruido hecho por el jugador (disparo, golpe, patada) delata su posición 0,8 s aunque esté en la sombra (ver Enemy.canSee).
    if (this.map.dark && Math.hypot(x - this.player.x, y - this.player.y) < 6) this.map.reveal = 0.8;
    if (this.sewer) this.sewer.heard(x, y, radius);
    if (this.sewerRun) this.sewerRun.croc.hear(x, y, radius); // el cocodrilo del túnel oye los ruidos
    if (this.street) this.street.noise(x, y, radius); // los civiles de la calle oyen lo que pasa dentro (alerta indirecta)
    // Los enemigos investigan el origen del ruido; tras una pared o una puerta cerrada se oye más apagado (radio ×0,6).
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= radius) continue;
      if (d > radius * 0.6 && !lineOfSight(this.map, x, y, e.x, e.y)) continue;
      e.hear(x, y);
    }
  }

  // Alerta general (operador de cámaras): todos los enemigos vivos que no estén ya en combate, derribados o en pánico corren hacia (x, y), desfasados hasta 0,8 s
  // para repartir las rutas (el presupuesto de BFS por fotograma hace el resto). El jefe no responde.
  generalAlarm(x, y) {
    for (const e of this.enemies) {
      if (!e.alive || e.kind === 'boss') continue;
      e.answerAlarm(x, y, Math.random() * 0.8);
    }
  }

  // Un enemigo da la voz (te ha visto o ha encontrado un cadáver): los de las salas contiguas (hasta ALARM_REACH casillas de recorrido, atravesando
  // puertas) se ponen en estado de combate y corren a la zona, los más lejanos un poco después. Una pasada de BFS por alarma (con enfriamiento de 5 s
  // por enemigo), nada por fotograma.
  raiseAlarm(src, x, y) {
    if (src.shoutCd > 0) return;
    if (src.kind === 'operator') { src.shoutCd = 5; this.generalAlarm(x, y); return; } // el operador que te ve da la alerta a TODO el edificio
    src.shoutCd = 5;
    const m = this.map, W = m.w;
    if (!this._alarmDist || this._alarmDist.length !== W * m.h) this._alarmDist = new Int16Array(W * m.h);
    const dist = this._alarmDist;
    dist.fill(-1);
    const s = Math.floor(src.y / TILE) * W + Math.floor(src.x / TILE);
    const q = [s];
    dist[s] = 0;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], dc = dist[c];
      if (dc >= ALARM_REACH) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (isWallTile(m, nx, ny)) continue;
        const ni = ny * W + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dc + 1;
        q.push(ni);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive || e === src || e.kind === 'boss') continue;
      const d = dist[Math.floor(e.y / TILE) * W + Math.floor(e.x / TILE)];
      if (d >= 0) e.answerAlarm(x, y, d * 0.03);
    }
  }

  // --- Capa de sangre (media resolución: 1 píxel = 2 unidades del mundo) ---------------

  // Algo llega al suelo y se queda para siempre: una gota (con su estela corta en la dirección en
  // la que viajaba, así el salpicado tiene dirección), un resto que se para (con su mancha) o
  // una gota del rastro que va dejando un resto en vuelo.
  bake(kind, p) {
    this.bpal = p.tox ? palOf(p.tox) : RED;
    this.bakeDrop(kind, p);
    this.bpal = RED;
  }

  bakeDrop(kind, p) {
    if (!this.goreOn) return; // gotas que ya iban en el aire al apagar la sangre
    const ctx = this.bloodCtx;
    const x = Math.round(p.x / WORLD_PX), y = Math.round(p.y / WORLD_PX);
    if (kind === 'trail') {
      ctx.fillStyle = Math.random() < 0.5 ? this.bpal.dark : this.bpal.blood;
      ctx.fillRect(x, y, 1, 1);
      return;
    }
    if (kind === 'gib') {
      ctx.fillStyle = this.bpal.dark;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = (p.tox ? TOXIC_GIBS : GIB_COLORS)[p.kind];
      ctx.fillRect(x, y, 2, 2);
      return;
    }
    const heavy = p.size > 2.2;
    ctx.fillStyle = heavy ? this.bpal.blood : this.bpal.mid;
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
  // `track` = el charco mancha las suelas (huellas); el vómito no.
  splatBlood(x, y, angle, power = 1, wide = 0.55, track = true) {
    const ctx = this.bloodCtx;
    const px = x / WORLD_PX, py = y / WORLD_PX;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.stains++;
    ctx.save();
    ctx.fillStyle = this.bpal.dark;
    const poolR = rand(5, 7) * power;
    pixelDisc(ctx, px + cos * 3, py + sin * 3, poolR);
    if (track) {
      this.pools.push({ x: x + cos * 6, y: y + sin * 6, r: poolR * WORLD_PX * 0.9, tox: this.bpal === TOXIC });
      if (this.pools.length > MAX_POOLS) this.pools.shift();
    }
    ctx.fillStyle = this.bpal.blood;
    pixelDisc(ctx, px + cos * 3 - 1, py + sin * 3 - 1, rand(3.5, 5) * power);
    // Charcos satélite: salpicaduras gordas que han caído más lejos.
    for (let i = 0, n = 2 + Math.floor(power * 2); i < n; i++) {
      const a = angle + rand(-wide, wide), d = rand(8, 20) * power;
      ctx.fillStyle = Math.random() < 0.5 ? this.bpal.dark : this.bpal.blood;
      pixelDisc(ctx, px + Math.cos(a) * d, py + Math.sin(a) * d, rand(1, 2.2));
    }
    for (let i = 0; i < 34 * power; i++) {
      const d = rand(3, 30) * power;
      const a = angle + rand(-wide, wide);
      ctx.fillStyle = Math.random() < 0.3 ? this.bpal.dark : this.bpal.blood;
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
      ctx.fillStyle = this.bpal.blood;
      for (let d = 0; d < len; d++) {
        const thick = d < len * 0.4 ? 2 : 1;
        ctx.fillRect(Math.round(px + ca * d), Math.round(py + sa * d), thick, thick);
      }
      ctx.fillStyle = this.bpal.dark;
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
      ctx.fillStyle = d % 5 < 2 ? this.bpal.dark : this.bpal.blood;
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
    disc(px, py, r, this.bpal.dark);
    disc(px, py, r - 1, this.bpal.blood);
    put(px - 1, py - 1, this.bpal.wet);
    for (let i = 0, n = Math.round((5 + near * 9) * power); i < n; i++) {
      const a = Math.random() < 0.6 ? angle + rand(-1.2, 1.2) : rand(0, TAU);
      const d = rand(r + 1, r + 8);
      put(px + Math.cos(a) * d, py + Math.sin(a) * d, Math.random() < 0.3 ? this.bpal.dark : this.bpal.blood);
    }
    for (let i = 0, n = 1 + Math.floor(rand(0, 2.5)); i < n; i++) {
      const a = angle + rand(-0.4, 0.4);
      const len = 2 + near * 6 * rand(0.5, 1.2);
      for (let d = 0; d < len; d++) put(px + Math.cos(a) * d, py + Math.sin(a) * d, d < len * 0.6 ? this.bpal.blood : this.bpal.dark);
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

    if (this.sewerRun) { this.renderSewer(ctx); return; } // túnel de la alcantarilla (piso 3): su propio mundo
    this.camera.apply(ctx);
    ctx.drawImage(this.floorLayer, 0, 0, pixelW, pixelH);
    const over = this.state === 'leaving' || this.state === 'arriving'; // moto y jugador se dibujan DESPUÉS de las paredes (pasan por la abertura de la valla)
    if (this.state === 'leaving' && this.exit) this.exit.drawRoad(ctx); // carretera de fuera (y la rampa del salto)
    ctx.drawImage(this.bloodLayer, 0, 0, pixelW, pixelH);
    if (this.goreOn) this.prints.draw(ctx); // sobre baldosas y sangre, bajo todo lo demás
    if (!over) this.drawBike(ctx);
    this.drawObjectiveMarker(ctx);
    this.particles.drawGround(ctx);
    this.cams.drawCones(ctx); // conos de las cámaras de seguridad, sobre el suelo
    this.drawHatch(ctx); // trampilla abierta (piso 10)
    // Muebles sobre la sangre (lo que cae debajo queda oculto) y bajo los personajes.
    ctx.drawImage(this.propsLayer, 0, 0, pixelW, pixelH);
    this.sewer.draw(ctx); // sobre los muebles de la calle: la cabeza nunca queda tapada ni cortada
    this.street.draw(ctx);
    this.hostages.draw(ctx);
    this.lore.drawWorld(ctx); // decorado narrativo: moneda del asiento, cuarto de servicio y calle vacía
    for (const e of this.enemies) if (e.alive && e.state === 'down') e.draw(ctx, this.time, this);
    this.drawExecuteMarks(ctx);
    this.drawLockMark(ctx);
    this.drawKey(ctx); // llave de la puerta principal (piso 3)
    this.drawRangeLabels(ctx); // campo de pruebas: nombre de cada arma
    for (const p of this.pickups) p.draw(ctx, this.time);
    this.drawMaskDrops(ctx);
    for (const b of this.bullets) b.draw(ctx);
    for (const e of this.enemies) if (e.standing) { if (e.rise) this.drawRising(ctx, e); else e.draw(ctx, this.time, this); }
    for (const a of this.allies) if (a.alive) {
      if (a.rise) this.drawRising(ctx, a);
      else if (a.sink && this.ladderRoom) this.drawThroughHole(ctx, a, this.ladderRoom.ladder, Math.min(1, a.sink.t / 0.9), () => a.draw(ctx, this.time, this)); // se va por la escalera
      else a.draw(ctx, this.time, this);
    }
    for (const a of this.allies) if (a.alive && !a.rise && !a.sink) this.drawCivMark(ctx, a, COLORS.player);          // AMIGOS: halo y marcador cian
    for (const e of this.enemies) if (e.alive && e.civ && !e.rise && e.state !== 'down') this.drawCivMark(ctx, e, '#ff2a4a'); // HOSTILES: halo y marcador rojo
    this.drawPoison(ctx);
    if (this.darkLayer) ctx.drawImage(this.darkLayer, 0, 0, pixelW, pixelH);
    this.drawPartner(ctx); // penumbra: atenúa enemigos y objetos; el jugador se dibuja encima (siempre se ve)
    if (this.player.alive) {
      if (this.state === 'playing' || this.state === 'cleared') this.player.drawAim(ctx, this);
      if (!over) this.drawPlayerBody(ctx);
    }
    this.drawDescent(ctx); // palanca clavada bajo la tapa (animación de bajar a la alcantarilla)
    this.drawExit(ctx);    // el agente de apoyo que sale por la alcantarilla (elección de rol, piso 10)
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
    this.lore.drawWallDecor(ctx); // calendario y taquillas del cuarto de servicio (sobre las paredes)
    this.cams.drawBodies(ctx); // cámaras montadas en las paredes
    this.drawVent(ctx); // ventilación del despacho (piso 10)
    this.drawEnding(ctx); // destrucción del edificio, bolas de fuego y corazones (final)
    this.hostages.drawOver(ctx, performance.now() / 1000); // auto de extracción (con las aberturas de la valla por donde entra y sale)
    if (over) {
      // Encima de la valla: el portón que se abre (o la abertura del carril), y después la moto con el jugador.
      if (this.state === 'leaving' && this.exit) this.exit.drawOver(ctx);
      else if (this.state === 'arriving') BikeExit.drawArrivalGap(ctx, this);
      this.drawBike(ctx);
      this.hostages.drawRiding(ctx); // el rehén que se sube a la moto va detrás del protagonista
      if (this.rider && this.rider.alive) this.rider.draw(ctx); // el otro agente, en el final
      if (this.player.alive) this.player.draw(ctx);
    }

    if (this.debug) this.renderDebug(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawStrobe(ctx);
    this.drawGas(ctx, this.scene.width, this.scene.height);
    this.drawScuffleFx(ctx);
    this.renderHud(ctx);
    this.drawScuffleUI(ctx);
    this.drawFade(ctx);

    this.fx.compose(this.ctx, this.scene, this.frameDt);
  }

  // El compañero inactivo: se dibuja con su máscara y su ropa, con una marca sobre la cabeza (nombre de su máscara) para distinguirlo.
  drawPartner(ctx) {
    const t = this.partner;
    if (!t || !t.alive || t.away || (this.finalExit && this.finalExit.out === t) || !['playing', 'cleared', 'scuffle', 'dead', 'reunion', 'radio', 'ambush', 'ending'].includes(this.state)) return;
    const T = this.trap, gassed = T && T.state === 'gas' && T.victim === t, k = gassed ? 1 - T.t / GAS_TIME : 0;
    const ox = t.x, RC = this.radioCine, em = RC && RC.emerge && this.ladderRoom && RC.emerge.sink > 0 ? { hole: this.ladderRoom.ladder, sink: RC.emerge.sink } : RC && RC.sinkViz && !RC.inside ? RC.sinkViz : null;
    if (em && em.sink >= 1) return; // se ha metido del todo en la boca de la calle
    if (gassed) t.x += Math.sin(performance.now() / 70) * (0.5 + k * 2.5); // tambaleo del agente atrapado en el gas
    if (em) this.drawThroughHole(ctx, t, em.hole, em.sink); // asoma de la escalera o se hunde en la boca de la calle (con las manos en el borde)
    else t.draw(ctx);
    t.x = ox;
    if (em) return; // asomando de la escalera: sin nombre ni flecha hasta que sale
    const time = performance.now() / 1000;
    const name = this.partnerMask ? this.partnerMask.name : '';
    if (this.state !== 'ending') drawText(ctx, name, t.x, t.y - t.r - 14, { color: '#9d8fb8', scale: WORLD_PX, align: 'center' });
    ctx.fillStyle = COLORS.player;
    const b = Math.round(Math.sin(time * 6)) * WORLD_PX;
    pixelRect(ctx, t.x - 1, t.y - t.r - 8 + b, 3, 1); pixelRect(ctx, t.x, t.y - t.r - 6 + b, 1, 1); // flecha ▼ sobre el compañero
  }

  // Casilla de salida parpadeante + flecha alrededor del jugador apuntando hacia ella.
  // La moto: sombra y sprite. Va montada por el jugador en la llegada y la fuga (el jugador se
  // dibuja encima, con las demás figuras); el resto del tiempo está aparcada en su plaza.
  drawBike(ctx) {
    const b = this.bike;
    if (!b) return;
    const a = b.angle || 0, z = b.z || 0, sc = b.sc || 1; // rumbo, altura del salto y tamaño (la salida elegida los mueve: ver exits.js)
    drawSprite(ctx, 'bikeShadow', b.x + 3, b.y + 3, a, { alpha: 0.5 * (1 - Math.min(0.7, z / 120)), scale: WORLD_PX * (1 - Math.min(0.4, z / 200)) });
    // Fuga en moto: el faro proyecta un cono de luz semitransparente hacia delante (se abre y se apaga con la distancia),
    // en bloques de píxeles y sumado, y su luz crece con la velocidad. Se dibuja en el sistema de la moto (gira con ella).
    if (this.state === 'leaving' && this.cine && this.cine.t >= LEAVE_BOARD) {
      const t2 = this.cine.t - LEAVE_BOARD;
      const power = Math.min(1, t2 / 0.5);
      ctx.save();
      ctx.translate(b.x, b.y - z);
      ctx.rotate(a);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff2b0';
      const N = 22;
      for (let i = 0; i < N; i++) {
        const k = i / N;
        ctx.globalAlpha = 0.26 * power * (1 - k) * (1 - k * 0.4);
        const half = 2 + i * 1.5;
        pixelRect(ctx, 16 + i * 7, 1 - half, 4, Math.max(1, Math.round((2 * half) / WORLD_PX)));
      }
      ctx.globalAlpha = 0.6 * power;
      pixelDisc(ctx, 9, 0.5, 3, WORLD_PX);
      ctx.restore();
    }
    drawSprite(ctx, 'bike', b.x, b.y - z, a, { scale: WORLD_PX * sc });
  }

  // Marco neón con flecha hacia lo que toca hacer: entrar por la puerta principal (fuera, antes de
  // cruzar el umbral) y, ya despejado el edificio, volver a la moto.
  drawObjectiveMarker(ctx) {
    const p = this.player;
    if (!p.alive || !this.mainDoor) return;
    let r = null;
    if (this.state === 'sewer' && this.sewerRun) {
      const l = this.sewerRun.map.ladder;
      r = { x: l.x - TILE / 2, y: l.y - TILE / 2, w: TILE, h: TILE, label: 'ESCALERA', below: true };
    } else if (this.state === 'playing' && !this.inside && this.sewerRoute) {
      r = this.street.guide(); // puerta cerrada por dentro: palanca → alcantarilla
    } else if (this.state === 'playing' && !this.inside) {
      const d = this.mainDoor;
      r = { x: d.cx - TILE / 2, y: d.cy - TILE / 2, w: TILE, h: TILE, label: 'ENTRADA', below: true };
    } else if (this.state === 'cleared' && this.trap) {
      const d = this.trap.detonator;
      if (d && this.final && this.final.role === 'limpieza' && !this.endingDone && !this.detNear) r = { x: d.x - TILE / 2, y: d.y - TILE / 2, w: TILE, h: TILE, label: 'DETONADOR', below: true };
    } else if (this.state === 'cleared' && this.doorPending && !this.keyOk()) {   // falta la llave: el marcador la señala a ella
      const k = this.keyDrop;
      const d = this.mainDoor;
      r = k ? { x: k.x - TILE / 2, y: k.y - TILE / 2, w: TILE, h: TILE, label: 'LLAVE', below: true } : { x: d.cx - TILE / 2, y: d.cy - TILE / 2, w: TILE, h: TILE, label: 'SALIDA', below: false };
    } else if (this.state === 'cleared' && this.doorPending) {   // la puerta sigue bloqueada hasta que el agente llega a ella: el marcador la señala a ella, no a la moto
      const d = this.mainDoor;
      r = { x: d.cx - TILE / 2, y: d.cy - TILE / 2, w: TILE, h: TILE, label: 'SALIDA', below: false };
    } else if (this.state === 'cleared') {
      const b = this.bike;
      r = { x: b.park.x - b.w / 2, y: b.park.y - b.h / 2, w: b.w, h: b.h, label: 'MOTO', below: false };
    } else if (this.state === 'playing' && this.trap && this.trap.state === 'gas' && !this.ventNear()) { // piso 10: marcador sobre el punto desde el que se rompe la ventilación
      const v = this.trap.vent;
      r = { x: v.sx - TILE / 2, y: v.sy - TILE / 2, w: TILE, h: TILE, label: 'VENTILACIÓN', below: true };
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
    this.cams.drawDebug(ctx); // conos de las cámaras de seguridad (piso 8)
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
    drawText(ctx, this.hint(`${this.keys.label('execute')} · ${this.keys.label('attack')}`, 'REMATAR'), s.x, s.y, { color: blink ? COLORS.text : COLORS.enemyBullet, align: 'center' });
  }

  drawPopups(ctx) {
    for (const pop of this.score.popups) {
      const s = this.camera.worldToScreen(pop.x, pop.y);
      ctx.globalAlpha = Math.min(1, pop.life * 2);
      const p = this.keepOnScreen(s.x, s.y - CELL_H, measureText(pop.text), CELL_H);
      drawText(ctx, pop.text, p.x, p.y, { color: COLORS.text, align: 'center', shadow: COLORS.wall });
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

  // Máscara del HUD con la sangre (roja, verde o mezclada) que lleva el personaje. Al llegar al nivel MÁXIMO gira de forma frenética (con
  // tirones y un latido de tamaño) mientras se juega el piso; se detiene de golpe en cuanto cae el último enemigo (estado 'cleared') o termina
  // la partida. Un solo drawImage por fotograma (el bitmap está en caché por máscara, nivel y mezcla).
  drawHudMask(ctx, x, y, p) {
    const lv = this.goreOn ? p.bloodLevel : 0;
    const img = bloodyMaskPortrait(this.mask, lv, 'male', this.maskBits);
    if (!(lv >= BLOOD_LEVELS && this.state === 'playing' && p.alive)) { ctx.drawImage(img, x - PORTRAIT_PAD, y - PORTRAIT_PAD); return; }
    const t = performance.now() / 1000;
    const anim = this.settings.get('strobeEnabled'); // con las luces estroboscópicas apagadas el arcoíris queda quieto (sin cambio de color)
    // Fondo de ADRENALINA: arcoíris en bandas de píxeles que giran en sentido contrario a la máscara, solo dentro del marco (26×26).
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 1, y - 1, 26, 26); ctx.clip();
    ctx.translate(x + 12, y + 12);
    ctx.rotate(anim ? -t * 3.2 : 0);
    ctx.drawImage(rainbowPattern(), -RAINBOW_SIZE / 2, -RAINBOW_SIZE / 2);
    ctx.restore();
    // Marco que cambia de color por el espectro y velo oscuro para que las manchas rojas y verdes de la máscara sigan leyéndose.
    ctx.fillStyle = 'rgba(13, 2, 33, 0.38)'; ctx.fillRect(x, y, 24, 24);
    ctx.fillStyle = RAINBOW[anim ? Math.floor(t * 7) % RAINBOW.length : 0];
    ctx.fillRect(x - 1, y - 1, 26, 1); ctx.fillRect(x - 1, y + 24, 26, 1); ctx.fillRect(x - 1, y, 1, 24); ctx.fillRect(x + 24, y, 1, 24);
    ctx.save();
    ctx.translate(x + 12, y + 12);
    ctx.rotate(t * 9 + Math.sin(t * 23) * 0.7);
    const sc = 1 + Math.sin(t * 31) * 0.07;
    ctx.scale(sc, sc);
    ctx.drawImage(img, -(12 + PORTRAIT_PAD), -(12 + PORTRAIT_PAD));
    ctx.restore();
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
      ...(r.challenge ? [['RETO', r.challenge.ok ? `CUMPLIDO +${r.challenge.bonus}` : 'FALLIDO']] : []),
      ...(r.hostages ? [['REHENES', `${r.hostages.saved}/${r.hostages.total} LIBERADOS${r.hostages.killed ? ` · ${r.hostages.killed} MUERTO${r.hostages.killed > 1 ? 'S' : ''} -${r.hostages.penalty.toLocaleString('es')}` : ''}`]] : []),
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
    // Mini panel de estadísticas: a la izquierda del bloque si cabe; en pantallas estrechas, una sola línea resumida.
    if (r.stats) {
      if (w >= 400) this.drawStatsPanel(ctx, Math.max(6, cx - 215) + this.safe.l, top + 14, r.stats);
      else {
        const l1 = `BAJAS ${r.stats.kills} · PRECISIÓN ${r.stats.accuracy}`, l2 = `MÁS USADA: ${r.stats.favorite}`;
        if (measureText(`${l1} · ${l2}`) <= w - 12) { drawText(ctx, `${l1} · ${l2}`, cx, y, { color: '#9d8fb8', align: 'center' }); y += 12; }
        else { drawText(ctx, l1, cx, y, { color: '#9d8fb8', align: 'center' }); drawText(ctx, l2, cx, y + 10, { color: '#9d8fb8', align: 'center' }); y += 22; } // pantalla estrecha: dos líneas
      }
    }
    if (Math.floor(performance.now() / 400) % 2 === 0) {
      const prompt = r.last
        ? this.hint('FIN DEL EDIFICIO · ENTER: VER RÉCORDS', 'FIN DEL EDIFICIO · TOCA PARA VER LOS RÉCORDS')
        : this.hint('ENTER → SIGUIENTE PISO · R REPETIR', 'TOCA PARA CONTINUAR');
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

  // Tabla HIGH SCORES (estilo recreativa) centrada en `y`: puesto (1ST, 2ND…), iniciales en neón, puntos, piso, combo,
  // máscara y fecha. La fila de la partida `highlightId` (la que se acaba de firmar) destella.
  drawRecordsTable(ctx, w, y, highlightId) {
    const cols = [
      { label: 'POS', x: 0 }, { label: 'NOMBRE', x: 28 }, { label: 'PUNTOS', x: 122, align: 'right' }, { label: 'PISO', x: 132 },
      { label: 'COMBO', x: 160 }, { label: 'MÁSCARA', x: 196 }, { label: 'FECHA', x: 244 },
    ];
    const tableW = 292;
    const x0 = Math.round((w - tableW) / 2);
    cols.forEach((c) => drawText(ctx, c.label, x0 + c.x, y, { color: '#9d8fb8', align: c.align || 'left' }));
    ctx.fillStyle = '#3a2a55';
    ctx.fillRect(x0, y + 10, tableW, 1);
    y += 14;
    const now = performance.now();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const e = this.history.entries[i];
      const rowY = y + i * 11;
      if (!e) {
        drawText(ctx, `${this.placeLabel(i + 1)}  ---`, x0, rowY, { color: '#4a3d66' });
        continue;
      }
      const mine = e.id === highlightId;
      if (mine) {
        // Destello de la fila recién registrada: fondo que alterna rosa/ámbar y marcador parpadeante.
        const f = Math.floor(now / 220) % 2;
        ctx.fillStyle = f ? 'rgba(255, 42, 133, 0.32)' : 'rgba(255, 190, 11, 0.22)';
        ctx.fillRect(x0 - 3, rowY - 1, tableW + 6, 11);
        if (Math.floor(now / 300) % 2) drawText(ctx, '>', x0 - 10, rowY, { color: COLORS.wall });
      }
      const color = mine ? COLORS.player : COLORS.text;
      const floor = e.completed ? 'FIN' : e.floor ? `${e.floor}/${LEVELS.length}` : '-';
      const values = [this.placeLabel(i + 1), '', e.score.toLocaleString('es'), floor, e.date ? `X${e.combo}` : '-',
        MASKS.find((m) => m.id === e.mask)?.name || e.maskName || '-', e.date ? formatDate(e.date).slice(0, 8) : 'ANTES'];
      cols.forEach((c, k) => { if (k !== 1) drawText(ctx, values[k], x0 + c.x, rowY, { color, align: c.align || 'left' }); });
      // Iniciales en neón brillante (cian / blanco cálido en la fila propia), con halo.
      ctx.save();
      const neon = mine ? (Math.floor(now / 220) % 2 ? '#ffffff' : COLORS.enemy) : COLORS.player;
      ctx.shadowColor = mine ? COLORS.wall : COLORS.player;
      ctx.shadowBlur = mine ? 9 : 5;
      drawText(ctx, e.initials || '???', x0 + cols[1].x, rowY, { color: neon, shadow: null });
      ctx.restore();
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

    drawText(ctx, 'HIGH SCORES', cx, 78, { color: COLORS.wall, align: 'center' });
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
    drawText(ctx, 'HIGH SCORES', cx, top, { color: COLORS.wall, scale: 2, align: 'center' });
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
    const title = this.maskPhase === 'support' ? 'MÁSCARA DE APOYO' : 'ELIGE TU MÁSCARA';
    drawText(ctx, title, cx, 6, { color: COLORS.wall, scale: this.fitScale(title, w - 12), align: 'center' });
    const sup = this.maskPhase === 'support', shown = sup ? (this.gender === 'female' ? 'male' : 'female') : this.gender; // fase de apoyo: se elige para el OTRO agente
    drawText(ctx, sup ? `${AGENTS[this.gender].name} YA ESTÁ ELEGIDO · ELIGE LA MÁSCARA DE ${AGENTS[shown].name}` : `PRÓXIMO: ${this.levelName}`, cx, 25, { color: sup ? AGENTS[shown].color : '#9d8fb8', align: 'center' });
    // Atajos de la esquina (en táctil son los botones VOLVER y RÉCORDS)
    if (!this.input.touchMode && w >= 340) {
      drawText(ctx, 'ESC: MENÚ', 6 + this.safe.l, 6 + this.safe.t, { color: '#7d6f98' });
      drawText(ctx, 'T: RÉCORDS', w - 6 - this.safe.r, 6 + this.safe.t, { color: '#7d6f98', align: 'right' });
    }

    const { cards, iconScale, bottom, preview, descCx, genders } = this.maskLayout();
    const bob = Math.floor(performance.now() / 300) % 2;
    this.maskList.forEach((mask, i) => {
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
      const size = 12 * iconScale, locked = !this.isMaskUnlocked(mask);
      ctx.globalAlpha = locked ? 0.18 : sel ? 1 : 0.55;
      ctx.drawImage(maskIcon(mask), Math.round(c.x + (c.w - size) / 2), y + 6, size, size);
      ctx.globalAlpha = 1;
      if (locked) {
        // Oscurecida + candado neón (parpadea al intentar elegirla)
        ctx.fillStyle = 'rgba(5, 0, 15, 0.45)';
        ctx.fillRect(c.x + 1, y + 1, c.w - 2, c.h - 2);
        const denied = performance.now() - (this.maskDenied || -9999) < 500 && sel;
        const lc = denied && Math.floor(performance.now() / 80) % 2 ? COLORS.blood : COLORS.player;
        ctx.save();
        ctx.shadowColor = lc;
        ctx.shadowBlur = 6;
        const ls = iconScale >= 3 ? 3 : 2;
        drawPadlock(ctx, Math.round(c.x + c.w / 2 - 3.5 * ls), Math.round(y + 6 + size / 2 - 4 * ls), lc, ls);
        ctx.restore();
      }
      drawText(ctx, mask.name, c.x + c.w / 2, y + 10 + size, { color: locked ? '#4a3d66' : sel ? COLORS.text : '#7d6f98', align: 'center' });
    });

    // Selector de agente: cada botón lleva su símbolo (♂ / ♀) y su neón (JACK cian, VEX magenta) cuando está activo.
    for (const b of genders) {
      const ag = AGENTS[b.id], on = shown === b.id, locked = sup && b.id === this.gender; // bloqueado: el primer protagonista ya elegido
      ctx.save();
      if (on) { ctx.shadowColor = ag.color; ctx.shadowBlur = 9; }
      ctx.fillStyle = on ? ag.color : '#3a2a55';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
      ctx.fillStyle = on ? ag.tint : '#140a24';
      ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      drawGenderIcon(ctx, b.x + 7, b.y + Math.round((b.h - 9) / 2), b.id, on ? ag.color : '#7d6f98');
      drawText(ctx, ag.name, b.x + 20 + Math.round((b.w - 22) / 2), b.y + Math.round((b.h - CELL_H) / 2), { color: on ? COLORS.text : '#7d6f98', align: 'center' });
      if (locked) { // opción deshabilitada: oscurecida con candado
        ctx.fillStyle = 'rgba(5, 0, 15, 0.62)'; ctx.fillRect(b.x, b.y, b.w, b.h);
        drawPadlock(ctx, b.x + b.w - 14, b.y + Math.round((b.h - 16) / 2), '#7d6f98', 2);
      }
    }

    // Vista previa en vivo (agente + máscara elegidos) y la ficha de la máscara a su derecha.
    const mask = this.maskList[this.maskIndex], now = performance.now() / 1000;
    drawAgentPreview(ctx, preview, mask.id, shown, now);
    if (!this.isMaskUnlocked(mask)) {
      ctx.fillStyle = 'rgba(5, 0, 15, 0.7)';
      ctx.fillRect(preview.x + 1, preview.y + 1, preview.w - 2, preview.h - 2);
      drawPadlock(ctx, Math.round(preview.x + preview.w / 2 - 10), Math.round(preview.y + preview.h / 2 - 12), COLORS.player, 3);
    }
    drawText(ctx, AGENTS[shown].name, preview.x + 5, preview.y + preview.h - 11, { color: AGENTS[shown].color }); // rótulo dentro del visor
    let y = preview.y + 2;
    const maskLocked = !this.isMaskUnlocked(mask);
    drawText(ctx, mask.name, descCx, y, { color: maskLocked ? '#7d6f98' : COLORS.player, scale: 2, align: 'center' });
    y += 22;
    if (maskLocked) {
      // Pista clara de dónde conseguirla
      const denied = performance.now() - (this.maskDenied || -9999) < 500 && Math.floor(performance.now() / 80) % 2;
      drawText(ctx, 'BLOQUEADA', descCx, y, { color: COLORS.blood, align: 'center' });
      drawText(ctx, this.maskLockHint(mask), descCx, y + 11, { color: denied ? COLORS.blood : COLORS.enemy, align: 'center' });
      drawText(ctx, 'ABATE AL ENEMIGO QUE LA LLEVA', descCx, y + 22, { color: '#9d8fb8', align: 'center' });
    } else {
      for (const line of mask.passive) {
        drawText(ctx, line, descCx, y, { color: COLORS.text, align: 'center' });
        y += 11;
      }
    }
    if (Math.floor(performance.now() / 400) % 2 === 0) {
      drawText(ctx, this.hint('FLECHAS: MÁSCARA · Q/E: AGENTE · ESPACIO / ENTER: EMPEZAR', 'TOCA UNA MÁSCARA: ELEGIR · OTRA VEZ: EMPEZAR'),
        cx, h - 12 - this.safe.b, { color: COLORS.player, align: 'center' });
    }
    if (this.prologue) this.flow.drawMaskSelectExtras(ctx, w, h, cx);
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
    if (this.callout) return;
    const outside = this.state === 'playing' && !this.inside && !!this.sewerRoute && this.bannerTimer <= 0 && !this.street.dialog, tunnel = this.state === 'sewer'; // (con el cuadro del teléfono abierto no se pisan)
    if (this.state !== 'cleared' && !outside && !tunnel) return;
    // Con la puerta aún por abrir, el objetivo es abrirla (ámbar); al abrirse sale «REGRESA A LA MOTO». Piso 10: el objetivo es detonar.
    const pend = this.doorPending && !this.trap, col = pend || outside ? '#ffbe0b' : COLORS.player;
    const text = outside ? this.street.goalText() : tunnel ? 'CRUZA EL TÚNEL · SUBE POR LA ESCALERA' : this.doorPending && !this.keyOk() ? 'RECOGE LA LLAVE · BRILLA EN EL SUELO' : this.trap ? (this.final && this.final.role === 'limpieza' ? 'ACTIVA EL DETONADOR · DESPACHO' : null) : pend ? 'ABRE LA SALIDA · ACÉRCATE A LA PUERTA' : 'REGRESA A LA MOTO';
    if (!text) return;
    const e = outside || tunnel ? 1 : 1 - Math.pow(1 - clamp(this.goalAge / 0.3, 0, 1), 3);
    const colX = this.input.touchMode ? this.touch.rightColumn().x : w; // en táctil, el panel se queda a la izquierda de la columna de botones
    const scale = this.fitScale(text, colX - 60, 2);
    const tw = measureText(text) * scale, th = CELL_H * scale;
    const pw = tw + 34, ph = th + 12;
    const x = Math.round(colX / 2 - pw / 2);
    const bottom = 10;
    const y = Math.round(h - this.safe.b - bottom - ph + (1 - e) * (ph + 14 + bottom));
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
    ctx.save();
    ctx.globalAlpha = 0.85 * e;
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(x, y, pw, ph);
    ctx.globalAlpha = (0.5 + 0.5 * pulse) * e;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, pw, 1);
    ctx.fillRect(x, y + ph - 1, pw, 1);
    ctx.fillRect(x, y, 1, ph);
    ctx.fillRect(x + pw - 1, y, 1, ph);
    ctx.globalAlpha = e;
    // Flecha (triángulo de píxeles) parpadeante a la izquierda: apunta hacia la moto.
    if (Math.floor(performance.now() / 250) % 2 === 0) {
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 8 + i, y + Math.round(ph / 2) - 4 + i, 1, 8 - 2 * i);
    }
    drawText(ctx, text, x + 20 + Math.round(tw / 2), y + 6, { color: col, scale, align: 'center' });
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
      if (this.vignette) this.vignette.draw(ctx, w, h); // V1 / V3: viñetas narrativas sobre la selección de máscara
      this.drawToast(ctx);
      this.drawPanel(ctx, w, h);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'role') { // elección de rol final: pantalla completa, sin HUD debajo
      this.drawRoleSelect(ctx, w, h);
      this.drawToast(ctx);
      this.drawPanel(ctx, w, h);
      this.drawCrosshair(ctx);
      return;
    }
    if (this.state === 'initials') {
      this.drawInitials(ctx, w, h);
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
    this.drawFloatingTexts(ctx);
    this.street.drawHud(ctx, w, h);
    this.hostages.drawHud(ctx, w, h);
    this.lore.drawHud(ctx, w, h); // la radio del cuarto de servicio
    this.hostages.drawLeaveAsk(ctx, w, h);
    this.drawTrapHud(ctx, w, h);
    this.drawFinalHud(ctx, w, h);
    this.drawDetonatorHud(ctx, w, h);
    this.drawSunset(ctx, w, h);
    if (this.state === 'reunion' || this.state === 'radio' || this.state === 'ambush' || this.state === 'ending' || this.state === 'exit') { ctx.fillStyle = '#05000f'; ctx.fillRect(0, 0, w, CINE_BAR); ctx.fillRect(0, h - CINE_BAR, w, CINE_BAR); }
    if (this.state === 'exit' && this.finalExit && this.finalExit.flash > 0) { ctx.fillStyle = `rgba(5, 0, 15, ${this.finalExit.flash})`; ctx.fillRect(0, 0, w, h); } // corte seco con fundido // barras de cine durante el reencuentro y la radio
    this.drawRadioBox(ctx, w, h);
    this.drawExecutePrompt(ctx);
    this.drawTutorial(ctx);
    const boss = this.enemies.find((e) => e.kind === 'boss' && e.alive && e.awake);
    if (boss && this.state !== 'cleared') drawBossBar(ctx, boss, w, 32 + this.safe.t);

    // Márgenes del HUD: separación fija + zona segura (muesca / esquinas redondeadas).
    const L = 6 + this.safe.l, R = w - 6 - this.safe.r, T = this.safe.t;
    // El HUD de debajo de las barras de cine (arma, máscara, puntos, combo) aparece y desaparece con ellas (`cineK`).
    this.fadeHud(ctx, w, h, (ctx) => {
    const def = p.def;
    let weaponText = def.name;
    if (p.weapon && def.maxAmmo) weaponText += `  ${p.weapon.ammo}/${def.maxAmmo}`;
    // El nombre del arma no pasa de la mitad izquierda (el centro es del combo, la lata y el jefe): se encoge si hace falta.
    drawText(ctx, weaponText, L, 4 + T, { color: COLORS.player, scale: this.fitScale(weaponText, Math.max(40, w / 2 - 46 - L), 2) });
    // Miniatura de la máscara equipada (12×12 a ×2) con su nombre.
    ctx.fillStyle = '#140a24';
    ctx.fillRect(L - 1, 24 + T, 26, 26);
    ctx.globalAlpha = p.masked ? 1 : 0.4; // en la mano todavía: se apaga hasta ponérsela
    this.drawHudMask(ctx, L, 25 + T, p);
    ctx.globalAlpha = 1;
    drawText(ctx, this.mask.name, L + 28, 25 + T, { color: '#9d8fb8' });
    // Brutalidad: una gota por nivel de sangre que lleva el personaje.
    for (let i = 0; i < (this.goreOn ? BLOOD_LEVELS : 0); i++) {
      ctx.fillStyle = i < p.bloodLevel ? COLORS.blood : '#3a1a3a';
      ctx.fillRect(L + 28 + i * 6, 34 + T, 4, 3);
    }
    if (p.noAmmoFlash > 0) drawText(ctx, 'SIN MUNICIÓN', L + 28, 37 + T, { color: COLORS.blood });
    // Compañero del relevo: mini retrato (apagado: el activo es el grande) y el nombre de su máscara. Debajo del retrato (PC) o a su derecha (táctil: ahí va REINICIAR).
    if (this.partner) {
      const tl = this.input.touchMode, px = tl ? L + 66 : L, py = tl ? 24 + T : 52 + T;
      ctx.fillStyle = this.partner.alive ? '#140a24' : '#3a0a14'; ctx.fillRect(px - 1, py - 1, 16, 16);
      ctx.globalAlpha = this.partner.alive ? 0.9 : 0.35;
      ctx.drawImage(bloodyMaskPortrait(this.partnerMask, this.goreOn ? this.partner.bloodLevel : 0, 'male', this.partnerBlood.maskBits), px, py, 14, 14);
      ctx.globalAlpha = 1;
      drawText(ctx, !this.partner.alive ? 'CAÍDO' : this.partner.away ? 'EN CAMINO' : this.trap && this.trap.state === 'gas' && this.trap.victim === this.partner ? 'ATRAPADO' : 'APOYO', px + (tl ? 0 : 18), py + (tl ? 17 : 1), { color: this.partner.alive ? '#7d6f98' : COLORS.blood });
      if (!tl) drawText(ctx, this.partnerMask.name, px + 18, py + 9, { color: '#5b4f78' });
    }

    // Arriba a la derecha SOLO los puntos (sin contador de enemigos, récord ni nombre del piso: tapaban demasiado en móvil); debajo, los avisos raros.
    drawText(ctx, `${this.score.total.toLocaleString('es')} PTS`, R, 4 + T, { color: COLORS.text, scale: 2, align: 'right', shadow: COLORS.wall });
    const flags = [this.sfx.muted && 'SONIDO OFF', !this.fx.enabled && 'EFECTOS OFF', this.fx.enabled && this.fx.lite && 'EFECTOS LIGEROS']
      .filter(Boolean).join(' · ');
    if (flags) drawText(ctx, flags, R, 21 + T, { color: '#9d8fb8', align: 'right' });

    this.drawComboMeter(ctx, w);

    });
    if (this.debug) {
      drawText(ctx, `DEBUG · ${this.fps} FPS · BALAS ${this.bullets.length} · PART ${this.particles.list.length} · CASQ ${this.particles.shells.length}`, L, 54 + T, { color: COLORS.debug });
      drawText(ctx, `ESCENA ${w}X${h} · ESCALA ${this.view.scale} · MÁSCARA ${this.mask.id} · MANCHAS ${this.stains} · SANGRE ${this.player.bloodLevel} (${this.gore.toFixed(1)}) · PISADAS ${this.prints.list.length} · SUELAS ${this.player.soles} · CIVILES ${this.civilianRecord.hurt}/${this.civilianRecord.killed}/${this.civilianRecord.gifts} ${this.civiliansHelp()} · ${this.inside ? 'DENTRO' : 'FUERA'} PUERTA ${this.mainDoor.locked ? 'BLOQUEADA' : this.mainDoor.closing ? 'CERRANDO' : 'LIBRE'}`, L, 65 + T, { color: COLORS.debug });
    }

    const cx = Math.round(w / 2);
    if (this.bannerTimer > 0 && this.state === 'playing') {
      ctx.globalAlpha = Math.min(1, this.bannerTimer);
      drawText(ctx, this.levelName, cx, Math.round(h * 0.28), { color: COLORS.wall, scale: this.fitScale(this.levelName, w - 12), align: 'center' });
      ctx.globalAlpha = 1;
    }
    // Objetivo de cada fase (parpadea): entrar y, despejado el edificio, volver a la moto.
    const goal = this.state === 'playing' && !this.inside && !this.sewerRoute && this.bannerTimer <= 0 ? 'ENTRA AL EDIFICIO' : null;
    if (goal && Math.floor(performance.now() / 300) % 3 !== 0) {
      // Debajo del bloque de puntuación (termina en y≈67) para no solaparse con él.
      drawText(ctx, goal, cx, 72 + T, { color: COLORS.player, scale: this.fitScale(goal, w - 12), align: 'center' });
    }
    this.drawCallout(ctx, w, h);
    this.drawGoalPanel(ctx, w, h);
    // Cinemáticas (llegada y fuga): barras negras arriba y abajo que se deslizan al entrar y al salir (`cineK`), con un filo de neón en el borde interior;
    // mientras están, el HUD de debajo se desvanece (fadeHud) y vuelve al irse.
    if (this.cineK > 0.01 && ['arriving', 'leaving', 'playing', 'cleared'].includes(this.state)) {
      const k = this.cineK, bh = Math.round(CINE_BAR * k);
      ctx.fillStyle = '#05000f';
      ctx.fillRect(0, 0, w, bh);
      ctx.fillRect(0, h - bh, w, bh);
      if (bh > 1) {
        ctx.globalAlpha = 0.85 * k;
        ctx.fillStyle = COLORS.wall; ctx.fillRect(0, bh - 1, w, 1);          // filo rosa bajo la barra de arriba
        ctx.fillStyle = COLORS.player; ctx.fillRect(0, h - bh, w, 1);        // filo cian sobre la barra de abajo
        ctx.globalAlpha = 1;
      }
      if (k > 0.9 && (this.state === 'arriving' || this.state === 'leaving') && !this.endingRide) drawText(ctx, this.hint('ESPACIO · CLIC: SALTAR', 'TOCA: SALTAR'), cx, h - CINE_BAR + 4, { color: '#9d8fb8', align: 'center' }); // la salida del final no se salta
    }
    if (this.state === 'dead') this.drawRunover(ctx, w, h);
    if (this.state === 'dead' && !(this.asphyx && this.asphyx.t < 2.6)) { // (con la cinemática de asfixia, la franja sale al final)
      // En táctil la franja crece para alojar los botones REINTENTAR / TERMINAR / RÉCORDS.
      const touch = this.input.touchMode;
      const bandH = touch ? 26 + 8 + this.touch.buttonSize('X').h + 8 : 52;
      ctx.fillStyle = 'rgba(13, 2, 33, 0.6)';
      ctx.fillRect(0, Math.round(h / 2) - 26, w, bandH);
      const title = this.runover ? this.runover.msg : (this.deathMsg || 'HAS MUERTO'); // atropellado por el auto de extracción: burla en vez de HAS MUERTO
      drawText(ctx, title, cx, Math.round(h / 2) - 22, { color: COLORS.blood, scale: this.fitScale(title, w - 12, 3), align: 'center' });
      if (!touch) {
        if (this.endAskActive()) drawText(ctx, 'ESC DE NUEVO: TERMINAR Y PERDER EL PROGRESO · R: REINTENTAR', cx, Math.round(h / 2) + 10, { color: Math.floor(performance.now() / 250) % 2 ? COLORS.blood : COLORS.text, align: 'center' });
        else drawText(ctx, 'R REINTENTAR PISO · ESC TERMINAR PARTIDA · T RÉCORDS', cx, Math.round(h / 2) + 10, { color: COLORS.text, align: 'center' });
      }
      if (this.showRecords) this.drawRecordsOverlay(ctx, w, h);
      else { const ss = this.statsSummary(); this.drawStatsPanel(ctx, Math.round(cx - this.statsPanelWidth(ss) / 2), Math.min(Math.round(h / 2) - 26 + bandH + 6, h - this.safe.b - 6 - 53), ss); } // sin pasar de la zona segura inferior
      this.touch.drawScreenButtons(ctx);
    }
    this.comms.draw(ctx, w, h); // encima de todo el HUD
    if (this.comms.cur && this.comms.cur.skippable && this.comms.cur.age > 0.8) this.drawSkipHint(ctx, w, 10 + this.safe.t, this.comms); // pista de «mantén para saltar» (llamada de CENTRAL)
    if (this.vignette) this.vignette.draw(ctx, w, h);        // viñeta narrativa a pantalla completa
    this.lore.drawShot(ctx, w, h);                           // barras y pista de los planos narrativos
    if (!this.comms.cur) this.fadeHud(ctx, w, h, (c) => this.touch.draw(c));
    if (this.state === 'results') this.drawResults(ctx, w, h);
    this.drawToast(ctx);

    this.drawPanel(ctx, w, h);
    this.drawCrosshair(ctx);
  }
}
