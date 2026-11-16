// Gestor de pausa para un SDK de anuncios (Poki, CrazyGames…). Por ahora NO hay SDK conectado: con `enabled = false` los
// métodos llaman a `onComplete` / `onCancel` al instante y no pausan nada, así que el juego se comporta igual que sin anuncios.
// Cuando se conecte un SDK basta con registrar un adaptador (`ads.connect(adapter)`) y activar `enabled`; el módulo se encarga de:
//   1. PAUSAR el bucle principal (`game.loop` no avanza la simulación mientras `ads.active`) y limpiar la entrada;
//   2. SILENCIAR por completo el audio (`sfx.setAdSilence(true)`: master a 0 y `AudioContext.suspend()`, así tampoco corre la
//      música); al terminar se restaura (respetando el silencio manual con M);
//   3. reanudar sin salto de tiempo (`game.last`/`acc` se reajustan) y llamar al callback.
//
// PUNTOS DE ANUNCIO marcados en el juego (busca `ads.trigger` en game.js):
//   - ENTRE PISOS: `Game.advance()` (al salir de los resultados hacia el siguiente piso) → triggerInterstitial.
//   - TRAS X MUERTES: `Game.restartLevel()` cuando `ads.countDeath()` llega a `AD_EVERY_N_DEATHS` → triggerInterstitial.
//     (R sigue siendo instantáneo mientras no haya SDK; con SDK el anuncio sale ANTES del reintento.)
//   - RECOMPENSADO (sin conectar aún): `triggerRewarded` está listo para, por ejemplo, ofrecer continuar tras morir.
//
// Contrato del adaptador (todas las funciones llaman a su callback UNA vez):
//   { interstitial(done) }                  // done() al cerrarse el anuncio (o fallar)
//   { rewarded(done) }                      // done(true) si se concedió la recompensa, done(false) si se canceló
// Ejemplos (no incluidos): Poki → `PokiSDK.commercialBreak().then(done)` y `PokiSDK.rewardedBreak().then(done)`;
//   CrazyGames → `CrazyGames.SDK.ad.requestAd('midgame', { adFinished: done, adError: done })`
//   y `requestAd('rewarded', { adFinished: () => done(true), adError: () => done(false) })`.
export const AD_EVERY_N_DEATHS = 3;   // cada cuántas muertes (reintentos) sale un anuncio entre intentos
const AD_TIMEOUT_MS = 45000;          // red de seguridad: si el SDK no responde, se reanuda sola

export class Ads {
  constructor(game) {
    this.game = game;
    this.enabled = false;   // se activa al conectar un SDK real
    this.adapter = null;
    this.active = false;    // true mientras hay un anuncio en pantalla: el bucle no avanza
    this.deaths = 0;
  }

  // Conecta un adaptador de SDK y activa los anuncios.
  connect(adapter) {
    this.adapter = adapter;
    this.enabled = !!adapter;
  }

  // Cuenta una muerte (reintento) y dice si toca anuncio.
  countDeath() {
    this.deaths++;
    return this.deaths % AD_EVERY_N_DEATHS === 0;
  }

  pause() {
    const g = this.game;
    this.active = true;
    g.input.pressed.clear();
    g.input.mousePressed.left = g.input.mousePressed.right = g.input.mousePressed.middle = false;
    g.sfx.setAdSilence(true);
  }

  resume() {
    const g = this.game;
    this.active = false;
    g.sfx.setAdSilence(false);
    g.last = performance.now(); // sin salto de tiempo al volver
    g.acc = 0;
    g.input.pressed.clear();
  }

  // Anuncio a pantalla completa entre pisos o tras X muertes. `onComplete` se llama siempre (también si no hay SDK o falla).
  triggerInterstitial(onComplete) {
    if (!this.enabled || !this.adapter || this.active) { if (onComplete) onComplete(); return false; }
    this.pause();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.resume();
      if (onComplete) onComplete();
    };
    const timer = setTimeout(finish, AD_TIMEOUT_MS);
    try { this.adapter.interstitial(finish); } catch { finish(); }
    return true;
  }

  // Anuncio recompensado: `onReward` si el jugador lo vio entero; `onCancel` si lo cerró, falló o no hay SDK.
  triggerRewarded(onReward, onCancel) {
    if (!this.enabled || !this.adapter || this.active) { if (onCancel) onCancel(); return false; }
    this.pause();
    let done = false;
    const finish = (granted) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.resume();
      if (granted) { if (onReward) onReward(); } else if (onCancel) onCancel();
    };
    const timer = setTimeout(() => finish(false), AD_TIMEOUT_MS);
    try { this.adapter.rewarded(finish); } catch { finish(false); }
    return true;
  }
}
