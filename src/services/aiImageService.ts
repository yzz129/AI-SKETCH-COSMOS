import {
  CREATURE_ACTION_TYPES,
  type CreatureActionType,
  type CreatureMotionType
} from '../utils/creatureMotion';

export type ImageToCreatureTextureInput = {
  file: File;
};

export type CreatureTextureResult = {
  texture: File | Blob;
  mask?: File | Blob;
  source: 'mock' | 'api';
};

export type ArtworkFormFeatures = {
  silhouette: string;
  symmetry: 'left-right' | 'radial' | 'asymmetric' | 'unclear';
  elongation: number;
  roundness: number;
  openness: number;
  appendageDensity: number;
  edgeComplexity: number;
};

export type ArtworkBehaviorFeatures = {
  locomotion: string[];
  tempo: 'slow' | 'medium' | 'fast' | 'mixed';
  energy: number;
  buoyancy: number;
  fluidity: number;
  curiosity: number;
  caution: number;
};

export type ArtworkVisualTreatment = {
  glow: number;
  edgeGlow: number;
  trailLength: number;
  particleSpread: number;
  depth: number;
};

export type AIArtworkAnalysis = {
  version: 'cosmic-creature-v1';
  source: 'ark' | 'local-vision' | 'local-fallback';
  summary: string;
  form: ArtworkFormFeatures;
  behavior: ArtworkBehaviorFeatures;
  visual: ArtworkVisualTreatment;
  motionType: CreatureMotionType;
  actionTypes: CreatureActionType[];
};

const DEFAULT_ACTIONS: CreatureActionType[] = ['drift', 'hover', 'shimmer', 'breathe'];
const ACTION_SET = new Set<CreatureActionType>(CREATURE_ACTION_TYPES);
const MOTION_TYPES = new Set<CreatureMotionType>(['fly', 'hop', 'swim', 'run', 'walk', 'crawl', 'float']);

function clamp01(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function clampVisual(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0.02) return fallback;
  return Math.max(0.18, Math.min(1, value));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function uniqueActions(actions: CreatureActionType[]) {
  return Array.from(new Set(actions)).slice(0, 5);
}

function inferMotionFromActions(actions: CreatureActionType[], behavior: ArtworkBehaviorFeatures): CreatureMotionType {
  if (actions.some((action) => ['flutter', 'glide', 'loop'].includes(action))) return 'fly';
  if (actions.some((action) => ['swim', 'wiggle', 'sweep'].includes(action))) return 'swim';
  if (actions.includes('hop')) return 'hop';
  if (behavior.buoyancy > 0.64 && behavior.energy > 0.44) return 'fly';
  if (behavior.fluidity > 0.66) return 'swim';
  if (actions.some((action) => ['dart', 'approach', 'retreat'].includes(action)) && behavior.energy > 0.62) return 'run';
  return 'float';
}

function inferActions(rawActions: string[], form: ArtworkFormFeatures, behavior: ArtworkBehaviorFeatures) {
  const actions = rawActions
    .map((action) => action.trim().toLowerCase())
    .filter((action): action is CreatureActionType => ACTION_SET.has(action as CreatureActionType));

  if (behavior.buoyancy > 0.58 || form.openness > 0.5 || form.appendageDensity > 0.42) {
    actions.push('glide', 'hover', 'flutter', 'trail');
  }
  if (behavior.fluidity > 0.62 || form.elongation > 0.64) {
    actions.push('swim', 'wiggle', 'sweep');
  }
  if (behavior.energy > 0.56) actions.push('dart', 'loop', 'shimmer');
  if (form.roundness > 0.58) actions.push('bob', 'pulse', 'bloom');
  if (form.edgeComplexity > 0.48) actions.push('shimmer', 'spiral');
  if (form.appendageDensity > 0.5) actions.push('flutter', 'stretch');
  if (behavior.curiosity > 0.58) actions.push('approach');
  if (behavior.caution > 0.56) actions.push('retreat');

  return uniqueActions(actions.length > 0 ? actions : DEFAULT_ACTIONS);
}

function fallbackAnalysis(fileName: string): AIArtworkAnalysis {
  const normalizedName = fileName.toLowerCase();
  const hasAirHint = /wing|fly|bird|kite|butterfly|cloud|star/.test(normalizedName);
  const hasWaterHint = /fish|sea|whale|swim|wave|water/.test(normalizedName);
  const hasJumpHint = /jump|hop|rabbit|bounce/.test(normalizedName);
  const actionTypes = hasWaterHint
    ? ['swim', 'wiggle', 'sweep', 'shimmer'] as CreatureActionType[]
    : hasAirHint
      ? ['glide', 'hover', 'flutter', 'loop', 'trail'] as CreatureActionType[]
      : hasJumpHint
        ? ['hop', 'bob', 'pulse', 'trail'] as CreatureActionType[]
        : ['drift', 'hover', 'shimmer', 'breathe', 'trail'] as CreatureActionType[];
  const behavior: ArtworkBehaviorFeatures = {
    locomotion: ['floating', 'wandering'],
    tempo: 'medium',
    energy: hasJumpHint ? 0.68 : 0.56,
    buoyancy: hasAirHint ? 0.78 : 0.62,
    fluidity: hasWaterHint ? 0.76 : 0.58,
    curiosity: 0.52,
    caution: 0.18
  };

  return {
    version: 'cosmic-creature-v1',
    source: 'local-fallback',
    summary: 'AI 暂不可用，使用本地默认形态：快速上屏、柔和发光、内部粒子流动。',
    form: {
      silhouette: 'soft hand-drawn silhouette',
      symmetry: 'unclear',
      elongation: hasWaterHint ? 0.68 : 0.44,
      roundness: 0.52,
      openness: hasAirHint ? 0.7 : 0.5,
      appendageDensity: hasAirHint ? 0.62 : 0.38,
      edgeComplexity: 0.52
    },
    behavior,
    visual: {
      glow: 0.78,
      edgeGlow: 0.84,
      trailLength: hasWaterHint || hasAirHint ? 0.82 : 0.66,
      particleSpread: 0.68,
      depth: 0.78
    },
    motionType: inferMotionFromActions(actionTypes, behavior),
    actionTypes
  };
}

export function normalizeAIArtworkAnalysis(raw: unknown, fileName: string): AIArtworkAnalysis {
  if (!raw || typeof raw !== 'object') return fallbackAnalysis(fileName);

  const input = raw as Record<string, unknown>;
  const rawForm = (input.form && typeof input.form === 'object' ? input.form : {}) as Record<string, unknown>;
  const rawBehavior = (input.behavior && typeof input.behavior === 'object' ? input.behavior : {}) as Record<string, unknown>;
  const rawVisual = (input.visual && typeof input.visual === 'object' ? input.visual : {}) as Record<string, unknown>;
  const form: ArtworkFormFeatures = {
    silhouette: typeof rawForm.silhouette === 'string' ? rawForm.silhouette : 'unclassified silhouette',
    symmetry: pickEnum(rawForm.symmetry, ['left-right', 'radial', 'asymmetric', 'unclear'], 'unclear'),
    elongation: clamp01(rawForm.elongation, 0.45),
    roundness: clamp01(rawForm.roundness, 0.45),
    openness: clamp01(rawForm.openness, 0.45),
    appendageDensity: clamp01(rawForm.appendageDensity, 0.35),
    edgeComplexity: clamp01(rawForm.edgeComplexity, 0.45)
  };
  const behavior: ArtworkBehaviorFeatures = {
    locomotion: asStringArray(rawBehavior.locomotion).slice(0, 5),
    tempo: pickEnum(rawBehavior.tempo, ['slow', 'medium', 'fast', 'mixed'], 'medium'),
    energy: clamp01(rawBehavior.energy, 0.54),
    buoyancy: clamp01(rawBehavior.buoyancy, 0.62),
    fluidity: clamp01(rawBehavior.fluidity, 0.58),
    curiosity: clamp01(rawBehavior.curiosity, 0.5),
    caution: clamp01(rawBehavior.caution, 0.2)
  };
  const visual: ArtworkVisualTreatment = {
    glow: clampVisual(rawVisual.glow, 0.78),
    edgeGlow: clampVisual(rawVisual.edgeGlow, 0.84),
    trailLength: clampVisual(rawVisual.trailLength, 0.72),
    particleSpread: clampVisual(rawVisual.particleSpread, 0.68),
    depth: clampVisual(rawVisual.depth, 0.78)
  };
  const actionTypes = inferActions(asStringArray(input.actionTypes), form, behavior);
  const motionType = MOTION_TYPES.has(input.motionType as CreatureMotionType)
    ? input.motionType as CreatureMotionType
    : inferMotionFromActions(actionTypes, behavior);

  return {
    version: 'cosmic-creature-v1',
    source: input.source === 'ark' ? 'ark' : input.source === 'local-vision' ? 'local-vision' : 'local-fallback',
    summary: typeof input.summary === 'string' && input.summary.trim()
      ? input.summary.trim().slice(0, 140)
      : '已识别画作的形态与行为倾向，并转换为星空粒子对象。',
    form,
    behavior,
    visual,
    motionType,
    actionTypes
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to encode image.'));
    };
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

export async function analyzeArtworkBehavior(file: File): Promise<AIArtworkAnalysis> {
  try {
    const imageDataUrl = await fileToDataUrl(file);
    const response = await fetch('/api/ai-recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        imageDataUrl
      })
    });

    if (!response.ok) {
      throw new Error(`AI recognition failed with ${response.status}.`);
    }

    const payload = await response.json() as { analysis?: unknown };
    return normalizeAIArtworkAnalysis(payload.analysis, file.name);
  } catch (error) {
    console.warn('AI behavior recognition unavailable, using local fallback.', error);
    return fallbackAnalysis(file.name);
  }
}

export async function imageToCreatureTexture(inputImage: ImageToCreatureTextureInput): Promise<CreatureTextureResult> {
  return {
    texture: inputImage.file,
    source: 'mock'
  };
}
