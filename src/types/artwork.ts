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
  | 'quadrupedRun'
  | 'quadrupedLeap'
  | 'bipedWalk'
  | 'bipedWave'
  | 'fishSwim'
  | 'plantSway'
  | 'spiritFloat'
  | 'glowIdle';

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
};

export type Artwork3DModelResult = {
  taskId: string;
  modelUrl: string;
  source: 'ark-hyper3d';
  createdAt: number;
};

export type Artwork3DTaskState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown';
