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
  attribute float depthFactor;
  attribute float surfaceShade;
  attribute float particleSize;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepthFactor;
  varying float vSurfaceShade;

  void main() {
    vec3 p = position;
    float drift = sin(uTime * 0.85 + phase) * 0.055;
    p += normalize(position + vec3(0.001)) * drift;
    p.y += sin(uTime * 0.55 + phase * 1.7) * 0.032;
    p.z += cos(uTime * 0.72 + phase * 1.2) * 0.034;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float twinkle = 0.68 + 0.32 * sin(uTime * 1.9 + phase);

    vColor = min(particleColor * mix(0.72, 0.98, surfaceShade), vec3(0.94));
    vAlpha = twinkle * mix(0.42, 0.76, depthFactor);
    vDepthFactor = depthFactor;
    vSurfaceShade = surfaceShade;
    gl_PointSize = (particleSize * twinkle * mix(0.82, 1.38, depthFactor)) / max(1.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepthFactor;
  varying float vSurfaceShade;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) discard;
    vec2 sphereUv = p * 2.0;
    float sphereZ = sqrt(max(0.0, 1.0 - dot(sphereUv, sphereUv)));
    vec3 beadNormal = normalize(vec3(sphereUv, sphereZ));
    float light = dot(beadNormal, normalize(vec3(-0.36, 0.44, 0.82))) * 0.5 + 0.5;
    float soft = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.24, 0.0, d);
    float rim = smoothstep(0.3, 0.5, d) * 0.08;
    vec3 color = vColor * mix(0.62, 1.08, light) * mix(0.64, 1.0, vDepthFactor) * mix(0.86, 1.08, vSurfaceShade);
    color += vColor * rim;
    gl_FragColor = vec4(min(color, vec3(0.92)), soft * vAlpha * (0.56 + core * 0.14));
  }
`;

export function SurfaceParticles({
  colors,
  count = 900,
  radius = 0.85
}: SurfaceParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const safeCount = Math.min(count, 2200);
    const positions = new Float32Array(safeCount * 3);
    const particleColors = new Float32Array(safeCount * 3);
    const phases = new Float32Array(safeCount);
    const depthFactors = new Float32Array(safeCount);
    const surfaceShades = new Float32Array(safeCount);
    const particleSizes = new Float32Array(safeCount);
    const palette = colors.length
      ? colors.map((color) => new THREE.Color(color))
      : [new THREE.Color('#64d9ff')];

    for (let i = 0; i < safeCount; i += 1) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const shellBias = Math.pow(Math.random(), 0.42);
      const r = radius * (0.48 + shellBias * 0.58);
      const stretch = 1 + Math.sin(theta * 2) * 0.11;

      positions[i3] = Math.sin(phi) * Math.cos(theta) * r * stretch;
      positions[i3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.88;
      positions[i3 + 2] = Math.cos(phi) * r * (0.96 + Math.random() * 0.34);

      const color = palette[Math.floor(Math.random() * palette.length)];
      particleColors[i3] = color.r;
      particleColors[i3 + 1] = color.g;
      particleColors[i3 + 2] = color.b;
      phases[i] = Math.random() * Math.PI * 2;
      depthFactors[i] = THREE.MathUtils.clamp((positions[i3 + 2] / Math.max(radius, 0.001) + 1.08) / 2.16, 0, 1);
      surfaceShades[i] = THREE.MathUtils.clamp(0.52 + depthFactors[i] * 0.28 + (positions[i3 + 1] / Math.max(radius, 0.001)) * 0.16 + Math.random() * 0.12, 0.38, 1);
      particleSizes[i] = 17 + Math.random() * 7 + shellBias * 5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('particleColor', new THREE.BufferAttribute(particleColors, 3));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('depthFactor', new THREE.BufferAttribute(depthFactors, 1));
    geometry.setAttribute('surfaceShade', new THREE.BufferAttribute(surfaceShades, 1));
    geometry.setAttribute('particleSize', new THREE.BufferAttribute(particleSizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: true,
      vertexColors: false
    });

    return { geometry, material };
  }, [colors, count, radius]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;

    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.elapsedTime * 0.09;
      pointsRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.26) * 0.045;
      pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.34) * 0.065;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
