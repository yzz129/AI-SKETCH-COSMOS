import type { ArtworkFeatureResult, MotionPreset } from '../../types/artwork';

type FeatureInput = Omit<ArtworkFeatureResult, 'motionPreset'>;

export function resolveMotionPreset(features: FeatureInput): MotionPreset {
  const { subjectCategory, morphology, behaviorTraits, visualTraits } = features;
  const active = behaviorTraits.energyLevel === 'active';
  const calm = behaviorTraits.energyLevel === 'calm';
  const gentle = behaviorTraits.energyLevel === 'gentle';
  const complex = morphology.silhouetteComplexity === 'complex';
  const simple = morphology.silhouetteComplexity === 'simple';

  if (subjectCategory === 'plant' || behaviorTraits.locomotionType === 'growing') {
    if (behaviorTraits.locomotionType === 'growing' && active) return 'vineCurl';
    if (behaviorTraits.locomotionType === 'growing') return 'flowerBloom';
    if (behaviorTraits.locomotionType === 'swaying' && calm) return 'treeBreeze';
    if (simple) return 'grassWave';
    if (behaviorTraits.personalityFeel === 'cute') return 'mushroomBob';
    return 'plantSway';
  }

  if (morphology.hasFins || behaviorTraits.locomotionType === 'swimming') {
    if (!morphology.hasTail && gentle) return 'jellyfishPulse';
    if (morphology.legCount === 4) return 'turtlePaddle';
    if (active && complex) return 'squidJet';
    if (active) return 'dolphinArc';
    if (complex) return 'eelWiggle';
    if (gentle || calm) return 'fishCruise';
    return 'fishSwim';
  }

  if (morphology.hasWings) {
    if (morphology.wingCount === 4 && active) return 'dragonflyDart';
    if (morphology.wingCount === 4 || gentle) return 'butterflyFloat';
    if (behaviorTraits.personalityFeel === 'mysterious') return 'batFlutter';
    if (calm) return 'birdSoar';
    if (visualTraits.softness === 'sharp' && active) return 'wingedFly';
    return active ? 'birdFlap' : 'gliderCircle';
  }

  if (behaviorTraits.locomotionType === 'crawling') {
    if (morphology.legCount === 8) return 'spiderCrawl';
    if (morphology.legCount === 6) return 'crabSideStep';
    if (morphology.legCount === 4) return 'lizardScuttle';
    if (morphology.hasTail || morphology.bodyOrientation === 'horizontal') return 'snakeSlither';
    return calm ? 'snailGlide' : 'lizardScuttle';
  }

  if (morphology.legCount === 4 || morphology.legCount === 6 || morphology.legCount === 8) {
    if (morphology.legCount === 8) return 'spiderCrawl';
    if (morphology.legCount === 6) return behaviorTraits.locomotionType === 'hopping' ? 'lizardScuttle' : 'crabSideStep';
    if (behaviorTraits.locomotionType === 'hopping') return active ? 'deerBound' : 'rabbitHop';
    if (behaviorTraits.locomotionType === 'walking' && calm) return 'elephantWalk';
    if (active && complex) return 'horseGallop';
    if (active && behaviorTraits.personalityFeel === 'playful') return 'squirrelDart';
    if (calm) return 'bearLumber';
    if (gentle) return 'dogTrot';
    return 'catProwl';
  }

  if (morphology.legCount === 2 || morphology.hasArms || subjectCategory === 'character') {
    if (subjectCategory === 'object') return 'robotIdle';
    if (behaviorTraits.locomotionType === 'hopping') return 'characterBounce';
    if (behaviorTraits.locomotionType === 'running') return 'bipedJog';
    if (behaviorTraits.locomotionType === 'walking' && active) return 'bipedMarch';
    if (behaviorTraits.locomotionType === 'walking' && calm) return 'bipedTiptoe';
    if (active && behaviorTraits.personalityFeel === 'playful') return 'bipedDance';
    return behaviorTraits.locomotionType === 'walking' ? 'bipedWalk' : 'bipedWave';
  }

  if (subjectCategory === 'abstract') {
    if (behaviorTraits.locomotionType === 'floating' && visualTraits.softness === 'soft') return 'cloudDrift';
    if (behaviorTraits.locomotionType === 'floating' && calm) return 'balloonDrift';
    return 'spiritFloat';
  }

  if (subjectCategory === 'object') {
    if (behaviorTraits.locomotionType === 'flying' || (active && visualTraits.softness === 'sharp')) return 'rocketBoost';
    if (morphology.bodyOrientation === 'horizontal' || behaviorTraits.locomotionType === 'running') return 'vehicleCruise';
    if (behaviorTraits.locomotionType === 'floating') return 'balloonDrift';
    return 'robotIdle';
  }

  return 'glowIdle';
}
