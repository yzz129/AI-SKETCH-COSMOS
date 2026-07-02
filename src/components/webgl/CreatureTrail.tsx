import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';
import { getTrailProfile, type CreatureMotionType } from '../../utils/creatureMotion';

type CreatureTrailProps = {
  particles: ArtworkParticle[];
  seed: number;
  motionType: CreatureMotionType;
};

export function CreatureTrail({ particles, seed, motionType }: CreatureTrailProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const profile = getTrailProfile(motionType);
    const count = Math.min(120, Math.max(40, profile.count));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const t = i / Math.max(count - 1, 1);
      const source = particles[Math.floor((t * 997 + seed * 31) % Math.max(particles.length, 1))];
      const spread = 0.06 + t * profile.spread;

      positions[i3] = -0.18 - t * profile.length + THREE.MathUtils.randFloatSpread(spread);
      positions[i3 + 1] = THREE.MathUtils.randFloatSpread(spread * 0.72);
      positions[i3 + 2] = -0.16 - t * 0.38 + THREE.MathUtils.randFloatSpread(0.08);
      colors[i3] = source ? Math.min(1, source.r / 255 + 0.08) : 0.68;
      colors[i3 + 1] = source ? Math.min(1, source.g / 255 + 0.12) : 0.82;
      colors[i3 + 2] = source ? Math.min(1, source.b / 255 + 0.18) : 1;
      sizes[i] = 0.012 + Math.random() * 0.018;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bufferGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    return bufferGeometry;
  }, [motionType, particles, seed]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.y += sin(uTime * 1.6 + phase + p.x * 2.0) * 0.025;
        p.z += cos(uTime * 1.1 + phase) * 0.018;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * 78.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));
        vColor = color;
        vAlpha = smoothstep(-1.18, -0.1, p.x) * (0.42 + sin(uTime * 2.2 + phase) * 0.14);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(center)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha * 0.62);
      }
    `
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (!pointsRef.current) return;
    pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.7 + seed) * 0.045;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={4} frustumCulled={false} />;
}
