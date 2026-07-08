import { create } from 'zustand';
import type { AIArtworkAnalysis } from '../services/aiImageService';
import type {
  Artwork3DModelResult,
  ArtworkFeatureResult,
  ArtworkGaussianModelResult,
  MotionPreset
} from '../types/artwork';
import type { ProcessedArtworkImage } from '../utils/artworkImage';
import { useSketchStore } from './useSketchStore';
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
  addArtwork: (
    artwork: ProcessedArtworkImage,
    features?: ArtworkFeatureResult,
    model3d?: Artwork3DModelResult,
    gaussianModel?: ArtworkGaussianModelResult
  ) => StoredArtwork;
  updateArtworkFeatures: (id: string, features: ArtworkFeatureResult) => void;
  updateArtworkAnalysis: (id: string, analysis: AIArtworkAnalysis) => void;
  updateArtworkGaussianModel: (id: string, gaussianModel: ArtworkGaussianModelResult) => void;
  hydrateBackendArtworks: (records: BackendArtworkRecord[]) => void;
  clearArtworks: () => void;
};

export type StoredArtwork = ProcessedArtworkImage & {
  features: ArtworkFeatureResult;
  model3d?: Artwork3DModelResult;
  gaussianModel?: ArtworkGaussianModelResult;
  createdAt: number;
  aiAnalysis?: AIArtworkAnalysis;
  motionType: CreatureMotionType;
  actionTypes: CreatureActionType[];
  behaviorSignature: CreatureBehaviorSignature;
};

export type BackendArtworkRecord = {
  id: string;
  name?: string | null;
  sourceUrl?: string | null;
  previewUrl?: string | null;
  splatUrl?: string | null;
  plyUrl?: string | null;
  manifestUrl?: string | null;
  gaussianCount?: number | null;
  width?: number | null;
  height?: number | null;
  aspect?: number | null;
  features?: ArtworkFeatureResult | null;
  gaussianModel?: Partial<ArtworkGaussianModelResult> | null;
  isDeleted?: boolean;
  deletedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
    case 'birdSoar':
    case 'birdFlap':
    case 'insectHover':
    case 'dragonflyDart':
    case 'batFlutter':
    case 'gliderCircle':
    case 'rocketBoost':
      return 'fly';
    case 'fishSwim':
    case 'fishCruise':
    case 'eelWiggle':
    case 'jellyfishPulse':
    case 'turtlePaddle':
    case 'dolphinArc':
    case 'squidJet':
      return 'swim';
    case 'quadrupedRun':
    case 'catProwl':
    case 'dogTrot':
    case 'horseGallop':
    case 'deerBound':
    case 'bearLumber':
    case 'squirrelDart':
      return 'run';
    case 'quadrupedLeap':
    case 'rabbitHop':
    case 'characterBounce':
      return 'hop';
    case 'bipedWalk':
    case 'bipedWave':
    case 'bipedJog':
    case 'bipedDance':
    case 'bipedMarch':
    case 'bipedTiptoe':
    case 'robotIdle':
    case 'elephantWalk':
    case 'vehicleCruise':
      return 'walk';
    case 'snakeSlither':
    case 'lizardScuttle':
    case 'crabSideStep':
    case 'spiderCrawl':
    case 'snailGlide':
      return 'crawl';
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
    case 'birdSoar':
      return ['glide', 'orbit', 'sweep', 'trail'];
    case 'birdFlap':
      return ['flutter', 'glide', 'bob', 'trail'];
    case 'insectHover':
      return ['hover', 'flutter', 'dart', 'shimmer'];
    case 'dragonflyDart':
      return ['dart', 'hover', 'glide', 'trail'];
    case 'batFlutter':
      return ['flutter', 'loop', 'tumble', 'trail'];
    case 'gliderCircle':
      return ['glide', 'orbit', 'loop', 'trail'];
    case 'quadrupedRun':
      return ['approach', 'retreat', 'sweep', 'trail'];
    case 'quadrupedLeap':
      return ['hop', 'bob', 'stretch', 'trail'];
    case 'catProwl':
      return ['approach', 'retreat', 'sweep', 'breathe'];
    case 'dogTrot':
      return ['approach', 'bob', 'trail', 'shimmer'];
    case 'horseGallop':
      return ['approach', 'retreat', 'stretch', 'trail'];
    case 'deerBound':
      return ['hop', 'stretch', 'glide', 'trail'];
    case 'bearLumber':
      return ['approach', 'bob', 'breathe', 'sweep'];
    case 'rabbitHop':
      return ['hop', 'bob', 'stretch', 'trail'];
    case 'squirrelDart':
      return ['dart', 'hop', 'retreat', 'trail'];
    case 'elephantWalk':
      return ['approach', 'bob', 'breathe', 'sweep'];
    case 'bipedWalk':
      return ['approach', 'bob', 'breathe', 'shimmer'];
    case 'bipedWave':
      return ['hover', 'bob', 'wiggle', 'shimmer'];
    case 'bipedJog':
      return ['approach', 'bob', 'trail', 'breathe'];
    case 'bipedDance':
      return ['sweep', 'bob', 'wiggle', 'tumble'];
    case 'bipedMarch':
      return ['approach', 'bob', 'stretch', 'breathe'];
    case 'bipedTiptoe':
      return ['approach', 'bob', 'hover', 'breathe'];
    case 'characterBounce':
      return ['hop', 'bob', 'wiggle', 'shimmer'];
    case 'robotIdle':
      return ['breathe', 'pulse', 'sweep', 'shimmer'];
    case 'fishSwim':
      return ['swim', 'wiggle', 'glide', 'trail'];
    case 'fishCruise':
      return ['swim', 'glide', 'sweep', 'trail'];
    case 'eelWiggle':
      return ['wiggle', 'swim', 'sweep', 'trail'];
    case 'jellyfishPulse':
      return ['pulse', 'bob', 'drift', 'breathe'];
    case 'turtlePaddle':
      return ['swim', 'bob', 'glide', 'breathe'];
    case 'dolphinArc':
      return ['glide', 'loop', 'swim', 'trail'];
    case 'squidJet':
      return ['dart', 'retreat', 'swim', 'trail'];
    case 'plantSway':
      return ['bloom', 'sweep', 'breathe', 'shimmer'];
    case 'flowerBloom':
      return ['bloom', 'breathe', 'shimmer', 'stretch'];
    case 'treeBreeze':
      return ['sweep', 'breathe', 'drift', 'shimmer'];
    case 'grassWave':
      return ['sweep', 'wiggle', 'breathe', 'shimmer'];
    case 'vineCurl':
      return ['spiral', 'stretch', 'sweep', 'bloom'];
    case 'mushroomBob':
      return ['bob', 'breathe', 'pulse', 'shimmer'];
    case 'snakeSlither':
      return ['wiggle', 'sweep', 'approach', 'trail'];
    case 'lizardScuttle':
      return ['dart', 'approach', 'retreat', 'wiggle'];
    case 'crabSideStep':
      return ['sweep', 'retreat', 'approach', 'bob'];
    case 'spiderCrawl':
      return ['approach', 'retreat', 'wiggle', 'trail'];
    case 'snailGlide':
      return ['drift', 'approach', 'breathe', 'trail'];
    case 'spiritFloat':
      return ['drift', 'orbit', 'pulse', 'shimmer'];
    case 'balloonDrift':
      return ['drift', 'bob', 'hover', 'breathe'];
    case 'cloudDrift':
      return ['drift', 'breathe', 'sweep', 'shimmer'];
    case 'rocketBoost':
      return ['dart', 'glide', 'trail', 'pulse'];
    case 'vehicleCruise':
      return ['approach', 'sweep', 'trail', 'breathe'];
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
  gaussianModel?: ArtworkGaussianModelResult,
  analysis?: AIArtworkAnalysis
): StoredArtwork {
  return {
    ...artwork,
    features,
    model3d,
    gaussianModel: gaussianModel ?? ('gaussianModel' in artwork ? (artwork as StoredArtwork).gaussianModel : undefined),
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
    features,
    model3d: 'model3d' in artwork ? (artwork as StoredArtwork).model3d : undefined,
    gaussianModel: 'gaussianModel' in artwork ? (artwork as StoredArtwork).gaussianModel : undefined,
    createdAt: 'createdAt' in artwork ? (artwork as StoredArtwork).createdAt : Date.now(),
    aiAnalysis: analysis,
    motionType: analysis?.motionType ?? detectCreatureMotionType(artwork.name),
    actionTypes: analysis?.actionTypes.length ? analysis.actionTypes : actionsFromPreset(features.motionPreset),
    behaviorSignature
  };
}

function artworkFromBackendRecord(record: BackendArtworkRecord): StoredArtwork {
  const createdAt = record.createdAt ? Date.parse(record.createdAt) : Date.now();
  const width = Math.max(1, Math.round(record.width ?? 1));
  const height = Math.max(1, Math.round(record.height ?? 1));
  const artwork: ProcessedArtworkImage = {
    id: record.id,
    name: record.name || record.id,
    url: record.previewUrl || record.sourceUrl || '',
    width,
    height,
    aspect: record.aspect && record.aspect > 0 ? record.aspect : width / height,
    particles: []
  };
  const features = record.features ?? defaultFeaturesFromArtwork(artwork);
  const gaussianModel: ArtworkGaussianModelResult = {
    jobId: record.gaussianModel?.jobId ?? `persisted-${record.id}`,
    sourceArtworkId: record.gaussianModel?.sourceArtworkId ?? record.id,
    source: 'triposplat',
    status: 'ready',
    format: record.gaussianModel?.format ?? (record.splatUrl ? 'splat' : 'ply'),
    splatUrl: record.gaussianModel?.splatUrl ?? record.splatUrl ?? undefined,
    plyUrl: record.gaussianModel?.plyUrl ?? record.plyUrl ?? undefined,
    previewUrl: record.gaussianModel?.previewUrl ?? record.previewUrl ?? undefined,
    manifestUrl: record.gaussianModel?.manifestUrl ?? record.manifestUrl ?? undefined,
    gaussianCount: record.gaussianModel?.gaussianCount ?? record.gaussianCount ?? 0,
    progress: 1,
    message: 'loaded from local library',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
  };

  return {
    ...artworkFromFeatures(artwork, features, undefined, gaussianModel),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
  };
}

// Start empty; backend SQLite hydration is triggered from App.
export const useArtworkStore = create<ArtworkStore>((set) => ({
  artworks: [],
  latestArtwork: null,
  addArtwork: (artwork, features, model3d, gaussianModel) => {
    const storedArtwork = artworkFromFeatures(artwork, features, model3d, gaussianModel);
    set((state) => {
      const artworks = [storedArtwork, ...state.artworks];
      useSketchStore.getState().beginSpotlight(storedArtwork.id);

      return {
        artworks,
        latestArtwork: storedArtwork
      };
    });
    return storedArtwork;
  },
  updateArtworkFeatures: (id, features) => set((state) => {
    let updatedLatest = state.latestArtwork;
    const artworks = state.artworks.map((artwork) => {
      if (artwork.id !== id) return artwork;
      const updated = artworkFromFeatures(artwork, features, artwork.model3d, artwork.gaussianModel, artwork.aiAnalysis);
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
  updateArtworkGaussianModel: (id, gaussianModel) => set((state) => {
    let updatedLatest = state.latestArtwork;
    const artworks = state.artworks.map((artwork) => {
      if (artwork.id !== id) return artwork;
      const updated = { ...artwork, gaussianModel };
      if (state.latestArtwork?.id === id) updatedLatest = updated;
      return updated;
    });

    return {
      artworks,
      latestArtwork: updatedLatest
    };
  }),
  hydrateBackendArtworks: (records) => set((state) => {
    if (!records.length) return state;

    const backendArtworks = records
      .filter((record) => record.splatUrl || record.plyUrl || record.gaussianModel?.splatUrl || record.gaussianModel?.plyUrl)
      .map(artworkFromBackendRecord);
    if (!backendArtworks.length) return state;

    const mergedById = new Map<string, StoredArtwork>();
    for (const artwork of [...backendArtworks, ...state.artworks]) {
      if (!mergedById.has(artwork.id)) {
        mergedById.set(artwork.id, artwork);
      }
    }
    const artworks = Array.from(mergedById.values())
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      artworks,
      latestArtwork: state.latestArtwork ?? artworks[0] ?? null
    };
  }),
  clearArtworks: () => {
    useSketchStore.getState().endSpotlight();
    set({
      artworks: [],
      latestArtwork: null
    });
  }
}));

