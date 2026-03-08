// ============================================================
// BEATFORGE - Main App (Fixed)
// ============================================================

// ─── STATE ───────────────────────────────────────────────────
const CH_NAMES = ['Kick','Snare','Hi-Hat','Open HH','Crash','Clap','Tom Hi','Tom Lo'];

function makePattern(name) {
  return {
    name: name || 'Pattern 1',
    channels: CH_NAMES.map(n => ({
      name: n, steps: new Array(16).fill(false),
      volume: 1.0, pan: 0, muted: false, solo: false,
    })),
  };
}

function makeMixerChannels() {
  return ['Kick','Snare','Hi-Hat','Open HH','Crash','Clap','Tom Hi','Tom Lo','Synth','Aux'].map(n => ({
    name: n, volume: 1.0, pan: 0, muted: false, solo: false,
  }));
}

const AppState = {
  user: null,
  guestMode: false,
  projectId: null,
  projectName: 'Untitled Project',
  bpm: 120,
  isPlaying: false,
  currentStep: -1,
  masterVol: 0.85,
  sequencer: { patterns: [makePattern()], activePattern: 0 },
  pianoRoll: { notes: [], loopBeats: 8, zoomX: 1, scrollX: 0, scrollY: 200 },
  synth: { osc1Type:'sawtooth', osc2Type:'square', osc2Detune:7, osc1Vol:0.7, osc2Vol:0.3, filterType:'lowpass', filterCutoff:1800, filterRes:4, attack:0.01, decay:0.15, sustain:0.6, release:0.35 },
  mixer: { masterVol: 0.85, channels: makeMixerChannels() },
  fx: { reverb:{wet:0,size:0.5}, delay:{wet:0,time:0.375,feedback:0.35}, distortion:{wet:0,drive:0.3} },
  projects: [],
};

// Expose for keyboard preview
window.AppState = AppState;

// ─── HELPERS ─────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ─── DOM READY ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  setupTransport();
  setupTabs();
  renderSequencer();
  renderMixer();
  renderFX();
  renderSynth();
  setupPianoRoll();
  setupProjectControls();
  setupKeyboard();

  AudioEngine.init();
  AudioEngine.setOnStepChange(step => {
    AppState.currentStep = step;
    updateSeqPlayhead(step);
    if ($('tab-pianoroll').classList.contains('active')) drawPianoRoll();
    if (typeof VocalUI !== 'undefined') VocalUI.updatePlayhead(step);
  });

  // Hook vocal scheduling
  document.addEventListener('beatforge:scheduleStep', e => {
    if (typeof VocalUI !== 'undefined') VocalUI.scheduleStep(e.detail.step, e.detail.time);
  });

  // Init vocal UI
  if (typeof VocalUI !== 'undefined') {
    VocalUI.init();
    $('vocal-clear-btn')?.addEventListener('click', () => VocalUI.clearAll());
  }

  syncAll();

  // BPM controls
  $('bpm-display').addEventListener('click', () => {
    const v = prompt('Set BPM (40–200):', AppState.bpm);
    if (v) { const n = parseInt(v); if (n >= 40 && n <= 200) { AppState.bpm = n; $('bpm-display').textContent = n; AudioEngine.setBpm(n); } }
  });
  $('bpm-up').addEventListener('click', () => { if (AppState.bpm < 200) { AppState.bpm++; $('bpm-display').textContent = AppState.bpm; AudioEngine.setBpm(AppState.bpm); }});
  $('bpm-down').addEventListener('click', () => { if (AppState.bpm > 40) { AppState.bpm--; $('bpm-display').textContent = AppState.bpm; AudioEngine.setBpm(AppState.bpm); }});

  $('master-vol').addEventListener('input', e => {
    AppState.masterVol = parseFloat(e.target.value);
    AudioEngine.setMasterVol(AppState.masterVol);
    $('master-vol-val').textContent = Math.round(AppState.masterVol * 100) + '%';
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'Escape') stopPlay();
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); saveProject(); }
  });
});

// ─── AUTH ────────────────────────────────────────────────────
function initAuth() {
  const isGuest = sessionStorage.getItem('bf_guest') === '1';

  if (isGuest) {
    AppState.guestMode = true;
    $('user-name').textContent = 'Guest';
    $('guest-badge').style.display = 'inline';
    $('btn-signout').textContent = 'EXIT';
    return;
  }

  if (!FIREBASE_READY || !auth) {
    // No firebase — run as demo
    AppState.guestMode = true;
    $('user-name').textContent = 'Demo';
    $('guest-badge').style.display = 'inline';
    $('btn-save').style.opacity = '0.45';
    $('btn-save').title = 'Configure Firebase to enable saving';
    return;
  }

  auth.onAuthStateChanged(user => {
    if (user) {
      AppState.user = user;
      $('user-name').textContent = user.displayName || user.email || 'User';
      if (user.photoURL) { $('user-avatar').src = user.photoURL; $('user-avatar').style.display = 'block'; }
      loadProjects();
    } else {
      window.location.href = 'index.html';
    }
  });
}

function doSignOut() {
  if (AppState.guestMode) { sessionStorage.removeItem('bf_guest'); window.location.href = 'index.html'; return; }
  if (auth) auth.signOut().then(() => { window.location.href = 'index.html'; });
}

// ─── TRANSPORT ───────────────────────────────────────────────
function setupTransport() {
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-stop').addEventListener('click', stopPlay);
  $('btn-rewind').addEventListener('click', stopPlay);
}

function togglePlay() {
  AppState.isPlaying ? stopPlay() : startPlay();
}

function startPlay() {
  AppState.isPlaying = true;
  $('btn-play').textContent = '⏸';
  $('btn-play').classList.add('active');
  syncAll();
  AudioEngine.play();
}

function stopPlay() {
  AppState.isPlaying = false;
  AppState.currentStep = -1;
  $('btn-play').textContent = '▶';
  $('btn-play').classList.remove('active');
  AudioEngine.stop();
  updateSeqPlayhead(-1);
  if (typeof VocalUI !== 'undefined') VocalUI.updatePlayhead(-1);
}

// ─── TABS ────────────────────────────────────────────────────
function setupTabs() {
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    if (tab === 'pianoroll') { resizePianoRoll(); drawPianoRoll(); }
  }));
}

// ─── SYNC ────────────────────────────────────────────────────
function syncAll() {
  const pat = AppState.sequencer.patterns[AppState.sequencer.activePattern];
  AudioEngine.setSequencerData(pat);
  AudioEngine.setPianoRollNotes(AppState.pianoRoll.notes);
  AudioEngine.setPianoRollLoop(AppState.pianoRoll.loopBeats);
  AudioEngine.setSynthSettings(AppState.synth);
  AudioEngine.setBpm(AppState.bpm);
  AudioEngine.setMasterVol(AppState.masterVol);

  AppState.mixer.channels.forEach((ch, i) => {
    AudioEngine.setChannelVol(i, ch.muted ? 0 : ch.volume);
    AudioEngine.setChannelPan(i, ch.pan);
  });

  AudioEngine.setReverbWet(AppState.fx.reverb.wet);
  AudioEngine.setReverbSize(AppState.fx.reverb.size);
  AudioEngine.setDelayWet(AppState.fx.delay.wet);
  AudioEngine.setDelayTime(AppState.fx.delay.time);
  AudioEngine.setDelayFeedback(AppState.fx.delay.feedback);
  AudioEngine.setDistortionWet(AppState.fx.distortion.wet);
  AudioEngine.setDistortionDrive(AppState.fx.distortion.drive);
}

// ─── SEQUENCER ───────────────────────────────────────────────
function renderSequencer() {
  const pat = AppState.sequencer.patterns[AppState.sequencer.activePattern];
  const grid = $('seq-grid');
  grid.innerHTML = '';

  pat.channels.forEach((ch, ci) => {
    const row = document.createElement('div');
    row.className = 'seq-row';

    // Controls
    const ctrl = document.createElement('div');
    ctrl.className = 'seq-controls';
    ctrl.innerHTML = `
      <span class="ch-name" title="${ch.name}">${ch.name}</span>
      <button class="ch-mute ${ch.muted ? 'on' : ''}" data-ci="${ci}">M</button>
      <button class="ch-solo ${ch.solo ? 'on' : ''}" data-ci="${ci}">S</button>
      <input type="range" class="ch-vol" min="0" max="1.5" step="0.01" value="${ch.volume}" data-ci="${ci}">
    `;
    row.appendChild(ctrl);

    // Steps
    const stepsDiv = document.createElement('div');
    stepsDiv.className = 'seq-steps';
    ch.steps.forEach((active, si) => {
      const btn = document.createElement('button');
      btn.className = `step-btn${active ? ' on' : ''}${si % 4 === 0 ? ' beat-start' : ''}${si === AppState.currentStep ? ' playing' : ''}`;
      btn.dataset.ci = ci; btn.dataset.si = si;
      btn.addEventListener('click', () => {
        pat.channels[ci].steps[si] = !pat.channels[ci].steps[si];
        btn.classList.toggle('on');
        syncAll();
      });
      stepsDiv.appendChild(btn);
    });
    row.appendChild(stepsDiv);
    grid.appendChild(row);
  });

  // Mute/Solo/Vol listeners
  grid.querySelectorAll('.ch-mute').forEach(btn => btn.addEventListener('click', () => {
    const ci = +btn.dataset.ci;
    pat.channels[ci].muted = !pat.channels[ci].muted;
    btn.classList.toggle('on');
    syncAll();
  }));
  grid.querySelectorAll('.ch-solo').forEach(btn => btn.addEventListener('click', () => {
    const ci = +btn.dataset.ci;
    const was = pat.channels[ci].solo;
    pat.channels.forEach(c => c.solo = false);
    pat.channels[ci].solo = !was;
    renderSequencer(); syncAll();
  }));
  grid.querySelectorAll('.ch-vol').forEach(inp => inp.addEventListener('input', () => {
    pat.channels[+inp.dataset.ci].volume = parseFloat(inp.value); syncAll();
  }));

  renderPatternBtns();
  setupSeqToolbar();
}

function updateSeqPlayhead(step) {
  $$('.step-btn.playing').forEach(b => b.classList.remove('playing'));
  if (step >= 0) $$(`.step-btn[data-si="${step}"]`).forEach(b => b.classList.add('playing'));
}

function renderPatternBtns() {
  const wrap = $('pattern-btns');
  wrap.innerHTML = '';
  AppState.sequencer.patterns.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'pat-btn' + (i === AppState.sequencer.activePattern ? ' active' : '');
    btn.textContent = `PAT ${i+1}`;
    btn.addEventListener('click', () => { AppState.sequencer.activePattern = i; renderSequencer(); syncAll(); });
    wrap.appendChild(btn);
  });
}

function setupSeqToolbar() {
  $('btn-clear-seq').onclick = () => {
    AppState.sequencer.patterns[AppState.sequencer.activePattern].channels.forEach(c => c.steps.fill(false));
    renderSequencer(); syncAll();
  };
  $('btn-add-pat').onclick = () => {
    if (AppState.sequencer.patterns.length < 8) {
      AppState.sequencer.patterns.push(makePattern(`Pattern ${AppState.sequencer.patterns.length + 1}`));
      AppState.sequencer.activePattern = AppState.sequencer.patterns.length - 1;
      renderSequencer(); syncAll();
    }
  };
  const ss = $('steps-select');
  ss.onchange = () => {
    const n = parseInt(ss.value);
    AppState.sequencer.patterns[AppState.sequencer.activePattern].channels.forEach(ch => {
      while (ch.steps.length < n) ch.steps.push(false);
      ch.steps = ch.steps.slice(0, n);
    });
    AudioEngine.setStepCount(n);
    renderSequencer(); syncAll();
  };
}

// ─── PIANO ROLL ──────────────────────────────────────────────
const PIANO_KEY_W = 56, NOTE_H = 16, BASE_CELL_W = 38, TOTAL_NOTES = 60, BASE_MIDI = 36;
const BLACK_KEYS = new Set([1,3,6,8,10]);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

let prCanvas, prCtx, prDragging = false, prDragNote = null, prDragMode = null;

function setupPianoRoll() {
  prCanvas = $('piano-roll-canvas');
  if (!prCanvas) return;
  prCtx = prCanvas.getContext('2d');
  resizePianoRoll(); drawPianoRoll();

  prCanvas.addEventListener('mousedown', prDown);
  prCanvas.addEventListener('mousemove', prMove);
  prCanvas.addEventListener('mouseup', () => { prDragging = false; prDragNote = null; });
  prCanvas.addEventListener('contextmenu', e => e.preventDefault());
  prCanvas.addEventListener('wheel', prWheel, { passive: true });
  window.addEventListener('resize', () => { resizePianoRoll(); drawPianoRoll(); });

  $('pr-loop').value = AppState.pianoRoll.loopBeats;
  $('pr-loop').addEventListener('change', e => { AppState.pianoRoll.loopBeats = parseInt(e.target.value); syncAll(); drawPianoRoll(); });
  $('pr-clear').addEventListener('click', () => { AppState.pianoRoll.notes = []; syncAll(); drawPianoRoll(); });
  $('pr-zoom-in').addEventListener('click', () => { AppState.pianoRoll.zoomX = Math.min(4, AppState.pianoRoll.zoomX * 1.25); drawPianoRoll(); });
  $('pr-zoom-out').addEventListener('click', () => { AppState.pianoRoll.zoomX = Math.max(0.25, AppState.pianoRoll.zoomX * 0.8); drawPianoRoll(); });
}

function resizePianoRoll() {
  if (!prCanvas) return;
  const c = prCanvas.parentElement;
  prCanvas.width = c.offsetWidth;
  prCanvas.height = c.offsetHeight;
}

function prCellW() { return BASE_CELL_W * AppState.pianoRoll.zoomX; }
function prBeatToX(b) { return b * prCellW() - AppState.pianoRoll.scrollX + PIANO_KEY_W; }
function prXToBeat(x) { return (x - PIANO_KEY_W + AppState.pianoRoll.scrollX) / prCellW(); }
function prMidiToY(m) { return (TOTAL_NOTES - 1 - (m - BASE_MIDI)) * NOTE_H - AppState.pianoRoll.scrollY; }
function prYToMidi(y) { return BASE_MIDI + (TOTAL_NOTES - 1 - Math.floor((y + AppState.pianoRoll.scrollY) / NOTE_H)); }

function prDown(e) {
  const r = prCanvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (mx < PIANO_KEY_W) return;
  const beat = prXToBeat(mx), midi = prYToMidi(my);
  if (midi < BASE_MIDI || midi >= BASE_MIDI + TOTAL_NOTES || beat < 0 || beat >= AppState.pianoRoll.loopBeats) return;
  const snap = Math.floor(beat * 4) / 4;
  if (e.button === 2 || e.ctrlKey) {
    AppState.pianoRoll.notes = AppState.pianoRoll.notes.filter(n => !(n.midiNote === midi && snap >= n.startBeat && snap < n.startBeat + n.duration));
  } else {
    const ex = AppState.pianoRoll.notes.find(n => n.midiNote === midi && snap >= n.startBeat && snap < n.startBeat + n.duration);
    if (ex) {
      AppState.pianoRoll.notes = AppState.pianoRoll.notes.filter(n => n !== ex);
    } else {
      prDragNote = { midiNote: midi, startBeat: snap, duration: 0.25 };
      AppState.pianoRoll.notes.push(prDragNote);
      prDragging = true; prDragMode = 'draw';
    }
  }
  syncAll(); drawPianoRoll();
}

function prMove(e) {
  if (!prDragging || prDragMode !== 'draw' || !prDragNote) return;
  const r = prCanvas.getBoundingClientRect();
  const beat = prXToBeat(e.clientX - r.left);
  const dur = Math.max(0.25, Math.ceil(beat * 4) / 4 - prDragNote.startBeat);
  prDragNote.duration = dur;
  syncAll(); drawPianoRoll();
}

function prWheel(e) {
  if (e.shiftKey) AppState.pianoRoll.scrollX = Math.max(0, AppState.pianoRoll.scrollX + e.deltaY * 0.5);
  else AppState.pianoRoll.scrollY = Math.max(0, Math.min(TOTAL_NOTES * NOTE_H - prCanvas.height + 40, AppState.pianoRoll.scrollY + e.deltaY * 0.5));
  drawPianoRoll();
}

function drawPianoRoll() {
  if (!prCtx) return;
  const W = prCanvas.width, H = prCanvas.height;
  const cw = prCellW(), lb = AppState.pianoRoll.loopBeats;
  const sx = AppState.pianoRoll.scrollX, sy = AppState.pianoRoll.scrollY;

  prCtx.fillStyle = '#0e0e1a'; prCtx.fillRect(0, 0, W, H);

  for (let i = 0; i < TOTAL_NOTES; i++) {
    const midi = BASE_MIDI + (TOTAL_NOTES - 1 - i);
    const nn = midi % 12, y = i * NOTE_H - sy;
    if (y + NOTE_H < 0 || y > H) continue;
    prCtx.fillStyle = BLACK_KEYS.has(nn) ? '#111120' : '#161628';
    prCtx.fillRect(PIANO_KEY_W, y, W - PIANO_KEY_W, NOTE_H);
    prCtx.fillStyle = 'rgba(255,255,255,0.04)'; prCtx.fillRect(PIANO_KEY_W, y + NOTE_H - 1, W - PIANO_KEY_W, 1);
    if (nn === 0) { prCtx.fillStyle = 'rgba(0,229,255,0.15)'; prCtx.fillRect(PIANO_KEY_W, y, W - PIANO_KEY_W, 1); }
    if (BLACK_KEYS.has(nn)) { prCtx.fillStyle = '#1a1a2e'; prCtx.fillRect(2, y+1, (PIANO_KEY_W-2)*.65, NOTE_H-2); }
    else {
      prCtx.fillStyle = '#2a2a3e'; prCtx.fillRect(2, y+1, PIANO_KEY_W-2, NOTE_H-2);
      if (nn === 0) { prCtx.fillStyle = '#00e5ff'; prCtx.font = '9px monospace'; prCtx.textBaseline = 'middle'; prCtx.fillText(`C${Math.floor(midi/12)-1}`, PIANO_KEY_W-24, y+NOTE_H/2); }
    }
  }

  for (let b = 0; b <= lb * 4; b++) {
    const x = prBeatToX(b / 4);
    if (x < PIANO_KEY_W || x > W) continue;
    prCtx.fillStyle = b % 16 === 0 ? 'rgba(0,229,255,0.25)' : b % 4 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
    prCtx.fillRect(x, 0, 1, H);
    if (b % 4 === 0) { prCtx.fillStyle = 'rgba(0,229,255,0.6)'; prCtx.font = '9px monospace'; prCtx.textBaseline = 'top'; prCtx.fillText(b/4+1, x+2, 2); }
  }

  const loopEndX = prBeatToX(lb);
  if (loopEndX < W) { prCtx.fillStyle = 'rgba(0,0,0,0.35)'; prCtx.fillRect(loopEndX, 0, W - loopEndX, H); prCtx.fillStyle = 'rgba(0,229,255,0.5)'; prCtx.fillRect(loopEndX-1, 0, 2, H); }

  AppState.pianoRoll.notes.forEach(note => {
    const x = prBeatToX(note.startBeat), y = prMidiToY(note.midiNote);
    const w = Math.max(4, note.duration * cw - 2);
    if (x + w < PIANO_KEY_W || x > W || y + NOTE_H < 0 || y > H) return;
    const grad = prCtx.createLinearGradient(x, y, x, y + NOTE_H);
    grad.addColorStop(0, '#00e5ff'); grad.addColorStop(1, '#0090aa');
    prCtx.fillStyle = grad;
    prCtx.beginPath(); prCtx.roundRect(Math.max(x, PIANO_KEY_W+1), y+1, w, NOTE_H-2, 3); prCtx.fill();
    if (w > 20) { prCtx.fillStyle = '#003040'; prCtx.font = 'bold 9px monospace'; prCtx.textBaseline = 'middle'; prCtx.fillText(NOTE_NAMES[note.midiNote%12], Math.max(x,PIANO_KEY_W)+3, y+NOTE_H/2); }
  });

  if (AppState.currentStep >= 0) {
    const px = prBeatToX(AppState.currentStep / 4);
    if (px >= PIANO_KEY_W && px <= W) { prCtx.fillStyle = 'rgba(255,107,53,0.8)'; prCtx.fillRect(px-1, 0, 2, H); }
  }

  prCtx.fillStyle = 'rgba(0,229,255,0.3)'; prCtx.fillRect(PIANO_KEY_W-1, 0, 1, H);
}

// ─── SYNTH UI ─────────────────────────────────────────────────
function renderSynth() {
  const s = AppState.synth;

  ['osc1','osc2'].forEach(id => {
    const key = id === 'osc1' ? 'osc1Type' : 'osc2Type';
    $$(`#${id}-type .wave-btn`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.wave === s[key]);
      btn.addEventListener('click', () => {
        s[key] = btn.dataset.wave;
        $$(`#${id}-type .wave-btn`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AudioEngine.setSynthSettings(s);
      });
    });
  });

  $$('#filter-type .ftype-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ft === s.filterType);
    btn.addEventListener('click', () => {
      s.filterType = btn.dataset.ft;
      $$('#filter-type .ftype-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AudioEngine.setSynthSettings(s);
    });
  });

  const knobs = [
    ['osc1-vol','osc1Vol',v=>v.toFixed(2)], ['osc2-vol','osc2Vol',v=>v.toFixed(2)],
    ['osc2-det','osc2Detune',v=>Math.round(v)+'ct'],
    ['filt-cut','filterCutoff',v=>Math.round(v)+'Hz'], ['filt-res','filterRes',v=>v.toFixed(1)],
    ['env-a','attack',v=>v.toFixed(3)+'s'], ['env-d','decay',v=>v.toFixed(3)+'s'],
    ['env-s','sustain',v=>v.toFixed(2)], ['env-r','release',v=>v.toFixed(3)+'s'],
  ];
  knobs.forEach(([id, key, fmt]) => {
    const el = $(id); if (!el) return;
    el.value = s[key];
    el.addEventListener('input', () => {
      s[key] = parseFloat(el.value);
      const d = $(`${id}-v`); if (d) d.textContent = fmt(s[key]);
      AudioEngine.setSynthSettings(s);
    });
    const d = $(`${id}-v`); if (d) d.textContent = fmt(s[key]);
  });
}

// ─── MIXER ────────────────────────────────────────────────────
function renderMixer() {
  const grid = $('mixer-grid');
  grid.innerHTML = '';

  AppState.mixer.channels.forEach((ch, i) => {
    const strip = document.createElement('div');
    strip.className = 'mixer-strip';
    strip.innerHTML = `
      <div class="mix-name">${ch.name}</div>
      <div class="mix-vu"><div class="vu-bar"></div></div>
      <input type="range" class="mix-fader" orient="vertical" min="0" max="1.5" step="0.01" value="${ch.volume}" data-mi="${i}">
      <div class="mix-vol-val">${Math.round(ch.volume*100)}%</div>
      <input type="range" class="mix-pan" min="-1" max="1" step="0.01" value="${ch.pan}" data-mi="${i}">
      <div class="mix-btns">
        <button class="mix-mute${ch.muted?' on':''}" data-mi="${i}">M</button>
        <button class="mix-solo${ch.solo?' on':''}" data-mi="${i}">S</button>
      </div>`;
    grid.appendChild(strip);
  });

  // Master
  const master = document.createElement('div');
  master.className = 'mixer-strip master-strip';
  master.innerHTML = `
    <div class="mix-name">MASTER</div>
    <div class="mix-vu"><div class="vu-bar"></div></div>
    <input type="range" class="mix-fader" orient="vertical" min="0" max="1.2" step="0.01" value="${AppState.masterVol}" id="mix-master">
    <div class="mix-vol-val" id="mix-master-val">${Math.round(AppState.masterVol*100)}%</div>`;
  grid.appendChild(master);

  $('mix-master')?.addEventListener('input', e => {
    AppState.masterVol = parseFloat(e.target.value);
    $('mix-master-val').textContent = Math.round(AppState.masterVol*100)+'%';
    $('master-vol').value = AppState.masterVol;
    $('master-vol-val').textContent = Math.round(AppState.masterVol*100)+'%';
    AudioEngine.setMasterVol(AppState.masterVol);
  });

  grid.querySelectorAll('.mix-fader:not(#mix-master)').forEach(el => el.addEventListener('input', () => {
    const i = +el.dataset.mi;
    AppState.mixer.channels[i].volume = parseFloat(el.value);
    el.nextElementSibling.textContent = Math.round(parseFloat(el.value)*100)+'%';
    syncAll();
  }));
  grid.querySelectorAll('.mix-pan').forEach(el => el.addEventListener('input', () => {
    AppState.mixer.channels[+el.dataset.mi].pan = parseFloat(el.value); syncAll();
  }));
  grid.querySelectorAll('.mix-mute').forEach(btn => btn.addEventListener('click', () => {
    const i = +btn.dataset.mi; AppState.mixer.channels[i].muted = !AppState.mixer.channels[i].muted;
    btn.classList.toggle('on'); syncAll();
  }));
  grid.querySelectorAll('.mix-solo').forEach(btn => btn.addEventListener('click', () => {
    const i = +btn.dataset.mi; const was = AppState.mixer.channels[i].solo;
    AppState.mixer.channels.forEach(c => c.solo = false); AppState.mixer.channels[i].solo = !was;
    renderMixer(); syncAll();
  }));
}

// ─── FX ───────────────────────────────────────────────────────
function renderFX() {
  const knobs = [
    ['rv-wet','reverb','wet'],['rv-size','reverb','size'],
    ['dl-wet','delay','wet'],['dl-time','delay','time'],['dl-fb','delay','feedback'],
    ['dist-wet','distortion','wet'],['dist-drv','distortion','drive'],
  ];
  knobs.forEach(([id, fx, p]) => {
    const el = $(id); if (!el) return;
    el.value = AppState.fx[fx][p];
    el.addEventListener('input', () => {
      AppState.fx[fx][p] = parseFloat(el.value);
      const d = $(`${id}-v`); if (d) d.textContent = parseFloat(el.value).toFixed(2);
      if (fx==='reverb') { if(p==='wet') AudioEngine.setReverbWet(AppState.fx.reverb.wet); if(p==='size') AudioEngine.setReverbSize(AppState.fx.reverb.size); }
      if (fx==='delay') { if(p==='wet') AudioEngine.setDelayWet(AppState.fx.delay.wet); if(p==='time') AudioEngine.setDelayTime(AppState.fx.delay.time); if(p==='feedback') AudioEngine.setDelayFeedback(AppState.fx.delay.feedback); }
      if (fx==='distortion') { if(p==='wet') AudioEngine.setDistortionWet(AppState.fx.distortion.wet); if(p==='drive') AudioEngine.setDistortionDrive(AppState.fx.distortion.drive); }
    });
    const d = $(`${id}-v`); if (d) d.textContent = parseFloat(el.value).toFixed(2);
  });
}

// ─── KEYBOARD ────────────────────────────────────────────────
function setupKeyboard() { /* Built inline in daw.html */ }

// ─── PROJECT CONTROLS ────────────────────────────────────────
function setupProjectControls() {
  $('btn-new')?.addEventListener('click', newProject);
  $('btn-save')?.addEventListener('click', saveProject);
  $('btn-load')?.addEventListener('click', () => $('projects-panel').classList.toggle('open'));
  $('btn-signout')?.addEventListener('click', doSignOut);
  $('project-name')?.addEventListener('blur', e => { AppState.projectName = e.target.textContent.trim() || 'Untitled'; });
}

function newProject() {
  if (!confirm('Start new project? Unsaved changes will be lost.')) return;
  AppState.sequencer = { patterns: [makePattern()], activePattern: 0 };
  AppState.pianoRoll = { notes: [], loopBeats: 8, zoomX: 1, scrollX: 0, scrollY: 200 };
  AppState.synth = { osc1Type:'sawtooth', osc2Type:'square', osc2Detune:7, osc1Vol:0.7, osc2Vol:0.3, filterType:'lowpass', filterCutoff:1800, filterRes:4, attack:0.01, decay:0.15, sustain:0.6, release:0.35 };
  AppState.fx = { reverb:{wet:0,size:0.5}, delay:{wet:0,time:0.375,feedback:0.35}, distortion:{wet:0,drive:0.3} };
  AppState.projectName = 'Untitled Project'; AppState.projectId = null;
  $('project-name').textContent = AppState.projectName;
  renderSequencer(); renderMixer(); renderFX(); renderSynth(); drawPianoRoll(); syncAll();
}

function serialize() {
  return {
    name: AppState.projectName, bpm: AppState.bpm,
    updatedAt: new Date().toISOString(),
    sequencer: { patterns: AppState.sequencer.patterns.map(p => ({ name:p.name, channels: p.channels.map(c => ({...c, steps:[...c.steps]})) })), activePattern: AppState.sequencer.activePattern },
    pianoRoll: { notes: [...AppState.pianoRoll.notes], loopBeats: AppState.pianoRoll.loopBeats },
    synth: {...AppState.synth}, mixer: { masterVol: AppState.masterVol, channels: AppState.mixer.channels.map(c=>({...c})) },
    fx: JSON.parse(JSON.stringify(AppState.fx)),
  };
}

function deserialize(data) {
  AppState.projectName = data.name || 'Untitled';
  AppState.bpm = data.bpm || 120;
  $('project-name').textContent = AppState.projectName;
  $('bpm-display').textContent = AppState.bpm;
  if (data.sequencer) { AppState.sequencer.patterns = data.sequencer.patterns.map(p => ({ name:p.name, channels: p.channels.map(c => ({...c, steps:[...c.steps], solo:false})) })); AppState.sequencer.activePattern = data.sequencer.activePattern||0; }
  if (data.pianoRoll) { AppState.pianoRoll.notes = data.pianoRoll.notes||[]; AppState.pianoRoll.loopBeats = data.pianoRoll.loopBeats||8; $('pr-loop').value = AppState.pianoRoll.loopBeats; }
  if (data.synth) AppState.synth = {...AppState.synth,...data.synth};
  if (data.mixer) { AppState.masterVol = data.mixer.masterVol||0.85; AppState.mixer.channels = data.mixer.channels; }
  if (data.fx) AppState.fx = data.fx;
  renderSequencer(); renderMixer(); renderFX(); renderSynth(); drawPianoRoll(); syncAll();
}

async function saveProject() {
  if (AppState.guestMode) { showToast('Sign in to save to cloud!','warn'); return; }
  if (!AppState.user || !db) return;
  const data = serialize();
  showToast('Saving...','info');
  try {
    if (AppState.projectId) {
      await db.collection('users').doc(AppState.user.uid).collection('projects').doc(AppState.projectId).set(data);
    } else {
      const ref = await db.collection('users').doc(AppState.user.uid).collection('projects').add(data);
      AppState.projectId = ref.id;
    }
    showToast('Saved ✓','success'); loadProjects();
  } catch(e) { showToast('Save failed: '+e.message,'error'); }
}

async function loadProjects() {
  if (!AppState.user || !db) return;
  try {
    const snap = await db.collection('users').doc(AppState.user.uid).collection('projects').orderBy('updatedAt','desc').limit(20).get();
    AppState.projects = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderProjectsList();
  } catch(e) { console.warn('Could not load projects:', e); }
}

function renderProjectsList() {
  const list = $('projects-list');
  if (!list) return;
  if (!AppState.projects.length) { list.innerHTML = '<p class="no-projects">No saved projects yet.</p>'; return; }
  list.innerHTML = AppState.projects.map(p => `
    <div class="proj-item">
      <div class="proj-info">
        <span class="proj-name">${p.name}</span>
        <span class="proj-date">${new Date(p.updatedAt).toLocaleDateString()}</span>
      </div>
      <div class="proj-acts">
        <button class="btn-pload" data-pid="${p.id}">Load</button>
        <button class="btn-pdel" data-pid="${p.id}">✕</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.btn-pload').forEach(btn => btn.addEventListener('click', () => {
    const proj = AppState.projects.find(p => p.id === btn.dataset.pid);
    if (proj) { AppState.projectId = proj.id; deserialize(proj); $('projects-panel').classList.remove('open'); showToast('Loaded: '+proj.name,'success'); }
  }));
  list.querySelectorAll('.btn-pdel').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this project?')) return;
    try { await db.collection('users').doc(AppState.user.uid).collection('projects').doc(btn.dataset.pid).delete(); AppState.projects = AppState.projects.filter(p=>p.id!==btn.dataset.pid); renderProjectsList(); showToast('Deleted','info'); }
    catch(e) { showToast('Delete failed','error'); }
  }));
}

// ─── TOAST ────────────────────────────────────────────────────
function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}
