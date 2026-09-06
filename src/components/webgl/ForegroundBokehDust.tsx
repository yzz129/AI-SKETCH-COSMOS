import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const BOKEH_COUNT = 80;

export function ForegroundBokehDust() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(BOKEH_COUNT * 3);
    const colors = new Float32Array(BOKEH_COUNT * 3);
    const sizes = new Float32Array(BOKEH_COUNT);
    const alphas = new Float32Array(BOKEH_COUNT);
    const phases = new Float32Array(BOKEH_COUNT);
    const palette = [new THREE.Color('#64d9ff'), new THREE.Color('#f3a6ff'), new THREE.Color('#f7f3ff')];

    for (let i = 0; i < BOKEH_COUNT; i += 1) {
      const i3 = i * 3;
      const color = palette[Math.floor(Math.random() * palette.length)].clone();
      positions[i3] = THREE.MathUtils.randFloatSpread(11.8);
      positions[i3 + 1] = THREE.MathUtils.randFloatSpread(6.4);
      positions[i3 + 2] = THREE.MathUtils.randFloat(0.55, 2.35);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[i] = THREE.MathUtils.randFloat(0.04, 0.12);
      alphas[i] = THREE.MathUtils.randFloat(0.035, 0.095);
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
          vec3 p = position;
          p.x += sin(uTime * 0.055 + aPhase) * 0.12;
          p.y += sin(uTime * 0.18 + aPhase) * 0.035;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * 540.0 * uPixelRatio / max(-mvPosition.z, 0.01);
          vColor = color;
          vAlpha = aAlpha * (0.76 + 0.24 * sin(uTime * 0.6 + aPhase));
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = smoothstep(0.5, 0.0, d) * smoothstep(0.02, 0.48, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={13} frustumCulled={false} raycast={() => null} />;
}
