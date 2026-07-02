import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';

type ArtworkParticlesProps = {
  particles: ArtworkParticle[];
};

export function ArtworkParticles({ particles }: ArtworkParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const particleCount = particles.length;
    const dustCount = Math.min(220, Math.max(40, Math.floor(particleCount * 0.18)));
    const positions = new Float32Array((particleCount + dustCount) * 3);
    const colors = new Float32Array((particleCount + dustCount) * 3);
    const sizes = new Float32Array(particleCount + dustCount);
    const phases = new Float32Array(particleCount + dustCount);

    particles.forEach((particle, index) => {
      const i3 = index * 3;
      const edgeBoost = particle.isEdge ? 1.14 : 0.82;

      positions[i3] = particle.x;
      positions[i3 + 1] = particle.y;
      positions[i3 + 2] = particle.isEdge ? 0.045 : 0.028;
      colors[i3] = Math.min(1, (particle.r / 255) * edgeBoost);
      colors[i3 + 1] = Math.min(1, (particle.g / 255) * edgeBoost);
      colors[i3 + 2] = Math.min(1, (particle.b / 255) * edgeBoost);
      sizes[index] = particle.isEdge ? 0.028 : 0.018;
      phases[index] = Math.random() * Math.PI * 2;
    });

    for (let i = 0; i < dustCount; i += 1) {
      const source = particles[Math.floor(Math.random() * Math.max(particles.length, 1))];
      const index = particleCount + i;
      const i3 = index * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.05 + Math.random() * 0.18;

      positions[i3] = (source?.x ?? 0) + Math.cos(angle) * radius;
      positions[i3 + 1] = (source?.y ?? 0) + Math.sin(angle) * radius;
      positions[i3 + 2] = 0.06 + Math.random() * 0.06;
      colors[i3] = source ? Math.min(1, source.r / 255 + 0.16) : 0.65;
      colors[i3 + 1] = source ? Math.min(1, source.g / 255 + 0.16) : 0.9;
      colors[i3 + 2] = source ? Math.min(1, source.b / 255 + 0.2) : 1;
      sizes[index] = 0.014 + Math.random() * 0.018;
      phases[index] = Math.random() * Math.PI * 2;
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bufferGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    return bufferGeometry;
  }, [particles]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
        float drift = sin(uTime * 1.35 + phase) * 0.012;
        p.xy += vec2(cos(phase) * drift, sin(phase) * drift);

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * 68.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));
        vColor = color;
        vAlpha = 0.74 + sin(uTime * 1.8 + phase) * 0.16;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(center)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha * 0.88);
      }
    `
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;

    if (!pointsRef.current) return;
    const scale = 1 + Math.sin(clock.elapsedTime * 1.2) * 0.018;
    pointsRef.current.scale.set(scale, scale, 1);
    pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.55) * 0.014;
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} renderOrder={31} frustumCulled={false} />
  );
}
