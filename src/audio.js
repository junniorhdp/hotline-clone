// Audio 100% procedimental con Web Audio (sin archivos): efectos de sonido + música synthwave.
// El AudioContext solo puede arrancar tras un gesto del usuario, así que se crea en el primer clic/tecla.
const MASTER_VOLUME = 0.4;
const MUSIC_VOLUME = 0.55;   // relativo al master; M silencia ambos

// --- Música -----------------------------------------------------------------
const BPM = 104;
const STEP_TIME = 60 / BPM / 4;   // duración de una semicorchea
const STEPS = 64;                 // 4 compases de 16 semicorcheas
const LOOKAHEAD = 0.15;           // s de música que se programan por adelantado
const TICK_MS = 25;               // cada cuánto revisa el planificador

// Modo acción: Am - F - C - G
const ACTION_ROOTS = [55.0, 43.65, 65.41, 49.0];
const ACTION_CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
];
const BASS_PATTERN = [1, 0, 1, 2, 1, 0, 2, 1, 1, 0, 1, 2, 1, 2, 1, 2]; // 0 silencio · 1 raíz · 2 octava
// Modo "Stage Clear": Fmaj7 - Em7 - Dm7 - Cmaj7, pads lentos y campanas
const CLEAR_CHORDS = [
  [174.61, 220.0, 261.63, 329.63],
  [164.81, 196.0, 246.94, 293.66],
  [146.83, 174.61, 220.0, 261.63],
  [130.81, 164.81, 196.0, 246.94],
];

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
  // Fanfarria corta al despejar el piso.
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
    this.musicMode = 'action';  // 'action' | 'clear'
    this.musicTimer = null;
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

  setMusic(mode) {
    this.musicMode = mode;
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
        if (this.musicMode === 'clear') this.clearStep(this.step, this.nextNote);
        else this.actionStep(this.step, this.nextNote);
      }
      this.nextNote += STEP_TIME;
      this.step = (this.step + 1) % STEPS;
    }
  }

  actionStep(step, t) {
    const bar = step >> 4, s = step & 15;
    const out = this.musicBus;
    if (s % 4 === 0) this.tone({ type: 'sine', from: 150, to: 42, dur: 0.28, gain: 0.9, at: t, dest: out });           // bombo
    if (s === 4 || s === 12) this.noise({ dur: 0.16, gain: 0.4, filter: 'bandpass', freq: 1500, q: 0.7, at: t, dest: out }); // palmada
    if (s % 2 === 1) this.noise({ dur: s === 15 ? 0.12 : 0.035, gain: 0.1, filter: 'highpass', freq: 8000, at: t, dest: out }); // charles
    const pat = BASS_PATTERN[s];
    if (pat) this.bass(ACTION_ROOTS[bar] * pat, t);
    if (s % 2 === 0) {
      const chord = ACTION_CHORDS[bar];
      this.tone({ type: 'triangle', from: chord[(s / 2) % 3] * 2, dur: 0.14, gain: 0.05, at: t, dest: out }); // arpegio
    }
    if (s === 0) this.pad(ACTION_CHORDS[bar], t, STEP_TIME * 16, 0.025, 1400);
  }

  clearStep(step, t) {
    const bar = step >> 4, s = step & 15;
    const chord = CLEAR_CHORDS[bar];
    if (s === 0) this.pad(chord, t, STEP_TIME * 16 * 1.25, 0.05, 900);
    if (s % 4 === 0) {
      this.tone({ type: 'sine', from: chord[(s / 4) % chord.length] * 2, dur: 1.2, gain: 0.06, at: t, dest: this.musicBus }); // campana
    }
  }

  // Bajo de sierra con filtro que se cierra: el "pulso" típico del synthwave.
  bass(freq, t) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(f).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.22);
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
