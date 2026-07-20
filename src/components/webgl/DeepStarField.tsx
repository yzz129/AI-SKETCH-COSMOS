import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const STAR_COUNT = 8000;
const VOLUME_HALF = 50;
const STAR_Z_FAR = -55;
const STAR_Z_NEAR = -6;

function getDensity() {
  return Math.min(2.2, Math.max(0.65, window.innerWidth / 1440));
}

export function DeepStarField() {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const brightness = new Float32Array(STAR_COUNT);
    const twinklePhases = new Float32Array(STAR_COUNT);
    const twinkleSpeeds = new Float32Array(STAR_COUNT);
    const twinkleStrengths = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i += 1) {
      const i3 = i * 3;
      const depth = Math.random() ** 0.72;
      positions[i3] = (Math.random() - 0.5) * VOLUME_HALF * 2;
      positions[i3 + 1] = (Math.random() - 0.5) * VOLUME_HALF * 2;
      positions[i3 + 2] = THREE.MathUtils.lerp(STAR_Z_FAR, STAR_Z_NEAR, depth);
      sizes[i] = THREE.MathUtils.lerp(0.7, 1.8, depth) * THREE.MathUtils.randFloat(0.72, 1.22);
      brightness[i] = THREE.MathUtils.lerp(0.28, 0.9, depth);
      const brightStar = Math.random() < 0.1;
      twinklePhases[i] = Math.random() * Math.PI * 2;
      twinkleSpeeds[i] = brightStar
        ? THREE.MathUtils.randFloat(0.56, 1.02)
        : THREE.MathUtils.randFloat(0.35, 0.62);
      twinkleStrengths[i] = brightStar
        ? THREE.MathUtils.randFloat(0.34, 0.52)
        : THREE.MathUtils.randFloat(0.12, 0.28);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
    geometry.setAttribute('aTwinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
    geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('aTwinkleStrength', new THREE.BufferAttribute(twinkleStrengths, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform float uPixelRatio;
        uniform float uTime;
        attribute float aSize;
        attribute float aBrightness;
        attribute float aTwinklePhase;
        attribute float aTwinkleSpeed;
        attribute float aTwinkleStrength;
        varying float vDepth;
        varying float vBrightness;
        varying float vTwinkle;

        void main() {
          float nearFactor = smoothstep(${STAR_Z_FAR.toFixed(1)}, ${STAR_Z_NEAR.toFixed(1)}, position.z);
          float driftAmount = mix(0.08, 0.58, nearFactor);
          vec3 driftedPosition = position;
          driftedPosition.x += sin(uTime * 0.035 + position.z * 0.11) * driftAmount;
          driftedPosition.y += cos(uTime * 0.027 + position.z * 0.08) * driftAmount * 0.62;
          vec4 mvPosition = modelViewMatrix * vec4(driftedPosition, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * 12.0 * uPixelRatio / max(-mvPosition.z, 0.01), 0.65, 3.2);
          vDepth = -mvPosition.z;
          vBrightness = aBrightness;
          float wave = 0.5 + 0.5 * sin(uTime * aTwinkleSpeed + aTwinklePhase);
          vTwinkle = 1.0 - aTwinkleStrength + wave * aTwinkleStrength;
        }
      `,
      fragmentShader: `
        varying float vDepth;
        varying float vBrightness;
        varying float vTwinkle;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = exp(-d * d * 8.0) * vBrightness * vTwinkle;
          if (alpha < 0.008) discard;
          vec3 color = mix(vec3(0.58, 0.7, 1.0), vec3(1.0, 0.97, 0.92), vBrightness);
          gl_FragColor = vec4(color * mix(0.9, 1.08, vTwinkle), alpha);
        }
      `,
    });

    return { geometry, material };
  }, []);

  // Boost point-size on large screens to maintain perceived density
  useFrame(({ clock }) => {
    if (pointsRef.current) {
      const density = getDensity();
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2) * density;
      material.uniforms.uTime.value = clock.elapsedTime;
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
