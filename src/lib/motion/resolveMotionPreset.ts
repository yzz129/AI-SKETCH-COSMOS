import type { ArtworkFeatureResult, MotionPreset } from '../../types/artwork';

type FeatureInput = Omit<ArtworkFeatureResult, 'motionPreset'>;

export function resolveMotionPreset(features: FeatureInput): MotionPreset {
  const { subjectCategory, morphology, behaviorTraits } = features;

  if (subjectCategory === 'plant' || behaviorTraits.locomotionType === 'growing') {
    return 'plantSway';
  }

  if (morphology.hasFins || behaviorTraits.locomotionType === 'swimming') {
    return 'fishSwim';
  }

  if (morphology.hasWings) {
    return behaviorTraits.energyLevel === 'gentle' || morphology.wingCount === 4
      ? 'butterflyFloat'
      : 'wingedFly';
  }

  if (morphology.legCount === 4 || morphology.legCount === 6 || morphology.legCount === 8) {
    return behaviorTraits.locomotionType === 'hopping' ? 'quadrupedLeap' : 'quadrupedRun';
  }

  if (morphology.legCount === 2 || morphology.hasArms || subjectCategory === 'character') {
    return behaviorTraits.locomotionType === 'walking' ? 'bipedWalk' : 'bipedWave';
  }

  if (subjectCategory === 'abstract') {
    return 'spiritFloat';
  }

  return 'glowIdle';
}
