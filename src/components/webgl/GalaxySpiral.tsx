import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

export type GalaxySpiralProps = {
  position: [number, number, number];
  scale: number;
  rotation?: [number, number, number];
  count: number;
  mistCount?: number;
  radius: number;
  coreRadius: number;
  arms: number;
  spiralTightness: number;
  stretchX?: number;
  stretchY?: number;
  colorMode?: 'hero' | 'bottom' | 'violet' | 'warm';
  opacity?: number;
};

type GalaxyLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

type Palette = {
  core: THREE.Color;
  inner: THREE.Color;
  mid: THREE.Color;
  outer: THREE.Color;
  accent: THREE.Color;
};

function getPalette(mode: GalaxySpiralProps['colorMode']): Palette {
  if (mode === 'bottom') {
    return {
      core: new THREE.Color('#ffe8b8'),
      inner: new THREE.Color('#f2913c'),
      mid: new THREE.Color('#d76bff'),
      outer: new THREE.Color('#7b4dff'),
      accent: new THREE.Color('#b46bff')
    };
  }

  if (mode === 'warm') {
    return {
      core: new THREE.Color('#fff4d6'),
      inner: new THREE.Color('#ffdca8'),
      mid: new THREE.Color('#d76bff'),
      outer: new THREE.Color('#7b4dff'),
      accent: new THREE.Color('#f2913c')
    };
  }

  return {
    core: new THREE.Color('#fff4d6'),
    inner: new THREE.Color('#f3a6ff'),
    mid: new THREE.Color('#d76bff'),
    outer: new THREE.Color('#7b4dff'),
    accent: new THREE.Color('#64d9ff')
  };
}

function createPointMaterial({
  soft,
  sizeScale
}: {
  soft: number;
  sizeScale: number;
}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uSoft: { value: soft },
      uSizeScale: { value: sizeScale }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSizeScale;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.z += sin(uTime * 0.14 + aPhase + position.x * 1.4) * 0.018;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float pulse = 0.88 + 0.12 * sin(uTime * 0.55 + aPhase);
        gl_PointSize = aSize * uSizeScale * pulse * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * pulse;
      }
    `,
    fragmentShader: `
      uniform float uSoft;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = smoothstep(0.24, 0.0, d);
        float halo = smoothstep(0.5, 0.0, d) * 0.55;
        float alpha = mix(core + halo, smoothstep(0.5, 0.0, d) * 0.72, uSoft) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
}

function createGalaxyDiskMaterial({
  palette,
  arms,
  spiralTightness,
  opacity
}: {
  palette: Palette;
  arms: number;
  spiralTightness: number;
  opacity: number;
}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: palette.core },
      uInner: { value: palette.inner },
      uMid: { value: palette.mid },
      uOuter: { value: palette.outer },
      uAccent: { value: palette.accent },
      uArms: { value: arms },
      uTightness: { value: spiralTightness },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uCore;
      uniform vec3 uInner;
      uniform vec3 uMid;
      uniform vec3 uOuter;
      uniform vec3 uAccent;
      uniform float uArms;
      uniform float uTightness;
      uniform float uOpacity;
      varying vec2 vUv;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amp = 0.55;
        for (int i = 0; i < 5; i++) {
          value += noise(p) * amp;
          p = p * 2.04 + vec2(11.7, 3.2);
          amp *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 p = (vUv - vec2(0.5)) * vec2(2.0, 2.0);
        p.y *= 1.36;
        float r = length(p);
        if (r > 1.0) discard;

        float angle = atan(p.y, p.x);
        float spiral = angle * uArms - r * uTightness * 4.2 + uTime * 0.045;
        float armWave = 0.5 + 0.5 * cos(spiral);
        float armMask = smoothstep(0.64, 0.98, armWave);
        float n = fbm(p * 5.2 + vec2(uTime * 0.012, -uTime * 0.009));
        float dust = smoothstep(0.32, 0.86, n);
        float radialFade = smoothstep(1.0, 0.08, r);
        float core = smoothstep(0.22, 0.0, r);
        float outerDust = smoothstep(0.98, 0.18, r) * smoothstep(0.08, 0.5, r);

        vec3 armColor = mix(uInner, uMid, smoothstep(0.16, 0.58, r));
        armColor = mix(armColor, uOuter, smoothstep(0.48, 0.95, r));
        armColor = mix(armColor, uAccent, dust * smoothstep(0.3, 0.9, r) * 0.42);
        vec3 color = mix(armColor, uCore, core * 0.65);

        float alpha = (armMask * dust * 0.28 + outerDust * 0.06 + core * 0.22) * radialFade * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

function writeAttributes({
  positions,
  colors,
  sizes,
  alphas,
  phases,
  index,
  position,
  color,
  size,
  alpha
}: {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  phases: Float32Array;
  index: number;
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
  alpha: number;
}) {
  const i3 = index * 3;
  positions[i3] = position.x;
  positions[i3 + 1] = position.y;
  positions[i3 + 2] = position.z;
  colors[i3] = color.r;
  colors[i3 + 1] = color.g;
  colors[i3 + 2] = color.b;
  sizes[index] = size;
  alphas[index] = alpha;
  phases[index] = Math.random() * Math.PI * 2;
}

function spiralPosition({
  radius,
  coreRadius,
  maxRadius,
  arm,
  arms,
  spiralTightness,
  stretchX,
  stretchY,
  mist
}: {
  radius: number;
  coreRadius: number;
  maxRadius: number;
  arm: number;
  arms: number;
  spiralTightness: number;
  stretchX: number;
  stretchY: number;
  mist: boolean;
}) {
  const ratio = THREE.MathUtils.clamp(radius / maxRadius, 0, 1.35);
  const armOffset = (arm / arms) * Math.PI * 2;
  const armWidth = mist ? THREE.MathUtils.lerp(0.14, 0.36, Math.min(ratio, 1)) : THREE.MathUtils.lerp(0.028, 0.13, Math.min(ratio, 1));
  const noise = THREE.MathUtils.randFloatSpread(mist ? 0.42 + ratio * 0.2 : 0.12 + ratio * 0.1);
  const angle = radius * spiralTightness + armOffset + noise;
  const perpendicular = THREE.MathUtils.randFloatSpread(armWidth);
  const zDepth = THREE.MathUtils.randFloatSpread(mist ? 0.58 : 0.3 + ratio * 0.2);

  return new THREE.Vector3(
    Math.cos(angle) * radius * stretchX + Math.cos(angle + Math.PI * 0.5) * perpendicular,
    Math.sin(angle) * radius * stretchY + Math.sin(angle + Math.PI * 0.5) * perpendicular * 0.78,
    zDepth
  );
}

function createCoreGlow(count: number, coreRadius: number, opacity: number, palette: Palette): GalaxyLayer {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.pow(Math.random(), 1.9) * coreRadius * 1.18;
    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.68,
      THREE.MathUtils.randFloatSpread(0.18)
    );
    const color = palette.core.clone().lerp(palette.inner, Math.random() * 0.22);

    writeAttributes({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      index: i,
      position,
      color,
      size: THREE.MathUtils.randFloat(0.028, 0.064),
      alpha: opacity * THREE.MathUtils.randFloat(0.24, 0.48)
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: createPointMaterial({ soft: 0.72, sizeScale: 880 }) };
}

function createSpiralParticles(props: Required<Pick<GalaxySpiralProps, 'count' | 'radius' | 'coreRadius' | 'arms' | 'spiralTightness' | 'stretchX' | 'stretchY' | 'opacity'>> & { palette: Palette }): GalaxyLayer {
  const positions = new Float32Array(props.count * 3);
  const colors = new Float32Array(props.count * 3);
  const sizes = new Float32Array(props.count);
  const alphas = new Float32Array(props.count);
  const phases = new Float32Array(props.count);

  for (let i = 0; i < props.count; i += 1) {
    const arm = i % props.arms;
    const coreParticle = Math.random() < 0.1;
    const haloParticle = !coreParticle && Math.random() < 0.14;
    const radius = haloParticle
      ? Math.pow(Math.random(), 0.46) * props.radius * 1.22
      : coreParticle
      ? Math.pow(Math.random(), 2.2) * props.coreRadius
      : props.coreRadius + Math.pow(Math.random(), 0.55) * (props.radius - props.coreRadius);
    const ratio = THREE.MathUtils.clamp(radius / props.radius, 0, 1.25);
    const position = haloParticle
      ? spiralPosition({ ...props, maxRadius: props.radius, radius, arm, mist: true })
      : coreParticle
      ? new THREE.Vector3(
          Math.cos(Math.random() * Math.PI * 2) * radius,
          Math.sin(Math.random() * Math.PI * 2) * radius * 0.68,
          THREE.MathUtils.randFloatSpread(0.18)
        )
      : spiralPosition({ ...props, maxRadius: props.radius, radius, arm, mist: false });
    const color = props.palette.core.clone();

    if (coreParticle) {
      color.lerp(props.palette.inner, 0.18 + Math.random() * 0.22);
    } else if (haloParticle) {
      color.lerp(props.palette.outer, 0.5).lerp(props.palette.accent, Math.random() * 0.28);
    } else {
      color.lerp(props.palette.inner, 0.24 + ratio * 0.28)
        .lerp(props.palette.mid, ratio * 0.38)
        .lerp(props.palette.outer, ratio * 0.32);
      if (Math.random() > 0.58) color.lerp(props.palette.accent, 0.28);
    }

    writeAttributes({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      index: i,
      position,
      color,
      size: haloParticle
        ? THREE.MathUtils.randFloat(0.007, 0.022)
        : coreParticle
          ? THREE.MathUtils.randFloat(0.022, 0.05)
        : THREE.MathUtils.randFloat(0.011, 0.034) * (1.12 - Math.min(ratio, 1) * 0.3),
      alpha: props.opacity * (
        haloParticle
          ? THREE.MathUtils.randFloat(0.08, 0.22) * (1.12 - Math.min(ratio, 1) * 0.62)
        : coreParticle
          ? THREE.MathUtils.randFloat(0.26, 0.56)
          : THREE.MathUtils.randFloat(0.22, 0.72) * (1.08 - Math.min(ratio, 1) * 0.5)
      )
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: createPointMaterial({ soft: 0.2, sizeScale: 840 }) };
}

function createSpiralMist(props: Required<Pick<GalaxySpiralProps, 'mistCount' | 'radius' | 'coreRadius' | 'arms' | 'spiralTightness' | 'stretchX' | 'stretchY' | 'opacity'>> & { palette: Palette }): GalaxyLayer {
  const positions = new Float32Array(props.mistCount * 3);
  const colors = new Float32Array(props.mistCount * 3);
  const sizes = new Float32Array(props.mistCount);
  const alphas = new Float32Array(props.mistCount);
  const phases = new Float32Array(props.mistCount);

  for (let i = 0; i < props.mistCount; i += 1) {
    const arm = i % props.arms;
    const radius = props.coreRadius + Math.pow(Math.random(), 0.5) * props.radius;
    const ratio = THREE.MathUtils.clamp(radius / props.radius, 0, 1);
    const position = spiralPosition({ ...props, maxRadius: props.radius, radius, arm, mist: true });
    const color = props.palette.inner
      .clone()
      .lerp(props.palette.mid, ratio * 0.45)
      .lerp(props.palette.accent, Math.random() * 0.3);

    writeAttributes({
      positions,
      colors,
      sizes,
      alphas,
      phases,
      index: i,
      position,
      color,
      size: THREE.MathUtils.randFloat(0.022, 0.058) * (1.05 - ratio * 0.25),
      alpha: props.opacity * THREE.MathUtils.randFloat(0.05, 0.145) * (1.08 - ratio * 0.52)
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: createPointMaterial({ soft: 0.94, sizeScale: 760 }) };
}

export function GalaxySpiral({
  position,
  scale,
  rotation = [0, 0, 0],
  count,
  mistCount = Math.round(count * 0.22),
  radius,
  coreRadius,
  arms,
  spiralTightness,
  stretchX = 1,
  stretchY = 0.58,
  colorMode = 'hero',
  opacity = 1
}: GalaxySpiralProps) {
  const groupRef = useRef<THREE.Group>(null);
  const palette = useMemo(() => getPalette(colorMode), [colorMode]);
  const diskMaterial = useMemo(
    () => createGalaxyDiskMaterial({ palette, arms, spiralTightness, opacity: opacity * 0.82 }),
    [arms, opacity, palette, spiralTightness]
  );
  const core = useMemo(() => createCoreGlow(Math.max(260, Math.round(count * 0.05)), coreRadius, opacity * 0.78, palette), [count, coreRadius, opacity, palette]);
  const particles = useMemo(
    () =>
      createSpiralParticles({
        count,
        radius,
        coreRadius,
        arms,
        spiralTightness,
        stretchX,
        stretchY,
        opacity,
        palette
      }),
    [arms, coreRadius, count, opacity, palette, radius, spiralTightness, stretchX, stretchY]
  );
  const mist = useMemo(
    () =>
      createSpiralMist({
        mistCount,
        radius,
        coreRadius,
        arms,
        spiralTightness,
        stretchX,
        stretchY,
        opacity,
        palette
      }),
    [arms, coreRadius, mistCount, opacity, palette, radius, spiralTightness, stretchX, stretchY]
  );

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    core.material.uniforms.uTime.value = time;
    particles.material.uniforms.uTime.value = time;
    mist.material.uniforms.uTime.value = time;
    diskMaterial.uniforms.uTime.value = time;

    if (groupRef.current) {
      groupRef.current.rotation.z = rotation[2] + time * 0.008;
      groupRef.current.rotation.x = rotation[0] + Math.sin(time * 0.035 + scale) * 0.012;
      groupRef.current.rotation.y = rotation[1] + Math.cos(time * 0.03 + scale) * 0.01;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale} renderOrder={3}>
      <mesh renderOrder={3} raycast={() => null}>
        <planeGeometry args={[radius * 2.32, radius * 2.32, 1, 1]} />
        <primitive object={diskMaterial} attach="material" />
      </mesh>
      <points geometry={mist.geometry} material={mist.material} renderOrder={3} frustumCulled={false} raycast={() => null} />
      <points geometry={particles.geometry} material={particles.material} renderOrder={3} frustumCulled={false} raycast={() => null} />
      <points geometry={core.geometry} material={core.material} renderOrder={3} frustumCulled={false} raycast={() => null} />
    </group>
  );
}
