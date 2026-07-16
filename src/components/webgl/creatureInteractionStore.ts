import { create } from 'zustand';

export type CreatureInteractionKind =
  | 'fight'
  | 'victory'
  | 'trapped'
  | 'escape'
  | 'boost'
  | 'portal'
  | 'collision';

export type CreatureInteractionEvent = {
  sequence: number;
  kind: CreatureInteractionKind;
  startedAt: number;
  duration: number;
  targetId?: string;
  role?: 'left' | 'right' | 'winner' | 'loser';
  planetIndex?: number;
  anchor?: [number, number, number];
  origin?: [number, number, number];
  captureDuration?: number;
  portal?: {
    entryId: string;
    exitId: string;
    entryPosition: [number, number, number];
    exitPosition: [number, number, number];
    entryRadius: number;
    exitRadius: number;
    entryVisualRadius?: number;
    exitVisualRadius?: number;
    entryNormal?: [number, number, number];
    exitNormal?: [number, number, number];
    fitScale?: number;
    transitionAt: number;
  };
};

export type PortalApproach = {
  creatureId: string;
  predatorId: string;
  entryId: string;
  exitId: string;
  committedAt: number;
  intentGraceUntil: number;
};

type CreatureInteractionState = {
  sequence: number;
  events: Record<string, CreatureInteractionEvent>;
  portalApproaches: Record<string, PortalApproach>;
  commitPortalApproach: (approach: PortalApproach) => void;
  clearPortalApproach: (creatureId: string) => void;
  triggerEvent: (
    creatureId: string,
    event: Omit<CreatureInteractionEvent, 'sequence'>
  ) => CreatureInteractionEvent;
  clearEvent: (creatureId: string, sequence?: number) => void;
};

export const useCreatureInteractionStore = create<CreatureInteractionState>((set, get) => ({
  sequence: 0,
  events: {},
  portalApproaches: {},
  commitPortalApproach: (approach) => set((state) => ({
    portalApproaches: { ...state.portalApproaches, [approach.creatureId]: approach }
  })),
  clearPortalApproach: (creatureId) => set((state) => {
    if (!state.portalApproaches[creatureId]) return state;
    const portalApproaches = { ...state.portalApproaches };
    delete portalApproaches[creatureId];
    return { portalApproaches };
  }),
  triggerEvent: (creatureId, event) => {
    const sequence = get().sequence + 1;
    const next = { ...event, sequence };
    set((state) => ({
      sequence,
      events: { ...state.events, [creatureId]: next }
    }));
    return next;
  },
  clearEvent: (creatureId, sequence) => set((state) => {
    const current = state.events[creatureId];
    if (!current || (sequence !== undefined && current.sequence !== sequence)) return state;
    const events = { ...state.events };
    delete events[creatureId];
    return { events };
  })
}));
