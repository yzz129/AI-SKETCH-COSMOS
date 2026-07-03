import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

type DadakidoNebulaLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

type LogoSample = {
  x: number;
  y: number;
  density: number;
  glyph: number;
};

const LETTER_SPREAD = 2.5;
const WORD_WIDTH = 30.0;
const TEXT_PARTICLES = 58_000;
const HALO_PARTICLES = 7_600;
const BRIDGE_PARTICLES = 5_000;

const LETTER_COLORS = [
  new THREE.Color('#64d9ff'),
  new THREE.Color('#d76bff'),
  new THREE.Color('#1e7ce6'),
  new THREE.Color('#ffe8b8'),
  new THREE.Color('#f2913c'),
  new THREE.Color('#64d9ff'),
  new THREE.Color('#ffe8b8'),
  new THREE.Color('#d76bff')
];

const FLOW_PALETTE = [
  new THREE.Color('#64d9ff'),
  new THREE.Color('#1e7ce6'),
  new THREE.Color('#7b4dff'),
  new THREE.Color('#d76bff'),
  new THREE.Color('#f3a6ff'),
  new THREE.Color('#ffe8b8')
];

const GLYPH_CENTERS = [-5.25, -3.75, -2.25, -0.75, 0.9, 2.2, 3.55, 5.05].map(c => c * LETTER_SPREAD);
const GLYPHS = ['d', 'a', 'd', 'a', 'k', 'i', 'd', 'o'] as const;

function seededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function signedRoundedBox(px: number, py: number, cx: number, cy: number, hx: number, hy: number, radius: number) {
  const qx = Math.abs(px - cx) - hx + radius;
  const qy = Math.abs(py - cy) - hy + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c = THREE.MathUtils.clamp((wx * vx + wy * vy) / Math.max(vx * vx + vy * vy, 0.0001), 0, 1);
  return Math.hypot(px - (ax + vx * c), py - (ay + vy * c));
}

function densityFromDistance(distance: number, scale = 6.5) {
  return THREE.MathUtils.clamp(-distance * scale, 0, 1);
}

function loopDensity(x: number, y: number, cx: number) {
  const cy = -0.23;
  const outer = 1 - ((x - cx) / 0.78) ** 2 - ((y - cy) / 0.86) ** 2;
  const inner = ((x - cx) / 0.28) ** 2 + ((y - cy) / 0.31) ** 2 - 1;
  if (outer < 0 || inner < 0) return 0;
  return THREE.MathUtils.clamp(Math.min(outer * 3.2, inner * 2.8), 0.1, 1);
}

function roundedBarDensity(x: number, y: number, cx: number, cy: number, hx: number, hy: number, radius: number) {
  return densityFromDistance(signedRoundedBox(x, y, cx, cy, hx, hy, radius));
}

function capsuleDensity(x: number, y: number, ax: number, ay: number, bx: number, by: number, radius: number) {
  return densityFromDistance(segmentDistance(x, y, ax, ay, bx, by) - radius);
}

function logoDensity(x: number, y: number) {
  let bestDensity = 0;
  let bestGlyph = 0;

  for (let index = 0; index < GLYPHS.length; index += 1) {
    const glyph = GLYPHS[index];
    const cx = GLYPH_CENTERS[index];
    let density = 0;

    if (glyph === 'd') {
      density = Math.max(
        loopDensity(x, y, cx - 0.08),
        roundedBarDensity(x, y, cx + 0.5, 0.26, 0.24, 1.3, 0.24)
      );
    } else if (glyph === 'a') {
      density = Math.max(
        loopDensity(x, y, cx - 0.04),
        roundedBarDensity(x, y, cx + 0.49, -0.5, 0.2, 0.48, 0.2)
      );
    } else if (glyph === 'k') {
      density = Math.max(
        roundedBarDensity(x, y, cx - 0.34, 0, 0.23, 1.28, 0.23),
        capsuleDensity(x, y, cx - 0.08, -0.08, cx + 0.58, 0.78, 0.25),
        capsuleDensity(x, y, cx - 0.06, -0.08, cx + 0.68, -1.06, 0.25)
      );
    } else if (glyph === 'i') {
      density = Math.max(
        roundedBarDensity(x, y, cx, -0.44, 0.22, 0.82, 0.22),
        densityFromDistance(Math.hypot(x - cx, y - 1.16) - 0.31, 7.5)
      );
    } else {
      density = loopDensity(x, y, cx);
    }

    if (density > bestDensity) {
      bestDensity = density;
      bestGlyph = index;
    }
  }

  return { density: bestDensity, glyph: bestGlyph };
}

function sampleLogoPoint(random: () => number): LogoSample {
  for (let tries = 0; tries < 900; tries += 1) {
    const x = THREE.MathUtils.lerp(-WORD_WIDTH * 0.5, WORD_WIDTH * 0.5, random());
    const y = THREE.MathUtils.lerp(-1.42, 1.48, random());
    const hit = logoDensity(x, y);

    if (hit.density > 0 && random() < 0.26 + hit.density * 0.74) {
      return { x, y, density: hit.density, glyph: hit.glyph };
    }
  }

  return { x: 0, y: 0, density: 1, glyph: 0 };
}

function colorForSample(sample: LogoSample, random: () => number) {
  const color = LETTER_COLORS[sample.glyph].clone();
  const flow = FLOW_PALETTE[Math.min(FLOW_PALETTE.length - 1, Math.floor(((sample.x / WORD_WIDTH) + 0.5) * FLOW_PALETTE.length))];
  color.lerp(flow, 0.28);

  if (random() > 0.72) {
    color.lerp(new THREE.Color('#f7f3ff'), random() * 0.18);
  }

  return color;
}

function writeParticle({
  positions,
  colors,
  sizes,
  alphas,
  phases,
  anchors,
  glyphs,
  letterCenters,
  index,
  position,
  color,
  size,
  alpha,
  phase,
  glyph
}: {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  phases: Float32Array;
  anchors: Float32Array;
  glyphs: Float32Array;
  letterCenters: Float32Array;
  index: number;
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
  alpha: number;
  phase: number;
  glyph: number;
}) {
  const i3 = index * 3;
  positions[i3] = position.x;
  positions[i3 + 1] = position.y;
  positions[i3 + 2] = position.z;
  colors[i3] = color.r;
  colors[i3 + 1] = color.g;
  colors[i3 + 2] = color.b;
  sizes[index] = size;
  alphas[index] = alpha;
  phases[index] = phase;
  anchors[i3] = position.x;
  anchors[i3 + 1] = position.y;
  anchors[i3 + 2] = position.z;
  glyphs[index] = glyph;
  letterCenters[index] = GLYPH_CENTERS[glyph] ?? 0;
}

function makeDadakidoNebulaMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uBurstGlyph: { value: -1 },
      uBurstProgress: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uPixelRatio;
      uniform float uBurstGlyph;
      uniform float uBurstProgress;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aGlyph;
      attribute float aLetterCenter;
      attribute vec3 aAnchor;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        float letterPhase = aGlyph * 1.37 + aPhase * 0.18;
        float depthBreath = sin(uTime * (0.82 + aGlyph * 0.045) + letterPhase);
        float scaleBreath = 1.0 + depthBreath * (0.06 + aGlyph * 0.005);

        vec3 local = position - vec3(aLetterCenter, -0.08, 0.0);
        local.xy *= scaleBreath;

        float yaw = sin(uTime * (1.08 + aGlyph * 0.055) + letterPhase) * (0.38 + 0.04 * sin(aGlyph * 2.1));
        float pitch = cos(uTime * (0.92 + aGlyph * 0.05) + letterPhase * 1.28) * (0.2 + 0.024 * aGlyph);
        float roll = sin(uTime * (0.68 + aGlyph * 0.04) + letterPhase * 1.66) * 0.075;

        float cy = cos(yaw);
        float sy = sin(yaw);
        local.xz = mat2(cy, -sy, sy, cy) * local.xz;

        float cx = cos(pitch);
        float sx = sin(pitch);
        local.yz = mat2(cx, -sx, sx, cx) * local.yz;

        float cz = cos(roll);
        float sz = sin(roll);
        local.xy = mat2(cz, -sz, sz, cz) * local.xy;
        vec3 p = local + vec3(aLetterCenter, -0.08, 0.0);
        float lateralWave = sin(uTime * 0.7 + aPhase + aAnchor.x * 1.12);
        float slowWave = cos(uTime * 0.48 + aPhase * 0.7 + aAnchor.y * 1.8);
        // per-letter vertical bounce — each letter bounces at a different rhythm
        p.x += lateralWave * 0.045;
        p.y += slowWave * 0.038 + sin(uTime * 1.18 + letterPhase) * 0.12;
        p.z += depthBreath * (0.46 + 0.06 * sin(aGlyph * 1.9)) + sin(uTime * 0.62 + aPhase + aAnchor.x * 0.52) * 0.08;
        float glyphHit = 1.0 - step(0.5, abs(aGlyph - uBurstGlyph));
        float burst = glyphHit * uBurstProgress;
        vec3 burstCenter = vec3(aLetterCenter, -0.08, 0.0);
        vec3 burstDirection = normalize(aAnchor - burstCenter + vec3(
          sin(aPhase * 2.13 + aGlyph),
          cos(aPhase * 1.71 + aGlyph * 0.7),
          sin(aPhase * 1.37 + 2.0)
        ) * 0.18 + vec3(0.001));
        float burstNoise = 0.72 + 0.42 * sin(aPhase * 3.4 + uTime * 0.6);
        p += burstDirection * burst * (1.3 + burstNoise * 0.92);
        p += vec3(
          sin(aPhase + uTime * 6.0),
          cos(aPhase * 0.9 + uTime * 5.2),
          sin(aPhase * 1.3 + uTime * 4.7)
        ) * burst * 0.18;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float pulse = 0.82 + 0.1 * sin(uTime * 0.72 + aPhase + aGlyph * 0.43);
        float depthScale = 1.0 + p.z * 0.18 + depthBreath * 0.13;
        gl_PointSize = aSize * depthScale * pulse * (1.0 + burst * 1.8) * 790.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * pulse * smoothstep(0.0, 1.0, uReveal) * (0.56 + depthScale * 0.08) * (1.0 + burst * 0.9);
        vDepth = -mvPosition.z;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = smoothstep(0.2, 0.0, d) * 0.78;
        float halo = smoothstep(0.48, 0.02, d) * 0.34;
        float outer = smoothstep(0.64, 0.06, d) * 0.11;
        float alpha = (core + halo + outer) * vAlpha;
        alpha *= 1.0 - smoothstep(16.0, 28.0, vDepth) * 0.18;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
}

function createDadakidoNebula(): DadakidoNebulaLayer {
  const random = seededRandom(20260702);
  const count = TEXT_PARTICLES + HALO_PARTICLES + BRIDGE_PARTICLES;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const anchors = new Float32Array(count * 3);
  const glyphs = new Float32Array(count);
  const letterCenters = new Float32Array(count);

  for (let i = 0; i < TEXT_PARTICLES; i += 1) {
    const sample = sampleLogoPoint(random);
    const depth = THREE.MathUtils.lerp(0.34, 1.26, sample.density);
    const position = new THREE.Vector3(
      sample.x + THREE.MathUtils.randFloatSpread(0.032),
      sample.y + THREE.MathUtils.randFloatSpread(0.032),
      THREE.MathUtils.randFloatSpread(depth)
    );

    writeParticle({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      anchors,
      glyphs,
      letterCenters,
      index: i,
      position,
      color: colorForSample(sample, random),
      size: THREE.MathUtils.lerp(0.011, 0.034, random() ** 0.62),
      alpha: THREE.MathUtils.lerp(0.18, 0.52, sample.density) * THREE.MathUtils.lerp(0.72, 0.96, random()),
      phase: random() * Math.PI * 2,
      glyph: sample.glyph
    });
  }

  for (let i = 0; i < HALO_PARTICLES; i += 1) {
    const sample = sampleLogoPoint(random);
    const index = TEXT_PARTICLES + i;
    const outward = new THREE.Vector2(sample.x / (WORD_WIDTH * 0.5), sample.y / 1.55);
    const spread = THREE.MathUtils.lerp(0.06, 0.34, random() ** 0.6);
    if (outward.lengthSq() > 0.001) outward.normalize();
    const position = new THREE.Vector3(
      sample.x + outward.x * spread + THREE.MathUtils.randFloatSpread(0.2),
      sample.y + outward.y * spread + THREE.MathUtils.randFloatSpread(0.16),
      THREE.MathUtils.randFloatSpread(1.48)
    );

    writeParticle({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      anchors,
      glyphs,
      letterCenters,
      index,
      position,
      color: colorForSample(sample, random).lerp(new THREE.Color('#f7f3ff'), random() * 0.08),
      size: THREE.MathUtils.lerp(0.018, 0.072, random() ** 1.2),
      alpha: THREE.MathUtils.lerp(0.014, 0.062, random()),
      phase: random() * Math.PI * 2,
      glyph: sample.glyph
    });
  }

  for (let i = 0; i < BRIDGE_PARTICLES; i += 1) {
    const index = TEXT_PARTICLES + HALO_PARTICLES + i;
    const t = random();
    const x = THREE.MathUtils.lerp(-WORD_WIDTH * 0.49, WORD_WIDTH * 0.49, t);
    const ribbonY = -0.18 + Math.sin(t * Math.PI * 2.0) * 0.08 + Math.sin(t * Math.PI * 7.0) * 0.03;
    const vertical = THREE.MathUtils.randFloatSpread(0.28) * (0.55 + Math.sin(t * Math.PI) * 0.45);
    const position = new THREE.Vector3(
      x + THREE.MathUtils.randFloatSpread(0.03),
      ribbonY + vertical,
      THREE.MathUtils.randFloatSpread(1.02)
    );
    const sample = { x, y: ribbonY, density: 0.55, glyph: Math.min(7, Math.floor(t * 8)) };

    writeParticle({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      anchors,
      glyphs,
      letterCenters,
      index,
      position,
      color: colorForSample(sample, random).lerp(new THREE.Color('#64d9ff'), 0.12),
      size: THREE.MathUtils.lerp(0.012, 0.04, random() ** 0.8),
      alpha: THREE.MathUtils.lerp(0.016, 0.066, random()),
      phase: random() * Math.PI * 2,
      glyph: sample.glyph
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aAnchor', new THREE.BufferAttribute(anchors, 3));
  geometry.setAttribute('aGlyph', new THREE.BufferAttribute(glyphs, 1));
  geometry.setAttribute('aLetterCenter', new THREE.BufferAttribute(letterCenters, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: makeDadakidoNebulaMaterial() };
}

function DadakidoNebula({ reveal }: { reveal: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const burstRef = useRef({ glyph: -1, startedAt: -100 });
  const layer = useMemo(() => createDadakidoNebula(), []);
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);
  const scale = Math.max(0.3, Math.min(0.4, aspect / 1.32));
  const xOffset = 0;
  const yOffset = 0;

  useEffect(() => {
    return () => {
      layer.geometry.dispose();
      layer.material.dispose();
    };
  }, [layer]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const burstAge = performance.now() * 0.001 - burstRef.current.startedAt;
    const burstProgress = burstAge < 1.35
      ? Math.sin(THREE.MathUtils.clamp(burstAge / 1.35, 0, 1) * Math.PI)
      : 0;
    layer.material.uniforms.uTime.value = time;
    layer.material.uniforms.uBurstGlyph.value = burstProgress > 0.001 ? burstRef.current.glyph : -1;
    layer.material.uniforms.uBurstProgress.value = burstProgress;
    layer.material.uniforms.uReveal.value = THREE.MathUtils.lerp(
      layer.material.uniforms.uReveal.value as number,
      reveal,
      0.045
    );

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(time * 0.18) * 0.24;
      groupRef.current.rotation.x = Math.sin(time * 0.09) * 0.08;
      groupRef.current.rotation.z = Math.sin(time * 0.045) * 0.018;
    }
  });

  return (
    <group ref={groupRef} position={[xOffset, yOffset, -8.85]} scale={[scale, scale, scale]} renderOrder={4}>
      <points geometry={layer.geometry} material={layer.material} renderOrder={4} frustumCulled={false} raycast={() => null} />
      {GLYPH_CENTERS.map((center, glyph) => (
        <mesh
          key={`${GLYPHS[glyph]}-${glyph}`}
          position={[center, -0.08, 0.06]}
          onPointerDown={(event) => {
            event.stopPropagation();
            burstRef.current = { glyph, startedAt: performance.now() * 0.001 };
          }}
        >
          <boxGeometry args={[1.45, 3.25, 1.9]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

export function NebulaRibbons() {
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setReveal(1));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return <DadakidoNebula reveal={reveal} />;
}
