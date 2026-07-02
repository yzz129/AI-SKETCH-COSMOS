import { create } from 'zustand';
import type { AIArtworkAnalysis } from '../services/aiImageService';
import type { Artwork3DModelResult, ArtworkFeatureResult, MotionPreset } from '../types/artwork';
import type { ProcessedArtworkImage } from '../utils/artworkImage';
import {
  createCreatureBehaviorSignature,
  detectCreatureMotionType,
  type CreatureActionType,
  type CreatureBehaviorSignature,
  type CreatureMotionType
} from '../utils/creatureMotion';

type ArtworkStore = {
  artworks: StoredArtwork[];
  latestArtwork: StoredArtwork | null;
  addArtwork: (artwork: ProcessedArtworkImage, features?: ArtworkFeatureResult, model3d?: Artwork3DModelResult) => void;
  updateArtworkFeatures: (id: string, features: ArtworkFeatureResult) => void;
  updateArtworkAnalysis: (id: string, analysis: AIArtworkAnalysis) => void;
  clearArtworks: () => void;
};

export type StoredArtwork = ProcessedArtworkImage & {
  previewUrl: string;
  processedImageUrl?: string;
  features: ArtworkFeatureResult;
  model3d?: Artwork3DModelResult;
  createdAt: number;
  aiAnalysis?: AIArtworkAnalysis;
  motionType: CreatureMotionType;
  actionTypes: CreatureActionType[];
  behaviorSignature: CreatureBehaviorSignature;
};

const DEFAULT_ACTIONS: CreatureActionType[] = ['drift', 'hover', 'shimmer', 'breathe'];

function defaultFeaturesFromArtwork(artwork: ProcessedArtworkImage): ArtworkFeatureResult {
  return {
    subjectCategory: 'abstract',
    morphology: {
      hasWings: false,
      wingCount: 0,
      hasLegs: false,
      legCount: 0,
      hasTail: false,
      hasFins: false,
      hasArms: false,
      hasHead: false,
      bodyOrientation: 'floating',
      silhouetteComplexity: 'medium'
    },
    behaviorTraits: {
      locomotionType: 'floating',
      energyLevel: 'gentle',
      personalityFeel: 'dreamy'
    },
    visualTraits: {
      dominantColors: ['#64d9ff', '#ffd166', '#bba7ff'],
      brightness: 'medium',
      softness: 'soft',
      textureStyle: 'handdrawn'
    },
    motionPreset: 'spiritFloat'
  };
}

function motionTypeFromPreset(motionPreset: MotionPreset): CreatureMotionType {
  switch (motionPreset) {
    case 'wingedFly':
    case 'butterflyFloat':
      return 'fly';
    case 'fishSwim':
      return 'swim';
    case 'quadrupedRun':
      return 'run';
    case 'quadrupedLeap':
      return 'hop';
    case 'bipedWalk':
    case 'bipedWave':
      return 'walk';
    default:
      return 'float';
  }
}

function actionsFromPreset(motionPreset: MotionPreset): CreatureActionType[] {
  switch (motionPreset) {
    case 'wingedFly':
      return ['glide', 'flutter', 'dart', 'trail'];
    case 'butterflyFloat':
      return ['flutter', 'hover', 'bob', 'shimmer'];
    case 'quadrupedRun':
      return ['approach', 'retreat', 'sweep', 'trail'];
    case 'quadrupedLeap':
      return ['hop', 'bob', 'stretch', 'trail'];
    case 'bipedWalk':
      return ['approach', 'bob', 'breathe', 'shimmer'];
    case 'bipedWave':
      return ['hover', 'bob', 'wiggle', 'shimmer'];
    case 'fishSwim':
      return ['swim', 'wiggle', 'glide', 'trail'];
    case 'plantSway':
      return ['bloom', 'sweep', 'breathe', 'shimmer'];
    case 'spiritFloat':
      return ['drift', 'orbit', 'pulse', 'shimmer'];
    default:
      return DEFAULT_ACTIONS;
  }
}

function signatureFromFeatures(features: ArtworkFeatureResult): CreatureBehaviorSignature {
  const energy = features.behaviorTraits.energyLevel === 'active'
    ? 0.74
    : features.behaviorTraits.energyLevel === 'calm'
      ? 0.22
      : 0.46;
  const fluidity = features.behaviorTraits.locomotionType === 'swimming'
    ? 0.86
    : features.behaviorTraits.locomotionType === 'flying'
      ? 0.68
      : 0.46;

  return createCreatureBehaviorSignature({
    energy,
    buoyancy: features.morphology.bodyOrientation === 'floating' ? 0.72 : 0.42,
    fluidity,
    glow: 0.58,
    edgeGlow: 0.64,
    trailLength: features.behaviorTraits.energyLevel === 'active' ? 0.78 : 0.56,
    particleSpread: features.morphology.silhouetteComplexity === 'complex' ? 0.62 : 0.44,
    depth: 0.76
  });
}

function artworkFromFeatures(
  artwork: ProcessedArtworkImage,
  features = defaultFeaturesFromArtwork(artwork),
  model3d?: Artwork3DModelResult,
  analysis?: AIArtworkAnalysis
): StoredArtwork {
  return {
    ...artwork,
    previewUrl: artwork.url,
    processedImageUrl: artwork.url,
    features,
    model3d,
    createdAt: Date.now(),
    aiAnalysis: analysis,
    motionType: motionTypeFromPreset(features.motionPreset),
    actionTypes: actionsFromPreset(features.motionPreset),
    behaviorSignature: signatureFromFeatures(features)
  };
}

function artworkFromAnalysis(artwork: ProcessedArtworkImage, analysis?: AIArtworkAnalysis): StoredArtwork {
  const features = 'features' in artwork
    ? (artwork as StoredArtwork).features
    : defaultFeaturesFromArtwork(artwork);
  const behaviorSignature = createCreatureBehaviorSignature(analysis ? {
    energy: analysis.behavior.energy,
    buoyancy: analysis.behavior.buoyancy,
    fluidity: analysis.behavior.fluidity,
    glow: analysis.visual.glow,
    edgeGlow: analysis.visual.edgeGlow,
    trailLength: analysis.visual.trailLength,
    particleSpread: analysis.visual.particleSpread,
    depth: analysis.visual.depth
  } : undefined);

  return {
    ...artwork,
    previewUrl: artwork.url,
    processedImageUrl: artwork.url,
    features,
    model3d: 'model3d' in artwork ? (artwork as StoredArtwork).model3d : undefined,
    createdAt: 'createdAt' in artwork ? (artwork as StoredArtwork).createdAt : Date.now(),
    aiAnalysis: analysis,
    motionType: analysis?.motionType ?? detectCreatureMotionType(artwork.name),
    actionTypes: analysis?.actionTypes.length ? analysis.actionTypes : actionsFromPreset(features.motionPreset),
    behaviorSignature
  };
}

export const useArtworkStore = create<ArtworkStore>((set) => ({
  artworks: [],
  latestArtwork: null,
  addArtwork: (artwork, features, model3d) => set((state) => {
    const storedArtwork = artworkFromFeatures(artwork, features, model3d);

    return {
      artworks: [storedArtwork, ...state.artworks].slice(0, 12),
      latestArtwork: storedArtwork
    };
  }),
  updateArtworkFeatures: (id, features) => set((state) => {
    let updatedLatest = state.latestArtwork;
    const artworks = state.artworks.map((artwork) => {
      if (artwork.id !== id) return artwork;
      const updated = artworkFromFeatures(artwork, features, artwork.model3d, artwork.aiAnalysis);
      if (state.latestArtwork?.id === id) updatedLatest = updated;
      return updated;
    });

    return {
      artworks,
      latestArtwork: updatedLatest
    };
  }),
  updateArtworkAnalysis: (id, analysis) => set((state) => {
    let updatedLatest = state.latestArtwork;
    const artworks = state.artworks.map((artwork) => {
      if (artwork.id !== id) return artwork;
      const updated = artworkFromAnalysis(artwork, analysis);
      if (state.latestArtwork?.id === id) updatedLatest = updated;
      return updated;
    });

    return {
      artworks,
      latestArtwork: updatedLatest
    };
  }),
  clearArtworks: () => set({
    artworks: [],
    latestArtwork: null
  })
}));
