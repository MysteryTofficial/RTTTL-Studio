const NOTE_TO_SEMITONE = {
  'c': 0, 'c#': 1, 'db': 1,
  'd': 2, 'd#': 3, 'eb': 3,
  'e': 4,
  'f': 5, 'f#': 6, 'gb': 6,
  'g': 7, 'g#': 8, 'ab': 8,
  'a': 9, 'a#': 10, 'bb': 10,
  'b': 11
};

const SEMITONE_TO_NOTE = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi) {
  if (midi < 0 || midi > 127) return '--';
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12;
  return SEMITONE_TO_NOTE[semitone] + octave;
}

function midiToDisplayName(midi) {
  if (midi < 0) return 'Rest';
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12;
  return NOTE_NAMES[semitone] + octave;
}

function noteNameToMidi(noteName, octave) {
  if (noteName === 'p') return -1;
  const semitone = NOTE_TO_SEMITONE[noteName];
  if (semitone === undefined) return -1;
  const clampedOctave = Math.max(0, Math.min(8, octave));
  return semitone + (clampedOctave + 1) * 12;
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parseRTTTL(str) {
  str = str.trim();
  if (!str) throw new Error('Empty RTTTL string');

  const parts = str.split(':');
  if (parts.length < 3) {
    throw new Error('Invalid RTTTL format: expected format is "name:d=4,o=5,b=125:note1,note2,..."');
  }

  const name = parts[0].trim();

  const headerStr = parts[1];
  const headerParts = headerStr.split(',');
  let defaultDuration = 4;
  let defaultOctave = 5;
  let bpm = 120;

  for (const hp of headerParts) {
    const trimmed = hp.trim();
    if (trimmed.startsWith('d=')) {
      const val = parseInt(trimmed.substring(2));
      if (!isNaN(val) && val > 0) defaultDuration = val;
    } else if (trimmed.startsWith('o=')) {
      const val = parseInt(trimmed.substring(2));
      if (!isNaN(val) && val >= 0 && val <= 8) defaultOctave = val;
    } else if (trimmed.startsWith('b=')) {
      const val = parseInt(trimmed.substring(2));
      if (!isNaN(val) && val > 0) bpm = val;
    }
  }

  const notesStr = parts.slice(2).join(':');
  const noteTokens = notesStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const notes = [];
  const errors = [];

  let currentOctave = defaultOctave;

  for (let i = 0; i < noteTokens.length; i++) {
    try {
      const note = parseNoteToken(noteTokens[i], defaultDuration, currentOctave);
      if (note.octave !== undefined && note.pitch !== 'p') {
        currentOctave = note.octave;
      }
      notes.push(note);
    } catch (e) {
      errors.push({ index: i, token: noteTokens[i], message: e.message });
    }
  }

  return { name, bpm, defaultDuration, defaultOctave, notes, errors };
}

function parseNoteToken(token, defaultDuration, defaultOctave) {
  let i = 0;

  let durationStr = '';
  while (i < token.length && /\d/.test(token[i])) {
    durationStr += token[i];
    i++;
  }
  const duration = durationStr ? parseInt(durationStr) : defaultDuration;

  const pitchStart = i;
  let pitchName = '';
  if (i < token.length) {
    const c = token[i].toLowerCase();
    if (c >= 'a' && c <= 'g') {
      pitchName = c;
      i++;
      if (i < token.length && (token[i] === '#' || token[i] === 'b')) {
        pitchName += token[i] === '#' ? '#' : 'b';
        i++;
      }
    } else if (c === 'p') {
      pitchName = 'p';
      i++;
    } else {
      throw new Error(`Invalid character "${token[i]}" at position ${i}, expected note letter or 'p'`);
    }
  }

  if (i < token.length && token[i] === '-') {
    throw new Error(`Negative octave in "${token}" is not valid in RTTTL`);
  }

  let octaveStr = '';
  while (i < token.length && /\d/.test(token[i])) {
    octaveStr += token[i];
    i++;
  }
  const explicitOctave = octaveStr ? parseInt(octaveStr) : undefined;
  const octave = explicitOctave !== undefined ? explicitOctave : defaultOctave;

  let dotted = false;
  let tie = false;
  while (i < token.length) {
    if (token[i] === '.') dotted = true;
    else if (token[i] === '_' || token[i] === '&') tie = true;
    else throw new Error(`Unexpected character "${token[i]}" at position ${i}`);
    i++;
  }

  const midi = pitchName === 'p' ? -1 : noteNameToMidi(pitchName, octave);

  return {
    duration,
    pitch: pitchName,
    octave,
    dotted,
    tie,
    midi,
    _explicitOctave: explicitOctave !== undefined
  };
}

function compileRTTTL(name, config, notes) {
  const defaultDuration = config.defaultDuration || 4;
  const defaultOctave = Math.max(0, Math.min(8, config.defaultOctave || 5));
  const bpm = config.bpm || 120;

  const headerStr = `d=${defaultDuration},o=${defaultOctave},b=${bpm}`;

  let lastOctave = defaultOctave;

  const noteStrs = notes.map(note => {
    let str = '';

    if (note.duration !== defaultDuration) {
      str += note.duration;
    }

    str += note.pitch;

    if (note.pitch !== 'p') {
      let octave = note.octave !== undefined ? note.octave : lastOctave;
      octave = Math.max(0, Math.min(8, octave));
      if (octave !== lastOctave) {
        str += octave;
      } else if (note._explicitOctave) {
        str += octave;
      }
      lastOctave = octave;
    }

    if (note.dotted) str += '.';
    if (note.tie) str += '_';

    return str;
  });

  return `${name}:${headerStr}:${noteStrs.join(',')}`;
}

function validateRTTTL(str) {
  try {
    const result = parseRTTTL(str);
    if (result.errors.length > 0) {
      return { valid: false, errors: result.errors, result };
    }
    return { valid: true, errors: [], result };
  } catch (e) {
    return { valid: false, errors: [{ index: -1, token: '', message: e.message }], result: null };
  }
}

function formatRTTTLDuration(duration) {
  const durations = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
  return durations[duration] || `${duration}`;
}
