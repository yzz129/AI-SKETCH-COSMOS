import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getDadakidoOccluders,
  MAX_DADAKIDO_OCCLUDERS
} from './dadakidoOcclusionRegistry';

const TEXTURE_URL = '/textures/nebula-reference.png';
const REFERENCE_ASPECT = 1016 / 585;
const CORE_UV = new THREE.Vector2(0.49, 0.51);
const FIXED_VIEW_TILT = THREE.MathUtils.degToRad(30);

type GalaxyParticleNebulaProps = {
  radius: number;
  count: number;
  opacity: number;
  spinSpeed: number;
  roll?: number;
  renderOrder?: number;
};

type EligiblePixel = {
  x: number;
  y: number;
  weight: number;
};

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function srgbToLinear(channel: number) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function GalaxyParticleNebula({
  radius,
  count,
  opacity,
  spinSpeed,
  roll = 0,
  renderOrder = 3
}: GalaxyParticleNebulaProps) {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useLoader(THREE.TextureLoader, TEXTURE_URL);
  const camera = useThree((state) => state.camera);
  const pixelRatio = useThree((state) => Math.min(state.gl.getPixelRatio(), 2));
  const staticTime = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('nebulaTime') === '0';
  }, []);
  const parentWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const fixedTiltQuaternion = useMemo(() => new THREE.Quaternion().setFromEuler(
    new THREE.Euler(FIXED_VIEW_TILT, 0, 0)
  ), []);
  const rollQuaternion = useMemo(() => new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    roll
  ), [roll]);
  const portalWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const portalWorldScale = useMemo(() => new THREE.Vector3(), []);
  const portalViewPosition = useMemo(() => new THREE.Vector3(), []);
  const portalScreenCenter = useMemo(() => new THREE.Vector3(), []);
  const portalRightPoint = useMemo(() => new THREE.Vector3(), []);
  const portalUpPoint = useMemo(() => new THREE.Vector3(), []);
  const occluderViewPosition = useMemo(() => new THREE.Vector3(), []);
  const occluderCenter = useMemo(() => new THREE.Vector3(), []);
  const occluderRightPoint = useMemo(() => new THREE.Vector3(), []);
  const occluderUpPoint = useMemo(() => new THREE.Vector3(), []);
  const cameraRight = useMemo(() => new THREE.Vector3(), []);
  const cameraUp = useMemo(() => new THREE.Vector3(), []);

  const geometry = useMemo(() => {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to sample nebula texture');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

    const maskWidth = Math.min(320, canvas.width);
    const maskHeight = Math.max(1, Math.round(maskWidth / REFERENCE_ASPECT));
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskContext) throw new Error('Unable to build nebula mask');
    maskContext.filter = 'blur(2.5px)';
    maskContext.drawImage(image, 0, 0, maskWidth, maskHeight);
    maskContext.filter = 'none';
    const maskPixels = maskContext.getImageData(0, 0, maskWidth, maskHeight).data;

    const eligible: EligiblePixel[] = [];
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const u = (x + 0.5) / canvas.width;
        const v = 1 - (y + 0.5) / canvas.height;
        const maskX = Math.min(maskWidth - 1, Math.floor(u * maskWidth));
        const maskY = Math.min(maskHeight - 1, Math.floor((1 - v) * maskHeight));
        const maskOffset = (maskY * maskWidth + maskX) * 4;
        const red = maskPixels[maskOffset] / 255;
        const green = maskPixels[maskOffset + 1] / 255;
        const blue = maskPixels[maskOffset + 2] / 255;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const background = blue * 0.48 + red * 0.08;
        const gasExcess = Math.max(0, luminance - background);
        const cyanExcess = Math.max(0, green - blue * 0.5);
        const warmExcess = Math.max(0, red + green * 0.5 - blue * 0.74);
        const dx = u - CORE_UV.x;
        const dy = (v - CORE_UV.y) / REFERENCE_ASPECT;
        const radialDistance = Math.sqrt(dx * dx + dy * dy) * 2;
        const coreSupport = Math.exp(-radialDistance * radialDistance * 22);
        const edgeFade = 1 - THREE.MathUtils.smoothstep(radialDistance, 0.9, 1.18);
        const weight = THREE.MathUtils.clamp(
          (gasExcess * 2.7 + Math.max(cyanExcess, warmExcess) * 0.82 + coreSupport * 0.42)
            * edgeFade,
          0,
          1
        );
        if (weight > 0.085) eligible.push({ x, y, weight });
      }
    }

    if (eligible.length === 0) throw new Error('Nebula mask produced no eligible source pixels');

    const random = createRandom(0x9e3779b9 ^ count);
    for (let index = eligible.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [eligible[index], eligible[swapIndex]] = [eligible[swapIndex], eligible[index]];
    }

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const phases = new Float32Array(count);
    const radii = new Float32Array(count);
    const heights = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const source = eligible[index % eligible.length];
      const duplicate = Math.floor(index / eligible.length);
      const jitterX = duplicate === 0 ? 0 : (random() - 0.5) * 1.4;
      const jitterY = duplicate === 0 ? 0 : (random() - 0.5) * 1.4;
      const sourceX = THREE.MathUtils.clamp(source.x + jitterX, 0, canvas.width - 1);
      const sourceY = THREE.MathUtils.clamp(source.y + jitterY, 0, canvas.height - 1);
      const pixelX = Math.round(sourceX);
      const pixelY = Math.round(sourceY);
      const pixelOffset = (pixelY * canvas.width + pixelX) * 4;
      const red = pixels[pixelOffset] / 255;
      const green = pixels[pixelOffset + 1] / 255;
      const blue = pixels[pixelOffset + 2] / 255;
      const u = (sourceX + 0.5) / canvas.width;
      const v = 1 - (sourceY + 0.5) / canvas.height;
      const dx = u - CORE_UV.x;
      const dy = (v - CORE_UV.y) / REFERENCE_ASPECT;
      const radialDistance = Math.sqrt(dx * dx + dy * dy) * 2;
      const normalizedRadius = THREE.MathUtils.clamp(radialDistance / 1.04, 0, 1);
      const theta = Math.atan2(dy, dx);
      const funnel = Math.pow(1 - normalizedRadius, 1.7) * 0.85;
      const armLift = Math.sin(theta * 3 - normalizedRadius * 15) * 0.045 * normalizedRadius;
      const thickness = (random() - 0.5) * radius * (0.035 + normalizedRadius * 0.025);
      const baseHeight = radius * (funnel + armLift) + thickness;
      const i3 = index * 3;

      positions[i3] = dx * radius * 2;
      positions[i3 + 1] = dy * radius * 2;
      positions[i3 + 2] = baseHeight;
      // Eligibility is mask-derived; RGB remains the exact selected source pixel,
      // converted to linear space for the renderer's sRGB output conversion.
      colors[i3] = srgbToLinear(red);
      colors[i3 + 1] = srgbToLinear(green);
      colors[i3 + 2] = srgbToLinear(blue);
      sizes[index] = radius * (0.0038 + source.weight * 0.007 + random() * 0.003);
      alphas[index] = opacity * (0.56 + source.weight * 0.38);
      phases[index] = random() * Math.PI * 2;
      radii[index] = normalizedRadius;
      heights[index] = baseHeight;
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    result.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    result.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    result.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    result.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    result.setAttribute('aBaseHeight', new THREE.BufferAttribute(heights, 1));
    result.setDrawRange(0, count);
    result.computeBoundingSphere();
    return result;
  }, [count, opacity, radius, texture]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpinSpeed: { value: spinSpeed },
      uPixelRatio: { value: pixelRatio },
      uFrontOccluderCount: { value: 0 },
      uFrontOccluders: {
        value: Array.from(
          { length: MAX_DADAKIDO_OCCLUDERS },
          () => new THREE.Vector4(0, 0, 0.001, 0.001)
        )
      },
      uFrontOccluderStrengths: {
        value: new Float32Array(MAX_DADAKIDO_OCCLUDERS)
      }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpinSpeed;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aRadius;
      attribute float aBaseHeight;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vFlowAngle;
      varying float vRadius;
      varying float vMagicPhase;
      varying vec2 vScreenPosition;

      void main() {
        vec3 p = position;
        float differential = mix(2.15, 0.52, smoothstep(0.0, 1.0, aRadius));
        float angle = uTime * uSpinSpeed * differential * 8.2;
        float sine = sin(angle);
        float cosine = cos(angle);
        p.xy = mat2(cosine, -sine, sine, cosine) * p.xy;

        vec2 radial = normalize(p.xy + vec2(0.0001));
        vec2 tangent = vec2(-radial.y, radial.x);
        float stream = sin(aPhase + uTime * 1.55 + aRadius * 14.0);
        float breathing = cos(aPhase * 1.31 - uTime * 0.92 + aRadius * 9.0);
        p.xy += tangent * stream * aSize * 2.8;
        p.xy += radial * breathing * aSize * 0.55;
        float gatePulse = sin(uTime * 0.58 + aRadius * 18.0 + aPhase * 0.28);
        p.xy *= 1.0 + gatePulse * 0.008 * smoothstep(0.08, 0.72, aRadius);
        p.z = aBaseHeight + sin(aPhase + uTime * 1.05 + aRadius * 10.0) * aSize * 2.2;

        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        vec4 clipPosition = projectionMatrix * viewPosition;
        gl_Position = clipPosition;
        gl_PointSize = aSize * (820.0 + (1.0 - smoothstep(0.0, 0.23, aRadius)) * 960.0)
          * uPixelRatio / max(-viewPosition.z, 0.1);
        vColor = color;
        vAlpha = aAlpha;
        vFlowAngle = atan(tangent.y, tangent.x);
        vRadius = aRadius;
        vMagicPhase = aPhase;
        vScreenPosition = clipPosition.xy / max(clipPosition.w, 0.0001);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vFlowAngle;
      varying float vRadius;
      varying float vMagicPhase;
      varying vec2 vScreenPosition;
      uniform float uFrontOccluderCount;
      uniform vec4 uFrontOccluders[${MAX_DADAKIDO_OCCLUDERS}];
      uniform float uFrontOccluderStrengths[${MAX_DADAKIDO_OCCLUDERS}];

      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float sine = sin(vFlowAngle);
        float cosine = cos(vFlowAngle);
        vec2 streakPoint = mat2(cosine, sine, -sine, cosine) * point;
        streakPoint.x *= 0.52;
        float distanceToCenter = length(streakPoint);
        float alpha = (1.0 - smoothstep(0.12, 0.5, distanceToCenter)) * vAlpha;

        float portalCore = 1.0 - smoothstep(0.075, 0.135, vRadius);
        float thresholdRing = smoothstep(0.09, 0.14, vRadius)
          * (1.0 - smoothstep(0.205, 0.265, vRadius));
        float middleRing = smoothstep(0.29, 0.35, vRadius)
          * (1.0 - smoothstep(0.43, 0.51, vRadius));
        float outerVeil = smoothstep(0.56, 0.64, vRadius)
          * (1.0 - smoothstep(0.82, 0.96, vRadius));
        float angularWave = 0.5 + 0.5 * sin(
          vFlowAngle * 7.0 - uTime * 0.72 + vRadius * 38.0 + vMagicPhase * 0.18
        );
        float magicArc = pow(angularWave, 5.0);
        float slowPulse = 0.72 + 0.28 * sin(uTime * 0.48 + vRadius * 11.0 + vMagicPhase * 0.12);
        float runeGlow = magicArc * (thresholdRing + middleRing * 0.7 + outerVeil * 0.32);

        vec3 deepGateway = vec3(0.008, 0.004, 0.035);
        vec3 violetEnergy = vec3(0.43, 0.18, 0.98);
        vec3 cyanEnergy = vec3(0.08, 0.88, 1.0);
        vec3 roseEnergy = vec3(0.9, 0.18, 0.92);
        float paletteFlow = 0.5 + 0.5 * sin(vFlowAngle * 2.0 + vRadius * 15.0 - uTime * 0.25);
        vec3 magicEnergy = mix(violetEnergy, cyanEnergy, paletteFlow);
        magicEnergy = mix(magicEnergy, roseEnergy, magicArc * outerVeil * 0.42);

        vec3 portalColor = mix(vColor, magicEnergy, 0.24 + thresholdRing * 0.52);
        portalColor += magicEnergy * runeGlow * (0.32 + slowPulse * 0.38);
        portalColor = mix(portalColor, deepGateway, portalCore * 0.96);
        portalColor += violetEnergy * thresholdRing * slowPulse * 0.24;

        float softPoint = 1.0 - smoothstep(0.14, 0.5, length(point));
        alpha = max(alpha, portalCore * softPoint * 0.96);
        alpha = max(alpha, thresholdRing * softPoint * (0.72 + slowPulse * 0.24));
        alpha += runeGlow * softPoint * 0.2;
        float foregroundMask = 0.0;
        for (int i = 0; i < ${MAX_DADAKIDO_OCCLUDERS}; i += 1) {
          if (float(i) >= uFrontOccluderCount) break;
          vec4 occluder = uFrontOccluders[i];
          vec2 relative = (vScreenPosition - occluder.xy) / max(occluder.zw, vec2(0.001));
          float silhouette = 1.0 - smoothstep(0.52, 1.0, dot(relative, relative));
          foregroundMask = max(
            foregroundMask,
            silhouette * uFrontOccluderStrengths[i]
          );
        }
        alpha *= 1.0 - foregroundMask;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(portalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    blending: THREE.NormalBlending,
    toneMapped: false
  }), [pixelRatio, spinSpeed]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = staticTime ? 0 : clock.elapsedTime;
    const group = groupRef.current;
    if (!group) return;
    if (group.parent) group.parent.getWorldQuaternion(parentWorldQuaternion);
    else parentWorldQuaternion.identity();
    group.quaternion
      .copy(parentWorldQuaternion)
      .invert()
      .multiply(camera.quaternion)
      .multiply(fixedTiltQuaternion)
      .multiply(rollQuaternion);

    group.getWorldPosition(portalWorldPosition);
    group.getWorldScale(portalWorldScale);
    portalViewPosition.copy(portalWorldPosition).applyMatrix4(camera.matrixWorldInverse);
    const portalDepth = -portalViewPosition.z;
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    portalScreenCenter.copy(portalWorldPosition).project(camera);
    const portalRadiusScale = Math.max(
      Math.abs(portalWorldScale.x),
      Math.abs(portalWorldScale.y),
      Math.abs(portalWorldScale.z)
    );
    portalRightPoint.copy(portalWorldPosition)
      .addScaledVector(cameraRight, radius * REFERENCE_ASPECT * portalRadiusScale)
      .project(camera);
    portalUpPoint.copy(portalWorldPosition)
      .addScaledVector(cameraUp, radius * portalRadiusScale)
      .project(camera);
    const portalRadiusX = Math.abs(portalRightPoint.x - portalScreenCenter.x);
    const portalRadiusY = Math.abs(portalUpPoint.y - portalScreenCenter.y);
    const projectedOccluders = material.uniforms.uFrontOccluders.value as THREE.Vector4[];
    const projectedStrengths = material.uniforms.uFrontOccluderStrengths.value as Float32Array;
    let occluderCount = 0;
    for (const occluder of getDadakidoOccluders()) {
      if (occluderCount >= MAX_DADAKIDO_OCCLUDERS) break;
      occluderViewPosition.copy(occluder.position).applyMatrix4(camera.matrixWorldInverse);
      const occluderDepth = -occluderViewPosition.z;
      if (occluderDepth >= portalDepth - 0.05) continue;
      occluderCenter.copy(occluder.position).project(camera);
      if (occluderCenter.z < -1 || occluderCenter.z > 1) continue;
      occluderRightPoint.copy(occluder.position)
        .addScaledVector(cameraRight, occluder.radiusX)
        .project(camera);
      occluderUpPoint.copy(occluder.position)
        .addScaledVector(cameraUp, occluder.radiusY)
        .project(camera);
      const radiusX = Math.abs(occluderRightPoint.x - occluderCenter.x);
      const radiusY = Math.abs(occluderUpPoint.y - occluderCenter.y);
      if (radiusX < 0.001 || radiusY < 0.001) continue;
      if (
        Math.abs(occluderCenter.x - portalScreenCenter.x) > portalRadiusX + radiusX
        || Math.abs(occluderCenter.y - portalScreenCenter.y) > portalRadiusY + radiusY
      ) continue;
      projectedOccluders[occluderCount].set(
        occluderCenter.x,
        occluderCenter.y,
        radiusX,
        radiusY
      );
      projectedStrengths[occluderCount] = occluder.visibility;
      occluderCount += 1;
    }
    projectedStrengths.fill(0, occluderCount);
    material.uniforms.uFrontOccluderCount.value = occluderCount;
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <group ref={groupRef}>
      <points
        geometry={geometry}
        material={material}
        renderOrder={renderOrder}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

useLoader.preload(THREE.TextureLoader, TEXTURE_URL);
