import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSketchStore } from '../../stores/useSketchStore';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const CollapsePass = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uCollapse: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uShock: { value: 0 }
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
    uniform float uCollapse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform float uShock;
    varying vec2 vUv;

    void main() {
      vec2 fromCenter = vUv - uCenter;
      vec2 metric = vec2(fromCenter.x * uAspect, fromCenter.y);
      float dist = length(metric);
      vec2 pullDir = normalize(-fromCenter + vec2(0.0001));
      vec2 tangent = vec2(-pullDir.y, pullDir.x);
      float well = smoothstep(0.62, 0.02, dist);
      float eventHorizon = smoothstep(0.14, 0.0, dist);
      float pulse = 0.82 + 0.18 * sin(uTime * 8.0 + dist * 24.0);
      float pull = uCollapse * pulse * (0.014 + well * 0.07) / (dist + 0.22);
      float swirl = uCollapse * well * sin(uTime * 3.4 + dist * 11.0) * 0.018;
      float shock = exp(-abs(dist - uShock * 0.72) * 24.0) * uCollapse;
      vec2 uv = clamp(
        vUv + pullDir * pull + tangent * swirl + pullDir * shock * 0.006,
        vec2(0.001),
        vec2(0.999)
      );
      float chroma = uCollapse * (0.0018 + well * 0.0032);
      vec4 color = texture2D(tDiffuse, uv);
      color.r = texture2D(tDiffuse, clamp(uv + pullDir * chroma, vec2(0.001), vec2(0.999))).r;
      color.b = texture2D(tDiffuse, clamp(uv - pullDir * chroma, vec2(0.001), vec2(0.999))).b;
      color.rgb *= 1.0 - well * uCollapse * 0.18;
      color.rgb *= 1.0 - eventHorizon * uCollapse * 0.38;
      color.rgb += vec3(0.28, 0.5, 1.0) * shock * 0.14;
      color.rgb += vec3(0.75, 0.42, 1.0) * well * uCollapse * 0.025;
      gl_FragColor = color;
    }
  `
};

export function Effects() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const effectComposer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const collapsePass = new ShaderPass(CollapsePass);
    const outputPass = new OutputPass();

    effectComposer.setPixelRatio(Math.min(gl.getPixelRatio(), 2));

    effectComposer.addPass(renderPass);
    effectComposer.addPass(collapsePass);
    effectComposer.addPass(outputPass);

    return { effectComposer, collapsePass };
  }, [camera, gl, scene]);
  const collapseStrength = useRef(0);

  useEffect(() => {
    composer.effectComposer.setPixelRatio(Math.min(gl.getPixelRatio(), 2));
    composer.effectComposer.setSize(size.width, size.height);
    composer.collapsePass.uniforms.uAspect.value = size.width / Math.max(size.height, 1);
  }, [composer, gl, size.height, size.width]);

  useEffect(() => {
    return () => composer.effectComposer.dispose();
  }, [composer]);

  useFrame(({ clock }, delta) => {
    const state = useSketchStore.getState();
    const collapse = state.collapse;
    const now = Date.now();
    const hasReleased = collapse.releasedAt > 0;
    const heldSeconds = collapse.active
      ? Math.max(0, (now - collapse.startedAt) / 1000)
      : collapse.holdDuration / 1000;
    const releaseDuration = THREE.MathUtils.clamp(0.36 + heldSeconds * 0.56, 0.38, 1.95);
    const releasedSeconds = hasReleased
      ? Math.max(0, (now - collapse.releasedAt) / 1000)
      : 0;
    const releaseFalloff = collapse.active
      ? 1
      : Math.max(0, 1 - releasedSeconds / releaseDuration) ** 2;
    const holdTarget = THREE.MathUtils.clamp(0.1 + heldSeconds * 0.22, 0, 0.52);
    const targetCollapse = collapse.active
      ? holdTarget
      : (hasReleased ? holdTarget * releaseFalloff : 0);

    collapseStrength.current = THREE.MathUtils.damp(
      collapseStrength.current,
      targetCollapse,
      collapse.active ? 7.5 : 4.8,
      delta
    );

    composer.collapsePass.uniforms.uTime.value = clock.elapsedTime;
    composer.collapsePass.uniforms.uCollapse.value = collapseStrength.current;
    composer.collapsePass.uniforms.uCenter.value.set(collapse.center[0], collapse.center[1]);
    composer.collapsePass.uniforms.uShock.value = collapse.active
      ? (clock.elapsedTime * 0.36) % 1
      : THREE.MathUtils.clamp(releasedSeconds / Math.max(releaseDuration, 0.001), 0, 1);
    // Always use the same full-resolution render pipeline. Switching between
    // direct WebGL rendering and EffectComposer leaves different viewport,
    // colour and render-target state behind and causes visible scale/brightness
    // jumps while the collapse strength crosses zero.
    composer.effectComposer.render(delta);
  }, 1);

  return null;
}
