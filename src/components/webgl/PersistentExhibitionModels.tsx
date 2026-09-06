import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import {
  fetchDisplayExhibitionModels,
  type DisplayExhibitionModel
} from '../../lib/artwork/displayExhibitionModels';
import { useSketchStore } from '../../stores/useSketchStore';
import type { MotionPreset } from '../../types/artwork';
import { DADAKIDO_WORLD_POSITION } from './cosmicAnchors';
import {
  GeneratedArtworkModel,
  type GeneratedArtworkModelProfile
} from './GeneratedArtworkModel';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import {
  EXHIBITION_COLLISION_RADIUS,
  EXHIBITION_REACTION_DURATION,
  triggerExhibitionCollisionReaction
} from './exhibitionCollision';
import { spotlightReleaseEased, spotlightShowcaseTurn } from './spotlightMotion';
import {
  exhibitionEntryFocusId,
  exhibitionInteractionId
} from './exhibitionInteraction';
import { useCreatureInteractionStore } from './creatureInteractionStore';
import { getGalaxyPortal } from './galaxyPortalRegistry';
import { portalSuctionProgress } from './galaxyPortalRouting';

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
  releaseResourcesOnUnmount?: boolean;
  flipFlatFacing?: boolean;
};

export type DesignerDisplayCatalogEntry = {
  id: string;
  createdAt: number;
};

const EXHIBITION_MOTION_PRESET: MotionPreset = 'characterBounce';
// Do not upload all GLBs to WebGL in one burst. Three requests in flight keep
// texture decode and GPU upload smooth while ready models can already move and
// take turns in the foreground.
const EXHIBITION_MODEL_LOAD_CONCURRENCY = 3;
const COLLISION_CHECK_INTERVAL_SECONDS = 0.12;
const COLLISION_PAIR_COOLDOWN_SECONDS = 2.4;
const FRONT_HOLD_RATIO = 0.68;
const PHOTO_SHOWCASE_DURATION_MS = 10_000;
const PHOTO_SHOWCASE_TRAVEL_SECONDS = 1.25;
const PHOTO_SHOWCASE_BACK_DISTANCE = 15.2;
const PHOTO_SHOWCASE_FRONT_DISTANCE = 7.4;
const EXHIBITION_DRIFT_SPEED = 1.7;
const PORTAL_EMERGE_DURATION = 1.8;
const ignoreEntryFocus = () => undefined;

function nextEnabledModelIds(
  models: readonly PersistentExhibitionModelDefinition[],
  readyModelIds: ReadonlySet<string>,
  currentEnabledModelIds: ReadonlySet<string>
) {
  const validModelIds = new Set(models.map((model) => model.id));
  const next = new Set(
    [...currentEnabledModelIds].filter((id) => validModelIds.has(id))
  );
  const targetCount = Math.min(
    models.length,
    readyModelIds.size + EXHIBITION_MODEL_LOAD_CONCURRENCY
  );
  for (const model of models) {
    if (next.size >= targetCount) break;
    next.add(model.id);
  }
  return next;
}

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
// This keeps these works visible while the ordinary 17-creature activity
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
  { id: 'award-14', name: '稻乡集', modelUrl: '/exhibition-models/award-14.glb', color: EXHIBITION_COLORS[16], scale: 0.4, phase: 7.4, offset: EXHIBITION_OFFSETS[16], flipFlatFacing: true },
  { id: 'award-15', name: '稻护云台', modelUrl: '/exhibition-models/award-15.glb', color: EXHIBITION_COLORS[17], scale: 0.4, phase: 7.9, offset: EXHIBITION_OFFSETS[17] },
  { id: 'award-16', name: '稻舞四季', modelUrl: '/exhibition-models/award-16.glb', color: EXHIBITION_COLORS[18], scale: 0.4, phase: 8.4, offset: EXHIBITION_OFFSETS[18] },
  { id: 'award-17', name: '稻韵金饰', modelUrl: '/exhibition-models/award-17.glb', color: EXHIBITION_COLORS[19], scale: 0.4, phase: 8.9, offset: EXHIBITION_OFFSETS[19] },
  { id: 'award-18', name: '米团团', modelUrl: '/exhibition-models/award-18.glb', color: EXHIBITION_COLORS[20], scale: 0.4, phase: 9.4, offset: EXHIBITION_OFFSETS[20] },
  { id: 'award-19', name: '米多多', modelUrl: '/exhibition-models/award-19.glb', color: EXHIBITION_COLORS[21], scale: 0.4, phase: 9.9, offset: EXHIBITION_OFFSETS[21] },
  { id: 'award-20', name: '口口米', modelUrl: '/exhibition-models/award-20.glb', color: EXHIBITION_COLORS[22], scale: 0.4, phase: 10.4, offset: EXHIBITION_OFFSETS[22] }
] as const;

export function PersistentExhibitionModels({
  visibleDesignerModelIds,
  onDesignerCatalogChange,
  onAllReady
}: {
  visibleDesignerModelIds: readonly string[];
  onDesignerCatalogChange?: (entries: readonly DesignerDisplayCatalogEntry[]) => void;
  onAllReady?: () => void;
}) {
  const [awardModels, setAwardModels] = useState<readonly PersistentExhibitionModelDefinition[]>(STATIC_EXHIBITION_MODELS);
  const [designerModels, setDesignerModels] = useState<readonly PersistentExhibitionModelDefinition[]>([]);
  const spotlightBusy = useSketchStore((state) => Boolean(
    state.spotlight.creatureId
    || state.spotlight.requestedCreatureId
    || state.spotlight.pendingCreatureId
  ));
  const seenDesignerModelIdsRef = useRef(new Set<string>());
  const designerCatalogInitializedRef = useRef(false);
  const visibleDesignerModels = useMemo(() => {
    const modelById = new Map(designerModels.map((model) => [model.id, model]));
    return visibleDesignerModelIds.flatMap((id) => {
      const model = modelById.get(id);
      return model ? [model] : [];
    });
  }, [designerModels, visibleDesignerModelIds]);
  const models = useMemo(() => [
    // Contest works retain chronological order. A newly published GLB is
    // appended to the showcase queue instead of taking over the foreground.
    ...visibleDesignerModels,
    ...awardModels
  ], [awardModels, visibleDesignerModels]);
  const [enabledModelIds, setEnabledModelIds] = useState<Set<string>>(() => new Set(
    STATIC_EXHIBITION_MODELS
      .slice(0, EXHIBITION_MODEL_LOAD_CONCURRENCY)
      .map((model) => model.id)
  ));
  const modelsRef = useRef(models);
  const readyModelIdsRef = useRef(new Set<string>());
  const visibleContestModelIdsRef = useRef(new Set<string>());
  const [readyModelCount, setReadyModelCount] = useState(0);
  const [showcaseModelId, setShowcaseModelId] = useState<string | null>(null);
  const [showcaseCycleStartedAt, setShowcaseCycleStartedAt] = useState(0);

  const handleModelReady = useCallback((id: string) => {
    if (readyModelIdsRef.current.has(id)) return;
    readyModelIdsRef.current.add(id);
    setReadyModelCount(readyModelIdsRef.current.size);
    setEnabledModelIds((current) => nextEnabledModelIds(
      modelsRef.current,
      readyModelIdsRef.current,
      current
    ));
    if (visibleContestModelIdsRef.current.has(id)) {
      setShowcaseModelId((current) => current ?? id);
      setShowcaseCycleStartedAt((current) => (
        current === 0 ? performance.now() * 0.001 : current
      ));
    }
  }, [models.length]);

  useEffect(() => {
    let mounted = true;
    let pollTimer = 0;
    let lastSignature = '__initial__';
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel('exhibition-model-library-changed')
      : null;
    const sync = () => {
      void fetchDisplayExhibitionModels().then((records) => {
        if (!mounted) return;
        const signature = records.map((record) => `${record.id}:${record.name}:${record.modelUrl}:${record.scale}:${record.entryType}:${record.createdAt ?? ''}`).join('|');
        if (signature === lastSignature) return;
        lastSignature = signature;
        const staticById = new Map(STATIC_EXHIBITION_MODELS.map((model) => [model.id, model]));
        const recordsById = new Map(records.map((record) => [record.id, record]));
        setAwardModels(STATIC_EXHIBITION_MODELS.map((model) => {
          const record = recordsById.get(model.id);
          return record ? mergeBackendExhibitionRecord(model, record) : model;
        }));
        const designerRecords = records
          .filter((record) => !staticById.has(record.id) && record.entryType === 'contest')
          .sort((left, right) => (
            Date.parse(left.createdAt ?? '') - Date.parse(right.createdAt ?? '')
            || left.id.localeCompare(right.id)
          ));
        onDesignerCatalogChange?.(designerRecords.map((record) => ({
          id: record.id,
          createdAt: Number.isFinite(Date.parse(record.createdAt ?? ''))
            ? Date.parse(record.createdAt ?? '')
            : 0
        })));
        if (!designerCatalogInitializedRef.current) {
          designerRecords.forEach((record) => seenDesignerModelIdsRef.current.add(record.id));
          designerCatalogInitializedRef.current = true;
        } else {
          const unseenDesignerRecords = designerRecords
            .filter((record) => !seenDesignerModelIdsRef.current.has(record.id));
          unseenDesignerRecords.forEach((record) => seenDesignerModelIdsRef.current.add(record.id));
        }
        setDesignerModels(designerRecords.map((record, designerIndex) => {
          const index = STATIC_EXHIBITION_MODELS.length + designerIndex;
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
            referenceMode: record.referenceMode,
            releaseResourcesOnUnmount: true
          };
        }));
      }).catch(() => {
        // The local static catalog remains usable while the management backend
        // is offline or has not been restarted yet.
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'exhibition-model-library-changed') return;
      try {
        const detail = JSON.parse(event.newValue ?? '') as { type?: string; id?: string };
        if (detail.type === 'published' && detail.id) seenDesignerModelIdsRef.current.add(detail.id);
      } catch {
        // Legacy timestamp-only notifications still refresh the catalog.
      }
      sync();
    };
    const handleChannelMessage = (event: MessageEvent) => {
      const modelId = typeof event.data?.id === 'string' ? event.data.id : '';
      if (modelId) seenDesignerModelIdsRef.current.add(modelId);
      sync();
    };
    sync();
    pollTimer = window.setInterval(sync, 5_000);
    channel?.addEventListener('message', handleChannelMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      mounted = false;
      window.clearInterval(pollTimer);
      channel?.removeEventListener('message', handleChannelMessage);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [onDesignerCatalogChange]);

  useEffect(() => {
    modelsRef.current = models;
    visibleContestModelIdsRef.current = new Set(
      visibleDesignerModels.map((model) => model.id)
    );
    const validIds = new Set(models.map((model) => model.id));
    readyModelIdsRef.current = new Set(
      [...readyModelIdsRef.current].filter((id) => validIds.has(id))
    );
    setReadyModelCount(readyModelIdsRef.current.size);
    setEnabledModelIds((current) => nextEnabledModelIds(
      models,
      readyModelIdsRef.current,
      current
    ));
  }, [models, visibleDesignerModels]);

  useEffect(() => {
    const allAwardsReady = awardModels.length > 0
      && awardModels.every((model) => readyModelIdsRef.current.has(model.id));
    if (allAwardsReady) onAllReady?.();
  }, [awardModels, onAllReady, readyModelCount]);

  useEffect(() => {
    if (spotlightBusy) return undefined;
    const readyIds = modelsRef.current
      .filter((model) => (
        visibleContestModelIdsRef.current.has(model.id)
        && readyModelIdsRef.current.has(model.id)
      ))
      .map((model) => model.id);
    if (readyIds.length > 0) {
      setShowcaseModelId((current) => (
        current && readyIds.includes(current) ? current : readyIds[0]
      ));
      setShowcaseCycleStartedAt(performance.now() * 0.001);
    }
    const intervalId = window.setInterval(() => {
      const nextReadyIds = modelsRef.current
        .filter((model) => (
          visibleContestModelIdsRef.current.has(model.id)
          && readyModelIdsRef.current.has(model.id)
        ))
        .map((model) => model.id);
      if (nextReadyIds.length === 0) return;
      setShowcaseModelId((current) => {
        const currentIndex = current ? nextReadyIds.indexOf(current) : -1;
        return nextReadyIds[(currentIndex + 1) % nextReadyIds.length];
      });
      setShowcaseCycleStartedAt(performance.now() * 0.001);
    }, PHOTO_SHOWCASE_DURATION_MS);
    return () => window.clearInterval(intervalId);
  }, [spotlightBusy]);

  return (
    <group name="persistent-exhibition-models" renderOrder={18}>
      <hemisphereLight args={['#ffffff', '#243047', 1.65]} />
      <directionalLight position={[0, 5, 9]} intensity={2.2} color="#fffaf2" />
      <directionalLight position={[-7, -1, 5]} intensity={1.15} color="#d8e8ff" />
      {models.map((model) => (
        <PersistentExhibitionModel
          key={model.id}
          model={model}
          loadEnabled={enabledModelIds.has(model.id)}
          showcaseActive={!spotlightBusy && showcaseModelId === model.id}
          showcaseCycleStartedAt={showcaseCycleStartedAt}
          entryFocusRequested={false}
          onEntryFocusStarted={ignoreEntryFocus}
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
  showcaseActive,
  showcaseCycleStartedAt,
  entryFocusRequested,
  onEntryFocusStarted,
  onReady
}: {
  model: PersistentExhibitionModelDefinition;
  loadEnabled: boolean;
  showcaseActive: boolean;
  showcaseCycleStartedAt: number;
  entryFocusRequested: boolean;
  onEntryFocusStarted: (modelId: string) => void;
  onReady: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const modelMotionRef = useRef<THREE.Group>(null);
  const titleMotionRef = useRef<THREE.Group>(null);
  const collisionCheckTickRef = useRef<number | null>(null);
  const reactionStartedAtRef = useRef(-100);
  const showcaseBlendRef = useRef(0);
  const showcasePositionRef = useRef(new THREE.Vector3());
  const cameraDirectionRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const titleAnchorPositionRef = useRef(new THREE.Vector3());
  const fightAnchorRef = useRef(new THREE.Vector3());
  const fightOriginDirectionRef = useRef(new THREE.Vector3());
  const fightPositionRef = useRef(new THREE.Vector3());
  const portalReturnPositionRef = useRef(new THREE.Vector3());
  const portalEntryPositionRef = useRef(new THREE.Vector3());
  const portalExitPositionRef = useRef(new THREE.Vector3());
  const portalNormalRef = useRef(new THREE.Vector3());
  const portalApproachRef = useRef(new THREE.Vector3());
  const portalTangentRef = useRef(new THREE.Vector3());
  const portalEmergenceRef = useRef(new THREE.Vector3());
  const entryFocusPositionRef = useRef<[number, number, number]>([0, 0, 0]);
  const interactionPositionRef = useRef<[number, number, number]>([0, 0, 0]);
  const collisionCooldownByCreatureRef = useRef(new Map<string, number>());
  const entryFocusTriggeredRef = useRef(false);
  const [modelReady, setModelReady] = useState(false);
  const [flatFacing, setFlatFacing] = useState(false);
  const interactionId = useMemo(() => exhibitionInteractionId(model.id), [model.id]);
  const entryFocusId = useMemo(() => exhibitionEntryFocusId(model.id), [model.id]);
  const spotlight = useSketchStore((state) => state.spotlight);
  const interactionEvent = useCreatureInteractionStore((state) => state.events[interactionId]);
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
      y: 0.28 + (1 - seed) * 0.2,
      z: 0.52 + seed * 0.4,
      phaseA: model.phase * 1.7,
      phaseB: model.phase * 1.13,
      phaseC: model.phase * 0.83,
      yawSpeed: 0.28 + seed * 0.16,
      pitchSpeed: 0.34 + (1 - seed) * 0.14,
      rollSpeed: 0.28 + seed * 0.14
    };
  }, [model.phase]);

  useEffect(() => {
    setModelReady(false);
    setFlatFacing(false);
  }, [model.modelUrl]);

  useEffect(() => {
    if (!entryFocusRequested) {
      entryFocusTriggeredRef.current = false;
      useCreatureBehaviorStore.getState().removeCreaturePosition(entryFocusId);
      return;
    }
    if (!modelReady || entryFocusTriggeredRef.current) return;
    entryFocusTriggeredRef.current = true;
    const position = groupRef.current?.position;
    if (position) {
      entryFocusPositionRef.current[0] = position.x;
      entryFocusPositionRef.current[1] = position.y;
      entryFocusPositionRef.current[2] = position.z;
      useCreatureBehaviorStore.getState().setCreaturePosition(
        entryFocusId,
        entryFocusPositionRef.current
      );
    }
    const sketch = useSketchStore.getState();
    sketch.beginSpotlight(entryFocusId);
    sketch.markSpotlightReady(entryFocusId);
    onEntryFocusStarted(model.id);
  }, [entryFocusId, entryFocusRequested, model.id, modelReady, onEntryFocusStarted]);

  useEffect(() => () => {
    useCreatureBehaviorStore.getState().removeCreaturePosition(entryFocusId);
  }, [entryFocusId]);

  useEffect(() => {
    if (loadEnabled && modelReady) return undefined;
    useCreatureBehaviorStore.getState().removeCreaturePosition(interactionId);
    useCreatureInteractionStore.getState().clearEvent(interactionId);
    return undefined;
  }, [interactionId, loadEnabled, modelReady]);

  useEffect(() => () => {
    useCreatureBehaviorStore.getState().removeCreaturePosition(interactionId);
    useCreatureInteractionStore.getState().clearEvent(interactionId);
  }, [interactionId]);

  useFrame(({ clock, camera }, delta) => {
    const group = groupRef.current;
    const modelMotion = modelMotionRef.current;
    const titleMotion = titleMotionRef.current;
    if (!group || !modelMotion) return;

    const t = clock.elapsedTime + model.phase;
    const motionT = clock.elapsedTime * EXHIBITION_DRIFT_SPEED + model.phase;
    const now = performance.now() * 0.001;
    // Exhibition drift is deliberately gentler than ordinary creatures and
    // only transforms the parent group; GLB bones and vertices stay unchanged.
    group.position.set(
      basePosition.x
        + Math.sin(motionT * 0.28 + drift.phaseA) * drift.x
        + Math.cos(motionT * 0.17 + drift.phaseC) * 0.18,
      basePosition.y
        + Math.sin(motionT * 0.32 + drift.phaseB) * drift.y
        + Math.cos(motionT * 0.21 + drift.phaseA) * 0.1,
      basePosition.z
        + Math.cos(motionT * 0.23 + drift.phaseC) * drift.z
        + Math.sin(motionT * 0.14 + drift.phaseB) * 0.16
    );
    const showcaseElapsed = now - showcaseCycleStartedAt;
    const automaticShowcaseTarget = showcaseActive
      ? showcaseElapsed < (PHOTO_SHOWCASE_DURATION_MS / 1_000) - PHOTO_SHOWCASE_TRAVEL_SECONDS
        ? THREE.MathUtils.smoothstep(showcaseElapsed, 0, PHOTO_SHOWCASE_TRAVEL_SECONDS)
        : 1 - THREE.MathUtils.smoothstep(
            showcaseElapsed,
            (PHOTO_SHOWCASE_DURATION_MS / 1_000) - PHOTO_SHOWCASE_TRAVEL_SECONDS,
            PHOTO_SHOWCASE_DURATION_MS / 1_000
          )
      : 0;
    const entryFocusActive = spotlight.creatureId === entryFocusId
      && spotlight.phase !== 'idle';
    const entryFocusElapsed = entryFocusActive
      ? Math.max(0, (Date.now() - spotlight.startedAt) / 1_000)
      : 0;
    const entryFocusTarget = entryFocusActive
      ? spotlight.phase === 'release'
        ? 1 - spotlightReleaseEased(entryFocusElapsed)
        : 1
      : 0;
    const showcaseTarget = Math.max(automaticShowcaseTarget, entryFocusTarget);
    showcaseBlendRef.current = THREE.MathUtils.damp(
      showcaseBlendRef.current,
      showcaseTarget,
      showcaseActive ? 2.2 : 1.5,
      Math.min(delta, 0.05)
    );
    const showcaseBlend = showcaseBlendRef.current;
    const showcaseDurationSeconds = PHOTO_SHOWCASE_DURATION_MS / 1_000;
    const showcaseProgress = THREE.MathUtils.clamp(showcaseElapsed / showcaseDurationSeconds, 0, 1);
    const automaticTurnProgress = THREE.MathUtils.clamp(
      (showcaseElapsed - PHOTO_SHOWCASE_TRAVEL_SECONDS)
        / Math.max(0.001, showcaseDurationSeconds - PHOTO_SHOWCASE_TRAVEL_SECONDS * 2),
      0,
      1
    );
    const showcaseTurn = entryFocusActive
      ? spotlightShowcaseTurn(entryFocusElapsed)
      : automaticTurnProgress * Math.PI * 2;
    if (showcaseBlend > 0.001) {
      // A full depth loop keeps the featured work moving for the entire slot:
      // rear -> foreground -> rear, with a gentle sideways/vertical arc.
      const foregroundProgress = 0.5 - Math.cos(showcaseProgress * Math.PI * 2) * 0.5;
      const showcaseDistance = entryFocusActive
        ? PHOTO_SHOWCASE_FRONT_DISTANCE
        : THREE.MathUtils.lerp(
            PHOTO_SHOWCASE_BACK_DISTANCE,
            PHOTO_SHOWCASE_FRONT_DISTANCE,
            foregroundProgress
          );
      camera.getWorldDirection(cameraDirectionRef.current);
      cameraRightRef.current
        .crossVectors(cameraDirectionRef.current, camera.up)
        .normalize();
      showcasePositionRef.current
        .copy(camera.position)
        .addScaledVector(cameraDirectionRef.current, showcaseDistance)
        .addScaledVector(cameraRightRef.current, entryFocusActive ? 0 : Math.sin(showcaseProgress * Math.PI * 2) * 1.35)
        .addScaledVector(camera.up, entryFocusActive ? 0 : Math.sin(showcaseProgress * Math.PI * 4) * 0.34);
      group.position.lerp(showcasePositionRef.current, showcaseBlend);
    }
    if (entryFocusRequested) {
      entryFocusPositionRef.current[0] = group.position.x;
      entryFocusPositionRef.current[1] = group.position.y;
      entryFocusPositionRef.current[2] = group.position.z;
      useCreatureBehaviorStore.getState().setCreaturePosition(
        entryFocusId,
        entryFocusPositionRef.current
      );
    }
    const scalePulse = 1
      + Math.sin(motionT * 0.42 + drift.phaseA) * 0.18
      + Math.sin(motionT * 0.2 + drift.phaseC) * 0.07;
    modelMotion.scale.setScalar(scalePulse * THREE.MathUtils.lerp(1, 4.35, showcaseBlend));
    const yaw = frontWeightedYaw(motionT * drift.yawSpeed + drift.phaseB);
    modelMotion.position.set(0, 0, 0);
    if (flatFacing) {
      // The child turns its shallow local axis into +Z. Matching the camera
      // quaternion here keeps the decorated broad face visible at all times.
      modelMotion.quaternion.copy(camera.quaternion);
      if (model.flipFlatFacing) modelMotion.rotateY(Math.PI);
      modelMotion.rotateY(showcaseTurn);
      modelMotion.rotateZ(Math.sin(motionT * 0.38 + drift.phaseC) * 0.025);
    } else {
      modelMotion.rotation.set(
        Math.sin(motionT * drift.pitchSpeed + drift.phaseA) * 0.42
          + Math.sin(motionT * 0.61 + drift.phaseC) * 0.1,
        yaw + Math.sin(motionT * 0.47 + drift.phaseA) * 0.16,
        Math.sin(motionT * drift.rollSpeed + drift.phaseC) * 0.26
          + Math.cos(motionT * 0.37 + drift.phaseB) * 0.08
      );
    }
    if (!flatFacing && showcaseBlend > 0.001) {
      modelMotion.rotation.x *= 1 - showcaseBlend;
      modelMotion.rotation.z *= 1 - showcaseBlend;
      modelMotion.rotation.x = THREE.MathUtils.lerp(modelMotion.rotation.x, Math.sin(now * 0.44) * 0.045, showcaseBlend);
      modelMotion.rotation.z = THREE.MathUtils.lerp(modelMotion.rotation.z, Math.sin(now * 0.36) * 0.035, showcaseBlend);
      modelMotion.rotation.y = THREE.MathUtils.lerp(
        modelMotion.rotation.y,
        Math.sin(now * 0.32) * 0.11,
        showcaseBlend
      ) + showcaseTurn;
    }

    const interactionAge = interactionEvent
      ? clock.elapsedTime - interactionEvent.startedAt
      : -1;
    const interactionActive = Boolean(
      interactionEvent
      && interactionAge >= 0
      && interactionAge < interactionEvent.duration
    );
    let portalScale = 1;
    let portalVisible = true;
    if (interactionActive && interactionEvent?.kind === 'fight' && interactionEvent.anchor) {
      const progress = THREE.MathUtils.clamp(interactionAge / interactionEvent.duration, 0, 1);
      const side = interactionEvent.role === 'left' ? -1 : 1;
      const envelope = THREE.MathUtils.smootherstep(progress, 0, 0.14)
        * (1 - THREE.MathUtils.smootherstep(progress, 0.84, 1));
      const strike = Math.pow(Math.sin(progress * Math.PI * 3), 2) * envelope;
      fightAnchorRef.current.set(...interactionEvent.anchor);
      if (interactionEvent.origin) {
        fightOriginDirectionRef.current
          .set(...interactionEvent.origin)
          .sub(fightAnchorRef.current);
      } else {
        fightOriginDirectionRef.current.set(side, 0, 0);
      }
      if (fightOriginDirectionRef.current.lengthSq() < 0.0001) {
        fightOriginDirectionRef.current.set(side, 0, 0);
      } else {
        fightOriginDirectionRef.current.normalize();
      }
      fightPositionRef.current
        .copy(fightAnchorRef.current)
        .addScaledVector(fightOriginDirectionRef.current, 0.72 - strike * 0.42);
      fightPositionRef.current.y += Math.sin(progress * Math.PI * 6 + side) * 0.12 * envelope;
      group.position.lerp(fightPositionRef.current, envelope);
      modelMotion.rotation.y += side * (0.16 + strike * 0.34);
      modelMotion.rotation.z += side * Math.sin(progress * Math.PI * 6) * 0.16 * envelope;
      modelMotion.scale.multiplyScalar(1 + strike * 0.07);
    } else if (interactionActive && interactionEvent?.kind === 'portal' && interactionEvent.portal) {
      const portal = interactionEvent.portal;
      const transitionAt = portal.transitionAt;
      const liveEntry = getGalaxyPortal(portal.entryId)?.position;
      const liveExit = getGalaxyPortal(portal.exitId)?.position;
      portalEntryPositionRef.current.copy(
        liveEntry ?? portalEntryPositionRef.current.set(...portal.entryPosition)
      );
      portalExitPositionRef.current.copy(
        liveExit ?? portalExitPositionRef.current.set(...portal.exitPosition)
      );
      portalReturnPositionRef.current.copy(group.position);
      const localModelRadius = 0.72;
      const portalFitScale = Math.min(1, portal.entryRadius * 0.88 / localModelRadius);

      if (interactionAge < transitionAt) {
        const raw = THREE.MathUtils.clamp(interactionAge / transitionAt, 0, 1);
        const suction = portalSuctionProgress(raw);
        fightAnchorRef.current.set(...(
          interactionEvent.origin ?? portalReturnPositionRef.current.toArray()
        ));
        portalNormalRef.current.set(
          ...(portal.entryNormal ?? [0, 0, 1] as [number, number, number])
        ).normalize();
        portalApproachRef.current.subVectors(
          fightAnchorRef.current,
          portalEntryPositionRef.current
        );
        portalTangentRef.current.crossVectors(
          portalNormalRef.current,
          portalApproachRef.current
        );
        if (portalTangentRef.current.lengthSq() < 0.0001) {
          portalTangentRef.current.crossVectors(
            portalNormalRef.current,
            THREE.Object3D.DEFAULT_UP
          );
        }
        portalTangentRef.current.normalize();
        const suctionOrbitRadius = Math.min(
          1.35,
          Math.max(0.2, portalApproachRef.current.length() * 0.24)
        );
        const suctionOrbit = Math.sin(suction * Math.PI * 2.5)
          * (1 - suction)
          * suctionOrbitRadius;
        group.position
          .copy(fightAnchorRef.current)
          .lerp(portalEntryPositionRef.current, suction)
          .addScaledVector(portalTangentRef.current, suctionOrbit)
          .addScaledVector(portalNormalRef.current, Math.sin(suction * Math.PI) * 0.18);
        portalScale = THREE.MathUtils.lerp(1, portalFitScale * 0.06, suction);
        portalVisible = raw < 0.94;
        modelMotion.rotation.y += suction * Math.PI * 4.5;
        modelMotion.rotation.z += Math.sin(suction * Math.PI * 5) * 0.32 * (1 - suction);
      } else {
        const emergeAge = interactionAge - transitionAt;
        const emergence = THREE.MathUtils.smootherstep(
          THREE.MathUtils.clamp(emergeAge / PORTAL_EMERGE_DURATION, 0, 1),
          0,
          1
        );
        portalNormalRef.current.set(
          ...(portal.exitNormal ?? [0, 0, 1] as [number, number, number])
        ).normalize();
        portalEmergenceRef.current
          .copy(portalExitPositionRef.current)
          .addScaledVector(
            portalNormalRef.current,
            (portal.exitVisualRadius ?? portal.exitRadius) + localModelRadius * portalFitScale + 0.35
          );
        if (emergeAge < PORTAL_EMERGE_DURATION) {
          portalTangentRef.current.crossVectors(
            portalNormalRef.current,
            THREE.Object3D.DEFAULT_UP
          );
          if (portalTangentRef.current.lengthSq() < 0.0001) {
            portalTangentRef.current.set(1, 0, 0);
          } else {
            portalTangentRef.current.normalize();
          }
          group.position
            .copy(portalExitPositionRef.current)
            .lerp(portalEmergenceRef.current, emergence)
            .addScaledVector(
              portalTangentRef.current,
              Math.sin(emergence * Math.PI * 2) * (1 - emergence) * 0.32
            );
          portalScale = THREE.MathUtils.lerp(portalFitScale * 0.06, portalFitScale, emergence);
          portalVisible = emergence > 0.06;
          modelMotion.rotation.y += (1 - emergence) * Math.PI * 2.5;
        } else {
          const returnDuration = Math.max(
            0.8,
            interactionEvent.duration - transitionAt - PORTAL_EMERGE_DURATION
          );
          const returnProgress = THREE.MathUtils.smootherstep(
            THREE.MathUtils.clamp(
              (interactionAge - transitionAt - PORTAL_EMERGE_DURATION) / returnDuration,
              0,
              1
            ),
            0,
            1
          );
          group.position
            .copy(portalEmergenceRef.current)
            .lerp(portalReturnPositionRef.current, returnProgress);
          portalScale = THREE.MathUtils.lerp(portalFitScale, 1, returnProgress);
        }
      }
    }
    group.scale.setScalar(portalScale);
    group.visible = portalVisible;

    if (modelReady && loadEnabled) {
      interactionPositionRef.current[0] = group.position.x;
      interactionPositionRef.current[1] = group.position.y;
      interactionPositionRef.current[2] = group.position.z;
      useCreatureBehaviorStore.getState().setCreaturePosition(
        interactionId,
        interactionPositionRef.current
      );
    }

    const collisionCheckTick = Math.floor(t / COLLISION_CHECK_INTERVAL_SECONDS);
    if (modelReady && collisionCheckTickRef.current !== collisionCheckTick) {
      const shouldScan = collisionCheckTickRef.current !== null;
      collisionCheckTickRef.current = collisionCheckTick;
      if (shouldScan) {
        const positions = useCreatureBehaviorStore.getState().creaturePositions;
        const radiusSq = EXHIBITION_COLLISION_RADIUS * EXHIBITION_COLLISION_RADIUS;
        for (const creatureId in positions) {
          if (creatureId === interactionId || creatureId.startsWith('exhibition-entry:')) continue;
          const position = positions[creatureId];
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
    }

    const reactionElapsed = t - reactionStartedAtRef.current;
    if (reactionElapsed >= 0 && reactionElapsed < EXHIBITION_REACTION_DURATION) {
      const reactionProgress = reactionElapsed / EXHIBITION_REACTION_DURATION;
      const reaction = Math.sin(reactionProgress * Math.PI * 6) * (1 - reactionProgress);
      modelMotion.position.set(reaction * 0.1, Math.abs(reaction) * 0.12, 0);
      modelMotion.rotation.z += reaction * (flatFacing ? 0.07 : 0.2);
      if (!flatFacing) modelMotion.rotation.y += reaction * 0.12;
    }

    if (titleMotion) {
      // Resolve the label anchor through the model's actual transform matrix.
      // This includes its current scale, tilt, rotation and collision bounce,
      // so the title stays attached above the moving model rather than merely
      // following the outer drift group.
      modelMotion.updateMatrix();
      titleAnchorPositionRef.current
        .set(0, 0.54, 0)
        .applyMatrix4(modelMotion.matrix);
      titleMotion.position.copy(titleAnchorPositionRef.current);
      titleMotion.scale.setScalar(THREE.MathUtils.lerp(1, 0.19 / 0.105, showcaseBlend));
    }
  });

  const handleReady = useCallback((profile: GeneratedArtworkModelProfile) => {
    setFlatFacing(profile.isFlat);
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
                orientFlatModelToViewer
                releaseResourcesOnUnmount={model.releaseResourcesOnUnmount}
              />
            </Suspense>
          </ExhibitionModelErrorBoundary>
        ) : null}
      </group>
      {modelReady ? (
        <group ref={titleMotionRef} position={[0, 0.54, 0]}>
          <Billboard follow>
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
        </group>
      ) : null}
    </group>
  );
}
