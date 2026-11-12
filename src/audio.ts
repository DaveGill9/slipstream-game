// Game audio: background music (a looped CC0 track, see assets/music/CREDITS.md)
// plus sound effects synthesised with the Web Audio API, so there are no
// effect files to load.
const musicUrl = new URL(
  "../assets/music/pixel_sprinter_loop.ogg",
  import.meta.url,
).href;
const storageKey = "slipstream-audio";
export interface AudioSettings {
  music: number;
  sfx: number;
  muted: boolean;
}
export interface DriveState {
  /** Speed as a fraction of top speed. */
  speed: number;
  throttle: number;
  skid: boolean;
  draft: number;
}
type ToneOptions = {
  type?: OscillatorType;
  volume?: number;
  delay?: number;
  slideTo?: number;
};
export class GameAudio {
  settings: AudioSettings = { music: 0.5, sfx: 0.7, muted: false };
  private ctx?: AudioContext;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private engine!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private lastBump = 0;
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      for (const key of ["music", "sfx"] as const)
        if (typeof saved[key] === "number")
          this.settings[key] = Math.max(0, Math.min(1, saved[key]));
      if (typeof saved.muted === "boolean") this.settings.muted = saved.muted;
    } catch {
      /* Storage may be disabled. */
    }
    // Browsers only allow sound after a click or key press.
    for (const type of ["pointerdown", "keydown"])
      addEventListener(type, () => this.unlock(), { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void this.ctx?.suspend();
      else void this.ctx?.resume();
    });
  }
  set(change: Partial<AudioSettings>) {
    Object.assign(this.settings, change);
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.settings));
    } catch {
      /* Settings still apply for this visit. */
    }
    this.apply();
  }
  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.02);
    // Squared so the slider feels even to the ear.
    this.musicGain.gain.setTargetAtTime(
      this.settings.music ** 2 * 0.7,
      t,
      0.02,
    );
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx ** 2, t, 0.02);
  }
  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden)
        void this.ctx.resume();
      return;
    }
    const Context =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return;
    const ctx = (this.ctx = new Context());
    const gain = (value: number, to: AudioNode) => {
      const node = ctx.createGain();
      node.gain.value = value;
      node.connect(to);
      return node;
    };
    this.master = gain(1, ctx.destination);
    this.musicGain = gain(0, this.master);
    this.sfxGain = gain(0, this.master);
    this.apply();
    // Engine: a saw with a square an octave below, through a low-pass that
    // opens up with speed.
    this.engineGain = gain(0, this.sfxGain);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 300;
    this.engineFilter.connect(this.engineGain);
    this.engine = ctx.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 70;
    this.engine.connect(this.engineFilter);
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "square";
    this.engineSub.frequency.value = 35;
    this.engineSub.connect(gain(0.5, this.engineFilter));
    this.engine.start();
    this.engineSub.start();
    // One looping noise source feeds the tyre squeal and the wind.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const band = (frequency: number, q: number, to: AudioNode) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = q;
      filter.connect(to);
      hiss.connect(filter);
    };
    this.skidGain = gain(0, this.sfxGain);
    this.windGain = gain(0, this.sfxGain);
    band(2400, 4, this.skidGain);
    band(700, 0.6, this.windGain);
    hiss.start();
    fetch(musicUrl)
      .then((response) => {
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        const music = ctx.createBufferSource();
        music.buffer = buffer;
        music.loop = true;
        music.connect(this.musicGain);
        music.start();
      })
      .catch((error) => console.warn("Music could not be loaded:", error));
  }
  private tone(
    frequency: number,
    duration: number,
    { type = "square", volume = 0.15, delay = 0, slideTo }: ToneOptions = {},
  ) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator(),
      env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    if (slideTo)
      osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(volume, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(this.sfxGain);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }
  click() {
    this.tone(700, 0.06, { volume: 0.1 });
  }
  beep() {
    this.tone(440, 0.18);
  }
  go() {
    this.tone(880, 0.55);
    this.tone(1320, 0.55, { volume: 0.06 });
  }
  lap(best = false) {
    const notes = best ? [784, 988, 1175, 1568] : [784, 1175];
    notes.forEach((note, i) =>
      this.tone(note, 0.16, {
        delay: i * 0.09,
        type: "triangle",
        volume: 0.25,
      }),
    );
  }
  finish() {
    [523, 659, 784, 1047, 784, 1047].forEach((note, i) =>
      this.tone(note, i === 5 ? 0.6 : 0.14, { delay: i * 0.12, volume: 0.14 }),
    );
  }
  /** Whoosh when a boost starts. */
  boost() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const at = ctx.currentTime;
    const rush = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      env = ctx.createGain();
    rush.buffer = this.noise;
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(500, at);
    filter.frequency.exponentialRampToValueAtTime(2600, at + 0.45);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.45, at + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    rush.connect(filter).connect(env).connect(this.sfxGain);
    rush.start(at, Math.random());
    rush.stop(at + 0.65);
    this.tone(170, 0.4, { type: "sawtooth", volume: 0.1, slideTo: 520 });
  }
  /** A ping each time a drift boost charges up a level. */
  charge(level: number) {
    if (level === 1) this.tone(880, 0.12, { type: "triangle", volume: 0.18 });
    else {
      this.tone(1175, 0.1, { type: "triangle", volume: 0.18 });
      this.tone(1568, 0.16, { type: "triangle", volume: 0.18, delay: 0.07 });
    }
  }
  reset() {
    this.tone(420, 0.35, { slideTo: 110, type: "sawtooth", volume: 0.12 });
  }
  /** A knock against a wall or another kart; strength is 0 to 1. */
  bump(strength: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const level = Math.min(1, strength);
    if (level < 0.08 || ctx.currentTime - this.lastBump < 0.12) return;
    this.lastBump = ctx.currentTime;
    const at = ctx.currentTime;
    const crunch = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      env = ctx.createGain();
    crunch.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = 500 + level * 1500;
    env.gain.setValueAtTime(0.15 + level * 0.5, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    crunch.connect(filter).connect(env).connect(this.sfxGain);
    crunch.start(at, Math.random());
    crunch.stop(at + 0.2);
    this.tone(95, 0.14, {
      type: "sine",
      volume: 0.2 + level * 0.4,
      slideTo: 45,
    });
  }
  /** Call every frame; pass null whenever the player is not on track. */
  drive(state: DriveState | null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const ratio = Math.max(0, Math.min(1.15, state?.speed ?? 0));
    // Four pretend gears: the pitch climbs, drops and climbs again.
    const gear = Math.min(3, Math.floor(ratio * 4)),
      rev = ratio * 4 - gear;
    const pitch = 62 + gear * 22 + rev * 80;
    this.engine.frequency.setTargetAtTime(pitch, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(pitch / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(350 + ratio * 1700, t, 0.05);
    this.engineGain.gain.setTargetAtTime(
      state ? 0.05 + 0.06 * state.throttle + 0.03 * ratio : 0,
      t,
      0.06,
    );
    this.skidGain.gain.setTargetAtTime(
      state?.skid ? 0.1 + 0.12 * ratio : 0,
      t,
      0.04,
    );
    this.windGain.gain.setTargetAtTime(
      state ? 0.03 * ratio + 0.12 * state.draft : 0,
      t,
      0.15,
    );
  }
}
