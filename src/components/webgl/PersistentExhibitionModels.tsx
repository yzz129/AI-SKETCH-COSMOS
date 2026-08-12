import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import {
  fetchDisplayExhibitionModels,
  type DisplayExhibitionModel
} from '../../lib/artwork/displayExhibitionModels';
import type { MotionPreset } from '../../types/artwork';
import { DADAKIDO_WORLD_POSITION } from './cosmicAnchors';
import { GeneratedArtworkModel } from './GeneratedArtworkModel';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import {
  EXHIBITION_COLLISION_RADIUS,
  EXHIBITION_REACTION_DURATION,
  triggerExhibitionCollisionReaction
} from './exhibitionCollision';

type PersistentExhibitionModelDefinition = {
  id: string;
  name: string;
  modelUrl: string;
  color: string;
  offset: readonly [number, number, number];
  scale: number;
  phase: number;
  sourceFolder?: string;
  sourceImage?: string;
  referenceMode?: string;
};

const EXHIBITION_MOTION_PRESET: MotionPreset = 'characterBounce';
// Do not upload all 23 GLBs to WebGL in one burst. Three requests in flight
// keep texture decode and GPU upload smooth. Ordinary artworks are admitted
// only after this queue has fully completed.
const EXHIBITION_MODEL_LOAD_CONCURRENCY = 3;
const COLLISION_CHECK_INTERVAL_SECONDS = 0.12;
const COLLISION_PAIR_COOLDOWN_SECONDS = 2.4;
const FRONT_HOLD_RATIO = 0.68;

function frontWeightedYaw(cycle: number) {
  const normalized = THREE.MathUtils.euclideanModulo(cycle, Math.PI * 2) / (Math.PI * 2);
  if (normalized < FRONT_HOLD_RATIO) {
    return Math.sin((normalized / FRONT_HOLD_RATIO) * Math.PI * 2) * 0.1;
  }
  const progress = (normalized - FRONT_HOLD_RATIO) / (1 - FRONT_HOLD_RATIO);
  const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
  return eased * Math.PI * 2;
}

class ExhibitionModelErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // A missing/corrupt model must not permanently block the remaining GLB
    // queue or prevent ordinary artworks from entering the scene.
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The positions are deliberately authored outside the normal artwork orbit.
// This keeps these works visible while the ordinary 27-creature activity
// system rotates, bubbles, and evolves its own records.
const EXHIBITION_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-9.5, 4.0, 3.4], [-5.7, 4.15, 3.8], [-1.9, 3.92, 4.15], [1.9, 4.12, 3.55], [5.7, 3.94, 4.0], [9.5, 4.08, 3.45],
  [-9.35, 1.34, 4.0], [-5.55, 1.14, 3.5], [-1.75, 1.42, 3.9], [2.05, 1.18, 3.45], [5.85, 1.4, 4.1], [9.65, 1.2, 3.65],
  [-9.6, -1.28, 3.55], [-5.8, -1.48, 4.05], [-2.0, -1.18, 3.5], [1.8, -1.46, 3.95], [5.6, -1.2, 3.55], [9.4, -1.5, 4.05],
  [-9.45, -3.94, 4.05], [-5.65, -4.12, 3.5], [-1.85, -3.88, 3.95], [1.95, -4.16, 3.45], [5.75, -3.92, 4.0]
] as const;

const EXHIBITION_COLORS = [
  '#63e6be', '#ffc857', '#b794ff', '#63b3ed', '#ff8fab', '#7ee7ff',
  '#a7f3d0', '#ffb86b', '#c4b5fd', '#67e8f9', '#fda4af', '#bef264',
  '#f9a8d4', '#93c5fd', '#fcd34d', '#86efac', '#d8b4fe', '#fdba74',
  '#5eead4', '#f0abfc', '#fde68a', '#a5b4fc', '#fca5a5'
] as const;

const STATIC_EXHIBITION_MODELS: readonly PersistentExhibitionModelDefinition[] = [
  { id: 'civilization-seeder', name: '文明播种者', modelUrl: '/exhibition-models/civilization-seeder.glb', color: '#63e6be', scale: 0.46, phase: 0.4, offset: EXHIBITION_OFFSETS[0] },
  { id: 'suiqi-new-life', name: '穗启•新生', modelUrl: '/exhibition-models/suiqi-new-life.glb', color: '#ffc857', scale: 0.46, phase: 2.1, offset: EXHIBITION_OFFSETS[1] },
  { id: 'rice-cup-creative', name: '水稻杯文创', modelUrl: '/exhibition-models/rice-cup-creative.glb', color: '#b794ff', scale: 0.46, phase: 4.2, offset: EXHIBITION_OFFSETS[2] },
  { id: 'award-01', name: '稻香亭', modelUrl: '/exhibition-models/award-01.glb', color: EXHIBITION_COLORS[3], scale: 0.42, phase: 0.9, offset: EXHIBITION_OFFSETS[3] },
  { id: 'award-02', name: '穗穗', modelUrl: '/exhibition-models/award-02.glb', color: EXHIBITION_COLORS[4], scale: 0.42, phase: 1.4, offset: EXHIBITION_OFFSETS[4] },
  { id: 'award-03', name: '稻禾三生', modelUrl: '/exhibition-models/award-03.glb', color: EXHIBITION_COLORS[5], scale: 0.42, phase: 1.9, offset: EXHIBITION_OFFSETS[5] },
  { id: 'award-04', name: '三畴禾序', modelUrl: '/exhibition-models/award-04.glb', color: EXHIBITION_COLORS[6], scale: 0.42, phase: 2.4, offset: EXHIBITION_OFFSETS[6] },
  { id: 'award-05', name: '播种文明', modelUrl: '/exhibition-models/award-05.glb', color: EXHIBITION_COLORS[7], scale: 0.4, phase: 2.9, offset: EXHIBITION_OFFSETS[7] },
  { id: 'award-06', name: '春华秋实', modelUrl: '/exhibition-models/award-06.glb', color: EXHIBITION_COLORS[8], scale: 0.4, phase: 3.4, offset: EXHIBITION_OFFSETS[8] },
  { id: 'award-07', name: '稻生五态', modelUrl: '/exhibition-models/award-07.glb', color: EXHIBITION_COLORS[9], scale: 0.4, phase: 3.9, offset: EXHIBITION_OFFSETS[9] },
  { id: 'award-08', name: 'GSA-6种植机', modelUrl: '/exhibition-models/award-08.glb', color: EXHIBITION_COLORS[10], scale: 0.4, phase: 4.4, offset: EXHIBITION_OFFSETS[10] },
  { id: 'award-09', name: '环水稻居图', modelUrl: '/exhibition-models/award-09.glb', color: EXHIBITION_COLORS[11], scale: 0.4, phase: 4.9, offset: EXHIBITION_OFFSETS[11] },
  { id: 'award-10', name: '岁登', modelUrl: '/exhibition-models/award-10.glb', color: EXHIBITION_COLORS[12], scale: 0.42, phase: 5.4, offset: EXHIBITION_OFFSETS[12] },
  { id: 'award-11', name: '禾下星球', modelUrl: '/exhibition-models/award-11.glb', color: EXHIBITION_COLORS[13], scale: 0.4, phase: 5.9, offset: EXHIBITION_OFFSETS[13] },
  { id: 'award-12', name: '禾小满', modelUrl: '/exhibition-models/award-12.glb', color: EXHIBITION_COLORS[14], scale: 0.4, phase: 6.4, offset: EXHIBITION_OFFSETS[14] },
  { id: 'award-13', name: '禾穗折扇', modelUrl: '/exhibition-models/award-13.glb', color: EXHIBITION_COLORS[15], scale: 0.4, phase: 6.9, offset: EXHIBITION_OFFSETS[15] },
  { id: 'award-14', name: '稻乡集', modelUrl: '/exhibition-models/award-14.glb', color: EXHIBITION_COLORS[16], scale: 0.4, phase: 7.4, offset: EXHIBITION_OFFSETS[16] },
  { id: 'award-15', name: '稻护云台', modelUrl: '/exhibition-models/award-15.glb', color: EXHIBITION_COLORS[17], scale: 0.4, phase: 7.9, offset: EXHIBITION_OFFSETS[17] },
  { id: 'award-16', name: '稻舞四季', modelUrl: '/exhibition-models/award-16.glb', color: EXHIBITION_COLORS[18], scale: 0.4, phase: 8.4, offset: EXHIBITION_OFFSETS[18] },
  { id: 'award-17', name: '稻韵金饰', modelUrl: '/exhibition-models/award-17.glb', color: EXHIBITION_COLORS[19], scale: 0.4, phase: 8.9, offset: EXHIBITION_OFFSETS[19] },
  { id: 'award-18', name: '米团团', modelUrl: '/exhibition-models/award-18.glb', color: EXHIBITION_COLORS[20], scale: 0.4, phase: 9.4, offset: EXHIBITION_OFFSETS[20] },
  { id: 'award-19', name: '米多多', modelUrl: '/exhibition-models/award-19.glb', color: EXHIBITION_COLORS[21], scale: 0.4, phase: 9.9, offset: EXHIBITION_OFFSETS[21] },
  { id: 'award-20', name: '口口米', modelUrl: '/exhibition-models/award-20.glb', color: EXHIBITION_COLORS[22], scale: 0.4, phase: 10.4, offset: EXHIBITION_OFFSETS[22] }
] as const;

export function PersistentExhibitionModels({ onAllReady }: { onAllReady?: () => void }) {
  const [models, setModels] = useState<readonly PersistentExhibitionModelDefinition[]>(STATIC_EXHIBITION_MODELS);
  const [enabledModelCount, setEnabledModelCount] = useState(
    Math.min(EXHIBITION_MODEL_LOAD_CONCURRENCY, STATIC_EXHIBITION_MODELS.length)
  );
  const readyModelIdsRef = useRef(new Set<string>());
  const [readyModelCount, setReadyModelCount] = useState(0);

  const handleModelReady = useCallback((id: string) => {
    if (readyModelIdsRef.current.has(id)) return;
    readyModelIdsRef.current.add(id);
    setReadyModelCount(readyModelIdsRef.current.size);
    setEnabledModelCount((current) => Math.min(models.length, current + 1));
  }, [models.length]);

  useEffect(() => {
    let mounted = true;
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel('exhibition-model-library-changed')
      : null;
    const sync = () => {
      void fetchDisplayExhibitionModels().then((records) => {
        if (!mounted || records.length === 0) return;
        const staticById = new Map(STATIC_EXHIBITION_MODELS.map((model) => [model.id, model]));
        setModels(records.map((record, index) => {
          const staticModel = staticById.get(record.id);
          if (staticModel) return mergeBackendExhibitionRecord(staticModel, record);
          const fallbackOffset = EXHIBITION_OFFSETS[index % EXHIBITION_OFFSETS.length];
          const layer = Math.floor(index / EXHIBITION_OFFSETS.length);
          return {
            id: record.id,
            name: record.name,
            modelUrl: record.modelUrl,
            color: record.color,
            offset: [fallbackOffset[0], fallbackOffset[1], fallbackOffset[2] - layer * 0.5],
            scale: record.scale,
            phase: index * 0.47 + 0.4,
            sourceFolder: record.sourceFolder ?? undefined,
            sourceImage: record.sourceImage ?? undefined,
            referenceMode: record.referenceMode
          };
        }));
      }).catch(() => {
        // The local static catalog remains usable while the management backend
        // is offline or has not been restarted yet.
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'exhibition-model-library-changed') sync();
    };
    sync();
    channel?.addEventListener('message', sync);
    window.addEventListener('storage', handleStorage);
    return () => {
      mounted = false;
      channel?.removeEventListener('message', sync);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(models.map((model) => model.id));
    readyModelIdsRef.current = new Set(
      [...readyModelIdsRef.current].filter((id) => validIds.has(id))
    );
    setReadyModelCount(readyModelIdsRef.current.size);
    setEnabledModelCount(Math.min(
      models.length,
      readyModelIdsRef.current.size + EXHIBITION_MODEL_LOAD_CONCURRENCY
    ));
  }, [models]);

  useEffect(() => {
    if (models.length > 0 && readyModelCount >= models.length) onAllReady?.();
  }, [models.length, onAllReady, readyModelCount]);

  return (
    <group name="persistent-exhibition-models" renderOrder={18}>
      <hemisphereLight args={['#ffffff', '#243047', 1.65]} />
      <directionalLight position={[0, 5, 9]} intensity={2.2} color="#fffaf2" />
      <directionalLight position={[-7, -1, 5]} intensity={1.15} color="#d8e8ff" />
      {models.map((model, index) => (
        <PersistentExhibitionModel
          key={model.id}
          model={model}
          loadEnabled={index < enabledModelCount}
          onReady={() => handleModelReady(model.id)}
        />
      ))}
    </group>
  );
}

function mergeBackendExhibitionRecord(
  model: PersistentExhibitionModelDefinition,
  record?: DisplayExhibitionModel
): PersistentExhibitionModelDefinition {
  if (!record) return model;
  const modelUrl = /\/exhibition-models\/[^/]+\.glb(?:[?#].*)?$/i.test(record.modelUrl)
    ? model.modelUrl
    : record.modelUrl;
  return {
    ...model,
    name: record.name || model.name,
    modelUrl,
    color: record.color || model.color,
    scale: record.scale || model.scale,
    // Screen placement is authored by the evenly spaced exhibition layout.
    // Backend positions are intentionally ignored so old records cannot push
    // exhibits into the same cluster after a deployment.
    offset: model.offset,
    sourceFolder: record.sourceFolder ?? model.sourceFolder,
    sourceImage: record.sourceImage ?? model.sourceImage,
    referenceMode: record.referenceMode ?? model.referenceMode
  };
}

function PersistentExhibitionModel({
  model,
  loadEnabled,
  onReady
}: {
  model: PersistentExhibitionModelDefinition;
  loadEnabled: boolean;
  onReady: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const modelMotionRef = useRef<THREE.Group>(null);
  const lastCollisionCheckRef = useRef(-100);
  const reactionStartedAtRef = useRef(-100);
  const collisionCooldownByCreatureRef = useRef(new Map<string, number>());
  const [modelReady, setModelReady] = useState(false);
  const basePosition = useMemo(
    () => new THREE.Vector3(
      DADAKIDO_WORLD_POSITION[0] + model.offset[0],
      DADAKIDO_WORLD_POSITION[1] + model.offset[1],
      DADAKIDO_WORLD_POSITION[2] + model.offset[2]
    ),
    [model.offset]
  );
  const drift = useMemo(() => {
    const seed = Math.abs(Math.sin(model.phase * 13.17));
    return {
      x: 0.3 + seed * 0.2,
      y: 0.22 + (1 - seed) * 0.16,
      z: 0.42 + seed * 0.34,
      phaseA: model.phase * 1.7,
      phaseB: model.phase * 1.13,
      phaseC: model.phase * 0.83,
      yawSpeed: 0.12 + seed * 0.08,
      pitchSpeed: 0.17 + (1 - seed) * 0.08,
      rollSpeed: 0.13 + seed * 0.07
    };
  }, [model.phase]);

  useEffect(() => {
    setModelReady(false);
  }, [model.modelUrl]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const modelMotion = modelMotionRef.current;
    if (!group || !modelMotion) return;

    const t = clock.elapsedTime + model.phase;
    // Exhibition drift is deliberately gentler than ordinary creatures and
    // only transforms the parent group; GLB bones and vertices stay unchanged.
    group.position.set(
      basePosition.x + Math.sin(t * 0.15 + drift.phaseA) * drift.x + Math.cos(t * 0.087 + drift.phaseC) * 0.12,
      basePosition.y + Math.sin(t * 0.18 + drift.phaseB) * drift.y,
      basePosition.z + Math.cos(t * 0.12 + drift.phaseC) * drift.z
    );
    const scalePulse = 1
      + Math.sin(t * 0.23 + drift.phaseA) * 0.14
      + Math.sin(t * 0.11 + drift.phaseC) * 0.05;
    modelMotion.scale.setScalar(scalePulse);
    const yaw = frontWeightedYaw(t * drift.yawSpeed + drift.phaseB);
    modelMotion.position.set(0, 0, 0);
    modelMotion.rotation.set(
      Math.sin(t * drift.pitchSpeed + drift.phaseA) * 0.32,
      yaw,
      Math.sin(t * drift.rollSpeed + drift.phaseC) * 0.18
    );

    if (modelReady && t - lastCollisionCheckRef.current >= COLLISION_CHECK_INTERVAL_SECONDS) {
      lastCollisionCheckRef.current = t;
      const positions = useCreatureBehaviorStore.getState().creaturePositions;
      const radiusSq = EXHIBITION_COLLISION_RADIUS * EXHIBITION_COLLISION_RADIUS;
      for (const [creatureId, position] of Object.entries(positions)) {
        const dx = group.position.x - position[0];
        const dy = group.position.y - position[1];
        const dz = group.position.z - position[2];
        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
        const lastCollision = collisionCooldownByCreatureRef.current.get(creatureId) ?? -100;
        if (t - lastCollision < COLLISION_PAIR_COOLDOWN_SECONDS) continue;
        collisionCooldownByCreatureRef.current.set(creatureId, t);
        reactionStartedAtRef.current = t;
        triggerExhibitionCollisionReaction(creatureId, performance.now() * 0.001);
        break;
      }
    }

    const reactionElapsed = t - reactionStartedAtRef.current;
    if (reactionElapsed >= 0 && reactionElapsed < EXHIBITION_REACTION_DURATION) {
      const reactionProgress = reactionElapsed / EXHIBITION_REACTION_DURATION;
      const reaction = Math.sin(reactionProgress * Math.PI * 6) * (1 - reactionProgress);
      modelMotion.position.set(reaction * 0.1, Math.abs(reaction) * 0.12, 0);
      modelMotion.rotation.z += reaction * 0.2;
      modelMotion.rotation.y += reaction * 0.12;
    }
  });

  const handleReady = useCallback(() => {
    setModelReady(true);
    onReady();
  }, [onReady]);

  return (
    <group ref={groupRef} name={`persistent-exhibition-${model.id}`} renderOrder={20}>
      <group ref={modelMotionRef}>
        {loadEnabled ? (
          <ExhibitionModelErrorBoundary key={model.modelUrl} onError={onReady}>
            <Suspense fallback={null}>
              <GeneratedArtworkModel
                modelUrl={model.modelUrl}
                colors={[model.color, model.color]}
                motionPreset={EXHIBITION_MOTION_PRESET}
                scale={model.scale}
                onReady={handleReady}
                staticModel
              />
            </Suspense>
          </ExhibitionModelErrorBoundary>
        ) : null}
      </group>
      {modelReady ? (
        <Billboard follow position={[0, 0.54, 0]}>
          <Text
            color={model.color}
            fontSize={0.105}
            maxWidth={1.55}
            lineHeight={1.08}
            overflowWrap="break-word"
            textAlign="center"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.008}
            outlineColor="#07111f"
            depthOffset={-5}
            renderOrder={60}
          >
            {model.name}
          </Text>
        </Billboard>
      ) : null}
    </group>
  );
}
