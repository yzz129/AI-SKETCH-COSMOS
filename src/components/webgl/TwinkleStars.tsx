import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const TWINKLE_COUNT = 1200;
const BOUNDS_X = 10.5;
const BOUNDS_Y = 6.0;
const BOUNDS_Z_MIN = -12;
const BOUNDS_Z_MAX = -3;

export function TwinkleStars() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TWINKLE_COUNT * 3);
    const colors = new Float32Array(TWINKLE_COUNT * 3);
    const sizes = new Float32Array(TWINKLE_COUNT);
    const alphas = new Float32Array(TWINKLE_COUNT);
    const phases = new Float32Array(TWINKLE_COUNT);
    const twinkleSpeeds = new Float32Array(TWINKLE_COUNT);
    const twinkleStrengths = new Float32Array(TWINKLE_COUNT);

    const aspectRatio = (BOUNDS_X * 2) / (BOUNDS_Y * 2);
    const columns = Math.ceil(Math.sqrt(TWINKLE_COUNT * aspectRatio));
    const rows = Math.ceil(TWINKLE_COUNT / columns);
    const cellWidth = (BOUNDS_X * 2) / columns;
    const cellHeight = (BOUNDS_Y * 2) / rows;
    const zRange = BOUNDS_Z_MAX - BOUNDS_Z_MIN;

    for (let i = 0; i < TWINKLE_COUNT; i += 1) {
      const i3 = i * 3;
      const column = i % columns;
      const row = Math.floor(i / columns);

      // Wider jitter for more scattered distribution
      const jitterX = (Math.random() - 0.5) * cellWidth * 1.3;
      const jitterY = (Math.random() - 0.5) * cellHeight * 1.3;
      positions[i3] = -BOUNDS_X + column * cellWidth + cellWidth * 0.5 + jitterX;
      positions[i3 + 1] = -BOUNDS_Y + row * cellHeight + cellHeight * 0.5 + jitterY;
      positions[i3 + 2] = BOUNDS_Z_MIN + Math.random() * zRange;

      // Color tinting for variety
      const tint = Math.random();
      const brightness = 0.82 + Math.random() * 0.18;

      if (tint < 0.52) {
        colors[i3] = brightness * 0.88;
        colors[i3 + 1] = brightness * 0.92;
        colors[i3 + 2] = 1.0;
      } else if (tint < 0.78) {
        colors[i3] = brightness * 0.82;
        colors[i3 + 1] = brightness * 0.86;
        colors[i3 + 2] = 1.0;
      } else if (tint < 0.92) {
        colors[i3] = brightness;
        colors[i3 + 1] = brightness * 0.78;
        colors[i3 + 2] = brightness * 0.85;
      } else {
        colors[i3] = brightness;
        colors[i3 + 1] = brightness;
        colors[i3 + 2] = brightness;
      }

      // Bigger sizes overall: shifted up from previous distribution
      const sizeRandom = Math.random();
      if (sizeRandom < 0.55) {
        sizes[i] = THREE.MathUtils.lerp(0.01, 0.024, Math.random());
      } else if (sizeRandom < 0.85) {
        sizes[i] = THREE.MathUtils.lerp(0.024, 0.045, Math.random());
      } else {
        sizes[i] = THREE.MathUtils.lerp(0.045, 0.075, Math.random());
      }

      alphas[i] = THREE.MathUtils.lerp(0.3, 0.95, Math.random() ** 0.7);
      phases[i] = Math.random() * Math.PI * 2;
      // Slower twinkle: reduced frequency range
      twinkleSpeeds[i] = THREE.MathUtils.lerp(0.2, 1.2, Math.random());
      twinkleStrengths[i] = THREE.MathUtils.lerp(0.3, 0.75, Math.random());
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('aTwinkleStrength', new THREE.BufferAttribute(twinkleStrengths, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec3 color;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aPhase;
        attribute float aTwinkleSpeed;
        attribute float aTwinkleStrength;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float nearFactor = smoothstep(${BOUNDS_Z_MIN.toFixed(1)}, ${BOUNDS_Z_MAX.toFixed(1)}, position.z);
          float parallax = mix(0.025, 0.2, nearFactor);
          vec3 driftedPosition = position;
          driftedPosition.x += sin(uTime * 0.04 + aPhase) * parallax;
          driftedPosition.y += cos(uTime * 0.032 + aPhase * 0.73) * parallax * 0.58;
          vec4 mvPosition = modelViewMatrix * vec4(driftedPosition, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          float wave = sin(uTime * aTwinkleSpeed + aPhase);
          float twinkle = 1.0 - aTwinkleStrength + aTwinkleStrength * (0.5 + 0.5 * wave);
          twinkle = 0.58 + 0.42 * twinkle;

          float finalSize = aSize * (0.88 + 0.22 * twinkle);
          gl_PointSize = finalSize * 820.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));

          vColor = color;
          vAlpha = aAlpha * twinkle;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float core = smoothstep(0.26, 0.0, d);
          float halo = smoothstep(0.5, 0.02, d) * 0.32;
          float cross = smoothstep(0.024, 0.0, abs(p.x)) * smoothstep(0.48, 0.0, abs(p.y));
          cross += smoothstep(0.024, 0.0, abs(p.y)) * smoothstep(0.48, 0.0, abs(p.x));
          float alpha = (core + halo + cross * 0.35) * vAlpha;

          if (alpha < 0.008) discard;
          gl_FragColor = vec4(vColor + cross * 0.12, alpha);
        }
      `,
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    material.uniforms.uTime.value = time;
    if (!pointsRef.current) return;

    pointsRef.current.position.x = Math.sin(time * 0.025) * 0.16;
    pointsRef.current.position.y = Math.cos(time * 0.019 + 0.7) * 0.09;
    pointsRef.current.rotation.z = Math.sin(time * 0.012) * 0.004;
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      raycast={() => null}
      renderOrder={2}
      frustumCulled={false}
    />
  );
}
