// ============================================================
// BEATFORGE - Audio Engine
// ============================================================

const AudioEngine = (() => {
  let ctx = null;
  let masterGain, masterCompressor, masterLimiter;
  let reverbConvolver, reverbGain, reverbDry;
  let delayNode, delayFeedback, delayGain;
  let distortionNode, distortionGain;
  let isPlaying = false;
  let bpm = 120;
  let stepCount = 16;
  let currentStep = 0;
  let nextStepTime = 0;
  let schedulerTimer = null;
  let onStepChange = null;

  const LOOKAHEAD = 0.08;
  const SCHEDULE_INTERVAL = 20;

  // Per-channel nodes
  const channelGains = [];
  const channelPans = [];

  // State refs (set by app.js)
  let _sequencerData = null;
  let _pianoRollNotes = [];
  let _pianoRollLoopBeats = 16;
  let _synthSettings = {
    osc1Type: 'sawtooth',
    osc2Type: 'square',
    osc2Detune: 7,
    filterType: 'lowpass',
    filterCutoff: 1800,
    filterRes: 4,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.6,
    release: 0.35,
    osc1Vol: 0.7,
    osc2Vol: 0.3,
  };

  // ─── INIT ──────────────────────────────────────────────────
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.85;

    masterCompressor = ctx.createDynamicsCompressor();
    masterCompressor.threshold.value = -12;
    masterCompressor.knee.value = 6;
    masterCompressor.ratio.value = 3;
    masterCompressor.attack.value = 0.003;
    masterCompressor.release.value = 0.25;

    masterLimiter = ctx.createDynamicsCompressor();
    masterLimiter.threshold.value = -2;
    masterLimiter.knee.value = 0;
    masterLimiter.ratio.value = 20;
    masterLimiter.attack.value = 0.001;
    masterLimiter.release.value = 0.1;

    // Reverb
    reverbConvolver = ctx.createConvolver();
    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.0;
    buildReverbIR(2.5);

    // Delay
    delayNode = ctx.createDelay(4.0);
    delayNode.delayTime.value = 0.375;
    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.35;
    delayGain = ctx.createGain();
    delayGain.gain.value = 0.0;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 4000;

    delayNode.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayGain);

    // Distortion
    distortionNode = ctx.createWaveShaper();
    distortionGain = ctx.createGain();
    distortionGain.gain.value = 0.0;
    makeDistortionCurve(50);

    // Master chain
    masterGain.connect(masterCompressor);
    reverbConvolver.connect(reverbGain);
    reverbGain.connect(masterCompressor);
    delayGain.connect(masterCompressor);
    distortionNode.connect(distortionGain);
    distortionGain.connect(masterCompressor);
    masterCompressor.connect(masterLimiter);
    masterLimiter.connect(ctx.destination);

    // 16 channel strips
    for (let i = 0; i < 16; i++) {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) {
        g.connect(p);
        p.connect(masterGain);
        p.connect(reverbConvolver);
        p.connect(delayNode);
        p.connect(distortionNode);
      } else {
        g.connect(masterGain);
      }
      channelGains.push(g);
      channelPans.push(p);
    }
  }

  function buildReverbIR(duration) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
      }
    }
    reverbConvolver.buffer = buf;
  }

  function makeDistortionCurve(amount) {
    const n = 512;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    distortionNode.curve = curve;
  }

  // ─── DRUM SYNTHESIS ────────────────────────────────────────
  function kick(time, vel = 1, ch = 0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(28, time + 0.45);
    g.gain.setValueAtTime(vel * 2, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    osc.connect(g); g.connect(channelGains[ch]);
    osc.start(time); osc.stop(time + 0.5);

    // Click transient
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.frequency.value = 1500;
    cg.gain.setValueAtTime(vel * 0.4, time);
    cg.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    click.connect(cg); cg.connect(channelGains[ch]);
    click.start(time); click.stop(time + 0.02);
  }

  function snare(time, vel = 1, ch = 1) {
    const bufLen = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    src.connect(f); f.connect(g); g.connect(channelGains[ch]);
    src.start(time); src.stop(time + 0.25);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.frequency.value = 195;
    og.gain.setValueAtTime(vel * 0.4, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(og); og.connect(channelGains[ch]);
    osc.start(time); osc.stop(time + 0.12);
  }

  function hihat(time, vel = 1, open = false, ch = 2) {
    const dur = open ? 0.55 : 0.055;
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 9000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.38, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(f); f.connect(g); g.connect(channelGains[ch]);
    src.start(time); src.stop(time + dur + 0.01);
  }

  function clap(time, vel = 1, ch = 5) {
    for (let i = 0; i < 4; i++) {
      const t = time + i * 0.012;
      const bufLen = Math.floor(ctx.sampleRate * 0.06);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < bufLen; j++) d[j] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.9 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      src.connect(f); f.connect(g); g.connect(channelGains[ch]);
      src.start(t); src.stop(t + 0.12);
    }
  }

  function crash(time, vel = 1, ch = 4) {
    const bufLen = Math.floor(ctx.sampleRate * 2.0);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 7000; f.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 2.0);
    src.connect(f); f.connect(g); g.connect(channelGains[ch]);
    src.start(time); src.stop(time + 2.0);
  }

  function tom(time, freq, vel = 1, ch = 6) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, time + 0.35);
    g.gain.setValueAtTime(vel * 1.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    osc.connect(g); g.connect(channelGains[ch]);
    osc.start(time); osc.stop(time + 0.42);
  }

  function bass808(time, freq, vel = 1, ch = 7) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc2.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.6);
    osc2.frequency.value = freq;
    const og2 = ctx.createGain();
    og2.gain.value = 0.1;
    g.gain.setValueAtTime(vel * 1.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
    osc.connect(g); osc2.connect(og2); og2.connect(g);
    g.connect(channelGains[ch]);
    osc.start(time); osc.stop(time + 0.85);
    osc2.start(time); osc2.stop(time + 0.85);
  }

  // ─── SYNTH ─────────────────────────────────────────────────
  function triggerNote(midiNote, time, duration) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const s = _synthSettings;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const envGain = ctx.createGain();
    const osc1g = ctx.createGain();
    const osc2g = ctx.createGain();

    osc1.type = s.osc1Type;
    osc1.frequency.value = freq;
    osc1g.gain.value = s.osc1Vol;

    osc2.type = s.osc2Type;
    osc2.frequency.value = freq;
    osc2.detune.value = s.osc2Detune;
    osc2g.gain.value = s.osc2Vol;

    filter.type = s.filterType;
    filter.frequency.setValueAtTime(s.filterCutoff * 0.3, time);
    filter.frequency.linearRampToValueAtTime(s.filterCutoff, time + s.attack + 0.05);
    filter.Q.value = s.filterRes;

    const peak = 0.6;
    const sus = peak * s.sustain;
    envGain.gain.setValueAtTime(0, time);
    envGain.gain.linearRampToValueAtTime(peak, time + s.attack);
    envGain.gain.linearRampToValueAtTime(sus, time + s.attack + s.decay);
    envGain.gain.setValueAtTime(sus, time + duration - 0.005);
    envGain.gain.linearRampToValueAtTime(0, time + duration + s.release);

    osc1.connect(osc1g); osc2.connect(osc2g);
    osc1g.connect(filter); osc2g.connect(filter);
    filter.connect(envGain);
    envGain.connect(channelGains[8]);

    const end = time + duration + s.release + 0.1;
    osc1.start(time); osc1.stop(end);
    osc2.start(time); osc2.stop(end);
  }

  // ─── SEQUENCER SCHEDULER ───────────────────────────────────
  const DRUM_MAP = [
    (t, v) => kick(t, v, 0),
    (t, v) => snare(t, v, 1),
    (t, v) => hihat(t, v, false, 2),
    (t, v) => hihat(t, v, true, 3),
    (t, v) => crash(t, v, 4),
    (t, v) => clap(t, v, 5),
    (t, v) => tom(t, 220, v, 6),
    (t, v) => tom(t, 140, v, 7),
    (t, v) => bass808(t, 60, v, 7),
  ];

  function scheduleStep(step, time) {
    if (!_sequencerData) return;
    const spb = 60 / bpm;
    const sps = spb / 4; // seconds per 16th note

    _sequencerData.channels.forEach((ch, i) => {
      if (!ch.muted && ch.steps && ch.steps[step % ch.steps.length]) {
        const vel = (ch.volume !== undefined ? ch.volume : 1);
        if (DRUM_MAP[i]) DRUM_MAP[i](time, vel);
        if (channelGains[i]) channelGains[i].gain.setValueAtTime(vel, time);
        if (channelPans[i]) channelPans[i].pan.setValueAtTime(ch.pan || 0, time);
      }
    });

    // Piano roll
    const loopSteps = _pianoRollLoopBeats * 4;
    const loopedStep = step % loopSteps;
    _pianoRollNotes.forEach(note => {
      const noteStep = Math.round(note.startBeat * 4);
      if (noteStep === loopedStep) {
        const dur = (note.duration / 4) * (60 / bpm);
        triggerNote(note.midiNote, time, Math.max(0.05, dur));
      }
    });

    // Vocals (dispatch for VocalUI to handle)
    if (typeof document !== 'undefined') {
      const delay = Math.max(0, (time - ctx.currentTime) * 1000 - 10);
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('beatforge:scheduleStep', {
          detail: { step, time }
        }));
      }, delay);
    }
  }

  function runScheduler() {
    while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(currentStep, nextStepTime);
      const step = currentStep;
      const t = nextStepTime;
      if (onStepChange) {
        const delay = Math.max(0, (t - ctx.currentTime) * 1000 - 10);
        setTimeout(() => { if (isPlaying) onStepChange(step); }, delay);
      }
      nextStepTime += (60 / bpm) / 4;
      currentStep = (currentStep + 1) % stepCount;
    }
    schedulerTimer = setTimeout(runScheduler, SCHEDULE_INTERVAL);
  }

  // ─── TRANSPORT ─────────────────────────────────────────────
  function play() {
    if (!ctx) init();
    if (ctx.state === 'suspended') ctx.resume();
    if (isPlaying) return;
    isPlaying = true;
    currentStep = 0;
    nextStepTime = ctx.currentTime + 0.05;
    runScheduler();
  }

  function stop() {
    isPlaying = false;
    clearTimeout(schedulerTimer);
    if (onStepChange) onStepChange(-1);
  }

  function restart() {
    stop();
    setTimeout(play, 50);
  }

  // ─── SETTERS ───────────────────────────────────────────────
  function setBpm(v) { bpm = v; }
  function setStepCount(v) { stepCount = v; }
  function setMasterVol(v) { if (masterGain) masterGain.gain.value = v; }
  function setChannelVol(i, v) { if (channelGains[i]) channelGains[i].gain.value = v; }
  function setChannelPan(i, v) { if (channelPans[i]) channelPans[i].pan.value = v; }
  function setReverbWet(v) { if (reverbGain) reverbGain.gain.value = v * 0.6; }
  function setReverbSize(v) { buildReverbIR(v * 5); }
  function setDelayWet(v) { if (delayGain) delayGain.gain.value = v * 0.5; }
  function setDelayTime(v) { if (delayNode) delayNode.delayTime.value = v; }
  function setDelayFeedback(v) { if (delayFeedback) delayFeedback.gain.value = v; }
  function setDistortionWet(v) { if (distortionGain) distortionGain.gain.value = v * 0.4; }
  function setDistortionDrive(v) { makeDistortionCurve(v * 200); }
  function setSequencerData(d) { _sequencerData = d; }
  function setPianoRollNotes(n) { _pianoRollNotes = n; }
  function setPianoRollLoop(b) { _pianoRollLoopBeats = b; }
  function setSynthSettings(s) { _synthSettings = { ..._synthSettings, ...s }; }
  function setOnStepChange(fn) { onStepChange = fn; }

  return {
    init, play, stop, restart,
    setBpm, setStepCount, setMasterVol,
    setChannelVol, setChannelPan,
    setReverbWet, setReverbSize,
    setDelayWet, setDelayTime, setDelayFeedback,
    setDistortionWet, setDistortionDrive,
    setSequencerData, setPianoRollNotes, setPianoRollLoop,
    setSynthSettings, setOnStepChange,
    get isPlaying() { return isPlaying; },
    get bpm() { return bpm; },
    get currentStep() { return currentStep; },
  };
})();
