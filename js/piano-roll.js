const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9]
};

class PianoRoll {
  constructor(canvas, container, options = {}) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');

    this.lowestMidi = 60;
    this.highestMidi = 96;
    this.totalKeys = this.highestMidi - this.lowestMidi + 1;

    this.cellWidth = options.cellWidth || 32;
    this.rowHeight = options.rowHeight || 20;
    this.keyboardWidth = options.keyboardWidth || 60;
    this.numBeats = options.numBeats || 32;
    this.beatDivision = 4;
    this.totalCells = this.numBeats * this.beatDivision;

    this.notes = [];
    this.hoveredNote = null;
    this.selectedNote = null;
    this.scale = 'chromatic';
    this.playheadBeat = -1;
    this.isPlaying = false;
    this.defaultNoteCells = 4;

    this.isDragging = false;
    this.dragDidMove = false;
    this.dragType = null;
    this.dragNote = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartCell = 0;
    this.dragNoteStartCell = 0;
    this.dragNoteEndCell = 0;
    this.velocityDragStartY = 0;
    this.velocityDragBase = 0;

    this.defaultVelocity = 0.7;

    this.onNoteChange = null;
    this.onNoteHover = null;
    this.onNoteClick = null;

    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.animationFrame = null;

    this.tooltipEl = null;

    this.setupCanvas();
    this.setupEvents();
    this.render();
  }

  get gridLeft() {
    return this.keyboardWidth + 8;
  }

  get totalWidth() {
    return this.gridLeft + this.totalCells * this.cellWidth;
  }

  get VELOCITY_LANE_HEIGHT() { return 24; }
  get VELOCITY_LANE_GAP() { return 4; }

  get totalHeight() {
    return this.totalKeys * this.rowHeight + this.VELOCITY_LANE_HEIGHT + this.VELOCITY_LANE_GAP;
  }

  setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = this.totalWidth;
    const height = this.totalHeight;

    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.scale(dpr, dpr);

    this.displayWidth = width;
    this.displayHeight = height;
    this.dpr = dpr;
  }

  setupEvents() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));

    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });

    this.container.addEventListener('scroll', () => {
      this.scrollLeft = this.container.scrollLeft;
      this.scrollTop = this.container.scrollTop;
      this.render();
    });

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'piano-roll-tooltip';
    this.tooltipEl.style.cssText = `
      position: fixed; display: none; background: #1e293b; color: #e2e8f0;
      padding: 4px 10px; border-radius: 6px; font-size: 12px;
      border: 1px solid #4f46e5; pointer-events: none; z-index: 100;
      font-family: 'Courier New', monospace; white-space: nowrap;
    `;
    document.body.appendChild(this.tooltipEl);
  }

  handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    this.processPointerDown(x, y);
  }

  handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    this.processPointerMove(x, y);
  }

  handleTouchEnd(e) {
    e.preventDefault();
    this.processPointerUp();
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.processPointerDown(x, y);
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.processPointerMove(x, y);
  }

  handleMouseUp(e) {
    this.processPointerUp();
  }

  handleMouseLeave() {
    this.tooltipEl.style.display = 'none';
    if (!this.isDragging) {
      this.hoveredNote = null;
    }
  }

  handleClick(e) {
    if (this.dragDidMove) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pos = this.screenToGrid(x, y);
    const cell = pos.cell, midi = pos.midi;
    if (cell >= 0 && midi >= 0) {
      const existing = this.findNoteAt(cell, midi);
      if (!existing) {
        this.addNote(cell, midi);
        if (this.onNoteClick) this.onNoteClick(this.findNoteAt(cell, midi));
      }
    }
  }

  handleContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const vl = this.screenToVelocityLane(x, y);
    if (vl) {
      const note = this.findNoteAtCell(vl.cell);
      if (note) {
        note.velocity = this.defaultVelocity;
        this.render();
        if (this.onNoteChange) this.onNoteChange(note);
      }
      return;
    }

    const pos = this.screenToGrid(x, y);
    const cell = pos.cell, midi = pos.midi;
    if (cell >= 0 && midi >= 0) {
      const existing = this.findNoteAt(cell, midi);
      if (existing) {
        this.removeNote(existing);
        if (this.onNoteClick) this.onNoteClick(null);
      }
    }
  }

  processPointerDown(x, y) {
    this.dragDidMove = false;
    this.dragStartX = x;
    this.dragStartY = y;

    const vl = this.screenToVelocityLane(x, y);
    if (vl) {
      const note = this.findNoteAtCell(vl.cell);
      if (note) {
        this.isDragging = true;
        this.dragType = 'velocity';
        this.dragNote = note;
        this.dragStartCell = vl.cell;
        this.velocityDragStartY = y;
        this.velocityDragBase = note.velocity;
        note.velocity = vl.velocity;
        this.render();
        if (this.onNoteChange) this.onNoteChange(note);
      }
      return;
    }

    const pos = this.screenToGrid(x, y);
    const cell = pos.cell, midi = pos.midi;

    if (cell < 0 || midi < 0) return;

    const note = this.findNoteAt(cell, midi);

    if (note) {
      const noteScreenX = this.gridToScreenX(note.startCell);
      const noteScreenW = (note.endCell - note.startCell) * this.cellWidth;
      const edgeThreshold = 8;

      if (x >= noteScreenX + noteScreenW - edgeThreshold && x <= noteScreenX + noteScreenW + 4) {
        this.isDragging = true;
        this.dragType = 'resize';
        this.dragNote = note;
        this.dragStartCell = cell;
        this.dragNoteStartCell = note.startCell;
        this.dragNoteEndCell = note.endCell;
      } else {
        this.isDragging = true;
        this.dragType = 'move';
        this.dragNote = note;
        this.dragStartCell = cell;
        this.dragNoteStartCell = note.startCell;
        this.dragNoteEndCell = note.endCell;
      }
    }
  }

  processPointerMove(x, y) {
    const pos = this.screenToGrid(x, y);
    const cell = pos.cell, midi = pos.midi;

    if (this.isDragging) {
      if (Math.abs(x - this.dragStartX) > 4 || Math.abs(y - this.dragStartY) > 4) {
        this.dragDidMove = true;
      }

      if (this.dragType === 'velocity' && this.dragNote) {
        const vl = this.screenToVelocityLane(x, y);
        if (vl) {
          this.dragNote.velocity = vl.velocity;
          this.render();
        } else {
          const dy = this.velocityDragStartY - y;
          const laneH = this.VELOCITY_LANE_HEIGHT;
          const delta = dy / laneH;
          this.dragNote.velocity = Math.max(0.05, Math.min(1, this.velocityDragBase + delta));
          this.render();
        }
        return;
      }

      if (cell >= 0) {
        const snappedCell = Math.max(0, cell);
        if (this.dragType === 'resize') {
          const newEnd = Math.max(this.dragNoteStartCell + 1, snappedCell + 1);
          this.dragNote.endCell = newEnd;
          this.render();
        } else if (this.dragType === 'move') {
          const delta = snappedCell - this.dragStartCell;
          const newStart = this.dragNoteStartCell + delta;
          const newEnd = this.dragNoteEndCell + delta;
          if (newStart >= 0) {
            this.dragNote.startCell = newStart;
            this.dragNote.endCell = newEnd;
            this.dragStartCell = snappedCell;
            this.dragNoteStartCell = newStart;
            this.dragNoteEndCell = newEnd;
          }
          this.render();
        }
      }
      return;
    }

    this.canvas.style.cursor = 'default';
    const vl = this.screenToVelocityLane(x, y);
    if (vl && this.findNoteAtCell(vl.cell)) {
      this.canvas.style.cursor = 'row-resize';
    }

    if (cell >= 0 && midi >= 0) {
      const note = this.findNoteAt(cell, midi);
      this.hoveredNote = note;

      if (note) {
        const noteName = midiToDisplayName(note.midi);
        const cells = note.endCell - note.startCell;
        const durName = this.cellsToDurationName(cells);
        const vel = Math.round(note.velocity * 100);
        this.tooltipEl.textContent = `${noteName} - ${durName} - v${vel} (${cells}c)`;
        this.tooltipEl.style.display = 'block';
        this.tooltipEl.style.left = (x + this.canvas.getBoundingClientRect().left + 12) + 'px';
        this.tooltipEl.style.top = (y + this.canvas.getBoundingClientRect().top - 30) + 'px';

        if (this.onNoteHover) this.onNoteHover(note);
      } else {
        this.tooltipEl.style.display = 'none';
        if (this.onNoteHover) this.onNoteHover(null);
      }
    } else {
      this.tooltipEl.style.display = 'none';
      if (this.onNoteHover) this.onNoteHover(null);
    }

    this.render();
  }

  processPointerUp() {
    if (this.isDragging && this.dragDidMove && this.dragNote && this.onNoteChange) {
      this.onNoteChange(this.dragNote);
    }
    this.isDragging = false;
    this.dragDidMove = false;
    this.dragType = null;
    this.dragNote = null;
  }

  screenToGrid(screenX, screenY) {
    const gridLeft = this.gridLeft;
    const x = screenX + this.scrollLeft - gridLeft;
    const y = screenY + this.scrollTop;

    if (screenX < gridLeft) return { cell: -1, midi: -1 };

    const cell = Math.floor(x / this.cellWidth);
    const noteIndex = this.totalKeys - 1 - Math.floor(y / this.rowHeight);
    const midi = this.lowestMidi + noteIndex;

    if (cell < 0 || cell >= this.totalCells) return { cell: -1, midi: -1 };
    if (noteIndex < 0 || noteIndex >= this.totalKeys) return { cell: -1, midi: -1 };

    return { cell, midi };
  }

  screenToVelocityLane(screenX, screenY) {
    const gridLeft = this.gridLeft;
    const laneY = this.totalKeys * this.rowHeight + this.VELOCITY_LANE_GAP;
    const laneH = this.VELOCITY_LANE_HEIGHT;

    if (screenX < gridLeft) return null;

    const laneLocalY = screenY + this.scrollTop;
    if (laneLocalY < laneY || laneLocalY > laneY + laneH) return null;

    const x = screenX + this.scrollLeft - gridLeft;
    const cell = Math.floor(x / this.cellWidth);
    if (cell < 0 || cell >= this.totalCells) return null;

    const relativeY = laneLocalY - laneY;
    const velocity = Math.max(0.05, Math.min(1, 1 - relativeY / laneH));

    return { cell, velocity };
  }

  gridToScreenX(cell) {
    return this.gridLeft + cell * this.cellWidth - this.scrollLeft;
  }

  gridToScreenY(midi) {
    const noteIndex = midi - this.lowestMidi;
    return (this.totalKeys - 1 - noteIndex) * this.rowHeight - this.scrollTop;
  }

  findNoteAt(cell, midi) {
    return this.notes.find(n =>
      n.midi === midi && cell >= n.startCell && cell < n.endCell
    ) || null;
  }

  findNoteAtCell(cell) {
    return this.notes.find(n =>
      cell >= n.startCell && cell < n.endCell
    ) || null;
  }

  addNote(cell, midi) {
    if (!this.isNoteInScale(midi)) return;

    const endCell = Math.min(cell + this.defaultNoteCells, this.totalCells);

    const overlapping = this.notes.filter(n => cell < n.endCell && endCell > n.startCell);
    for (const n of overlapping) {
      const idx = this.notes.indexOf(n);
      if (idx >= 0) {
        this.notes.splice(idx, 1);
        if (this.onNoteChange) this.onNoteChange(n);
      }
    }

    const pitch = SEMITONE_TO_NOTE[midi % 12];
    const octave = Math.floor(midi / 12) - 1;

    const note = {
      startCell: cell,
      endCell,
      midi,
      pitch,
      octave,
      duration: 4,
      dotted: false,
      tie: false,
      velocity: this.defaultVelocity
    };

    this.notes.push(note);
    this.notes.sort((a, b) => a.startCell - b.startCell);
    this.render();
    if (this.onNoteChange) this.onNoteChange(note);
  }

  removeNote(note) {
    const idx = this.notes.indexOf(note);
    if (idx >= 0) {
      this.notes.splice(idx, 1);
      this.render();
      if (this.onNoteChange) this.onNoteChange(null);
    }
  }

  cellsToDuration(cells) {
    const standard = { 1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0 };

    for (const [dur, stdCells] of Object.entries(standard)) {
      if (stdCells === 0) continue;
      if (cells === stdCells) {
        return { duration: parseInt(dur), dotted: false };
      }
    }

    for (const [dur, stdCells] of Object.entries(standard)) {
      if (stdCells === 0) continue;
      const dottedCells = Math.round(stdCells * 1.5);
      if (cells === dottedCells) {
        return { duration: parseInt(dur), dotted: true };
      }
    }

    let bestDur = 4;
    let bestDiff = Infinity;
    for (const [dur, stdCells] of Object.entries(standard)) {
      if (stdCells === 0) continue;
      const diff = Math.abs(cells - stdCells);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestDur = parseInt(dur);
      }
    }

    return { duration: bestDur, dotted: false };
  }

  cellsToDurationName(cells) {
    const info = this.cellsToDuration(cells);
    const names = { 1: '1', 2: '2', 4: '4', 8: '8', 16: '16', 32: '32' };
    let name = names[info.duration] || `${info.duration}`;
    if (info.dotted) name += '.';
    return name;
  }

  setNotesFromRTTTL(parsedNotes, bpm) {
    const beatDuration = 60 / bpm;
    const cellDuration = beatDuration / this.beatDivision;

    this.notes = [];
    let currentCell = 0;

    for (const n of parsedNotes) {
      const noteBeatDur = beatDuration * (4 / n.duration);
      const actualBeatDur = n.dotted ? noteBeatDur * 1.5 : noteBeatDur;
      const noteCells = Math.round(actualBeatDur / cellDuration);

      const midi = n.midi;
      const pitch = midi >= 0 ? SEMITONE_TO_NOTE[midi % 12] : 'p';
      const octave = midi >= 0 ? Math.floor(midi / 12) - 1 : 5;

      if (midi >= 0) {
        this.notes.push({
          startCell: currentCell,
          endCell: currentCell + noteCells,
          midi,
          pitch,
          octave,
          duration: n.duration,
          dotted: n.dotted,
          tie: n.tie,
          velocity: 0.7
        });
      }

      currentCell += noteCells;
    }

    const MAX_CELLS = 1024;
    const neededCells = Math.min(
      Math.max(currentCell + 16, this.numBeats * this.beatDivision),
      MAX_CELLS
    );
    if (neededCells > this.totalCells) {
      this.totalCells = neededCells;
      this.numBeats = Math.ceil(neededCells / this.beatDivision);
    }

    this.render();
    this.resize();
  }

  getNotesAsRTTTL() {
    this.notes.sort((a, b) => a.startCell - b.startCell);

    const rtttlNotes = [];
    let lastCell = 0;

    for (const note of this.notes) {
      if (note.startCell > lastCell) {
        const gapCells = note.startCell - lastCell;
        const durInfo = this.cellsToDuration(gapCells);
        rtttlNotes.push({
          duration: durInfo.duration,
          pitch: 'p',
          octave: 5,
          midi: -1,
          dotted: durInfo.dotted,
          tie: false,
          _explicitOctave: false,
          velocity: 0
        });
      }

      const cells = note.endCell - note.startCell;
      const durInfo = this.cellsToDuration(cells);

      rtttlNotes.push({
        duration: durInfo.duration,
        pitch: SEMITONE_TO_NOTE[note.midi % 12],
        octave: Math.floor(note.midi / 12) - 1,
        midi: note.midi,
        dotted: durInfo.dotted,
        tie: note.tie,
        _explicitOctave: false,
        velocity: note.velocity || 0.7
      });

      lastCell = note.endCell;
    }

    return rtttlNotes;
  }

  setPlayhead(beat) {
    this.playheadBeat = beat;
    this.isPlaying = beat >= 0;
    this.render();
  }

  clearPlayhead() {
    this.playheadBeat = -1;
    this.isPlaying = false;
    this.render();
  }

  clearNotes() {
    this.notes = [];
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const gridLeft = this.gridLeft;
    const beatDivision = this.beatDivision;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gridLeft, 0, w - gridLeft, h);
    ctx.clip();

    const startCol = Math.max(0, Math.floor(this.scrollLeft / this.cellWidth));
    const endCol = Math.min(this.totalCells, Math.ceil((this.scrollLeft + w) / this.cellWidth));
    const startRow = Math.max(0, Math.floor(this.scrollTop / this.rowHeight));
    const endRow = Math.min(this.totalKeys, Math.ceil((this.scrollTop + h) / this.rowHeight));

    for (let col = startCol; col <= endCol; col++) {
      const x = gridLeft + col * this.cellWidth - this.scrollLeft;
      const isBeatLine = col % beatDivision === 0;
      const isMeasureLine = col % (beatDivision * 4) === 0;

      if (isMeasureLine) {
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 1.5;
      } else if (isBeatLine) {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let row = startRow; row <= endRow; row++) {
      const y = row * this.rowHeight - this.scrollTop;
      const midi = this.highestMidi - row;

      const isBlackKey = [1, 3, 6, 8, 10].includes(midi % 12);
      ctx.fillStyle = isBlackKey ? '#1a1f35' : '#131826';
      ctx.fillRect(gridLeft, y, w - gridLeft, this.rowHeight);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(gridLeft, y + this.rowHeight);
      ctx.lineTo(w, y + this.rowHeight);
      ctx.stroke();
    }

    for (const note of this.notes) {
      const x = gridLeft + note.startCell * this.cellWidth - this.scrollLeft;
      const y = this.gridToScreenY(note.midi);
      const noteWidth = (note.endCell - note.startCell) * this.cellWidth;

      if (x + noteWidth < gridLeft || x > w) continue;
      if (y + this.rowHeight < 0 || y > h) continue;

      const isHovered = this.hoveredNote === note;
      const isDragged = this.dragNote === note && this.isDragging;
      const vel = Math.max(0.25, note.velocity);

      ctx.globalAlpha = 0.3 + vel * 0.7;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = isHovered || isDragged ? 12 : 4;

      const gradient = ctx.createLinearGradient(x, y, x, y + this.rowHeight);
      gradient.addColorStop(0, '#06b6d4');
      gradient.addColorStop(1, '#0891b2');

      ctx.fillStyle = gradient;
      const radius = 3;
      const pad = 1;

      ctx.beginPath();
      ctx.roundRect(x + pad, y + pad, noteWidth - pad * 2, this.rowHeight - pad * 2, radius);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      if (isHovered || isDragged) {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x + pad, y + pad, noteWidth - pad * 2, this.rowHeight - pad * 2, radius);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px monospace';
      const label = midiToDisplayName(note.midi);
      if (noteWidth > 30) {
        ctx.fillText(label, x + 4, y + this.rowHeight - 4);
      }
    }

    ctx.restore();

    this.drawKeyboard(ctx, gridLeft, h, startRow, endRow);
    this.drawVelocityLane(ctx, gridLeft, w, h);

    if (this.playheadBeat >= 0) {
      const playheadX = gridLeft + (this.playheadBeat * this.cellWidth * 4) - this.scrollLeft;
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 0);
      ctx.lineTo(playheadX + 5, 0);
      ctx.lineTo(playheadX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawKeyboard(ctx, gridLeft, h) {
    for (let row = 0; row < this.totalKeys; row++) {
      const y = row * this.rowHeight - this.scrollTop;
      const midi = this.highestMidi - row;

      if (y + this.rowHeight < 0 || y > h) continue;

      const isBlackKey = [1, 3, 6, 8, 10].includes(midi % 12);
      const inScale = this.isNoteInScale(midi);

      ctx.fillStyle = inScale
        ? (isBlackKey ? '#1a1f35' : '#1e293b')
        : (isBlackKey ? '#0f1420' : '#0d1117');
      ctx.fillRect(0, y, gridLeft - 8, this.rowHeight);

      if (inScale && this.scale !== 'chromatic') {
        ctx.fillStyle = '#312e81';
        ctx.fillRect(gridLeft - 14, y + 2, 3, this.rowHeight - 4);
      }

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + this.rowHeight);
      ctx.lineTo(gridLeft - 8, y + this.rowHeight);
      ctx.stroke();

      const noteName = NOTE_NAMES[midi % 12];
      const octave = Math.floor(midi / 12) - 1;
      const displayName = noteName + octave;
      const isWhiteKey = !isBlackKey;

      ctx.fillStyle = inScale
        ? (isBlackKey ? '#94a3b8' : '#e2e8f0')
        : (isBlackKey ? '#334155' : '#1e293b');
      ctx.font = isWhiteKey ? 'bold 10px monospace' : '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, gridLeft - 12, y + this.rowHeight / 2);
    }

    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gridLeft - 8, 0);
    ctx.lineTo(gridLeft - 8, h);
    ctx.stroke();
  }

  drawVelocityLane(ctx, gridLeft, w, h) {
    const laneY = this.totalKeys * this.rowHeight + this.VELOCITY_LANE_GAP;
    const laneH = this.VELOCITY_LANE_HEIGHT;

    if (laneY > h + this.scrollTop || laneY + laneH < this.scrollTop) return;

    const laneScrollY = laneY - this.scrollTop;

    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(gridLeft, laneScrollY, w - gridLeft, laneH);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;

    const startCol = Math.max(0, Math.floor(this.scrollLeft / this.cellWidth));
    const endCol = Math.min(this.totalCells, Math.ceil((this.scrollLeft + w) / this.cellWidth));

    for (let col = startCol; col <= endCol; col++) {
      const x = gridLeft + col * this.cellWidth - this.scrollLeft;
      ctx.beginPath();
      ctx.moveTo(x, laneScrollY);
      ctx.lineTo(x, laneScrollY + laneH);
      ctx.stroke();
    }

    if (laneScrollY > 8) {
      ctx.fillStyle = '#4f46e5';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('VEL', gridLeft + 2, laneScrollY - 6);
    }

    for (const note of this.notes) {
      const x = gridLeft + note.startCell * this.cellWidth - this.scrollLeft;
      const noteWidth = (note.endCell - note.startCell) * this.cellWidth;

      if (x + noteWidth < gridLeft || x > w) continue;

      const barW = Math.max(noteWidth - 2, 2);
      const barH = note.velocity * laneH;
      const barX = x + 1;
      const barY = laneScrollY + laneH - barH;

      ctx.fillStyle = `rgba(6, 182, 212, ${0.25 + note.velocity * 0.75})`;
      ctx.fillRect(barX, barY, barW, barH);

      ctx.strokeStyle = `rgba(6, 182, 212, ${0.15 + note.velocity * 0.5})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);
    }
  }

  setScale(scaleName) {
    if (SCALES[scaleName]) {
      this.scale = scaleName;
      this.render();
    }
  }

  isNoteInScale(midi) {
    if (midi < 0) return true;
    const semitone = midi % 12;
    const intervals = SCALES[this.scale] || SCALES.chromatic;
    return intervals.includes(semitone);
  }

  resize() {
    this.setupCanvas();
    this.render();
  }

  destroy() {
    if (this.tooltipEl && this.tooltipEl.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl);
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}
