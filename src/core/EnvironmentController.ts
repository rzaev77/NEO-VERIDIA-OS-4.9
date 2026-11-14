import * as THREE from 'three';
import { BlackoutPhase, CITY_CONFIG, TimeOfDayPreset } from '../types';

export interface PresetConfig {
  fogColor: THREE.Color;
  skyColor: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  dirColor: THREE.Color;
  dirIntensity: number;
  dirPosition: THREE.Vector3;
  neon1: THREE.Color;
  neon2: THREE.Color;
  sunGlowColor: THREE.Color;
  sunGlowStrength: number;
  rainColor: THREE.Color;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  defaultFogDensity: number;
  defaultRainIntensity: number;
  defaultWindForce: number;
}

const PRESETS: Record<TimeOfDayPreset, PresetConfig> = {
  deep_night: {
    fogColor: new THREE.Color('#060916'),
    skyColor: new THREE.Color('#080d22'),
    hemiSky: new THREE.Color('#284080'),
    hemiGround: new THREE.Color('#070a14'),
    hemiIntensity: 0.78,
    dirColor: new THREE.Color('#5a7eff'),
    dirIntensity: 1.05,
    dirPosition: new THREE.Vector3(140, 185, -115),
    neon1: new THREE.Color('#00f0ff'),
    neon2: new THREE.Color('#ff2a85'),
    sunGlowColor: new THREE.Color('#3b5eff'),
    sunGlowStrength: 0.05,
    rainColor: new THREE.Color('#80dcff'),
    bloomStrength: 1.32,
    bloomRadius: 0.62,
    bloomThreshold: 0.56,
    defaultFogDensity: 0.0022,
    defaultRainIntensity: 0.65,
    defaultWindForce: 0.25,
  },
  toxic_dawn: {
    fogColor: new THREE.Color('#2c1327'),
    skyColor: new THREE.Color('#3a172b'),
    hemiSky: new THREE.Color('#ff7b3b'),
    hemiGround: new THREE.Color('#240d38'),
    hemiIntensity: 1.15,
    dirColor: new THREE.Color('#ff6e27'),
    dirIntensity: 2.15,
    dirPosition: new THREE.Vector3(210, 58, -180),
    neon1: new THREE.Color('#ffae00'),
    neon2: new THREE.Color('#c83bff'),
    sunGlowColor: new THREE.Color('#ff6a2b'),
    sunGlowStrength: 1.18,
    rainColor: new THREE.Color('#ffb585'),
    bloomStrength: 1.12,
    bloomRadius: 0.72,
    bloomThreshold: 0.52,
    defaultFogDensity: 0.0036,
    defaultRainIntensity: 0.35,
    defaultWindForce: 0.15,
  },
  acid_rain: {
    fogColor: new THREE.Color('#061e19'),
    skyColor: new THREE.Color('#092922'),
    hemiSky: new THREE.Color('#39ff9c'),
    hemiGround: new THREE.Color('#051210'),
    hemiIntensity: 0.92,
    dirColor: new THREE.Color('#42ffb0'),
    dirIntensity: 1.32,
    dirPosition: new THREE.Vector3(-135, 160, 120),
    neon1: new THREE.Color('#39ff9c'),
    neon2: new THREE.Color('#00f0ff'),
    sunGlowColor: new THREE.Color('#39ff9c'),
    sunGlowStrength: 0.14,
    rainColor: new THREE.Color('#6effb8'),
    bloomStrength: 1.28,
    bloomRadius: 0.65,
    bloomThreshold: 0.54,
    defaultFogDensity: 0.0030,
    defaultRainIntensity: 0.95,
    defaultWindForce: 0.68,
  },
};

export class EnvironmentController {
  public readonly fog: THREE.FogExp2;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly dirLight: THREE.DirectionalLight;

  // Current interpolated state
  public readonly currentFogColor = new THREE.Color('#060916');
  public readonly currentSkyColor = new THREE.Color('#080d22');
  public readonly currentNeon1 = new THREE.Color('#00f0ff');
  public readonly currentNeon2 = new THREE.Color('#ff2a85');
  public readonly currentSunGlowColor = new THREE.Color('#3b5eff');
  public readonly currentRainColor = new THREE.Color('#80dcff');

  public currentSunGlowStrength = 0.05;
  public currentBloomStrength = 1.32;
  public currentBloomRadius = 0.62;
  public currentBloomThreshold = 0.56;

  // Blackout cascade state
  public readonly districtPower = new Float32Array(CITY_CONFIG.districtCount).fill(1.0);
  private blackoutPhase: BlackoutPhase = 'online';
  private blackoutTimer = 0;
  private readonly districtFailOrder: number[] = [];
  private readonly districtFailDelay: number[] = new Array(16).fill(0);
  private globalPowerLevel = 1.0;

  private activePreset: TimeOfDayPreset = 'deep_night';

  constructor(scene: THREE.Scene) {
    const initial = PRESETS.deep_night;

    this.fog = new THREE.FogExp2(initial.fogColor.getHex(), initial.defaultFogDensity);
    scene.fog = this.fog;
    scene.background = this.currentFogColor;

    this.hemiLight = new THREE.HemisphereLight(
      initial.hemiSky.getHex(),
      initial.hemiGround.getHex(),
      initial.hemiIntensity
    );
    scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(initial.dirColor.getHex(), initial.dirIntensity);
    this.dirLight.position.copy(initial.dirPosition);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 650;
    const shadowBound = 280;
    this.dirLight.shadow.camera.left = -shadowBound;
    this.dirLight.shadow.camera.right = shadowBound;
    this.dirLight.shadow.camera.top = shadowBound;
    this.dirLight.shadow.camera.bottom = -shadowBound;
    this.dirLight.shadow.bias = -0.0008;
    scene.add(this.dirLight);

    this.buildCascadeOrder();
  }

  private buildCascadeOrder(): void {
    // Sort 4x4 districts from city center outward for radial cascading power failure
    const items: Array<{ id: number; dist: number }> = [];
    for (let dz = 0; dz < 4; dz++) {
      for (let dx = 0; dx < 4; dx++) {
        const id = dz * 4 + dx;
        const dist = Math.hypot(dx - 1.5, dz - 1.5);
        items.push({ id, dist });
      }
    }
    items.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < items.length; i++) {
      this.districtFailOrder.push(items[i].id);
      this.districtFailDelay[items[i].id] = items[i].dist * 0.95;
    }
  }

  public setPreset(preset: TimeOfDayPreset): PresetConfig {
    this.activePreset = preset;
    return PRESETS[preset];
  }

  public getPresetConfig(preset: TimeOfDayPreset): PresetConfig {
    return PRESETS[preset];
  }

  public triggerBlackout(): boolean {
    if (this.blackoutPhase !== 'online') {
      return false;
    }
    this.blackoutPhase = 'failing';
    this.blackoutTimer = 0;
    return true;
  }

  public getBlackoutPhase(): BlackoutPhase {
    return this.blackoutPhase;
  }

  public getGlobalPowerLevel(): number {
    return this.globalPowerLevel;
  }

  public update(dt: number, targetFogDensity: number): void {
    const target = PRESETS[this.activePreset];
    const blend = 1 - Math.exp(-2.2 * dt);

    this.updateBlackout(dt);

    // Dim ambient lights noticeably during blackout so headlights & beacons dominate
    const powerLightFactor = 0.22 + 0.78 * this.globalPowerLevel;

    this.currentFogColor.lerp(target.fogColor, blend);
    this.currentSkyColor.lerp(target.skyColor, blend);
    this.currentNeon1.lerp(target.neon1, blend);
    this.currentNeon2.lerp(target.neon2, blend);
    this.currentSunGlowColor.lerp(target.sunGlowColor, blend);
    this.currentRainColor.lerp(target.rainColor, blend);

    this.currentSunGlowStrength = THREE.MathUtils.lerp(
      this.currentSunGlowStrength,
      target.sunGlowStrength,
      blend
    );
    this.currentBloomStrength = THREE.MathUtils.lerp(
      this.currentBloomStrength,
      target.bloomStrength,
      blend
    );
    this.currentBloomRadius = THREE.MathUtils.lerp(
      this.currentBloomRadius,
      target.bloomRadius,
      blend
    );
    this.currentBloomThreshold = THREE.MathUtils.lerp(
      this.currentBloomThreshold,
      target.bloomThreshold,
      blend
    );

    // Darken fog slightly in deep blackout while preserving toxic dawn horizon if active
    const blackoutFogMul = THREE.MathUtils.lerp(0.32, 1.0, this.globalPowerLevel);
    this.fog.color.copy(this.currentFogColor).multiplyScalar(blackoutFogMul);
    this.fog.density = THREE.MathUtils.lerp(this.fog.density, targetFogDensity, 1 - Math.exp(-4.0 * dt));

    this.hemiLight.color.lerp(target.hemiSky, blend);
    this.hemiLight.groundColor.lerp(target.hemiGround, blend);
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      this.hemiLight.intensity,
      target.hemiIntensity * powerLightFactor,
      blend
    );

    this.dirLight.color.lerp(target.dirColor, blend);
    this.dirLight.intensity = THREE.MathUtils.lerp(
      this.dirLight.intensity,
      target.dirIntensity * (0.35 + 0.65 * this.globalPowerLevel),
      blend
    );
    this.dirLight.position.lerp(target.dirPosition, blend);
  }

  private updateBlackout(dt: number): void {
    if (this.blackoutPhase === 'online') {
      this.globalPowerLevel = 1.0;
      return;
    }

    this.blackoutTimer += dt;

    if (this.blackoutPhase === 'failing') {
      let allDark = true;
      for (let i = 0; i < CITY_CONFIG.districtCount; i++) {
        const localT = this.blackoutTimer - this.districtFailDelay[i];
        if (localT < 0) {
          this.districtPower[i] = 1.0;
          allDark = false;
        } else if (localT < 0.42) {
          // Violent surge flicker before shutdown
          const flicker = 0.5 + 0.5 * Math.sin(localT * 62.0 + i * 3.1);
          this.districtPower[i] = THREE.MathUtils.clamp((1 - localT / 0.42) * flicker, 0.05, 0.92);
          allDark = false;
        } else {
          this.districtPower[i] = 0.0;
        }
      }
      if (allDark) {
        this.blackoutPhase = 'dark';
        this.blackoutTimer = 0;
      }
    } else if (this.blackoutPhase === 'dark') {
      this.districtPower.fill(0.0);
      if (this.blackoutTimer >= 4.2) {
        this.blackoutPhase = 'restoring';
        this.blackoutTimer = 0;
      }
    } else if (this.blackoutPhase === 'restoring') {
      let allOnline = true;
      const maxDelay = 2.1;
      for (let i = 0; i < CITY_CONFIG.districtCount; i++) {
        // Restore from outer grid back to central core
        const restoreDelay = maxDelay - this.districtFailDelay[i];
        const localT = this.blackoutTimer - restoreDelay;
        if (localT < 0) {
          this.districtPower[i] = 0.0;
          allOnline = false;
        } else if (localT < 0.55) {
          const p = localT / 0.55;
          const surge = 0.78 + 0.22 * Math.sin(localT * 42.0 + i * 2.0);
          this.districtPower[i] = THREE.MathUtils.clamp(p * surge, 0.0, 1.0);
          allOnline = false;
        } else {
          this.districtPower[i] = 1.0;
        }
      }
      if (allOnline) {
        this.districtPower.fill(1.0);
        this.blackoutPhase = 'online';
        this.blackoutTimer = 0;
      }
    }

    let sum = 0;
    for (let i = 0; i < CITY_CONFIG.districtCount; i++) {
      sum += this.districtPower[i];
    }
    this.globalPowerLevel = sum / CITY_CONFIG.districtCount;
  }
}
