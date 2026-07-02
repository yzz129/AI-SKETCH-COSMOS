import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const SPARK_COUNT = 84;

export function BrightSparkStars() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    const colors = new Float32Array(SPARK_COUNT * 3);
    const sizes = new Float32Array(SPARK_COUNT);
    const alphas = new Float32Array(SPARK_COUNT);
    const phases = new Float32Array(SPARK_COUNT);
    const palette = [
      new THREE.Color('#f7f3ff'),
      new THREE.Color('#f3a6ff'),
      new THREE.Color('#64d9ff'),
      new THREE.Color('#f2913c')
    ];

    for (let i = 0; i < SPARK_COUNT; i += 1) {
      const i3 = i * 3;
      const color = palette[Math.floor(Math.random() * palette.length)].clone();
      const keyZone = Math.random();
      let x = THREE.MathUtils.randFloatSpread(12.4);
      let y = THREE.MathUtils.randFloatSpread(6.4);

      if (keyZone < 0.28) {
        x = THREE.MathUtils.randFloat(-5.8, -2.2);
        y = THREE.MathUtils.randFloat(1.25, 3.4);
      } else if (keyZone < 0.5) {
        x = THREE.MathUtils.randFloat(2.0, 5.8);
        y = THREE.MathUtils.randFloat(-2.8, -0.8);
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = THREE.MathUtils.randFloat(-8.8, -3.8);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[i] = THREE.MathUtils.randFloat(0.02, 0.062);
      alphas[i] = THREE.MathUtils.randFloat(0.3, 0.72);
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
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float pulse = 0.76 + 0.24 * sin(uTime * 1.4 + aPhase);
          gl_PointSize = aSize * pulse * 860.0 * uPixelRatio / max(-mvPosition.z, 0.01);
          vColor = color;
          vAlpha = aAlpha * pulse;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float core = smoothstep(0.18, 0.0, d);
          float halo = smoothstep(0.5, 0.02, d) * 0.34;
          float cross = smoothstep(0.028, 0.0, abs(p.x)) * smoothstep(0.48, 0.0, abs(p.y));
          cross += smoothstep(0.028, 0.0, abs(p.y)) * smoothstep(0.48, 0.0, abs(p.x));
          float alpha = (core + halo + cross * 0.48) * vAlpha;
          gl_FragColor = vec4(vColor + cross * 0.18, alpha);
        }
      `
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (pointsRef.current) {
      pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.018) * 0.006;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={6} frustumCulled={false} raycast={() => null} />;
}
