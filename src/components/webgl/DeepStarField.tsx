import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const STAR_COUNT = 8000;
const VOLUME_HALF = 50; // Distribution in ±50 unit cube (scaled from reference's ±100)

export function DeepStarField() {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);

    for (let i = 0; i < STAR_COUNT * 3; i += 1) {
      // Uniform random distribution in a large cube — same approach as reference
      positions[i] = (Math.random() - 0.5) * VOLUME_HALF * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Soft, gentle shader — no harsh core, just a diffuse glow
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
          // Fixed small size, scaled by pixel ratio — soft distant stars
          gl_PointSize = 2.5 * uPixelRatio / max(-mvPosition.z, 0.01);
          vDepth = -mvPosition.z;
        }
      `,
      fragmentShader: `
        varying float vDepth;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          // Very soft gaussian-like falloff, no hard core
          float alpha = exp(-d * d * 8.0) * 0.65;
          if (alpha < 0.008) discard;
          // White with subtle warmth
          gl_FragColor = vec4(1.0, 0.97, 0.92, alpha);
        }
      `,
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    // Very slow rotation on Y and X — same pattern as reference
    if (groupRef.current) {
      groupRef.current.rotation.y = time * 0.005;
      groupRef.current.rotation.x = time * 0.002;
    }
  });

  return (
    <group ref={groupRef}>
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
