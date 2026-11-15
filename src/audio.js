// Audio 100% procedimental con Web Audio (sin archivos): efectos de sonido + música synthwave.
// El AudioContext solo puede arrancar tras un gesto del usuario, así que se crea en el primer clic/tecla.
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
    s.tone({ type: 'sawtooth', from: 300, to: 50, dur: 0.7, gain: 0.25 * v });
    s.noise({ dur: 0.4, gain: 0.3 * v, filter: 'lowpass', freq: 600 });
  },
  // Blip de combo: sube de tono con el multiplicador.
  combo(s, v, level = 1) {
    const f = 520 * Math.pow(2, Math.min(level - 1, 12) / 12);
    s.tone({ type: 'square', from: f, to: f * 1.5, dur: 0.08, gain: 0.08 * v });
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
    this.musicMode = 'action';  // 'action' | 'empty' | 'menu'
    this.musicTimer = null;
    this.droneUntil = 0;
    this.staticUntil = 0;
    this.echoAt = 0;
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
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = MUSIC_VOLUME;
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
  }

  play(name, volume = 1, arg) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running' || volume <= 0) return;
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
    this.ramp(this.musicBus.gain, empty ? 0.0001 : MUSIC_VOLUME, instant ? 0 : (empty ? CUT_TIME : 0.12));
    this.ramp(this.ambientBus.gain, empty ? AMBIENT_VOLUME : 0.0001,
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
    while (this.nextNote < c.currentTime + LOOKAHEAD) {
      // En silencio no se crean nodos: el tiempo avanza pero no se programa nada.
      if (!this.muted && c.state === 'running') {
        if (this.musicMode === 'empty') this.emptyStep(this.step, this.nextNote);
        else if (this.musicMode === 'menu') this.menuStep(this.step, this.nextNote);
        else this.actionStep(this.step, this.nextNote);
      }
      this.nextNote += STEP_TIME;
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
        osc.frequency.value = freq;
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
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.value = detune;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + 0.19);
    }
    const sub = c.createOscillator();
    const sg = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq / 2, t);
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
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(f);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    }
  }

  // --- Primitivas -----------------------------------------------------------
  // `at` = instante absoluto en el reloj de audio (música); si no, ahora + delay.

  tone({ type = 'sine', from, to = from, dur, gain = 0.3, delay = 0, at, dest }) {
    const c = this.ctx, t = at ?? c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur, gain = 0.3, filter = 'lowpass', freq = 1000, freqTo = freq, q = 1, delay = 0, at, dest }) {
    const c = this.ctx, t = at ?? c.currentTime + delay;
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
    src.connect(f).connect(g).connect(dest || this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
