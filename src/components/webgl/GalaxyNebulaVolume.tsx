import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

type GalaxyNebulaVolumeProps = {
  radius: number;
  opacity: number;
  staticTime: boolean;
  renderOrder: number;
};

const PARTICLE_COUNT = 1800;
const TAU = Math.PI * 2;

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function GalaxyNebulaVolume({
  radius,
  opacity,
  staticTime,
  renderOrder
}: GalaxyNebulaVolumeProps) {
  const pixelRatio = useThree((state) => Math.min(state.gl.getPixelRatio(), 2));
  const geometry = useMemo(() => {
    const random = createRandom(0x6a09e667);
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);
    const distances = new Float32Array(PARTICLE_COUNT);
    const cyan = new THREE.Color('#4ab7d1');
    const violet = new THREE.Color('#7650bd');
    const blue = new THREE.Color('#244f9d');

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const i3 = index * 3;
      const angle = random() * TAU;
      const distance = 0.43 + Math.pow(random(), 0.72) * 0.78;
      const spiralJitter = (random() - 0.5) * 0.38;
      const depthShape = Math.sqrt(Math.max(0, 1 - Math.min(distance, 1) ** 2));
      const depth = (random() - 0.5) * (0.34 + depthShape * 0.62);
      const x = Math.cos(angle + distance * 1.8 + spiralJitter) * distance;
      const y = Math.sin(angle + distance * 1.8 + spiralJitter) * distance / 1.62;
      const color = blue.clone().lerp(violet, random() * 0.72);
      color.lerp(cyan, Math.max(0, Math.sin(angle * 1.7 + distance * 3.2)) * 0.38);

      positions[i3] = x * radius;
      positions[i3 + 1] = y * radius;
      positions[i3 + 2] = depth * radius;
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[index] = radius * (0.018 + random() * 0.052);
      alphas[index] = opacity * (0.11 + random() * 0.25) * smoothShell(distance);
      phases[index] = random() * TAU;
      distances[index] = distance;
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    result.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    result.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    result.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    result.setAttribute('aDistance', new THREE.BufferAttribute(distances, 1));
    result.computeBoundingSphere();
    return result;
  }, [opacity, radius]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aDistance;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float rotation = uTime * (0.012 + aDistance * 0.009);
        float sine = sin(rotation);
        float cosine = cos(rotation);
        p.xy = mat2(cosine, -sine, sine, cosine) * p.xy;
        p.xy += vec2(
          sin(uTime * 0.045 + aPhase + position.z * 0.8),
          cos(uTime * 0.038 + aPhase + position.x * 0.55)
        ) * aSize * 0.75;
        p.z += sin(uTime * 0.031 + aPhase) * aSize * 1.8;

        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = aSize * 560.0 * uPixelRatio / max(-viewPosition.z, 0.1);
        vColor = color;
        vAlpha = aAlpha * (0.82 + 0.18 * sin(uTime * 0.12 + aPhase));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(point);
        float cloud = exp(-distanceFromCenter * distanceFromCenter * 8.5);
        cloud *= 1.0 - smoothstep(0.38, 0.5, distanceFromCenter);
        float core = exp(-distanceFromCenter * distanceFromCenter * 34.0) * 0.12;
        float alpha = (cloud * 0.82 + core) * vAlpha;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    blending: THREE.NormalBlending,
    toneMapped: false
  }), [pixelRatio]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = staticTime ? 0 : clock.elapsedTime;
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}

function smoothShell(distance: number) {
  const inner = THREE.MathUtils.smoothstep(distance, 0.38, 0.63);
  const outer = 1 - THREE.MathUtils.smoothstep(distance, 0.92, 1.24);
  return inner * outer;
}
