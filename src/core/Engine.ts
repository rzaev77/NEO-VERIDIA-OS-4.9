import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import {
  CameraMode,
  DEFAULT_SIMULATION_PARAMS,
  FollowSubMode,
  SimulationParams,
  TelemetryData,
  TimeOfDayPreset,
} from '../types';
import { CameraSystem } from './CameraSystem';
import { EnvironmentController } from './EnvironmentController';
import { createProceduralTexturePack, ProceduralTexturePack } from '../world/ProceduralTextures';
import { CityWorld, generateCity } from '../world/CityGenerator';
import { createRainParticleSystem, LensRainPostShader } from '../shaders/RainShader';
import { TrafficSystem } from '../simulation/TrafficSystem';
import { ProceduralAudio } from '../audio/ProceduralAudio';

const FIXED_STEP = 1 / 60;
const MAX_ACCUMULATOR = 0.1;

export class Engine {
  public readonly params: SimulationParams = { ...DEFAULT_SIMULATION_PARAMS };

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly cameraSystem: CameraSystem;
  private readonly environment: EnvironmentController;
  private readonly textures: ProceduralTexturePack;
  private readonly city: CityWorld;
  private readonly traffic: TrafficSystem;
  private readonly rainParticles: ReturnType<typeof createRainParticleSystem>;
  private readonly audio: ProceduralAudio;

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly lensRainPass: ShaderPass;

  private animFrameId = 0;
  private isDisposed = false;
  private lastTimestamp = 0;
  private accumulator = 0;
  private elapsedTime = 0;

  // FPS telemetry tracking
  private fpsFrames = 0;
  private fpsAccumTime = 0;
  private currentFps = 60;
  private currentFrameTimeMs = 16.6;

  private onTelemetryCallback?: (telemetry: TelemetryData) => void;
  private readonly onResizeBound: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;

    // 1. WebGLRenderer with ACESFilmicToneMapping & soft shadows
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    // 2. Scene, Camera, Environment
    this.scene = new THREE.Scene();
    this.cameraSystem = new CameraSystem(this.renderer.domElement, aspect);
    this.environment = new EnvironmentController(this.scene);

    // 3. Procedural World
    this.textures = createProceduralTexturePack();
    this.city = generateCity(this.textures);
    this.scene.add(this.city.group);

    // 4. GPU Rain Particles
    this.rainParticles = createRainParticleSystem(16000);
    this.scene.add(this.rainParticles.mesh);

    // 5. Air Traffic Simulation
    this.traffic = new TrafficSystem();
    this.traffic.setActiveCount(this.params.trafficCount);
    this.scene.add(this.traffic.group);

    // 6. Procedural Audio
    this.audio = new ProceduralAudio();

    // 7. Post-Processing Pipeline (RenderPass -> UnrealBloomPass -> LensRainPostShader -> OutputPass)
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 0,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(width, height);

    const renderPass = new RenderPass(this.scene, this.cameraSystem.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.environment.currentBloomStrength,
      this.environment.currentBloomRadius,
      this.environment.currentBloomThreshold
    );
    this.composer.addPass(this.bloomPass);

    this.lensRainPass = new ShaderPass(LensRainPostShader);
    this.lensRainPass.uniforms.uAspect.value = aspect;
    this.composer.addPass(this.lensRainPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.onResizeBound = () => this.handleResize();
    window.addEventListener('resize', this.onResizeBound);
  }

  public start(): void {
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      if (this.isDisposed) return;
      this.animFrameId = requestAnimationFrame(tick);
      this.step(now);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private step(now: number): void {
    const rawDt = Math.max(0, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;
    const frameDt = Math.min(rawDt, MAX_ACCUMULATOR);
    this.elapsedTime += frameDt;

    // Fixed timestep physics & traffic simulation
    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_STEP) {
      this.traffic.updateFixed(
        FIXED_STEP,
        this.params.trafficMaxSpeed,
        this.params.windForce
      );
      this.accumulator -= FIXED_STEP;
    }

    // Variable timestep updates: environment, camera, world shaders, rain, audio
    this.environment.update(frameDt, this.params.fogDensity);

    const followedAgent = this.cameraSystem.update(frameDt, this.traffic);

    this.traffic.syncInstances(
      this.cameraSystem.camera.position,
      this.params.cameraMode === 'follow' ? this.cameraSystem.getFollowedAgentIndex() : -1,
      this.environment.fog.color,
      this.environment.fog.density
    );

    this.city.update(
      this.elapsedTime,
      this.environment.districtPower,
      this.environment.fog.color,
      this.environment.fog.density,
      this.params.rainIntensity,
      this.params.windForce,
      this.environment.currentSkyColor,
      this.environment.currentNeon1,
      this.environment.currentNeon2,
      this.environment.currentSunGlowColor,
      this.environment.currentSunGlowStrength
    );

    // Update GPU rain uniforms
    this.rainParticles.uniforms.uTime.value = this.elapsedTime;
    this.rainParticles.uniforms.uCameraPos.value.copy(this.cameraSystem.camera.position);
    this.rainParticles.uniforms.uRainIntensity.value = this.params.rainIntensity;
    this.rainParticles.uniforms.uWind.value = this.params.windForce;
    this.rainParticles.uniforms.uRainColor.value.copy(this.environment.currentRainColor);

    // Update Bloom & Lens Rain post-processing
    this.bloomPass.strength = this.environment.currentBloomStrength;
    this.bloomPass.radius = this.environment.currentBloomRadius;
    this.bloomPass.threshold = this.environment.currentBloomThreshold;

    this.lensRainPass.uniforms.uTime.value = this.elapsedTime;
    this.lensRainPass.uniforms.uRainIntensity.value = this.params.rainIntensity;
    this.lensRainPass.uniforms.uWind.value = this.params.windForce;
    this.lensRainPass.uniforms.uCockpitMode.value =
      this.params.cameraMode === 'follow' && this.params.followSubMode === 'cockpit' ? 1.0 : 0.0;

    // Update procedural audio (Doppler flybys, rain, city hum)
    this.audio.update(
      frameDt,
      this.params.rainIntensity,
      this.params.windForce,
      this.environment.getGlobalPowerLevel(),
      this.cameraSystem.camera,
      this.traffic
    );

    // Render frame
    this.renderer.info.reset();
    this.composer.render(frameDt);

    // Telemetry calculation
    this.fpsFrames++;
    this.fpsAccumTime += rawDt;
    if (this.fpsAccumTime >= 0.25) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccumTime);
      this.currentFrameTimeMs = (this.fpsAccumTime / this.fpsFrames) * 1000;
      this.fpsFrames = 0;
      this.fpsAccumTime = 0;
    }

    if (this.onTelemetryCallback) {
      this.onTelemetryCallback({
        fps: this.currentFps,
        frameTimeMs: this.currentFrameTimeMs,
        activeAgents: this.traffic.getActiveCount(),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        cameraMode: this.cameraSystem.getMode(),
        followSubMode: this.cameraSystem.getFollowSubMode(),
        followedAgentId: followedAgent.id,
        followedSpeedKmh: Math.round(followedAgent.speed * 3.6),
        followedAltitude: Math.round(followedAgent.position.y),
        blackoutPhase: this.environment.getBlackoutPhase(),
        districtPower: this.environment.districtPower,
      });
    }
  }

  public setTelemetryListener(cb: (telemetry: TelemetryData) => void): void {
    this.onTelemetryCallback = cb;
  }

  public setPreset(preset: TimeOfDayPreset): void {
    this.params.preset = preset;
    const cfg = this.environment.setPreset(preset);
    this.params.fogDensity = cfg.defaultFogDensity;
    this.params.rainIntensity = cfg.defaultRainIntensity;
    this.params.windForce = cfg.defaultWindForce;
  }

  public setTrafficCount(count: number): void {
    this.params.trafficCount = count;
    this.traffic.setActiveCount(count);
  }

  public setTrafficMaxSpeed(speed: number): void {
    this.params.trafficMaxSpeed = speed;
  }

  public setRainIntensity(value: number): void {
    this.params.rainIntensity = value;
  }

  public setWindForce(value: number): void {
    this.params.windForce = value;
  }

  public setFogDensity(value: number): void {
    this.params.fogDensity = value;
  }

  public triggerBlackout(): boolean {
    return this.environment.triggerBlackout();
  }

  public setCameraMode(mode: CameraMode): void {
    this.params.cameraMode = mode;
    this.cameraSystem.setMode(mode);
  }

  public setFollowSubMode(subMode: FollowSubMode): void {
    this.params.followSubMode = subMode;
    this.cameraSystem.setFollowSubMode(subMode);
  }

  public toggleFollowSubMode(): FollowSubMode {
    const sub = this.cameraSystem.toggleFollowSubMode();
    this.params.followSubMode = sub;
    return sub;
  }

  public nextFollowedAgent(): void {
    this.cameraSystem.nextAgent(this.traffic);
  }

  public prevFollowedAgent(): void {
    this.cameraSystem.prevAgent(this.traffic);
  }

  public async toggleAudio(): Promise<boolean> {
    const enabled = await this.audio.toggle();
    this.params.audioEnabled = enabled;
    return enabled;
  }

  private handleResize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;

    this.cameraSystem.resize(aspect);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
    this.lensRainPass.uniforms.uAspect.value = aspect;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResizeBound);

    this.cameraSystem.dispose();
    this.city.dispose();
    this.textures.dispose();
    this.rainParticles.dispose();
    this.traffic.dispose();
    this.audio.dispose();
    this.composer.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
