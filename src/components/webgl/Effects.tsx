import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const CinematicPass = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.85 },
    uNoise: { value: 0.015 }
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uNoise;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.8975, 397.2973));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 p = vUv - vec2(0.5);
      float vignette = smoothstep(0.86, 0.2, length(p * vec2(1.08, 0.92)));
      float grain = hash(vUv * vec2(1280.0, 720.0) + uTime) - 0.5;
      color.rgb *= mix(1.0 - uVignette, 1.0, vignette);
      color.rgb += grain * uNoise;
      gl_FragColor = color;
    }
  `
};

export function Effects() {
  const { gl, scene, camera, size } = useThree();
  const [bloomReady, setBloomReady] = useState(false);
  const composer = useMemo(() => {
    const effectComposer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0, 0.6, 0.18);
    const cinematicPass = new ShaderPass(CinematicPass);
    const outputPass = new OutputPass();

    effectComposer.addPass(renderPass);
    effectComposer.addPass(bloomPass);
    effectComposer.addPass(cinematicPass);
    effectComposer.addPass(outputPass);

    return { effectComposer, bloomPass, cinematicPass };
  }, [camera, gl, scene, size.height, size.width]);

  useEffect(() => {
    composer.effectComposer.setSize(size.width, size.height);
    composer.bloomPass.setSize(size.width, size.height);
  }, [composer, size.height, size.width]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const reveal = () => setBloomReady(true);

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(reveal, { timeout: 900 });
        return;
      }

      window.setTimeout(reveal, 1);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    return () => composer.effectComposer.dispose();
  }, [composer]);

  useFrame(({ clock }, delta) => {
    composer.bloomPass.strength = THREE.MathUtils.damp(composer.bloomPass.strength, bloomReady ? 0.3 : 0, 3, delta);
    composer.bloomPass.threshold = 0.55;
    composer.bloomPass.radius = 0.4;
    composer.cinematicPass.uniforms.uTime.value = clock.elapsedTime;
    composer.effectComposer.render(delta);
  }, 1);

  return null;
}
