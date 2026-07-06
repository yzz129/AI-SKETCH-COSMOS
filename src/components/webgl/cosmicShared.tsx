import * as THREE from 'three';

export type ParticleData = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  distances: Float32Array;
  brightness: Float32Array;
  twinklePeriods: Float32Array;
  twinkleAmplitudes: Float32Array;
  temperatures: Float32Array;
};

export function createParticleData(count: number): ParticleData {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    phases: new Float32Array(count),
    distances: new Float32Array(count),
    brightness: new Float32Array(count),
    twinklePeriods: new Float32Array(count),
    twinkleAmplitudes: new Float32Array(count),
    temperatures: new Float32Array(count)
  };
}

export function writeParticle(
  data: ParticleData,
  index: number,
  position: THREE.Vector3,
  color: THREE.Color,
  size: number,
  phase = Math.random() * Math.PI * 2,
  physics = {
    distance: 1,
    brightness: 1,
    twinklePeriod: 2,
    twinkleAmplitude: 0.18,
    temperature: 6500
  }
) {
  const i3 = index * 3;
  data.positions[i3] = position.x;
  data.positions[i3 + 1] = position.y;
  data.positions[i3 + 2] = position.z;
  data.colors[i3] = color.r;
  data.colors[i3 + 1] = color.g;
  data.colors[i3 + 2] = color.b;
  data.sizes[index] = size;
  data.phases[index] = phase;
  data.distances[index] = physics.distance;
  data.brightness[index] = physics.brightness;
  data.twinklePeriods[index] = physics.twinklePeriod;
  data.twinkleAmplitudes[index] = physics.twinkleAmplitude;
  data.temperatures[index] = physics.temperature;
}

export function colorFromTemperature(kelvin: number) {
  const t = THREE.MathUtils.clamp((kelvin - 2800) / 8200, 0, 1);
  const warm = new THREE.Color('#ffd6a3');
  const neutral = new THREE.Color('#fff8e8');
  const blue = new THREE.Color('#9fd3ff');
  return t < 0.5
    ? warm.lerp(neutral, t / 0.5)
    : neutral.lerp(blue, (t - 0.5) / 0.5);
}

export function apparentBrightness(absoluteLuminosity: number, distance: number) {
  return THREE.MathUtils.clamp(absoluteLuminosity / (distance * distance), 0.018, 1.8);
}

export function createCosmicParticleMaterial({
  opacity,
  twinkle,
  soft,
  cloudFlow = 0
}: {
  opacity: number;
  twinkle: number;
  soft: boolean;
  cloudFlow?: number;
}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uOpacity: { value: opacity },
      uTwinkle: { value: twinkle },
      uSoft: { value: soft ? 1 : 0 },
      uCloudFlow: { value: cloudFlow }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uTwinkle;
      uniform float uSoft;
      uniform float uCloudFlow;
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      attribute float distance;
      attribute float brightness;
      attribute float twinklePeriod;
      attribute float twinkleAmplitude;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float drift = sin(uTime * 0.18 + phase + p.x * 0.12) * 0.06;
        float cloud = sin(uTime * 0.11 + phase + p.x * 0.4) * uCloudFlow;
        p.xy += vec2(drift * 0.42 + cloud * 0.52, drift + cloud * 0.28);

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float angularAttenuation = mix(1.0, 1.0 / sqrt(max(distance, 1.0)), 0.28);
        float slowPulse = sin((uTime / max(twinklePeriod, 0.1)) * 6.28318 + phase) * twinkleAmplitude;
        float quickGlimmer = sin((uTime / max(twinklePeriod * 0.37, 0.1)) * 6.28318 + phase * 2.7) * twinkleAmplitude * 0.42;
        float scintillation = max(0.08, 1.0 + slowPulse + quickGlimmer);
        gl_PointSize = size * scintillation * angularAttenuation * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01)) * mix(1.18, 1.62, uSoft);

        vColor = color;
        vAlpha = scintillation * brightness;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uSoft;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float softGlow = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.3, 0.0, d);
        float cross = smoothstep(0.03, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y));
        cross += smoothstep(0.03, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x));
        float diagonal = smoothstep(0.035, 0.0, abs(p.x + p.y)) * smoothstep(0.46, 0.0, abs(p.x - p.y));
        diagonal += smoothstep(0.035, 0.0, abs(p.x - p.y)) * smoothstep(0.46, 0.0, abs(p.x + p.y));
        float halo = smoothstep(0.5, 0.08, d) * 0.34;
        float alpha = mix(core + cross * 0.58 + diagonal * 0.22 + halo, softGlow * 0.78, uSoft);
        vec3 glint = vColor + vec3(0.28, 0.3, 0.44) * (cross + diagonal * 0.45);
        gl_FragColor = vec4(glint, alpha * uOpacity * vAlpha);
      }
    `
  });
}

export function CosmicPoints({
  data,
  material,
  pointsRef,
  renderOrder
}: {
  data: ParticleData;
  material: THREE.ShaderMaterial;
  pointsRef?: React.RefObject<THREE.Points | null>;
  renderOrder?: number;
}) {
  return (
    <points ref={pointsRef} renderOrder={renderOrder} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[data.sizes, 1]} />
        <bufferAttribute attach="attributes-phase" args={[data.phases, 1]} />
        <bufferAttribute attach="attributes-distance" args={[data.distances, 1]} />
        <bufferAttribute attach="attributes-brightness" args={[data.brightness, 1]} />
        <bufferAttribute attach="attributes-twinklePeriod" args={[data.twinklePeriods, 1]} />
        <bufferAttribute attach="attributes-twinkleAmplitude" args={[data.twinkleAmplitudes, 1]} />
        <bufferAttribute attach="attributes-temperature" args={[data.temperatures, 1]} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}
