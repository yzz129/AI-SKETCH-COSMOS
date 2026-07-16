import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { StoredArtwork } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { crowdAvoidance, nearestFoodAttraction, pointerAvoidance, useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import {
  createCreatureMotionConfig,
  getCreatureActionPose,
  getCreatureMotionPose,
  getCreatureMotionPreset,
  pickCreatureAction
} from '../../utils/creatureMotion';
import { CreatureAuraDust } from './CreatureAuraDust';
import { CreatureDustFeeding } from './CreatureDustFeeding';
import {
  CreatureEventParticles,
  CreatureSuctionVortex,
  type CreatureEffectSignal
} from './CreatureEventParticles';
import { ParticleCreature } from './ParticleCreature';
import { ParticleCreatureTrail } from './ParticleCreatureTrail';
import { SplatCreatureModel } from './SplatCreatureModel';
import {
  SPOTLIGHT_FLY_IN_DURATION,
  SPOTLIGHT_OUTER_LAYER_DISTANCE,
  SPOTLIGHT_RELEASE_DURATION
} from './spotlightConfig';
import {
  spotlightApproachEased,
  spotlightReleaseEased,
  spotlightReleaseProgress
} from './spotlightMotion';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';
import { CREATURE_ORBIT_CENTER, DADAKIDO_WORLD_POSITION } from './cosmicAnchors';
import {
  createCreaturePartAction,
  resetCreaturePartAction,
  writeFightCreaturePartAction,
  writeImpactCreaturePartAction,
  writeTrappedCreaturePartAction,
  writeVictoryCreaturePartAction,
  type CreaturePartActionPose
} from './creaturePartActions';
import { useCreatureInteractionStore } from './creatureInteractionStore';
import {
  getCreatureEvolution,
  useCreatureEvolutionStore
} from './creatureEvolutionStore';
import { CreatureLevelBadge } from './CreatureLevelBadge';
import {
  CREATURE_FRONT_RENDER_ORDER,
  resolveCreatureOcclusionStrength,
  resolveCreatureRenderOrder
} from './dadakidoOcclusion';
import {
  removeDadakidoOccluder,
  updateDadakidoOccluder
} from './dadakidoOcclusionRegistry';
import { getPlanetWorldPosition, PLANETS } from './OrbitalPlanets';
import { getGalaxyPortal } from './galaxyPortalRegistry';
import { markCreaturePriorityHit } from './pointerPriority';

const SPOTLIGHT_FEATURED_HOLD_DURATION = 20;
const SPOTLIGHT_FEATURED_RETURN_DURATION = 5;
const AUDIENCE_SWAY_ANGLE = THREE.MathUtils.degToRad(5.2);
const FEATURED_SWAY_ANGLE = THREE.MathUtils.degToRad(3.6);
const SPOTLIGHT_TWIST_ANGLE = THREE.MathUtils.degToRad(10);
const SPOTLIGHT_ROLL_ANGLE = THREE.MathUtils.degToRad(3.5);
const MAX_INTERACTION_FACING_OFFSET = THREE.MathUtils.degToRad(5.5);
function getSpotlightLandingPosition(index: number) {
  const slot = index % 7;
  const angle = slot * (Math.PI * 2 / 7) + 0.3;
  const radius = 2.65 + (index % 3) * 0.32;
  return CREATURE_ORBIT_CENTER.clone().add(new THREE.Vector3(
    Math.cos(angle) * radius,
    0.55 + (index % 4) * 0.24,
    Math.sin(angle) * radius * 0.46
  ));
}

type SpaceCreatureProps = {
  artwork: StoredArtwork;
  index: number;
  showEntryTrail?: boolean;
};

const RESPAWN_TRAIL_DURATION = 1.65;
const RESPAWN_TRAIL_MODEL_CLEARANCE = 0.42;
const RESPAWN_REAPPEAR_DURATION = 2.4;
const RESPAWN_RETURN_DELAY = 1.8;
const RESPAWN_RETURN_DURATION = 4.8;

type RespawnMeteorTrailProps = {
  startRef: MutableRefObject<THREE.Vector3 | null>;
  endRef: MutableRefObject<THREE.Vector3 | null>;
  startedAtRef: MutableRefObject<number>;
  headPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  duration?: number;
  renderOrderBase?: number;
  renderOrderRef?: MutableRefObject<number>;
};

function createRespawnTrailMaterial(core: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uCore: { value: core ? 1 : 0 },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uFlow: { value: 0 },
      uWarp: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uCore;
      uniform float uTime;
      uniform float uSeed;
      uniform float uFlow;
      uniform float uWarp;
      varying vec2 vUv;

      vec3 colorWheel(float h) {
        vec3 p = abs(fract(h + vec3(0.0, 0.66, 0.33)) * 6.0 - 3.0);
        return clamp(p - 1.0, 0.0, 1.0);
      }

      void main() {
        float x = vUv.x;
        float centerWarp = (
          sin(x * 8.0 + uTime * 3.2 + uSeed * 12.0) * 0.038 +
          sin(x * 17.0 + uTime * 4.6 + uSeed * 7.0) * 0.018
        ) * uWarp * (1.0 - smoothstep(0.78, 1.0, x));
        float y = abs(vUv.y - 0.5 - centerWarp) * 2.0;

        float widthPulse = 1.0
          + sin(x * 10.0 + uTime * 4.2 + uSeed * 19.0) * 0.16
          + sin(x * 23.0 + uTime * 3.4 + uSeed * 5.0) * 0.08;
        float width = mix(0.025, mix(0.34, 0.14, uCore), pow(x, 0.72)) * widthPulse;
        float softBody = exp(-pow(y / max(width, 0.001), 2.0) * mix(2.4, 4.4, uCore));
        float tailFade = smoothstep(0.02, mix(0.2, 0.34, uWarp), x);
        float headFade = 1.0 - smoothstep(0.84, 0.99, x);
        float energyRipple = 0.86 + 0.14 * sin(x * 18.0 + uTime * 7.0 + uSeed * 11.0);
        float energy = mix(0.2, 1.0, smoothstep(0.05, 0.72, x)) * energyRipple;
        float alpha = softBody * tailFade * headFade * energy;

        float hue = fract(uSeed + uFlow * 0.42 + x * (0.42 + uWarp * 0.32));
        vec3 color = colorWheel(hue);
        vec3 nextColor = colorWheel(hue + 0.18 + sin(uTime * 1.7 + uSeed * 9.0) * 0.05);
        color = mix(color, nextColor, smoothstep(0.18, 0.86, x));
        color = mix(color, vec3(1.0, 0.72, 0.96), smoothstep(0.68, 0.94, x) * 0.16);
        alpha *= mix(0.44, 0.72, uCore) * uOpacity;

        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

function createRespawnHeadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(64, 64, 1, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,244,255,.78)');
  glow.addColorStop(0.18, 'rgba(255,105,222,.52)');
  glow.addColorStop(0.44, 'rgba(116,166,255,.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function RespawnMeteorTrail({
  startRef,
  endRef,
  startedAtRef,
  headPositionRef,
  duration = RESPAWN_TRAIL_DURATION,
  renderOrderBase = 12,
  renderOrderRef
}: RespawnMeteorTrailProps) {
  const mainRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const headTexture = useMemo(createRespawnHeadTexture, []);
  const mainMaterial = useMemo(() => createRespawnTrailMaterial(false), []);
  const coreMaterial = useMemo(() => createRespawnTrailMaterial(true), []);
  const headMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    map: headTexture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 0
  }), [headTexture]);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const motionDirection = useMemo(() => new THREE.Vector3(), []);
  const smoothedDirection = useMemo(() => new THREE.Vector3(), []);
  const previousHead = useMemo(() => new THREE.Vector3(), []);
  const trailStartedAt = useRef(-100);
  const head = useMemo(() => new THREE.Vector3(), []);
  const trailAttach = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const cameraVector = useMemo(() => new THREE.Vector3(), []);
  const xAxis = useMemo(() => new THREE.Vector3(), []);
  const yAxis = useMemo(() => new THREE.Vector3(), []);
  const zAxis = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => () => {
    headTexture.dispose();
    mainMaterial.dispose();
    coreMaterial.dispose();
    headMaterial.dispose();
  }, [coreMaterial, headMaterial, headTexture, mainMaterial]);

  useFrame(({ camera }, delta) => {
    const start = startRef.current;
    const end = endRef.current;
    const main = mainRef.current;
    const core = coreRef.current;
    const headMesh = headRef.current;
    if (!start || !end || !main || !core || !headMesh) return;
    const activeRenderOrder = renderOrderRef?.current ?? renderOrderBase;
    main.renderOrder = activeRenderOrder;
    core.renderOrder = activeRenderOrder + 1;
    headMesh.renderOrder = activeRenderOrder + 2;

    const age = performance.now() * 0.001 - startedAtRef.current;
    const fadeEnd = duration + 0.55;
    if (age < 0 || age > fadeEnd) {
      main.visible = false;
      core.visible = false;
      headMesh.visible = false;
      return;
    }

    direction.copy(end).sub(start);
    const distance = direction.length();
    if (distance < 0.001) {
      main.visible = false;
      core.visible = false;
      headMesh.visible = false;
      return;
    }

    const progress = THREE.MathUtils.clamp(age / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0.015, 0.12);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(age, duration * 0.9, fadeEnd);
    const fade = fadeIn * fadeOut;
    const spatialSeed = Math.abs(
      Math.sin(
        start.x * 12.9898 + start.y * 78.233 + start.z * 37.719 +
        end.x * 19.913 + end.y * 43.121 + end.z * 11.137
      )
    );
    const depthSwing = THREE.MathUtils.clamp(Math.abs(end.z - start.z) / 8.5, 0, 1);
    const verticalSwing = THREE.MathUtils.clamp(Math.abs(end.y - start.y) / 4.2, 0, 1);
    const distanceSwing = THREE.MathUtils.clamp((distance - 5.5) / 7.5, 0, 1);
    const shapeVariance = 0.78 + spatialSeed * 0.44 + depthSwing * 0.22 - verticalSwing * 0.12;
    const travelPulse = 1 + Math.sin(progress * Math.PI * 2.0 + spatialSeed * 6.28) * 0.1;
    const colorFlow = age * (0.85 + spatialSeed * 0.9) + progress * (0.55 + distanceSwing * 0.4);
    const warp = THREE.MathUtils.clamp(0.28 + depthSwing * 0.42 + verticalSwing * 0.22 + spatialSeed * 0.18, 0.22, 0.95);

    xAxis.copy(direction).normalize();
    const attachedHead = headPositionRef?.current;
    if (attachedHead) {
      head.copy(attachedHead);
      if (trailStartedAt.current !== startedAtRef.current) {
        trailStartedAt.current = startedAtRef.current;
        previousHead.copy(head);
        smoothedDirection.copy(xAxis);
      } else {
        motionDirection.copy(head).sub(previousHead);
        if (motionDirection.lengthSq() > 0.000004) {
          motionDirection.normalize();
          smoothedDirection.lerp(
            motionDirection,
            1 - Math.exp(-delta * 24)
          ).normalize();
          // Never let smoothing flip the trail toward the model. The geometry
          // extends along -xAxis, so xAxis must stay aligned with real velocity.
          if (smoothedDirection.dot(motionDirection) < 0) {
            smoothedDirection.copy(motionDirection);
          }
        }
        previousHead.copy(head);
      }
      if (smoothedDirection.lengthSq() > 0.0001) xAxis.copy(smoothedDirection);
    } else {
      head.copy(start).lerp(end, eased);
    }
    const modelClearance = THREE.MathUtils.clamp(
      RESPAWN_TRAIL_MODEL_CLEARANCE + distanceSwing * 0.12,
      0.34,
      0.58
    );
    trailAttach.copy(head).addScaledVector(xAxis, -modelClearance);
    const visibleLength = Math.min(distance * 0.74, 5.6) * (0.44 + progress * 0.72) * fade;
    const visibleWidth = (0.16 + 0.14 * fade)
      * THREE.MathUtils.clamp(distance / 6, 0.68, 1.18)
      * shapeVariance
      * travelPulse;
    // The head stays behind the model and the body grows opposite its velocity.
    center.copy(trailAttach).addScaledVector(xAxis, -visibleLength * 0.5);

    cameraVector.copy(camera.position).sub(center).normalize();
    yAxis.copy(cameraVector).cross(xAxis);
    if (yAxis.lengthSq() < 0.0001) {
      yAxis.set(0, 1, 0).cross(xAxis);
    }
    yAxis.normalize();
    zAxis.copy(xAxis).cross(yAxis).normalize();
    basis.makeBasis(xAxis, yAxis, zAxis);
    quaternion.setFromRotationMatrix(basis);

    main.visible = fade > 0.002;
    core.visible = main.visible;
    headMesh.visible = main.visible;
    main.position.copy(center);
    core.position.copy(center).addScaledVector(zAxis, 0.006);
    main.quaternion.copy(quaternion);
    core.quaternion.copy(quaternion);
    main.scale.set(Math.max(visibleLength, 0.001), visibleWidth, 1);
    core.scale.set(Math.max(visibleLength * (0.76 + spatialSeed * 0.14), 0.001), visibleWidth * (0.5 + depthSwing * 0.16), 1);
    mainMaterial.uniforms.uOpacity.value = 0.98 * fade;
    coreMaterial.uniforms.uOpacity.value = 0.78 * fade;
    mainMaterial.uniforms.uTime.value = age;
    coreMaterial.uniforms.uTime.value = age + 0.17;
    mainMaterial.uniforms.uSeed.value = spatialSeed;
    coreMaterial.uniforms.uSeed.value = (spatialSeed + 0.31) % 1;
    mainMaterial.uniforms.uFlow.value = colorFlow;
    coreMaterial.uniforms.uFlow.value = colorFlow + 0.22;
    mainMaterial.uniforms.uWarp.value = warp;
    coreMaterial.uniforms.uWarp.value = warp * 0.55;

    headMesh.position.copy(trailAttach).addScaledVector(xAxis, -0.015);
    headMesh.quaternion.copy(camera.quaternion);
    headMesh.scale.setScalar((0.075 + 0.045 * fade + distanceSwing * 0.02) * fade);
    headMaterial.opacity = 0.22 * fade;
    headMaterial.color.setHSL((spatialSeed + colorFlow * 0.18) % 1, 0.92, 0.68);
  });

  return (
    <group renderOrder={renderOrderBase} frustumCulled>
      <mesh ref={mainRef} material={mainMaterial} renderOrder={renderOrderBase} frustumCulled visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={coreRef} material={coreMaterial} renderOrder={renderOrderBase + 1} frustumCulled visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={headRef} material={headMaterial} renderOrder={renderOrderBase + 2} frustumCulled visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

export function SpaceCreature({ artwork, index, showEntryTrail = false }: SpaceCreatureProps) {
  const spotlightCreatureId = useSketchStore((state) => state.spotlight.creatureId);
  const spotlightRequestedCreatureId = useSketchStore((state) => state.spotlight.requestedCreatureId);
  const spotlightPendingCreatureId = useSketchStore((state) => state.spotlight.pendingCreatureId);
  const spotlightPhase = useSketchStore((state) => state.spotlight.phase);
  const autoCreaturePulse = useAutoCosmicInteractionStore((state) => state.creaturePulse);
  const groupRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const previewMeshRef = useRef<THREE.Mesh>(null);
  const interactionMeshRef = useRef<THREE.Mesh>(null);
  const startTimeRef = useRef<number | null>(null);
  const entryTrailStartRef = useRef<THREE.Vector3 | null>(null);
  const entryTrailEndRef = useRef<THREE.Vector3 | null>(null);
  const entryTrailHeadRef = useRef<THREE.Vector3 | null>(null);
  const entryTrailStartedAtRef = useRef(-100);
  const entryTrailInitializedRef = useRef(false);
  const pulseRef = useRef(0);
  const burstRef = useRef(0);
  const burstPhaseRef = useRef(1);
  const portalApproachPositionRef = useRef(new THREE.Vector3());
  const portalApproachVelocityRef = useRef(new THREE.Vector3());
  const portalDesiredVelocityRef = useRef(new THREE.Vector3());
  const portalTargetRef = useRef(new THREE.Vector3());
  const portalVisibilityRef = useRef(1);
  const respawnVisibilityRef = useRef(1);
  const reappearRef = useRef(1);
  const spotlightFocusRef = useRef(0);
  const cameraFacingYawRef = useRef(0);
  const cameraFacingInitializedRef = useRef(false);
  const spotlightAnchorRef = useRef<THREE.Vector3 | null>(null);
  const spotlightLandingRef = useRef<THREE.Vector3 | null>(null);
  const spotlightHoldStartedAtRef = useRef(-100);
  const wasSpotlightRef = useRef(false);
  const spotlightReleaseTrailStartRef = useRef<THREE.Vector3 | null>(null);
  const spotlightReleaseTrailEndRef = useRef<THREE.Vector3 | null>(null);
  const spotlightReleaseTrailHeadRef = useRef<THREE.Vector3 | null>(null);
  const spotlightReleaseTrailStartedAtRef = useRef(-100);
  const spotlightReleaseStartedRef = useRef(false);
  const suctionTrailStartRef = useRef<THREE.Vector3 | null>(null);
  const suctionTrailEndRef = useRef<THREE.Vector3 | null>(null);
  const suctionTrailStartedAtRef = useRef(-100);
  const suctionTrailSequenceRef = useRef(0);
  const spotlightPreviousPhaseRef = useRef(spotlightPhase);
  const pulseStartedAtRef = useRef(-100);
  const burstStartedAtRef = useRef(-100);
  const burstAnchorRef = useRef<THREE.Vector3 | null>(null);
  const burstWasActiveRef = useRef(false);
  const lastAutoCreaturePulseRef = useRef(0);
  const respawnPositionRef = useRef<THREE.Vector3 | null>(null);
  const respawnStartedAtRef = useRef(-100);
  const visibleInteractionPositionRef = useRef(new THREE.Vector3());
  const creatureRenderOrderRef = useRef(CREATURE_FRONT_RENDER_ORDER);
  const creatureViewPositionRef = useRef(new THREE.Vector3());
  const dadakidoViewPositionRef = useRef(new THREE.Vector3());
  const lastPositionRef = useRef(new THREE.Vector3());
  const smoothedOffsetRef = useRef(new THREE.Vector3());
  const aiDesiredOffsetRef = useRef(new THREE.Vector3());
  const aiTargetPositionRef = useRef(new THREE.Vector3());
  const actionSpinRef = useRef(0);
  const lastInteractionSequenceRef = useRef(0);
  const lastInteractionBeatRef = useRef(0);
  const effectSignalRef = useRef<CreatureEffectSignal>({ id: 0, kind: 'entry', startedAt: -100 });
  const partActionRef = useRef<CreaturePartActionPose>(createCreaturePartAction());
  const interactionAnchorRef = useRef(new THREE.Vector3());
  const interactionOriginRef = useRef(new THREE.Vector3());
  const planetPositionRef = useRef(new THREE.Vector3());
  const preset = useMemo(
    () => getCreatureMotionPreset(artwork.motionType, artwork.behaviorSignature),
    [artwork.behaviorSignature, artwork.motionType]
  );
  const motion = useMemo(
    () => createCreatureMotionConfig(index, artwork.motionType, artwork.behaviorSignature),
    [artwork.behaviorSignature, artwork.motionType, index]
  );
  /* ---- Spherical shell motion around dadakido ---- */
  const orbitParams = useMemo(() => {
    const baseRadii = [4.2, 5.8, 7.6, 9.5, 11.0, 13.0];
    const orbitRadius = baseRadii[index % baseRadii.length];
    // Keep farther shells slower while letting each creature drift across latitude.
    const orbitSpeed = 0.34 * Math.pow(orbitRadius / 4.2, -1.25);
    const phaseOffset = index * 0.61803398875 + motion.phase * 0.031;
    const latitudeSpeed = orbitSpeed * (0.72 + (index % 5) * 0.09);
    const latitudePhase = motion.phase * 0.17 + index * 1.173;
    const latitudeAmplitude = 0.72 + (index % 4) * 0.08;
    const radiusBreath = 0.018 + (index % 3) * 0.006;
    return { orbitRadius, orbitSpeed, phaseOffset, latitudeSpeed, latitudePhase, latitudeAmplitude, radiusBreath };
  }, [index, motion.phase]);
  const interactionMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);

  // ── Preview image plane material (visible during spotlight) ──
  const [previewTexture, setPreviewTexture] = useState<THREE.Texture | null>(null);
  const previewTextureRef = useRef<THREE.Texture | null>(null);
  const [previewReadyUrl, setPreviewReadyUrl] = useState<string | null>(null);
  const [previewFailedUrl, setPreviewFailedUrl] = useState<string | null>(null);
  const [splatReadyUrl, setSplatReadyUrl] = useState<string | null>(null);
  const previewMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    map: previewTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  }), [previewTexture]);

  useEffect(() => {
    let disposed = false;
    previewTextureRef.current?.dispose();
    previewTextureRef.current = null;
    setPreviewTexture(null);
    setPreviewReadyUrl(null);
    setPreviewFailedUrl(null);
    useSketchStore.getState().invalidateSpotlightReady(artwork.id);
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      previewTextureRef.current = tex;
      setPreviewTexture(tex);
      setPreviewReadyUrl(artwork.url);
    };
    img.onerror = () => {
      if (disposed) return;
      setPreviewFailedUrl(artwork.url);
    };
    img.src = artwork.url;
    return () => {
      disposed = true;
      const texture = previewTextureRef.current;
      if (!texture) return;
      texture.dispose();
      previewTextureRef.current = null;
      setPreviewTexture((current) => current === texture ? null : current);
    };
  }, [artwork.id, artwork.url]);

  useEffect(() => () => {
    removeDadakidoOccluder(artwork.id);
  }, [artwork.id]);

  const maxSize = 1.05;
  const planeWidth = artwork.aspect >= 1 ? maxSize : maxSize * artwork.aspect;
  const planeHeight = artwork.aspect >= 1 ? maxSize / artwork.aspect : maxSize;
  const spotlightEnabled = spotlightCreatureId === artwork.id && spotlightPhase !== 'idle';
  const spotlightRequested = spotlightRequestedCreatureId === artwork.id
    || spotlightPendingCreatureId === artwork.id;
  const splatUrl = artwork.gaussianModel?.status === 'ready' ? artwork.gaussianModel.splatUrl : undefined;

  useEffect(() => {
    if (autoCreaturePulse.id === 0 || autoCreaturePulse.id === lastAutoCreaturePulseRef.current) return;
    if (autoCreaturePulse.creatureId !== artwork.id || spotlightEnabled || spotlightRequested) return;

    lastAutoCreaturePulseRef.current = autoCreaturePulse.id;
    const now = performance.now() * 0.001;
    burstAnchorRef.current = visibleInteractionPositionRef.current.clone();
    respawnPositionRef.current = null;
    burstWasActiveRef.current = false;
    pulseStartedAtRef.current = now;
    burstStartedAtRef.current = now;
    burstPhaseRef.current = 0;
  }, [artwork.id, autoCreaturePulse, spotlightEnabled, spotlightRequested]);

  const pickRespawnPosition = (awayFrom?: THREE.Vector3) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(12.5),
        THREE.MathUtils.randFloat(-3.2, 3.35),
        CREATURE_ORBIT_CENTER.z + THREE.MathUtils.randFloat(-4.2, 9.2)
      );

      if (!awayFrom || candidate.distanceTo(awayFrom) > 5.5) {
        return candidate;
      }
    }

    return new THREE.Vector3(
      (awayFrom?.x ?? 0) + (Math.random() > 0.5 ? 6.2 : -6.2),
      THREE.MathUtils.randFloat(-3.2, 3.35),
      CREATURE_ORBIT_CENTER.z + THREE.MathUtils.randFloat(-4.2, 9.2)
    );
  };

  useEffect(() => {
    setSplatReadyUrl(null);
    useSketchStore.getState().invalidateSpotlightReady(artwork.id);
  }, [artwork.id, splatUrl]);

  useEffect(() => {
    const previewReady = previewReadyUrl === artwork.url || previewFailedUrl === artwork.url;
    const splatReady = Boolean(splatUrl && splatReadyUrl === splatUrl);
    if (!spotlightRequested || (splatUrl ? !splatReady : !previewReady)) return;
    useSketchStore.getState().markSpotlightReady(artwork.id);
  }, [
    artwork.id,
    artwork.url,
    previewFailedUrl,
    previewReadyUrl,
    splatReadyUrl,
    splatUrl,
    spotlightRequested
  ]);

  useEffect(() => () => {
    useCreatureBehaviorStore.getState().removeCreaturePosition(artwork.id);
    useCreatureInteractionStore.getState().clearEvent(artwork.id);
    useCreatureEvolutionStore.getState().clearIntent(artwork.id);
  }, [artwork.id]);

  useEffect(() => {
    useCreatureEvolutionStore.getState().ensureCreature(artwork.id, index);
  }, [artwork.id, index]);

  useFrame(({ clock, camera }, delta) => {
    const group = groupRef.current;
    const visual = visualRef.current;
    if (!group) return;

    const time = clock.elapsedTime;
    const wallTime = performance.now() * 0.001;
    const interactionEvent = useCreatureInteractionStore.getState().events[artwork.id];
    // Interaction events are scheduled on the R3F clock. Using performance.now
    // here made events appear to skip phases after a slow first load.
    const interactionAge = interactionEvent ? time - interactionEvent.startedAt : Number.POSITIVE_INFINITY;
    const interactionActive = Boolean(
      interactionEvent
      && interactionAge >= 0
      && interactionAge < interactionEvent.duration
      && !spotlightEnabled
      && !spotlightRequested
    );
    resetCreaturePartAction(partActionRef.current);

    if (interactionEvent && interactionEvent.sequence !== lastInteractionSequenceRef.current) {
      lastInteractionSequenceRef.current = interactionEvent.sequence;
      lastInteractionBeatRef.current = 0;
      effectSignalRef.current = {
        id: interactionEvent.sequence,
        kind: interactionEvent.kind,
        startedAt: wallTime
      };
    }

    if (startTimeRef.current === null) {
      startTimeRef.current = time;
    }

    const localTime = time - startTimeRef.current;
    const entryProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(localTime / 1.15, 0, 1), 0, 1);

    // ── spotlight showcase mode ──
    const spotlight = useSketchStore.getState().spotlight;
    const isSpotlight = spotlight.creatureId === artwork.id && spotlight.phase !== 'idle';
    const spotlightElapsed = isSpotlight ? (Date.now() - spotlight.startedAt) / 1000 : 0;
    if (isSpotlight && spotlight.phase === 'fly-in' && !wasSpotlightRef.current) {
      spotlightLandingRef.current = null;
      spotlightHoldStartedAtRef.current = -100;
      spotlightReleaseTrailHeadRef.current = null;
    }
    const justFinishedSpotlight = !isSpotlight
      && spotlightPreviousPhaseRef.current === 'release'
      && Boolean(spotlightLandingRef.current);
    if (justFinishedSpotlight) {
      spotlightHoldStartedAtRef.current = wallTime;
      useCreatureBehaviorStore.getState().setCreatureFeaturedUntil(
        artwork.id,
        wallTime + SPOTLIGHT_FEATURED_HOLD_DURATION
      );
    }
    const spotlightHoldAge = wallTime - spotlightHoldStartedAtRef.current;
    const isSpotlightHold = Boolean(spotlightLandingRef.current)
      && spotlightHoldAge >= 0
      && spotlightHoldAge < SPOTLIGHT_FEATURED_HOLD_DURATION;
    /* ---- Spherical shell motion around dadakido ---- */
    const azimuth = time * orbitParams.orbitSpeed + orbitParams.phaseOffset;
    const latitudeWave = time * orbitParams.latitudeSpeed + orbitParams.latitudePhase;
    const latitude = Math.sin(latitudeWave) * orbitParams.latitudeAmplitude;
    const radius = orbitParams.orbitRadius * (1 + Math.sin(time * 0.12 + motion.phase) * orbitParams.radiusBreath);
    const portalApproach = useCreatureInteractionStore.getState().portalApproaches[artwork.id];
    const cosLat = Math.cos(latitude);
    const sinLat = Math.sin(latitude);
    const cosAz = Math.cos(azimuth);
    const sinAz = Math.sin(azimuth);
    const horizontalRadius = radius * cosLat;
    const orbitX = cosAz * horizontalRadius;
    const orbitY = sinLat * radius;
    const orbitZ = sinAz * horizontalRadius;
    const pathPosition = CREATURE_ORBIT_CENTER.clone()
      .add(new THREE.Vector3(orbitX, orbitY, orbitZ));
    // tangent for roll calculation
    const latitudeVelocity = Math.cos(latitudeWave) * orbitParams.latitudeSpeed * orbitParams.latitudeAmplitude;
    const tangent = new THREE.Vector3(
      -radius * cosLat * sinAz * orbitParams.orbitSpeed - radius * sinLat * cosAz * latitudeVelocity,
      radius * cosLat * latitudeVelocity,
      radius * cosLat * cosAz * orbitParams.orbitSpeed - radius * sinLat * sinAz * latitudeVelocity
    ).normalize();
    const foodOffset = portalApproach
      ? portalDesiredVelocityRef.current.set(0, 0, 0)
      : nearestFoodAttraction(pathPosition, wallTime);
    const avoidOffset = portalApproach
      ? portalTargetRef.current.set(0, 0, 0)
      : pointerAvoidance(pathPosition).add(crowdAvoidance(artwork.id, pathPosition));
    const targetOffset = foodOffset.add(avoidOffset);
    const aiIntent = useCreatureEvolutionStore.getState().intents[artwork.id];
    aiDesiredOffsetRef.current.set(0, 0, 0);
    const aiTargetPosition = aiIntent
      ? useCreatureBehaviorStore.getState().creaturePositions[aiIntent.targetId]
      : undefined;
    if (!portalApproach && aiIntent && aiIntent.expiresAt >= time && aiTargetPosition) {
      aiTargetPositionRef.current.set(...aiTargetPosition);
      if (aiIntent.mode === 'chase') {
        aiDesiredOffsetRef.current
          .copy(aiTargetPositionRef.current)
          .sub(pathPosition);
        const distance = aiDesiredOffsetRef.current.length();
        if (distance > 0.001) {
          aiDesiredOffsetRef.current.multiplyScalar(
            THREE.MathUtils.clamp(distance * 0.48, 0.72, 4.4)
              * aiIntent.strength
              / distance
          );
        }
      } else {
        aiDesiredOffsetRef.current
          .copy(pathPosition)
          .sub(aiTargetPositionRef.current);
        const distance = aiDesiredOffsetRef.current.length();
        if (distance > 0.001) {
          aiDesiredOffsetRef.current.multiplyScalar(
            THREE.MathUtils.clamp(1.05 + (8.5 - distance) * 0.28, 0.72, 3)
              * aiIntent.strength
              / distance
          );
        }
      }
      targetOffset.add(aiDesiredOffsetRef.current);
    }
    smoothedOffsetRef.current.lerp(targetOffset, 1 - Math.exp(-delta * 2.4));

    const basePose = getCreatureMotionPose(artwork.motionType, time, motion.phase);
    const activeAction = pickCreatureAction(artwork.actionTypes, time, motion.phase, artwork.motionType);
    const rawActionPose = getCreatureActionPose(activeAction, time, motion.phase);
    const actionSegmentProgress = THREE.MathUtils.euclideanModulo(
      time + motion.phase * 2.7,
      4.6
    ) / 4.6;
    const actionBlend = THREE.MathUtils.smootherstep(actionSegmentProgress, 0, 0.14)
      * (1 - THREE.MathUtils.smootherstep(actionSegmentProgress, 0.82, 1));
    const actionPose = {
      ...rawActionPose,
      offsetX: rawActionPose.offsetX * actionBlend,
      offsetY: rawActionPose.offsetY * actionBlend,
      offsetZ: rawActionPose.offsetZ * actionBlend,
      roll: rawActionPose.roll * actionBlend,
      yaw: rawActionPose.yaw * actionBlend,
      scaleX: THREE.MathUtils.lerp(1, rawActionPose.scaleX, actionBlend),
      scaleY: THREE.MathUtils.lerp(1, rawActionPose.scaleY, actionBlend),
      scaleZ: THREE.MathUtils.lerp(1, rawActionPose.scaleZ, actionBlend),
      flowMultiplier: THREE.MathUtils.lerp(1, rawActionPose.flowMultiplier, actionBlend),
      trailMultiplier: THREE.MathUtils.lerp(1, rawActionPose.trailMultiplier, actionBlend),
      spin: rawActionPose.spin * actionBlend,
      speedMultiplier: THREE.MathUtils.lerp(1, rawActionPose.speedMultiplier, actionBlend),
      impact: rawActionPose.impact * actionBlend
    };
    if (actionPose.spin > 0) {
      actionSpinRef.current += delta * 1.45 * actionPose.spin;
    } else {
      const nearestTurn = Math.round(actionSpinRef.current / (Math.PI * 2)) * Math.PI * 2;
      actionSpinRef.current = THREE.MathUtils.damp(actionSpinRef.current, nearestTurn, 5.5, delta);
    }
    const actionThrust = portalApproach
      ? portalDesiredVelocityRef.current.set(0, 0, 0)
      : tangent.clone().multiplyScalar((actionPose.speedMultiplier - 1) * 0.85);
    const targetPosition = pathPosition.clone().add(smoothedOffsetRef.current).add(new THREE.Vector3(
      portalApproach ? 0 : basePose.extraX + actionPose.offsetX,
      portalApproach ? 0 : basePose.extraY + actionPose.offsetY,
      portalApproach ? 0 : basePose.extraZ + actionPose.offsetZ
    )).add(actionThrust);
    if (portalApproach) {
      const portal = getGalaxyPortal(portalApproach.entryId);
      if (portal) {
        const currentVisible = lastPositionRef.current.lengthSq() > 0.0001
          ? lastPositionRef.current
          : pathPosition;
        portalTargetRef.current
          .copy(portal.position)
          .addScaledVector(portal.velocity, 0.12);
        portalDesiredVelocityRef.current
          .subVectors(portalTargetRef.current, currentVisible);
        const distance = portalDesiredVelocityRef.current.length();
        if (distance > 0.001) {
          const arrival = THREE.MathUtils.smoothstep(distance, portal.captureRadius, 2.4);
          const speed = THREE.MathUtils.lerp(3.2, 8.5, arrival);
          portalDesiredVelocityRef.current.multiplyScalar(speed / distance);
        }
        portalApproachVelocityRef.current.lerp(
          portalDesiredVelocityRef.current,
          1 - Math.exp(-delta * 11)
        );
        portalApproachPositionRef.current
          .copy(currentVisible)
          .addScaledVector(portalApproachVelocityRef.current, delta);
        targetPosition.copy(portalApproachPositionRef.current);
        tangent.copy(portalApproachVelocityRef.current).normalize();
        smoothedOffsetRef.current.set(0, 0, 0);
      }
    }

    if (showEntryTrail && !entryTrailInitializedRef.current) {
      entryTrailStartRef.current = new THREE.Vector3(motion.entryX, motion.entryY, motion.entryZ);
      entryTrailEndRef.current = targetPosition.clone();
      entryTrailStartedAtRef.current = wallTime;
      entryTrailInitializedRef.current = true;
    } else if (localTime < 1.25 && entryTrailEndRef.current) {
      entryTrailEndRef.current.copy(targetPosition);
    }
    const x = THREE.MathUtils.lerp(motion.entryX, targetPosition.x, entryProgress);
    const y = THREE.MathUtils.lerp(motion.entryY, targetPosition.y, entryProgress);
    const z = THREE.MathUtils.lerp(motion.entryZ, targetPosition.z, entryProgress);
    const farOrbitZ = CREATURE_ORBIT_CENTER.z - 14.0;
    const nearOrbitZ = CREATURE_ORBIT_CENTER.z + 14.0;
    const depthFactor = THREE.MathUtils.mapLinear(
      THREE.MathUtils.clamp(z, farOrbitZ, nearOrbitZ),
      farOrbitZ,
      nearOrbitZ,
      0.54,
      1.38
    );
    const entryGlow = 1 + (1 - entryProgress) * 0.2;
    const evolutionRecord = getCreatureEvolution(artwork.id, index);
    const evolutionScale = 1 + Math.min(evolutionRecord.level, 12) * 0.025;
    const normalScale = motion.baseScale * 0.95 * depthFactor * entryGlow * evolutionScale;

    // ── Spotlight: model moves into the same outer layer as the entry burst ──
    const pathWorldPosition = new THREE.Vector3(x, y, z);
    let interactionYaw = 0;
    let interactionRoll = 0;
    let interactionPitch = 0;
    let interactionScale = 1;
    let interactionOverride: THREE.Vector3 | null = null;
    if (interactionActive && interactionEvent) {
      const progress = THREE.MathUtils.clamp(interactionAge / interactionEvent.duration, 0, 1);
      if (interactionEvent.kind === 'fight' && interactionEvent.anchor) {
        const side = interactionEvent.role === 'left' ? -1 : 1;
        const fightAction = writeFightCreaturePartAction(
          partActionRef.current,
          progress,
          interactionEvent.role
        );
        const strike = Math.max(
          fightAction.punch,
          fightAction.bite * 0.92,
          fightAction.kick * 0.86
        );
        const stance = THREE.MathUtils.smoothstep(progress, 0.08, 0.24)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.82, 1));
        interactionAnchorRef.current.set(...interactionEvent.anchor);
        if (interactionEvent.origin) {
          interactionOriginRef.current
            .set(...interactionEvent.origin)
            .sub(interactionAnchorRef.current);
        } else {
          interactionOriginRef.current.set(side, 0, 0);
        }
        if (interactionOriginRef.current.lengthSq() < 0.0001) {
          interactionOriginRef.current.set(side, 0, 0);
        } else {
          interactionOriginRef.current.normalize();
        }
        interactionOverride = interactionAnchorRef.current.clone()
          .addScaledVector(
            interactionOriginRef.current,
            0.84 - strike * 0.62 + fightAction.hit * 0.13
          );
        interactionOverride.y += (
          fightAction.punch * 0.1
          + fightAction.kick * 0.085
          - fightAction.bite * 0.055
          + Math.sin(progress * Math.PI * 6 + side) * 0.045 * stance
        );
        interactionOverride.z += fightAction.bite * 0.08
          + fightAction.hit * 0.04
          - fightAction.windup * 0.035;
        interactionYaw = side * (
          0.12
          + fightAction.punch * 0.22
          + fightAction.bite * 0.32
          - fightAction.guard * 0.08
        );
        interactionPitch = fightAction.bite * 0.18
          - fightAction.kick * 0.14
          - fightAction.hit * 0.1;
        interactionRoll = -side * fightAction.punch * 0.12
          + side * fightAction.kick * 0.15
          + side * fightAction.hit * 0.19;
        interactionScale = 1
          + strike * 0.045
          - fightAction.hit * 0.03
          - fightAction.curl * 0.018;

        const beatThresholds = [0.17, 0.3, 0.46, 0.57, 0.65, 0.75];
        let fightBeat = 0;
        for (let beatIndex = 0; beatIndex < beatThresholds.length; beatIndex += 1) {
          if (progress >= beatThresholds[beatIndex]) fightBeat = beatIndex + 1;
        }
        if (fightBeat > lastInteractionBeatRef.current) {
          lastInteractionBeatRef.current = fightBeat;
          effectSignalRef.current = {
            id: interactionEvent.sequence * 100 + fightBeat,
            kind: fightAction.hit > strike ? 'collision' : 'fight',
            startedAt: wallTime
          };
        }
      } else if (interactionEvent.kind === 'victory') {
        writeVictoryCreaturePartAction(partActionRef.current, progress);
        const happyJump = Math.pow(Math.sin(progress * Math.PI * 2), 2);
        interactionOverride = pathWorldPosition.clone();
        interactionOverride.y += happyJump * 0.62;
        interactionRoll = Math.sin(progress * Math.PI * 4) * 0.12;
        interactionYaw = Math.sin(progress * Math.PI * 2) * 0.16;
        interactionScale = 1 + happyJump * 0.07 - (1 - happyJump) * 0.035;
      } else if (interactionEvent.kind === 'trapped' && interactionEvent.planetIndex !== undefined) {
        const planetPosition = getPlanetWorldPosition(
          interactionEvent.planetIndex,
          time,
          planetPositionRef.current
        ).clone();
        const captureDuration = interactionEvent.captureDuration ?? 2.1;
        writeTrappedCreaturePartAction(
          partActionRef.current,
          interactionAge,
          captureDuration,
          interactionEvent.duration
        );
        const planetRadius = PLANETS[interactionEvent.planetIndex]?.planetRadius ?? 0.55;
        const insideScale = THREE.MathUtils.clamp(
          planetRadius * 0.62,
          0.22,
          0.46
        );
        const rawSuctionProgress = THREE.MathUtils.clamp(interactionAge / captureDuration, 0, 1);
        const suctionProgress = THREE.MathUtils.smootherstep(
          THREE.MathUtils.clamp((rawSuctionProgress - 0.1) / 0.9, 0, 1),
          0,
          1
        );
        if (interactionAge < captureDuration && interactionEvent.origin) {
          interactionAnchorRef.current.set(...interactionEvent.origin);
          if (suctionTrailSequenceRef.current !== interactionEvent.sequence) {
            suctionTrailSequenceRef.current = interactionEvent.sequence;
            suctionTrailStartRef.current = interactionAnchorRef.current.clone();
            suctionTrailEndRef.current = planetPosition.clone();
            suctionTrailStartedAtRef.current = wallTime;
          } else {
            suctionTrailEndRef.current?.copy(planetPosition);
          }

          const travel = planetPosition.clone().sub(interactionAnchorRef.current);
          const side = new THREE.Vector3().crossVectors(travel, THREE.Object3D.DEFAULT_UP);
          if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
          else side.normalize();
          const lift = new THREE.Vector3().crossVectors(side, travel).normalize();
          const attractionBuild = THREE.MathUtils.smoothstep(rawSuctionProgress, 0, 0.2);
          const curveFade = (1 - suctionProgress) * attractionBuild;
          interactionOverride = interactionAnchorRef.current.clone().lerp(planetPosition, suctionProgress)
            .addScaledVector(side, Math.sin(suctionProgress * Math.PI * 2) * curveFade * 0.42)
            .addScaledVector(lift, Math.sin(suctionProgress * Math.PI) * curveFade * 0.2);
          interactionYaw = Math.sin(suctionProgress * Math.PI) * 0.26;
          interactionRoll = Math.sin(suctionProgress * Math.PI * 2) * curveFade * 0.14;
          interactionScale = THREE.MathUtils.lerp(1, insideScale, suctionProgress);
        } else {
          const struggleAge = Math.max(0, interactionAge - captureDuration);
          const struggleRamp = THREE.MathUtils.smootherstep(
            THREE.MathUtils.clamp(struggleAge / 0.34, 0, 1),
            0,
            1
          );
          const dissolveRamp = THREE.MathUtils.smootherstep(
            THREE.MathUtils.clamp((struggleAge - 3) / 0.34, 0, 1),
            0,
            1
          );
          const struggleEnvelope = struggleRamp * (1 - dissolveRamp);
          const wiggleRadius = Math.max(0.022, planetRadius * 0.075);
          interactionOverride = planetPosition;
          interactionOverride.x += Math.sin(struggleAge * 8.4) * wiggleRadius * struggleEnvelope;
          interactionOverride.y += Math.sin(struggleAge * 4.2) * wiggleRadius * 0.45 * struggleEnvelope;
          interactionYaw = Math.sin(struggleAge * 8.4) * 0.3 * struggleEnvelope;
          interactionRoll = Math.sin(struggleAge * 4.2) * 0.055 * struggleEnvelope;
          interactionScale = insideScale + Math.sin(struggleAge * 5.6) * 0.008 * struggleEnvelope;
        }
      } else if (interactionEvent.kind === 'portal' && interactionEvent.portal) {
        const portal = interactionEvent.portal;
        const transitionAt = portal.transitionAt;
        const entryLive = getGalaxyPortal(portal.entryId)?.position;
        const exitLive = getGalaxyPortal(portal.exitId)?.position;
        const entryPosition = entryLive?.clone() ?? new THREE.Vector3(...portal.entryPosition);
        const exitPosition = exitLive?.clone() ?? new THREE.Vector3(...portal.exitPosition);
        const localCreatureRadius = Math.max(0.001, 0.5 * Math.hypot(planeWidth, planeHeight));
        const portalFitScale = Math.min(1, portal.entryRadius * 0.88 / localCreatureRadius);
        if (interactionAge < transitionAt) {
          const raw = THREE.MathUtils.clamp(interactionAge / transitionAt, 0, 1);
          const suction = THREE.MathUtils.smootherstep(raw, 0, 1);
          interactionAnchorRef.current.set(...(interactionEvent.origin ?? pathWorldPosition.toArray()));
          const travel = entryPosition.clone().sub(interactionAnchorRef.current);
          const side = new THREE.Vector3().crossVectors(travel, THREE.Object3D.DEFAULT_UP);
          if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
          else side.normalize();
          const lift = new THREE.Vector3().crossVectors(side, travel).normalize();
          interactionOverride = interactionAnchorRef.current.clone().lerp(entryPosition, suction)
            .addScaledVector(side, Math.sin(suction * Math.PI * 3) * (1 - suction) * 0.48)
            .addScaledVector(lift, Math.sin(suction * Math.PI) * (1 - suction) * 0.24);
          interactionYaw = suction * Math.PI * 2.2;
          interactionRoll = suction * Math.PI * 3.4;
          interactionScale = THREE.MathUtils.lerp(1, portalFitScale * 0.08, suction);
          portalVisibilityRef.current = 1 - THREE.MathUtils.smootherstep(raw, 0.72, 1);
        } else {
          const emergeDuration = 0.65;
          const emergeAge = interactionAge - transitionAt;
          const emergence = THREE.MathUtils.smootherstep(
            THREE.MathUtils.clamp(emergeAge / emergeDuration, 0, 1),
            0,
            1
          );
          const exitNormal = portal.exitNormal
            ? new THREE.Vector3(...portal.exitNormal).normalize()
            : exitPosition.clone().sub(new THREE.Vector3(...CREATURE_ORBIT_CENTER)).normalize();
          const emergePosition = exitPosition.clone().addScaledVector(
            exitNormal,
            (portal.exitVisualRadius ?? portal.exitRadius) + localCreatureRadius * portalFitScale + 0.35
          );
          if (emergeAge < emergeDuration) {
            const side = new THREE.Vector3().crossVectors(exitNormal, THREE.Object3D.DEFAULT_UP);
            if (side.lengthSq() < 0.0001) side.set(0, 0, 1);
            else side.normalize();
            interactionOverride = exitPosition.clone().lerp(emergePosition, emergence)
              .addScaledVector(side, Math.sin(emergence * Math.PI) * 0.28);
            interactionScale = THREE.MathUtils.lerp(portalFitScale * 0.08, portalFitScale, emergence);
            interactionRoll = (1 - emergence) * -Math.PI * 1.4;
            portalVisibilityRef.current = THREE.MathUtils.smootherstep(emergence, 0.08, 0.52);
            if (lastInteractionBeatRef.current < 1) {
              lastInteractionBeatRef.current = 1;
              effectSignalRef.current = {
                id: interactionEvent.sequence * 100 + 1,
                kind: 'portal',
                startedAt: wallTime
              };
            }
          } else {
            const returnProgress = THREE.MathUtils.smootherstep(
              THREE.MathUtils.clamp((interactionAge - transitionAt - emergeDuration) / 1.3, 0, 1),
              0,
              1
            );
            interactionOverride = emergePosition.lerp(pathWorldPosition, returnProgress);
            interactionScale = THREE.MathUtils.lerp(portalFitScale, 1, returnProgress);
            portalVisibilityRef.current = 1;
          }
        }
      } else if (interactionEvent.kind === 'boost') {
        const boost = THREE.MathUtils.smootherstep(progress, 0, 0.28)
          * (1 - THREE.MathUtils.smootherstep(progress, 0.72, 1));
        interactionOverride = pathWorldPosition.clone().addScaledVector(tangent, boost * 1.25);
        interactionPitch = -boost * 0.16;
        interactionRoll = Math.sin(progress * Math.PI * 2) * 0.12;
        interactionScale = 1 + boost * 0.08;
      } else if (interactionEvent.kind === 'collision' && interactionEvent.anchor) {
        writeImpactCreaturePartAction(partActionRef.current, progress);
        interactionAnchorRef.current.set(...interactionEvent.anchor);
        const away = pathWorldPosition.clone().sub(interactionAnchorRef.current).normalize();
        interactionOverride = pathWorldPosition.clone().addScaledVector(away, Math.sin(progress * Math.PI) * 0.9);
        interactionRoll = Math.sin(progress * Math.PI * 3) * 0.24;
      }

      if (interactionEvent.kind !== 'trapped' && interactionEvent.kind !== 'portal' && interactionOverride) {
        const eventEnvelope = THREE.MathUtils.smootherstep(progress, 0, 0.14)
          * (1 - THREE.MathUtils.smootherstep(progress, 0.84, 1));
        interactionOverride.lerpVectors(pathWorldPosition, interactionOverride, eventEnvelope);
        interactionYaw *= eventEnvelope;
        interactionRoll *= eventEnvelope;
        interactionPitch *= eventEnvelope;
        interactionScale = THREE.MathUtils.lerp(1, interactionScale, eventEnvelope);
      }
    }
    const releaseProgress = isSpotlight && spotlight.phase === 'release'
      ? spotlightReleaseProgress(spotlightElapsed)
      : 0;
    const releaseEased = isSpotlight && spotlight.phase === 'release'
      ? spotlightReleaseEased(spotlightElapsed)
      : 0;
    const spotlightDanceEnvelope = isSpotlight
      && spotlight.phase === 'showcase'
      ? THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp((spotlightElapsed - SPOTLIGHT_FLY_IN_DURATION) / 0.72, 0, 1),
        0,
        1
      )
      : 0;
    const spotlightDancePhase = spotlightElapsed * 2.15 + motion.phase;
    const spotlightTwistYaw = Math.sin(spotlightDancePhase + 0.35)
      * SPOTLIGHT_TWIST_ANGLE
      * spotlightDanceEnvelope;
    const spotlightTwistRoll = Math.sin(spotlightDancePhase * 2)
      * SPOTLIGHT_ROLL_ANGLE
      * spotlightDanceEnvelope;

    let spotlightReveal = 1;
    if (isSpotlight && (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase')) {
      if (!spotlightAnchorRef.current) spotlightAnchorRef.current = new THREE.Vector3();
      camera.getWorldDirection(spotlightAnchorRef.current)
        .multiplyScalar(SPOTLIGHT_OUTER_LAYER_DISTANCE)
        .add(camera.position);
      wasSpotlightRef.current = true;
      spotlightReleaseStartedRef.current = false;
      group.position.copy(spotlightAnchorRef.current);
    } else if (isSpotlight && spotlight.phase === 'release' && spotlightAnchorRef.current) {
      if (!spotlightReleaseStartedRef.current || spotlightPreviousPhaseRef.current !== 'release') {
        spotlightLandingRef.current = getSpotlightLandingPosition(index);
        spotlightReleaseTrailStartRef.current = spotlightAnchorRef.current.clone();
        spotlightReleaseTrailEndRef.current = spotlightLandingRef.current.clone();
        spotlightReleaseTrailStartedAtRef.current = wallTime;
        spotlightReleaseStartedRef.current = true;
      }
      if (spotlightLandingRef.current) {
        spotlightReleaseTrailEndRef.current?.copy(spotlightLandingRef.current);
        group.position.lerpVectors(spotlightAnchorRef.current, spotlightLandingRef.current, releaseEased);
      }
    } else if (isSpotlightHold && spotlightLandingRef.current) {
      const returnStart = SPOTLIGHT_FEATURED_HOLD_DURATION - SPOTLIGHT_FEATURED_RETURN_DURATION;
      const returnProgress = THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp(
          (spotlightHoldAge - returnStart) / SPOTLIGHT_FEATURED_RETURN_DURATION,
          0,
          1
        ),
        0,
        1
      );
      const featuredPosition = spotlightLandingRef.current.clone().add(new THREE.Vector3(
        Math.sin(spotlightHoldAge * 0.42 + motion.phase) * 0.34,
        Math.sin(spotlightHoldAge * 0.58 + motion.phase * 0.7) * 0.18,
        Math.cos(spotlightHoldAge * 0.36 + motion.phase) * 0.22
      ));
      group.position.lerpVectors(featuredPosition, pathWorldPosition, returnProgress);
      wasSpotlightRef.current = false;
      spotlightAnchorRef.current = null;
      spotlightReleaseStartedRef.current = false;
    } else {
      wasSpotlightRef.current = false;
      spotlightAnchorRef.current = null;
      spotlightLandingRef.current = null;
      spotlightReleaseStartedRef.current = false;
      group.position.copy(pathWorldPosition);
    }
    if (interactionOverride && !isSpotlight) {
      group.position.copy(interactionOverride);
    }

    if (isSpotlight && (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase')) {
      const focusProgress = spotlight.phase === 'fly-in'
        ? spotlightApproachEased(spotlightElapsed)
        : 1;
      spotlightFocusRef.current = focusProgress;
      spotlightReveal = spotlight.phase === 'showcase'
        ? 1
        : spotlightApproachEased(spotlightElapsed);
      const spotlightDisplayScale = motion.baseScale * 1.08;
      // Entry particles render above this group. Starting smaller makes the
      // creature read as emerging from behind the blast instead of popping on.
      group.scale.setScalar(
        spotlightDisplayScale * THREE.MathUtils.lerp(0.62, 1.015, spotlightReveal)
      );
    } else if (isSpotlight && spotlight.phase === 'release') {
      spotlightFocusRef.current = 1 - releaseProgress;
      const spotlightDisplayScale = motion.baseScale * 1.08 * 1.015;
      group.scale.setScalar(THREE.MathUtils.lerp(
        spotlightDisplayScale,
        normalScale,
        releaseEased
      ));
    } else if (isSpotlightHold) {
      spotlightFocusRef.current = 0;
      group.scale.setScalar(motion.baseScale * 1.02);
    } else {
      spotlightFocusRef.current = 0;
      group.scale.setScalar(normalScale);
    }
    group.scale.multiplyScalar(interactionScale);
    const pulseAge = wallTime - pulseStartedAtRef.current;
    pulseRef.current = pulseAge < 1.15 ? Math.sin((1 - pulseAge / 1.15) * Math.PI) * 0.9 : 0;
    const burstAge = wallTime - burstStartedAtRef.current;
    const burstDuration = splatUrl ? 1.85 : 1.65;
    const burstActive = burstAge >= 0 && burstAge < burstDuration;
    const burstProgress = THREE.MathUtils.clamp(burstAge / burstDuration, 0, 1);
    burstRef.current = burstActive ? Math.sin(burstProgress * Math.PI) : 0;
    burstPhaseRef.current = burstActive ? burstProgress : 1;

    const followsTrappedPlanet = Boolean(
      burstActive
      && interactionActive
      && interactionEvent?.kind === 'trapped'
    );
    if (followsTrappedPlanet) {
      if (!burstAnchorRef.current) burstAnchorRef.current = group.position.clone();
      else burstAnchorRef.current.copy(group.position);
    }

    if (burstActive && !burstWasActiveRef.current) {
      const previousBurstAnchor = burstAnchorRef.current?.clone() ?? group.position.clone();
      const nextRespawnPosition = pickRespawnPosition(previousBurstAnchor);
      burstAnchorRef.current = previousBurstAnchor;
      burstWasActiveRef.current = true;
      respawnPositionRef.current = nextRespawnPosition;
      respawnStartedAtRef.current = wallTime;
    }

    if (!burstActive && burstWasActiveRef.current) {
      burstWasActiveRef.current = false;
      if (!respawnPositionRef.current) {
        const previousBurstAnchor = burstAnchorRef.current?.clone();
        const nextRespawnPosition = pickRespawnPosition(previousBurstAnchor);
        respawnPositionRef.current = nextRespawnPosition;
        respawnStartedAtRef.current = wallTime;
      }
      burstAnchorRef.current = null;
    }

    if (burstActive && burstAnchorRef.current) {
      group.position.copy(burstAnchorRef.current);
      respawnVisibilityRef.current = 1 - THREE.MathUtils.smootherstep(burstProgress, 0.015, 0.2);
    } else if (respawnPositionRef.current) {
      const respawnAge = wallTime - respawnStartedAtRef.current;
      const visibleAge = Math.max(0, respawnAge - burstDuration - 0.12);
      const fadeProgress = THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp(visibleAge / RESPAWN_REAPPEAR_DURATION, 0, 1),
        0,
        1
      );
      const returnProgress = THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp(
          (visibleAge - RESPAWN_RETURN_DELAY) / RESPAWN_RETURN_DURATION,
          0,
          1
        ),
        0,
        1
      );
      group.position.lerpVectors(respawnPositionRef.current, pathWorldPosition, returnProgress);
      respawnVisibilityRef.current = fadeProgress;
      group.scale.multiplyScalar(THREE.MathUtils.lerp(0.76, 1, fadeProgress));

      if (returnProgress >= 0.995) {
        respawnPositionRef.current = null;
        respawnVisibilityRef.current = 1;
      }
    } else {
      respawnVisibilityRef.current = 1;
    }
    if (!interactionActive || interactionEvent?.kind !== 'portal') portalVisibilityRef.current = 1;
    reappearRef.current = Math.min(
      portalVisibilityRef.current,
      respawnVisibilityRef.current,
      spotlightReveal
    );

    creatureViewPositionRef.current.copy(group.position).applyMatrix4(camera.matrixWorldInverse);
    dadakidoViewPositionRef.current
      .set(...DADAKIDO_WORLD_POSITION)
      .applyMatrix4(camera.matrixWorldInverse);
    const creatureViewDepth = -creatureViewPositionRef.current.z;
    const dadakidoViewDepth = -dadakidoViewPositionRef.current.z;
    creatureRenderOrderRef.current = resolveCreatureRenderOrder(
      creatureViewDepth,
      dadakidoViewDepth
    );
    group.renderOrder = creatureRenderOrderRef.current;
    const visualScale = visualRef.current?.scale.x ?? 1;
    const occluderScale = group.scale.x * visualScale;
    const occlusionTransitionDepth = THREE.MathUtils.clamp(
      planeHeight * occluderScale * 0.22,
      0.75,
      2.2
    );
    const occlusionStrength = resolveCreatureOcclusionStrength(
      creatureViewDepth,
      dadakidoViewDepth,
      occlusionTransitionDepth
    ) * THREE.MathUtils.smoothstep(reappearRef.current, 0.08, 0.42);
    updateDadakidoOccluder(
      artwork.id,
      group.position,
      planeWidth * occluderScale * 0.62,
      planeHeight * occluderScale * 0.62,
      occlusionStrength
    );
    if (previewMeshRef.current) {
      previewMeshRef.current.renderOrder = creatureRenderOrderRef.current + 3;
    }

    visibleInteractionPositionRef.current.copy(group.position);
    if (showEntryTrail) {
      if (!entryTrailHeadRef.current) entryTrailHeadRef.current = group.position.clone();
      else entryTrailHeadRef.current.copy(group.position);
    }
    if (isSpotlight && spotlight.phase === 'release') {
      if (!spotlightReleaseTrailHeadRef.current) {
        spotlightReleaseTrailHeadRef.current = group.position.clone();
      } else {
        spotlightReleaseTrailHeadRef.current.copy(group.position);
      }
    }
    if (interactionMeshRef.current) {
      interactionMeshRef.current.position.copy(visibleInteractionPositionRef.current);
      interactionMeshRef.current.scale.setScalar(group.scale.x);
    }

    useCreatureBehaviorStore.getState().setCreaturePosition(artwork.id, [
      group.position.x,
      group.position.y,
      group.position.z
    ]);

    // Face the final rendered position towards the camera. This must run after
    // spotlight, interaction and respawn overrides; using the unmodified orbit
    // position made a held close-up slowly turn away from the audience.
    const targetCameraFacingYaw = Math.atan2(
      camera.position.x - group.position.x,
      camera.position.z - group.position.z
    );
    const audienceSwayAmplitude = isSpotlight
      ? 0
      : (isSpotlightHold ? FEATURED_SWAY_ANGLE : AUDIENCE_SWAY_ANGLE);
    const audienceSway = Math.sin(time * 0.36 + motion.phase) * audienceSwayAmplitude;
    const desiredCameraFacingYaw = targetCameraFacingYaw + audienceSway;
    if (!cameraFacingInitializedRef.current) {
      // Do not let a newly mounted creature spend its first frames turning from
      // the default world angle into view.
      cameraFacingYawRef.current = desiredCameraFacingYaw;
      cameraFacingInitializedRef.current = true;
    } else {
      cameraFacingYawRef.current = THREE.MathUtils.damp(
        cameraFacingYawRef.current,
        desiredCameraFacingYaw,
        isSpotlight || isSpotlightHold ? 8.5 : 6.2,
        delta
      );
    }

    if (visual) {
      const splatFocus = splatUrl ? spotlightFocusRef.current : 0;
      const freeSplatMotion = splatUrl ? 1 - splatFocus : 0;
      visual.position.set(
        splatUrl ? 0 : Math.sin(time * 0.34 + motion.phase * 0.9) * 0.055 * freeSplatMotion,
        Math.sin(time * 0.48 + motion.phase) * 0.12 * freeSplatMotion,
        Math.sin(time * 0.28 + motion.phase * 1.4) * 0.16 * freeSplatMotion
      );

      const velocity = group.position.clone().sub(lastPositionRef.current);
      const rollFromPath = THREE.MathUtils.clamp(
        tangent.x * -0.28 + tangent.z * 0.12 + velocity.x * -1.4,
        -0.22,
        0.22
      );
      const readableRoll = THREE.MathUtils.clamp(
        rollFromPath
          + basePose.rotationZ * 0.28
          + actionPose.roll * 0.12
          + Math.sin(time * 0.62 + motion.phase) * preset.rotationAmount * 0.18,
        -0.12,
        0.12
      );
      const truePitch = THREE.MathUtils.clamp(
        Math.sin(time * 0.18 + motion.phase * 0.7) * 0.07
          + tangent.z * 0.06
          + Math.sin(time * basePose.waveFrequency + motion.phase) * basePose.waveAmplitude * 0.04,
        -Math.PI / 12,
        Math.PI / 12
      );
      const focusAmount = spotlightFocusRef.current;
      const splatPoseLock = focusAmount;
      const overallRoll = actionSpinRef.current + interactionRoll;
      const readableInteractionYaw = THREE.MathUtils.clamp(
        interactionYaw * (1 - splatPoseLock),
        -MAX_INTERACTION_FACING_OFFSET,
        MAX_INTERACTION_FACING_OFFSET
      );
      if (splatUrl) {
        visual.rotation.set(
          interactionPitch * (1 - splatPoseLock),
          cameraFacingYawRef.current + readableInteractionYaw + spotlightTwistYaw,
          overallRoll * (1 - splatPoseLock) + spotlightTwistRoll
        );
      } else {
        visual.rotation.set(
          THREE.MathUtils.lerp(truePitch + interactionPitch, 0, splatPoseLock),
          cameraFacingYawRef.current + readableInteractionYaw + spotlightTwistYaw,
          THREE.MathUtils.lerp(readableRoll + overallRoll, 0, splatPoseLock) + spotlightTwistRoll
        );
      }

      const breathAmount = THREE.MathUtils.lerp(0.045, 0.008, focusAmount);
      const breath = 1 + Math.sin(time * 1.35 + motion.phase) * breathAmount;
      const poseScale = THREE.MathUtils.lerp(
        1,
        (basePose.scaleX + basePose.scaleY + actionPose.scaleX + actionPose.scaleY) * 0.25,
        THREE.MathUtils.lerp(0.32, 0.08, focusAmount)
      );
      visual.scale.setScalar(breath * poseScale);
    }

    lastPositionRef.current.copy(group.position);

    // ── Preview image plane opacity ──
    const foregroundOpacity = creatureRenderOrderRef.current === CREATURE_FRONT_RENDER_ORDER
      ? 0.9
      : 0.72;
    previewMaterial.opacity = splatUrl
      ? 0
      : spotlightFocusRef.current * foregroundOpacity;
    previewMaterial.needsUpdate = true;
    spotlightPreviousPhaseRef.current = spotlight.phase;
  });

  return (
    <>
      {showEntryTrail ? (
        <RespawnMeteorTrail
          startRef={entryTrailStartRef}
          endRef={entryTrailEndRef}
          startedAtRef={entryTrailStartedAtRef}
          headPositionRef={entryTrailHeadRef}
          duration={1.25}
          renderOrderBase={6}
          renderOrderRef={creatureRenderOrderRef}
        />
      ) : null}
      <RespawnMeteorTrail
        startRef={spotlightReleaseTrailStartRef}
        endRef={spotlightReleaseTrailEndRef}
        startedAtRef={spotlightReleaseTrailStartedAtRef}
        headPositionRef={spotlightReleaseTrailHeadRef}
        duration={SPOTLIGHT_RELEASE_DURATION}
        renderOrderRef={creatureRenderOrderRef}
      />
      <RespawnMeteorTrail
        startRef={suctionTrailStartRef}
        endRef={suctionTrailEndRef}
        startedAtRef={suctionTrailStartedAtRef}
        duration={2.1}
        renderOrderBase={9}
        renderOrderRef={creatureRenderOrderRef}
      />
      <group ref={groupRef} renderOrder={10}>
      <group ref={visualRef}>
        {!splatUrl ? (
          <ParticleCreatureTrail
            particles={artwork.particles}
            seed={motion.seed}
            intensity={preset.trailIntensity * 0.42}
            spotlightFocusRef={spotlightFocusRef}
            renderOrderRef={creatureRenderOrderRef}
          />
        ) : null}

        {splatUrl ? (
          <SplatCreatureModel
            url={splatUrl}
            rigUrl={artwork.gaussianModel?.rigUrl}
            colors={artwork.features.visualTraits.dominantColors}
            features={artwork.features}
            scale={1.1}
            spotlightFocusRef={spotlightFocusRef}
            burstRef={burstRef}
            burstPhaseRef={burstPhaseRef}
            reappearRef={reappearRef}
            renderOrderRef={creatureRenderOrderRef}
            partActionRef={partActionRef}
            onReady={() => {
              setSplatReadyUrl(splatUrl);
            }}
            onError={(error) => {
              setSplatReadyUrl(null);
              useSketchStore.getState().cancelSpotlight(artwork.id);
              console.warn('[triposplat] failed to render splat model:', error);
            }}
          />
        ) : null}

        {!splatUrl ? (
          <ParticleCreature
            particles={artwork.particles}
            flowAmount={preset.flowAmount * 0.62}
            breathAmount={0.018 + artwork.behaviorSignature.glow * 0.018}
            behaviorSignature={artwork.behaviorSignature}
            interactionPulseRef={pulseRef}
            burstPhaseRef={burstPhaseRef}
            reappearRef={reappearRef}
            spotlightFocusRef={spotlightFocusRef}
            renderOrderRef={creatureRenderOrderRef}
            partActionRef={partActionRef}
            spotlightEnabled={spotlightEnabled}
          />
        ) : null}

        {!splatUrl ? (
          <CreatureAuraDust
            particles={artwork.particles}
            width={planeWidth}
            height={planeHeight}
            seed={motion.seed}
            motionType={artwork.motionType}
            spotlightFocusRef={spotlightFocusRef}
            renderOrderRef={creatureRenderOrderRef}
          />
        ) : null}

        {/* Preview image plane — shows the original artwork during spotlight */}
        {!splatUrl ? (
          <mesh
            ref={previewMeshRef}
            material={previewMaterial}
            renderOrder={3}
            position={[0, 0, -0.12]}
            frustumCulled
          >
            <planeGeometry args={[planeWidth, planeHeight]} />
          </mesh>
        ) : null}
      </group>
      <CreatureDustFeeding
        creatureId={artwork.id}
        seed={motion.seed}
        renderOrderRef={creatureRenderOrderRef}
        reappearRef={reappearRef}
      />
      <CreatureLevelBadge
        creatureId={artwork.id}
        index={index}
        height={planeHeight}
        renderOrderRef={creatureRenderOrderRef}
        reappearRef={reappearRef}
      />
      <CreatureEventParticles signalRef={effectSignalRef} />
      <CreatureSuctionVortex creatureId={artwork.id} />
      </group>
      <mesh
        ref={interactionMeshRef}
        material={interactionMaterial}
        userData={markCreaturePriorityHit()}
        onPointerDown={() => {
          if (spotlightEnabled || spotlightRequested || useCreatureInteractionStore.getState().events[artwork.id]) {
            return;
          }
          const now = performance.now() * 0.001;
          burstAnchorRef.current = visibleInteractionPositionRef.current.clone();
          respawnPositionRef.current = null;
          burstWasActiveRef.current = false;
          pulseStartedAtRef.current = now;
          burstStartedAtRef.current = now;
          burstPhaseRef.current = 0;
          reappearRef.current = 0;
        }}
      >
        <sphereGeometry args={[Math.max(planeWidth, planeHeight) * 0.58, 16, 10]} />
      </mesh>
    </>
  );
}
