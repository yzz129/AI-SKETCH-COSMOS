export type SpotlightPhase = 'fly-in' | 'showcase' | 'release' | 'idle';

export type SpotlightState = {
  creatureId: string | null;
  requestedCreatureId: string | null;
  pendingCreatureId: string | null;
  pendingReady: boolean;
  startedAt: number;
  phase: SpotlightPhase;
};

export {
  IDLE_SPOTLIGHT,
  cancelSpotlight,
  cappedDampStep,
  clamp01,
  completeSpotlight,
  markSpotlightRenderReady,
  requestSpotlight,
  smootherstep01,
  spotlightApproachEased,
  spotlightApproachProgress,
  spotlightReleaseEased,
  spotlightReleaseProgress
} from './spotlightMotion.mjs';
