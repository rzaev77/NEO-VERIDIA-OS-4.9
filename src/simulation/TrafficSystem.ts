import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_CONFIG, SpinnerState } from '../types';

export const MAX_TRAFFIC_AGENTS = 500;
const CORRIDOR_HALF_LEN = 310;
const CORRIDOR_FULL_LEN = CORRIDOR_HALF_LEN * 2;
const ALTITUDE_ECHELONS = [22, 36, 52, 70]; // Z, X, Z, X

interface CorridorDef {
  index: number;
  axis: 'x' | 'z';
  coord: number;
  altitude: number;
}

function createSpinnerChassisGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Main sleek wedge fuselage (forward is +Z)
  const body = new THREE.BoxGeometry(1.45, 0.52, 4.2);
  body.translate(0, 0, 0);
  parts.push(body);

  // Armored canopy / cockpit dome
  const cabin = new THREE.BoxGeometry(1.06, 0.42, 1.9);
  cabin.translate(0, 0.36, -0.15);
  parts.push(cabin);

  // Front nose splitter
  const nose = new THREE.BoxGeometry(1.15, 0.28, 1.1);
  nose.translate(0, -0.08, 2.2);
  parts.push(nose);

  // Left & Right thruster nacelles
  const leftPod = new THREE.BoxGeometry(0.46, 0.46, 3.2);
  leftPod.translate(-0.96, -0.02, -0.2);
  parts.push(leftPod);

  const rightPod = new THREE.BoxGeometry(0.46, 0.46, 3.2);
  rightPod.translate(0.96, -0.02, -0.2);
  parts.push(rightPod);

  // Rear stabilizer fins
  const leftFin = new THREE.BoxGeometry(0.12, 0.45, 0.9);
  leftFin.translate(-1.05, 0.28, -1.55);
  parts.push(leftFin);

  const rightFin = new THREE.BoxGeometry(0.12, 0.45, 0.9);
  rightFin.translate(1.05, 0.28, -1.55);
  parts.push(rightFin);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    throw new Error('Failed to merge spinner chassis geometry');
  }
  return merged;
}

function createColoredPart(
  geo: THREE.BufferGeometry,
  color: THREE.Color
): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function createSpinnerLightsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const headColor = new THREE.Color(0.82, 0.96, 1.0);
  const tailColor = new THREE.Color(1.0, 0.16, 0.22);

  // Twin bright headlights (+Z front)
  const hlLeft = new THREE.BoxGeometry(0.32, 0.14, 0.18);
  hlLeft.translate(-0.56, -0.04, 2.75);
  parts.push(createColoredPart(hlLeft, headColor));

  const hlRight = new THREE.BoxGeometry(0.32, 0.14, 0.18);
  hlRight.translate(0.56, -0.04, 2.75);
  parts.push(createColoredPart(hlRight, headColor));

  // Rear engine thrusters & brake light bar (-Z rear)
  const tlLeft = new THREE.BoxGeometry(0.36, 0.22, 0.22);
  tlLeft.translate(-0.96, -0.02, -1.85);
  parts.push(createColoredPart(tlLeft, tailColor));

  const tlRight = new THREE.BoxGeometry(0.36, 0.22, 0.22);
  tlRight.translate(0.96, -0.02, -1.85);
  parts.push(createColoredPart(tlRight, tailColor));

  const centerBar = new THREE.BoxGeometry(0.95, 0.1, 0.14);
  centerBar.translate(0, 0.08, -2.1);
  parts.push(createColoredPart(centerBar, tailColor));

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    throw new Error('Failed to merge spinner lights geometry');
  }
  return merged;
}

function createTrailGeometry(): THREE.BufferGeometry {
  // Twin ribbon trails extending from z = 0 back to z = -1 (scaled dynamically along Z)
  const parts: THREE.BufferGeometry[] = [];
  for (const xOffset of [-0.96, 0.96]) {
    const plane = new THREE.PlaneGeometry(0.24, 1.0, 1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(xOffset, 0, -0.5);
    parts.push(plane);

    // Cross-ribbon so trail is visible from side angles too
    const vertPlane = new THREE.PlaneGeometry(0.24, 1.0, 1, 1);
    vertPlane.rotateX(-Math.PI / 2);
    vertPlane.rotateZ(Math.PI / 2);
    vertPlane.translate(xOffset, 0, -0.5);
    parts.push(vertPlane);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    throw new Error('Failed to merge spinner trail geometry');
  }
  return merged;
}

export class TrafficSystem {
  public readonly group = new THREE.Group();
  public readonly agents: SpinnerState[] = [];

  private readonly corridors: CorridorDef[] = [];
  private readonly laneBuckets: Map<string, SpinnerState[]> = new Map();

  private readonly chassisMesh: THREE.InstancedMesh;
  private readonly lightsMesh: THREE.InstancedMesh;
  private readonly trailsMesh: THREE.InstancedMesh;
  private readonly pointLights: THREE.PointLight[] = [];

  private readonly lightsShaderUniforms: {
    uFogColor: THREE.IUniform<THREE.Color>;
    uFogDensity: THREE.IUniform<number>;
  };

  private readonly trailsShaderUniforms: {
    uFogColor: THREE.IUniform<THREE.Color>;
    uFogDensity: THREE.IUniform<number>;
  };

  private activeCount = 280;
  private simTime = 0;

  // Reusable math objects
  private readonly dummy = new THREE.Object3D();
  private readonly trailDummy = new THREE.Object3D();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpVec = new THREE.Vector3();

  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor() {
    this.buildCorridors();

    // 1. Chassis InstancedMesh
    const chassisGeo = createSpinnerChassisGeometry();
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x161d2b,
      roughness: 0.28,
      metalness: 0.85,
    });
    this.chassisMesh = new THREE.InstancedMesh(chassisGeo, chassisMat, MAX_TRAFFIC_AGENTS);
    this.chassisMesh.castShadow = true;
    this.chassisMesh.receiveShadow = false;
    this.chassisMesh.frustumCulled = false;
    this.group.add(this.chassisMesh);
    this.disposables.push(chassisGeo, chassisMat);

    // 2. Lights InstancedMesh (HDR Emissive for UnrealBloomPass, unaffected by blackout)
    const lightsGeo = createSpinnerLightsGeometry();
    this.lightsShaderUniforms = {
      uFogColor: { value: new THREE.Color('#060916') },
      uFogDensity: { value: 0.0022 },
    };
    const lightsMat = new THREE.ShaderMaterial({
      uniforms: this.lightsShaderUniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        void main() {
          vColor = color;
          #ifdef USE_INSTANCING_COLOR
            vColor *= instanceColor;
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        void main() {
          vec3 col = vColor * 3.1;
          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fogFactor * 0.85, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.lightsMesh = new THREE.InstancedMesh(lightsGeo, lightsMat, MAX_TRAFFIC_AGENTS);
    this.lightsMesh.frustumCulled = false;
    this.group.add(this.lightsMesh);
    this.disposables.push(lightsGeo, lightsMat);

    // 3. Light Trails InstancedMesh
    const trailGeo = createTrailGeometry();
    this.trailsShaderUniforms = {
      uFogColor: { value: new THREE.Color('#060916') },
      uFogDensity: { value: 0.0022 },
    };
    const trailMat = new THREE.ShaderMaterial({
      uniforms: this.trailsShaderUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.0, 0.9, 1.0);
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        void main() {
          // vUv.y == 1 at vehicle rear, 0 at end of trail
          float alongFade = pow(clamp(vUv.y, 0.0, 1.0), 1.85);
          float crossFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float alpha = alongFade * clamp(crossFade, 0.0, 1.0) * 0.85;

          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          alpha *= (1.0 - clamp(fogFactor * 0.9, 0.0, 1.0));

          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor * 2.3, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.trailsMesh = new THREE.InstancedMesh(trailGeo, trailMat, MAX_TRAFFIC_AGENTS);
    this.trailsMesh.frustumCulled = false;
    this.group.add(this.trailsMesh);
    this.disposables.push(trailGeo, trailMat);

    // 4. Pool of 6 dynamic PointLights attached to nearest / followed spinners
    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight(i % 2 === 0 ? 0x00e5ff : 0xff3b6b, 35, 36, 1.8);
      pl.castShadow = false;
      this.group.add(pl);
      this.pointLights.push(pl);
    }

    this.initAgents();
    this.setActiveCount(this.activeCount);
  }

  private buildCorridors(): void {
    // Inner 9 streets along X and Z: indices k = 1..9 -> coords -208..+208
    const streetCoords: number[] = [];
    for (let k = 1; k < CITY_CONFIG.gridSize; k++) {
      streetCoords.push((k - CITY_CONFIG.gridSize * 0.5) * CITY_CONFIG.blockStep);
    }

    let idx = 0;
    for (let e = 0; e < ALTITUDE_ECHELONS.length; e++) {
      const axis: 'x' | 'z' = e % 2 === 0 ? 'z' : 'x';
      const altitude = ALTITUDE_ECHELONS[e];
      for (const coord of streetCoords) {
        this.corridors.push({
          index: idx++,
          axis,
          coord,
          altitude,
        });
      }
    }
  }

  private initAgents(): void {
    const trailPalette = [
      new THREE.Color('#00f0ff'),
      new THREE.Color('#ff2a55'),
      new THREE.Color('#ff7b00'),
      new THREE.Color('#38b6ff'),
      new THREE.Color('#ff2a9d'),
    ];
    const chassisColors = [
      new THREE.Color('#1a2233'),
      new THREE.Color('#211d2b'),
      new THREE.Color('#14252a'),
      new THREE.Color('#272932'),
    ];

    for (let i = 0; i < MAX_TRAFFIC_AGENTS; i++) {
      const corridor = this.corridors[i % this.corridors.length];
      const direction: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const lane: 0 | 1 = ((i >> 1) % 2) as 0 | 1;
      const along = -CORRIDOR_HALF_LEN + Math.random() * CORRIDOR_FULL_LEN;
      const cruiseFactor = 0.72 + Math.random() * 0.56;
      const trailColor = trailPalette[i % trailPalette.length];

      const agent: SpinnerState = {
        id: i + 1,
        active: i < this.activeCount,
        corridorIndex: corridor.index,
        axis: corridor.axis,
        direction,
        lane,
        targetLane: lane,
        laneProgress: 1.0,
        laneChangeCooldown: Math.random() * 2.0,
        corridorCoord: corridor.coord,
        baseAltitude: corridor.altitude + (Math.random() - 0.5) * 1.6,
        along,
        speed: 35 * cruiseFactor,
        cruiseFactor,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        roll: 0,
        pitch: 0,
        yaw: this.computeYaw(corridor.axis, direction),
        tailLength: 10,
        headlightColor: new THREE.Color('#ffffff'),
        taillightColor: trailColor.clone(),
        phaseOffset: Math.random() * Math.PI * 2,
      };

      this.updateAgentPositionFromLane(agent, 0);
      this.agents.push(agent);

      this.chassisMesh.setColorAt(i, chassisColors[i % chassisColors.length]);
      this.lightsMesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.trailsMesh.setColorAt(i, trailColor);
    }

    if (this.chassisMesh.instanceColor) this.chassisMesh.instanceColor.needsUpdate = true;
    if (this.lightsMesh.instanceColor) this.lightsMesh.instanceColor.needsUpdate = true;
    if (this.trailsMesh.instanceColor) this.trailsMesh.instanceColor.needsUpdate = true;
  }

  private computeYaw(axis: 'x' | 'z', direction: 1 | -1): number {
    if (axis === 'z') {
      return direction === 1 ? 0 : Math.PI;
    }
    return direction === 1 ? Math.PI * 0.5 : -Math.PI * 0.5;
  }

  private getLateralOffset(direction: 1 | -1, laneFrac: number): number {
    // Lane 0 is inner (2.2m from center), Lane 1 is outer (4.6m from center)
    // Stay strictly inside +-8m street half-width
    const offsetMag = 2.2 + laneFrac * 2.4;
    return direction * offsetMag;
  }

  private updateAgentPositionFromLane(agent: SpinnerState, windForce: number): void {
    const laneFrac = THREE.MathUtils.lerp(agent.lane, agent.targetLane, agent.laneProgress);
    const lateral = this.getLateralOffset(agent.direction, laneFrac);
    const windSway =
      Math.sin(this.simTime * 1.9 + agent.phaseOffset) * windForce * 0.65 +
      Math.cos(this.simTime * 3.1 + agent.phaseOffset) * Math.abs(windForce) * 0.25;
    const altBob = Math.sin(this.simTime * 1.4 + agent.phaseOffset) * 0.35;

    if (agent.axis === 'z') {
      agent.position.set(
        agent.corridorCoord + lateral + windSway,
        agent.baseAltitude + altBob,
        agent.along
      );
      agent.velocity.set(0, 0, agent.direction * agent.speed);
    } else {
      agent.position.set(
        agent.along,
        agent.baseAltitude + altBob,
        agent.corridorCoord - lateral + windSway
      );
      agent.velocity.set(agent.direction * agent.speed, 0, 0);
    }
  }

  public setActiveCount(count: number): void {
    this.activeCount = THREE.MathUtils.clamp(Math.round(count), 1, MAX_TRAFFIC_AGENTS);
    for (let i = 0; i < MAX_TRAFFIC_AGENTS; i++) {
      this.agents[i].active = i < this.activeCount;
    }
    this.chassisMesh.count = this.activeCount;
    this.lightsMesh.count = this.activeCount;
    this.trailsMesh.count = this.activeCount;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getAgent(index: number): SpinnerState {
    const safeIdx = ((index % this.activeCount) + this.activeCount) % this.activeCount;
    return this.agents[safeIdx];
  }

  public updateFixed(dt: number, maxSpeed: number, windForce: number): void {
    this.simTime += dt;

    // Group active agents by (corridorIndex, direction) for O(N log N) spacing checks
    this.laneBuckets.clear();
    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i];
      const key = `${a.corridorIndex}_${a.direction}`;
      let list = this.laneBuckets.get(key);
      if (!list) {
        list = [];
        this.laneBuckets.set(key, list);
      }
      list.push(a);
    }

    for (const groupAgents of this.laneBuckets.values()) {
      for (let i = 0; i < groupAgents.length; i++) {
        const self = groupAgents[i];
        self.laneChangeCooldown = Math.max(0, self.laneChangeCooldown - dt);

        // Find closest ahead agent on current or target lane
        let minAheadDist = CORRIDOR_FULL_LEN;
        let leadSpeed = maxSpeed;

        for (let j = 0; j < groupAgents.length; j++) {
          if (i === j) continue;
          const other = groupAgents[j];
          const sameLane =
            other.lane === self.lane ||
            other.targetLane === self.lane ||
            other.lane === self.targetLane ||
            other.targetLane === self.targetLane;
          if (!sameLane) continue;

          const d =
            ((other.along - self.along) * self.direction + CORRIDOR_FULL_LEN) %
            CORRIDOR_FULL_LEN;
          if (d > 0.05 && d < minAheadDist) {
            minAheadDist = d;
            leadSpeed = other.speed;
          }
        }

        const desiredCruise = Math.max(12, maxSpeed * self.cruiseFactor);
        const safeDist = 13 + self.speed * 0.42;
        let targetSpeed = desiredCruise;

        if (minAheadDist < safeDist) {
          // Try switching lanes if not already switching
          if (self.lane === self.targetLane && self.laneChangeCooldown <= 0) {
            const candidateLane: 0 | 1 = self.lane === 0 ? 1 : 0;
            let clearFront = CORRIDOR_FULL_LEN;
            let clearBack = CORRIDOR_FULL_LEN;

            for (let j = 0; j < groupAgents.length; j++) {
              if (i === j) continue;
              const other = groupAgents[j];
              if (other.lane !== candidateLane && other.targetLane !== candidateLane) continue;
              const ahead =
                ((other.along - self.along) * self.direction + CORRIDOR_FULL_LEN) %
                CORRIDOR_FULL_LEN;
              const behind = CORRIDOR_FULL_LEN - ahead;
              if (ahead < clearFront) clearFront = ahead;
              if (behind < clearBack) clearBack = behind;
            }

            if (clearFront > safeDist * 1.1 && clearBack > 14) {
              self.targetLane = candidateLane;
              self.laneProgress = 0;
              self.laneChangeCooldown = 2.8 + Math.random() * 1.5;
            }
          }

          if (minAheadDist < 7.0) {
            targetSpeed = Math.max(3, leadSpeed * 0.65);
          } else {
            const ratio = THREE.MathUtils.clamp((minAheadDist - 7.0) / (safeDist - 7.0), 0, 1);
            targetSpeed = THREE.MathUtils.lerp(Math.min(desiredCruise, leadSpeed * 0.94), desiredCruise, ratio);
          }
        }

        // Smooth acceleration & braking
        const accelRate = targetSpeed > self.speed ? 18.0 : 32.0;
        self.speed = THREE.MathUtils.lerp(self.speed, targetSpeed, 1 - Math.exp(-accelRate * dt * 0.25));

        // Advance along corridor with wraparound
        self.along += self.direction * self.speed * dt;
        if (self.along > CORRIDOR_HALF_LEN) {
          self.along -= CORRIDOR_FULL_LEN;
        } else if (self.along < -CORRIDOR_HALF_LEN) {
          self.along += CORRIDOR_FULL_LEN;
        }

        // Progress lane change smoothly
        let laneChangeRoll = 0;
        if (self.lane !== self.targetLane) {
          self.laneProgress = Math.min(1, self.laneProgress + dt * 1.35);
          const laneDelta = self.targetLane - self.lane;
          laneChangeRoll = Math.sin(self.laneProgress * Math.PI) * laneDelta * 0.42;
          if (self.laneProgress >= 1) {
            self.lane = self.targetLane;
            self.laneProgress = 1;
          }
        }

        // Aerodynamic roll & pitch from wind turbulence and acceleration
        const windRoll = Math.sin(this.simTime * 2.3 + self.phaseOffset) * windForce * 0.14;
        const targetRoll = laneChangeRoll + windRoll;
        const targetPitch = THREE.MathUtils.clamp((self.speed - targetSpeed) * 0.008, -0.14, 0.14);

        self.roll = THREE.MathUtils.lerp(self.roll, targetRoll, 1 - Math.exp(-8 * dt));
        self.pitch = THREE.MathUtils.lerp(self.pitch, targetPitch, 1 - Math.exp(-8 * dt));
        self.yaw = this.computeYaw(self.axis, self.direction);
        self.tailLength = THREE.MathUtils.clamp(3.0 + self.speed * 0.26, 3.0, 32.0);

        this.updateAgentPositionFromLane(self, windForce);
      }
    }
  }

  public syncInstances(
    cameraPos: THREE.Vector3,
    followedIndex: number,
    fogColor: THREE.Color,
    fogDensity: number
  ): void {
    this.lightsShaderUniforms.uFogColor.value.copy(fogColor);
    this.lightsShaderUniforms.uFogDensity.value = fogDensity;
    this.trailsShaderUniforms.uFogColor.value.copy(fogColor);
    this.trailsShaderUniforms.uFogDensity.value = fogDensity;

    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i];

      this.tmpEuler.set(a.pitch, a.yaw, a.roll, 'YXZ');
      this.tmpQuat.setFromEuler(this.tmpEuler);

      this.dummy.position.copy(a.position);
      this.dummy.quaternion.copy(this.tmpQuat);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();

      this.chassisMesh.setMatrixAt(i, this.dummy.matrix);
      this.lightsMesh.setMatrixAt(i, this.dummy.matrix);

      // Trail positioned directly behind thrusters and scaled by tailLength along local -Z
      this.tmpVec.set(0, -0.02, -1.88).applyQuaternion(this.tmpQuat).add(a.position);
      this.trailDummy.position.copy(this.tmpVec);
      this.trailDummy.quaternion.copy(this.tmpQuat);
      this.trailDummy.scale.set(1, 1, a.tailLength);
      this.trailDummy.updateMatrix();
      this.trailsMesh.setMatrixAt(i, this.trailDummy.matrix);
    }

    this.chassisMesh.instanceMatrix.needsUpdate = true;
    this.lightsMesh.instanceMatrix.needsUpdate = true;
    this.trailsMesh.instanceMatrix.needsUpdate = true;

    // Position the 6 real PointLights on followed spinner + nearest 5 spinners
    this.updateDynamicPointLights(cameraPos, followedIndex);
  }

  private updateDynamicPointLights(cameraPos: THREE.Vector3, followedIndex: number): void {
    const chosen: Array<{ idx: number; distSq: number }> = [];

    if (followedIndex >= 0 && followedIndex < this.activeCount) {
      chosen.push({ idx: followedIndex, distSq: 0 });
    }

    for (let i = 0; i < this.activeCount; i++) {
      if (i === followedIndex) continue;
      const d2 = this.agents[i].position.distanceToSquared(cameraPos);
      if (chosen.length < this.pointLights.length) {
        chosen.push({ idx: i, distSq: d2 });
        chosen.sort((a, b) => a.distSq - b.distSq);
      } else if (d2 < chosen[chosen.length - 1].distSq) {
        chosen[chosen.length - 1] = { idx: i, distSq: d2 };
        chosen.sort((a, b) => a.distSq - b.distSq);
      }
    }

    for (let i = 0; i < this.pointLights.length; i++) {
      const pl = this.pointLights[i];
      if (i < chosen.length) {
        const agent = this.agents[chosen[i].idx];
        // Place light slightly ahead of nose headlights
        const forward = new THREE.Vector3(0, 0, 3.2)
          .applyEuler(new THREE.Euler(agent.pitch, agent.yaw, agent.roll, 'YXZ'))
          .add(agent.position);
        pl.position.copy(forward);
        pl.color.copy(agent.taillightColor).lerp(new THREE.Color(0xcceeff), 0.6);
        pl.intensity = 38;
      } else {
        pl.intensity = 0;
      }
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
