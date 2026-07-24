export type SpotlightPhase = 'fly-in' | 'showcase' | 'release' | 'idle';

export type SpotlightState = {
  creatureId: string | null;
  requestedCreatureId: string | null;
  pendingCreatureId: string | null;
  pendingReady: boolean;
  startedAt: number;
  phase: SpotlightPhase;
};

import * as implementation from './spotlightMotion.mjs';

export const IDLE_SPOTLIGHT = implementation.IDLE_SPOTLIGHT as SpotlightState;
export const requestSpotlight = implementation.requestSpotlight as (
  state: SpotlightState,
  creatureId: string
) => SpotlightState;
export const markSpotlightRenderReady = implementation.markSpotlightRenderReady as (
  state: SpotlightState,
  creatureId: string,
  now?: number
) => SpotlightState;
export const completeSpotlight = implementation.completeSpotlight as (
  state: SpotlightState,
  now?: number
) => SpotlightState;
export const cancelSpotlight = implementation.cancelSpotlight as (
  state: SpotlightState,
  creatureId: string,
  now?: number
) => SpotlightState;
export const clamp01 = implementation.clamp01 as (value: number) => number;
export const smootherstep01 = implementation.smootherstep01 as (value: number) => number;
export const spotlightApproachProgress = implementation.spotlightApproachProgress as (
  elapsed: number
) => number;
export const spotlightApproachEased = implementation.spotlightApproachEased as (
  elapsed: number
) => number;
export const spotlightReleaseProgress = implementation.spotlightReleaseProgress as (
  elapsed: number
) => number;
export const spotlightReleaseEased = implementation.spotlightReleaseEased as (
  elapsed: number
) => number;
export const cappedDampStep = implementation.cappedDampStep as (
  current: number,
  target: number,
  smoothing: number,
  maxSpeed: number,
  delta: number
) => number;
