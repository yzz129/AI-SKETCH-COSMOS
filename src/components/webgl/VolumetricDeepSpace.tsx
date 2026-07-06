import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

const CLOUD_SPRITES = 4000;

const RIVER_ANCHORS = [
  new THREE.Vector3(-5.8, -2.35, -8.4),
  new THREE.Vector3(-3.1, -1.12, -6.4),
  new THREE.Vector3(-0.45, 0.05, -5.2),
  new THREE.Vector3(2.6, 0.9, -6.4),
  new THREE.Vector3(5.6, 2.25, -8.6)
];

const EDGE_CLOUDS = [
  { center: new THREE.Vector3(-4.9, -2.7, -4.8), spread: new THREE.Vector3(2.8, 1.25, 1.4), color: '#020611' },
  { center: new THREE.Vector3(4.3, -2.25, -4.5), spread: new THREE.Vector3(2.65, 1.8, 1.5), color: '#120b2f' },
  { center: new THREE.Vector3(5.35, 0.35, -5.8), spread: new THREE.Vector3(1.1, 3.5, 1.8), color: '#1b0a33' },
  { center: new THREE.Vector3(0.2, -3.35, -5.2), spread: new THREE.Vector3(4.8, 0.85, 1.6), color: '#061022' }
];

function seededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function sampleRiver(random: () => number) {
  const segment = Math.min(RIVER_ANCHORS.length - 2, Math.floor(random() * (RIVER_ANCHORS.length - 1)));
  const a = RIVER_ANCHORS[segment];
  const b = RIVER_ANCHORS[segment + 1];
  const t = random();
  const center = a.clone().lerp(b, t);
  const tangent = b.clone().sub(a).normalize();
  const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  const width = Math.sin((segment + t) / (RIVER_ANCHORS.length - 1) * Math.PI) * 1.1 + 0.32;
  const side = THREE.MathUtils.lerp(-width, width, random()) * Math.pow(random(), 0.58);
  const depth = THREE.MathUtils.randFloatSpread(1.8);

  return center
    .addScaledVector(normal, side)
    .addScaledVector(binormal, depth)
    .addScaledVector(tangent, THREE.MathUtils.randFloatSpread(0.28));
}

export function VolumetricDeepSpace() {
  const { geometry, material } = useMemo(() => {
    const random = seededRandom(99012026);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(CLOUD_SPRITES * 3);
    const colors = new Float32Array(CLOUD_SPRITES * 3);
    const sizes = new Float32Array(CLOUD_SPRITES);
    const alphas = new Float32Array(CLOUD_SPRITES);
    const phases = new Float32Array(CLOUD_SPRITES);
    const palette = [
      new THREE.Color('#0b4d8f'),
      new THREE.Color('#1e7ce6'),
      new THREE.Color('#4b3acf'),
      new THREE.Color('#7b4dff'),
      new THREE.Color('#d76bff')
    ];

    for (let i = 0; i < CLOUD_SPRITES; i += 1) {
      const i3 = i * 3;
      const useEdgeCloud = random() < 0.42;
      let position: THREE.Vector3;
      let color: THREE.Color;

      if (useEdgeCloud) {
        const cloud = EDGE_CLOUDS[Math.floor(random() * EDGE_CLOUDS.length)];
        position = new THREE.Vector3(
          cloud.center.x + THREE.MathUtils.randFloatSpread(cloud.spread.x) * Math.pow(random(), 0.42),
          cloud.center.y + THREE.MathUtils.randFloatSpread(cloud.spread.y) * Math.pow(random(), 0.42),
          cloud.center.z + THREE.MathUtils.randFloatSpread(cloud.spread.z)
        );
        color = new THREE.Color(cloud.color).lerp(new THREE.Color('#4b3acf'), random() * 0.16);
        alphas[i] = THREE.MathUtils.lerp(0.08, 0.22, random());
        sizes[i] = THREE.MathUtils.lerp(0.34, 1.45, random() ** 0.62);
      } else {
        position = sampleRiver(random);
        color = palette[Math.floor(random() * palette.length)].clone().lerp(new THREE.Color('#f7f3ff'), random() * 0.08);
        alphas[i] = THREE.MathUtils.lerp(0.045, 0.16, random());
        sizes[i] = THREE.MathUtils.lerp(0.24, 1.05, random() ** 0.72);
      }

      positions[i3] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      phases[i] = random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
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
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;

        void main() {
          vec3 p = position;
          p.xy += vec2(
            sin(uTime * 0.018 + aPhase),
            cos(uTime * 0.015 + aPhase * 1.17)
          ) * 0.075;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * 620.0 * uPixelRatio / max(-mvPosition.z, 0.01);
          vColor = color;
          vAlpha = aAlpha;
          vPhase = aPhase;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;

        float hash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i + vPhase);
          float b = hash(i + vec2(1.0, 0.0) + vPhase);
          float c = hash(i + vec2(0.0, 1.0) + vPhase);
          float d = hash(i + vec2(1.0, 1.0) + vPhase);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float feather = smoothstep(0.5, 0.02, d);
          float hollow = smoothstep(0.0, 0.24, d);
          float n = noise(gl_PointCoord * 4.5 + uTime * 0.018);
          float cloud = smoothstep(0.18, 0.92, n) * feather * hollow;
          gl_FragColor = vec4(vColor, cloud * vAlpha);
        }
      `
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return <points geometry={geometry} material={material} renderOrder={2} frustumCulled={false} raycast={() => null} />;
}
