import { useFrame } from '@react-three/fiber';
import { MutableRefObject, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';
import type { CreatureMotionType } from '../../utils/creatureMotion';

type CreatureAuraParticlesProps = {
  particles: ArtworkParticle[];
  width: number;
  height: number;
  seed: number;
  motionType: CreatureMotionType;
  spotlightFocusRef?: MutableRefObject<number>;
  renderOrderRef?: MutableRefObject<number>;
  visibilityRef?: MutableRefObject<number>;
};

export function CreatureAuraParticles({
  particles,
  width,
  height,
  seed,
  motionType,
  spotlightFocusRef,
  renderOrderRef,
  visibilityRef
}: CreatureAuraParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = Math.min(58, Math.max(24, Math.floor(particles.length * 0.045)));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const alphas = new Float32Array(count);
    const maxRadius = Math.max(width, height) * 0.72;

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const source = particles[Math.floor(Math.random() * Math.max(particles.length, 1))];
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.65) * maxRadius;
      const randomScaleX = THREE.MathUtils.randFloat(0.58, 1.08);
      const randomScaleY = THREE.MathUtils.randFloat(0.46, 0.96);

      positions[i3] = Math.cos(angle) * radius * randomScaleX;
      positions[i3 + 1] = Math.sin(angle) * radius * randomScaleY;
      positions[i3 + 2] = THREE.MathUtils.randFloatSpread(0.24);
      colors[i3] = source ? source.r / 255 : 0.7;
      colors[i3 + 1] = source ? source.g / 255 : 0.9;
      colors[i3 + 2] = source ? source.b / 255 : 1;
      sizes[i] = 0.006 + Math.random() * 0.01;
      phases[i] = Math.random() * Math.PI * 2 + seed;
      alphas[i] = Math.max(0.04, 1 - radius / maxRadius) * (source?.isEdge ? 0.22 : 0.16);
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bufferGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    bufferGeometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    return bufferGeometry;
  }, [height, particles, seed, width]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFocusAmount: { value: 0 },
      uVisibility: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uFocusAmount;
      uniform float uVisibility;
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float orbit = uTime * 0.34 + phase;
        p.xy += vec2(cos(orbit * 0.9), sin(orbit * 1.1)) * 0.026;
        p.z += sin(uTime * 0.8 + phase) * 0.04;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * 76.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));
        vColor = color;
        vAlpha = alpha * 0.58 * uVisibility * (1.0 - smoothstep(0.05, 0.72, uFocusAmount));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(center)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha * 0.32);
      }
    `
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uFocusAmount.value = spotlightFocusRef?.current ?? 0;
    material.uniforms.uVisibility.value = visibilityRef?.current ?? 1;
    material.visible = (spotlightFocusRef?.current ?? 0) < 0.96
      && (visibilityRef?.current ?? 1) > 0.01;
    if (!pointsRef.current) return;
    pointsRef.current.renderOrder = renderOrderRef?.current ?? 10;
    const speed = motionType === 'fly' || motionType === 'swim' ? 0.12 : 0.075;
    pointsRef.current.rotation.z = clock.elapsedTime * speed + Math.sin(clock.elapsedTime * 0.7 + seed) * 0.04;
    pointsRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.45 + seed) * (motionType === 'float' ? 0.14 : 0.2);
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={10} frustumCulled={false} />;
}
