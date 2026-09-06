import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Font, FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';

const GLYPHS = ['哒', '哒', '造', '物'] as const;
const GLYPH_COLORS = ['#72dd22', '#f45b9d', '#17a9ef', '#ffc514'] as const;
const GLYPH_SPACING = 4.05;
const BURST_PARTICLES_PER_GLYPH = 520;
const BURST_DURATION_SECONDS = 1.35;
const SOLID_OPACITY = 0.14;

const BURST_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aDirection;
  attribute float aSeed;
  uniform float uBurst;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;

  void main() {
    float arc = sin(uBurst * 3.14159265);
    vec3 drift = aDirection * uBurst * (3.4 + aSeed * 2.8);
    drift.x += sin(uTime * 2.1 + aSeed * 17.0) * arc * 0.24;
    drift.y += cos(uTime * 1.8 + aSeed * 13.0) * arc * 0.2;
    vec4 mvPosition = modelViewMatrix * vec4(position + drift, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (4.2 + aSeed * 3.6) * uPixelRatio
      * (1.0 + arc * 0.75)
      * clamp(7.0 / max(1.0, -mvPosition.z), 0.55, 2.1);
    vAlpha = 0.48 + aSeed * 0.52;
  }
`;

const BURST_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered);
    if (radius > 0.5) discard;
    float glow = smoothstep(0.5, 0.04, radius);
    gl_FragColor = vec4(uColor, glow * vAlpha * uOpacity);
  }
`;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createBurstGeometry(source: THREE.BufferGeometry, glyphIndex: number) {
  const sourcePositions = source.getAttribute('position');
  const triangleCount = Math.max(1, Math.floor(sourcePositions.count / 3));
  const positions = new Float32Array(BURST_PARTICLES_PER_GLYPH * 3);
  const directions = new Float32Array(BURST_PARTICLES_PER_GLYPH * 3);
  const seeds = new Float32Array(BURST_PARTICLES_PER_GLYPH);
  const random = seededRandom(7109 + glyphIndex * 997);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let index = 0; index < BURST_PARTICLES_PER_GLYPH; index += 1) {
    const triangle = Math.floor(random() * triangleCount) * 3;
    a.fromBufferAttribute(sourcePositions, Math.min(triangle, sourcePositions.count - 1));
    b.fromBufferAttribute(sourcePositions, Math.min(triangle + 1, sourcePositions.count - 1));
    c.fromBufferAttribute(sourcePositions, Math.min(triangle + 2, sourcePositions.count - 1));
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    point.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
    direction.set(
      point.x * 0.72 + (random() - 0.5) * 0.9,
      point.y * 0.9 + (random() - 0.5) * 0.75,
      (random() - 0.5) * 1.8
    ).normalize();
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    directions[offset] = direction.x;
    directions[offset + 1] = direction.y;
    directions[offset + 2] = direction.z;
    seeds[index] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDirection', new THREE.BufferAttribute(directions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createGlyphGeometry(font: Font, glyph: string) {
  const geometry = new TextGeometry(glyph, {
    font,
    size: 1.82,
    depth: 0.24,
    curveSegments: 5,
    bevelEnabled: true,
    bevelThickness: 0.055,
    bevelSize: 0.045,
    bevelOffset: 0,
    bevelSegments: 2,
  });
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (bounds) {
    geometry.translate(
      -(bounds.max.x + bounds.min.x) / 2,
      -(bounds.max.y + bounds.min.y) / 2,
      -(bounds.max.z + bounds.min.z) / 2,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function DadakidoChineseMark() {
  const [font, setFont] = useState<Font | null>(null);
  const glyphRefs = useRef<Array<THREE.Group | null>>([]);
  const solidMaterialRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const glowMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const burstRef = useRef({ glyph: -1, startedAt: -100 });
  const lastPulseIdRef = useRef(0);
  const nebulaPulse = useAutoCosmicInteractionStore((state) => state.nebulaPulse);

  useEffect(() => {
    let cancelled = false;
    new TTFLoader().load(
      '/assets/brand/dadakido-tangyuan-subset.ttf',
      (typeface) => {
        if (!cancelled) setFont(new FontLoader().parse(typeface));
      },
      undefined,
      (error) => console.warn('Unable to load the TangYuan wordmark font.', error),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const geometries = useMemo(
    () => (font ? GLYPHS.map((glyph) => createGlyphGeometry(font, glyph)) : []),
    [font],
  );
  const burstGeometries = useMemo(
    () => geometries.map((geometry, index) => createBurstGeometry(geometry, index)),
    [geometries],
  );
  const burstMaterials = useMemo(
    () => GLYPH_COLORS.map((color) => new THREE.ShaderMaterial({
      vertexShader: BURST_VERTEX_SHADER,
      fragmentShader: BURST_FRAGMENT_SHADER,
      uniforms: {
        uBurst: { value: 0 },
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })),
    [],
  );

  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      burstGeometries.forEach((geometry) => geometry.dispose());
    },
    [burstGeometries, geometries],
  );

  useEffect(() => () => burstMaterials.forEach((material) => material.dispose()), [burstMaterials]);

  useEffect(() => {
    if (nebulaPulse.id === 0 || nebulaPulse.id === lastPulseIdRef.current) return;
    lastPulseIdRef.current = nebulaPulse.id;
    burstRef.current = {
      glyph: THREE.MathUtils.euclideanModulo(nebulaPulse.glyph, GLYPHS.length),
      startedAt: performance.now() * 0.001,
    };
  }, [nebulaPulse]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const burstProgress = THREE.MathUtils.clamp(
      (performance.now() * 0.001 - burstRef.current.startedAt) / BURST_DURATION_SECONDS,
      0,
      1,
    );
    const burst = burstProgress < 1 ? Math.sin(burstProgress * Math.PI) : 0;
    const activeBurstGlyph = burstProgress < 1 ? burstRef.current.glyph : -1;
    glyphRefs.current.forEach((glyph, index) => {
      if (!glyph) return;
      const jumpPhase = time * 1.65 - index * 0.78;
      const hop = Math.max(0, Math.sin(jumpPhase)) ** 2.6;
      const anticipation = Math.max(0, Math.cos(jumpPhase)) ** 14;
      const landing = Math.max(0, Math.cos(jumpPhase - Math.PI)) ** 18;
      glyph.position.set(
        (index - 1.5) * GLYPH_SPACING + Math.sin(time * 0.7 + index * 1.25) * 0.035,
        hop * 0.52 - landing * 0.045 + Math.sin(time * 0.72 + index) * 0.032,
        0,
      );
      glyph.rotation.set(0, 0, 0);
      const breathe = Math.sin(time * 1.2 + index * 0.85) * 0.014;
      const squash = landing * 0.11 + anticipation * 0.045;
      const stretch = hop * 0.085;
      glyph.scale.set(
        1 + breathe + squash - stretch * 0.42,
        1 + breathe - squash * 0.72 + stretch,
        1 + breathe + squash * 0.45 - stretch * 0.3,
      );
      const solidMaterial = solidMaterialRefs.current[index];
      const glowMaterial = glowMaterialRefs.current[index];
      const isBursting = index === activeBurstGlyph;
      if (solidMaterial) solidMaterial.opacity = isBursting ? 0 : SOLID_OPACITY;
      if (glowMaterial) glowMaterial.opacity = isBursting ? 0 : SOLID_OPACITY;
      const burstMaterial = burstMaterials[index];
      burstMaterial.uniforms.uTime.value = time;
      burstMaterial.uniforms.uBurst.value = isBursting ? burst : 0;
      burstMaterial.uniforms.uOpacity.value = isBursting ? 1 : 0;
    });
  });

  if (!font || geometries.length !== GLYPHS.length) return null;

  return (
    <group
      name="dadakido-chinese-mark"
      position={[0, -8.45, -1.12]}
      rotation={[0, 0, 0]}
      scale={0.9}
    >
      {geometries.map((geometry, index) => (
        <group
          key={index}
          ref={(node) => {
            glyphRefs.current[index] = node;
          }}
          position={[(index - 1.5) * GLYPH_SPACING, 0, 0]}
          onPointerDown={(event) => {
            event.stopPropagation();
            burstRef.current = {
              glyph: index,
              startedAt: performance.now() * 0.001,
            };
          }}
        >
          <mesh name={`dadakido-chinese-glyph-${index}-hitbox`} renderOrder={46}>
            <boxGeometry args={[3.35, 3.2, 1.2]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
          <mesh geometry={geometry} renderOrder={44}>
            <meshStandardMaterial
              ref={(material) => {
                solidMaterialRefs.current[index] = material;
              }}
              color={GLYPH_COLORS[index]}
              emissive={GLYPH_COLORS[index]}
              emissiveIntensity={0.58}
              roughness={0.72}
              metalness={0}
              transparent
              opacity={0.14}
              depthWrite={false}
              side={THREE.DoubleSide}
              blending={THREE.NormalBlending}
            />
          </mesh>
          <mesh geometry={geometry} scale={1.11} position={[0, 0, -0.035]} renderOrder={43}>
            <meshBasicMaterial
              ref={(material) => {
                glowMaterialRefs.current[index] = material;
              }}
              color={GLYPH_COLORS[index]}
              transparent
              opacity={0.14}
              depthWrite={false}
              depthTest
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <points
            geometry={burstGeometries[index]}
            material={burstMaterials[index]}
            renderOrder={45}
            frustumCulled={false}
            raycast={() => null}
          />
        </group>
      ))}
    </group>
  );
}
