export const referenceNebulaVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const referenceNebulaFragmentShader = /* glsl */ `
  uniform sampler2D uNebulaTexture;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uFlowStrength;
  uniform float uFlowSpeed;
  uniform float uAngularFlow;
  uniform float uCoreProtection;
  uniform float uEdgeFade;
  uniform float uOpaqueReference;
  uniform float uLayerProfile;
  uniform float uLayerOpacity;
  uniform vec3 uLayerTint;
  uniform float uFlowPhase;
  uniform vec2 uCoreUV;

  varying vec2 vUv;

  const float TAU = 6.28318530718;
  const float NEBULA_ASPECT = 1.73675;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.56;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
    for (int octave = 0; octave < 3; octave++) {
      sum += amplitude * valueNoise(p);
      p = rotation * p * 2.03 + 11.7;
      amplitude *= 0.48;
    }
    return sum;
  }

  float edgeMask(vec2 uv, float fadeWidth) {
    vec2 inner = smoothstep(vec2(0.0), vec2(fadeWidth), uv);
    vec2 outer = smoothstep(vec2(0.0), vec2(fadeWidth), vec2(1.0) - uv);
    return inner.x * inner.y * outer.x * outer.y;
  }

  vec2 rotateAroundCore(vec2 uv, float angle) {
    vec2 p = uv - uCoreUV;
    p.y *= NEBULA_ASPECT;
    float sine = sin(angle);
    float cosine = cos(angle);
    p = mat2(cosine, -sine, sine, cosine) * p;
    p.y /= NEBULA_ASPECT;
    return uCoreUV + p;
  }

  void main() {
    vec2 fromCore = vUv - uCoreUV;
    float coreDistance = length(fromCore * vec2(1.0, NEBULA_ASPECT));
    vec2 radial = normalize(fromCore + vec2(0.00001));
    vec2 tangent = vec2(-radial.y, radial.x);

    // Advect material continuously around the core. Only the compact nucleus is
    // protected; the spiral disk reaches full speed and tapers near the edge.
    float angularInnerMask = smoothstep(
      max(0.018, uCoreProtection * 0.32),
      uCoreProtection + 0.055,
      coreDistance
    );
    float farEdgeSafety = 1.0 - smoothstep(0.82, 1.08, coreDistance);
    float angularMask = angularInnerMask * farEdgeSafety;
    float angularTravel = uTime * uAngularFlow * angularMask;
    vec2 advectedUv = rotateAroundCore(vUv, -angularTravel);

    vec2 advectedFromCore = advectedUv - uCoreUV;
    vec2 advectedRadial = normalize(advectedFromCore + vec2(0.00001));
    vec2 advectedTangent = vec2(-advectedRadial.y, advectedRadial.x);

    // FBM domain warping keeps the transport gaseous instead of reading as a
    // rigidly rotating card. The oscillatory offsets remain exact at time zero.
    float phase = TAU * uTime * uFlowSpeed + uFlowPhase;
    vec2 slowDomain = vec2(
      fbm(advectedUv * 2.15 + vec2(phase * 0.035, -phase * 0.018)),
      fbm(advectedUv * 2.15 + vec2(17.3 - phase * 0.021, 5.8 + phase * 0.028))
    );
    float warpedNoise = fbm(advectedUv * 3.05 + (slowDomain - 0.5) * 0.42);
    float zeroAnchoredWave = sin(phase + warpedNoise * 1.15)
      - sin(uFlowPhase + warpedNoise * 1.15);
    float zeroAnchoredBreath = cos(phase * 0.72 + slowDomain.y)
      - cos(uFlowPhase * 0.72 + slowDomain.y);

    float coreMotionMask = 1.0 - smoothstep(0.018, uCoreProtection + 0.035, coreDistance);
    float armFlowMask = smoothstep(0.014, 0.15, coreDistance);
    float flowMask = max(coreMotionMask * 0.22, armFlowMask) * farEdgeSafety;
    vec2 flowOffset = advectedTangent * zeroAnchoredWave * uFlowStrength * flowMask;
    flowOffset += advectedRadial * zeroAnchoredBreath * uFlowStrength * 0.24 * flowMask;

    vec2 sampleUv = clamp(advectedUv + flowOffset, vec2(0.0015), vec2(0.9985));
    vec4 baseColor = texture2D(uNebulaTexture, sampleUv);
    if (uLayerProfile > 2.5 && uLayerProfile < 3.5) {
      vec2 fogSpread = advectedTangent * 0.0065 + advectedRadial * 0.0024;
      vec2 fogUvA = clamp(sampleUv + fogSpread, vec2(0.0015), vec2(0.9985));
      vec2 fogUvB = clamp(sampleUv - fogSpread, vec2(0.0015), vec2(0.9985));
      baseColor = (baseColor * 2.0
        + texture2D(uNebulaTexture, fogUvA)
        + texture2D(uNebulaTexture, fogUvB)) * 0.25;
    }

    vec3 color = baseColor.rgb;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, uSaturation);
    color = (color - 0.5) * uContrast + 0.5;
    color *= uBrightness;

    // The source is an RGB reference. Convert only its near-black space to
    // transparency so each nebula overlays the existing universe cleanly.
    float signal = max(max(baseColor.r, baseColor.g), baseColor.b);
    float textureAlpha = smoothstep(0.018, 0.155, signal);
    float gasBand = smoothstep(0.025, 0.19, signal)
      * (1.0 - smoothstep(0.58, 0.92, signal));
    float brightBand = smoothstep(0.11, 0.56, signal);
    float layerMask = textureAlpha;

    if (uLayerProfile > 3.5) {
      float hazeVariant = step(4.5, uLayerProfile);
      float hazeTime = uTime * mix(0.012, -0.008, hazeVariant);
      vec2 hazeDomain = advectedUv * mix(2.25, 1.62, hazeVariant)
        + vec2(hazeTime, -hazeTime * 0.72)
        + vec2(uFlowPhase * 0.17, -uFlowPhase * 0.11);
      float broadNoise = fbm(hazeDomain + (slowDomain - 0.5) * 0.34);
      float detailNoise = fbm(hazeDomain * 1.74 + vec2(8.1, 3.7));
      float brokenDensity = smoothstep(
        mix(0.34, 0.39, hazeVariant),
        mix(0.76, 0.71, hazeVariant),
        broadNoise * 0.72 + detailNoise * 0.28
      );
      float innerRadius = mix(0.24, 0.30, hazeVariant);
      float outerRadius = mix(0.92, 1.02, hazeVariant);
      float annulus = smoothstep(innerRadius, innerRadius + 0.19, coreDistance)
        * (1.0 - smoothstep(outerRadius - 0.24, outerRadius, coreDistance));
      float wisps = 0.60 + 0.40 * sin(
        atan(fromCore.y, fromCore.x) * mix(3.0, 2.0, hazeVariant)
          - coreDistance * mix(8.0, 5.5, hazeVariant)
          + broadNoise * 4.2
          - phase * 0.12
      );
      layerMask = brokenDensity * annulus * mix(0.58, 1.0, wisps);
      float sourceColorWeight = smoothstep(0.035, 0.30, signal) * 0.34;
      vec3 hazeColor = uLayerTint * (0.32 + broadNoise * 0.62 + signal * 0.42);
      color = mix(hazeColor, max(color, hazeColor * 0.78), sourceColorWeight);
    } else if (uLayerProfile > 2.5) {
      float outerVeil = smoothstep(0.20, 0.53, coreDistance)
        * (1.0 - smoothstep(0.88, 1.04, coreDistance));
      layerMask = gasBand * outerVeil * (0.52 + flowMask * 0.48);
    } else if (uLayerProfile > 1.5) {
      layerMask = brightBand * (0.42 + flowMask * 0.58);
    } else if (uLayerProfile > 0.5) {
      layerMask = gasBand * (0.58 + flowMask * 0.42);
    }

    float zeroAnchoredDensity = sin(phase * 0.64 + warpedNoise * 5.2)
      - sin(uFlowPhase * 0.64 + warpedNoise * 5.2);
    float spiralCoordinate = atan(fromCore.y, fromCore.x)
      - coreDistance * 13.5
      + warpedNoise * 1.8;
    float zeroAnchoredStream = sin(spiralCoordinate - phase * 0.82)
      - sin(spiralCoordinate - uFlowPhase * 0.82);
    float corePulse = (sin(phase * 0.91) - sin(uFlowPhase * 0.91)) * coreMotionMask;
    float densityMotion = clamp(
      1.0
        + (zeroAnchoredDensity * 0.18 + zeroAnchoredStream * 0.17) * flowMask
        + corePulse * 0.11,
      0.56,
      1.38
    );
    float brightnessMotion = clamp(
      1.0
        + (zeroAnchoredDensity * 0.09 + zeroAnchoredStream * 0.075) * flowMask
        + corePulse * 0.12,
      0.78,
      1.20
    );
    color *= brightnessMotion;

    float compositedAlpha = layerMask
      * edgeMask(vUv, uEdgeFade)
      * uLayerOpacity
      * densityMotion;
    float alpha = mix(compositedAlpha, 1.0, uOpaqueReference) * uOpacity;

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
  }
`;
