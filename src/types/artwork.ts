export type SubjectCategory =
  | 'animal'
  | 'plant'
  | 'character'
  | 'abstract'
  | 'object';

export type LocomotionType =
  | 'flying'
  | 'running'
  | 'hopping'
  | 'walking'
  | 'swimming'
  | 'floating'
  | 'crawling'
  | 'swaying'
  | 'growing'
  | 'idle';

export type MotionPreset =
  | 'wingedFly'
  | 'butterflyFloat'
  | 'birdSoar'
  | 'birdFlap'
  | 'insectHover'
  | 'dragonflyDart'
  | 'batFlutter'
  | 'gliderCircle'
  | 'quadrupedRun'
  | 'quadrupedLeap'
  | 'catProwl'
  | 'dogTrot'
  | 'horseGallop'
  | 'deerBound'
  | 'bearLumber'
  | 'rabbitHop'
  | 'squirrelDart'
  | 'elephantWalk'
  | 'bipedWalk'
  | 'bipedWave'
  | 'bipedJog'
  | 'bipedDance'
  | 'bipedMarch'
  | 'bipedTiptoe'
  | 'characterBounce'
  | 'robotIdle'
  | 'fishSwim'
  | 'fishCruise'
  | 'eelWiggle'
  | 'jellyfishPulse'
  | 'turtlePaddle'
  | 'dolphinArc'
  | 'squidJet'
  | 'plantSway'
  | 'flowerBloom'
  | 'treeBreeze'
  | 'grassWave'
  | 'vineCurl'
  | 'mushroomBob'
  | 'snakeSlither'
  | 'lizardScuttle'
  | 'crabSideStep'
  | 'spiderCrawl'
  | 'snailGlide'
  | 'spiritFloat'
  | 'glowIdle'
  | 'balloonDrift'
  | 'cloudDrift'
  | 'rocketBoost'
  | 'vehicleCruise';

export type ArtworkMotionPart =
  | 'head'
  | 'ears'
  | 'leftArm'
  | 'rightArm'
  | 'arms'
  | 'leftLeg'
  | 'rightLeg'
  | 'legs'
  | 'tail'
  | 'wings'
  | 'fins'
  | 'body';

export type ArtworkFeatureResult = {
  subjectCategory: SubjectCategory;

  morphology: {
    hasWings: boolean;
    wingCount: 0 | 1 | 2 | 4;
    hasLegs: boolean;
    legCount: 0 | 2 | 4 | 6 | 8;
    hasTail: boolean;
    hasFins: boolean;
    hasArms: boolean;
    hasHead: boolean;
    bodyOrientation: 'horizontal' | 'vertical' | 'floating' | 'undefined';
    silhouetteComplexity: 'simple' | 'medium' | 'complex';
  };

  behaviorTraits: {
    locomotionType: LocomotionType;
    energyLevel: 'calm' | 'gentle' | 'active';
    personalityFeel: 'cute' | 'dreamy' | 'playful' | 'gentle' | 'mysterious';
  };

  visualTraits: {
    dominantColors: string[];
    brightness: 'low' | 'medium' | 'high';
    softness: 'soft' | 'normal' | 'sharp';
    textureStyle: 'handdrawn' | 'watercolor' | 'crayon' | 'flat' | 'mixed';
  };

  motionPreset: MotionPreset;
  motionParts?: ArtworkMotionPart[];
};

export type Artwork3DModelResult = {
  taskId: string;
  modelUrl: string;
  source: 'ark-hyper3d';
  createdAt: number;
};

export type ArtworkGaussianModelStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

export type ArtworkGaussianModelResult = {
  jobId: string;
  sourceArtworkId?: string;
  source: 'triposplat';
  status: ArtworkGaussianModelStatus;
  format: 'splat' | 'ply' | 'both';
  splatUrl?: string;
  plyUrl?: string;
  previewUrl?: string;
  manifestUrl?: string;
  rigUrl?: string;
  gaussianCount: number;
  progress?: number;
  message?: string;
  createdAt: number;
};

export type Artwork3DTaskState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown';
