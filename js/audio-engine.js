class AudioEngine {
  constructor() {
    this.ctx = null;
    this.reverbNode = null;
    this.masterGain = null;
    this.playingNotes = new Map();
    this.scheduledEvents = [];
    this.isPlaying = false;
    this.currentTimeout = null;
    this.startTime = 0;
    this.currentBeat = 0;
    this.onBeatCallback = null;
    this.onStopCallback = null;
    this.playbackRate = 1;
    this.pausedAt = 0;
    this.totalDuration = 0;
    this._reverbIR = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.8;
      this.masterGain.connect(this.ctx.destination);
      this._createReverb();
    }
    return this.ctx;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _createReverb() {
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const duration = 1.2;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const decay = Math.exp(-t * 3.5);
        const noise = (Math.random() * 2 - 1);
        data[i] = noise * decay * 0.4;
      }
    }

    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = impulse;
    this._reverbIR = impulse;

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.25;
    this.reverbNode.connect(wetGain);
    wetGain.connect(this.masterGain);
  }

  _createVoice(ctx, freq, startTime, duration, velocity = 0.7, note = 60) {
    const now = startTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.01, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq * 1.003, now);

    subOsc.type = 'square';
    subOsc.frequency.setValueAtTime(freq * 0.5, now);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';

    const filterEnv = ctx.createGain();
    filterEnv.gain.setValueAtTime(1, now);
    filterEnv.gain.linearRampToValueAtTime(0.15, now + 0.15);
    filterEnv.gain.linearRampToValueAtTime(0.08, now + duration * 0.8);

    const filterBase = Math.min(3000, 800 + freq * 0.8);
    const filterMod = ctx.createGain();
    filterMod.gain.value = 0;
    filter.frequency.setValueAtTime(filterBase, now);
    filter.Q.setValueAtTime(0.7, now);

    const filterOffset = 4000;
    filterEnv.connect(filter.frequency);

    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();
    const subGain = ctx.createGain();
    const noiseGain = ctx.createGain();

    const env = {
      attack: 0.006,
      decay: 0.12,
      sustain: 0.35,
      release: 0.08
    };
    const vel = Math.max(0.3, Math.min(1, velocity * (0.85 + Math.random() * 0.15)));

    const mainGain = ctx.createGain();
    mainGain.gain.setValueAtTime(0, now);
    mainGain.gain.linearRampToValueAtTime(vel * 0.6, now + env.attack);
    mainGain.gain.linearRampToValueAtTime(vel * env.sustain * 0.6, now + env.attack + env.decay);
    mainGain.gain.setValueAtTime(vel * env.sustain * 0.6, now + duration - env.release);
    mainGain.gain.linearRampToValueAtTime(0, now + duration + 0.02);

    const volLfo = ctx.createOscillator();
    const volLfoGain = ctx.createGain();
    volLfo.type = 'sine';
    volLfo.frequency.value = 4.5 + Math.random() * 0.5;
    volLfoGain.gain.value = 0.015;
    volLfo.connect(volLfoGain);
    volLfoGain.connect(mainGain.gain);
    volLfo.start(now);
    volLfo.stop(now + duration + 0.1);

    osc1.connect(gain1);
    osc2.connect(gain2);
    subOsc.connect(subGain);
    noise.connect(noiseGain);

    gain1.gain.value = 0.5;
    gain2.gain.value = 0.35;
    subGain.gain.value = 0.2;
    noiseGain.gain.setValueAtTime(0.08, now);
    noiseGain.gain.linearRampToValueAtTime(0, now + 0.01);

    gain1.connect(filter);
    gain2.connect(filter);
    subGain.connect(filter);
    noiseGain.connect(filter);

    filter.connect(mainGain);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.2;
    mainGain.connect(reverbSend);
    if (this.reverbNode) {
      reverbSend.connect(this.reverbNode);
    }

    mainGain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    subOsc.start(now);
    noise.start(now);

    const stopTime = now + duration + 0.1;
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    subOsc.stop(stopTime);

    return {
      nodes: [osc1, osc2, subOsc, noise, gain1, gain2, subGain, noiseGain,
              filter, filterEnv, mainGain, reverbSend, volLfo, volLfoGain],
      stopTime
    };
  }

  playPreviewNote(midi, duration = 0.15) {
    const ctx = this.init();
    this.resume();
    const now = ctx.currentTime;
    const freq = midiToFrequency(midi);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    osc.frequency.linearRampToValueAtTime(freq * 1.005, now + 0.005);
    osc.frequency.linearRampToValueAtTime(freq, now + 0.01);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500 + freq * 0.6, now);

    const vel = 0.4;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vel, now + 0.003);
    gain.gain.linearRampToValueAtTime(vel * 0.2, now + 0.04);
    gain.gain.setValueAtTime(vel * 0.2, now + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.15;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);
    if (this.reverbNode) {
      reverbSend.connect(this.reverbNode);
    }

    osc.start(now);
    osc.stop(now + duration + 0.05);

    setTimeout(() => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
      reverbSend.disconnect();
    }, (duration + 0.2) * 1000);
  }

  scheduleNote(midi, startTime, duration, velocity = 0.7) {
    const ctx = this.ctx;
    const freq = midiToFrequency(midi);
    const voice = this._createVoice(ctx, freq, startTime, duration, velocity, midi);

    this.scheduledEvents.push(voice);

    return voice;
  }

  playSequence(notes, bpm) {
    this.stopSequence();

    const ctx = this.init();
    this.resume();

    this.isPlaying = true;
    this.startTime = ctx.currentTime;
    this.beatDuration = 60 / bpm;
    this.bpm = bpm;

    let currentTime = 0;
    this.scheduledEvents = [];
    this.totalDuration = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      if (note.tie) continue;

      const dur = this.beatDuration * (4 / note.duration);
      let actualDur = note.dotted ? dur * 1.5 : dur;

      let j = i + 1;
      while (j < notes.length && notes[j].tie) {
        const tied = notes[j];
        const tiedDur = this.beatDuration * (4 / tied.duration);
        actualDur += tied.dotted ? tiedDur * 1.5 : tiedDur;
        j++;
      }

      if (note.midi >= 0) {
        const vel = (note.velocity != null ? note.velocity : 0.7) * (0.85 + Math.random() * 0.15);
        this.scheduleNote(note.midi, ctx.currentTime + currentTime, actualDur, vel);
      }

      currentTime += actualDur;
    }

    this.totalDuration = currentTime;

    const totalMs = currentTime * 1000;
    this.currentTimeout = setTimeout(() => {
      this.isPlaying = false;
      this.scheduledEvents = [];
      this.currentBeat = this.totalDuration / this.beatDuration;
      this.playAnimationId = null;
      if (this.onStopCallback) this.onStopCallback();
    }, totalMs + 400);

    this._startPlayheadLoop();
  }

  _startPlayheadLoop() {
    const update = () => {
      if (!this.isPlaying || !this.ctx) return;
      const elapsed = this.ctx.currentTime - this.startTime;
      this.currentBeat = elapsed / this.beatDuration;
      if (this.onBeatCallback) {
        this.onBeatCallback(this.currentBeat);
      }
      this.playAnimationId = requestAnimationFrame(update);
    };
    this.playAnimationId = requestAnimationFrame(update);
  }

  stopSequence() {
    this.isPlaying = false;
    this.currentBeat = 0;

    if (this.playAnimationId) {
      cancelAnimationFrame(this.playAnimationId);
      this.playAnimationId = null;
    }

    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }

    for (const event of this.scheduledEvents) {
      try {
        for (const node of event.nodes) {
          try { node.disconnect(); } catch (e) {}
          try { node.stop && node.stop(); } catch (e) {}
        }
      } catch (e) {}
    }
    this.scheduledEvents = [];

    if (this.onStopCallback) this.onStopCallback();
  }

  async renderToBuffer(notes, bpm) {
    const ctx = this.init();
    const sampleRate = ctx.sampleRate || 44100;
    const beatDuration = 60 / bpm;

    let totalDuration = 0;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const dur = beatDuration * (4 / note.duration);
      let actualDur = note.dotted ? dur * 1.5 : dur;
      if (i + 1 < notes.length && notes[i + 1].tie) {
        const next = notes[i + 1];
        const nextDur = beatDuration * (4 / next.duration);
        actualDur += next.dotted ? nextDur * 1.5 : nextDur;
      }
      totalDuration += actualDur;
    }

    totalDuration += 1.0;
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(offlineCtx.destination);

    const impulseLength = sampleRate * 1.2;
    const impulse = offlineCtx.createBuffer(1, impulseLength, sampleRate);
    const impData = impulse.getChannelData(0);
    for (let i = 0; i < impulseLength; i++) {
      const t = i / sampleRate;
      impData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.5) * 0.3;
    }
    const reverb = offlineCtx.createConvolver();
    reverb.buffer = impulse;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = 0.2;
    reverb.connect(wetGain);
    wetGain.connect(masterGain);

    let currentTime = 0;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      if (note.tie) continue;

      const dur = beatDuration * (4 / note.duration);
      let actualDur = note.dotted ? dur * 1.5 : dur;

      let j = i + 1;
      while (j < notes.length && notes[j].tie) {
        const tied = notes[j];
        const tiedDur = beatDuration * (4 / tied.duration);
        actualDur += tied.dotted ? tiedDur * 1.5 : tiedDur;
        j++;
      }

      if (note.midi >= 0) {
        const freq = midiToFrequency(note.midi);
        const t = currentTime;
        const vel = note.velocity != null ? note.velocity : 0.6;

        const osc1 = offlineCtx.createOscillator();
        const osc2 = offlineCtx.createOscillator();
        const subOsc = offlineCtx.createOscillator();

        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        subOsc.type = 'square';

        osc1.frequency.setValueAtTime(freq, t);
        osc2.frequency.setValueAtTime(freq * 1.003, t);
        subOsc.frequency.setValueAtTime(freq * 0.5, t);

        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        const filterBase = Math.min(3000, 800 + freq * 0.8);
        filter.frequency.setValueAtTime(filterBase, t);
        filter.frequency.linearRampToValueAtTime(filterBase * 0.2, t + 0.15);
        filter.frequency.setValueAtTime(filterBase * 0.2, t + actualDur * 0.8);
        filter.frequency.linearRampToValueAtTime(200, t + actualDur - 0.05);
        filter.Q.setValueAtTime(0.6, t);

        const mixer = offlineCtx.createGain();
        mixer.gain.value = 1;

        const gain1 = offlineCtx.createGain();
        const gain2 = offlineCtx.createGain();
        const subGainO = offlineCtx.createGain();
        gain1.gain.value = 0.5;
        gain2.gain.value = 0.35;
        subGainO.gain.value = 0.2;

        osc1.connect(gain1);
        osc2.connect(gain2);
        subOsc.connect(subGainO);
        gain1.connect(filter);
        gain2.connect(filter);
        subGainO.connect(filter);
        filter.connect(mixer);

        const reverbSend = offlineCtx.createGain();
        reverbSend.gain.value = 0.15;
        mixer.connect(reverbSend);
        reverbSend.connect(reverb);

        const envGain = offlineCtx.createGain();
        mixer.connect(envGain);
        envGain.connect(masterGain);

        const a = 0.006, d = 0.12, s = 0.35, r = 0.08;
        envGain.gain.setValueAtTime(0, t);
        envGain.gain.linearRampToValueAtTime(vel * 0.6, t + a);
        envGain.gain.linearRampToValueAtTime(vel * s * 0.6, t + a + d);
        envGain.gain.setValueAtTime(vel * s * 0.6, t + actualDur - r);
        envGain.gain.linearRampToValueAtTime(0, t + actualDur + 0.02);

        osc1.start(t);
        osc2.start(t);
        subOsc.start(t);
        const stopT = t + actualDur + 0.1;
        osc1.stop(stopT);
        osc2.stop(stopT);
        subOsc.stop(stopT);
      }

      currentTime += actualDur;
    }

    return offlineCtx.startRendering();
  }

  cleanup() {
    this.stopSequence();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

function bufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitsPerSample = 16;

  const data = buffer.getChannelData(0);
  const dataLength = data.length * (bitsPerSample / 8);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
  view.setUint16(32, numChannels * bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return arrayBuffer;
}

async function renderToWavBlob(notes, bpm) {
  const engine = new AudioEngine();
  const buffer = await engine.renderToBuffer(notes, bpm);
  const wavData = bufferToWav(buffer);
  engine.cleanup();
  return new Blob([wavData], { type: 'audio/wav' });
}

async function renderToMp3Blob(notes, bpm) {
  if (typeof lamejs === 'undefined') {
    throw new Error('lamejs library not loaded. Please include it via CDN.');
  }

  const engine = new AudioEngine();
  const buffer = await engine.renderToBuffer(notes, bpm);
  engine.cleanup();

  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const samples = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const sampleBlockSize = 1152;
  const mp3Data = [];
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const block = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(block);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  const totalLength = mp3Data.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of mp3Data) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return new Blob([result], { type: 'audio/mp3' });
}
