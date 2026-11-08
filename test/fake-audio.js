// Attrappe eines AudioContext fuer Tests: zeichnet Automationen, Starts und Stopps auf.
export class FakeParam {
  constructor(owner, name, value = 0) { this.owner = owner; this.name = name; this.value = value; this.events = []; }
  setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); return this; }
  linearRampToValueAtTime(v, t) { this.events.push({ type: 'lin', v, t }); return this; }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError('exponentialRamp braucht Werte > 0');
    this.events.push({ type: 'exp', v, t }); return this;
  }
  setTargetAtTime(v, t, tau) { this.events.push({ type: 'target', v, t, tau }); return this; }
  cancelScheduledValues(t) { this.events.push({ type: 'cancel', t }); return this; }
}

class FakeNode {
  constructor(ac, kind) { this.ac = ac; this.kind = kind; this.outputs = []; ac.nodes.push(this); }
  connect(dest) { if (!dest) throw new TypeError('connect ohne Ziel'); this.outputs.push(dest); return dest; }
  disconnect() { this.outputs = []; }
}

class FakeSource extends FakeNode {
  constructor(ac, kind) { super(ac, kind); this.startAt = null; this.stopAt = null; this.loop = false; }
  start(t = 0) { if (this.startAt !== null) throw new Error('doppelt gestartet'); this.startAt = t; }
  stop(t = 0) { this.stopAt = t; }
}

export class FakeAudioContext {
  constructor({ sampleRate = 8000 } = {}) {
    this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'running'; this.nodes = [];
    this.destination = new FakeNode(this, 'destination');
  }
  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(n, 'gain', 1); return n; }
  createBiquadFilter() {
    const n = new FakeNode(this, 'filter'); n.type = 'lowpass';
    n.frequency = new FakeParam(n, 'frequency', 350); n.Q = new FakeParam(n, 'Q', 1); return n;
  }
  createOscillator() {
    const n = new FakeSource(this, 'osc'); n.type = 'sine'; n.frequency = new FakeParam(n, 'frequency', 440); return n;
  }
  createBufferSource() { const n = new FakeSource(this, 'buffer'); n.buffer = null; return n; }
  createBuffer(ch, len, rate) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => data };
  }
  createStereoPanner() { const n = new FakeNode(this, 'pan'); n.pan = new FakeParam(n, 'pan', 0); return n; }
}
