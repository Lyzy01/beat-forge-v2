// ============================================================
// BEATFORGE - Vocal Engine
// ============================================================

const VocalEngine = (() => {

  // ─── FORMANT PRESETS ────────────────────────────────────────
  // Each vowel/vocal: { name, formants: [{freq, gain, Q}], pitch, color }
  const VOCAL_PRESETS = [
    {
      name: 'Aah',
      emoji: '😮',
      color: '#ff6b6b',
      pitch: 200,
      formants: [
        { freq: 800,  gain: 1.0,  Q: 10 },
        { freq: 1200, gain: 0.7,  Q: 12 },
        { freq: 2600, gain: 0.3,  Q: 14 },
      ],
    },
    {
      name: 'Ooh',
      emoji: '😯',
      color: '#a78bfa',
      pitch: 190,
      formants: [
        { freq: 320,  gain: 1.0,  Q: 10 },
        { freq: 800,  gain: 0.6,  Q: 12 },
        { freq: 2400, gain: 0.2,  Q: 14 },
      ],
    },
    {
      name: 'Hey',
      emoji: '🙌',
      color: '#00e5ff',
      pitch: 240,
      formants: [
        { freq: 440,  gain: 1.0,  Q: 10 },
        { freq: 2000, gain: 0.8,  Q: 12 },
        { freq: 2800, gain: 0.35, Q: 14 },
      ],
    },
    {
      name: 'Yeah',
      emoji: '🎤',
      color: '#fbbf24',
      pitch: 260,
      formants: [
        { freq: 600,  gain: 1.0,  Q: 9  },
        { freq: 1700, gain: 0.7,  Q: 11 },
        { freq: 2500, gain: 0.3,  Q: 13 },
      ],
    },
    {
      name: 'Mmm',
      emoji: '🎵',
      color: '#34d399',
      pitch: 170,
      formants: [
        { freq: 280,  gain: 1.0,  Q: 8  },
        { freq: 900,  gain: 0.4,  Q: 10 },
        { freq: 2200, gain: 0.2,  Q: 12 },
      ],
    },
    {
      name: 'Whoa',
      emoji: '😲',
      color: '#fb923c',
      pitch: 220,
      formants: [
        { freq: 500,  gain: 1.0,  Q: 9  },
        { freq: 1000, gain: 0.75, Q: 11 },
        { freq: 2300, gain: 0.3,  Q: 13 },
      ],
    },
    {
      name: 'Eeh',
      emoji: '😁',
      color: '#f472b6',
      pitch: 280,
      formants: [
        { freq: 300,  gain: 1.0,  Q: 10 },
        { freq: 2600, gain: 0.85, Q: 13 },
        { freq: 3200, gain: 0.4,  Q: 15 },
      ],
    },
    {
      name: 'Ohh',
      emoji: '😦',
      color: '#60a5fa',
      pitch: 195,
      formants: [
        { freq: 500,  gain: 1.0,  Q: 10 },
        { freq: 1000, gain: 0.6,  Q: 12 },
        { freq: 2500, gain: 0.2,  Q: 14 },
      ],
    },
  ];

  // Recorded mic buffers: { name, buffer: AudioBuffer }
  const recordedSamples = [];

  let mediaRecorder = null;
  let recordingChunks = [];
  let isRecording = false;
  let onRecordDone = null;
  let onRecordStart = null;

  // ─── FORMANT SYNTHESIS ──────────────────────────────────────
  function playFormantVocal(ctx, destination, presetIndex, time, duration, pitchMult, volume) {
    const preset = VOCAL_PRESETS[presetIndex];
    if (!preset) return;

    const basePitch = preset.pitch * pitchMult;

    // Voiced source: buzz from sawtooth + slight noise
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(basePitch, time);

    // Add slight vibrato
    const vibLFO = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vibLFO.frequency.value = 5.5;
    vibGain.gain.value = basePitch * 0.012;
    vibLFO.connect(vibGain);
    vibGain.connect(src.frequency);

    // Noise layer (breathiness)
    const noiseLen = Math.floor(ctx.sampleRate * duration);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.04;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    // Formant filters (parallel bank)
    const formantMix = ctx.createGain();
    formantMix.gain.value = volume * 0.55;

    preset.formants.forEach(f => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = f.freq;
      filter.Q.value = f.Q;
      const fg = ctx.createGain();
      fg.gain.value = f.gain;

      src.connect(filter);
      noiseSrc.connect(filter);
      filter.connect(fg);
      fg.connect(formantMix);
    });

    // Envelope
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + Math.min(0.06, duration * 0.1));
    env.gain.setValueAtTime(1, time + duration * 0.7);
    env.gain.linearRampToValueAtTime(0, time + duration);

    formantMix.connect(env);
    env.connect(destination);

    const end = time + duration + 0.05;
    src.start(time); src.stop(end);
    vibLFO.start(time); vibLFO.stop(end);
    noiseSrc.start(time); noiseSrc.stop(end);
  }

  // ─── RECORDED SAMPLE PLAYBACK ───────────────────────────────
  function playRecordedSample(ctx, destination, bufferIndex, time, pitchMult, volume) {
    const sample = recordedSamples[bufferIndex];
    if (!sample || !sample.buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = pitchMult;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    src.connect(gain);
    gain.connect(destination);
    src.start(time);
  }

  // ─── MIC RECORDING ──────────────────────────────────────────
  async function startRecording(name) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      recordingChunks = [];
      isRecording = true;

      const options = { mimeType: 'audio/webm' };
      mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm') ? options : {});

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) recordingChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType });
        const arrayBuf = await blob.arrayBuffer();

        // We need an AudioContext to decode — get it from AudioEngine
        const ctx = AudioEngine.ctx;
        if (!ctx) { console.warn('No audio context'); return; }

        try {
          const decoded = await ctx.decodeAudioData(arrayBuf);
          const sample = { name: name || `Rec ${recordedSamples.length + 1}`, buffer: decoded };
          recordedSamples.push(sample);
          if (onRecordDone) onRecordDone(sample, recordedSamples.length - 1);
        } catch (e) {
          console.error('Decode error:', e);
          if (onRecordDone) onRecordDone(null, -1, 'Could not decode audio');
        }
        isRecording = false;
      };

      mediaRecorder.start();
      if (onRecordStart) onRecordStart();
      return true;
    } catch (e) {
      isRecording = false;
      if (e.name === 'NotAllowedError') throw new Error('Microphone permission denied');
      throw e;
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function deleteRecordedSample(idx) {
    recordedSamples.splice(idx, 1);
  }

  function renameRecordedSample(idx, name) {
    if (recordedSamples[idx]) recordedSamples[idx].name = name;
  }

  // ─── PUBLIC ─────────────────────────────────────────────────
  return {
    VOCAL_PRESETS,
    playFormantVocal,
    playRecordedSample,
    startRecording,
    stopRecording,
    deleteRecordedSample,
    renameRecordedSample,
    get recordedSamples() { return recordedSamples; },
    get isRecording() { return isRecording; },
    set onRecordDone(fn) { onRecordDone = fn; },
    set onRecordStart(fn) { onRecordStart = fn; },
  };
})();
