export type CreaturePartActionKind = 'idle' | 'fight' | 'trapped' | 'victory' | 'impact';

export type CreaturePartActionPose = {
  kind: CreaturePartActionKind;
  phase: number;
  punch: number;
  punchSide: number;
  kick: number;
  kickSide: number;
  bite: number;
  hit: number;
  guard: number;
  windup: number;
  curl: number;
  struggle: number;
  compression: number;
  targetSide: number;
};

export {
  createCreaturePartAction,
  resetCreaturePartAction,
  writeFightCreaturePartAction,
  writeImpactCreaturePartAction,
  writeTrappedCreaturePartAction,
  writeVictoryCreaturePartAction
} from './creaturePartActions.mjs';
