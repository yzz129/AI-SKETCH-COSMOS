import type {
  ArtworkFeatureResult,
  LocomotionType,
  SubjectCategory
} from '../../types/artwork';
import { extractDominantColorsFromImage } from '../image/extractDominantColors';
import { resolveMotionPreset } from '../motion/resolveMotionPreset';

type FeatureBase = Omit<ArtworkFeatureResult, 'motionPreset'>;

const SUBJECT_CATEGORIES: SubjectCategory[] = ['animal', 'plant', 'character', 'abstract', 'object'];
const LOCOMOTION_TYPES: LocomotionType[] = [
  'flying',
  'running',
  'hopping',
  'walking',
  'swimming',
  'floating',
  'crawling',
  'swaying',
  'growing',
  'idle'
];
const ENERGY_LEVELS = ['calm', 'gentle', 'active'] as const;
const PERSONALITY_FEELS = ['cute', 'dreamy', 'playful', 'gentle', 'mysterious'] as const;
const BODY_ORIENTATIONS = ['horizontal', 'vertical', 'floating', 'undefined'] as const;
const COMPLEXITIES = ['simple', 'medium', 'complex'] as const;
const BRIGHTNESS_LEVELS = ['low', 'medium', 'high'] as const;
const SOFTNESS_LEVELS = ['soft', 'normal', 'sharp'] as const;
const TEXTURE_STYLES = ['handdrawn', 'watercolor', 'crayon', 'flat', 'mixed'] as const;
const REMOTE_FEATURE_RECOGNITION_ENABLED = import.meta.env.VITE_ARTWORK_FEATURE_RECOGNITION !== 'false';

const CHINESE_LOCOMOTION_MAP: Record<string, LocomotionType> = {
  飞行: 'flying',
  飞翔: 'flying',
  奔跑: 'running',
  跑动: 'running',
  跳跃: 'hopping',
  行走: 'walking',
  走路: 'walking',
  游动: 'swimming',
  游泳: 'swimming',
  漂浮: 'floating',
  悬浮: 'floating',
  爬行: 'crawling',
  摇摆: 'swaying',
  生长: 'growing',
  静止: 'idle',
  发光: 'idle'
};

function createNeutralFeatureResult(colors: string[]): FeatureBase {
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
      dominantColors: colors,
      brightness: 'medium',
      softness: 'soft',
      textureStyle: 'handdrawn'
    }
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to encode artwork image.'));
    };
    reader.onerror = () => reject(new Error('Unable to read artwork image.'));
    reader.readAsDataURL(file);
  });
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function pickBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function pickNumberEnum<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'number' && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeHexColor(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  return null;
}

function normalizeColorList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const colors = value
    .map(normalizeHexColor)
    .filter((color): color is string => Boolean(color));

  return colors.length ? colors.slice(0, 5) : fallback;
}

function normalizeLocomotion(value: unknown, fallback: LocomotionType): LocomotionType {
  if (typeof value !== 'string') return fallback;
  if (LOCOMOTION_TYPES.includes(value as LocomotionType)) return value as LocomotionType;
  return CHINESE_LOCOMOTION_MAP[value.trim()] ?? fallback;
}

function normalizeFeatureResult(raw: unknown, colors: string[]): FeatureBase {
  const fallback = createNeutralFeatureResult(colors);
  if (!raw || typeof raw !== 'object') return fallback;

  const input = raw as Record<string, unknown>;
  const morphology = (
    input.morphology && typeof input.morphology === 'object'
      ? input.morphology
      : {}
  ) as Record<string, unknown>;
  const behaviorTraits = (
    input.behaviorTraits && typeof input.behaviorTraits === 'object'
      ? input.behaviorTraits
      : {}
  ) as Record<string, unknown>;
  const visualTraits = (
    input.visualTraits && typeof input.visualTraits === 'object'
      ? input.visualTraits
      : {}
  ) as Record<string, unknown>;
  const wingCount = pickNumberEnum(morphology.wingCount, [0, 1, 2, 4] as const, fallback.morphology.wingCount);
  const legCount = pickNumberEnum(morphology.legCount, [0, 2, 4, 6, 8] as const, fallback.morphology.legCount);

  return {
    subjectCategory: pickEnum(input.subjectCategory, SUBJECT_CATEGORIES, fallback.subjectCategory),
    morphology: {
      hasWings: pickBoolean(morphology.hasWings, wingCount > 0),
      wingCount,
      hasLegs: pickBoolean(morphology.hasLegs, legCount > 0),
      legCount,
      hasTail: pickBoolean(morphology.hasTail, fallback.morphology.hasTail),
      hasFins: pickBoolean(morphology.hasFins, fallback.morphology.hasFins),
      hasArms: pickBoolean(morphology.hasArms, fallback.morphology.hasArms),
      hasHead: pickBoolean(morphology.hasHead, fallback.morphology.hasHead),
      bodyOrientation: pickEnum(
        morphology.bodyOrientation,
        BODY_ORIENTATIONS,
        fallback.morphology.bodyOrientation
      ),
      silhouetteComplexity: pickEnum(
        morphology.silhouetteComplexity,
        COMPLEXITIES,
        fallback.morphology.silhouetteComplexity
      )
    },
    behaviorTraits: {
      locomotionType: normalizeLocomotion(
        behaviorTraits.locomotionType,
        fallback.behaviorTraits.locomotionType
      ),
      energyLevel: pickEnum(
        behaviorTraits.energyLevel,
        ENERGY_LEVELS,
        fallback.behaviorTraits.energyLevel
      ),
      personalityFeel: pickEnum(
        behaviorTraits.personalityFeel,
        PERSONALITY_FEELS,
        fallback.behaviorTraits.personalityFeel
      )
    },
    visualTraits: {
      dominantColors: normalizeColorList(visualTraits.dominantColors, colors),
      brightness: pickEnum(visualTraits.brightness, BRIGHTNESS_LEVELS, fallback.visualTraits.brightness),
      softness: pickEnum(visualTraits.softness, SOFTNESS_LEVELS, fallback.visualTraits.softness),
      textureStyle: pickEnum(visualTraits.textureStyle, TEXTURE_STYLES, fallback.visualTraits.textureStyle)
    }
  };
}

async function callVisionFeatureApi(file: File) {
  const imageDataUrl = await fileToDataUrl(file);
  const response = await fetch('/api/artwork-features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI feature recognition failed with ${response.status}. ${detail}`);
  }

  const payload = await response.json() as { features?: unknown };
  return payload.features;
}

export async function analyzeArtworkFeatures(file: File): Promise<ArtworkFeatureResult> {
  const colors = await extractDominantColorsFromImage(file);
  let base: FeatureBase;

  if (REMOTE_FEATURE_RECOGNITION_ENABLED) {
    try {
      const rawFeatures = await callVisionFeatureApi(file);
      base = normalizeFeatureResult(rawFeatures, colors);
    } catch (error) {
      console.warn('AI feature recognition unavailable, using neutral visual fallback.', error);
      base = createNeutralFeatureResult(colors);
    }
  } else {
    base = createNeutralFeatureResult(colors);
  }

  return {
    ...base,
    motionPreset: resolveMotionPreset(base)
  };
}
