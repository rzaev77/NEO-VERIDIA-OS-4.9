import * as THREE from 'three';
import { TrafficSystem } from '../simulation/TrafficSystem';

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Rain & wind filtered pink noise
  private rainSource: AudioBufferSourceNode | null = null;
  private rainLowpass: BiquadFilterNode | null = null;
  private rainBandpass: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;

  // Megalopolis low-frequency transformer / turbine drone
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneLfo: OscillatorNode | null = null;
  private droneLfoGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;

  // Doppler spinner flyby voice
  private flybyOsc: OscillatorNode | null = null;
  private flybySubOsc: OscillatorNode | null = null;
  private flybyFilter: BiquadFilterNode | null = null;
  private flybyPanner: StereoPannerNode | null = null;
  private flybyGain: GainNode | null = null;

  private enabled = false;
  private readonly tmpRel = new THREE.Vector3();
  private readonly tmpCamRight = new THREE.Vector3();

  private createPinkNoiseBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Paul Kellet pink noise filter
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    // Smooth crossfade at loop boundaries
    const fadeSamples = Math.min(2048, Math.floor(length * 0.05));
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const tailIdx = length - fadeSamples + i;
      data[i] = data[i] * t + data[tailIdx] * (1 - t);
    }

    return buffer;
  }

  private initGraph(): void {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    this.masterGain = master;

    // 1. Rain + Wind Filtered Pink Noise
    const pinkBuffer = this.createPinkNoiseBuffer(ctx, 4);
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = pinkBuffer;
    rainSrc.loop = true;

    const rainBand = ctx.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = 1100;
    rainBand.Q.value = 0.55;

    const rainLow = ctx.createBiquadFilter();
    rainLow.type = 'lowpass';
    rainLow.frequency.value = 3200;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.25;

    rainSrc.connect(rainBand);
    rainBand.connect(rainLow);
    rainLow.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();

    this.rainSource = rainSrc;
    this.rainBandpass = rainBand;
    this.rainLowpass = rainLow;
    this.rainGain = rainGain;

    // 2. Megalopolis Low-Frequency Hum
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 46;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 92.5;

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 135;
    droneFilter.Q.value = 2.8;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 26;
    lfo.connect(lfoGain);
    lfoGain.connect(droneFilter.frequency);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.14;

    osc1.connect(droneFilter);
    osc2.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(master);

    osc1.start();
    osc2.start();
    lfo.start();

    this.droneOsc1 = osc1;
    this.droneOsc2 = osc2;
    this.droneLfo = lfo;
    this.droneLfoGain = lfoGain;
    this.droneFilter = droneFilter;
    this.droneGain = droneGain;

    // 3. Spinner Doppler Flyby Synth
    const flyOsc = ctx.createOscillator();
    flyOsc.type = 'sawtooth';
    flyOsc.frequency.value = 140;

    const flySub = ctx.createOscillator();
    flySub.type = 'sine';
    flySub.frequency.value = 70;

    const flyFilter = ctx.createBiquadFilter();
    flyFilter.type = 'bandpass';
    flyFilter.frequency.value = 420;
    flyFilter.Q.value = 1.6;

    const flyPanner = ctx.createStereoPanner();
    flyPanner.pan.value = 0;

    const flyGain = ctx.createGain();
    flyGain.gain.value = 0;

    flyOsc.connect(flyFilter);
    flySub.connect(flyFilter);
    flyFilter.connect(flyPanner);
    flyPanner.connect(flyGain);
    flyGain.connect(master);

    flyOsc.start();
    flySub.start();

    this.flybyOsc = flyOsc;
    this.flybySubOsc = flySub;
    this.flybyFilter = flyFilter;
    this.flybyPanner = flyPanner;
    this.flybyGain = flyGain;
  }

  public async toggle(): Promise<boolean> {
    if (!this.ctx) {
      this.initGraph();
    }
    if (!this.ctx || !this.masterGain) return false;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.enabled = !this.enabled;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.enabled ? 0.65 : 0.0, now, 0.12);
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public update(
    _dt: number,
    rainIntensity: number,
    windForce: number,
    globalPowerLevel: number,
    camera: THREE.Camera,
    traffic: TrafficSystem
  ): void {
    if (!this.enabled || !this.ctx) return;

    const now = this.ctx.currentTime;

    // Rain + Wind modulation
    if (this.rainGain && this.rainLowpass && this.rainBandpass) {
      const windMag = Math.abs(windForce);
      const targetRainGain = 0.04 + rainIntensity * 0.34 + windMag * 0.08;
      this.rainGain.gain.setTargetAtTime(targetRainGain, now, 0.08);
      this.rainLowpass.frequency.setTargetAtTime(1600 + rainIntensity * 3400 + windMag * 1200, now, 0.1);
      this.rainBandpass.frequency.setTargetAtTime(650 + windMag * 950, now, 0.12);
    }

    // City grid hum drops pitch & amplitude during blackout
    if (this.droneOsc1 && this.droneOsc2 && this.droneGain && this.droneFilter) {
      const baseFreq = THREE.MathUtils.lerp(28, 46, globalPowerLevel);
      this.droneOsc1.frequency.setTargetAtTime(baseFreq, now, 0.2);
      this.droneOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.2);
      this.droneGain.gain.setTargetAtTime(0.05 + globalPowerLevel * 0.11, now, 0.25);
      this.droneFilter.frequency.setTargetAtTime(75 + globalPowerLevel * 85, now, 0.2);
    }

    // Doppler flyby from closest passing spinner within 56m
    if (
      this.flybyOsc &&
      this.flybySubOsc &&
      this.flybyFilter &&
      this.flybyPanner &&
      this.flybyGain
    ) {
      const activeCount = traffic.getActiveCount();
      let closestDistSq = 56 * 56;
      let closestIdx = -1;

      for (let i = 0; i < activeCount; i++) {
        const d2 = traffic.agents[i].position.distanceToSquared(camera.position);
        if (d2 < closestDistSq) {
          closestDistSq = d2;
          closestIdx = i;
        }
      }

      if (closestIdx >= 0) {
        const agent = traffic.agents[closestIdx];
        const dist = Math.sqrt(closestDistSq);
        this.tmpRel.subVectors(agent.position, camera.position);

        // Radial velocity: negative when approaching, positive when receding
        const dirToAgent = this.tmpRel.clone().divideScalar(Math.max(0.5, dist));
        const radialVel = agent.velocity.dot(dirToAgent);

        // Acoustic Doppler formula: f = f0 * (c / (c + v_radial))
        const speedOfSound = 165;
        const doppler = THREE.MathUtils.clamp(
          speedOfSound / Math.max(40, speedOfSound + radialVel),
          0.52,
          1.75
        );

        const basePitch = (115 + agent.speed * 1.15) * doppler;
        const proximity = Math.pow(1 - dist / 56, 1.85);

        // Stereo panning based on camera's right vector
        this.tmpCamRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        const pan = THREE.MathUtils.clamp(dirToAgent.dot(this.tmpCamRight), -1, 1);

        this.flybyOsc.frequency.setTargetAtTime(basePitch, now, 0.04);
        this.flybySubOsc.frequency.setTargetAtTime(basePitch * 0.5, now, 0.04);
        this.flybyFilter.frequency.setTargetAtTime(280 + doppler * 480, now, 0.05);
        this.flybyPanner.pan.setTargetAtTime(pan, now, 0.04);
        this.flybyGain.gain.setTargetAtTime(proximity * 0.24, now, 0.04);
      } else {
        this.flybyGain.gain.setTargetAtTime(0.0, now, 0.12);
      }
    }
  }

  public dispose(): void {
    try {
      this.rainSource?.stop();
      this.droneOsc1?.stop();
      this.droneOsc2?.stop();
      this.droneLfo?.stop();
      this.flybyOsc?.stop();
      this.flybySubOsc?.stop();
    } catch {
      // Ignore stop errors if nodes never started
    }
    this.rainSource?.disconnect();
    this.droneLfoGain?.disconnect();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
