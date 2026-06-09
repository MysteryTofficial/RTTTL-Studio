const AppState = {
  bpm: 120,
  defaultDuration: 4,
  defaultOctave: 5,
  rtttlName: 'Melody',
  notes: [],
  isPlaying: false,
  currentBeat: 0,
  scale: 'chromatic',
  snapDivision: 4,
  deferredPrompt: null,
  isInstalled: false
};

const AudioEng = new AudioEngine();
let pianoRoll = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function init() {
  initPianoRoll();
  initTransportControls();
  initRTTTLControls();
  initAudioExport();
  initMIDIImport();
  initPWA();
  initScaleSelector();
  initExampleLoader();
  initKeyboard();
  const loaded = loadRTTTLFromURL();
  if (!loaded) {
    updateStatus('Ready - click "🎲 Example" to load a demo or paste RTTTL above', 'info');
  }
}

function initPianoRoll() {
  const container = $('#piano-roll-scroll-container');
  const canvas = $('#piano-roll-canvas');

  pianoRoll = new PianoRoll(canvas, container, {
    cellWidth: 30,
    rowHeight: 20,
    keyboardWidth: 56,
    numBeats: 32
  });

  pianoRoll.onNoteChange = (note) => {
    updateRTTTLOutput();
    updateNoteCount();
    updateDurationDisplay();
  };

  pianoRoll.onNoteHover = (note) => {
    if (note) {
      AudioEng.playPreviewNote(note.midi, 0.1);
    }
  };

  window.addEventListener('resize', () => {
    pianoRoll.resize();
  });
}

function initTransportControls() {
  $('#btn-play').addEventListener('click', playSequence);
  $('#btn-stop').addEventListener('click', stopPlayback);
  $('#bpm-slider').addEventListener('input', (e) => {
    AppState.bpm = parseInt(e.target.value) || 120;
    $('#bpm-display').textContent = AppState.bpm;
    updateDurationDisplay();
  });
  $('#default-duration').addEventListener('change', (e) => {
    AppState.defaultDuration = parseInt(e.target.value) || 4;
    const cellsPerNote = 16 / AppState.defaultDuration;
    pianoRoll.defaultNoteCells = Math.max(1, cellsPerNote);
  });
}

function initRTTTLControls() {
  $('#btn-parse').addEventListener('click', importRTTTL);
  $('#rtttl-input').addEventListener('input', () => {
    const str = $('#rtttl-input').value;
    if (str.length > 10) {
      const result = validateRTTTL(str);
      updateValidationUI(result);
    }
  });
  $('#btn-clear').addEventListener('click', () => {
    pianoRoll.clearNotes();
    updateRTTTLOutput();
    updateNoteCount();
  });
}

function initAudioExport() {
  $('#btn-export-wav').addEventListener('click', async () => {
    await exportAudio('wav');
  });
  $('#btn-export-mp3').addEventListener('click', async () => {
    await exportAudio('mp3');
  });
}

function initMIDIImport() {
  const dropZone = $('#midi-drop-zone');
  const fileInput = $('#midi-file-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-cyan-400', 'bg-slate-700/50');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-cyan-400', 'bg-slate-700/50');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-cyan-400', 'bg-slate-700/50');
    const files = e.dataTransfer.files;
    if (files.length > 0) processMIDIFile(files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      processMIDIFile(e.target.files[0]);
      fileInput.value = '';
    }
  });
}

function initPWA() {
  const installBtn = $('#install-btn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    AppState.deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (AppState.deferredPrompt) {
      AppState.deferredPrompt.prompt();
      const result = await AppState.deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        AppState.isInstalled = true;
        installBtn.classList.add('hidden');
      }
      AppState.deferredPrompt = null;
    }
  });

  window.addEventListener('appinstalled', () => {
    AppState.isInstalled = true;
    installBtn.classList.add('hidden');
  });

  if (window.matchMedia('(display-mode: standalone)').matches) {
    AppState.isInstalled = true;
    installBtn.classList.add('hidden');
  }
}

function initScaleSelector() {
  const select = $('#scale-select');
  select.addEventListener('change', (e) => {
    AppState.scale = e.target.value;
    if (pianoRoll) pianoRoll.setScale(e.target.value);
  });
  if (pianoRoll) pianoRoll.setScale(select.value);
}

function initExampleLoader() {
  $('#btn-load-example').addEventListener('click', loadExample);
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (AppState.isPlaying) stopPlayback();
        else playSequence();
        break;
      case 'KeyP':
        stopPlayback();
        break;
    }
  });
}

function playSequence() {
  if (AppState.isPlaying) {
    stopPlayback();
    return;
  }

  const rtttlNotes = pianoRoll.getNotesAsRTTTL();
  if (rtttlNotes.length === 0) {
    updateStatus('No notes to play', 'warning');
    return;
  }

  AppState.isPlaying = true;
  $('#btn-play').textContent = '⏸';
  $('#btn-play').classList.add('playing');

  AudioEng.onBeatCallback = (beat) => {
    AppState.currentBeat = beat;
    pianoRoll.setPlayhead(beat);
  };

  AudioEng.onStopCallback = () => {
    AppState.isPlaying = false;
    $('#btn-play').textContent = '▶';
    $('#btn-play').classList.remove('playing');
    pianoRoll.clearPlayhead();
  };

  AudioEng.playSequence(rtttlNotes, AppState.bpm);
  updateStatus('Playing...', 'info');
}

function stopPlayback() {
  AudioEng.stopSequence();
  AppState.isPlaying = false;
  $('#btn-play').textContent = '▶';
  $('#btn-play').classList.remove('playing');
  pianoRoll.clearPlayhead();
  updateStatus('Stopped', 'info');
}

function importRTTTL() {
  const str = $('#rtttl-input').value.trim();
  if (!str) {
    updateStatus('Please enter an RTTTL string', 'error');
    return;
  }

  const result = validateRTTTL(str);
  updateValidationUI(result);

  if (!result.valid) {
    const msgs = result.errors.map(e => e.message).join('; ');
    updateStatus(`Parse error: ${msgs}`, 'error');
    return;
  }

  const data = result.result;
  AppState.bpm = data.bpm;
  AppState.defaultDuration = data.defaultDuration;
  AppState.defaultOctave = data.defaultOctave;
  AppState.rtttlName = data.name;

  AppState.bpm = Math.max(40, Math.min(300, parseInt(data.bpm) || 120));
  $('#bpm-slider').value = AppState.bpm;
  $('#bpm-display').textContent = AppState.bpm;
  $('#default-duration').value = data.defaultDuration;
  pianoRoll.defaultNoteCells = Math.max(1, 16 / AppState.defaultDuration);

  pianoRoll.setNotesFromRTTTL(data.notes, data.bpm);

  updateRTTTLOutput();
  updateNoteCount();
  updateDurationDisplay();
  updateStatus(`Imported "${data.name}" (${data.notes.length} notes, ${data.bpm} BPM)`, 'success');
}

function updateRTTTLOutput() {
  const notes = pianoRoll.getNotesAsRTTTL();
  const str = compileRTTTL(AppState.rtttlName, {
    defaultDuration: AppState.defaultDuration,
    defaultOctave: AppState.defaultOctave,
    bpm: AppState.bpm
  }, notes);

  $('#rtttl-input').value = str;

  const result = validateRTTTL(str);
  updateValidationUI(result);

  try {
    const url = new URL(window.location);
    url.searchParams.set('rtttl', str);
    window.history.replaceState({}, '', url);
  } catch (e) {}
}

function updateValidationUI(result) {
  const el = $('#validation-status');
  if (result.valid) {
    el.className = 'text-xs font-mono text-emerald-400';
    el.textContent = '✓ Valid RTTTL';
  } else {
    el.className = 'text-xs font-mono text-rose-400';
    const msgs = result.errors.map(e => e.message).join('; ');
    el.textContent = `✗ ${msgs}`;
  }
}

function updateNoteCount() {
  if (!pianoRoll || !pianoRoll.notes) {
    $('#note-count').textContent = '0 notes';
    return;
  }
  const count = pianoRoll.notes.length;
  $('#note-count').textContent = `${count} note${count !== 1 ? 's' : ''}`;
}

function updateDurationDisplay() {
  const durEl = $('#duration-display');
  if (!pianoRoll || !pianoRoll.notes || pianoRoll.notes.length === 0) {
    durEl.textContent = '--';
    return;
  }
  const bpm = parseInt(AppState.bpm) || 120;
  const beatDuration = 60 / bpm;
  let maxCell = 0;
  for (const n of pianoRoll.notes) {
    if (n.endCell > maxCell) maxCell = n.endCell;
  }
  if (maxCell === 0) {
    durEl.textContent = '--';
    return;
  }
  const cellDuration = beatDuration / pianoRoll.beatDivision;
  const totalSeconds = maxCell * cellDuration;
  if (!isFinite(totalSeconds) || totalSeconds < 0) {
    durEl.textContent = '--';
    return;
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  durEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateStatus(msg, type = 'info') {
  const el = $('#status-message');
  el.textContent = msg;
  el.className = 'text-sm font-mono px-3 py-1.5 rounded-lg ';
  switch (type) {
    case 'error': el.className += 'bg-rose-900/50 text-rose-300 border border-rose-700'; break;
    case 'success': el.className += 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'; break;
    case 'warning': el.className += 'bg-amber-900/50 text-amber-300 border border-amber-700'; break;
    default: el.className += 'bg-slate-800/50 text-slate-300 border border-slate-700';
  }
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => {
    if (type !== 'error') {
      el.textContent = 'Ready';
      el.className = 'text-sm font-mono text-slate-500';
    }
  }, 5000);
}

async function exportAudio(format) {
  const notes = pianoRoll.getNotesAsRTTTL();
  if (notes.length === 0) {
    updateStatus('No notes to export', 'warning');
    return;
  }

  updateStatus(`Rendering ${format.toUpperCase()}...`, 'info');

  try {
    let blob;
    if (format === 'mp3') {
      if (typeof lamejs === 'undefined') {
        updateStatus('MP3 encoder not loaded. Please check your internet connection.', 'error');
        return;
      }
      blob = await renderToMp3Blob(notes, AppState.bpm);
    } else {
      blob = await renderToWavBlob(notes, AppState.bpm);
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${AppState.rtttlName.replace(/[^a-zA-Z0-9]/g, '_')}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateStatus(`Exported as ${format.toUpperCase()}`, 'success');
  } catch (err) {
    updateStatus(`Export failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function processMIDIFile(file) {
  const name = file.name.replace(/\.midi?$/i, '');
  if (!file.name.toLowerCase().endsWith('.mid') && !file.name.toLowerCase().endsWith('.midi')) {
    updateStatus('Please upload a Standard MIDI File (.mid)', 'error');
    return;
  }

  if (file.size > 512 * 1024) {
    updateStatus('File too large (max 500KB)', 'error');
    return;
  }

  updateStatus('Parsing MIDI file...', 'info');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = parseMIDIFile(arrayBuffer);

    if (!result.notes || result.notes.length === 0) {
      updateStatus('No notes found in MIDI file.', 'error');
      return;
    }

    const noteCount = result.notes.filter(n => n.midi >= 0).length;
    const midiName = result.name && result.name !== 'MIDI Import' ? result.name : name;
    AppState.bpm = result.bpm;
    AppState.rtttlName = midiName;
    AppState.defaultDuration = result.defaultDuration || 4;
    AppState.defaultOctave = result.defaultOctave || 5;

    $('#bpm-slider').value = result.bpm;
    $('#bpm-display').textContent = result.bpm;

    pianoRoll.setNotesFromRTTTL(result.notes, result.bpm);
    updateRTTTLOutput();
    updateNoteCount();
    updateDurationDisplay();

    updateStatus(`Imported "${midiName}" — ${noteCount} notes (monophonic reduction, ${result.bpm} BPM)`, 'success');
  } catch (err) {
    updateStatus(`MIDI import failed: ${err.message}`, 'error');
    console.error(err);
  }
}

function loadRTTTLFromURL() {
  const params = new URLSearchParams(window.location.search);
  const rtttl = params.get('rtttl');
  if (rtttl) {
    const decoded = decodeURIComponent(rtttl);
    $('#rtttl-input').value = decoded;
    try {
      importRTTTL();
      return true;
    } catch (e) {
      updateStatus('Failed to load RTTTL from URL: ' + e.message, 'error');
      return false;
    }
  }
  return false;
}

function loadExample() {
  const examples = [
    {
      name: 'Smarts',
      rtttl: 'Smarts:d=4,o=5,b=125:8c,8d,8e,8f,4g,4g,8a,8a,4g,8a,8a,4g,8f,8f,4e,4e,8d,8d,4c'
    },
    {
      name: 'Nokia',
      rtttl: 'Nokia:d=4,o=5,b=160:8e6,8d6,8f#6,8e6,8d6,8f#6,8e6,8d6,8c#6,8b5,8a5,8b5,4c#6,8d6,8e6,8d6,8c#6,8b5,8a5,8b5,8c#6,8d6,4e6'
    },
    {
      name: 'Imperial',
      rtttl: 'Imperial:d=4,o=5,b=100:4g,4g,4g,8d#,8a#,4g,8d#,8a#,4g,4d,4d,4d,8d#,8a#,4g,8d#,8a#,4g'
    },
    {
      name: 'Mario',
      rtttl: 'Mario:d=4,o=5,b=120:8e6,8e6,0,8e6,0,8c6,8e6,0,8g6,0,4g,0,8c6,0,8g,0,8e,0,8a,0,8b,0,8a#,8a,0,8g,8e6,8g6,8a6,0,8f6,8g6,0,8e6,0,8c6,8d6,8b,0'
    },
    {
      name: 'Tetris',
      rtttl: 'Tetris:d=4,o=5,b=140:8e6,8b5,8c6,8d6,8e6,8d6,8c6,8b5,8a5,8a5,8c6,8e6,8d6,8c6,8b5,8c6,8d6,8e6,8c6,8a5,8a5,8a5,8b5,8c6,8d6,8f6,8a6,8g6,8f6,8e6,8c6,8e6,8d6,8c6,8b5,8b5,8c6,8d6,8e6,8c6,8a5,8a5'
    }
  ];

  const example = examples[Math.floor(Math.random() * examples.length)];
  $('#rtttl-input').value = example.rtttl;
  AppState.rtttlName = example.name;
  importRTTTL();
}

document.addEventListener('DOMContentLoaded', init);
