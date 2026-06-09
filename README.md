# RTTTL Studio

A production-ready offline-capable PWA for creating, editing, and converting RTTTL ringtone files. Features a visual canvas piano roll, monophonic MIDI import, velocity editing, bidirectional text engine, and realistic Web Audio synthesis with WAV/MP3 export.

## Features

- **Canvas Piano Roll** — C4–C7 (3 octaves), left-click add, right-click remove, drag move/resize, scale enforcement
- **Velocity Lane** — per-note velocity editing with click/drag, right-click reset, tooltip display
- **RTTTL Engine** — full parser/compiler with support for rests (`p`), dotted notes, ties, explicit/implicit octaves, accidentals
- **MIDI Import** — binary SMF format 0 & 1 parsing, monophonic melody reduction from polyphonic input, drum channel (10) exclusion, auto-BPM detection, track name extraction
- **Audio Synthesis** — dual detuned sawtooth oscillators, sub-oscillator, convolution reverb (noise IR), filter envelope, volume LFO, velocity response
- **Audio Export** — WAV (native) and MP3 (via lamejs) render-to-file
- **PWA** — offline support via service worker, installable, URL sharing via `?rtttl=` query parameter
- **Dark Cyberpunk UI** — Tailwind CSS, responsive layout (side-by-side on desktop, stacked on mobile)

## Usage

1. Open `index.html` in a browser or serve via any HTTP server
2. Paste an RTTTL string and click **Parse & Import**, or click an **Example** to load a demo
3. Click/drag on the piano roll to add/edit notes, right-click to remove
4. Adjust velocity in the velocity lane below the keyboard
5. Press **Play** (or Space) to hear the result
6. Export as **WAV** or **MP3**
7. Drop a `.mid` file to import MIDI → RTTTL

### Query Parameter

```
?rtttl=Smarts:d=4,o=5,b=125:8c,8d,8e,8f,4g,4g
```

Auto-loads a melody on page load.

## Architecture

```
index.html              — UI shell, Tailwind CDN, dark theme
js/
  rtttl-engine.js       — RTTTL parser, compiler, validator, MIDI/frequency helpers
  audio-engine.js       — Web Audio synth, play sequence, offline WAV/MP3 rendering
  midi-parser.js        — Binary SMF parser, monophonic reduction, note clamping
  piano-roll.js         — Canvas piano roll, velocity lane, grid interactions
  app.js                — Main app wiring, transport, MIDI import UI, PWA
manifest.json           — PWA manifest
sw.js                   — Service worker (cache-first, CDN caching)
```

### Key Design Decisions

- Canvas-based piano roll (not DOM) for smooth playhead animation
- Grid cells = 16th notes; 1 beat = 4 cells; quarter note = 4 cells
- Monophonic grid enforced (RTTTL is single-note by design)
- MIDI import uses highest-note tracking for polyphonic reduction
- MIDI range clamped to 24–108; notes below 24 are transposed up by octave
- Velocity stored per note internally; lost on RTTTL round-trip (format has no velocity field)
- MIDI note limit: 200 melodic notes; grid capped at 1024 cells (~2 minutes at 120 BPM)

### RTTTL Format

```
name:d=defaultDuration,o=defaultOctave,b=bpm:note1,note2,...
```

Each note: `[duration][pitch][octave][.][tie]`

- Duration: `1`, `2`, `4`, `8`, `16`, `32` (1 = whole note)
- Pitch: `p` (rest), `a`–`g` (optionally with `#` for sharp)
- Octave: `4`–`6` typically, range `0`–`8`
- `.` = dotted (1.5× duration)
- `~` = tie (merge with next note)

## MIDI Import Details

- Reads SMF format 0 and 1
- Variable-length values, running status, tempo meta events
- Channel 10 (drums) always excluded
- Polyphonic input reduced to monophonic by tracking the highest active pitch at each tick
- Adjacent same-pitch notes are merged into longer durations
- Gaps between notes filled with rests
- BPM extracted from tempo meta events (`FF 51 03`)

## License

MIT
