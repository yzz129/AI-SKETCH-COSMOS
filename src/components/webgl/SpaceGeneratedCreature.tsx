import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { StoredArtwork } from '../../stores/artworkStore';
import type { MotionPreset } from '../../types/artwork';
import { crowdAvoidance, nearestFoodAttraction, pointerAvoidance, useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { GeneratedArtworkModel } from './GeneratedArtworkModel';
import { SurfaceParticles } from './SurfaceParticles';

type SpaceGeneratedCreatureProps = {
  artwork: StoredArtwork;
  index: number;
};

const TRAIL_VERTEX_SHADER = `
  attribute float phase;
  attribute float strength;
  attribute vec3 trailColor;
  uniform float uTime;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.9 + phase) * 0.05;
    p.z += cos(uTime * 0.7 + phase * 1.3) * 0.04;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vColor = trailColor;
    vAlpha = strength * (0.62 + 0.38 * sin(uTime * 1.4 + phase));
    gl_PointSize = (16.0 * strength) / max(1.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const TRAIL_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const AURA_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const AURA_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.4);
    float pulse = 0.62 + 0.38 * sin(uTime * 1.25);
    gl_FragColor = vec4(uColor, fresnel * pulse * 0.08);
  }
`;

function motionSpeed(motionPreset: MotionPreset) {
  switch (motionPreset) {
    case 'wingedFly':
      return 0.042;
    case 'butterflyFloat':
      return 0.032;
    case 'fishSwim':
      return 0.036;
    case 'quadrupedRun':
      return 0.038;
    case 'quadrupedLeap':
      return 0.035;
    case 'plantSway':
      return 0.018;
    case 'spiritFloat':
      return 0.026;
    default:
      return 0.024;
  }
}

function modelParticleRadius(motionPreset: MotionPreset) {
  if (motionPreset === 'plantSway') return 0.48;
  if (motionPreset === 'butterflyFloat') return 0.62;
  if (motionPreset === 'fishSwim') return 0.54;
  return 0.58;
}

export function SpaceGeneratedCreature({ artwork, index }: SpaceGeneratedCreatureProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const smoothedOffsetRef = useRef(new THREE.Vector3());
  const phase = useMemo(() => index * 1.618 + Math.random() * Math.PI * 2, [index]);
  const features = artwork.features;
  const colors = features.visualTraits.dominantColors;
  const modelUrl = artwork.model3d?.modelUrl;
  const [modelReady, setModelReady] = useState(false);
  const speed = useMemo(() => motionSpeed(features.motionPreset), [features.motionPreset]);
  const start = useMemo(() => {
    const lane = index % 6;
    return new THREE.Vector3(
      -3.8 + (lane % 3) * 0.42,
      -0.9 + Math.floor(lane / 3) * 0.8,
      -1.2 + (index % 4) * 0.32
    );
  }, [index]);

  useEffect(() => {
    setModelReady(false);
  }, [modelUrl]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(start.x - 0.35, start.y, start.z),
    new THREE.Vector3(-1.7 + Math.sin(phase) * 0.65, 0.85 + Math.cos(phase) * 0.28, -0.55),
    new THREE.Vector3(0.75 + Math.cos(phase * 0.7) * 0.55, 0.22 + Math.sin(phase) * 0.34, 0.36),
    new THREE.Vector3(3.25 - Math.sin(phase) * 0.42, -0.42 + Math.cos(phase) * 0.24, -0.86),
    new THREE.Vector3(1.15 + Math.sin(phase * 1.4) * 0.46, -1.08, -1.35),
    new THREE.Vector3(-2.4, 0.08 + Math.cos(phase) * 0.38, -0.38)
  ], true, 'catmullrom', 0.42), [phase, start]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    const body = bodyRef.current;
    if (!group) return;

    const t = clock.elapsedTime;
    const wallTime = performance.now() * 0.001;
    const progress = (t * speed + phase * 0.037) % 1;
    const pathPosition = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).normalize();
    const foodOffset = nearestFoodAttraction(pathPosition, wallTime);
    const avoidOffset = pointerAvoidance(pathPosition).add(crowdAvoidance(artwork.id, pathPosition));

    smoothedOffsetRef.current.lerp(foodOffset.add(avoidOffset), 1 - Math.exp(-delta * 1.8));
    group.position.copy(pathPosition).add(smoothedOffsetRef.current);

    const depthScale = THREE.MathUtils.mapLinear(
      THREE.MathUtils.clamp(group.position.z, -1.6, 0.6),
      -1.6,
      0.6,
      0.76,
      1.1
    );

    group.scale.setScalar(depthScale * Math.max(0.52, 0.74 - index * 0.025));
    useCreatureBehaviorStore.getState().setCreaturePosition(artwork.id, group.position.toArray());

    group.rotation.y = Math.sin(t * 0.34 + phase) * 0.22 + tangent.x * 0.18;
    group.rotation.z = Math.atan2(tangent.y, tangent.x) * 0.1 + Math.sin(t * 0.58 + phase) * 0.05;

    if (body) {
      const breathe = 1 + Math.sin(t * 1.15 + phase) * 0.035;
      const innerFlow = Math.sin(t * 1.75 + phase) * 0.03;
      body.scale.set(
        breathe + innerFlow,
        1 + Math.cos(t * 1.25 + phase) * 0.028,
        1 + Math.sin(t * 1.42 + phase) * 0.045
      );

      if (features.motionPreset === 'plantSway') {
        body.rotation.z = Math.sin(t * 0.72 + phase) * 0.16;
      } else if (features.motionPreset === 'fishSwim') {
        body.rotation.y = Math.sin(t * 1.18 + phase) * 0.22;
      } else if (features.motionPreset === 'wingedFly' || features.motionPreset === 'butterflyFloat') {
        body.rotation.x = Math.sin(t * 1.05 + phase) * 0.08;
      } else {
        body.rotation.x = Math.sin(t * 0.68 + phase) * 0.06;
      }
    }
  });

  return (
    <group ref={groupRef} renderOrder={10}>
      <GeneratedModelTrail colors={colors} seed={phase} motionPreset={features.motionPreset} />
      <group ref={bodyRef}>
        {modelUrl ? (
          <Suspense fallback={null}>
            <GeneratedArtworkModel
              modelUrl={modelUrl}
              colors={colors}
              motionPreset={features.motionPreset}
              scale={0.48}
              onReady={() => setModelReady(true)}
            />
          </Suspense>
        ) : null}
        {modelReady ? (
          <>
            <CosmicBreathingAura colors={colors} motionPreset={features.motionPreset} />
            <SurfaceParticles
              colors={colors}
              count={Math.max(560, 1350 - index * 120)}
              radius={modelParticleRadius(features.motionPreset)}
            />
          </>
        ) : null}
      </group>
    </group>
  );
}

function GeneratedModelTrail({
  colors,
  seed,
  motionPreset
}: {
  colors: string[];
  seed: number;
  motionPreset: MotionPreset;
}) {
  const { geometry, material } = useMemo(() => {
    const count = motionPreset === 'plantSway' ? 120 : 240;
    const positions = new Float32Array(count * 3);
    const particleColors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const strengths = new Float32Array(count);
    const palette = colors.length
      ? colors.map((color) => new THREE.Color(color))
      : [new THREE.Color('#64d9ff')];

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const depth = i / count;
      const side = Math.sin(seed * 3.1 + i * 12.9898) * 0.24;
      const rise = Math.cos(seed * 2.7 + i * 8.271) * 0.18;

      positions[i3] = -0.18 - depth * (motionPreset === 'fishSwim' ? 0.92 : 1.12);
      positions[i3 + 1] = side * (0.28 + depth * 0.76);
      positions[i3 + 2] = rise * (0.22 + depth * 0.68);

      const color = palette[i % palette.length];
      particleColors[i3] = color.r;
      particleColors[i3 + 1] = color.g;
      particleColors[i3 + 2] = color.b;
      phases[i] = seed + i * 0.37;
      strengths[i] = Math.pow(1 - depth, 1.15) * 0.88;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('trailColor', new THREE.BufferAttribute(particleColors, 3));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('strength', new THREE.BufferAttribute(strengths, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: TRAIL_VERTEX_SHADER,
      fragmentShader: TRAIL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: false
    });

    return { geometry, material };
  }, [colors, motionPreset, seed]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return <points geometry={geometry} material={material} />;
}

function CosmicBreathingAura({
  colors,
  motionPreset
}: {
  colors: string[];
  motionPreset: MotionPreset;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colors[1] ?? colors[0] ?? '#64d9ff') },
      uTime: { value: 0 }
    },
    vertexShader: AURA_VERTEX_SHADER,
    fragmentShader: AURA_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide
  }), [colors]);

  const baseScale = motionPreset === 'butterflyFloat'
    ? [0.58, 0.5, 0.46]
    : motionPreset === 'fishSwim'
      ? [0.54, 0.4, 0.38]
      : [0.52, 0.48, 0.46];

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;

    if (meshRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 0.92) * 0.055;
      meshRef.current.scale.set(
        baseScale[0] * pulse,
        baseScale[1] * (1 + Math.cos(clock.elapsedTime * 0.7) * 0.04),
        baseScale[2] * pulse
      );
      meshRef.current.rotation.y = clock.elapsedTime * 0.12;
    }
  });

  return (
    <mesh ref={meshRef} material={material}>
      <sphereGeometry args={[1, 48, 24]} />
    </mesh>
  );
}
