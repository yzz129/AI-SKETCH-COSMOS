import { create } from 'zustand';
import type { SampledParticleShape, SampledPoint } from '../utils/imageSampling';
import { loadSketchCreatures, persistSketchCreatures } from '../utils/storage';
import {
  cancelSpotlight,
  completeSpotlight,
  IDLE_SPOTLIGHT,
  markSpotlightRenderReady,
  requestSpotlight,
  type SpotlightPhase,
  type SpotlightState
} from '../components/webgl/spotlightMotion';

export type { SpotlightPhase, SpotlightState } from '../components/webgl/spotlightMotion';

export type Creature = {
  id: string;
  name: string;
  texture: string;
  mask?: string;
  points: SampledPoint[];
  position: [number, number, number];
  velocity: [number, number, number];
  scale: number;
  lane: number;
  createdAt: number;
  source: SampledParticleShape;
};

export type CollapseState = {
  active: boolean;
  center: [number, number];
  startedAt: number;
  releasedAt: number;
  holdDuration: number;
};

type SketchStore = {
  creatures: Creature[];
  latestCreature: Creature | null;
  status: 'idle' | 'processing' | 'ready' | 'error';
  message: string;
  collapse: CollapseState;
  spotlight: SpotlightState;
  setProcessing: (message: string) => void;
  addCreatureFromShape: (shape: SampledParticleShape) => void;
  setError: (message: string) => void;
  clearCreatures: () => void;
  beginCollapse: (center: [number, number]) => void;
  updateCollapseCenter: (center: [number, number]) => void;
  endCollapse: () => void;
  beginSpotlight: (creatureId: string) => void;
  markSpotlightReady: (creatureId: string) => void;
  invalidateSpotlightReady: (creatureId: string) => void;
  cancelSpotlight: (creatureId: string) => void;
  advanceSpotlight: (phase: SpotlightPhase) => void;
  endSpotlight: () => void;
};

const depths = [-0.72, -0.36, 0.05, 0.42, 0.78];

function createCreature(shape: SampledParticleShape, index: number): Creature {
  const angle = index * 2.399963 + 0.45;
  const radiusX = 2.05 + (index % 3) * 0.42;
  const radiusY = 0.82 + (index % 4) * 0.18;
  const depth = depths[index % depths.length];
  const lane = index % 8;
  const scaleByIndex = Math.max(0.55, 0.9 - index * 0.04);
  const driftDirection = index % 2 === 0 ? 1 : -1;

  return {
    id: `${shape.id}-${Date.now()}-${index}`,
    name: shape.name,
    texture: shape.texture,
    mask: shape.mask,
    points: shape.points,
    position: [
      Math.cos(angle) * radiusX,
      Math.sin(angle) * radiusY,
      depth
    ],
    velocity: [driftDirection * (0.012 + (index % 3) * 0.004), 0, 0],
    scale: scaleByIndex,
    lane,
    createdAt: Date.now(),
    source: shape
  };
}

const initialCreatures = loadSketchCreatures<Creature>();

export const useSketchStore = create<SketchStore>((set, get) => ({
  creatures: initialCreatures,
  latestCreature: initialCreatures.length > 0 ? initialCreatures[initialCreatures.length - 1] : null,
  status: initialCreatures.length > 0 ? 'idle' as const : 'idle' as const,
  message: initialCreatures.length > 0
    ? `${initialCreatures.length} 个粒子生命正在星河中游荡。`
    : '上传画作，本地提取结构与主色，再把它变成 3D 星光粒子生命。',
  collapse: {
    active: false,
    center: [0.5, 0.5],
    startedAt: 0,
    releasedAt: 0,
    holdDuration: 0
  },
  spotlight: { ...IDLE_SPOTLIGHT },
  setProcessing: (message) => set({
    status: 'processing',
    message
  }),
  addCreatureFromShape: (shape) => {
    const currentCreatures = get().creatures;
    const creature = createCreature(shape, currentCreatures.length);
    const creatures = [...currentCreatures, creature].slice(-12);
    persistSketchCreatures(creatures);
    set({
      creatures,
      latestCreature: creature,
      status: 'ready',
      message: `${shape.name} 已进入星河。`,
      spotlight: markSpotlightRenderReady(
        requestSpotlight(get().spotlight, creature.id),
        creature.id
      )
    });
  },
  setError: (message) => set({
    status: 'error',
    message
  }),
  clearCreatures: () => {
    const removedIds = get().creatures.map((creature) => creature.id);
    persistSketchCreatures([]);
    set((state) => {
      let spotlight = state.spotlight;
      for (const creatureId of removedIds) spotlight = cancelSpotlight(spotlight, creatureId);
      return {
        creatures: [],
        latestCreature: null,
        status: 'idle',
        message: '星河已清空，沉浸星空正在待命。',
        spotlight
      };
    });
  },
  beginCollapse: (center) => set({
    collapse: {
      active: true,
      center,
      startedAt: Date.now(),
      releasedAt: 0,
      holdDuration: 0
    }
  }),
  updateCollapseCenter: (center) => set((state) => ({
    collapse: {
      ...state.collapse,
      center
    }
  })),
  endCollapse: () => set((state) => {
    if (!state.collapse.active) return state;

    const now = Date.now();
    return {
      collapse: {
        ...state.collapse,
        active: false,
        releasedAt: now,
        holdDuration: Math.max(0, now - state.collapse.startedAt)
      }
    };
  }),
  beginSpotlight: (creatureId) => set((state) => ({
    spotlight: requestSpotlight(state.spotlight, creatureId)
  })),
  markSpotlightReady: (creatureId) => set((state) => ({
    spotlight: markSpotlightRenderReady(state.spotlight, creatureId)
  })),
  invalidateSpotlightReady: (creatureId) => set((state) => {
    if (state.spotlight.pendingCreatureId !== creatureId || !state.spotlight.pendingReady) return state;
    return { spotlight: { ...state.spotlight, pendingReady: false } };
  }),
  cancelSpotlight: (creatureId) => set((state) => ({
    spotlight: cancelSpotlight(state.spotlight, creatureId)
  })),
  advanceSpotlight: (phase) => set((state) => {
    if (state.spotlight.phase === 'idle') return state;
    return { spotlight: { ...state.spotlight, phase } };
  }),
  endSpotlight: () => set((state) => ({
    spotlight: completeSpotlight(state.spotlight)
  }))
}));
