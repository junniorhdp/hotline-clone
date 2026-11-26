// Integración SEGURA del SDK v3 de CrazyGames (solo entra en la build de CrazyGames; el juego original no sabe nada del SDK).
// Sin SDK, bloqueado (adblock, sin red) o en un dominio donde el SDK está "disabled" (allí TODA llamada lanza error), todo se convierte en no-op y el juego sigue igual.

const INIT_TIMEOUT_MS = 4000;     // el juego nunca se queda esperando al SDK
const AD_START_TIMEOUT_MS = 10000; // el anuncio no llega a empezar: se sigue jugando
const AD_MAX_MS = 180000;          // red de seguridad si, ya empezado, nunca avisa de que terminó

// Estados de `game.state` que cuentan como partida activa (las cinemáticas cortas de un piso forman parte de él: así no se emite stop/start a cada momento).
// Quedan fuera: menu, masks, role (elección en pantalla completa), dead, results, initials y gameover.
const PLAY_STATES = new Set(['arriving', 'playing', 'scuffle', 'cleared', 'leaving', 'radio', 'reunion', 'exit', 'ambush', 'ending', 'sewer', 'descend', 'ascend', 'emerge']);

let sdk = null;
let playing = false;

const safe = (fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  } catch { return undefined; }
};

export async function initSdk() {
  const found = window.CrazyGames?.SDK;
  if (!found) return null;
  try {
    let timer;
    await Promise.race([
      found.init(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SDK init timeout')), INIT_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (found.environment === 'disabled') return null;
    sdk = found;
  } catch { sdk = null; }
  return sdk;
}

export const loadingStart = () => { if (sdk) safe(() => sdk.game.loadingStart()); };
export const loadingStop = () => { if (sdk) safe(() => sdk.game.loadingStop()); };

export function setGameplay(on) {
  if (on === playing) return;
  playing = on;
  if (sdk) safe(() => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()));
}

export const isGameplay = (game) => PLAY_STATES.has(game.state) && !game.panel && !game.vignette && !game.ads.active;

// Silencio por dos motivos independientes: un anuncio en pantalla o el ajuste `muteAudio` de la plataforma (manda sobre el sonido del juego, también sobre la tecla M).
function wireAudio(game) {
  const sfx = game.sfx;
  let platformMuted = false;
  const enforce = () => { if (platformMuted && sfx.master) sfx.master.gain.value = 0; };
  for (const name of ['init', 'toggleMute', 'setAdSilence']) {
    const original = sfx[name].bind(sfx);
    sfx[name] = (...args) => { const r = original(...args); enforce(); return r; };
  }
  return (muted) => {
    if (muted === platformMuted) return;
    platformMuted = muted;
    if (muted) enforce();
    else if (sfx.master) sfx.setAdSilence(sfx.adMuted); // recalcula el volumen respetando M y un anuncio en curso
  };
}

// Anuncio 'midgame' o 'rewarded'. La partida se PAUSA al pedirlo (bucle parado y entrada bloqueada), el audio se silencia cuando el anuncio EMPIEZA (norma de CrazyGames)
// y todo se restaura al terminar o fallar. `done(visto)`: `true` solo si el anuncio acabó bien (una recompensa nunca se da con error).
export function showAd(game, type, done = () => {}) {
  const ads = game.ads;
  if (!sdk || ads.active) { done(false); return false; }
  setGameplay(false);
  ads.active = true;
  game.input.pressed.clear();
  game.input.mousePressed.left = game.input.mousePressed.right = game.input.mousePressed.middle = false;
  let finished = false, timer = null;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    ads.resume(); // quita el silencio del anuncio, sin salto de tiempo, y reanuda el bucle (ads.js)
    game.input.mouse.left = game.input.mouse.right = game.input.mouse.middle = false;
    game.input.keys.clear();
    done(ok);
  };
  timer = setTimeout(() => finish(false), AD_START_TIMEOUT_MS);
  try {
    sdk.ad.requestAd(type, {
      adStarted: () => {
        if (finished) return;
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), AD_MAX_MS);
        game.sfx.setAdSilence(true);
      },
      adFinished: () => finish(true),
      adError: () => finish(false),
    });
  } catch { finish(false); }
  return true;
}

export function attach(game) {
  const setPlatformMute = wireAudio(game);
  if (sdk) {
    const apply = (settings) => setPlatformMute(!!settings?.muteAudio);
    safe(() => apply(sdk.game.settings));
    safe(() => sdk.game.addSettingsChangeListener(apply));
  }
  // Los puntos de anuncio que ya tiene el juego (entre pisos y cada 3 muertes) pasan por el SDK.
  game.ads.enabled = !!sdk;
  game.ads.triggerInterstitial = (onComplete) => showAd(game, 'midgame', () => onComplete?.());
  game.ads.triggerRewarded = (onReward, onCancel) => showAd(game, 'rewarded', (ok) => (ok ? onReward?.() : onCancel?.()));
  const watch = () => { setGameplay(isGameplay(game)); requestAnimationFrame(watch); };
  requestAnimationFrame(watch);
}
