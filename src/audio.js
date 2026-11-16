// Audio 100% procedimental con Web Audio (sin archivos): efectos de sonido + música synthwave.
// El AudioContext solo puede arrancar tras un gesto del usuario, así que se crea en el primer clic/tecla.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const MASTER_VOLUME = 0.4;
const MUSIC_VOLUME = 0.5;    // relativo al master; M silencia ambos
const AMBIENT_VOLUME = 0.7;  // ambiente de "piso limpio" (ver setMusic)

// --- Música -----------------------------------------------------------------
// Tres modos, un único planificador: 'action' (combate), 'empty' (piso limpio) y 'menu'.
const BPM = 150;                  // darksynth acelerado: el combate tiene que ir sobrado de pulso
const STEP_TIME = 60 / BPM / 4;   // duración de una semicorchea
const STEPS = 64;                 // 4 compases de 16 semicorcheas
const LOOKAHEAD = 0.15;           // s de música que se programan por adelantado
const TICK_MS = 25;               // cada cuánto revisa el planificador
const CUT_TIME = 0.09;            // corte seco de la música al limpiar el piso
const AMBIENT_FADE = 0.9;         // lo que tarda en abrirse el ambiente vacío

// Modo acción: Am - F - G - Em (menor, más oscuro que el I-IV-V clásico)
const ACTION_ROOTS = [55.0, 43.65, 49.0, 41.2];
const ACTION_CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66],
  [164.81, 196.0, 246.94],
];
// Bajo a semicorcheas (0 silencio · 1 raíz · 2 octava): sin huecos, es el motor del tema.
const BASS_PATTERN = [1, 1, 2, 1, 1, 0, 1, 2, 1, 1, 2, 1, 2, 1, 1, 2];
// Arpegio a semicorcheas: índices del acorde, con saltos de octava marcados aparte.
const ARP_PATTERN = [0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2, 2, 1, 2, 0];
const ARP_OCTAVE = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0];
// Bombo: a negras + dos síncopas que empujan el compás.
const KICK_STEPS = [0, 4, 7, 8, 10, 12];
// Modo menú: Fmaj7 - Em7 - Dm7 - Cmaj7, pads lentos y campanas
const MENU_CHORDS = [
  [174.61, 220.0, 261.63, 329.63],
  [164.81, 196.0, 246.94, 293.66],
  [146.83, 174.61, 220.0, 261.63],
  [130.81, 164.81, 196.0, 246.94],
];
// Modo vacío: sub-drone en La, una quinta por encima y un armónico lejano.
const DRONE_FREQS = [41.2, 61.74, 164.81];
const DRONE_TIME = 7;             // cada cuánto se renueva el zumbido (con solapamiento)

// --- Efectos ----------------------------------------------------------------
const SOUNDS = {
  shot(s, v) {
    s.noise({ dur: 0.18, gain: 0.5 * v, filter: 'bandpass', freq: 1800, freqTo: 400, q: 0.8 });
    s.tone({ type: 'sine', from: 160, to: 40, dur: 0.15, gain: 0.6 * v });
  },
  shotgun(s, v) {
    s.noise({ dur: 0.35, gain: 0.7 * v, filter: 'lowpass', freq: 2500, freqTo: 200, q: 0.7 });
    s.tone({ type: 'sine', from: 120, to: 30, dur: 0.25, gain: 0.8 * v });
  },
  // Subfusil: disparo corto y seco para que la cadencia alta no sature.
  smg(s, v) {
    s.noise({ dur: 0.07, gain: 0.35 * v, filter: 'bandpass', freq: 2200, freqTo: 700, q: 0.9 });
    s.tone({ type: 'square', from: 190, to: 60, dur: 0.05, gain: 0.18 * v });
  },
  enemyShot(s, v) {
    s.noise({ dur: 0.2, gain: 0.45 * v, filter: 'bandpass', freq: 1300, freqTo: 300, q: 0.8 });
    s.tone({ type: 'sine', from: 130, to: 35, dur: 0.16, gain: 0.5 * v });
  },
  hit(s, v) {
    s.tone({ type: 'sine', from: 140, to: 45, dur: 0.14, gain: 0.7 * v });
    s.noise({ dur: 0.07, gain: 0.4 * v, filter: 'lowpass', freq: 900 });
  },
  knock(s, v) {
    s.tone({ type: 'triangle', from: 220, to: 70, dur: 0.12, gain: 0.5 * v });
    s.noise({ dur: 0.05, gain: 0.3 * v, filter: 'lowpass', freq: 1200 });
  },
  swing(s, v) {
    s.noise({ dur: 0.09, gain: 0.18 * v, filter: 'bandpass', freq: 500, freqTo: 2200, q: 2 });
  },
  step(s, v) {
    s.noise({ dur: 0.05, gain: 0.12 * v, filter: 'lowpass', freq: 250 + Math.random() * 130 });
  },
  alert(s, v) {
    s.tone({ type: 'square', from: 1046, dur: 0.07, gain: 0.12 * v });
    s.tone({ type: 'square', from: 1568, dur: 0.09, gain: 0.12 * v, delay: 0.08 });
  },
  aim(s, v) {
    s.tone({ type: 'sine', from: 1800, dur: 0.05, gain: 0.08 * v });
  },
  kick(s, v) {
    s.noise({ dur: 0.22, gain: 0.6 * v, filter: 'lowpass', freq: 1400, freqTo: 300 });
    s.tone({ type: 'sine', from: 110, to: 40, dur: 0.2, gain: 0.6 * v });
  },
  creak(s, v) {
    s.tone({ type: 'sawtooth', from: 170, to: 240, dur: 0.2, gain: 0.035 * v });
  },
  ricochet(s, v) {
    s.tone({ type: 'triangle', from: 2600, to: 1200, dur: 0.06, gain: 0.06 * v });
    s.noise({ dur: 0.03, gain: 0.08 * v, filter: 'highpass', freq: 3000 });
  },
  empty(s, v) {
    s.tone({ type: 'square', from: 2400, to: 2000, dur: 0.025, gain: 0.1 * v });
  },
  pickup(s, v) {
    s.tone({ type: 'triangle', from: 520, to: 880, dur: 0.07, gain: 0.2 * v });
  },
  throw(s, v) {
    s.noise({ dur: 0.15, gain: 0.2 * v, filter: 'bandpass', freq: 800, freqTo: 300, q: 1.5 });
  },
  death(s, v) {
    s.tone({ type: 'sawtooth', from: 300 * s.voice, to: 50 * s.voice, dur: 0.7, gain: 0.25 * v });
    s.noise({ dur: 0.4, gain: 0.3 * v, filter: 'lowpass', freq: 600 });
  },
  // Blip de combo: sube de tono con el multiplicador.
  combo(s, v, level = 1) {
    const f = 520 * Math.pow(2, Math.min(level - 1, 12) / 12);
    s.tone({ type: 'square', from: f, to: f * 1.5, dur: 0.08, gain: 0.08 * v });
  },
  // Portazo del bloqueo del edificio: golpe grave y metálico, y tres tonos de alarma.
  lockdown(s, v) {
    s.tone({ type: 'sine', from: 70, to: 28, dur: 0.5, gain: 1 * v });
    s.noise({ dur: 0.22, gain: 0.6 * v, filter: 'lowpass', freq: 2200, freqTo: 180, q: 0.9 });
    s.noise({ dur: 0.06, gain: 0.35 * v, filter: 'highpass', freq: 2500, delay: 0.02 });
    for (let i = 0; i < 3; i++) s.tone({ type: 'square', from: 880, to: 660, dur: 0.14, gain: 0.07 * v, delay: 0.25 + i * 0.22 });
  },
  // Al ponerse la máscara: un clic y un barrido que sube.
  maskOn(s, v) {
    s.noise({ dur: 0.03, gain: 0.3 * v, filter: 'highpass', freq: 2200 });
    s.tone({ type: 'triangle', from: 380, to: 1100, dur: 0.14, gain: 0.2 * v, delay: 0.02 });
    s.tone({ type: 'sine', from: 90, to: 50, dur: 0.12, gain: 0.35 * v });
  },
  // Al despejar el edificio, la puerta se desbloquea: un clic seco y dos notas limpias.
  unlock(s, v) {
    s.noise({ dur: 0.04, gain: 0.35 * v, filter: 'bandpass', freq: 1800, q: 3 });
    s.tone({ type: 'triangle', from: 660, dur: 0.16, gain: 0.16 * v, delay: 0.05 });
    s.tone({ type: 'triangle', from: 990, dur: 0.22, gain: 0.16 * v, delay: 0.16 });
  },
  // Carga de la ejecución: un barrido ascendente corto, el aire que se tensa antes del golpe.
  execWind(s, v) {
    s.noise({ dur: 0.26, gain: 0.2 * v, filter: 'bandpass', freq: 250, freqTo: 2400, q: 2.5 });
    s.tone({ type: 'sawtooth', from: 70, to: 190, dur: 0.26, gain: 0.07 * v });
  },
  // Golpe final de la ejecución: impacto grave, crujido de hueso (clics secos de ruido filtrado)
  // y un chapoteo húmedo. Mucho más pesado que `hit`.
  crunch(s, v) {
    s.tone({ type: 'sine', from: 95, to: 26, dur: 0.34, gain: 1 * v });
    s.noise({ dur: 0.12, gain: 0.6 * v, filter: 'lowpass', freq: 1900, freqTo: 200, q: 0.9 });
    for (let i = 0; i < 3; i++) {
      s.noise({ dur: 0.028, gain: 0.4 * v, filter: 'bandpass', freq: 800 + i * 520 + Math.random() * 300, q: 3.5, delay: 0.012 + i * 0.034 });
    }
    s.noise({ dur: 0.3, gain: 0.32 * v, filter: 'lowpass', freq: 750, freqTo: 110, delay: 0.07 });
  },
  // Corte estilo cinta/VHS al caer el último enemigo: la música se desploma de tono y la
  // cinta se para con un chasquido. Suena por el master, no por el bus de música, para que
  // el corte de la música no se lo lleve por delante.
  tapeStop(s, v) {
    s.tone({ type: 'sawtooth', from: 330, to: 24, dur: 0.5, gain: 0.2 * v });
    s.tone({ type: 'square', from: 165, to: 18, dur: 0.55, gain: 0.1 * v });
    s.noise({ dur: 0.5, gain: 0.22 * v, filter: 'lowpass', freq: 4200, freqTo: 120, q: 0.6 });
    s.noise({ dur: 0.07, gain: 0.14 * v, filter: 'highpass', freq: 1800, delay: 0.5 });
  },
  // Gruñido de esfuerzo del jugador (inicio del forcejeo, contraataque, golpe recibido): una sierra que baja de tono
  // pasada por un filtro de formantes + un soplo de ruido. `s.voice` lo sube un poco si el personaje es femenino
  // (≈ +22 %, y el formante también), de modo que se distingue sin cambiar nada jugable.
  grunt(s, v) {
    const f = 118 * s.voice;
    s.tone({ type: 'sawtooth', from: f * 1.15, to: f * 0.8, dur: 0.22, gain: 0.07 * v });
    s.tone({ type: 'triangle', from: f * 2.3, to: f * 1.6, dur: 0.18, gain: 0.04 * v });
    s.noise({ dur: 0.16, gain: 0.09 * v, filter: 'bandpass', freq: 900 * s.voice, freqTo: 600 * s.voice, q: 3 });
  },
  // Forcejeo: el golpe seco que lo inicia (frenazo grave + barrido de aire) y el fogonazo del contraataque.
  scuffleIn(s, v) {
    s.tone({ type: 'sine', from: 220 * s.voice, to: 36, dur: 0.45, gain: 0.7 * v });
    s.tone({ type: 'sawtooth', from: 440 * s.voice, to: 55 * s.voice, dur: 0.4, gain: 0.12 * v });
    s.play('grunt', 0.8);
    s.noise({ dur: 0.35, gain: 0.25 * v, filter: 'lowpass', freq: 5200, freqTo: 200, q: 0.8 });
  },
  scuffleWin(s, v) {
    s.tone({ type: 'sine', from: 140 * s.voice, to: 40, dur: 0.3, gain: 1 * v });
    s.play('grunt', 1);
    s.noise({ dur: 0.12, gain: 0.5 * v, filter: 'bandpass', freq: 1800, freqTo: 600, q: 0.6 });
    [523.25, 783.99, 1046.5].forEach((f, i) => s.tone({ type: 'square', from: f, dur: 0.16, gain: 0.1 * v, delay: 0.1 + i * 0.07 }));
  },
  // Fanfarria corta (fin de partida con récord).
  clear(s, v) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      s.tone({ type: 'triangle', from: f, dur: 0.35, gain: 0.18 * v, delay: i * 0.09 });
    });
  },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.slow = 0;          // 0..1: cuánto ha bajado de tono y de velocidad la música (forcejeo)
    this.slowTarget = 0;
    this.lastTick = 0;
    this.voice = 1;         // tono de la voz del jugador: 1 = hombre (más grave), ~1,22 = mujer (algo más aguda); ver setGender
    this.musicVol = 1;      // 0..1, ajuste del jugador (settings.js): música y ambiente
    this.sfxVol = 1;        // 0..1: todos los efectos, incluida la moto
    this.musicMode = 'action';  // 'action' | 'empty' | 'menu'
    this.musicTimer = null;
    this.droneUntil = 0;
    this.staticUntil = 0;
    this.echoAt = 0;
    this.moto = null;      // voz de la moto en curso (ver playMotoArrival / playMotoDeparture)
    this.satCurve = null;
    const unlock = () => this.init();
    // En táctil el navegador solo permite arrancar el audio al levantar el dedo (pointerup /
    // touchend), no al tocar; con ratón y teclado basta con pulsar.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(type, unlock);
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      // El compresor evita que varios golpes a la vez saturen.
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      // Efectos: todo lo puntual (y la moto) pasa por `sfxBus`, así `sfxVolume` los atenúa sin tocar la música.
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = Math.max(this.sfxVol, 0.0001);
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = Math.max(MUSIC_VOLUME * this.musicVol, 0.0001);
      this.musicBus.connect(this.master);
      // El ambiente vacío va por su propio bus: así la música se corta en seco sin tocarlo y
      // el ambiente se abre y se cierra con sus propios tiempos.
      this.ambientBus = this.ctx.createGain();
      this.ambientBus.gain.value = 0.0001;
      this.ambientBus.connect(this.master);
      this.applyMusicMode(true);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.startMusic();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    if (this.muted) this.stopMoto(0.03);
  }

  // Volúmenes del jugador (0..1). Se aplican al instante (rampa corta); sin contexto solo se guardan
  // y los usa init(). Música y ambiente comparten `musicVol`.
  setVolumes({ music, sfx } = {}) {
    if (music !== undefined) this.musicVol = clamp01(music);
    if (sfx !== undefined) this.sfxVol = clamp01(sfx);
    if (!this.ctx) return;
    this.ramp(this.sfxBus.gain, this.sfxVol, 0.04);
    this.applyMusicMode(false);
  }

  // "Cámara lenta analógica" (forcejeo): la música y el ambiente bajan de tono (hasta -40 %) y de velocidad
  // (hasta -50 %) como una cinta que se frena, y vuelven a la normalidad al soltarla. El planificador
  // (scheduleMusic) acerca `slow` a `slowTarget` poco a poco, así que la transición es continua. Afecta a
  // las notas que se programan desde ese momento (lookahead de 0,15 s) y no crea ningún nodo nuevo.
  setSlowMo(on) {
    this.slowTarget = on ? 1 : 0;
    if (!this.ctx) this.slow = this.slowTarget;
  }

  get pitch() { return 1 - 0.4 * this.slow; }

  play(name, volume = 1, arg) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running' || volume <= 0 || this.sfxVol <= 0) return;
    SOUNDS[name](this, volume, arg);
  }

  // --- Música ---------------------------------------------------------------

  // 'action' (combate) · 'empty' (piso limpio: música cortada y ambiente vacío) · 'menu'.
  // Pasar a 'empty' corta la música en seco con el frenazo de cinta; salir de ahí (piso nuevo
  // o reinicio tras morir) devuelve la música y cierra el ambiente.
  setMusic(mode) {
    if (mode === this.musicMode) return;
    const wasPlaying = this.musicMode !== 'empty';
    this.musicMode = mode;
    if (!this.ctx) return;              // aún no hay gesto del usuario: se aplicará en init()
    if (mode === 'empty') this.resetAmbient();
    this.applyMusicMode(false);
    if (mode === 'empty' && wasPlaying) this.play('tapeStop', 1);
  }

  // Temporizadores del ambiente: a 0 para que el zumbido, el aire y el eco entren enseguida.
  resetAmbient() {
    this.droneUntil = 0;
    this.staticUntil = 0;
    this.echoAt = (this.ctx ? this.ctx.currentTime : 0) + 2.5;
  }

  // Pone los dos buses donde toca según el modo. `instant` = sin rampas (al crear el contexto).
  applyMusicMode(instant) {
    const empty = this.musicMode === 'empty';
    this.ramp(this.musicBus.gain, empty ? 0.0001 : MUSIC_VOLUME * this.musicVol, instant ? 0 : (empty ? CUT_TIME : 0.12));
    this.ramp(this.ambientBus.gain, empty ? AMBIENT_VOLUME * this.musicVol : 0.0001,
      instant ? 0 : (empty ? AMBIENT_FADE : 0.3), empty && !instant ? CUT_TIME * 2 : 0);
  }

  // Rampa de ganancia a prueba de cambios rápidos: cancela lo pendiente y arranca del valor
  // real actual, así reiniciar o cambiar de piso a toda prisa no deja automatizaciones cruzadas.
  ramp(param, value, time, delay = 0) {
    const t = this.ctx.currentTime + delay;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setValueAtTime(Math.max(param.value, 0.0001), this.ctx.currentTime);
    if (time <= 0) param.setValueAtTime(Math.max(value, 0.0001), t);
    else param.exponentialRampToValueAtTime(Math.max(value, 0.0001), t + time);
  }

  // Un único intervalo para toda la partida: llamarlo varias veces no crea duplicados.
  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), TICK_MS);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  // Planificador con "lookahead": programa en el reloj de audio las notas de los próximos
  // LOOKAHEAD segundos, así el ritmo no depende de la precisión de setInterval.
  scheduleMusic() {
    const c = this.ctx;
    // Si la pestaña estuvo en segundo plano, no intentamos "recuperar" las notas perdidas.
    if (this.nextNote < c.currentTime - 0.2) this.nextNote = c.currentTime + 0.05;
    // Acerca la cámara lenta a su objetivo (≈ 0,35 s de ida y vuelta).
    const dtTick = Math.min(0.1, Math.max(0, c.currentTime - this.lastTick));
    this.lastTick = c.currentTime;
    const stepSlow = dtTick * 3;
    this.slow += Math.max(-stepSlow, Math.min(stepSlow, this.slowTarget - this.slow));
    while (this.nextNote < c.currentTime + LOOKAHEAD) {
      // En silencio no se crean nodos: el tiempo avanza pero no se programa nada.
      if (!this.muted && c.state === 'running') {
        if (this.musicMode === 'empty') this.emptyStep(this.step, this.nextNote);
        else if (this.musicMode === 'menu') this.menuStep(this.step, this.nextNote);
        else this.actionStep(this.step, this.nextNote);
      }
      this.nextNote += STEP_TIME / (1 - 0.5 * this.slow);
      this.step = (this.step + 1) % STEPS;
    }
  }

  // Combate: cuatro por el suelo con síncopas, charles a semicorcheas, bajo pulsante sin
  // huecos y arpegio rápido. Todo por `musicBus`, que es lo que se corta al limpiar el piso.
  actionStep(step, t) {
    const bar = step >> 4, s = step & 15;
    const out = this.musicBus;
    if (KICK_STEPS.includes(s)) this.kickDrum(t, s % 4 === 0 ? 1 : 0.65);
    if (s === 4 || s === 12) {                                                      // caja/palmada
      this.noise({ dur: 0.18, gain: 0.45, filter: 'bandpass', freq: 1700, freqTo: 900, q: 0.7, at: t, dest: out });
      this.tone({ type: 'triangle', from: 320, to: 180, dur: 0.1, gain: 0.25, at: t, dest: out });
    }
    // Charles a semicorcheas con acento en los contratiempos; abierto al final del compás.
    this.noise({ dur: s === 14 ? 0.14 : 0.03, gain: s % 2 ? 0.11 : 0.055, filter: 'highpass', freq: 8200, at: t, dest: out });
    if (s === 0 && bar % 2 === 0) this.noise({ dur: 0.5, gain: 0.1, filter: 'highpass', freq: 5200, at: t, dest: out }); // crash
    const pat = BASS_PATTERN[s];
    if (pat) this.bass(ACTION_ROOTS[bar] * pat, t);
    const chord = ACTION_CHORDS[bar];
    this.tone({ type: 'sawtooth', from: chord[ARP_PATTERN[s]] * (ARP_OCTAVE[s] ? 4 : 2),
      dur: 0.08, gain: 0.04, at: t, dest: out });                                   // arpegio
    if (s === 0) this.pad(chord, t, STEP_TIME * 16, 0.03, 1800);
  }

  // Piso limpio: ni percusión ni armonía, solo el edificio. Sub-drone que apenas se mueve,
  // estática y aire, y algún eco metálico lejano. Todo por `ambientBus`.
  emptyStep(step, t) {
    const out = this.ambientBus;
    // Por tiempo, no por compás: el piso puede quedar limpio en cualquier semicorchea y el
    // zumbido tiene que entrar en ese mismo instante, no al principio del siguiente ciclo.
    if (t >= this.droneUntil) {
      this.drone(t, DRONE_TIME);
      this.droneUntil = t + DRONE_TIME;                                     // zumbido sub-grave
    }
    if (t >= this.staticUntil) {
      this.noise({ dur: 2.2, gain: 0.02, filter: 'highpass', freq: 3200, at: t, dest: out });        // estática
      this.noise({ dur: 2.2, gain: 0.035, filter: 'lowpass', freq: 240, freqTo: 130, at: t, dest: out }); // aire
      this.staticUntil = t + 2;
    }
    if (t >= this.echoAt) {
      this.coldEcho(t);
      this.echoAt = t + 4 + Math.random() * 7;
    }
  }

  // Menús y fin de partida: pads lentos y campanas (el tema tranquilo de siempre).
  menuStep(step, t) {
    const bar = step >> 4, s = step & 15;
    const chord = MENU_CHORDS[bar];
    if (s === 0) this.pad(chord, t, STEP_TIME * 16 * 1.8, 0.05, 900);
    if (s % 4 === 0) {
      this.tone({ type: 'sine', from: chord[(s / 4) % chord.length] * 2, dur: 1.2, gain: 0.06, at: t, dest: this.musicBus });
    }
  }

  // Bombo con pegada: chasquido, cuerpo que cae rápido de tono y cola de sub.
  kickDrum(t, v) {
    const out = this.musicBus;
    this.noise({ dur: 0.02, gain: 0.3 * v, filter: 'highpass', freq: 2600, at: t, dest: out });
    this.tone({ type: 'sine', from: 190, to: 38, dur: 0.3, gain: 0.95 * v, at: t, dest: out });
    this.tone({ type: 'sine', from: 62, to: 30, dur: 0.22, gain: 0.45 * v, at: t, dest: out });
  }

  // Zumbido sub-grave del edificio vacío: tres capas casi inmóviles que entran y salen muy
  // despacio. Se renueva cada ciclo con solapamiento para que no se oiga la costura.
  drone(t, dur) {
    const c = this.ctx;
    for (let i = 0; i < DRONE_FREQS.length; i++) {
      const freq = DRONE_FREQS[i];
      const g = c.createGain();
      const peak = [0.3, 0.12, 0.025][i];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = i === 2 ? 700 : 200;
      f.connect(g).connect(this.ambientBus);
      // Dos osciladores con una desafinación mínima: laten muy despacio, suena "frío".
      for (const detune of [-4, 5]) {
        const osc = c.createOscillator();
        osc.type = i === 2 ? 'triangle' : 'sine';
        osc.frequency.value = freq * this.pitch;
        osc.detune.value = detune;
        osc.connect(f);
        osc.start(t);
        osc.stop(t + dur + 0.7);
      }
    }
  }

  // Eco frío: un golpe metálico lejano que rebota por el piso vacío y se apaga.
  coldEcho(t) {
    const base = 760 + Math.random() * 900;
    for (let i = 0; i < 4; i++) {
      this.tone({ type: 'triangle', from: base, to: base * 0.92, dur: 0.5,
        gain: 0.035 * Math.pow(0.55, i), at: t + i * 0.26, dest: this.ambientBus });
    }
  }

  // Bajo grueso y pulsante: dos sierras desafinadas + un sub de seno una octava por debajo,
  // todo por un paso-bajo resonante que se cierra de golpe. Es lo que empuja el combate.
  bass(freq, t) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = 'lowpass';
    f.Q.value = 9;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    f.connect(g).connect(this.musicBus);
    for (const detune of [-11, 12]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * this.pitch, t);
      osc.detune.value = detune;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + 0.19);
    }
    const sub = c.createOscillator();
    const sg = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime((freq / 2) * this.pitch, t);
    sg.gain.setValueAtTime(0.22, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    sub.connect(sg).connect(this.musicBus);
    sub.start(t);
    sub.stop(t + 0.17);
  }

  // Acorde sostenido: dos sierras ligeramente desafinadas por nota, filtradas.
  pad(freqs, t, dur, gain, cutoff) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.6, dur / 3));
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.musicBus);
    for (const freq of freqs) {
      for (const detune of [-7, 7]) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * this.pitch;
        osc.detune.value = detune;
        osc.connect(f);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    }
  }

  // --- Moto ---------------------------------------------------------------------------------------
  // El motor es una VOZ propia, no una primitiva suelta: dura varios segundos, cambia de régimen
  // todo el rato y hay que poder cortarla limpia si el jugador reinicia (R), salta la cinemática o
  // silencia (M). Cadena: sierra + triángulo → saturador (WaveShaper: arma armónicos) → paso-bajo
  // resonante (el cuerpo del sonido; al acelerar se abre) → modulación de amplitud por un LFO
  // rápido (el pistoneo: ~1/4,5 de las revoluciones) → envolvente → `bus` de la voz. Un ruido grave
  // filtrado hace de escape. Los chirridos y clics cuelgan del mismo `bus`, así que todo se para
  // junto con `stopMoto()`. Todas las rampas exponenciales acaban en 0,0001, nunca en 0.

  motoReady() {
    return !!this.ctx && !this.muted && this.sfxVol > 0 && this.ctx.state === 'running';
  }

  // Saturación suave y simétrica (sin DC): redondea la sierra y añade armónicos de ataque.
  saturationCurve() {
    if (!this.satCurve) {
      const n = 1024, k = 3.2;
      this.satCurve = new Float32Array(n);
      for (let i = 0; i < n; i++) this.satCurve[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) / Math.tanh(k);
    }
    return this.satCurve;
  }

  // Programa una curva en un AudioParam: `points` = [[segundos desde t0, valor], ...] con valores > 0
  // y tiempos crecientes. Entre puntos, rampa exponencial (o lineal si `linear`; en ambos casos el valor
  // mínimo es 0,0001, nunca 0).
  motoCurve(param, points, t0, linear = false) {
    param.setValueAtTime(Math.max(points[0][1], 0.0001), t0 + points[0][0]);
    for (let i = 1; i < points.length; i++) {
      const value = Math.max(points[i][1], 0.0001);
      if (linear) param.linearRampToValueAtTime(value, t0 + points[i][0]);
      else param.exponentialRampToValueAtTime(value, t0 + points[i][0]);
    }
  }

  // Crea la voz de t0 a t0 + dur (en silencio: la envolvente la programa quien la llama). Cuando
  // acaba la última fuente (`onended`) se desconecta toda la cadena.
  motoVoice(t0, dur) {
    const c = this.ctx;
    const [bus, out, am, mix, lfoDepth, exhaust] = [1, 2, 3, 4, 5, 6].map(() => c.createGain());
    const filter = c.createBiquadFilter();
    const exhaustFilter = c.createBiquadFilter();
    const shaper = c.createWaveShaper();
    const saw = c.createOscillator(), tri = c.createOscillator(), lfo = c.createOscillator();
    const noise = c.createBufferSource();
    bus.gain.value = 1;
    out.gain.value = 0.0001;
    am.gain.value = 0.6;         // el LFO la mueve ±lfoDepth alrededor de 0,6 (nunca llega a 0)
    mix.gain.value = 0.5;
    lfoDepth.gain.value = 0.4;
    exhaust.gain.value = 0.0001;
    filter.type = 'lowpass';
    filter.Q.value = 7;
    exhaustFilter.type = 'lowpass';
    exhaustFilter.frequency.value = 320;
    shaper.curve = this.saturationCurve();
    shaper.oversample = '2x';
    saw.type = 'sawtooth';
    tri.type = 'triangle';
    tri.detune.value = 9;
    lfo.type = 'sine';
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    saw.connect(mix);
    tri.connect(mix);
    mix.connect(shaper);
    shaper.connect(filter);
    filter.connect(am);
    noise.connect(exhaustFilter);
    exhaustFilter.connect(exhaust);
    exhaust.connect(am);
    lfo.connect(lfoDepth);
    lfoDepth.connect(am.gain);
    am.connect(out);
    out.connect(bus);
    bus.connect(this.sfxBus);

    const sources = [saw, tri, lfo, noise];
    const nodes = [bus, out, am, mix, lfoDepth, exhaust, filter, exhaustFilter, shaper];
    const voice = { bus, out, filter, saw, tri, lfo, lfoDepth, exhaust, sources, fx: [] };
    let pending = sources.length;
    for (const s of sources) {
      s.onended = () => {
        if (--pending > 0) return;
        for (const n of [...sources, ...nodes]) n.disconnect();
        if (this.moto === voice) this.moto = null;
      };
      s.start(t0, s === noise ? Math.random() * 0.5 : 0);
      s.stop(t0 + dur);
    }
    this.moto = voice;
    return voice;
  }

  // Frecuencia de giro (Hz) en las tres fuentes: sierra y triángulo siguen la nota y el LFO del
  // pistoneo va a una fracción de ella.
  motoPitch(voice, points, t0) {
    this.motoCurve(voice.saw.frequency, points, t0);
    this.motoCurve(voice.tri.frequency, points, t0);
    this.motoCurve(voice.lfo.frequency, points.map(([t, hz]) => [t, Math.max(hz * 0.22, 4)]), t0);
  }

  // LLEGADA: la moto viene por la calle frenando (las revoluciones siguen su velocidad en pantalla,
  // (1 - t/ride)²: de ~150 Hz a ~40), chirría un instante sobre el asfalto, queda al ralentí (~42 Hz)
  // y se apaga con un tosido cuando el jugador baja. `ride` y `dismount` son los de la cinemática.
  playMotoArrival({ ride = 1.9, dismount = 0.55 } = {}) {
    if (!this.motoReady()) return;
    this.stopMoto(0.04);
    const t0 = this.ctx.currentTime + 0.02, total = ride + dismount;
    const v = this.motoVoice(t0, total + 0.08);
    const hz = [];
    for (let i = 0; i <= 8; i++) hz.push([(ride * i) / 8, 40 + 110 * Math.pow(1 - i / 8, 2)]);
    hz.push([ride + 0.28, 42], [ride + 0.48, 26]); // ralentí un instante y se apaga: cae de revoluciones
    this.motoPitch(v, hz, t0);
    this.motoCurve(v.filter.frequency, [[0, 950], [ride, 420], [ride + 0.28, 380], [total, 180]], t0);
    this.motoCurve(v.out.gain, [[0, 0.0001], [0.4, 0.34], [ride * 0.6, 0.34], [ride, 0.2], [ride + 0.28, 0.2], [total - 0.02, 0.0001]], t0);
    this.motoCurve(v.lfoDepth.gain, [[0, 0.3], [ride, 0.5], [total, 0.5]], t0);
    this.motoCurve(v.exhaust.gain, [[0, 0.0001], [0.4, 0.1], [ride, 0.07], [total - 0.02, 0.0001]], t0);
    // Frenada: chirrido de la goma sobre el asfalto cuando ya va despacio (dos capas solapadas: una
    // primitiva decae enseguida y así se sostiene ~0,45 s) y un raspado seco al clavar la rueda.
    const brake = t0 + ride * 0.6;
    v.fx.push(this.noise({ dur: 0.36, gain: 0.32, filter: 'bandpass', freq: 3400, freqTo: 1900, q: 9, at: brake, dest: v.bus }));
    v.fx.push(this.noise({ dur: 0.3, gain: 0.2, filter: 'bandpass', freq: 3000, freqTo: 1700, q: 9, at: brake + 0.14, dest: v.bus }));
    v.fx.push(this.tone({ type: 'triangle', from: 2900, to: 1500, dur: 0.36, gain: 0.07, at: brake, dest: v.bus }));
    v.fx.push(this.tone({ type: 'triangle', from: 2500, to: 1400, dur: 0.3, gain: 0.045, at: brake + 0.14, dest: v.bus }));
    v.fx.push(this.noise({ dur: 0.05, gain: 0.16, filter: 'highpass', freq: 1500, at: brake + 0.3, dest: v.bus }));
    v.fx.push(this.tone({ type: 'sine', from: 70, to: 30, dur: 0.14, gain: 0.25, at: t0 + ride + 0.3, dest: v.bus })); // el tosido
  }

  // FUGA: el jugador se sube (`board`): clic de contacto, motor de arranque y el motor prende y queda
  // al ralentí; la moto arranca (`ride`): acelerón agresivo —las revoluciones suben de golpe a ~160 Hz y
  // el paso-bajo se abre— con dos cambios de marcha; y mientras sale de la pantalla el volumen cae, el
  // filtro se cierra y el tono baja (efecto Doppler de alejamiento). `tail` deja que el rastro cubra el
  // fundido a los resultados: así no se corta de golpe antes de que se aleje.
  playMotoDeparture({ board = 0.4, ride = 1.35, tail = 0.3 } = {}) {
    if (!this.motoReady()) return;
    this.stopMoto(0.04);
    const t0 = this.ctx.currentTime + 0.02;
    const L = Math.max(board, 0.42), end = L + ride, total = end + tail; // L = momento en que arranca
    const v = this.motoVoice(t0, total + 0.08);
    // 1) Ignición: clic seco de contacto, golpe del arranque y el motor de arranque.
    v.fx.push(this.noise({ dur: 0.02, gain: 0.4, filter: 'highpass', freq: 1800, at: t0, dest: v.bus }));
    v.fx.push(this.tone({ type: 'square', from: 150, to: 70, dur: 0.06, gain: 0.22, at: t0, dest: v.bus }));
    v.fx.push(this.tone({ type: 'sawtooth', from: 55, to: 105, dur: 0.2, gain: 0.08, at: t0 + 0.05, dest: v.bus }));
    // 2) Ralentí que sube de golpe (con un golpe de gas al subirse) y acelerón con dos cambios de marcha.
    this.motoPitch(v, [[0, 30], [0.2, 34], [0.28, 44], [0.32, 98], [0.38, 58], [L, 62],
      [L + 0.22, 160], [L + 0.32, 118], [L + 0.62, 165], [L + 0.72, 126], [end, 160], [total, 140]], t0);
    this.motoCurve(v.filter.frequency, [[0, 260], [0.3, 320], [L, 380], [L + 0.22, 2600], [L + 0.32, 1800],
      [L + 0.62, 2800], [L + 0.72, 1900], [end - 0.2, 1400], [end, 700], [total, 220]], t0);
    // 3) El volumen cae al alejarse y el tono baja ~260 cents (Doppler).
    this.motoCurve(v.out.gain, [[0, 0.0001], [0.27, 0.2], [L, 0.26], [L + 0.22, 0.5], [L + 0.62, 0.52],
      [end - 0.35, 0.4], [end, 0.12], [total - 0.01, 0.0001]], t0);
    this.motoCurve(v.lfoDepth.gain, [[0, 0.5], [L + 0.22, 0.2], [end, 0.12], [total, 0.1]], t0);
    this.motoCurve(v.exhaust.gain, [[0, 0.0001], [0.27, 0.08], [L + 0.22, 0.16], [end, 0.05], [total - 0.01, 0.0001]], t0);
    for (const osc of [v.saw, v.tri]) {
      const base = osc === v.tri ? 9 : 0;
      osc.detune.setValueAtTime(base, t0 + L + 0.7);
      osc.detune.linearRampToValueAtTime(base - 260, t0 + total);
    }
  }

  // Corta la voz de la moto y todo lo que cuelga de su bus: reinicio con R, cinemática saltada, nueva
  // llegada o silencio con M. Cae en `fade` s por una rampa exponencial a 0,0001, no de golpe.
  stopMoto(fade = 0.06) {
    const v = this.moto;
    if (!v || !this.ctx) return;
    this.moto = null;
    const t = this.ctx.currentTime;
    v.bus.gain.cancelScheduledValues(t);
    v.bus.gain.setValueAtTime(Math.max(v.bus.gain.value, 0.0001), t);
    v.bus.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    // Las fuentes del motor paran con el fundido; los sonidos puntuales que aún no han empezado
    // (el chirrido, el tosido...) arrancan y paran a la vez en su hora, sin sonar, y se limpian solos.
    for (const s of [...v.sources, ...v.fx]) {
      try { s.stop(Math.max(t + fade + 0.02, s.startAt ?? 0)); } catch { /* ya había acabado */ }
    }
  }

  // --- Primitivas -----------------------------------------------------------
  // `at` = instante absoluto en el reloj de audio (música); si no, ahora + delay.

  tone({ type = 'sine', from, to = from, dur, gain = 0.3, delay = 0, at, dest }) {
    const c = this.ctx, t = at ?? c.currentTime + delay;
    if (dest && (dest === this.musicBus || dest === this.ambientBus) && this.slow > 0) { from *= this.pitch; to *= this.pitch; }
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.sfxBus);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    osc.startAt = t;
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return osc;
  }

  noise({ dur, gain = 0.3, filter = 'lowpass', freq = 1000, freqTo = freq, q = 1, delay = 0, at, dest }) {
    const c = this.ctx, t = at ?? c.currentTime + delay;
    if (dest && (dest === this.musicBus || dest === this.ambientBus) && this.slow > 0) { freq *= this.pitch; freqTo *= this.pitch; }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.sfxBus);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.startAt = t;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    return src;
  }
}
