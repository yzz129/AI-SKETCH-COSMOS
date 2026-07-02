import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type GalaxySpiralProps = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  count: number;
  radius: number;
  coreRadius: number;
  arms: number;
  spin: number;
  brightness: number;
};

export function GalaxySpiral({
  position,
  rotation,
  scale,
  count,
  radius,
  coreRadius,
  arms,
  spin,
  brightness
}: GalaxySpiralProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const galaxy = useMemo(() => createGalaxy({ count, radius, coreRadius, arms, spin, brightness }), [
    arms,
    brightness,
    coreRadius,
    count,
    radius,
    spin
  ]);
  const haloMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#7b4dff',
        transparent: true,
        opacity: 0.11 * brightness,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [brightness]
  );

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.z = clock.elapsedTime * 0.018 * (0.7 + brightness * 0.25);
    }
    if (haloRef.current) {
      haloRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 0.28 + scale) * 0.025);
    }
    galaxy.material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh ref={haloRef} material={haloMaterial} renderOrder={-1}>
        <circleGeometry args={[radius * 1.26, 96]} />
      </mesh>
      <points ref={pointsRef} geometry={galaxy.geometry} material={galaxy.material} frustumCulled={false} raycast={() => null} />
    </group>
  );
}

function createGalaxy({
  count,
  radius,
  coreRadius,
  arms,
  spin,
  brightness
}: Pick<GalaxySpiralProps, 'count' | 'radius' | 'coreRadius' | 'arms' | 'spin' | 'brightness'>) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const warm = new THREE.Color('#f7d6ff');
  const violet = new THREE.Color('#7b4dff');
  const cyan = new THREE.Color('#64d9ff');

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const inCore = Math.random() < 0.16;
    const branch = i % arms;
    const radial = inCore ? Math.pow(Math.random(), 1.8) * coreRadius : coreRadius + Math.pow(Math.random(), 1.42) * (radius - coreRadius);
    const armAngle = (branch / arms) * Math.PI * 2 + radial * spin;
    const scatter = inCore ? THREE.MathUtils.randFloatSpread(1.25) : THREE.MathUtils.randFloatSpread(0.22 + radial * 0.14);
    const angle = armAngle + scatter;
    const thickness = inCore ? coreRadius * 0.26 : 0.035 + radial * 0.028;
    const diskNoise = THREE.MathUtils.randFloatSpread(thickness);
    const color = warm.clone().lerp(violet, THREE.MathUtils.clamp(radial / radius, 0, 1) * 0.66);

    if (!inCore && Math.random() > 0.58) {
      color.lerp(cyan, 0.36);
    }

    positions[i3] = Math.cos(angle) * radial + THREE.MathUtils.randFloatSpread(0.045);
    positions[i3 + 1] = Math.sin(angle) * radial * 0.58 + diskNoise;
    positions[i3 + 2] = THREE.MathUtils.randFloatSpread(0.22) * (1 - radial / radius);
    colors[i3] = color.r * brightness;
    colors[i3 + 1] = color.g * brightness;
    colors[i3 + 2] = color.b * brightness;
    sizes[i] = inCore ? THREE.MathUtils.randFloat(0.038, 0.078) : THREE.MathUtils.randFloat(0.018, 0.052);
    alphas[i] = (inCore ? 0.96 : THREE.MathUtils.randFloat(0.34, 0.86)) * brightness;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.z += sin(uTime * 0.22 + aPhase + position.x * 2.0) * 0.012;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * 820.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * (0.78 + 0.22 * sin(uTime * 0.9 + aPhase));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });

  return { geometry, material };
}
