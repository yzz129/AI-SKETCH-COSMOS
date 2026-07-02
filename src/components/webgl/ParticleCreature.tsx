import { useFrame } from '@react-three/fiber';
import { MutableRefObject, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';
import type { CreatureBehaviorSignature } from '../../utils/creatureMotion';
import { createParticleCreatureMaterial } from './ParticleCreatureMaterial';

type ParticleCreatureProps = {
  particles: ArtworkParticle[];
  flowAmount: number;
  breathAmount?: number;
  behaviorSignature?: CreatureBehaviorSignature;
  interactionPulseRef?: MutableRefObject<number>;
};

function createGeometry(particles: ArtworkParticle[], outlineOnly = false) {
  const selected = outlineOnly ? particles.filter((particle) => particle.isEdge) : particles;
  const count = selected.length;
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

  for (let i = 0; i < count; i += 1) {
    const particle = selected[i];
    const i3 = i * 3;
    const z = (particle.z ?? 0) * 2.35;
    const edgeFactor = particle.edgeFactor ?? (particle.isEdge ? 1 : 0);
    const phase = particle.phase ?? Math.sin((particle.x * 17.31 + particle.y * 29.77 + z * 43.13) * 11.7) * Math.PI;
    const sourceBasePosition = particle.basePosition ?? [particle.x, particle.y, z];
    const basePosition: [number, number, number] = [
      sourceBasePosition[0],
      sourceBasePosition[1],
      sourceBasePosition[2] * 2.35
    ];

    positions[i3] = basePosition[0];
    positions[i3 + 1] = basePosition[1];
    positions[i3 + 2] = basePosition[2];
    basePositions[i3] = basePosition[0];
    basePositions[i3 + 1] = basePosition[1];
    basePositions[i3 + 2] = basePosition[2];
    colors[i3] = particle.r / 255;
    colors[i3 + 1] = particle.g / 255;
    colors[i3 + 2] = particle.b / 255;
    sizes[i] = outlineOnly
      ? Math.min(4.4, (particle.size ?? 2.5) + 0.36)
      : (particle.size ?? (particle.isEdge ? 3.2 : 2.35)) * 1.34;
    alphas[i] = outlineOnly ? Math.min(0.58, (particle.alpha ?? 0.9) * 0.5) : Math.min(1, (particle.alpha ?? 0.96) * 1.08);
    phases[i] = phase;
    flowStrengths[i] = outlineOnly ? 0.12 : (particle.flowStrength ?? (particle.isEdge ? 0.28 : 0.74)) * 0.88;
    edgeFactors[i] = edgeFactor;
    brightnesses[i] = particle.brightness ?? ((particle.r + particle.g + particle.b) / 765);
    depthFactors[i] = particle.depthFactor ?? THREE.MathUtils.clamp((basePosition[2] + 0.12) / 0.34, 0, 1);
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
  geometry.computeBoundingSphere();

  return geometry;
}

export function ParticleCreature({
  particles,
  flowAmount,
  breathAmount = 0.035,
  behaviorSignature,
  interactionPulseRef
}: ParticleCreatureProps) {
  const bodyMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const outlineMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const bodyGeometry = useMemo(() => createGeometry(particles), [particles]);
  const outlineGeometry = useMemo(() => createGeometry(particles, true), [particles]);
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

  useFrame(({ clock }) => {
    if (bodyMaterialRef.current) {
      bodyMaterialRef.current.uniforms.uTime.value = clock.elapsedTime;
      bodyMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      bodyMaterialRef.current.uniforms.uFlowAmount.value = flowAmount;
      bodyMaterialRef.current.uniforms.uBreathAmount.value = breathAmount;
      bodyMaterialRef.current.uniforms.uInteractionPulse.value = interactionPulseRef?.current ?? 0;
      bodyMaterialRef.current.uniforms.uGlow.value = 0.18;
      bodyMaterialRef.current.uniforms.uEdgeGlow.value = 0.12;
      bodyMaterialRef.current.uniforms.uParticleSpread.value = Math.max(0.62, behaviorSignature?.particleSpread ?? 0.5);
      bodyMaterialRef.current.uniforms.uDepthAmount.value = 1.65 + (behaviorSignature?.depth ?? 0.78) * 1.12;
    }
    if (outlineMaterialRef.current) {
      outlineMaterialRef.current.uniforms.uTime.value = clock.elapsedTime;
      outlineMaterialRef.current.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
      outlineMaterialRef.current.uniforms.uFlowAmount.value = flowAmount * 0.18;
      outlineMaterialRef.current.uniforms.uBreathAmount.value = breathAmount * 0.55;
      outlineMaterialRef.current.uniforms.uInteractionPulse.value = (interactionPulseRef?.current ?? 0) * 0.55;
      outlineMaterialRef.current.uniforms.uGlow.value = 0.12;
      outlineMaterialRef.current.uniforms.uEdgeGlow.value = 0.1;
      outlineMaterialRef.current.uniforms.uParticleSpread.value = Math.max(0.56, behaviorSignature?.particleSpread ?? 0.5);
      outlineMaterialRef.current.uniforms.uDepthAmount.value = 1.28 + (behaviorSignature?.depth ?? 0.78) * 0.78;
    }
  });

  return (
    <>
      <points geometry={bodyGeometry} material={bodyMaterial} renderOrder={10} frustumCulled={false} />
      <points geometry={outlineGeometry} material={outlineMaterial} renderOrder={11} frustumCulled={false} />
    </>
  );
}
