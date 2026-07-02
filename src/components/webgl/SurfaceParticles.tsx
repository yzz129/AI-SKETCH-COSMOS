import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type SurfaceParticlesProps = {
  colors: string[];
  count?: number;
  radius?: number;
};

const vertexShader = `
  attribute vec3 particleColor;
  attribute float phase;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float drift = sin(uTime * 0.85 + phase) * 0.045;
    p += normalize(position + vec3(0.001)) * drift;
    p.y += sin(uTime * 0.55 + phase * 1.7) * 0.025;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float twinkle = 0.58 + 0.42 * sin(uTime * 1.9 + phase);

    vColor = particleColor;
    vAlpha = twinkle;
    gl_PointSize = (18.0 * twinkle) / max(1.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    float soft = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.18, 0.0, d);
    gl_FragColor = vec4(vColor * (0.75 + core * 0.65), soft * vAlpha * 0.72);
  }
`;

export function SurfaceParticles({
  colors,
  count = 900,
  radius = 0.85
}: SurfaceParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const safeCount = Math.min(count, 1500);
    const positions = new Float32Array(safeCount * 3);
    const particleColors = new Float32Array(safeCount * 3);
    const phases = new Float32Array(safeCount);
    const palette = colors.length
      ? colors.map((color) => new THREE.Color(color))
      : [new THREE.Color('#64d9ff')];

    for (let i = 0; i < safeCount; i += 1) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.72 + Math.random() * 0.38);
      const stretch = 1 + Math.sin(theta * 2) * 0.08;

      positions[i3] = Math.sin(phi) * Math.cos(theta) * r * stretch;
      positions[i3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.88;
      positions[i3 + 2] = Math.cos(phi) * r * (0.82 + Math.random() * 0.28);

      const color = palette[Math.floor(Math.random() * palette.length)];
      particleColors[i3] = color.r;
      particleColors[i3 + 1] = color.g;
      particleColors[i3 + 2] = color.b;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('particleColor', new THREE.BufferAttribute(particleColors, 3));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: false
    });

    return { geometry, material };
  }, [colors, count, radius]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;

    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.elapsedTime * 0.06;
      pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.34) * 0.055;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
