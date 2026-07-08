import type { MotionPreset } from '../../types/artwork';

export const FLYING_PRESETS: MotionPreset[] = [
  'wingedFly',
  'butterflyFloat',
  'birdSoar',
  'birdFlap',
  'insectHover',
  'dragonflyDart',
  'batFlutter',
  'gliderCircle',
  'rocketBoost'
];

export const SWIMMING_PRESETS: MotionPreset[] = [
  'fishSwim',
  'fishCruise',
  'eelWiggle',
  'jellyfishPulse',
  'turtlePaddle',
  'dolphinArc',
  'squidJet'
];

export const PLANT_PRESETS: MotionPreset[] = [
  'plantSway',
  'flowerBloom',
  'treeBreeze',
  'grassWave',
  'vineCurl',
  'mushroomBob'
];

export const CRAWLING_PRESETS: MotionPreset[] = [
  'snakeSlither',
  'lizardScuttle',
  'crabSideStep',
  'spiderCrawl',
  'snailGlide'
];

export const QUADRUPED_PRESETS: MotionPreset[] = [
  'quadrupedRun',
  'quadrupedLeap',
  'catProwl',
  'dogTrot',
  'horseGallop',
  'deerBound',
  'bearLumber',
  'rabbitHop',
  'squirrelDart',
  'elephantWalk'
];

export const BIPED_PRESETS: MotionPreset[] = [
  'bipedWalk',
  'bipedWave',
  'bipedJog',
  'bipedDance',
  'bipedMarch',
  'bipedTiptoe',
  'characterBounce',
  'robotIdle'
];

export const SOFT_FLOAT_PRESETS: MotionPreset[] = [
  'spiritFloat',
  'glowIdle',
  'balloonDrift',
  'cloudDrift'
];

export const VEHICLE_PRESETS: MotionPreset[] = [
  'rocketBoost',
  'vehicleCruise'
];

export function isFlyingPreset(preset: MotionPreset) {
  return FLYING_PRESETS.includes(preset);
}

export function isSwimmingPreset(preset: MotionPreset) {
  return SWIMMING_PRESETS.includes(preset);
}

export function isPlantPreset(preset: MotionPreset) {
  return PLANT_PRESETS.includes(preset);
}

export function isCrawlingPreset(preset: MotionPreset) {
  return CRAWLING_PRESETS.includes(preset);
}

export function isBipedPreset(preset: MotionPreset) {
  return BIPED_PRESETS.includes(preset);
}

export function isQuadrupedPreset(preset: MotionPreset) {
  return QUADRUPED_PRESETS.includes(preset);
}
