class MIDIParser {
  parse(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    let offset = 0;

    if (this.readString(data, offset, 4) !== 'MThd') {
      throw new Error('Not a valid MIDI file (missing MThd header)');
    }
    offset += 4;

    offset += 4;
    const format = this.readUint16(data, offset); offset += 2;
    const numTracks = this.readUint16(data, offset); offset += 2;
    const ticksPerQuarter = this.readUint16(data, offset); offset += 2;

    if (format > 1) {
      throw new Error(`MIDI format ${format} not supported (only 0 and 1)`);
    }

    const allEvents = [];
    let tempo = 500000;
    let trackName = '';

    for (let t = 0; t < numTracks; t++) {
      if (this.readString(data, offset, 4) !== 'MTrk') {
        throw new Error(`Invalid track chunk at track ${t}`);
      }
      offset += 4;
      const trackLen = this.readUint32(data, offset); offset += 4;
      const trackEnd = offset + trackLen;
      let absTicks = 0;
      let runningStatus = 0;

      while (offset < trackEnd) {
        const delta = this.readVLQ(data, offset);
        offset += delta.length;
        absTicks += delta.value;

        if (data[offset] === 0xFF) {
          offset++;
          const metaType = data[offset]; offset++;
          const metaLen = this.readVLQ(data, offset);
          offset += metaLen.length;

          if (metaType === 0x51 && metaLen.value === 3) {
            tempo = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
          }
          if (metaType === 0x03 && metaLen.value > 0) {
            let name = '';
            for (let i = 0; i < metaLen.value; i++) {
              name += String.fromCharCode(data[offset + i]);
            }
            if (!trackName) trackName = name;
          }
          offset += metaLen.value;
          continue;
        }

        let status = data[offset];
        if (status < 0x80) {
          status = runningStatus;
        } else {
          offset++;
        }

        const statusHigh = status >> 4;
        const statusLow = status & 0x0F;

        if (statusHigh === 0x9 || statusHigh === 0x8) {
          const note = data[offset];
          const velocity = data[offset + 1];
          offset += 2;
          runningStatus = status;

          const isNoteOn = statusHigh === 0x9 && velocity > 0;
          allEvents.push({
            ticks: absTicks,
            type: isNoteOn ? 'on' : 'off',
            note,
            velocity: isNoteOn ? velocity : 0,
            channel: statusLow
          });
        } else if (statusHigh === 0xB || statusHigh === 0xE) {
          offset += 2; runningStatus = status;
        } else if (statusHigh === 0xC || statusHigh === 0xD) {
          offset += 1; runningStatus = status;
        } else if (statusHigh === 0xA) {
          offset += 2; runningStatus = status;
        } else {
          offset++;
        }
      }
    }

    if (allEvents.length === 0) {
      throw new Error('No note events found in MIDI file');
    }

    const filtered = allEvents.filter(e => e.channel !== 9);
    if (filtered.length === 0) {
      throw new Error('Only drum track (channel 10) found — no melodic notes to convert');
    }

    const bpm = Math.round(60000000 / tempo);
    const monoNotes = this.monophonicReduce(filtered, ticksPerQuarter);
    return this.toRTTTL(monoNotes, ticksPerQuarter, bpm, trackName);
  }

  monophonicReduce(events, ticksPerQuarter) {
    events.sort((a, b) => a.ticks - b.ticks);

    const pairs = [];
    const active = {};

    for (const evt of events) {
      if (evt.type === 'on') {
        if (active[evt.note] === undefined) {
          active[evt.note] = { start: evt.ticks, velocity: evt.velocity };
        }
      } else {
        if (active[evt.note] !== undefined) {
          pairs.push({
            start: active[evt.note].start,
            end: evt.ticks,
            note: evt.note,
            velocity: active[evt.note].velocity
          });
          delete active[evt.note];
        }
      }
    }

    for (const key in active) {
      pairs.push({
        start: active[key].start,
        end: active[key].start + ticksPerQuarter,
        note: parseInt(key),
        velocity: active[key].velocity
      });
    }

    pairs.sort((a, b) => a.start - b.start);

    const noteEvents = [];
    for (const p of pairs) {
      noteEvents.push({ tick: p.start, type: 'on', note: p.note, velocity: p.velocity });
      noteEvents.push({ tick: p.end, type: 'off', note: p.note });
    }
    noteEvents.sort((a, b) => a.tick - b.tick);

    const activeSet = new Map();
    let highestNote = -1;
    let currentStart = 0;
    const monoNotes = [];

    for (const evt of noteEvents) {
      if (evt.type === 'on') {
        activeSet.set(evt.note, evt.velocity);
      } else {
        activeSet.delete(evt.note);
      }

      const newHighest = activeSet.size > 0 ? Math.max(...activeSet.keys()) : -1;

      if (newHighest !== highestNote) {
        const durTicks = evt.tick - currentStart;
        if (highestNote >= 0 && durTicks >= ticksPerQuarter / 32) {
          monoNotes.push({
            start: currentStart,
            end: evt.tick,
            note: highestNote,
            velocity: activeSet.get(highestNote) || 80
          });
        }
        highestNote = newHighest;
        currentStart = evt.tick;
      }
    }

    if (highestNote >= 0) {
      const durTicks = currentStart - monoNotes.length > 0
        ? currentStart - (monoNotes[monoNotes.length - 1]?.start || 0)
        : ticksPerQuarter;
      if (durTicks >= ticksPerQuarter / 32) {
        monoNotes.push({
          start: monoNotes.length > 0 ? monoNotes[monoNotes.length - 1].end : 0,
          end: currentStart + ticksPerQuarter,
          note: highestNote,
          velocity: 80
        });
      }
    }

    return monoNotes;
  }

  clampNote(midi) {
    const MIN_MIDI = 24;
    const MAX_MIDI = 108;

    if (midi < MIN_MIDI) {
      const octavesUp = Math.ceil((MIN_MIDI - midi) / 12);
      return midi + octavesUp * 12;
    }
    if (midi > MAX_MIDI) {
      const octavesDown = Math.ceil((midi - MAX_MIDI) / 12);
      return midi - octavesDown * 12;
    }
    return midi;
  }

  toRTTTL(notes, ticksPerQuarter, bpm, name) {
    const RTTTL_DURS = [32, 16, 8, 4, 2, 1];
    const MIN_DUR_TICKS = Math.max(1, Math.round(ticksPerQuarter / 32));
    let rtttlNotes = [];
    let lastEnd = 0;

    for (const n of notes) {
      const clamped = this.clampNote(n.note);

      const durTicks = n.end - n.start;
      if (durTicks < MIN_DUR_TICKS) continue;

      if (n.start > lastEnd) {
        const gapTicks = n.start - lastEnd;
        if (gapTicks >= MIN_DUR_TICKS) {
          const gapDur = this.closestDuration(gapTicks, ticksPerQuarter, RTTTL_DURS);
          if (gapDur && gapDur.dur <= 32) {
            rtttlNotes.push({
              duration: gapDur.dur,
              pitch: 'p',
              octave: 5,
              midi: -1,
              dotted: gapDur.dotted,
              tie: false,
              _explicitOctave: false
            });
          }
        }
      }

      const durInfo = this.closestDuration(durTicks, ticksPerQuarter, RTTTL_DURS);
      if (durInfo && durInfo.dur <= 32) {
        const semitone = clamped % 12;
        const octave = Math.floor(clamped / 12) - 1;

        if (octave < 0) continue;
        if (octave > 8) continue;

        rtttlNotes.push({
          duration: durInfo.dur,
          pitch: SEMITONE_TO_NOTE[semitone],
          octave,
          midi: clamped,
          dotted: durInfo.dotted,
          tie: false,
          _explicitOctave: false,
          velocity: Math.min(1, (n.velocity || 80) / 127)
        });

        if (n.end > lastEnd) lastEnd = n.end;
      }
    }

    rtttlNotes = this.mergeAdjacentSamePitch(rtttlNotes);

    const MAX_NOTES = 200;
    if (rtttlNotes.length > MAX_NOTES) {
      const melodic = rtttlNotes.filter(n => n.midi >= 0);
      if (melodic.length > MAX_NOTES) {
        const keep = melodic.slice(0, MAX_NOTES);
        rtttlNotes = rtttlNotes.filter(n => n.midi < 0 || keep.includes(n));
      }
    }

    let defaultDuration = 4;
    const durCounts = {};
    for (const n of rtttlNotes) {
      if (n.pitch !== 'p') {
        durCounts[n.duration] = (durCounts[n.duration] || 0) + 1;
      }
    }
    let maxCount = 0;
    for (const [d, c] of Object.entries(durCounts)) {
      if (c > maxCount) { maxCount = c; defaultDuration = parseInt(d); }
    }

    return {
      notes: rtttlNotes,
      bpm: Math.max(40, Math.min(300, bpm)),
      defaultDuration,
      defaultOctave: 5,
      name: name || 'MIDI Import'
    };
  }

  mergeAdjacentSamePitch(notes) {
    if (notes.length === 0) return [];
    const merged = [];
    let current = { ...notes[0] };

    for (let i = 1; i < notes.length; i++) {
      const n = notes[i];
      if (n.pitch === current.pitch && n.pitch !== 'p' && !n.dotted && !current.dotted) {
        const sumTicks = this.durToTicks(current.duration, 480) + this.durToTicks(n.duration, 480);
        const mergedDur = this.closestDuration(sumTicks, 480, [32, 16, 8, 4, 2, 1]);
        if (mergedDur && mergedDur.dur <= 32) {
          current.duration = mergedDur.dur;
          current.dotted = mergedDur.dotted;
          continue;
        }
      }
      merged.push(current);
      current = { ...n };
    }
    merged.push(current);
    return merged;
  }

  durToTicks(dur, ticksPerQuarter) {
    const quarters = 4 / dur;
    return Math.round(quarters * ticksPerQuarter);
  }

  closestDuration(ticks, ticksPerQuarter, durations) {
    const quarters = ticks / ticksPerQuarter;
    let best = null;
    let bestDiff = Infinity;

    for (const d of durations) {
      const stdQuarters = 4 / d;
      const diff = Math.abs(quarters - stdQuarters);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = { dur: d, dotted: false };
      }
      const dottedQuarters = stdQuarters * 1.5;
      const dotDiff = Math.abs(quarters - dottedQuarters);
      if (dotDiff < bestDiff) {
        bestDiff = dotDiff;
        best = { dur: d, dotted: true };
      }
    }

    return best;
  }

  readString(data, offset, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(data[offset + i]);
    }
    return s;
  }

  readUint32(data, offset) {
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  }

  readUint16(data, offset) {
    return (data[offset] << 8) | data[offset + 1];
  }

  readVLQ(data, offset) {
    let value = 0;
    let len = 0;
    let byte;
    do {
      byte = data[offset + len];
      value = (value << 7) | (byte & 0x7F);
      len++;
    } while (byte & 0x80);
    return { value, length: len };
  }
}

function parseMIDIFile(arrayBuffer) {
  const parser = new MIDIParser();
  return parser.parse(arrayBuffer);
}
