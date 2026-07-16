import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const FOREGROUND_DUST = {
  count: 72,
  boundsX: 9,
  boundsY: 5,
  minZ: 0.8,
  maxZ: 2.5
} as const;

export function ForegroundDust() {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(FOREGROUND_DUST.count * 3);
    const colors = new Float32Array(FOREGROUND_DUST.count * 3);
    const sizes = new Float32Array(FOREGROUND_DUST.count);
    const alphas = new Float32Array(FOREGROUND_DUST.count);
    const twinkleSpeeds = new Float32Array(FOREGROUND_DUST.count);
    const phases = new Float32Array(FOREGROUND_DUST.count);
    const columns = Math.ceil(Math.sqrt(FOREGROUND_DUST.count * (FOREGROUND_DUST.boundsX / FOREGROUND_DUST.boundsY)));
    const rows = Math.ceil(FOREGROUND_DUST.count / columns);
    const cellWidth = (FOREGROUND_DUST.boundsX * 2) / columns;
    const cellHeight = (FOREGROUND_DUST.boundsY * 2) / rows;

    for (let i = 0; i < FOREGROUND_DUST.count; i += 1) {
      const i3 = i * 3;
      const column = i % columns;
      const row = Math.floor(i / columns);
      const tint = Math.random();
      const largeDust = Math.random() > 0.82;

      positions[i3] = -FOREGROUND_DUST.boundsX + (column + Math.random()) * cellWidth;
      positions[i3 + 1] = -FOREGROUND_DUST.boundsY + (row + Math.random()) * cellHeight;
      positions[i3 + 2] = THREE.MathUtils.lerp(FOREGROUND_DUST.minZ, FOREGROUND_DUST.maxZ, Math.random());
      colors[i3] = THREE.MathUtils.lerp(0.72, 0.96, tint);
      colors[i3 + 1] = THREE.MathUtils.lerp(0.84, 1, tint);
      colors[i3 + 2] = 1;
      sizes[i] = largeDust
        ? THREE.MathUtils.randFloat(0.08, 0.12)
        : THREE.MathUtils.randFloat(0.035, 0.06);
      alphas[i] = largeDust
        ? THREE.MathUtils.randFloat(0.045, 0.08)
        : THREE.MathUtils.randFloat(0.055, 0.12);
      twinkleSpeeds[i] = THREE.MathUtils.randFloat(0.45, 1.2);
      phases[i] = Math.random() * Math.PI * 2;
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bufferGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    bufferGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    bufferGeometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    return bufferGeometry;
  }, []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 color;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aTwinkleSpeed;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.05 + aPhase) * 0.08;
        p.y += sin(uTime * 0.16 + aPhase) * 0.018;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float twinkle = 0.65 + 0.35 * sin(uTime * aTwinkleSpeed + aPhase);
        gl_PointSize = aSize * (0.82 + 0.22 * twinkle) * 420.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));
        vColor = color;
        vAlpha = aAlpha * twinkle;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(center)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  }), []);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      raycast={() => null}
      renderOrder={12}
      frustumCulled={false}
    />
  );
}
