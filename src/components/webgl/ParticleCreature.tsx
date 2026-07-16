import { useFrame } from '@react-three/fiber';
import { MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';
import type { CreatureBehaviorSignature } from '../../utils/creatureMotion';
import type { CreaturePartActionPose } from './creaturePartActions';
import { createParticleCreatureMaterial } from './ParticleCreatureMaterial';

type ParticleCreatureProps = {
  particles: ArtworkParticle[];
  flowAmount: number;
  breathAmount?: number;
  behaviorSignature?: CreatureBehaviorSignature;
  interactionPulseRef?: MutableRefObject<number>;
  burstPhaseRef?: MutableRefObject<number>;
  reappearRef?: MutableRefObject<number>;
  spotlightFocusRef?: MutableRefObject<number>;
  renderOrderRef?: MutableRefObject<number>;
  partActionRef?: MutableRefObject<CreaturePartActionPose>;
  spotlightEnabled?: boolean;
};

type ParticleGeometryMode = 'body' | 'outline' | 'detail' | 'focus';

function updatePartActionUniforms(
  material: THREE.ShaderMaterial,
  partAction: CreaturePartActionPose | undefined
) {
  material.uniforms.uPartAction.value.set(
    partAction?.punch ?? 0,
    partAction?.bite ?? 0,
    partAction?.hit ?? 0,
    partAction?.struggle ?? 0
  );
  material.uniforms.uPartActionMeta.value.set(
    partAction?.targetSide ?? 0,
    partAction?.phase ?? 0,
    partAction?.punchSide ?? 0,
    partAction?.compression ?? 0
  );
  material.uniforms.uPartActionSecondary.value.set(
    partAction?.kick ?? 0,
    partAction?.guard ?? 0,
    partAction?.windup ?? 0,
    partAction?.curl ?? 0
  );
  material.uniforms.uKickSide.value = partAction?.kickSide ?? 0;
}

const GEOMETRY_SOURCE_BUDGET: Record<ParticleGeometryMode, number> = {
  body: 9000,
  outline: 3200,
  detail: 6000,
  focus: 18000
};

function seededNoise(seed: number) {
  const value = Math.sin(seed) * 43758.5453;
  return value - Math.floor(value);
}

function signedSeededNoise(seed: number) {
  return seededNoise(seed) * 2 - 1;
}

function limitGeometrySource(source: ArtworkParticle[], mode: ParticleGeometryMode) {
  const budget = GEOMETRY_SOURCE_BUDGET[mode];
  if (source.length <= budget) return source;

  const limited: ArtworkParticle[] = [];
  const stride = source.length / budget;

  for (let i = 0; i < budget; i += 1) {
    limited.push(source[Math.floor(i * stride)]);
  }

  return limited;
}

function createGeometry(particles: ArtworkParticle[], mode: ParticleGeometryMode = 'body') {
  const selected = mode === 'outline'
    ? particles.filter((particle) => particle.isEdge)
    : mode === 'focus'
      ? particles
      : particles;
  const source = limitGeometrySource(selected.length > 0 ? selected : particles, mode);
  const copiesPerParticle = mode === 'focus' ? 3 : mode === 'detail' ? 2 : 1;
  const count = source.length * copiesPerParticle;
  const positions = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const flowStrengths = new Float32Array(count);
  const edgeFactors = new Float32Array(count);
  const brightnesses = new Float32Array(count);
  const depthFactors = new Float32Array(count);
  const normals = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const particleIndex = Math.floor(i / copiesPerParticle);
    const copyIndex = i % copiesPerParticle;
    const particle = source[particleIndex];
    const i3 = i * 3;
    const sourceZ = particle.z ?? 0;
    const z = sourceZ * 2.25;
    const edgeFactor = particle.edgeFactor ?? (particle.isEdge ? 1 : 0);
    const phase = particle.phase ?? Math.sin((particle.x * 17.31 + particle.y * 29.77 + z * 43.13) * 11.7) * Math.PI;
    const sourceBasePosition = particle.basePosition ?? [particle.x, particle.y, sourceZ];
    const basePosition: [number, number, number] = [
      sourceBasePosition[0],
      sourceBasePosition[1],
      sourceBasePosition[2] * 2.25
    ];
    const fallbackNormal = new THREE.Vector3(
      basePosition[0] * 0.72,
      basePosition[1] * 0.82,
      basePosition[2] * 1.25 + 0.05
    ).normalize();
    const sourceNormal = particle.normal ?? fallbackNormal.toArray();
    const normal = new THREE.Vector3(...sourceNormal).normalize();
    const tangent = new THREE.Vector3(-normal.y, normal.x, 0.08).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const detailSeed = (particle.phase ?? phase) + particleIndex * 12.9898 + copyIndex * 78.233;
    const detailRadius = mode === 'detail'
      ? (particle.isEdge ? 0.0035 : 0.0065) + seededNoise(detailSeed + 3.17) * (particle.isEdge ? 0.004 : 0.007)
      : 0;
    const detailOffset = tangent.clone()
      .multiplyScalar(signedSeededNoise(detailSeed + 11.3) * detailRadius)
      .add(bitangent.clone().multiplyScalar(signedSeededNoise(detailSeed + 19.7) * detailRadius * 0.82))
      .add(normal.clone().multiplyScalar(signedSeededNoise(detailSeed + 29.1) * detailRadius * 0.46));
    const focusPosition = particle.focusPosition ?? [basePosition[0], basePosition[1], 0];
    const focusSeed = detailSeed + 91.7;
    const focusJitter = particle.isEdge ? 0.0012 : 0.002;
    const focusShell = copiesPerParticle <= 1
      ? 0
      : -1 + (copyIndex / Math.max(1, copiesPerParticle - 1)) * 2;
    const focusDepth = (particle.isEdge ? 0.07 : 0.16)
      + Math.max(0, 1 - (particle.brightness ?? 0.62)) * 0.14;
    const renderedBasePosition: [number, number, number] = mode === 'focus'
      ? [
          focusPosition[0] + signedSeededNoise(focusSeed + 2.3) * focusJitter * (particle.isEdge ? 0.6 : 1),
          focusPosition[1] + signedSeededNoise(focusSeed + 5.9) * focusJitter * (particle.isEdge ? 0.6 : 1),
          focusShell * focusDepth + signedSeededNoise(focusSeed + 8.4) * 0.006
        ]
      : mode === 'detail'
      ? [
          basePosition[0] + detailOffset.x,
          basePosition[1] + detailOffset.y,
          basePosition[2] + detailOffset.z
        ]
      : basePosition;

    positions[i3] = renderedBasePosition[0];
    positions[i3 + 1] = renderedBasePosition[1];
    positions[i3 + 2] = renderedBasePosition[2];
    basePositions[i3] = renderedBasePosition[0];
    basePositions[i3 + 1] = renderedBasePosition[1];
    basePositions[i3 + 2] = renderedBasePosition[2];
    colors[i3] = particle.r / 255;
    colors[i3 + 1] = particle.g / 255;
    colors[i3 + 2] = particle.b / 255;
    sizes[i] = mode === 'focus'
      ? (particle.size ?? (particle.isEdge ? 1.12 : 0.92)) * (particle.isEdge ? 0.68 : 0.54)
      : mode === 'detail'
      ? (particle.size ?? (particle.isEdge ? 1.15 : 1.0)) * (particle.isEdge ? 0.28 : 0.24)
      : mode === 'outline'
      ? Math.min(2.2, (particle.size ?? 1.4) * 0.58 + 0.18)
      : (particle.size ?? (particle.isEdge ? 1.45 : 1.15)) * 0.72;
    alphas[i] = mode === 'focus'
      ? Math.min(1, (particle.alpha ?? 0.9) * (particle.isEdge ? 1 : 0.9))
      : mode === 'detail'
      ? Math.min(0.46, (particle.alpha ?? 0.92) * (particle.isEdge ? 0.34 : 0.26))
      : mode === 'outline'
        ? Math.min(0.34, (particle.alpha ?? 0.9) * 0.28)
        : Math.min(0.58, (particle.alpha ?? 0.96) * 0.56);
    phases[i] = phase + copyIndex * 1.79 + seededNoise(detailSeed + 43.2) * 0.7;
    flowStrengths[i] = mode === 'focus'
      ? 0.02
      : mode === 'detail'
      ? (particle.flowStrength ?? (particle.isEdge ? 0.22 : 0.58)) * 0.34
      : mode === 'outline'
        ? 0.12
        : (particle.flowStrength ?? (particle.isEdge ? 0.28 : 0.74)) * 0.88;
    edgeFactors[i] = edgeFactor;
    brightnesses[i] = particle.brightness ?? ((particle.r + particle.g + particle.b) / 765);
    depthFactors[i] = particle.depthFactor ?? THREE.MathUtils.clamp((renderedBasePosition[2] + 0.68) / 1.42, 0, 1);
    normals[i3] = normal.x;
    normals[i3 + 1] = normal.y;
    normals[i3 + 2] = normal.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aBasePosition', new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aFlowStrength', new THREE.BufferAttribute(flowStrengths, 1));
  geometry.setAttribute('aEdgeFactor', new THREE.BufferAttribute(edgeFactors, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));
  geometry.setAttribute('aDepthFactor', new THREE.BufferAttribute(depthFactors, 1));
  geometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();

  return geometry;
}

function createFocusParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFocusAmount: { value: 0 }
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uFocusAmount;
      attribute vec3 color;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aEdgeFactor;
      attribute float aBrightness;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vBrightness;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float edgeBoost = mix(1.12, 1.48, aEdgeFactor);
        gl_PointSize = clamp(aSize * edgeBoost * uPixelRatio * 3.1, 1.6, 6.0);
        vColor = min(color * mix(0.98, 1.1, aEdgeFactor), vec3(1.0));
        vAlpha = aAlpha * smoothstep(0.03, 0.62, uFocusAmount);
        vEdgeFactor = aEdgeFactor;
        vBrightness = aBrightness;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vEdgeFactor;
      varying float vBrightness;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.47) discard;

        float core = smoothstep(0.47, mix(0.42, 0.37, vEdgeFactor), d);
        float alpha = core * vAlpha;
        vec3 color = vColor * mix(1.0, 0.86, smoothstep(0.74, 1.0, vBrightness));
        color += vColor * vEdgeFactor * 0.16;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(min(color, vec3(0.95)), alpha);
      }
    `
  });
}

export function ParticleCreature({
  particles,
  flowAmount,
  breathAmount = 0.035,
  behaviorSignature,
  interactionPulseRef,
  burstPhaseRef,
  reappearRef,
  spotlightFocusRef,
  renderOrderRef,
  partActionRef,
  spotlightEnabled = false
}: ParticleCreatureProps) {
  const bodyPointsRef = useRef<THREE.Points>(null);
  const outlinePointsRef = useRef<THREE.Points>(null);
  const detailPointsRef = useRef<THREE.Points>(null);
  const focusPointsRef = useRef<THREE.Points>(null);
  const bodyMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const outlineMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const detailMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const focusMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const bodyGeometry = useMemo(() => createGeometry(particles), [particles]);
  const outlineGeometry = useMemo(() => createGeometry(particles, 'outline'), [particles]);

  // Spotlight geometries — deferred via setTimeout to avoid blocking the render frame
  const [detailGeometry, setDetailGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (spotlightEnabled) {
      const id = setTimeout(() => {
        setDetailGeometry(createGeometry(particles, 'detail'));
        setFocusGeometry(createGeometry(particles, 'focus'));
      }, 0);
      return () => clearTimeout(id);
    }
    setDetailGeometry(null);
    setFocusGeometry(null);
  }, [spotlightEnabled, particles]);
  const bodyMaterial = useMemo(() => {
    const material = createParticleCreatureMaterial();
    bodyMaterialRef.current = material;
    return material;
  }, []);
  const outlineMaterial = useMemo(() => {
    const material = createParticleCreatureMaterial({ outline: true });
    outlineMaterialRef.current = material;
    return material;
  }, []);
  const detailMaterial = useMemo(() => {
    const material = createParticleCreatureMaterial();
    material.visible = false;
    detailMaterialRef.current = material;
    return material;
  }, []);
  const focusMaterial = useMemo(() => {
    const material = createFocusParticleMaterial();
    material.visible = false;
    focusMaterialRef.current = material;
    return material;
  }, []);

  useFrame(({ clock }) => {
    const renderOrderBase = renderOrderRef?.current ?? 10;
    if (bodyPointsRef.current) bodyPointsRef.current.renderOrder = renderOrderBase;
    if (outlinePointsRef.current) outlinePointsRef.current.renderOrder = renderOrderBase + 1;
    if (detailPointsRef.current) detailPointsRef.current.renderOrder = renderOrderBase + 2;
    if (focusPointsRef.current) focusPointsRef.current.renderOrder = renderOrderBase + 4;
    const spotlightFocus = spotlightFocusRef?.current ?? 0;
    const burstPhase = burstPhaseRef?.current ?? 1;
    const burstActive = burstPhase < 0.999;
    const burstProgress = burstActive ? THREE.MathUtils.smoothstep(burstPhase, 0, 1) : 0;
    const burstVisibility = burstActive
      ? 1 - THREE.MathUtils.smoothstep(burstPhase, 0.58, 0.96)
      : 0;
    const modelVisibility = Math.max(reappearRef?.current ?? 1, burstVisibility);
    const partAction = partActionRef?.current;

    if (bodyMaterialRef.current) {
      updatePartActionUniforms(bodyMaterialRef.current, partAction);
      bodyMaterialRef.current.uniforms.uTime.value = clock.elapsedTime;
      bodyMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      bodyMaterialRef.current.uniforms.uFlowAmount.value = flowAmount;
      bodyMaterialRef.current.uniforms.uBreathAmount.value = breathAmount;
      bodyMaterialRef.current.uniforms.uInteractionPulse.value = interactionPulseRef?.current ?? 0;
      bodyMaterialRef.current.uniforms.uBurstProgress.value = burstProgress;
      bodyMaterialRef.current.uniforms.uGlow.value = 0.06;
      bodyMaterialRef.current.uniforms.uEdgeGlow.value = 0.07;
      bodyMaterialRef.current.uniforms.uParticleSpread.value = Math.max(0.44, behaviorSignature?.particleSpread ?? 0.5);
      bodyMaterialRef.current.uniforms.uDepthAmount.value = 1.35 + (behaviorSignature?.depth ?? 0.78) * 0.72;
      bodyMaterialRef.current.uniforms.uPointSizeBoost.value = 1 - spotlightFocus * 0.18;
      bodyMaterialRef.current.uniforms.uAlphaMultiplier.value = (1 - spotlightFocus * 0.72) * modelVisibility;
      bodyMaterialRef.current.uniforms.uFocusAmount.value = spotlightFocus;
    }
    if (outlineMaterialRef.current) {
      updatePartActionUniforms(outlineMaterialRef.current, partAction);
      outlineMaterialRef.current.uniforms.uTime.value = clock.elapsedTime;
      outlineMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      outlineMaterialRef.current.uniforms.uFlowAmount.value = flowAmount * 0.18;
      outlineMaterialRef.current.uniforms.uBreathAmount.value = breathAmount * 0.55;
      outlineMaterialRef.current.uniforms.uInteractionPulse.value = (interactionPulseRef?.current ?? 0) * 0.55;
      outlineMaterialRef.current.uniforms.uBurstProgress.value = burstProgress * 0.82;
      outlineMaterialRef.current.uniforms.uGlow.value = 0.05;
      outlineMaterialRef.current.uniforms.uEdgeGlow.value = 0.06;
      outlineMaterialRef.current.uniforms.uParticleSpread.value = Math.max(0.38, behaviorSignature?.particleSpread ?? 0.5);
      outlineMaterialRef.current.uniforms.uDepthAmount.value = 1.05 + (behaviorSignature?.depth ?? 0.78) * 0.55;
      outlineMaterialRef.current.uniforms.uPointSizeBoost.value = 1 + spotlightFocus * 0.1;
      outlineMaterialRef.current.uniforms.uAlphaMultiplier.value = (1 + spotlightFocus * 0.18) * modelVisibility;
      outlineMaterialRef.current.uniforms.uFocusAmount.value = spotlightFocus;
    }
    if (detailMaterialRef.current) {
      updatePartActionUniforms(detailMaterialRef.current, partAction);
      const detailAlpha = THREE.MathUtils.smoothstep(spotlightFocus, 0.08, 0.82) * 0.62;
      detailMaterialRef.current.visible = spotlightEnabled && spotlightFocus > 0.01;
      detailMaterialRef.current.uniforms.uTime.value = clock.elapsedTime;
      detailMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      detailMaterialRef.current.uniforms.uFlowAmount.value = flowAmount * 0.16;
      detailMaterialRef.current.uniforms.uBreathAmount.value = breathAmount * 0.38;
      detailMaterialRef.current.uniforms.uInteractionPulse.value = (interactionPulseRef?.current ?? 0) * 0.28;
      detailMaterialRef.current.uniforms.uBurstProgress.value = burstProgress * 0.32;
      detailMaterialRef.current.uniforms.uGlow.value = 0.035;
      detailMaterialRef.current.uniforms.uEdgeGlow.value = 0.045;
      detailMaterialRef.current.uniforms.uParticleSpread.value = Math.max(0.3, behaviorSignature?.particleSpread ?? 0.5);
      detailMaterialRef.current.uniforms.uDepthAmount.value = 0.82 + (behaviorSignature?.depth ?? 0.78) * 0.28;
      detailMaterialRef.current.uniforms.uPointSizeBoost.value = 0.72 + spotlightFocus * 0.18;
      detailMaterialRef.current.uniforms.uAlphaMultiplier.value = detailAlpha;
      detailMaterialRef.current.uniforms.uFocusAmount.value = spotlightFocus;
    }
    if (focusMaterialRef.current) {
      focusMaterialRef.current.visible = spotlightEnabled && spotlightFocus > 0.04;
      focusMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      focusMaterialRef.current.uniforms.uFocusAmount.value = spotlightFocus;
    }
  });

  return (
    <>
      <points ref={bodyPointsRef} geometry={bodyGeometry} material={bodyMaterial} renderOrder={10} frustumCulled={false} />
      <points ref={outlinePointsRef} geometry={outlineGeometry} material={outlineMaterial} renderOrder={11} frustumCulled={false} />
      {detailGeometry ? <points ref={detailPointsRef} geometry={detailGeometry} material={detailMaterial} renderOrder={12} frustumCulled={false} /> : null}
      {focusGeometry ? <points ref={focusPointsRef} geometry={focusGeometry} material={focusMaterial} renderOrder={14} frustumCulled={false} /> : null}
    </>
  );
}
