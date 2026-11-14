import * as THREE from 'three';

export interface ProceduralTexturePack {
  windowAtlas: THREE.CanvasTexture;
  hologramTextures: THREE.CanvasTexture[];
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

/**
 * Generates a 1024x1024 skyscraper facade atlas divided into 4 vertical architectural styles:
 * - Quadrant 0 (top-left): Corporate office grid with warm amber & cyan strips
 * - Quadrant 1 (top-right): High-density residential capsules with magenta/blue windows
 * - Quadrant 2 (bottom-left): Data-center monolith with vertical LED bus bars
 * - Quadrant 3 (bottom-right): Industrial megastructure with wide illuminated floors
 */
export function createWindowAtlasTexture(): THREE.CanvasTexture {
  const size = 1024;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D context for window atlas');
  }

  const rand = seededRandom(42077);

  // Dark metallic concrete background
  ctx.fillStyle = '#070a12';
  ctx.fillRect(0, 0, size, size);

  const drawPanel = (ox: number, oy: number, style: number) => {
    // Structural cladding panels
    ctx.fillStyle = '#0b101b';
    ctx.fillRect(ox, oy, half, half);

    // Subtle vertical mullions / ribs
    ctx.fillStyle = '#121928';
    for (let x = 0; x < half; x += 32) {
      ctx.fillRect(ox + x, oy, 4, half);
    }

    if (style === 0) {
      // Corporate horizontal office bands
      const rows = 32;
      const cols = 16;
      const cellW = half / cols;
      const cellH = half / rows;

      for (let r = 0; r < rows; r++) {
        const floorLit = rand() > 0.28;
        const floorTone = rand();
        for (let c = 0; c < cols; c++) {
          const wx = ox + c * cellW + 4;
          const wy = oy + r * cellH + 4;
          const ww = cellW - 8;
          const wh = cellH - 7;

          if (floorLit && rand() > 0.24) {
            const bright = 0.55 + rand() * 0.45;
            if (floorTone > 0.72) {
              ctx.fillStyle = `rgba(0, 240, 255, ${bright})`;
            } else if (floorTone > 0.32) {
              ctx.fillStyle = `rgba(255, 195, 110, ${bright})`;
            } else {
              ctx.fillStyle = `rgba(170, 225, 255, ${bright})`;
            }
            ctx.fillRect(wx, wy, ww, wh);
          } else {
            ctx.fillStyle = '#0e1522';
            ctx.fillRect(wx, wy, ww, wh);
          }
        }
        // Occasional horizontal neon floor accent
        if (r % 8 === 0) {
          ctx.fillStyle = r % 16 === 0 ? 'rgba(0, 240, 255, 0.85)' : 'rgba(255, 42, 133, 0.7)';
          ctx.fillRect(ox, oy + r * cellH, half, 2);
        }
      }
    } else if (style === 1) {
      // Cyberpunk capsule micro-apartments
      const rows = 40;
      const cols = 20;
      const cellW = half / cols;
      const cellH = half / rows;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = ox + c * cellW + 3;
          const wy = oy + r * cellH + 3;
          const ww = cellW - 6;
          const wh = cellH - 5;

          const p = rand();
          if (p > 0.54) {
            const b = 0.45 + rand() * 0.55;
            if (p > 0.88) {
              ctx.fillStyle = `rgba(255, 42, 133, ${b})`;
            } else if (p > 0.72) {
              ctx.fillStyle = `rgba(0, 225, 255, ${b})`;
            } else {
              ctx.fillStyle = `rgba(255, 162, 70, ${b})`;
            }
            ctx.fillRect(wx, wy, ww, wh);
          } else {
            ctx.fillStyle = '#0c111d';
            ctx.fillRect(wx, wy, ww, wh);
          }
        }
      }
    } else if (style === 2) {
      // Data-center server monolith with vertical glowing buses
      const cols = 16;
      const cellW = half / cols;
      for (let c = 0; c < cols; c++) {
        const isBus = c % 4 === 1;
        if (isBus) {
          ctx.fillStyle = c % 8 === 1 ? 'rgba(0, 245, 255, 0.9)' : 'rgba(57, 255, 156, 0.85)';
          ctx.fillRect(ox + c * cellW + 10, oy + 8, 5, half - 16);
        } else {
          for (let y = 0; y < half; y += 10) {
            if (rand() > 0.62) {
              ctx.fillStyle = rand() > 0.3 ? 'rgba(70, 175, 255, 0.78)' : 'rgba(255, 70, 140, 0.82)';
              ctx.fillRect(ox + c * cellW + 6, oy + y + 2, cellW - 12, 4);
            }
          }
        }
      }
    } else {
      // Industrial megablock with wide glowing atrium bays
      const rows = 20;
      const cols = 8;
      const cellW = half / cols;
      const cellH = half / rows;

      for (let r = 0; r < rows; r++) {
        const isAtrium = r % 5 === 2;
        for (let c = 0; c < cols; c++) {
          const wx = ox + c * cellW + 5;
          const wy = oy + r * cellH + 5;
          const ww = cellW - 10;
          const wh = cellH - 9;
          if (isAtrium || rand() > 0.58) {
            ctx.fillStyle = isAtrium
              ? 'rgba(0, 235, 255, 0.85)'
              : rand() > 0.45
                ? 'rgba(255, 145, 50, 0.8)'
                : 'rgba(130, 195, 255, 0.7)';
            ctx.fillRect(wx, wy, ww, wh);
          } else {
            ctx.fillStyle = '#0d1320';
            ctx.fillRect(wx, wy, ww, wh);
          }
        }
      }
    }
  };

  drawPanel(0, 0, 0);
  drawPanel(half, 0, 1);
  drawPanel(0, half, 2);
  drawPanel(half, half, 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates 6 high-contrast cyberpunk holographic billboard textures.
 */
export function createHologramTextures(): THREE.CanvasTexture[] {
  const designs = [
    {
      title: 'KAIJU // CYBERNETICS',
      jp: 'カイジュウ 神経工学',
      sub: 'NEURAL LINK V9.4',
      primary: '#00f0ff',
      secondary: '#ff2a85',
      shape: 'eye',
    },
    {
      title: 'ORBITAL TRANSIT',
      jp: '軌道シャトル',
      sub: 'OFF-WORLD COLONIES',
      primary: '#ff2a85',
      secondary: '#ffae00',
      shape: 'rings',
    },
    {
      title: 'SYNTH // RAMEN 24H',
      jp: '合成ラーメン 深夜営業',
      sub: 'SECTOR 07 NOODLE BAR',
      primary: '#ffae00',
      secondary: '#ff334b',
      shape: 'bowl',
    },
    {
      title: 'NEXUS BIO-CORP',
      jp: 'ネクサス生体工業',
      sub: 'CHROME ENHANCEMENTS',
      primary: '#39ff9c',
      secondary: '#00f0ff',
      shape: 'helix',
    },
    {
      title: 'ZERO-G SPINNER',
      jp: '重力制御システム',
      sub: 'TAXI DISPATCH // AI',
      primary: '#7b5cff',
      secondary: '#00f0ff',
      shape: 'chevron',
    },
    {
      title: 'NIGHTWAVE AUDIO',
      jp: 'ナイトウェーブ 放送局',
      sub: 'SYNTHETIC DREAMS FM',
      primary: '#ff2a85',
      secondary: '#00f0ff',
      shape: 'waves',
    },
  ];

  return designs.map((d) => {
    const w = 512;
    const h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not acquire 2D context for hologram texture');
    }

    ctx.clearRect(0, 0, w, h);

    // Translucent dark tinted backdrop
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(5, 14, 28, 0.72)');
    grad.addColorStop(1, 'rgba(18, 6, 26, 0.58)');
    ctx.fillStyle = grad;
    ctx.fillRect(10, 10, w - 20, h - 20);

    // Outer double neon frame with corner brackets
    ctx.strokeStyle = d.primary;
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    ctx.strokeStyle = d.secondary;
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, w - 44, h - 44);

    // Decorative graphic emblem on the left
    const cx = 104;
    const cy = h / 2;
    ctx.save();
    ctx.strokeStyle = d.primary;
    ctx.fillStyle = d.secondary;
    ctx.lineWidth = 4;

    if (d.shape === 'eye') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 52, 28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.stroke();
    } else if (d.shape === 'rings') {
      for (let r = 18; r <= 48; r += 15) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - 56, cy + 20);
      ctx.lineTo(cx + 56, cy - 20);
      ctx.strokeStyle = d.secondary;
      ctx.stroke();
    } else if (d.shape === 'bowl') {
      ctx.beginPath();
      ctx.arc(cx, cy + 6, 40, 0, Math.PI);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = d.secondary;
      for (let i = -20; i <= 20; i += 20) {
        ctx.beginPath();
        ctx.moveTo(cx + i, cy - 6);
        ctx.quadraticCurveTo(cx + i - 10, cy - 26, cx + i + 4, cy - 42);
        ctx.stroke();
      }
    } else if (d.shape === 'helix') {
      for (let x = -42; x <= 42; x += 8) {
        const yOff = Math.sin(x * 0.1) * 28;
        ctx.fillStyle = d.primary;
        ctx.fillRect(cx + x - 2, cy + yOff - 2, 5, 5);
        ctx.fillStyle = d.secondary;
        ctx.fillRect(cx + x - 2, cy - yOff - 2, 5, 5);
      }
    } else if (d.shape === 'chevron') {
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(cx - 34, cy - 20 + k * 22);
        ctx.lineTo(cx, cy - 40 + k * 22);
        ctx.lineTo(cx + 34, cy - 20 + k * 22);
        ctx.stroke();
      }
    } else {
      for (let i = -44; i <= 44; i += 11) {
        const barH = 18 + Math.abs(Math.sin(i * 0.25)) * 56;
        ctx.fillStyle = i % 22 === 0 ? d.primary : d.secondary;
        ctx.fillRect(cx + i - 3, cy - barH / 2, 6, barH);
      }
    }
    ctx.restore();

    // Text hierarchy
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 31px Consolas, monospace';
    ctx.fillText(d.title, 182, 82);

    ctx.fillStyle = d.primary;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(d.jp, 182, 134);

    ctx.fillStyle = d.secondary;
    ctx.font = 'bold 18px Consolas, monospace';
    ctx.fillText(d.sub, 182, 184);

    // Corner telemetry ticks
    ctx.fillStyle = d.primary;
    ctx.fillRect(32, 32, 36, 4);
    ctx.fillRect(w - 68, h - 36, 36, 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  });
}

export function createProceduralTexturePack(): ProceduralTexturePack {
  const windowAtlas = createWindowAtlasTexture();
  const hologramTextures = createHologramTextures();

  return {
    windowAtlas,
    hologramTextures,
    dispose: () => {
      windowAtlas.dispose();
      for (const tex of hologramTextures) {
        tex.dispose();
      }
    },
  };
}
