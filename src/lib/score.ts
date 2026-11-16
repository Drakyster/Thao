/**
 * The film's score, played by the browser itself (Web Audio): a soft electric
 * piano over a warm pad, in D major at 66 BPM, and a few music-box bells for
 * the story's moments. Nothing is fetched and nothing is licensed: every note
 * is synthesised live, and it stays consonant by construction (every note
 * comes from the four chords below).
 *
 * `Score` builds the music on any BaseAudioContext and takes every time as an
 * argument, so the same code plays live (`Live`, at the end of this file) and
 * renders offline (OfflineAudioContext) to check its levels.
 */
import type { Cue } from '../film/sound'
import { save } from './storage'

/* ───────────── the music ───────────── */

const BPM = 66
/** one eighth note (s) */
const EIGHTH = 30 / BPM
const BAR = EIGHTH * 8
/** a light swing (54%): each offbeat eighth lands this much late */
const LATE = (0.54 - 0.5) * 2 * EIGHTH
/** two bars per chord */
const STEPS = 16
const CHORD_S = STEPS * EIGHTH

/** Dmaj9 | Bm11 | Gmaj9 | Asus2, two bars each: an 8-bar loop of about 29 s (MIDI notes) */
const CHORDS = [
  { pad: [50, 57, 61, 64, 66], arp: [62, 66, 69, 73, 76] },
  { pad: [47, 54, 57, 62, 64], arp: [59, 62, 66, 69, 76] },
  { pad: [43, 50, 54, 57, 59], arp: [55, 59, 62, 66, 69] },
  { pad: [45, 52, 57, 59, 64], arp: [57, 64, 69, 71, 76] },
]

/** the keys over a chord's 16 eighths, as indexes into its `arp` notes (-1: a rest) */
const PATTERN = [0, 2, 4, 3, 1, 3, 2, 4, 0, 2, 4, 3, 2, 1, -1, -1]
/** how hard each eighth is played: beat 1 leans in, beat 3 a little, the rest stay light */
const ACCENT = [0.75, 0.42, 0.5, 0.42, 0.6, 0.42, 0.5, 0.42, 0.7, 0.42, 0.5, 0.42, 0.6, 0.42, 0.5, 0.42]

/** every note of each chord between D5 and A6: the bells that sparkle over the credits */
const SPARKLE = CHORDS.map(({ pad, arp }) => {
  const classes = new Set([...pad, ...arp].map((m) => m % 12))
  const notes: number[] = []
  for (let m = 74; m <= 93; m++) if (classes.has(m % 12)) notes.push(m)
  return notes
})

/** how loud each part plays (0..1), and how */
type Mood = {
  pad: number
  keys: number
  /** the keys only touch each chord's two downbeats */
  sparse?: boolean
  /** the pad's lowpass (Hz) */
  cutoff?: number
  /** now and then a bell (one bar in four) */
  sparkle?: boolean
}

const MOODS: Record<string, Mood> = {
  lights: { pad: 0.8, keys: 0.6 },
  sofas: { pad: 0.7, keys: 0.7 },
  week: { pad: 0.6, keys: 0.55 },
  friday: { pad: 0.75, keys: 0.65 },
  // the plane: darker and thinner, a few notes in the dark
  plane: { pad: 0.5, keys: 0.25, sparse: true, cutoff: 700 },
  glued: { pad: 0.7, keys: 0.6 },
  // the same light arrives cold: a breath of pad until the bulb is lit
  light: { pad: 0.12, keys: 0 },
  credits: { pad: 0.75, keys: 0.75, sparkle: true },
}
const SILENCE: Mood = { pad: 0, keys: 0 }
/** the opening when she comes back to it (Watch again, or Back): a quiet pad until the bulb blooms */
const AGAIN: Mood = { pad: 0.3, keys: 0 }

/** the scene each moment belongs to: a cue from any other scene is stale and plays nothing */
const CUE_SCENE: Record<Cue, string> = {
  bloom: 'lights',
  match: 'sofas',
  bulb: 'week',
  found: 'friday',
  cried: 'plane',
  clear: 'plane',
  leave: 'glued',
  lit: 'light',
  cut: 'light',
  card: 'light',
  poster: 'credits',
}

/* ───────────── the sound ───────────── */

/** the scheduler looks this far ahead (s) */
const LOOKAHEAD = 0.2
/** calibrates the whole mix: a full mood sits around -24 dBFS RMS (checked offline) */
const TRIM = 1.5
/** one pad voice (each of its saws plays at full level into it) */
const PAD_GAIN = 0.018
const PAD_ATTACK = 2.5
const PAD_RELEASE = 3.5
const PAD_CUTOFF = 1100
/** the two saws of a pad note sit apart in the stereo field (on AirPods the pad surrounds her) */
const PAD_SPREAD = 0.3
/** the new chord's pad starts this early, so it is there when the keys play it */
const PAD_LEAD = 0.25
const KEYS_DECAY = 3.2
const BELL_DECAY = 2.6
/** voice caps: the scheduler never piles up more than this */
const MAX_KEYS = 14
const MAX_BELLS = 8
/**
 * Web Audio reads a lowpass's Q in dB. The pad's 0.4 is a flat knee with the
 * barest lift (a traditional Q of 0.4 would be 8 dB down at 1100 Hz: measured,
 * the pad sank 12 dB under the keys). -3 dB is a flat Butterworth.
 */
const Q_PAD = 0.4
const Q_FLAT = -3

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** small and seeded: the same humanising every time, so an offline render is the score she hears */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** moves a param toward `value` from wherever it is at `at`: continuous, so never a click */
function glide(p: AudioParam, value: number, at: number, tc: number) {
  p.cancelScheduledValues(at)
  p.setTargetAtTime(value, at, tc)
}

/** connects a chain one by one (an older Safari's connect() returns nothing to chain on) */
function chain(...nodes: (AudioNode | null)[]) {
  const live = nodes.filter((n): n is AudioNode => n != null)
  for (let k = 1; k < live.length; k++) live[k - 1].connect(live[k])
}

/**
 * The room: 2.6 s of noise falling off as exp(-t/0.55) after 15 ms of
 * pre-delay, darker as it dies (a one-pole lowpass closing from about 5 kHz
 * to 1.5 kHz). Scaled so its lows pass at unity (the energy of the white noise
 * before the lowpass): the sends alone set how much room there is.
 */
function room(ctx: BaseAudioContext, rand: () => number) {
  const rate = ctx.sampleRate
  const length = Math.round(2.6 * rate)
  const pre = Math.round(0.015 * rate)
  const fall = Math.exp(-1 / (0.55 * rate))
  const tail = Math.round(0.06 * rate)
  const ir = ctx.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c)
    let env = 1
    let y = 0
    let a = 0
    let energy = 0
    for (let i = pre; i < length; i++) {
      const k = i - pre
      if (k % 256 === 0) {
        const hzNow = 1500 + 3500 * Math.exp(-k / rate / 0.7)
        a = 1 - Math.exp((-2 * Math.PI * hzNow) / rate)
      }
      y += a * (rand() * 2 - 1 - y)
      // the last 60 ms fade to nothing, so the tail never stops on a step
      const end = length - i < tail ? (length - i) / tail : 1
      data[i] = y * env * end
      // uniform noise in [-1, 1] has a variance of 1/3
      energy += (env * env) / 3
      env *= fall
    }
    const k = 1 / Math.sqrt(energy)
    for (let i = pre; i < length; i++) data[i] *= k
  }
  return ir
}

type Chord = { env: GainNode[]; osc: OscillatorNode[]; end: number }
type KeysMode = { at: number; on: boolean; sparse: boolean }
type BellOpts = { decay?: number; index?: number }
const KEYS_OFF: KeysMode = { at: -Infinity, on: false, sparse: false }

export class Score {
  readonly ctx: BaseAudioContext
  /** the end of the chain (after the master compressor) */
  readonly out: AudioNode
  private readonly rand: () => number
  private readonly fader: GainNode
  private readonly muter: GainNode
  private readonly padIn: BiquadFilterNode
  private readonly padSides: [AudioNode, AudioNode]
  private readonly padBus: GainNode
  private readonly keysIn: AudioNode
  private readonly keysBus: GainNode
  private readonly bellsIn: AudioNode
  private readonly lfo: OscillatorNode
  /** a cosine: the keys' modulator (see key()) */
  private readonly cos: PeriodicWave
  private readonly verb: ConvolverNode
  private readonly seed: number

  private sceneId = ''
  private mood: Mood = SILENCE
  private running = false
  private t0 = 0
  private step = 0
  private chordK = -1
  private chords: Chord[] = []
  private keysModes: KeysMode[] = []
  private keyEnds: number[] = []
  private bellEnds: number[] = []

  /** `roomLater`: the room's impulse is left for fillRoom() (Live builds it just after her gesture, not in it) */
  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination, { seed = 7, roomLater = false } = {}) {
    this.ctx = ctx
    this.seed = seed
    this.rand = mulberry32(seed)
    const gain = (v: number) => {
      const g = ctx.createGain()
      g.gain.value = v
      return g
    }
    const filter = (type: BiquadFilterType, f: number, q: number) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = f
      b.Q.value = q
      return b
    }

    // master: the buses → a highpass (nothing under 28 Hz) → the fader (the cut, the poster's rest) → mute → compressor
    const mix = gain(TRIM)
    this.fader = gain(1)
    this.muter = gain(1)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.02
    comp.release.value = 0.3
    chain(mix, filter('highpass', 28, Q_FLAT), this.fader, this.muter, comp, destination)
    this.out = comp

    // one room for everything, built once
    const verb = ctx.createConvolver()
    verb.normalize = false
    this.verb = verb
    if (!roomLater) this.fillRoom()
    chain(verb, gain(0.8), mix)

    // each bus feeds the mix and, after its own fader, the room (a part that fades takes its echo with it)
    const bus = (input: AudioNode, level: number, send: number) => {
      const g = gain(level)
      chain(input, g, mix)
      chain(g, gain(send), verb)
      return g
    }

    // the pad: one lowpass breathing slowly (0.05 Hz, ±250 Hz), fed from a little left and a little right
    this.padIn = filter('lowpass', PAD_CUTOFF, Q_PAD)
    this.padBus = bus(this.padIn, 0, 0.25)
    const side = (x: number) => {
      const p = this.pan(x)
      p?.connect(this.padIn)
      return p ?? this.padIn
    }
    this.padSides = [side(-PAD_SPREAD), side(PAD_SPREAD)]
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 0.05
    const depth = gain(250)
    this.lfo.connect(depth)
    depth.connect(this.padIn.frequency)
    this.lfo.start()

    // the keys: a lowpass at 2600 Hz, and a highpass at 80 Hz that takes out what is left of the
    // FM's offset at each note (an octave and more under the lowest note, G3)
    const keysLp = filter('lowpass', 2600, Q_FLAT)
    const keysHp = filter('highpass', 80, Q_FLAT)
    keysLp.connect(keysHp)
    this.keysIn = keysLp
    this.keysBus = bus(keysHp, 0, 0.32)

    const bellsLp = filter('lowpass', 5000, Q_FLAT)
    this.bellsIn = bellsLp
    bus(bellsLp, 1, 0.5)

    this.cos = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]))
  }

  /**
   * The room's impulse: about 10 ms of work on a phone (most of it the
   * convolver preparing its kernels), so not inside the gesture that starts the
   * score. Its own random numbers: the music plays the same whenever it lands.
   */
  fillRoom() {
    if (!this.verb.buffer) this.verb.buffer = room(this.ctx, mulberry32(this.seed + 1))
  }

  /** something is playing (or fading in) */
  get audible() {
    return this.running && (this.mood.pad > 0 || this.mood.keys > 0)
  }

  /** a new scene and its mood (`again`: she has been past the opening before) */
  scene(id: string, at: number, again = false) {
    this.sceneId = id
    // a cut or a rest belongs to the scene that made it
    glide(this.fader.gain, 1, at, 0.05)
    const mood = id === 'lights' ? (again ? AGAIN : SILENCE) : MOODS[id]
    if (mood) this.setMood(mood, at)
  }

  /** a moment of the story; `quiet` replays its mood without its bells (the score started late) */
  cue(name: Cue, arg: number | undefined, at: number, quiet = false) {
    if (CUE_SCENE[name] !== this.sceneId) return
    const ring = (m: number, dt: number, vel: number, o?: BellOpts) => {
      if (!quiet) this.bell(m, at + dt, vel, o)
    }
    switch (name) {
      case 'bloom':
        // the pad comes up over about 4 s, the keys on the first downbeat after 3 s
        this.setMood(MOODS.lights, at, { pad: 4 / 3, enter: 3 })
        break
      case 'match':
        // the café's string comes on: D6, F#6, A6
        ;[86, 90, 93].forEach((m, k) => ring(m, 0.02 + k * 0.06, 0.62 - k * 0.07))
        if (!quiet) this.swell(1.2, at, 3)
        break
      case 'bulb': {
        // the week climbs the scale; Thursday, the night he left early, is half as loud
        const day = Math.max(0, Math.min(5, Math.round(arg ?? 0)))
        ring([74, 76, 78, 81, 83, 86][day], 0.02, day === 3 ? 0.33 : 0.66)
        if (day === 5) {
          // Saturday resolves softly: D6 with A6
          ring(86, 1.2, 0.4, { decay: 4 })
          ring(93, 1.2, 0.32, { decay: 4 })
        }
        break
      }
      case 'found':
        ring(81, 0.02, 0.7)
        ring(86, 0.26, 0.64)
        break
      case 'cried':
        // one low, soft bell with a long tail
        ring(78, 0.02, 0.55, { decay: 5.5, index: 1.2 })
        break
      case 'clear':
        this.setMood({ pad: 0.65, keys: 0.45 }, at, { pad: 1.2 })
        break
      case 'leave':
        // the café goes dark, then one bell holds for the last light
        this.setMood({ pad: 0.15, keys: 0 }, at, { pad: 1.4 / 3, keys: 1.2 / 3 })
        ring(81, 1.15, 0.6, { decay: 6, index: 1.4 })
        break
      case 'lit':
        this.setMood({ pad: 0.8, keys: 0.55 }, at, { pad: 2.5 / 3, enter: 0 })
        break
      case 'cut':
        // the cut to black is silent: gone within 30 ms (a 7 ms fade, so not a click)
        glide(this.fader.gain, 0, at, 0.007)
        this.fader.gain.setValueAtTime(0, at + 0.05)
        this.setMood(SILENCE, at + 0.05, { pad: 0.01, keys: 0.01 })
        break
      case 'card':
        glide(this.fader.gain, 1, at, 0.02)
        ring(74, 0.06, 0.62, { decay: 4.5, index: 1.6 })
        this.setMood({ pad: 0.25, keys: 0 }, at, { pad: 1 })
        break
      case 'poster':
        if (!quiet) this.swell(1.15, at, 4)
        break
    }
  }

  /** schedules everything due before `now + LOOKAHEAD` */
  pump(now: number) {
    if (!this.running) return
    const until = now + LOOKAHEAD
    while (this.keysModes.length > 1 && this.keysModes[1].at <= now) this.keysModes.shift()
    // the pad changes chord a moment before the bar line (after a stall, straight to the chord of the moment)
    const k = Math.floor((until + PAD_LEAD - this.t0) / CHORD_S)
    if (k > this.chordK) this.chordOn(k, Math.max(now, this.t0 + k * CHORD_S - PAD_LEAD))
    for (;;) {
      const n = this.step
      const t = this.when(n)
      if (t >= until) break
      this.step = n + 1
      // a stalled main thread drops its late notes rather than playing them in a heap
      if (t >= now - 0.05) this.play(n, t, now)
    }
  }

  /** her mute: the whole score fades in 0.3 s */
  mute(on: boolean, at: number) {
    glide(this.muter.gain, on ? 0 : 1, at, 0.1)
  }

  /** the poster left alone: the score fades out over 6 s (and comes back with a touch) */
  rest(on: boolean, at: number) {
    glide(this.fader.gain, on ? 0 : 1, at, on ? 1.2 : 0.6)
  }

  dispose() {
    this.running = false
    try {
      this.lfo.stop()
      for (const c of this.chords) for (const o of c.osc) o.stop()
    } catch {
      /* already stopped */
    }
    this.out.disconnect()
  }

  /** where the mix stands right now (for tests) */
  levels() {
    return {
      pad: this.padBus.gain.value,
      keys: this.keysBus.gain.value,
      fader: this.fader.gain.value,
      mute: this.muter.gain.value,
      cutoff: this.padIn.frequency.value,
      running: this.running,
      mood: this.mood,
      chords: this.chords.length,
    }
  }

  private when(n: number) {
    return this.t0 + n * EIGHTH + (n % 2 ? LATE : 0)
  }

  private barAfter(t: number) {
    return this.t0 + Math.max(0, Math.ceil((t - this.t0 - 1e-6) / BAR)) * BAR
  }

  private keysAt(t: number) {
    let mode = KEYS_OFF
    for (const m of this.keysModes) if (m.at <= t) mode = m
    return mode
  }

  private setKeys(mode: KeysMode) {
    this.keysModes = this.keysModes.filter((m) => m.at < mode.at)
    this.keysModes.push(mode)
  }

  private start(at: number) {
    this.running = true
    this.t0 = at + 0.05
    this.step = 0
    this.chordK = -1
    this.keysModes = []
  }

  /**
   * The mood's levels, each from wherever it is now. `pad` and `keys` are the
   * time constants of their moves; keys that were off come in on a downbeat,
   * `enter` seconds from now at the earliest.
   */
  private setMood(m: Mood, at: number, o: { pad?: number; keys?: number; enter?: number } = {}) {
    this.mood = m
    const fresh = !this.running
    if (fresh) {
      if (m.pad <= 0 && m.keys <= 0) return
      this.start(at)
    }
    // from silence the pad takes about 4 s to come up
    glide(this.padBus.gain, m.pad, at, o.pad ?? (fresh ? 4 / 3 : 0.8))
    glide(this.padIn.frequency, m.cutoff ?? PAD_CUTOFF, at, 1.2)
    const playing = this.keysAt(at).on
    const tc = o.keys ?? 0.8
    if (m.keys > 0 && playing) {
      this.setKeys({ at, on: true, sparse: !!m.sparse })
      glide(this.keysBus.gain, m.keys, at, tc)
    } else if (m.keys > 0) {
      const from = this.barAfter(at + (o.enter ?? (fresh ? 3 : 0)))
      this.setKeys({ at: from, on: true, sparse: !!m.sparse })
      // nothing sounds on the keys before then: the first note's own attack is the fade-in
      glide(this.keysBus.gain, m.keys, from - 0.03, 0.006)
    } else {
      glide(this.keysBus.gain, 0, at, tc)
      // the notes go on under the fade, then stop
      this.setKeys({ at: playing ? at + tc * 5 : at, on: false, sparse: false })
    }
  }

  private swell(k: number, at: number, hold: number) {
    const base = this.mood.pad
    if (base <= 0) return
    glide(this.padBus.gain, base * k, at, 0.6)
    this.padBus.gain.setTargetAtTime(base, at + hold, 1)
  }

  /** one eighth: the keys' note, and over the credits, now and then a bell */
  private play(n: number, t: number, now: number) {
    const s = n % STEPS
    const chord = Math.floor(n / STEPS) % CHORDS.length
    if (s % 8 === 0 && this.mood.sparkle && this.rand() < 0.25) {
      const notes = SPARKLE[chord]
      const m = notes[Math.floor(this.rand() * notes.length)]
      this.bell(m, this.when(n + 1 + Math.floor(this.rand() * 6)), 0.3 + this.rand() * 0.15)
    }
    const mode = this.keysAt(t)
    const i = PATTERN[s]
    if (!mode.on || i < 0 || (mode.sparse && s % 8 !== 0)) return
    // humanised: ±10 ms, ±10% velocity
    const vel = ACCENT[s] * (1 + (this.rand() * 2 - 1) * 0.1)
    this.key(CHORDS[chord].arp[i], Math.max(now, t + (this.rand() * 2 - 1) * 0.01), vel)
  }

  /** a free voice, or false: a cap reached drops the note (they are soft, it never shows) */
  private reserve(ends: number[], max: number, at: number, end: number) {
    for (let k = ends.length - 1; k >= 0; k--) if (ends[k] <= at) ends.splice(k, 1)
    if (ends.length >= max) return false
    ends.push(end)
    return true
  }

  private pan(x: number) {
    if (typeof this.ctx.createStereoPanner !== 'function') return null
    const p = this.ctx.createStereoPanner()
    p.pan.value = x
    return p
  }

  /** the pad: two saws ±7 cents per note, a sine an octave under the two lowest; slow in, slow out */
  private chordOn(k: number, at: number) {
    this.chordK = k
    const ctx = this.ctx
    for (const c of this.chords) {
      if (c.end !== Infinity) continue
      // the chord before fades out under this one: a crossfade, never a gap
      c.end = at + PAD_RELEASE * 1.6
      for (const e of c.env) e.gain.setTargetAtTime(0, at, PAD_RELEASE / 3)
      for (const o of c.osc) o.stop(c.end)
    }
    this.chords = this.chords.filter((c) => c.end > at)
    const chord: Chord = { env: [], osc: [], end: Infinity }
    CHORDS[k % CHORDS.length].pad.forEach((m, i) => {
      // under the two lowest notes, a sine an octave down at 0.3 (into both sides: it stays in the middle)
      let sub: GainNode | null = null
      if (i < 2) {
        const o = ctx.createOscillator()
        o.frequency.value = hz(m - 12)
        sub = ctx.createGain()
        sub.gain.value = 0.3
        o.connect(sub)
        o.start(at)
        chord.osc.push(o)
      }
      // the saw tuned 7 cents down leans left, the one 7 cents up leans right
      ;[-7, 7].forEach((cents, s) => {
        const env = ctx.createGain()
        env.gain.setValueAtTime(0, at)
        env.gain.setTargetAtTime(PAD_GAIN, at, PAD_ATTACK / 3)
        env.connect(this.padSides[s])
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(m)
        o.detune.value = cents
        o.connect(env)
        sub?.connect(env)
        // a few ms apart, so the saws never start in phase
        o.start(at + this.rand() * 0.03)
        chord.osc.push(o)
        chord.env.push(env)
      })
    })
    this.chords.push(chord)
  }

  /**
   * The keys: a soft electric piano. Two-operator FM at ratio 1, its index
   * falling from 1.8 to 0.25 over 1.2 s (the tine's bite melting into a
   * round tone), an 8 ms attack and a long fall (longer for low notes).
   */
  private key(m: number, at: number, vel: number) {
    const decay = KEYS_DECAY * 2 ** ((69 - m) / 36)
    const end = at + decay * 1.25
    if (!this.reserve(this.keyEnds, MAX_KEYS, at, end)) return
    const ctx = this.ctx
    const f = hz(m)
    const detune = (this.rand() * 2 - 1) * 3
    const car = ctx.createOscillator()
    const mod = ctx.createOscillator()
    car.frequency.value = f
    mod.frequency.value = f
    car.detune.value = detune
    mod.detune.value = detune
    // a cosine modulator: at ratio 1 a sine one leaves a DC offset (a thump under every note)
    mod.setPeriodicWave(this.cos)
    /*
     * Chrome and Safari skew a pair that starts between two render quanta (128
     * frames): the carrier runs against a shifted modulator, and every note
     * gets its own offset (up to half its level, measured) and a thinner or
     * rounder bite. So the pair (and its index) starts on the quantum before
     * the note, and the envelope still opens exactly on time.
     */
    const quantum = 128 / ctx.sampleRate
    const start = Math.floor(at / quantum) * quantum
    const index = ctx.createGain()
    index.gain.setValueAtTime(1.8 * f, start)
    index.gain.exponentialRampToValueAtTime(0.25 * f, at + 1.2)
    const amp = ctx.createGain()
    const peak = 0.05 + 0.06 * clamp01((vel - 0.35) / 0.5)
    // closed from the pair's own start (a gain is 1 until its first event)
    amp.gain.setValueAtTime(0, start)
    amp.gain.setValueAtTime(0, at)
    amp.gain.linearRampToValueAtTime(peak, at + 0.008)
    amp.gain.setTargetAtTime(0, at + 0.008, decay / 5)
    chain(mod, index)
    index.connect(car.frequency)
    chain(car, amp, this.pan((this.rand() * 2 - 1) * 0.15), this.keysIn)
    car.start(start)
    mod.start(start)
    car.stop(end)
    mod.stop(end)
  }

  /** a music-box bell: FM at ratio 3.5, the index falling to nothing in 0.6 s */
  private bell(m: number, at: number, vel: number, o: BellOpts = {}) {
    const decay = o.decay ?? BELL_DECAY
    const end = at + decay * 1.25
    if (!this.reserve(this.bellEnds, MAX_BELLS, at, end)) return
    const ctx = this.ctx
    const f = hz(m)
    const car = ctx.createOscillator()
    const mod = ctx.createOscillator()
    car.frequency.value = f
    mod.frequency.value = f * 3.5
    const index = ctx.createGain()
    index.gain.setValueAtTime((o.index ?? 2.2) * f * 3.5, at)
    index.gain.setTargetAtTime(0, at, 0.15)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0, at)
    amp.gain.linearRampToValueAtTime(0.06 * vel, at + 0.003)
    amp.gain.setTargetAtTime(0, at + 0.003, decay / 5)
    chain(mod, index)
    index.connect(car.frequency)
    chain(car, amp, this.pan((this.rand() * 2 - 1) * 0.2), this.bellsIn)
    car.start(at)
    mod.start(at)
    car.stop(end)
    mod.stop(end)
  }
}

/* ───────────── live: the score on her phone ───────────── */

/** the ends of a gesture: browsers (iOS above all) only let sound start from one of these */
const GESTURES = ['pointerup', 'touchend', 'keydown', 'click'] as const
const LISTEN = { capture: true, passive: true }
const noop = () => undefined

type AudioContextClass = typeof AudioContext

function audioContextClass(): AudioContextClass | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
}

/** an iPhone, or an iPad (which asks for the desktop site and calls itself a Mac) */
function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** half a second of silence as a WAV (8-bit mono at 8 kHz, about 5 kB once in base64) */
function silentWav() {
  const n = 4000
  const bytes = new Uint8Array(44 + n)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + n, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, n, true)
  // 8-bit PCM is unsigned: silence is 128
  bytes.fill(128, 44)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(s)}`
}

export type SoundState = {
  /** the score has started (or would have, were it on): the button shows from then on */
  started: boolean
  /** her choice */
  on: boolean
}

/**
 * The score on her phone. Nothing is created before the end of her first
 * gesture (iOS only allows sound from there): the hold on the first bulb ends
 * after its bloom, so the score usually starts with the title card. Every way
 * in is guarded: if anything fails, the film is simply silent.
 */
export class Live {
  private state: SoundState
  private readonly listeners = new Set<() => void>()
  private ctx: AudioContext | null = null
  private score: Score | null = null
  private probe: AnalyserNode | null = null
  private scene = ''
  /** this visit's moments so far, replayed without their bells if the score starts mid-scene */
  private seen: { name: Cue; arg?: number }[] = []
  /** she has been past the opening */
  private again = false
  private bloomed = false
  private poster = false
  /** one of her gestures has ended: sound is allowed from now on */
  private unlocked = false
  private broken = false
  private resting = false
  private tick = 0
  private idle = 0
  private sleep = 0
  private hush = 0
  private room = 0
  private silent: HTMLAudioElement | null = null

  constructor(on: boolean) {
    this.state = { started: false, on }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  snapshot = () => this.state

  /** listens for her gestures and for the page being hidden; the cleanup closes everything */
  attach = () => {
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, LISTEN)
    window.addEventListener('pointerdown', this.onPress, LISTEN)
    document.addEventListener('visibilitychange', this.onVisibility)
    if (import.meta.env.DEV) (window as unknown as { __thaoSound?: Live }).__thaoSound = this
    return () => {
      for (const type of GESTURES) window.removeEventListener(type, this.onGesture, true)
      window.removeEventListener('pointerdown', this.onPress, true)
      document.removeEventListener('visibilitychange', this.onVisibility)
      this.close()
    }
  }

  setScene(id: string) {
    this.guard(() => {
      if (id === this.scene) return
      if (id !== 'lights') this.again = true
      this.scene = id
      this.seen = []
      this.bloomed = false
      this.poster = false
      this.resting = false
      window.clearTimeout(this.idle)
      window.clearTimeout(this.sleep)
      const { ctx, score } = this
      if (ctx && score) {
        score.scene(id, ctx.currentTime, this.again)
        score.pump(ctx.currentTime)
      }
      this.update()
    })
  }

  cue(name: Cue, arg?: number) {
    this.guard(() => {
      this.seen.push({ name, arg })
      if (name === 'bloom' && this.scene === 'lights') this.bloomed = true
      if (name === 'poster' && this.scene === 'credits') {
        this.poster = true
        this.armIdle()
      }
      const { ctx, score } = this
      if (ctx && score) {
        // muted or asleep: the mood follows, the bells are not saved for later
        const quiet = !this.state.on || ctx.state !== 'running'
        score.cue(name, arg, ctx.currentTime, quiet)
        score.pump(ctx.currentTime)
      }
      this.update()
    })
  }

  toggle = () => {
    this.guard(() => {
      const on = !this.state.on
      this.state = { ...this.state, on }
      save('sound', on)
      window.clearTimeout(this.hush)
      if (on) {
        this.wake()
        if (this.ctx && this.score) this.score.mute(false, this.ctx.currentTime)
      } else {
        this.session(false)
        if (this.ctx && this.score) {
          this.score.mute(true, this.ctx.currentTime)
          // once it has faded, the whole score sleeps: no work, no battery
          this.hush = window.setTimeout(() => {
            if (!this.state.on) this.ctx?.suspend().catch(noop)
          }, 400)
        }
      }
      this.emit()
    })
  }

  /** development only: where the score stands (the tests read it) */
  debug() {
    const { ctx, score, probe } = this
    let rms = 0
    if (probe) {
      const a = new Float32Array(probe.fftSize)
      probe.getFloatTimeDomainData(a)
      let sum = 0
      for (const v of a) sum += v * v
      rms = Math.sqrt(sum / a.length)
    }
    return {
      ...this.state,
      ctx: ctx?.state ?? null,
      time: ctx?.currentTime ?? 0,
      scene: this.scene,
      unlocked: this.unlocked,
      resting: this.resting,
      broken: this.broken,
      silent: this.silent ? !this.silent.paused : null,
      rms,
      levels: score?.levels() ?? null,
    }
  }

  private onGesture = () => {
    this.guard(() => {
      // the end of a drag is no gesture to a browser: sound waits for a real one (Chrome warns otherwise)
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return
      this.unlocked = true
      if (this.resting) this.unrest()
      if (this.state.on) this.wake()
      if (this.poster) this.armIdle()
      this.update()
    })
  }

  private onPress = () => {
    this.guard(() => {
      if (this.poster) this.armIdle()
      if (this.resting) this.unrest()
    })
  }

  private onVisibility = () => {
    this.guard(() => {
      if (document.visibilityState === 'hidden') {
        this.silent?.pause()
        this.ctx?.suspend().catch(noop)
      } else if (this.state.on && this.unlocked && !this.resting) {
        // the phone may refuse to resume without a touch: her next gesture does it then
        this.wake()
      }
    })
  }

  /** creates the score at the end of her first gesture, and wakes it after a pause */
  private wake() {
    if (this.broken || document.visibilityState === 'hidden') return
    const AC = audioContextClass()
    if (!AC) return
    this.session(true)
    if (!this.ctx) {
      const ctx = new AC()
      const score = new Score(ctx, ctx.destination, { roomLater: true })
      this.ctx = ctx
      this.score = score
      ctx.onstatechange = this.onState
      // her release stays light: the room comes a moment later (the pad is only just fading in)
      this.room = window.setTimeout(() => this.guard(() => this.score?.fillRoom()), 200)
      // the scene she is on, and what has already happened in it (its mood, not its bells)
      score.scene(this.scene, ctx.currentTime, this.again)
      for (const c of this.seen) score.cue(c.name, c.arg, ctx.currentTime, true)
      if (import.meta.env.DEV) {
        this.probe = ctx.createAnalyser()
        this.probe.fftSize = 2048
        score.out.connect(this.probe)
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().then(this.onState, noop)
    this.onState()
  }

  /**
   * Most iPhones are always on silent, and the switch mutes the web's sound but
   * not a video's: ask for a video's kind of sound. iOS 17 has an API for it;
   * before that, a looping silent <audio> started in her gesture does the same
   * (the unmute-ios-audio trick). Muted, the phone gets its own sound back.
   */
  private session(play: boolean) {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) {
      try {
        const type = play ? 'playback' : 'auto'
        if (nav.audioSession.type !== type) nav.audioSession.type = type
        return
      } catch {
        /* refused: the other way below */
      }
    }
    if (!isIOS()) return
    if (!play) {
      this.silent?.pause()
      return
    }
    if (!this.silent) {
      const a = document.createElement('audio')
      a.setAttribute('x-webkit-airplay', 'deny')
      a.disableRemotePlayback = true
      a.preload = 'auto'
      a.loop = true
      a.src = silentWav()
      this.silent = a
    }
    if (this.silent.paused) this.silent.play().catch(noop)
  }

  private onState = () => {
    const running = this.ctx?.state === 'running'
    if (running && !this.tick) {
      this.pump()
      this.tick = window.setInterval(this.pump, 50)
    } else if (!running && this.tick) {
      window.clearInterval(this.tick)
      this.tick = 0
    }
  }

  private pump = () => {
    this.guard(() => {
      if (this.ctx && this.score) this.score.pump(this.ctx.currentTime)
    })
  }

  /** on the poster, 90 s without a touch: the score fades out over 6 s, then sleeps until she touches it */
  private armIdle() {
    window.clearTimeout(this.idle)
    if (this.scene !== 'credits' || !this.poster) return
    this.idle = window.setTimeout(() => this.guard(this.rest), 90_000)
  }

  private rest = () => {
    const { ctx, score } = this
    if (!ctx || !score || this.resting) return
    this.resting = true
    score.rest(true, ctx.currentTime)
    this.sleep = window.setTimeout(() => {
      if (this.resting) this.ctx?.suspend().catch(noop)
    }, 6500)
  }

  private unrest() {
    this.resting = false
    window.clearTimeout(this.sleep)
    const { ctx, score } = this
    if (!ctx || !score) return
    score.rest(false, ctx.currentTime)
    if (this.state.on) this.wake()
  }

  /** the button appears once the score has started (the opening is silent until its bulb blooms) */
  private update() {
    if (this.state.started || !this.unlocked || this.broken || !audioContextClass()) return
    if (this.scene === 'lights' && !this.bloomed && !this.again) return
    this.state = { ...this.state, started: true }
    this.emit()
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private close() {
    window.clearInterval(this.tick)
    this.tick = 0
    window.clearTimeout(this.idle)
    window.clearTimeout(this.sleep)
    window.clearTimeout(this.hush)
    window.clearTimeout(this.room)
    this.silent?.pause()
    this.score?.dispose()
    this.score = null
    this.probe = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) {
      ctx.onstatechange = null
      ctx.close().catch(noop)
    }
  }

  /** every way in: a failure anywhere leaves a silent film (and no button), never a broken one */
  private guard(fn: () => void) {
    if (this.broken) return
    try {
      fn()
    } catch {
      this.broken = true
      try {
        this.close()
      } catch {
        /* nothing left to close */
      }
      if (this.state.started) {
        this.state = { ...this.state, started: false }
        this.emit()
      }
    }
  }
}
