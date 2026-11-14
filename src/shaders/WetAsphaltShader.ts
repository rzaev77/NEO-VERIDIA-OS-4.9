import * as THREE from 'three';
import { CITY_CONFIG } from '../types';

export interface WetAsphaltUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uTime: THREE.IUniform<number>;
  uRainIntensity: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
  uSkyHorizonColor: THREE.IUniform<THREE.Color>;
  uAmbientNeonColor1: THREE.IUniform<THREE.Color>;
  uAmbientNeonColor2: THREE.IUniform<THREE.Color>;
  uSunGlowColor: THREE.IUniform<THREE.Color>;
  uSunGlowStrength: THREE.IUniform<number>;
  uDistrictPower: THREE.IUniform<number[]>;
  uBlockStep: THREE.IUniform<number>;
  uStreetWidth: THREE.IUniform<number>;
  uCitySpan: THREE.IUniform<number>;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uRainIntensity;
  uniform float uWind;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uAmbientNeonColor1;
  uniform vec3 uAmbientNeonColor2;
  uniform vec3 uSunGlowColor;
  uniform float uSunGlowStrength;
  uniform float uDistrictPower[16];
  uniform float uBlockStep;
  uniform float uStreetWidth;
  uniform float uCitySpan;

  varying vec3 vWorldPos;
  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += amp * noise(p);
      p = rot * p * 2.03;
      amp *= 0.5;
    }
    return v;
  }

  float getDistrictPower(int idx) {
    float p = 1.0;
    for (int i = 0; i < 16; i++) {
      if (i == idx) {
        p = uDistrictPower[i];
      }
    }
    return p;
  }

  int computeDistrictIndex(vec2 xz) {
    float halfSpan = uCitySpan * 0.5;
    float districtSize = uCitySpan * 0.25;
    int dx = int(clamp(floor((xz.x + halfSpan) / districtSize), 0.0, 3.0));
    int dz = int(clamp(floor((xz.y + halfSpan) / districtSize), 0.0, 3.0));
    return dz * 4 + dx;
  }

  // Animated concentric rain ripples on puddles
  vec2 computeRainRipples(vec2 p, float time, float intensity) {
    if (intensity <= 0.02) {
      return vec2(0.0);
    }
    vec2 totalGrad = vec2(0.0);
    for (int layer = 0; layer < 2; layer++) {
      float scale = layer == 0 ? 1.7 : 2.9;
      vec2 uv = p * scale;
      vec2 cell = floor(uv);
      vec2 f = fract(uv);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 id = cell + neighbor;
          vec2 rnd = hash22(id + float(layer) * 19.37);
          float speed = 1.2 + rnd.x * 1.1;
          float t = fract(time * speed + rnd.y);

          // Spawn fewer ripples when rain intensity is lower
          float rippleActive = step(rnd.x, intensity * 0.95);
          vec2 center = neighbor + 0.15 + 0.7 * rnd;
          vec2 diff = f - center;
          float dist = length(diff);

          float radius = t * 0.48;
          float ring = dist - radius;
          float fade = (1.0 - t) * (1.0 - t);
          float wave = sin(ring * 52.0) * exp(-abs(ring) * 24.0) * fade * rippleActive;

          vec2 dir = dist > 0.0001 ? diff / dist : vec2(0.0);
          totalGrad += dir * wave * 0.18;
        }
      }
    }
    return totalGrad * clamp(intensity * 1.25, 0.0, 1.0);
  }

  void main() {
    vec2 xz = vWorldPos.xz;
    float halfStreet = uStreetWidth * 0.5;

    // Distance to nearest street centerlines along X and Z
    float modX = abs(mod(xz.x + uBlockStep * 0.5, uBlockStep) - uBlockStep * 0.5);
    float modZ = abs(mod(xz.y + uBlockStep * 0.5, uBlockStep) - uBlockStep * 0.5);

    bool inStreetX = modX < halfStreet;
    bool inStreetZ = modZ < halfStreet;
    bool isIntersection = inStreetX && inStreetZ;
    bool isStreet = inStreetX || inStreetZ;

    // Micro asphalt grain
    float grain = noise(xz * 18.0) * 0.5 + noise(xz * 47.0) * 0.5;
    vec3 baseAsphalt = vec3(0.022, 0.025, 0.034) + grain * 0.015;

    // Road markings
    float markingMask = 0.0;
    vec3 markingColor = vec3(0.55, 0.62, 0.72);

    if (inStreetZ && !inStreetX) {
      // Road running along X axis (street center at modZ == 0)
      float centerLine = smoothstep(0.14, 0.06, abs(modZ - 0.18)) + smoothstep(0.14, 0.06, abs(modZ + 0.18));
      float dash = step(0.42, fract(xz.x * 0.14));
      float laneLines = (smoothstep(0.11, 0.04, abs(modZ - 3.6)) + smoothstep(0.11, 0.04, abs(modZ + 3.6))) * dash;
      float edgeLine = smoothstep(0.14, 0.06, abs(modZ - (halfStreet - 0.5))) + smoothstep(0.14, 0.06, abs(modZ + (halfStreet - 0.5)));
      markingMask = clamp(centerLine * 0.8 + laneLines * 0.7 + edgeLine * 0.45, 0.0, 1.0);
      if (centerLine > 0.2) {
        markingColor = vec3(0.82, 0.58, 0.14);
      }
      // Crosswalk near intersection
      float distToCross = modX - halfStreet;
      if (distToCross > 0.8 && distToCross < 3.4) {
        float zebra = step(0.45, fract(modZ * 1.1));
        markingMask = max(markingMask, zebra * 0.78);
        markingColor = vec3(0.7, 0.76, 0.82);
      }
    } else if (inStreetX && !inStreetZ) {
      // Road running along Z axis
      float centerLine = smoothstep(0.14, 0.06, abs(modX - 0.18)) + smoothstep(0.14, 0.06, abs(modX + 0.18));
      float dash = step(0.42, fract(xz.y * 0.14));
      float laneLines = (smoothstep(0.11, 0.04, abs(modX - 3.6)) + smoothstep(0.11, 0.04, abs(modX + 3.6))) * dash;
      float edgeLine = smoothstep(0.14, 0.06, abs(modX - (halfStreet - 0.5))) + smoothstep(0.14, 0.06, abs(modX + (halfStreet - 0.5)));
      markingMask = clamp(centerLine * 0.8 + laneLines * 0.7 + edgeLine * 0.45, 0.0, 1.0);
      if (centerLine > 0.2) {
        markingColor = vec3(0.82, 0.58, 0.14);
      }
      float distToCross = modZ - halfStreet;
      if (distToCross > 0.8 && distToCross < 3.4) {
        float zebra = step(0.45, fract(modX * 1.1));
        markingMask = max(markingMask, zebra * 0.78);
        markingColor = vec3(0.7, 0.76, 0.82);
      }
    } else if (isIntersection) {
      // Subtle intersection box guidelines
      float boxRing = smoothstep(0.18, 0.05, abs(max(modX, modZ) - (halfStreet - 0.45)));
      markingMask = boxRing * 0.35;
    }

    // Outside active street grid looks darker industrial ground
    float outerFade = 1.0 - smoothstep(uCitySpan * 0.5, uCitySpan * 0.5 + 32.0, max(abs(xz.x), abs(xz.y)));
    markingMask *= outerFade;

    vec3 albedo = mix(baseAsphalt, markingColor * 0.55, markingMask * (isStreet ? 0.75 : 0.0));

    // Procedural puddles using FBM noise
    float puddleNoise = fbm(xz * 0.065 + vec2(3.7, 11.2));
    float puddleThreshold = mix(0.78, 0.36, uRainIntensity);
    float puddleMask = smoothstep(puddleThreshold - 0.08, puddleThreshold + 0.09, puddleNoise);
    float wetness = clamp(0.28 + uRainIntensity * 0.72, 0.0, 1.0);

    // Darken wet asphalt slightly
    albedo *= mix(1.0, 0.62, wetness * (0.4 + 0.6 * puddleMask));

    // Surface normal: rough outside puddles, mirror-smooth + rain ripples inside puddles
    vec2 asphaltGrad = vec2(
      noise(xz * 26.0 + vec2(0.1, 0.0)) - noise(xz * 26.0 - vec2(0.1, 0.0)),
      noise(xz * 26.0 + vec2(0.0, 0.1)) - noise(xz * 26.0 - vec2(0.0, 0.1))
    ) * 0.25;

    vec2 rippleGrad = computeRainRipples(xz, uTime, uRainIntensity);
    vec2 windDrift = vec2(uWind, uWind * 0.35) * (noise(xz * 0.9 + uTime * 2.5) - 0.5) * 0.05 * uRainIntensity;
    vec2 finalGrad = mix(asphaltGrad * (1.15 - wetness * 0.65), rippleGrad + windDrift, puddleMask);

    vec3 normal = normalize(vec3(finalGrad.x, 1.0, finalGrad.y));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 reflDir = reflect(-viewDir, normal);

    // Fresnel term (Schlick)
    float NdotV = max(dot(normal, viewDir), 0.0);
    float F0 = mix(0.04, 0.22, wetness * 0.5 + puddleMask * 0.5);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 4.0);

    // District power lookup
    int districtIdx = computeDistrictIndex(xz);
    float districtPower = getDistrictPower(districtIdx);

    // Procedural neon reflections of surrounding skyscrapers & signage
    vec3 neonRefl = vec3(0.0);
    float angle = atan(reflDir.z, reflDir.x);
    float elev = clamp(reflDir.y, 0.0, 1.0);

    // Sky/horizon reflection
    vec3 skyRefl = mix(uSkyHorizonColor * 0.55, uSkyHorizonColor * 0.12, pow(elev, 0.6));
    neonRefl += skyRefl;

    // Toxic dawn / sun directional glint
    if (uSunGlowStrength > 0.01) {
      vec3 sunDir = normalize(vec3(0.65, 0.18, -0.74));
      float sunSpec = pow(max(dot(reflDir, sunDir), 0.0), mix(18.0, 96.0, puddleMask));
      neonRefl += uSunGlowColor * sunSpec * uSunGlowStrength * 1.4;
    }

    // Neon vertical sign strips & glowing skyscraper columns reflected in wet streets
    float blockHash = hash12(floor((xz + reflDir.xz * 28.0) / uBlockStep));
    vec3 signColor = mix(uAmbientNeonColor1, uAmbientNeonColor2, smoothstep(0.25, 0.75, blockHash));
    float verticalColumns = pow(max(0.0, sin(angle * 14.0 + blockHash * 6.2831)), 6.0);
    float verticalBands = pow(max(0.0, sin(reflDir.x * 16.0 + reflDir.z * 11.0 + blockHash * 12.0)), 4.0);
    float windowPattern = smoothstep(0.45, 0.9, sin(elev * 55.0 + blockHash * 15.0) * 0.5 + 0.5);

    // Street-side neon curb strip reflection near building edges
    float nearCurb = smoothstep(halfStreet + 2.0, halfStreet - 3.5, min(modX, modZ));
    float curbGlow = (1.0 - smoothstep(0.0, 4.5, abs(min(modX, modZ) - halfStreet))) * outerFade;

    float reflRoughnessBoost = mix(0.32, 1.15, puddleMask) * wetness;
    vec3 cityNeon = signColor * (verticalColumns * 1.45 + verticalBands * 0.9 * windowPattern) * exp(-elev * 2.8);
    cityNeon += mix(uAmbientNeonColor2, uAmbientNeonColor1, step(0.5, fract(blockHash * 7.13))) * curbGlow * 0.9;

    // Scale city neon reflections by district power (goes dark during blackout!)
    neonRefl += cityNeon * districtPower * (0.45 + 0.55 * nearCurb);

    // Subtle traffic lane specular glints even during blackout (headlights overhead)
    if (isStreet && outerFade > 0.1) {
      float overheadGlow = pow(max(0.0, 1.0 - abs(reflDir.y - 0.35) * 2.2), 3.0);
      vec3 trafficSheen = mix(vec3(0.35, 0.75, 1.0), vec3(1.0, 0.25, 0.35), step(0.5, fract(xz.x * 0.03 + uTime * 0.25)));
      neonRefl += trafficSheen * overheadGlow * 0.22;
    }

    vec3 color = albedo * (0.35 + 0.65 * districtPower) + neonRefl * fresnel * reflRoughnessBoost * 1.8;

    // Subtle neon curb accent right on sidewalk edge
    color += signColor * curbGlow * 0.32 * districtPower;

    // Exponential squared fog (FogExp2) matching Three.js FogExp2
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createWetAsphaltMaterial(): {
  material: THREE.ShaderMaterial;
  uniforms: WetAsphaltUniforms;
} {
  const uniforms: WetAsphaltUniforms = {
    uTime: { value: 0 },
    uRainIntensity: { value: 0.65 },
    uWind: { value: 0.25 },
    uFogColor: { value: new THREE.Color('#060916') },
    uFogDensity: { value: 0.0022 },
    uSkyHorizonColor: { value: new THREE.Color('#142048') },
    uAmbientNeonColor1: { value: new THREE.Color('#00f0ff') },
    uAmbientNeonColor2: { value: new THREE.Color('#ff2a85') },
    uSunGlowColor: { value: new THREE.Color('#ff6a2b') },
    uSunGlowStrength: { value: 0.0 },
    uDistrictPower: { value: new Array(16).fill(1.0) },
    uBlockStep: { value: CITY_CONFIG.blockStep },
    uStreetWidth: { value: CITY_CONFIG.streetWidth },
    uCitySpan: { value: CITY_CONFIG.citySpan },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthWrite: true,
    depthTest: true,
  });

  return { material, uniforms };
}
