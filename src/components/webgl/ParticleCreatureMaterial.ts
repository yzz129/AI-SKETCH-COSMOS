import * as THREE from 'three';

export function createParticleCreatureMaterial({ outline = false }: { outline?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uOutline: { value: outline ? 1 : 0 },
      uFlowAmount: { value: outline ? 0.42 : 0.92 },
      uBreathAmount: { value: 0.04 },
      uDepthAmount: { value: 1.55 },
      uInteractionPulse: { value: 0 },
      uGlow: { value: 0.68 },
      uEdgeGlow: { value: 0.72 },
      uParticleSpread: { value: 0.5 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOutline;
      uniform float uFlowAmount;
      uniform float uBreathAmount;
      uniform float uDepthAmount;
      uniform float uInteractionPulse;
      uniform float uGlow;
      uniform float uEdgeGlow;
      uniform float uParticleSpread;
      attribute vec3 color;
      attribute vec3 aBasePosition;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aFlowStrength;
      attribute float aEdgeFactor;
      attribute float aBrightness;
      attribute float aDepthFactor;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vDepthFactor;

      void main() {
        float flow = sin(uTime * 1.45 + aPhase + aBasePosition.y * 5.2);
        float flow2 = cos(uTime * 1.2 + aPhase + aBasePosition.x * 4.4);
        float depthFlow = sin(uTime * 1.25 + aPhase + aBrightness * 2.4 + aBasePosition.x * 2.0);
        vec2 swirlDirection = normalize(vec2(-aBasePosition.y, aBasePosition.x) + vec2(0.001));
        float swirl = sin(uTime * 1.2 + aPhase + length(aBasePosition.xy) * 6.0);
        float edgeStability = mix(1.0, 0.28, aEdgeFactor);
        float outlineStability = mix(1.0, 0.24, uOutline);
        vec3 offset = vec3(
          flow * 0.014 + swirlDirection.x * swirl * 0.022 * (1.0 - aEdgeFactor),
          flow2 * 0.013 + swirlDirection.y * swirl * 0.022 * (1.0 - aEdgeFactor),
          depthFlow * mix(0.026, 0.052, uParticleSpread) * uDepthAmount
        ) * aFlowStrength * uFlowAmount * edgeStability * outlineStability;
        float breath = 1.0 + sin(uTime * 0.95 + aPhase * 0.2) * uBreathAmount;
        float morph = sin(uTime * 0.72 + aPhase + aBasePosition.x * 2.0) * uBreathAmount * 0.65;
        vec3 p = aBasePosition * vec3(breath + morph * (1.0 - aEdgeFactor), breath - morph * 0.55 * (1.0 - aEdgeFactor), 1.0 + morph * 0.9);

        p += offset;
        p += normalize(vec3(aBasePosition.xy, aBasePosition.z * 1.25) + vec3(0.001)) * uParticleSpread * 0.025 * (1.0 - aEdgeFactor);
        vec3 pulseDirection = normalize(vec3(aBasePosition.xy, aBasePosition.z * 1.6) + vec3(0.001));
        p += pulseDirection * uInteractionPulse * mix(0.012, 0.048, 1.0 - aEdgeFactor);

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float depthSize = mix(0.92, 1.42, aDepthFactor);
        gl_PointSize = aSize * depthSize * mix(1.26, 1.36, uOutline) * (1.0 + uInteractionPulse * 0.18) * uPixelRatio;
        float depthLight = mix(0.82, 1.02, aDepthFactor);
        vColor = min(color * depthLight * (1.0 + uInteractionPulse * 0.08), vec3(1.0));
        vAlpha = aAlpha * mix(0.74, 1.0, aDepthFactor) * mix(0.92, 1.02, aEdgeFactor) * (1.0 + uInteractionPulse * 0.08);
        vEdgeFactor = aEdgeFactor;
        vDepthFactor = aDepthFactor;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vDepthFactor;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.5) discard;

        float core = smoothstep(0.5, mix(0.26, 0.2, vEdgeFactor), d);
        float feather = smoothstep(0.5, 0.4, d) * mix(0.18, 0.1, vEdgeFactor);
        float alpha = clamp(core + feather, 0.0, 1.0) * vAlpha;
        vec3 depthTint = mix(vec3(0.82, 0.84, 0.92), vec3(1.0), vDepthFactor);
        gl_FragColor = vec4(vColor * depthTint, alpha);
      }
    `
  });
}
