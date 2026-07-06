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
      uDepthAmount: { value: 1.35 },
      uInteractionPulse: { value: 0 },
      uBurstProgress: { value: 0 },
      uGlow: { value: 0.12 },
      uEdgeGlow: { value: 0.1 },
      uParticleSpread: { value: 0.5 },
      uPointSizeBoost: { value: 1 },
      uAlphaMultiplier: { value: 1 },
      uFocusAmount: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOutline;
      uniform float uFlowAmount;
      uniform float uBreathAmount;
      uniform float uDepthAmount;
      uniform float uInteractionPulse;
      uniform float uBurstProgress;
      uniform float uGlow;
      uniform float uEdgeGlow;
      uniform float uParticleSpread;
      uniform float uPointSizeBoost;
      uniform float uAlphaMultiplier;
      uniform float uFocusAmount;
      attribute vec3 color;
      attribute vec3 aBasePosition;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aFlowStrength;
      attribute float aEdgeFactor;
      attribute float aBrightness;
      attribute float aDepthFactor;
      attribute vec3 aNormal;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vDepthFactor;
      varying float vVolumeShade;
      varying float vBrightness;
      varying float vModelLight;
      varying float vFocusAmount;

      void main() {
        float flow = sin(uTime * 1.45 + aPhase + aBasePosition.y * 5.2);
        float flow2 = cos(uTime * 1.2 + aPhase + aBasePosition.x * 4.4);
        float depthFlow = sin(uTime * 1.25 + aPhase + aBrightness * 2.4 + aBasePosition.x * 2.0);
        float slowDepthSwell = sin(uTime * 0.55 + aPhase * 0.7 + aBasePosition.y * 2.4);
        vec2 swirlDirection = normalize(vec2(-aBasePosition.y, aBasePosition.x) + vec2(0.001));
        float swirl = sin(uTime * 1.2 + aPhase + length(aBasePosition.xy) * 6.0);
        float edgeStability = mix(1.0, 0.28, aEdgeFactor);
        float outlineStability = mix(1.0, 0.24, uOutline);
        float focusAmount = clamp(uFocusAmount, 0.0, 1.0);
        float focusFlow = mix(1.0, 0.025, focusAmount);
        float focusDepth = mix(1.0, 0.48, focusAmount);
        float focusSpread = mix(1.0, 0.24, focusAmount);
        float focusPulse = mix(1.0, 0.12, focusAmount);
        vec3 offset = vec3(
          flow * 0.014 + swirlDirection.x * swirl * 0.022 * (1.0 - aEdgeFactor),
          flow2 * 0.013 + swirlDirection.y * swirl * 0.022 * (1.0 - aEdgeFactor),
          (depthFlow * mix(0.024, 0.048, uParticleSpread) + slowDepthSwell * 0.01) * uDepthAmount
        ) * aFlowStrength * uFlowAmount * edgeStability * outlineStability * focusFlow;
        float focusedBreathAmount = uBreathAmount * mix(1.0, 0.22, focusAmount);
        float breath = 1.0 + sin(uTime * 0.95 + aPhase * 0.2) * focusedBreathAmount;
        float morph = sin(uTime * 0.72 + aPhase + aBasePosition.x * 2.0) * focusedBreathAmount * 0.65;
        vec3 p = aBasePosition * vec3(
          breath + morph * (1.0 - aEdgeFactor),
          breath - morph * 0.55 * (1.0 - aEdgeFactor),
          1.12 + morph * 0.72
        );

        p += offset;
        p.z *= focusDepth;
        vec3 volumeNormal = normalize(mix(
          normalize(vec3(aBasePosition.xy * 0.78, aBasePosition.z * 1.45) + vec3(0.001)),
          normalize(aNormal),
          0.72
        ));
        p += volumeNormal * uParticleSpread * 0.024 * (1.0 - aEdgeFactor) * focusSpread;
        vec3 pulseDirection = normalize(vec3(aBasePosition.xy, aBasePosition.z * 1.6) + vec3(0.001));
        p += pulseDirection * uInteractionPulse * mix(0.006, 0.026, 1.0 - aEdgeFactor) * focusPulse;
        vec3 burstDirection = normalize(mix(pulseDirection, volumeNormal, 0.62) + vec3(
          sin(aPhase * 2.4),
          cos(aPhase * 1.9),
          sin(aPhase * 1.3 + 0.8)
        ) * 0.12);
        float burstNoise = 0.72 + 0.5 * sin(aPhase * 4.2 + uTime * 0.8);
        p += burstDirection * uBurstProgress * mix(0.34, 0.78, 1.0 - aEdgeFactor) * burstNoise * focusPulse;
        p += vec3(
          sin(aPhase + uTime * 7.0),
          cos(aPhase * 0.9 + uTime * 6.2),
          sin(aPhase * 1.2 + uTime * 5.8)
        ) * uBurstProgress * 0.035 * focusPulse;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float depthSize = mix(0.76, 1.24, aDepthFactor);
        gl_PointSize = aSize * depthSize * mix(1.05, 1.14, uOutline) * uPointSizeBoost * (1.0 + uInteractionPulse * 0.08 + uBurstProgress * 1.2) * uPixelRatio;
        vec3 viewNormal = normalize(normalMatrix * volumeNormal);
        float sideLight = dot(viewNormal, normalize(vec3(-0.34, 0.46, 0.82))) * 0.5 + 0.5;
        float fillLight = dot(viewNormal, normalize(vec3(0.38, -0.28, 0.82))) * 0.5 + 0.5;
        float depthLight = mix(0.48, 1.0, aDepthFactor);
        vModelLight = clamp(sideLight * 0.82 + fillLight * 0.18, 0.22, 1.0);
        vVolumeShade = clamp(depthLight * mix(0.68, 1.14, vModelLight) + aEdgeFactor * 0.07, 0.28, 1.08);
        vBrightness = aBrightness;
        vColor = min(color * (0.86 + aEdgeFactor * 0.06), vec3(0.94));
        vAlpha = aAlpha * uAlphaMultiplier * mix(0.42, 0.76, aDepthFactor) * mix(0.86, 0.98, aEdgeFactor) * (1.0 + uInteractionPulse * 0.04 + uBurstProgress * 0.55);
        vEdgeFactor = aEdgeFactor;
        vDepthFactor = aDepthFactor;
        vFocusAmount = focusAmount;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vDepthFactor;
      varying float vVolumeShade;
      varying float vBrightness;
      varying float vModelLight;
      varying float vFocusAmount;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.5) discard;

        vec2 sphereUv = p * 2.0;
        float sphereZ = sqrt(max(0.0, 1.0 - dot(sphereUv, sphereUv)));
        vec3 beadNormal = normalize(vec3(sphereUv, sphereZ));
        float beadLight = dot(beadNormal, normalize(vec3(-0.38, 0.42, 0.82))) * 0.5 + 0.5;
        float crisp = smoothstep(0.1, 0.9, vFocusAmount);
        float core = smoothstep(0.5, mix(0.31, 0.24, vEdgeFactor), d);
        float feather = smoothstep(0.5, 0.43, d) * mix(0.04, 0.02, vEdgeFactor) * (1.0 - crisp * 0.78);
        float rim = smoothstep(0.36, 0.5, d) * (0.05 + vEdgeFactor * 0.055) * (1.0 - crisp * 0.36);
        float alpha = clamp(core + feather, 0.0, 1.0) * vAlpha;
        if (alpha < 0.008) discard;
        float depthBody = mix(0.58, 1.0, vDepthFactor);
        float beadShade = mix(0.66, 1.1, beadLight);
        vec3 depthTint = mix(vec3(0.66, 0.7, 0.82), vec3(0.98), vDepthFactor);
        float modelShade = mix(0.58, 1.12, vModelLight);
        vec3 shadedColor = vColor * depthTint * vVolumeShade * depthBody * beadShade * modelShade;
        shadedColor += vColor * rim * (0.1 + vEdgeFactor * 0.08);
        shadedColor *= mix(0.9, 0.78, smoothstep(0.78, 1.0, vBrightness));
        gl_FragColor = vec4(min(shadedColor, vec3(0.96)), alpha);
      }
    `
  });
}
