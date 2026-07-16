import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DADAKIDO_WORLD_POSITION } from './cosmicAnchors';
import { DADAKIDO_RENDER_ORDER } from './dadakidoOcclusion';
import {
  getDadakidoOccluders,
  MAX_DADAKIDO_OCCLUDERS
} from './dadakidoOcclusionRegistry';
import { hasCreaturePriorityHit } from './pointerPriority';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';

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
  new THREE.Color('#32945a'), // d — cosmic green
  new THREE.Color('#c65391'), // a — cosmic pink
  new THREE.Color('#3b68ae'), // d — cosmic blue
  new THREE.Color('#d1a22b'), // a — cosmic gold
  new THREE.Color('#d84b43'), // k — cosmic coral
  new THREE.Color('#3b68ae'), // i — cosmic blue
  new THREE.Color('#d1a22b'), // d — cosmic gold
  new THREE.Color('#32945a')  // o — cosmic green
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
        // A long, substantial right stem keeps the single-storey "a"
        // readable at distance instead of collapsing into an "o".
        roundedBarDensity(x, y, cx + 0.5, -0.38, 0.255, 0.86, 0.24),
        capsuleDensity(x, y, cx + 0.44, -0.82, cx + 0.7, -1.14, 0.235)
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

function colorForSample(sample: LogoSample) {
  return LETTER_COLORS[sample.glyph].clone();
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
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uBurstGlyph: { value: -1 },
      uBurstProgress: { value: 0 },
      uFrontOccluderCount: { value: 0 },
      uFrontOccluders: {
        value: Array.from(
          { length: MAX_DADAKIDO_OCCLUDERS },
          () => new THREE.Vector4(0, 0, 0.001, 0.001)
        )
      },
      uFrontOccluderStrengths: {
        value: new Float32Array(MAX_DADAKIDO_OCCLUDERS)
      }
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
      varying vec2 vScreenPosition;

      void main() {
        float letterPhase = aGlyph * 1.37 + aPhase * 0.18;
        float depthBreath = sin(uTime * (0.82 + aGlyph * 0.045) + letterPhase);
        float danceBeat = sin(uTime * (1.28 + aGlyph * 0.035) + aGlyph * 1.11);
        float hop = pow(max(danceBeat, 0.0), 2.0);
        float landing = pow(max(-danceBeat, 0.0), 5.0);
        float scaleBreath = 1.0 + depthBreath * (0.075 + aGlyph * 0.005);

        vec3 local = position - vec3(aLetterCenter, -0.08, 0.0);
        local.x *= scaleBreath * (1.0 + hop * 0.09 + landing * 0.08);
        local.y *= scaleBreath * (1.0 - hop * 0.055 - landing * 0.12);
        local.z *= 1.0 + hop * 0.06;

        float yaw = sin(uTime * (1.08 + aGlyph * 0.055) + letterPhase) * (0.42 + 0.035 * sin(aGlyph * 2.1));
        float pitch = cos(uTime * (0.92 + aGlyph * 0.05) + letterPhase * 1.28) * (0.22 + 0.018 * aGlyph);
        float roll = sin(uTime * (0.74 + aGlyph * 0.045) + letterPhase * 1.66) * 0.11
          + danceBeat * 0.055;

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
        // Each glyph dances on its own beat: hop, squash, sway and lean forward.
        p.x += lateralWave * 0.055
          + sin(uTime * (0.86 + aGlyph * 0.025) + aGlyph * 1.43) * 0.16;
        p.y += slowWave * 0.045
          + sin(uTime * 1.18 + letterPhase) * 0.14
          + hop * (0.38 + 0.035 * mod(aGlyph, 3.0))
          - landing * 0.075;
        p.z += depthBreath * (0.5 + 0.06 * sin(aGlyph * 1.9))
          + sin(uTime * 0.62 + aPhase + aAnchor.x * 0.52) * 0.09
          + cos(uTime * (0.91 + aGlyph * 0.02) + aGlyph * 0.77) * 0.18
          - hop * 0.14;
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
        vScreenPosition = gl_Position.xy / max(gl_Position.w, 0.0001);

        float pulse = 0.82 + 0.1 * sin(uTime * 0.72 + aPhase + aGlyph * 0.43);
        float depthScale = 1.0 + p.z * 0.18 + depthBreath * 0.13;
        gl_PointSize = aSize * depthScale * pulse * (1.0 + burst * 1.8) * 960.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * pulse * smoothstep(0.0, 1.0, uReveal) * (0.82 + depthScale * 0.12) * (1.0 + burst * 0.9);
        vDepth = -mvPosition.z;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;
      varying vec2 vScreenPosition;
      uniform float uFrontOccluderCount;
      uniform vec4 uFrontOccluders[${MAX_DADAKIDO_OCCLUDERS}];
      uniform float uFrontOccluderStrengths[${MAX_DADAKIDO_OCCLUDERS}];

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = smoothstep(0.2, 0.0, d) * 0.78;
        float halo = smoothstep(0.48, 0.02, d) * 0.34;
        float outer = smoothstep(0.64, 0.06, d) * 0.11;
        float alpha = (core + halo + outer) * vAlpha;
        alpha *= 1.0 - smoothstep(16.0, 28.0, vDepth) * 0.18;
        float foregroundMask = 0.0;
        for (int i = 0; i < ${MAX_DADAKIDO_OCCLUDERS}; i += 1) {
          if (float(i) >= uFrontOccluderCount) break;
          vec4 occluder = uFrontOccluders[i];
          vec2 relative = (vScreenPosition - occluder.xy) / max(occluder.zw, vec2(0.001));
          float softMask = 1.0 - smoothstep(0.38, 1.12, dot(relative, relative));
          foregroundMask = max(
            foregroundMask,
            softMask * uFrontOccluderStrengths[i]
          );
        }
        alpha *= 1.0 - foregroundMask * 0.98;
        if (alpha < 0.002) discard;
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
      color: colorForSample(sample),
      size: THREE.MathUtils.lerp(0.018, 0.048, random() ** 0.62),
      alpha: THREE.MathUtils.lerp(0.42, 0.76, sample.density) * THREE.MathUtils.lerp(0.84, 0.98, random()),
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
      color: colorForSample(sample).lerp(new THREE.Color('#ffffff'), random() * 0.022),
      size: THREE.MathUtils.lerp(0.022, 0.078, random() ** 1.2),
      alpha: THREE.MathUtils.lerp(0.028, 0.085, random()),
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
      color: colorForSample(sample),
      size: THREE.MathUtils.lerp(0.017, 0.048, random() ** 0.8),
      alpha: THREE.MathUtils.lerp(0.026, 0.075, random()),
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
  const lastAutoPulseRef = useRef(0);
  const occluderCenterRef = useRef(new THREE.Vector3());
  const occluderRightPointRef = useRef(new THREE.Vector3());
  const occluderUpPointRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const [layer, setLayer] = useState<DadakidoNebulaLayer | null>(null);
  const nebulaPulse = useAutoCosmicInteractionStore((state) => state.nebulaPulse);
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);
  const scale = Math.max(0.3, Math.min(0.4, aspect / 1.32));
  const xOffset = 0;
  const yOffset = 0;

  // Defer heavy geometry (70K particles) to avoid blocking first paint
  useEffect(() => {
    const id = requestIdleCallback(
      () => setLayer(createDadakidoNebula()),
      { timeout: 3000 }
    );
    return () => cancelIdleCallback(id);
  }, []);

  useEffect(() => {
    return () => {
      layer?.geometry.dispose();
      layer?.material.dispose();
    };
  }, [layer]);

  useEffect(() => {
    if (nebulaPulse.id === 0 || nebulaPulse.id === lastAutoPulseRef.current) return;
    lastAutoPulseRef.current = nebulaPulse.id;
    burstRef.current = {
      glyph: THREE.MathUtils.euclideanModulo(nebulaPulse.glyph, GLYPHS.length),
      startedAt: performance.now() * 0.001
    };
  }, [nebulaPulse]);

  useFrame(({ clock, camera }) => {
    if (!layer) return;
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
    cameraRightRef.current.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraUpRef.current.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const projectedOccluders = layer.material.uniforms.uFrontOccluders.value as THREE.Vector4[];
    const projectedOccluderStrengths = layer.material.uniforms.uFrontOccluderStrengths.value as Float32Array;
    let occluderCount = 0;
    for (const occluder of getDadakidoOccluders()) {
      if (occluderCount >= MAX_DADAKIDO_OCCLUDERS) break;
      occluderCenterRef.current.copy(occluder.position).project(camera);
      if (occluderCenterRef.current.z < -1 || occluderCenterRef.current.z > 1) continue;
      occluderRightPointRef.current.copy(occluder.position)
        .addScaledVector(cameraRightRef.current, occluder.radiusX)
        .project(camera);
      occluderUpPointRef.current.copy(occluder.position)
        .addScaledVector(cameraUpRef.current, occluder.radiusY)
        .project(camera);
      const radiusX = Math.abs(occluderRightPointRef.current.x - occluderCenterRef.current.x);
      const radiusY = Math.abs(occluderUpPointRef.current.y - occluderCenterRef.current.y);
      if (radiusX < 0.001 || radiusY < 0.001) continue;
      projectedOccluders[occluderCount].set(
        occluderCenterRef.current.x,
        occluderCenterRef.current.y,
        radiusX,
        radiusY
      );
      projectedOccluderStrengths[occluderCount] = occluder.strength;
      occluderCount += 1;
    }
    projectedOccluderStrengths.fill(0, occluderCount);
    layer.material.uniforms.uFrontOccluderCount.value = occluderCount;

    if (groupRef.current) {
      groupRef.current.rotation.set(0, 0, 0);
    }
  });

  if (!layer) return null;

  return (
    <group
      ref={groupRef}
      position={[
        DADAKIDO_WORLD_POSITION[0] + xOffset,
        DADAKIDO_WORLD_POSITION[1] + yOffset,
        DADAKIDO_WORLD_POSITION[2]
      ]}
      scale={[scale, scale, scale]}
      renderOrder={DADAKIDO_RENDER_ORDER}
    >
      <points
        geometry={layer.geometry}
        material={layer.material}
        renderOrder={DADAKIDO_RENDER_ORDER}
        frustumCulled={false}
        raycast={() => null}
      />
      {GLYPH_CENTERS.map((center, glyph) => (
        <mesh
          key={`${GLYPHS[glyph]}-${glyph}`}
          position={[center, -0.08, 0.06]}
          onPointerDown={(event) => {
            if (hasCreaturePriorityHit(event)) return;
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
