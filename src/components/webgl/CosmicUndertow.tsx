import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

const CURRENT_PARTICLE_COUNT = 720;
const CURRENT_HALF_WIDTH = 12;

export function CosmicUndertow() {
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(CURRENT_PARTICLE_COUNT * 3);
    const colors = new Float32Array(CURRENT_PARTICLE_COUNT * 3);
    const sizes = new Float32Array(CURRENT_PARTICLE_COUNT);
    const alphas = new Float32Array(CURRENT_PARTICLE_COUNT);
    const phases = new Float32Array(CURRENT_PARTICLE_COUNT);
    const speeds = new Float32Array(CURRENT_PARTICLE_COUNT);
    const bands = [-2.5, -0.15, 2.35];
    const palette = [
      new THREE.Color('#204f9f'),
      new THREE.Color('#43268c'),
      new THREE.Color('#155c82'),
      new THREE.Color('#713b96')
    ];

    for (let i = 0; i < CURRENT_PARTICLE_COUNT; i += 1) {
      const i3 = i * 3;
      const band = bands[i % bands.length];
      const color = palette[Math.floor(Math.random() * palette.length)].clone();
      const bright = Math.random() > 0.86;

      positions[i3] = THREE.MathUtils.randFloat(-CURRENT_HALF_WIDTH, CURRENT_HALF_WIDTH);
      positions[i3 + 1] = band + THREE.MathUtils.randFloatSpread(1.35);
      positions[i3 + 2] = THREE.MathUtils.randFloat(-8.2, -4.2);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[i] = bright
        ? THREE.MathUtils.randFloat(0.025, 0.048)
        : THREE.MathUtils.randFloat(0.012, 0.03);
      alphas[i] = bright
        ? THREE.MathUtils.randFloat(0.09, 0.16)
        : THREE.MathUtils.randFloat(0.025, 0.085);
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = THREE.MathUtils.randFloat(0.12, 0.34);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexColors: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aPhase;
        attribute float aSpeed;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          p.x = mod(position.x + ${CURRENT_HALF_WIDTH.toFixed(1)} + uTime * aSpeed, ${(CURRENT_HALF_WIDTH * 2).toFixed(1)}) - ${CURRENT_HALF_WIDTH.toFixed(1)};
          p.y += sin(p.x * 0.52 + aPhase + uTime * 0.12) * 0.22;
          p.y += sin(p.x * 0.2 - uTime * 0.075 + aPhase * 1.7) * 0.13;
          p.z += cos(p.x * 0.28 + aPhase + uTime * 0.08) * 0.16;

          float wave = 0.5 + 0.5 * sin(uTime * 0.2 + aPhase + p.x * 0.3);
          float pulse = 0.48 + pow(wave, 3.0) * 0.52;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * (0.8 + pulse * 0.45) * 720.0 * uPixelRatio / max(-mvPosition.z, 0.01);
          vColor = color;
          vAlpha = aAlpha * (0.55 + pulse * 0.45);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float streak = length(vec2(p.x * 0.72, p.y * 4.8));
          float alpha = smoothstep(0.5, 0.02, streak) * vAlpha;
          if (alpha < 0.006) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={3}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}
