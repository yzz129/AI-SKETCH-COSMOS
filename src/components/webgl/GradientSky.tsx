import { useMemo } from 'react';
import * as THREE from 'three';

export function GradientSky() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uEdge: { value: new THREE.Color('#020611') },
      uDeep: { value: new THREE.Color('#050816') },
      uViolet: { value: new THREE.Color('#1d1a5c') },
      uCore: { value: new THREE.Color('#3a2a8c') },
      uBlue: { value: new THREE.Color('#0b4d8f') },
      uCyan: { value: new THREE.Color('#1ccfff') }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = normalize(world.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uEdge;
      uniform vec3 uDeep;
      uniform vec3 uViolet;
      uniform vec3 uCore;
      uniform vec3 uBlue;
      uniform vec3 uCyan;
      varying vec3 vWorld;

      void main() {
        float h = vWorld.y * 0.5 + 0.5;
        vec2 p = vWorld.xy;
        float center = smoothstep(1.05, 0.02, length(p * vec2(1.0, 0.78)));
        vec3 color = mix(uEdge, uDeep, smoothstep(0.0, 0.62, h));
        color = mix(color, uViolet, center * 0.54);
        color = mix(color, uCore, smoothstep(0.72, 0.05, length((p - vec2(-0.08, -0.02)) * vec2(1.3, 1.0))) * 0.42);

        float leftUpperGlow = smoothstep(0.58, 0.02, length((p - vec2(-0.48, 0.34)) * vec2(1.1, 0.9)));
        float rightLowerGlow = smoothstep(0.54, 0.02, length((p - vec2(0.42, -0.32)) * vec2(1.2, 0.86)));
        float blueChannel = smoothstep(0.42, 0.0, abs(p.y - p.x * 0.44 - 0.03));
        float coreShade = smoothstep(0.84, 0.18, length(p));
        float edgeVignette = smoothstep(1.15, 0.28, length(p * vec2(1.08, 0.92)));

        color += uCore * leftUpperGlow * 0.2;
        color += uBlue * rightLowerGlow * 0.22;
        color += uCyan * blueChannel * 0.08;
        color *= 0.36 + coreShade * 0.58;
        color *= 0.32 + edgeVignette * 0.76;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  }), []);

  return (
    <mesh scale={60} renderOrder={0}>
      <sphereGeometry args={[1, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
