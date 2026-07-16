import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSketchStore } from '../../stores/useSketchStore';
import {
  type CreatureInteractionKind,
  useCreatureInteractionStore
} from './creatureInteractionStore';
import {
  SPOTLIGHT_ENTRY_EFFECT_DURATION,
  SPOTLIGHT_OUTER_LAYER_DISTANCE
} from './spotlightConfig';

export type CreatureEffectKind = CreatureInteractionKind | 'entry';

export type CreatureEffectSignal = {
  id: number;
  kind: CreatureEffectKind;
  startedAt: number;
};

/**
 * Scene-level entrance fireworks. Keeping this outside the creature hierarchy
 * prevents a newly loaded splat, its scale, or its render order from hiding the
 * lead-in effect. The timestamp is translated to the performance clock used by
 * CreatureEventParticles so late React commits still join the correct frame.
 */
export function SpotlightEntryFireworks() {
  const creatureId = useSketchStore((state) => state.spotlight.creatureId);
  const phase = useSketchStore((state) => state.spotlight.phase);
  const startedAt = useSketchStore((state) => state.spotlight.startedAt);
  const signalRef = useRef<CreatureEffectSignal>({
    id: 0,
    kind: 'entry',
    startedAt: -100
  });

  useEffect(() => {
    if (!creatureId || phase !== 'fly-in' || startedAt <= 0) return;
    const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
    signalRef.current = {
      id: startedAt,
      kind: 'entry',
      startedAt: performance.now() * 0.001 - elapsed
    };
  }, [creatureId, phase, startedAt]);

  return <CreatureEventParticles signalRef={signalRef} />;
}

const INTERACTION_PARTICLE_COUNT = 156;
const ENTRY_PARTICLE_COUNT = 228;
const EFFECT_COLORS: Record<CreatureEffectKind, THREE.ColorRepresentation> = {
  entry: '#70edff',
  fight: '#ff6b70',
  victory: '#ffe36a',
  trapped: '#b675ff',
  escape: '#75fff0',
  boost: '#63b8ff',
  portal: '#5fe8ff',
  collision: '#ff9c64'
};

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.733 + salt * 47.11) * 43758.5453;
  return value - Math.floor(value);
}

export function CreatureEventParticles({ signalRef }: {
  signalRef: MutableRefObject<CreatureEffectSignal>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const screenCenterRef = useRef(new THREE.Vector3());
  const parentScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const lastSignalRef = useRef(-1);
  const geometry = useMemo(() => {
    const positions = new Float32Array(ENTRY_PARTICLE_COUNT * 3);
    const speeds = new Float32Array(ENTRY_PARTICLE_COUNT);
    const phases = new Float32Array(ENTRY_PARTICLE_COUNT);
    const sizes = new Float32Array(ENTRY_PARTICLE_COUNT);
    for (let index = 0; index < ENTRY_PARTICLE_COUNT; index += 1) {
      const theta = seeded(index, 1) * Math.PI * 2;
      const z = seeded(index, 2) * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - z * z));
      const i3 = index * 3;
      positions[i3] = Math.cos(theta) * radial;
      positions[i3 + 1] = z;
      positions[i3 + 2] = Math.sin(theta) * radial;
      speeds[index] = 0.72 + seeded(index, 3) * 0.9;
      phases[index] = seeded(index, 4) * Math.PI * 2;
      sizes[index] = 0.7 + seeded(index, 5) * 1.45;
    }
    const output = new THREE.BufferGeometry();
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    output.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    output.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    output.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return output;
  }, []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Entry fireworks must remain visible against dense splats. They stay in
    // front while the model emerges from behind the fading particle shell.
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uProgress: { value: 1 },
      uEntry: { value: 1 },
      uColor: { value: new THREE.Color(EFFECT_COLORS.entry) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      attribute float aSpeed;
      attribute float aPhase;
      attribute float aSize;
      uniform float uProgress;
      uniform float uEntry;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vPhase;
      void main() {
        float eased = 1.0 - pow(1.0 - clamp(uProgress, 0.0, 1.0), 3.0);
        vec3 direction = normalize(position + vec3(0.0001));
        vec3 tangent = normalize(cross(direction, vec3(0.2, 1.0, 0.35)) + vec3(0.0001));
        float radius = mix(1.35, 2.35, uEntry);
        vec3 p = direction * (0.08 + eased * aSpeed * radius)
          + tangent * sin(aPhase + eased * 8.0) * (1.0 - eased) * mix(0.16, 0.34, uEntry);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vPhase = aPhase;
        vAlpha = smoothstep(0.0, 0.08, uProgress)
          * (1.0 - smoothstep(mix(0.58, 0.76, uEntry), 1.0, uProgress));
        float blastPulse = sin(clamp(uProgress * 1.18, 0.0, 1.0) * 3.1415926);
        gl_PointSize = aSize * mix(7.5, 16.5, uEntry)
          * (1.0 + 1.05 * (1.0 - eased) + blastPulse * 0.32)
          * uPixelRatio / max(-mvPosition.z, 0.35);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uEntry;
      varying float vAlpha;
      varying float vPhase;
      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float core = smoothstep(0.34, 0.0, distanceToCenter);
        float halo = smoothstep(0.54, 0.08, distanceToCenter) * 0.34;
        float alpha = (core + halo) * vAlpha * mix(1.0, 1.24, uEntry);
        if (alpha < 0.008) discard;
        vec3 fireworkColor = 0.55 + 0.45 * cos(vPhase + vec3(0.0, 2.1, 4.2));
        vec3 finalColor = mix(uColor, fireworkColor, uEntry * 0.62);
        finalColor = mix(finalColor, vec3(1.0), uEntry * core * 0.38);
        gl_FragColor = vec4(finalColor * mix(1.0, 1.32, uEntry), alpha);
      }
    `
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ camera }) => {
    const points = pointsRef.current;
    const signal = signalRef.current;
    if (!points) return;
    if (signal.id !== lastSignalRef.current) {
      lastSignalRef.current = signal.id;
      material.uniforms.uColor.value.set(EFFECT_COLORS[signal.kind]);
      material.uniforms.uEntry.value = signal.kind === 'entry' ? 1 : 0;
      geometry.setDrawRange(
        0,
        signal.kind === 'entry' ? ENTRY_PARTICLE_COUNT : INTERACTION_PARTICLE_COUNT
      );
    }
    const age = performance.now() * 0.001 - signal.startedAt;
    const duration = signal.kind === 'entry' ? SPOTLIGHT_ENTRY_EFFECT_DURATION : 0.92;
    const progress = THREE.MathUtils.clamp(age / duration, 0, 1);
    material.uniforms.uProgress.value = progress;
    points.visible = age >= 0 && progress < 0.999;
    points.rotation.y = age * (signal.kind === 'entry' ? 0.28 : 0.85);
    if (signal.kind === 'entry' && points.parent) {
      // The firework is a presentation effect, so keep it at the screen centre
      // even when the incoming creature started near an edge of the universe.
      camera.getWorldDirection(screenCenterRef.current)
        .multiplyScalar(SPOTLIGHT_OUTER_LAYER_DISTANCE)
        .add(camera.position);
      points.parent.updateWorldMatrix(true, false);
      points.parent.worldToLocal(screenCenterRef.current);
      points.position.copy(screenCenterRef.current);
      points.parent.getWorldScale(parentScaleRef.current);
      points.scale.set(
        1 / Math.max(Math.abs(parentScaleRef.current.x), 0.001),
        1 / Math.max(Math.abs(parentScaleRef.current.y), 0.001),
        1 / Math.max(Math.abs(parentScaleRef.current.z), 0.001)
      );
    } else {
      points.position.set(0, 0, 0);
      points.scale.setScalar(1);
    }
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      renderOrder={20}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}

const SUCTION_PARTICLE_COUNT = 112;

export function CreatureSuctionVortex({ creatureId }: { creatureId: string }) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(SUCTION_PARTICLE_COUNT * 3);
    const phases = new Float32Array(SUCTION_PARTICLE_COUNT);
    const sizes = new Float32Array(SUCTION_PARTICLE_COUNT);
    for (let index = 0; index < SUCTION_PARTICLE_COUNT; index += 1) {
      const phase = seeded(index, 21);
      const angle = phase * Math.PI * 2;
      const radius = 0.28 + seeded(index, 22) * 0.86;
      const i3 = index * 3;
      positions[i3] = Math.cos(angle) * radius;
      positions[i3 + 1] = (seeded(index, 23) - 0.5) * 1.4;
      positions[i3 + 2] = Math.sin(angle) * radius;
      phases[index] = phase;
      sizes[index] = 0.65 + seeded(index, 24) * 1.35;
    }
    const output = new THREE.BufferGeometry();
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    output.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    output.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return output;
  }, []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uCapture: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uCapture;
      uniform float uOpacity;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        float stream = fract(aPhase + uTime * mix(0.34, 0.82, uCapture));
        float inward = 1.0 - stream;
        float angle = aPhase * 18.8496 + uTime * mix(2.8, 5.2, uCapture);
        float radius = mix(1.28, 0.12, inward) * mix(1.0, 0.48, uCapture);
        vec3 p = vec3(
          cos(angle) * radius,
          position.y * (1.0 - inward * 0.68),
          sin(angle) * radius
        );
        p.y += (stream - 0.5) * (1.0 - uCapture) * 0.42;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = uOpacity * smoothstep(0.0, 0.16, stream) * (1.0 - smoothstep(0.82, 1.0, stream));
        gl_PointSize = aSize * (7.0 + inward * 5.5) * uPixelRatio / max(-mvPosition.z, 0.4);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float core = smoothstep(0.31, 0.0, d);
        float halo = smoothstep(0.53, 0.08, d) * 0.35;
        float alpha = (core + halo) * vAlpha;
        if (alpha < 0.008) discard;
        vec3 color = mix(vec3(0.28, 0.82, 1.0), vec3(0.72, 0.39, 1.0), gl_PointCoord.y);
        gl_FragColor = vec4(color, alpha);
      }
    `
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const event = useCreatureInteractionStore.getState().events[creatureId];
    const age = event ? clock.elapsedTime - event.startedAt : Number.POSITIVE_INFINITY;
    const active = Boolean(
      event
      && (event.kind === 'trapped' || event.kind === 'portal')
      && age >= 0
      && age < event.duration
    );
    points.visible = active;
    if (!active || !event) return;
    const captureDuration = event.captureDuration ?? 2.1;
    const capture = THREE.MathUtils.smootherstep(
      THREE.MathUtils.clamp(age / captureDuration, 0, 1),
      0,
      1
    );
    const fadeIn = THREE.MathUtils.smoothstep(age, 0, 0.22);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(age, event.duration - 0.34, event.duration);
    material.uniforms.uTime.value = age;
    material.uniforms.uCapture.value = capture;
    material.uniforms.uOpacity.value = fadeIn * fadeOut * (0.68 + capture * 0.2);
    points.rotation.y = age * 0.32;
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      renderOrder={13}
      frustumCulled={false}
      visible={false}
      raycast={() => null}
    />
  );
}
