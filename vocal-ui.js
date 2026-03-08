// ============================================================
// BEATFORGE - Vocal UI Module
// ============================================================

const VocalUI = (() => {

  // ─── STATE ──────────────────────────────────────────────────
  const vocalState = {
    // Each track: { type: 'preset'|'recorded', index, steps[16], pitch, volume, muted }
    tracks: [],
    stepCount: 16,
    currentStep: -1,
  };

  // ─── INIT ───────────────────────────────────────────────────
  function init() {
    // Create default tracks from first 4 presets
    VocalEngine.VOCAL_PRESETS.slice(0, 4).forEach((p, i) => {
      vocalState.tracks.push(createTrack('preset', i, p.name));
    });

    VocalEngine.onRecordDone = (sample, idx, err) => {
      if (err || !sample) {
        showVocalToast('Recording failed: ' + (err || 'unknown error'), 'error');
        updateRecordBtn(false);
        return;
      }
      // Add a new track for this sample
      vocalState.tracks.push(createTrack('recorded', idx, sample.name));
      updateRecordBtn(false);
      renderVocalTracks();
      showVocalToast(`🎤 "${sample.name}" recorded!`, 'success');
    };

    VocalEngine.onRecordStart = () => {
      updateRecordBtn(true);
    };

    renderVocalPresets();
    renderVocalTracks();
    setupVocalControls();
  }

  function createTrack(type, index, name) {
    return {
      type,
      index,
      name,
      steps: new Array(16).fill(false),
      pitch: 1.0,
      volume: 0.9,
      muted: false,
    };
  }

  // ─── PRESET PADS ─────────────────────────────────────────────
  function renderVocalPresets() {
    const grid = document.getElementById('vocal-presets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    VocalEngine.VOCAL_PRESETS.forEach((preset, i) => {
      const pad = document.createElement('button');
      pad.className = 'vocal-pad';
      pad.style.setProperty('--pad-color', preset.color);
      pad.innerHTML = `
        <span class="pad-emoji">${preset.emoji}</span>
        <span class="pad-name">${preset.name}</span>
      `;
      pad.title = `Preview "${preset.name}" · Click to add to sequencer`;

      // Preview on click
      pad.addEventListener('mousedown', () => {
        previewPreset(i);
        pad.classList.add('triggered');
        setTimeout(() => pad.classList.remove('triggered'), 200);
      });

      // Add to sequencer on dblclick or + button
      const addBtn = document.createElement('button');
      addBtn.className = 'pad-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Add track to sequencer';
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        const track = createTrack('preset', i, preset.name);
        vocalState.tracks.push(track);
        renderVocalTracks();
        showVocalToast(`Added ${preset.name} track`, 'info');
      });

      pad.appendChild(addBtn);
      grid.appendChild(pad);
    });
  }

  function previewPreset(index) {
    const ctx = AudioEngine.ctx;
    if (!ctx) { AudioEngine.init(); return; }
    if (ctx.state === 'suspended') ctx.resume();
    VocalEngine.playFormantVocal(ctx, ctx.destination, index, ctx.currentTime, 0.6, 1.0, 0.8);
  }

  // ─── VOCAL TRACKS SEQUENCER ──────────────────────────────────
  function renderVocalTracks() {
    const container = document.getElementById('vocal-tracks');
    if (!container) return;
    container.innerHTML = '';

    if (vocalState.tracks.length === 0) {
      container.innerHTML = `<div class="vocal-empty">No vocal tracks yet.<br>Click <b>+</b> on a preset pad or record your voice.</div>`;
      return;
    }

    vocalState.tracks.forEach((track, ti) => {
      const preset = track.type === 'preset' ? VocalEngine.VOCAL_PRESETS[track.index] : null;
      const color = preset ? preset.color : '#a78bfa';

      const row = document.createElement('div');
      row.className = 'vocal-track-row';
      row.style.setProperty('--track-color', color);

      // Controls
      const ctrl = document.createElement('div');
      ctrl.className = 'vocal-track-ctrl';
      ctrl.innerHTML = `
        <span class="vt-name" title="${track.name}">${track.type === 'recorded' ? '🎤 ' : ''}${track.name}</span>
        <button class="vt-mute ${track.muted ? 'active' : ''}" data-ti="${ti}" title="Mute">M</button>
        <button class="vt-remove" data-ti="${ti}" title="Remove track">✕</button>
        <div class="vt-params">
          <label>PITCH</label>
          <input type="range" class="vt-pitch" min="0.5" max="2" step="0.01"
            value="${track.pitch}" data-ti="${ti}" title="Pitch">
          <span class="vt-pitch-val" data-ti="${ti}">${pitchLabel(track.pitch)}</span>
        </div>
        <div class="vt-params">
          <label>VOL</label>
          <input type="range" class="vt-vol" min="0" max="1.5" step="0.01"
            value="${track.volume}" data-ti="${ti}" title="Volume">
        </div>
      `;
      row.appendChild(ctrl);

      // Steps
      const steps = document.createElement('div');
      steps.className = 'vocal-steps';
      track.steps.forEach((on, si) => {
        const btn = document.createElement('button');
        btn.className = `vocal-step ${on ? 'on' : ''} ${si % 4 === 0 ? 'beat-start' : ''}`;
        btn.dataset.ti = ti;
        btn.dataset.si = si;
        if (si === vocalState.currentStep) btn.classList.add('playing');
        btn.addEventListener('click', () => toggleVocalStep(ti, si));
        steps.appendChild(btn);
      });
      row.appendChild(steps);
      container.appendChild(row);
    });

    // Mute buttons
    container.querySelectorAll('.vt-mute').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = parseInt(btn.dataset.ti);
        vocalState.tracks[ti].muted ^= true;
        btn.classList.toggle('active');
      });
    });

    // Remove buttons
    container.querySelectorAll('.vt-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = parseInt(btn.dataset.ti);
        vocalState.tracks.splice(ti, 1);
        renderVocalTracks();
      });
    });

    // Pitch sliders
    container.querySelectorAll('.vt-pitch').forEach(inp => {
      inp.addEventListener('input', () => {
        const ti = parseInt(inp.dataset.ti);
        vocalState.tracks[ti].pitch = parseFloat(inp.value);
        const valEl = container.querySelector(`.vt-pitch-val[data-ti="${ti}"]`);
        if (valEl) valEl.textContent = pitchLabel(parseFloat(inp.value));
      });
    });

    // Vol sliders
    container.querySelectorAll('.vt-vol').forEach(inp => {
      inp.addEventListener('input', () => {
        const ti = parseInt(inp.dataset.ti);
        vocalState.tracks[ti].volume = parseFloat(inp.value);
      });
    });
  }

  function toggleVocalStep(ti, si) {
    vocalState.tracks[ti].steps[si] = !vocalState.tracks[ti].steps[si];
    const btn = document.querySelector(`.vocal-step[data-ti="${ti}"][data-si="${si}"]`);
    if (btn) btn.classList.toggle('on');
  }

  function pitchLabel(v) {
    if (v < 0.98) return `-${Math.round((1 - v) * 12)} st`;
    if (v > 1.02) return `+${Math.round((v - 1) * 12)} st`;
    return '±0';
  }

  // ─── RECORDING CONTROLS ──────────────────────────────────────
  function setupVocalControls() {
    const recBtn = document.getElementById('vocal-rec-btn');
    const stopBtn = document.getElementById('vocal-stop-rec-btn');
    const nameInput = document.getElementById('vocal-rec-name');

    if (!recBtn) return;

    recBtn.addEventListener('click', async () => {
      if (VocalEngine.isRecording) return;
      const name = nameInput?.value.trim() || `Vocal ${VocalEngine.recordedSamples.length + 1}`;
      try {
        await VocalEngine.startRecording(name);
      } catch(e) {
        showVocalToast('🎤 ' + e.message, 'error');
      }
    });

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        VocalEngine.stopRecording();
        updateRecordBtn(false);
      });
    }

    // Recorded samples list
    renderRecordedList();
  }

  function renderRecordedList() {
    const list = document.getElementById('recorded-samples-list');
    if (!list) return;
    const samples = VocalEngine.recordedSamples;
    if (samples.length === 0) {
      list.innerHTML = `<span class="vocal-rec-hint">No recordings yet</span>`;
      return;
    }
    list.innerHTML = samples.map((s, i) => `
      <div class="rec-sample-item">
        <span class="rec-sample-name">${s.name}</span>
        <span class="rec-sample-dur">${(s.buffer.duration).toFixed(1)}s</span>
        <button class="rec-preview-btn" data-ri="${i}" title="Preview">▶</button>
        <button class="rec-add-btn" data-ri="${i}" title="Add to sequencer">+</button>
        <button class="rec-del-btn" data-ri="${i}" title="Delete">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.rec-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ctx = AudioEngine.ctx;
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        VocalEngine.playRecordedSample(ctx, ctx.destination, parseInt(btn.dataset.ri), ctx.currentTime, 1.0, 0.8);
      });
    });

    list.querySelectorAll('.rec-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ri = parseInt(btn.dataset.ri);
        const sample = VocalEngine.recordedSamples[ri];
        vocalState.tracks.push(createTrack('recorded', ri, sample.name));
        renderVocalTracks();
        showVocalToast(`Added "${sample.name}" track`, 'info');
      });
    });

    list.querySelectorAll('.rec-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        VocalEngine.deleteRecordedSample(parseInt(btn.dataset.ri));
        renderRecordedList();
      });
    });
  }

  function updateRecordBtn(recording) {
    const recBtn = document.getElementById('vocal-rec-btn');
    const stopBtn = document.getElementById('vocal-stop-rec-btn');
    const indicator = document.getElementById('vocal-rec-indicator');
    if (recBtn) {
      recBtn.classList.toggle('recording', recording);
      recBtn.textContent = recording ? '● REC' : '● RECORD';
    }
    if (stopBtn) stopBtn.style.display = recording ? 'inline-flex' : 'none';
    if (indicator) indicator.style.display = recording ? 'inline-block' : 'none';
    renderRecordedList();
  }

  // ─── SCHEDULE (called by main transport) ─────────────────────
  function scheduleStep(step, time) {
    const ctx = AudioEngine.ctx;
    if (!ctx) return;

    vocalState.currentStep = step % vocalState.stepCount;

    vocalState.tracks.forEach(track => {
      if (track.muted) return;
      const s = track.steps[step % track.steps.length];
      if (!s) return;

      if (track.type === 'preset') {
        VocalEngine.playFormantVocal(
          ctx, ctx.destination,
          track.index, time,
          0.45, track.pitch, track.volume
        );
      } else if (track.type === 'recorded') {
        VocalEngine.playRecordedSample(
          ctx, ctx.destination,
          track.index, time,
          track.pitch, track.volume
        );
      }
    });
  }

  function updatePlayhead(step) {
    document.querySelectorAll('.vocal-step.playing').forEach(b => b.classList.remove('playing'));
    if (step >= 0) {
      const s = step % vocalState.stepCount;
      document.querySelectorAll(`.vocal-step[data-si="${s}"]`).forEach(b => b.classList.add('playing'));
    }
    vocalState.currentStep = step;
  }

  function showVocalToast(msg, type) {
    if (window.showToast) showToast(msg, type);
  }

  function clearAll() {
    vocalState.tracks.forEach(t => t.steps.fill(false));
    renderVocalTracks();
  }

  return {
    init,
    scheduleStep,
    updatePlayhead,
    clearAll,
    get tracks() { return vocalState.tracks; },
  };
})();
