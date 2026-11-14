import * as THREE from 'three';

export type TimeOfDayPreset = 'deep_night' | 'toxic_dawn' | 'acid_rain';
export type CameraMode = 'orbit' | 'follow';
export type FollowSubMode = 'chase' | 'cockpit';
export type BlackoutPhase = 'online' | 'failing' | 'dark' | 'restoring';

export interface SimulationParams {
  preset: TimeOfDayPreset;
  trafficCount: number;
  trafficMaxSpeed: number;
  rainIntensity: number;
  windForce: number;
  fogDensity: number;
  cameraMode: CameraMode;
  followSubMode: FollowSubMode;
  audioEnabled: boolean;
}

export interface SpinnerState {
  id: number;
  active: boolean;
  corridorIndex: number;
  axis: 'x' | 'z';
  direction: 1 | -1;
  lane: 0 | 1;
  targetLane: 0 | 1;
  laneProgress: number;
  laneChangeCooldown: number;
  corridorCoord: number;
  baseAltitude: number;
  along: number;
  speed: number;
  cruiseFactor: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  roll: number;
  pitch: number;
  yaw: number;
  tailLength: number;
  headlightColor: THREE.Color;
  taillightColor: THREE.Color;
  phaseOffset: number;
}

export interface TelemetryData {
  fps: number;
  frameTimeMs: number;
  activeAgents: number;
  drawCalls: number;
  triangles: number;
  cameraMode: CameraMode;
  followSubMode: FollowSubMode;
  followedAgentId: number;
  followedSpeedKmh: number;
  followedAltitude: number;
  blackoutPhase: BlackoutPhase;
  districtPower: Float32Array;
}

export interface CityConfig {
  gridSize: number;
  blockStep: number;
  streetWidth: number;
  citySpan: number;
  asphaltSize: number;
  districtCount: number;
}

export const CITY_CONFIG: CityConfig = {
  gridSize: 10,
  blockStep: 52,
  streetWidth: 16,
  citySpan: 520,
  asphaltSize: 720,
  districtCount: 16,
};

export const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  preset: 'deep_night',
  trafficCount: 280,
  trafficMaxSpeed: 55,
  rainIntensity: 0.65,
  windForce: 0.25,
  fogDensity: 0.0022,
  cameraMode: 'orbit',
  followSubMode: 'chase',
  audioEnabled: false,
};
