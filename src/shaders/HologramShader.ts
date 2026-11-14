import * as THREE from 'three';

export interface HologramUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uTime: THREE.IUniform<number>;
  uMap: THREE.IUniform<THREE.Texture>;
  uDistrictPower: THREE.IUniform<number[]>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
  uGlitchIntensity: THREE.IUniform<number>;
}

const vertexShader = /* glsl */ `
  attribute float aDistrictIndex;
  attribute vec3 aTintColor;
  attribute float aPhase;

  uniform float uTime;
  uniform float uDistrictPower[16];
  uniform float uGlitchIntensity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying vec3 vTintColor;
  varying float vPower;
  varying float vPhase;

  float getDistrictPower(int idx) {
    float p = 1.0;
    for (int i = 0; i < 16; i++) {
      if (i == idx) {
        p = uDistrictPower[i];
      }
    }
    return p;
  }

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    vUv = uv;
    vTintColor = aTintColor;
    vPhase = aPhase;

    float power = getDistrictPower(int(aDistrictIndex + 0.5));
    vPower = power;

    vec3 pos = position;

    // Periodic glitch pulse + destabilization when district power drops
    float timeBucket = floor(uTime * 11.0);
    float glitchTrigger = step(0.90, hash11(timeBucket + aPhase * 13.7));
    float powerFailBoost = (power > 0.05 && power < 0.95) ? 2.4 : 0.0;
    float wave = sin(pos.y * 5.0 + uTime * 36.0 + aPhase * 6.2831);
    pos.x += wave * (glitchTrigger * 0.06 * uGlitchIntensity + powerFailBoost * 0.045);

    #ifdef USE_INSTANCING
      vec4 instPos = instanceMatrix * vec4(pos, 1.0);
      vec3 instNormal = normalize(mat3(instanceMatrix) * normal);
    #else
      vec4 instPos = vec4(pos, 1.0);
      vec3 instNormal = normal;
    #endif

    vec4 worldPosition = modelMatrix * instPos;
    vWorldPos = worldPosition.xyz;

    vec4 mvPosition = viewMatrix * worldPosition;
    vViewPos = -mvPosition.xyz;
    vNormalView = normalize(normalMatrix * instNormal);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uGlitchIntensity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying vec3 vTintColor;
  varying float vPower;
  varying float vPhase;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    if (vPower <= 0.015) {
      discard;
    }

    vec2 uv = vUv;

    // CRT collapse effect during blackout transition
    float collapse = smoothstep(0.02, 0.55, vPower);
    float centeredY = abs(uv.y - 0.5);
    float halfHeight = mix(0.015, 0.5, collapse);
    if (centeredY > halfHeight) {
      discard;
    }

    // Horizontal slice glitch in UV space
    float slice = floor(uv.y * 28.0);
    float burst = step(0.87, hash12(vec2(floor(uTime * 9.0 + vPhase * 10.0), slice)));
    float jitter = (hash12(vec2(slice, floor(uTime * 22.0))) - 0.5) * 0.08 * burst * uGlitchIntensity;
    if (vPower < 0.9) {
      jitter += (hash12(vec2(slice, uTime * 35.0)) - 0.5) * 0.18;
    }

    vec2 sampleUv = vec2(fract(uv.x + jitter), uv.y);

    // RGB chromatic split on glitch
    float split = 0.004 + 0.015 * burst * uGlitchIntensity;
    float r = texture2D(uMap, vec2(fract(sampleUv.x + split), sampleUv.y)).r;
    float g = texture2D(uMap, sampleUv).g;
    float b = texture2D(uMap, vec2(fract(sampleUv.x - split), sampleUv.y)).b;
    float a = texture2D(uMap, sampleUv).a;

    vec3 texColor = vec3(r, g, b);

    // Scanlines moving upward
    float scanline = 0.72 + 0.28 * sin(uv.y * 210.0 - uTime * 9.0 + vPhase * 6.28);
    float wideBand = 0.86 + 0.14 * sin(uv.y * 14.0 + uTime * 2.4 + vPhase * 3.14);

    // Fresnel edge glow
    vec3 viewDir = normalize(vViewPos);
    float ndotv = abs(dot(normalize(vNormalView), viewDir));
    float fresnel = pow(1.0 - clamp(ndotv, 0.0, 1.0), 2.2);

    // Crisp holographic border frame glow
    float edgeX = smoothstep(0.0, 0.045, uv.x) * smoothstep(1.0, 0.955, uv.x);
    float edgeY = smoothstep(0.0, 0.045, uv.y) * smoothstep(1.0, 0.955, uv.y);
    float border = 1.0 - edgeX * edgeY;

    vec3 tinted = mix(vTintColor, texColor * vTintColor * 1.65, 0.78);
    vec3 color = tinted * 1.45 * scanline * wideBand;
    color += vTintColor * (fresnel * 1.15 + border * 0.65);

    // Bright flash along CRT collapse line when shutting down
    if (vPower < 0.7) {
      float flashLine = smoothstep(0.06, 0.0, abs(centeredY - halfHeight * 0.1));
      color += vec3(0.92, 0.98, 1.0) * flashLine * 1.6;
    }

    float alpha = clamp((a * 0.88 + fresnel * 0.4 + border * 0.35) * scanline * vPower, 0.0, 0.96);

    // Apply FogExp2 fade
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    alpha *= (1.0 - clamp(fogFactor * 0.9, 0.0, 1.0));
    color = mix(color, uFogColor * 0.2, clamp(fogFactor, 0.0, 1.0));

    if (alpha < 0.02) {
      discard;
    }

    gl_FragColor = vec4(color * 1.38, alpha);
  }
`;

export function createHologramMaterial(
  texture: THREE.Texture,
  sharedDistrictPower: number[]
): {
  material: THREE.ShaderMaterial;
  uniforms: HologramUniforms;
} {
  const uniforms: HologramUniforms = {
    uTime: { value: 0 },
    uMap: { value: texture },
    uDistrictPower: { value: sharedDistrictPower },
    uFogColor: { value: new THREE.Color('#060916') },
    uFogDensity: { value: 0.0022 },
    uGlitchIntensity: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  return { material, uniforms };
}
