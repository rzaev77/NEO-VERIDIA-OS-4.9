import * as THREE from 'three';
import { CITY_CONFIG } from '../types';
import { createWetAsphaltMaterial, WetAsphaltUniforms } from '../shaders/WetAsphaltShader';
import { createHologramMaterial, HologramUniforms } from '../shaders/HologramShader';
import { ProceduralTexturePack } from './ProceduralTextures';

export interface CityWorld {
  group: THREE.Group;
  asphaltUniforms: WetAsphaltUniforms;
  hologramUniformsList: HologramUniforms[];
  update: (
    time: number,
    districtPower: Float32Array,
    fogColor: THREE.Color,
    fogDensity: number,
    rainIntensity: number,
    windForce: number,
    skyHorizonColor: THREE.Color,
    neon1: THREE.Color,
    neon2: THREE.Color,
    sunGlowColor: THREE.Color,
    sunGlowStrength: number
  ) => void;
  dispose: () => void;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function getDistrictIndexAt(x: number, z: number): number {
  const halfSpan = CITY_CONFIG.citySpan * 0.5;
  const districtSize = CITY_CONFIG.citySpan * 0.25;
  const dx = THREE.MathUtils.clamp(Math.floor((x + halfSpan) / districtSize), 0, 3);
  const dz = THREE.MathUtils.clamp(Math.floor((z + halfSpan) / districtSize), 0, 3);
  return dz * 4 + dx;
}

interface BuildingSpec {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  districtId: number;
  styleIdx: number;
  accentColor: THREE.Color;
  seed: number;
}

interface HologramPlacement {
  matrix: THREE.Matrix4;
  textureIdx: number;
  districtId: number;
  tintColor: THREE.Color;
  phase: number;
}

interface BeaconPlacement {
  x: number;
  y: number;
  z: number;
  phase: number;
  scale: number;
}

export function generateCity(textures: ProceduralTexturePack): CityWorld {
  const group = new THREE.Group();
  const rand = seededRandom(13372077);
  const sharedDistrictPower: number[] = new Array(CITY_CONFIG.districtCount).fill(1.0);
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Wet Asphalt Ground Plane
  const asphaltGeo = new THREE.PlaneGeometry(CITY_CONFIG.asphaltSize, CITY_CONFIG.asphaltSize, 1, 1);
  asphaltGeo.rotateX(-Math.PI / 2);
  const { material: asphaltMat, uniforms: asphaltUniforms } = createWetAsphaltMaterial();
  asphaltUniforms.uDistrictPower.value = sharedDistrictPower;
  const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphaltMesh.position.y = 0;
  group.add(asphaltMesh);
  disposables.push(asphaltGeo, asphaltMat);

  // 2. Sidewalk Block Plazas (10x10 = 100 blocks)
  const blockCount = CITY_CONFIG.gridSize * CITY_CONFIG.gridSize;
  const sidewalkWidth = CITY_CONFIG.blockStep - CITY_CONFIG.streetWidth; // 36m
  const sidewalkGeo = new THREE.BoxGeometry(sidewalkWidth, 0.5, sidewalkWidth);
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0x101624,
    roughness: 0.45,
    metalness: 0.35,
  });
  const sidewalksMesh = new THREE.InstancedMesh(sidewalkGeo, sidewalkMat, blockCount);
  sidewalksMesh.receiveShadow = true;
  sidewalksMesh.castShadow = false;

  const dummy = new THREE.Object3D();
  const buildings: BuildingSpec[] = [];
  const antennas: Array<{ x: number; y: number; z: number; h: number; r: number }> = [];
  const beacons: BeaconPlacement[] = [];
  const holograms: HologramPlacement[] = [];

  const neonPalette = [
    new THREE.Color('#00f0ff'),
    new THREE.Color('#ff2a85'),
    new THREE.Color('#ffae00'),
    new THREE.Color('#39ff9c'),
    new THREE.Color('#7b5cff'),
  ];

  let blockIdx = 0;
  for (let gz = 0; gz < CITY_CONFIG.gridSize; gz++) {
    for (let gx = 0; gx < CITY_CONFIG.gridSize; gx++) {
      const bx = (gx - (CITY_CONFIG.gridSize - 1) * 0.5) * CITY_CONFIG.blockStep;
      const bz = (gz - (CITY_CONFIG.gridSize - 1) * 0.5) * CITY_CONFIG.blockStep;

      dummy.position.set(bx, 0.25, bz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      sidewalksMesh.setMatrixAt(blockIdx++, dummy.matrix);

      const districtId = getDistrictIndexAt(bx, bz);
      const distFromCenter = Math.hypot(bx, bz) / (CITY_CONFIG.citySpan * 0.5);
      const centerBoost = Math.max(0.2, 1.25 - distFromCenter * 0.72);

      // Build tiered cyberpunk megastructures inside the 36x36 block (stay inside +-16.5m)
      const isSuperTower = rand() < (distFromCenter < 0.55 ? 0.52 : 0.24);

      if (isSuperTower) {
        // Base podium
        const baseW = 24 + rand() * 8;
        const baseD = 24 + rand() * 8;
        const baseH = 14 + rand() * 18;
        const accent = neonPalette[Math.floor(rand() * neonPalette.length)];
        const styleIdx = Math.floor(rand() * 4);

        buildings.push({
          x: bx,
          z: bz,
          w: baseW,
          h: baseH,
          d: baseD,
          districtId,
          styleIdx,
          accentColor: accent,
          seed: rand() * 100,
        });

        // Main monolith shaft
        const mainW = baseW * (0.62 + rand() * 0.2);
        const mainD = baseD * (0.62 + rand() * 0.2);
        const mainH = (68 + rand() * 110) * centerBoost;
        const offX = (rand() - 0.5) * (baseW - mainW) * 0.5;
        const offZ = (rand() - 0.5) * (baseD - mainD) * 0.5;

        buildings.push({
          x: bx + offX,
          z: bz + offZ,
          w: mainW,
          h: mainH,
          d: mainD,
          districtId,
          styleIdx,
          accentColor: accent,
          seed: rand() * 100,
        });

        // Upper crown tier
        let topY = mainH;
        if (rand() > 0.3) {
          const crownW = mainW * 0.6;
          const crownD = mainD * 0.6;
          const crownH = mainH + 14 + rand() * 28;
          buildings.push({
            x: bx + offX,
            z: bz + offZ,
            w: crownW,
            h: crownH,
            d: crownD,
            districtId,
            styleIdx: (styleIdx + 1) % 4,
            accentColor: neonPalette[Math.floor(rand() * neonPalette.length)],
            seed: rand() * 100,
          });
          topY = crownH;
        }

        // Roof spire / antenna + blinking aviation warning beacon
        const spireH = 10 + rand() * 24;
        antennas.push({
          x: bx + offX,
          y: topY,
          z: bz + offZ,
          h: spireH,
          r: 0.26,
        });
        beacons.push({
          x: bx + offX,
          y: topY + spireH + 0.4,
          z: bz + offZ,
          phase: rand() * Math.PI * 2,
          scale: 1.0,
        });

        // Corner beacons on tall towers
        if (topY > 85) {
          beacons.push({
            x: bx + offX + mainW * 0.44,
            y: mainH + 0.45,
            z: bz + offZ + mainD * 0.44,
            phase: rand() * Math.PI * 2,
            scale: 0.72,
          });
          beacons.push({
            x: bx + offX - mainW * 0.44,
            y: mainH + 0.45,
            z: bz + offZ - mainD * 0.44,
            phase: rand() * Math.PI * 2,
            scale: 0.72,
          });
        }

        // Holographic billboard mounted on tower facing nearby street
        if (rand() < 0.68) {
          const side = Math.floor(rand() * 4);
          const holoW = mainW * (0.72 + rand() * 0.26);
          const holoH = holoW * 0.5;
          const holoY = Math.min(topY - holoH * 0.6, 20 + rand() * 45);
          const mat = new THREE.Matrix4();
          const pos = new THREE.Vector3(bx + offX, holoY, bz + offZ);
          const rot = new THREE.Euler();

          const offsetOut = 1.05;
          if (side === 0) {
            pos.z += mainD * 0.5 + offsetOut;
            rot.y = 0;
          } else if (side === 1) {
            pos.z -= mainD * 0.5 + offsetOut;
            rot.y = Math.PI;
          } else if (side === 2) {
            pos.x += mainW * 0.5 + offsetOut;
            rot.y = Math.PI * 0.5;
          } else {
            pos.x -= mainW * 0.5 + offsetOut;
            rot.y = -Math.PI * 0.5;
          }

          const q = new THREE.Quaternion().setFromEuler(rot);
          mat.compose(pos, q, new THREE.Vector3(holoW, holoH, 1));
          holograms.push({
            matrix: mat,
            textureIdx: Math.floor(rand() * textures.hologramTextures.length),
            districtId,
            tintColor: neonPalette[Math.floor(rand() * neonPalette.length)],
            phase: rand(),
          });
        }
      } else {
        // Multi-building dense urban cluster inside block
        const subOffsets = [
          [-7.8, -7.8],
          [7.8, -7.8],
          [-7.8, 7.8],
          [7.8, 7.8],
        ];
        for (const [sx, sz] of subOffsets) {
          if (rand() < 0.14) continue; // occasional alley courtyard
          const w = 11 + rand() * 4.2;
          const d = 11 + rand() * 4.2;
          const h = (24 + rand() * 68) * centerBoost;
          const styleIdx = Math.floor(rand() * 4);
          const accent = neonPalette[Math.floor(rand() * neonPalette.length)];
          const cx = bx + sx + (rand() - 0.5) * 1.4;
          const cz = bz + sz + (rand() - 0.5) * 1.4;

          buildings.push({
            x: cx,
            z: cz,
            w,
            h,
            d,
            districtId,
            styleIdx,
            accentColor: accent,
            seed: rand() * 100,
          });

          if (h > 42 && rand() > 0.45) {
            const spireH = 5 + rand() * 11;
            antennas.push({ x: cx, y: h, z: cz, h: spireH, r: 0.18 });
            beacons.push({
              x: cx,
              y: h + spireH + 0.35,
              z: cz,
              phase: rand() * Math.PI * 2,
              scale: 0.78,
            });
          }

          if (rand() < 0.19 && h > 30) {
            const holoW = w * 0.85;
            const holoH = holoW * 0.5;
            const holoY = 16 + rand() * Math.max(8, h - 22);
            const pos = new THREE.Vector3(cx, holoY, cz);
            const rot = new THREE.Euler();
            // Face outward toward perimeter street of block
            if (Math.abs(sx) > Math.abs(sz) || rand() > 0.5) {
              pos.x += (sx > 0 ? 1 : -1) * (w * 0.5 + 0.9);
              rot.y = sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
            } else {
              pos.z += (sz > 0 ? 1 : -1) * (d * 0.5 + 0.9);
              rot.y = sz > 0 ? 0 : Math.PI;
            }
            const mat = new THREE.Matrix4().compose(
              pos,
              new THREE.Quaternion().setFromEuler(rot),
              new THREE.Vector3(holoW, holoH, 1)
            );
            holograms.push({
              matrix: mat,
              textureIdx: Math.floor(rand() * textures.hologramTextures.length),
              districtId,
              tintColor: accent,
              phase: rand(),
            });
          }
        }
      }
    }
  }

  sidewalksMesh.instanceMatrix.needsUpdate = true;
  group.add(sidewalksMesh);
  disposables.push(sidewalkGeo, sidewalkMat);

  // 3. Instanced Skyscraper Megastructures with Custom Window/Blackout Shader Hook
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // Shift unit box so y=0 is bottom face
  boxGeo.translate(0, 0.5, 0);

  const buildingCount = buildings.length;
  const aDistrictId = new Float32Array(buildingCount);
  const aStyleQuadrant = new Float32Array(buildingCount * 2);
  const aWindowScale = new Float32Array(buildingCount * 2);
  const aAccentColor = new Float32Array(buildingCount * 3);
  const aBuildingSeed = new Float32Array(buildingCount);

  const buildingShaderUniforms = {
    uTime: { value: 0 },
    uWindowAtlas: { value: textures.windowAtlas },
    uDistrictPower: { value: sharedDistrictPower },
  };

  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0x0f1522,
    roughness: 0.38,
    metalness: 0.62,
  });

  buildingMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = buildingShaderUniforms.uTime;
    shader.uniforms.uWindowAtlas = buildingShaderUniforms.uWindowAtlas;
    shader.uniforms.uDistrictPower = buildingShaderUniforms.uDistrictPower;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aDistrictId;
        attribute vec2 aStyleQuadrant;
        attribute vec2 aWindowScale;
        attribute vec3 aAccentColor;
        attribute float aBuildingSeed;

        varying float vDistrictId;
        varying vec2 vStyleQuadrant;
        varying vec2 vWindowScale;
        varying vec3 vAccentColor;
        varying float vBuildingSeed;
        varying vec2 vWallUv;
        varying vec3 vLocalNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDistrictId = aDistrictId;
        vStyleQuadrant = aStyleQuadrant;
        vWindowScale = aWindowScale;
        vAccentColor = aAccentColor;
        vBuildingSeed = aBuildingSeed;
        vWallUv = uv;
        vLocalNormal = normal;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uWindowAtlas;
        uniform float uDistrictPower[16];

        varying float vDistrictId;
        varying vec2 vStyleQuadrant;
        varying vec2 vWindowScale;
        varying vec3 vAccentColor;
        varying float vBuildingSeed;
        varying vec2 vWallUv;
        varying vec3 vLocalNormal;

        float getBuildingDistrictPower(int idx) {
          float p = 1.0;
          for (int i = 0; i < 16; i++) {
            if (i == idx) {
              p = uDistrictPower[i];
            }
          }
          return p;
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float isWall = step(abs(vLocalNormal.y), 0.5);
        float power = getBuildingDistrictPower(int(vDistrictId + 0.5));

        // Electrical surge flicker during blackout transition
        float flicker = 1.0;
        if (power > 0.02 && power < 0.96) {
          float pulse = sin(uTime * 52.0 + vBuildingSeed * 19.3) * sin(uTime * 23.0 + vDistrictId);
          flicker = step(-0.25, pulse) * (0.4 + 0.8 * power);
        }

        if (isWall > 0.5 && power > 0.01) {
          vec2 tiledUv = fract(vWallUv * vWindowScale);
          vec2 atlasUv = vStyleQuadrant + tiledUv * 0.49 + vec2(0.005);
          vec3 winTex = texture2D(uWindowAtlas, atlasUv).rgb;
          // Convert sRGB atlas luminance into punchy HDR emission for UnrealBloomPass
          vec3 linearWin = pow(winTex, vec3(2.0));
          float lum = dot(linearWin, vec3(0.299, 0.587, 0.114));
          float litMask = smoothstep(0.03, 0.12, lum);

          // Subtle roof-edge neon trim strip on walls
          float crownBand = smoothstep(0.965, 0.985, vWallUv.y) * smoothstep(1.0, 0.992, vWallUv.y);

          vec3 windowEmission = linearWin * litMask * 1.85;
          vec3 trimEmission = vAccentColor * crownBand * 2.1;

          totalEmissiveRadiance += (windowEmission + trimEmission) * power * flicker;
        }`
      );
  };

  const buildingsMesh = new THREE.InstancedMesh(boxGeo, buildingMat, buildingCount);
  buildingsMesh.castShadow = true;
  buildingsMesh.receiveShadow = true;

  for (let i = 0; i < buildingCount; i++) {
    const b = buildings[i];
    dummy.position.set(b.x, 0.5, b.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    buildingsMesh.setMatrixAt(i, dummy.matrix);

    aDistrictId[i] = b.districtId;
    const qx = b.styleIdx % 2 === 1 ? 0.5 : 0.0;
    const qy = b.styleIdx >= 2 ? 0.5 : 0.0;
    aStyleQuadrant[i * 2] = qx;
    aStyleQuadrant[i * 2 + 1] = qy;

    aWindowScale[i * 2] = Math.max(1, Math.round(b.w / 14));
    aWindowScale[i * 2 + 1] = Math.max(1, Math.round(b.h / 26));

    aAccentColor[i * 3] = b.accentColor.r;
    aAccentColor[i * 3 + 1] = b.accentColor.g;
    aAccentColor[i * 3 + 2] = b.accentColor.b;

    aBuildingSeed[i] = b.seed;
  }

  boxGeo.setAttribute('aDistrictId', new THREE.InstancedBufferAttribute(aDistrictId, 1));
  boxGeo.setAttribute('aStyleQuadrant', new THREE.InstancedBufferAttribute(aStyleQuadrant, 2));
  boxGeo.setAttribute('aWindowScale', new THREE.InstancedBufferAttribute(aWindowScale, 2));
  boxGeo.setAttribute('aAccentColor', new THREE.InstancedBufferAttribute(aAccentColor, 3));
  boxGeo.setAttribute('aBuildingSeed', new THREE.InstancedBufferAttribute(aBuildingSeed, 1));

  buildingsMesh.instanceMatrix.needsUpdate = true;
  group.add(buildingsMesh);
  disposables.push(boxGeo, buildingMat);

  // 4. Rooftop Antennas & Spires (InstancedMesh)
  if (antennas.length > 0) {
    const antGeo = new THREE.CylinderGeometry(0.18, 0.75, 1, 6);
    antGeo.translate(0, 0.5, 0);
    const antMat = new THREE.MeshStandardMaterial({
      color: 0x1a2233,
      roughness: 0.5,
      metalness: 0.85,
    });
    const antennasMesh = new THREE.InstancedMesh(antGeo, antMat, antennas.length);
    for (let i = 0; i < antennas.length; i++) {
      const a = antennas[i];
      dummy.position.set(a.x, a.y + 0.5, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(a.r * 3.5, a.h, a.r * 3.5);
      dummy.updateMatrix();
      antennasMesh.setMatrixAt(i, dummy.matrix);
    }
    antennasMesh.instanceMatrix.needsUpdate = true;
    group.add(antennasMesh);
    disposables.push(antGeo, antMat);
  }

  // 5. Emergency Rooftop Aviation Beacons (Stay ON even during full blackout!)
  const beaconUniforms = {
    uTime: { value: 0 },
  };
  if (beacons.length > 0) {
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 8);
    const aBeaconPhase = new Float32Array(beacons.length);

    const beaconMat = new THREE.ShaderMaterial({
      uniforms: beaconUniforms,
      vertexShader: /* glsl */ `
        attribute float aBeaconPhase;
        varying float vPhase;
        void main() {
          vPhase = aBeaconPhase;
          vec4 instPos = instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instPos;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        varying float vPhase;
        void main() {
          float pulse = pow(max(0.0, sin(uTime * 3.4 + vPhase)), 6.0);
          float intensity = 0.35 + pulse * 3.2;
          gl_FragColor = vec4(1.0 * intensity, 0.11 * intensity, 0.14 * intensity, 1.0);
        }
      `,
    });

    const beaconsMesh = new THREE.InstancedMesh(beaconGeo, beaconMat, beacons.length);
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      dummy.position.set(b.x, b.y + 0.5, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      beaconsMesh.setMatrixAt(i, dummy.matrix);
      aBeaconPhase[i] = b.phase;
    }
    beaconGeo.setAttribute('aBeaconPhase', new THREE.InstancedBufferAttribute(aBeaconPhase, 1));
    beaconsMesh.instanceMatrix.needsUpdate = true;
    group.add(beaconsMesh);
    disposables.push(beaconGeo, beaconMat);
  }

  // 6. Holographic Billboards grouped by texture (6 InstancedMeshes = 6 draw calls)
  const hologramUniformsList: HologramUniforms[] = [];
  const groupedHolograms: HologramPlacement[][] = textures.hologramTextures.map(() => []);
  for (const h of holograms) {
    groupedHolograms[h.textureIdx].push(h);
  }

  for (let tIdx = 0; tIdx < groupedHolograms.length; tIdx++) {
    const items = groupedHolograms[tIdx];
    if (items.length === 0) continue;

    const planeGeo = new THREE.PlaneGeometry(1, 1, 8, 4);
    const { material: holoMat, uniforms: holoUniforms } = createHologramMaterial(
      textures.hologramTextures[tIdx],
      sharedDistrictPower
    );

    const aDist = new Float32Array(items.length);
    const aTint = new Float32Array(items.length * 3);
    const aPhase = new Float32Array(items.length);

    const holoMesh = new THREE.InstancedMesh(planeGeo, holoMat, items.length);
    holoMesh.frustumCulled = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      holoMesh.setMatrixAt(i, item.matrix);
      aDist[i] = item.districtId;
      aTint[i * 3] = item.tintColor.r;
      aTint[i * 3 + 1] = item.tintColor.g;
      aTint[i * 3 + 2] = item.tintColor.b;
      aPhase[i] = item.phase;
    }

    planeGeo.setAttribute('aDistrictIndex', new THREE.InstancedBufferAttribute(aDist, 1));
    planeGeo.setAttribute('aTintColor', new THREE.InstancedBufferAttribute(aTint, 3));
    planeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
    holoMesh.instanceMatrix.needsUpdate = true;

    group.add(holoMesh);
    hologramUniformsList.push(holoUniforms);
    disposables.push(planeGeo, holoMat);
  }

  const update = (
    time: number,
    districtPower: Float32Array,
    fogColor: THREE.Color,
    fogDensity: number,
    rainIntensity: number,
    windForce: number,
    skyHorizonColor: THREE.Color,
    neon1: THREE.Color,
    neon2: THREE.Color,
    sunGlowColor: THREE.Color,
    sunGlowStrength: number
  ) => {
    for (let i = 0; i < CITY_CONFIG.districtCount; i++) {
      sharedDistrictPower[i] = districtPower[i];
    }

    buildingShaderUniforms.uTime.value = time;
    beaconUniforms.uTime.value = time;

    asphaltUniforms.uTime.value = time;
    asphaltUniforms.uRainIntensity.value = rainIntensity;
    asphaltUniforms.uWind.value = windForce;
    asphaltUniforms.uFogColor.value.copy(fogColor);
    asphaltUniforms.uFogDensity.value = fogDensity;
    asphaltUniforms.uSkyHorizonColor.value.copy(skyHorizonColor);
    asphaltUniforms.uAmbientNeonColor1.value.copy(neon1);
    asphaltUniforms.uAmbientNeonColor2.value.copy(neon2);
    asphaltUniforms.uSunGlowColor.value.copy(sunGlowColor);
    asphaltUniforms.uSunGlowStrength.value = sunGlowStrength;

    for (const hu of hologramUniformsList) {
      hu.uTime.value = time;
      hu.uFogColor.value.copy(fogColor);
      hu.uFogDensity.value = fogDensity;
    }
  };

  return {
    group,
    asphaltUniforms,
    hologramUniformsList,
    update,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
