import * as THREE from 'three';

export interface RainParticleUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uTime: THREE.IUniform<number>;
  uCameraPos: THREE.IUniform<THREE.Vector3>;
  uRainIntensity: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  uRainColor: THREE.IUniform<THREE.Color>;
  uBoxSize: THREE.IUniform<number>;
  uBoxHeight: THREE.IUniform<number>;
}

const rainVertexShader = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec2 aCorner;
  attribute float aSeed;

  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform float uRainIntensity;
  uniform float uWind;
  uniform float uBoxSize;
  uniform float uBoxHeight;

  varying vec2 vCorner;
  varying float vAlpha;
  varying float vDepthFade;

  void main() {
    vCorner = aCorner;

    // Cull excess particles based on rain intensity without rebuilding geometry
    if (aSeed > uRainIntensity * 1.02) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vAlpha = 0.0;
      vDepthFade = 0.0;
      return;
    }

    float fallSpeed = mix(42.0, 68.0, fract(aSeed * 17.31));
    float windSpeedX = uWind * 24.0;
    float windSpeedZ = uWind * 6.5;

    // Animate particle position and wrap inside a volume centered on camera
    vec3 halfBox = vec3(uBoxSize * 0.5, uBoxHeight * 0.5, uBoxSize * 0.5);
    vec3 worldCenter = aOffset + vec3(windSpeedX * uTime, -fallSpeed * uTime, windSpeedZ * uTime);
    vec3 rel = mod(worldCenter - uCameraPos + halfBox, vec3(uBoxSize, uBoxHeight, uBoxSize)) - halfBox;
    vec3 pos = uCameraPos + rel;

    // Prevent rain from clipping far below ground level
    if (pos.y < -1.0) {
      pos.y += uBoxHeight;
    }

    // Streak orientation aligned with velocity vector + billboarded sideways
    vec3 velocity = vec3(windSpeedX, -fallSpeed, windSpeedZ);
    vec3 streakDir = normalize(velocity);
    vec3 toCam = normalize(uCameraPos - pos);
    vec3 side = normalize(cross(streakDir, toCam));

    float streakLength = mix(1.3, 2.5, fract(aSeed * 7.91)) * (0.65 + 0.55 * uRainIntensity);
    float streakWidth = 0.028;

    vec3 vertexPos = pos + side * (aCorner.x * streakWidth) + streakDir * (aCorner.y * streakLength);

    float dist = length(pos - uCameraPos);
    vDepthFade = smoothstep(uBoxSize * 0.52, 12.0, dist) * smoothstep(1.8, 5.0, dist);
    vAlpha = (0.22 + 0.45 * fract(aSeed * 31.7)) * clamp(uRainIntensity * 1.15, 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * vec4(vertexPos, 1.0);
  }
`;

const rainFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uRainColor;

  varying vec2 vCorner;
  varying float vAlpha;
  varying float vDepthFade;

  void main() {
    if (vAlpha <= 0.001 || vDepthFade <= 0.001) {
      discard;
    }
    // Taper along width and length for crisp glowing streak
    float radial = 1.0 - abs(vCorner.x);
    float longitudinal = 1.0 - abs(vCorner.y);
    float shape = pow(clamp(radial, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.85, longitudinal);

    float alpha = shape * vAlpha * vDepthFade;
    if (alpha < 0.01) {
      discard;
    }

    gl_FragColor = vec4(uRainColor, alpha);
  }
`;

export function createRainParticleSystem(maxCount = 16000): {
  mesh: THREE.Mesh;
  uniforms: RainParticleUniforms;
  dispose: () => void;
} {
  const boxSize = 160;
  const boxHeight = 110;

  const vertexCount = maxCount * 4;
  const indexCount = maxCount * 6;

  const positions = new Float32Array(vertexCount * 3);
  const offsets = new Float32Array(vertexCount * 3);
  const corners = new Float32Array(vertexCount * 2);
  const seeds = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  const cornerCoords = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  for (let i = 0; i < maxCount; i++) {
    const ox = (Math.random() - 0.5) * boxSize;
    const oy = (Math.random() - 0.5) * boxHeight;
    const oz = (Math.random() - 0.5) * boxSize;
    const seed = i / maxCount;

    const vBase = i * 4;
    for (let c = 0; c < 4; c++) {
      const vi = vBase + c;
      positions[vi * 3] = 0;
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = 0;

      offsets[vi * 3] = ox;
      offsets[vi * 3 + 1] = oy;
      offsets[vi * 3 + 2] = oz;

      corners[vi * 2] = cornerCoords[c][0];
      corners[vi * 2 + 1] = cornerCoords[c][1];

      seeds[vi] = seed;
    }

    const idxBase = i * 6;
    indices[idxBase] = vBase;
    indices[idxBase + 1] = vBase + 1;
    indices[idxBase + 2] = vBase + 2;
    indices[idxBase + 3] = vBase;
    indices[idxBase + 4] = vBase + 2;
    indices[idxBase + 5] = vBase + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10000);

  const uniforms: RainParticleUniforms = {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uRainIntensity: { value: 0.65 },
    uWind: { value: 0.25 },
    uRainColor: { value: new THREE.Color('#7cd8ff') },
    uBoxSize: { value: boxSize },
    uBoxHeight: { value: boxHeight },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: rainVertexShader,
    fragmentShader: rainFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  return {
    mesh,
    uniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ============================================================================
// Post-processing ShaderPass: Droplets and streaks on camera lens
// ============================================================================

export const LensRainPostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRainIntensity: { value: 0.65 },
    uWind: { value: 0.25 },
    uAspect: { value: 1.77 },
    uCockpitMode: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uRainIntensity;
    uniform float uWind;
    uniform float uAspect;
    uniform float uCockpitMode;

    varying vec2 vUv;

    vec3 hash31(float p) {
      vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xxy + p3.yzz) * p3.zyx);
    }

    float hash21(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Returns (normalOffset.x, normalOffset.y, trailMask)
    vec3 dropletLayer(vec2 uv, float time, float scale, float density) {
      vec2 aspectUv = vec2(uv.x * uAspect, uv.y) * scale;
      vec2 grid = vec2(1.0, 2.3);
      vec2 st = aspectUv * grid;
      vec2 id = floor(st);
      vec2 gv = fract(st) - 0.5;

      float n = hash21(id);
      if (n > density) {
        return vec3(0.0);
      }

      float t = time * (0.42 + n * 0.35) + n * 6.2831;
      float y = -sin(t + sin(t + sin(t) * 0.5)) * 0.42;
      float wiggle = (gv.y - y) * 2.2;
      float x = (n - 0.5) * 0.48 + sin(uv.y * 22.0 + n * 15.0) * 0.09 + uWind * 0.12 * (0.5 - gv.y);

      vec2 dropPos = (gv - vec2(x, y)) / grid;
      float dropDist = length(dropPos);
      float dropRadius = 0.042;
      float dropMask = smoothstep(dropRadius, dropRadius * 0.35, dropDist);

      // Trailing water streak above the moving drop
      vec2 trailPos = (gv - vec2(x, gv.y)) / grid;
      float trailWidth = 0.021 * smoothstep(-0.5, 0.5, gv.y);
      float trailDist = abs(trailPos.x);
      float trailVertical = smoothstep(-0.02, 0.04, gv.y - y) * smoothstep(0.5, y + 0.06, gv.y);
      float trailMask = smoothstep(trailWidth, trailWidth * 0.25, trailDist) * trailVertical;

      // Tiny micro-beads left behind along the trail
      float microStep = fract((gv.y + t * 0.08) * 6.0) - 0.5;
      float microDist = length(vec2(trailPos.x, microStep * 0.055));
      float microMask = smoothstep(0.015, 0.004, microDist) * trailVertical;

      vec2 offset = dropPos * dropMask * 3.8 + vec2(trailPos.x, 0.0) * (trailMask * 0.8 + microMask * 1.4);
      float mask = clamp(dropMask + trailMask * 0.35 + microMask * 0.65, 0.0, 1.0);
      return vec3(offset, mask);
    }

    // Static fine mist droplets on glass
    vec3 staticDroplets(vec2 uv, float time, float density) {
      vec2 st = vec2(uv.x * uAspect, uv.y) * 24.0;
      vec2 id = floor(st);
      vec2 gv = fract(st) - 0.5;
      float n = hash21(id + 71.3);
      if (n > density * 0.6) {
        return vec3(0.0);
      }
      vec2 shift = (hash31(n * 97.1).xy - 0.5) * 0.55;
      float d = length(gv - shift);
      float life = 0.5 + 0.5 * sin(time * 0.8 + n * 18.0);
      float r = mix(0.08, 0.17, n) * life;
      float m = smoothstep(r, r * 0.3, d);
      return vec3((gv - shift) * m * 1.4, m * 0.45);
    }

    void main() {
      vec2 uv = vUv;
      float intensity = clamp(uRainIntensity, 0.0, 1.0);

      // Increase droplet visibility slightly inside taxi cockpit windshield
      float lensScale = intensity * mix(0.65, 1.15, uCockpitMode);

      vec3 drop1 = vec3(0.0);
      vec3 drop2 = vec3(0.0);
      vec3 mist = vec3(0.0);

      if (lensScale > 0.02) {
        drop1 = dropletLayer(uv, uTime, 4.2, clamp(lensScale * 0.92, 0.0, 0.95));
        drop2 = dropletLayer(uv + vec2(0.37, 0.19), uTime * 1.28, 7.6, clamp(lensScale * 0.85, 0.0, 0.9));
        mist = staticDroplets(uv, uTime, lensScale);
      }

      vec2 refractOffset = (drop1.xy * 0.14 + drop2.xy * 0.09 + mist.xy * 0.05) * lensScale;
      vec2 refractedUv = clamp(uv - refractOffset, 0.001, 0.999);

      // Subtle edge chromatic aberration for cyberpunk lens feel
      vec2 centered = uv - 0.5;
      float edgeDist = dot(centered, centered);
      vec2 caOffset = centered * (0.0022 + 0.003 * edgeDist);

      float r = texture2D(tDiffuse, clamp(refractedUv + caOffset, 0.001, 0.999)).r;
      float g = texture2D(tDiffuse, refractedUv).g;
      float b = texture2D(tDiffuse, clamp(refractedUv - caOffset, 0.001, 0.999)).b;
      vec3 color = vec3(r, g, b);

      // Subtle rim highlight on water droplets
      float dropHighlight = clamp(drop1.z + drop2.z * 0.7 + mist.z * 0.4, 0.0, 1.0);
      color += vec3(0.10, 0.16, 0.22) * dropHighlight * lensScale * 0.38;

      // Subtle cinematic vignette
      float vignette = smoothstep(0.95, 0.22, length(centered));
      color *= mix(0.72, 1.0, vignette);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
