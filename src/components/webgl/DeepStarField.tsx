import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const STAR_COUNT = 8000;
const VOLUME_HALF = 50;

function getDensity() {
  return Math.min(2.2, Math.max(0.65, window.innerWidth / 1440));
}

export function DeepStarField() {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);

    for (let i = 0; i < STAR_COUNT * 3; i += 1) {
      positions[i] = (Math.random() - 0.5) * VOLUME_HALF * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        uniform float uPixelRatio;
        varying float vDepth;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = 2.5 * uPixelRatio / max(-mvPosition.z, 0.01);
          vDepth = -mvPosition.z;
        }
      `,
      fragmentShader: `
        varying float vDepth;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = exp(-d * d * 8.0) * 0.65;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(1.0, 0.97, 0.92, alpha);
        }
      `,
    });

    return { geometry, material };
  }, []);

  // Boost point-size on large screens to maintain perceived density
  useFrame(() => {
    if (pointsRef.current) {
      const density = getDensity();
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2) * density;
    }
  });

  return (
    <group>
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        renderOrder={1}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}
