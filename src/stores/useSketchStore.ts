import { create } from 'zustand';
import type { SampledParticleShape, SampledPoint } from '../utils/imageSampling';

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
  isIdleMode: boolean;
  lastActivityAt: number;
  collapse: CollapseState;
  setProcessing: (message: string) => void;
  addCreatureFromShape: (shape: SampledParticleShape) => void;
  setError: (message: string) => void;
  clearCreatures: () => void;
  setIdleMode: (enabled: boolean) => void;
  touchActivity: () => void;
  beginCollapse: (center: [number, number]) => void;
  updateCollapseCenter: (center: [number, number]) => void;
  endCollapse: () => void;
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

export const useSketchStore = create<SketchStore>((set, get) => ({
  creatures: [],
  latestCreature: null,
  status: 'idle',
  message: '上传画作，让 AI 识别结构与行为，再把它变成 3D 星光粒子生命。',
  isIdleMode: true,
  lastActivityAt: Date.now(),
  collapse: {
    active: false,
    center: [0.5, 0.5],
    startedAt: 0,
    releasedAt: 0,
    holdDuration: 0
  },
  setProcessing: (message) => set({
    status: 'processing',
    message,
    isIdleMode: false,
    lastActivityAt: Date.now()
  }),
  addCreatureFromShape: (shape) => {
    const currentCreatures = get().creatures;
    const creature = createCreature(shape, currentCreatures.length);
    set({
      creatures: [...currentCreatures, creature].slice(-12),
      latestCreature: creature,
      status: 'ready',
      message: `${shape.name} 已进入星河。`,
      isIdleMode: false,
      lastActivityAt: Date.now()
    });
  },
  setError: (message) => set({
    status: 'error',
    message,
    isIdleMode: false,
    lastActivityAt: Date.now()
  }),
  clearCreatures: () => set({
    creatures: [],
    latestCreature: null,
    status: 'idle',
    message: '星河已清空，沉浸星空正在待命。',
    isIdleMode: true,
    lastActivityAt: Date.now()
  }),
  setIdleMode: (enabled) => set({
    isIdleMode: enabled,
    message: enabled ? '沉浸模式正在展示星尘流动。' : '沉浸模式已暂停，可以继续上传画作。',
    lastActivityAt: Date.now()
  }),
  touchActivity: () => set({ lastActivityAt: Date.now(), isIdleMode: false }),
  beginCollapse: (center) => set({
    collapse: {
      active: true,
      center,
      startedAt: Date.now(),
      releasedAt: 0,
      holdDuration: 0
    },
    lastActivityAt: Date.now(),
    isIdleMode: false
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
  })
}));
