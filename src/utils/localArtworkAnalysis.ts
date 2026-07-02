import type { AIArtworkAnalysis } from '../services/aiImageService';
import type { ProcessedArtworkImage } from './artworkImage';
import type { CreatureActionType, CreatureMotionType } from './creatureMotion';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function uniqueActions(actions: CreatureActionType[]) {
  return Array.from(new Set(actions)).slice(0, 5);
}

function movementLabel(motionType: CreatureMotionType) {
  switch (motionType) {
    case 'fly':
      return ['滑翔', '悬停', '轻快振动'];
    case 'swim':
      return ['游动', '摆动', '流线穿梭'];
    case 'hop':
      return ['弹跳', '上下起伏'];
    case 'run':
      return ['快速穿梭', '短促闪避'];
    case 'walk':
      return ['缓慢移动', '轻微摆动'];
    case 'float':
    default:
      return ['漂浮', '旋转', '呼吸发光'];
  }
}

export function createLocalArtworkAnalysis(artwork: ProcessedArtworkImage): AIArtworkAnalysis {
  const particles = artwork.particles;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let edgeCount = 0;
  let brightnessSum = 0;
  let upperMass = 0;
  let lowerMass = 0;
  let leftMass = 0;
  let rightMass = 0;

  for (const particle of particles) {
    minX = Math.min(minX, particle.x);
    maxX = Math.max(maxX, particle.x);
    minY = Math.min(minY, particle.y);
    maxY = Math.max(maxY, particle.y);
    minZ = Math.min(minZ, particle.z);
    maxZ = Math.max(maxZ, particle.z);
    edgeCount += particle.isEdge ? 1 : 0;
    brightnessSum += particle.brightness;
    if (particle.y > 0) upperMass += 1;
    else lowerMass += 1;
    if (particle.x < 0) leftMass += 1;
    else rightMass += 1;
  }

  const width = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  const depth = Math.max(0.01, maxZ - minZ);
  const aspect = width / height;
  const edgeRatio = edgeCount / Math.max(1, particles.length);
  const brightness = brightnessSum / Math.max(1, particles.length);
  const horizontalBalance = 1 - Math.abs(leftMass - rightMass) / Math.max(1, particles.length);
  const verticalLift = upperMass / Math.max(1, upperMass + lowerMass);
  const elongation = clamp01(Math.abs(Math.log(aspect)) / 1.25);
  const roundness = clamp01(1 - Math.abs(aspect - 1) * 0.72);
  const openness = clamp01(edgeRatio * 2.6 + Math.max(0, aspect - 1) * 0.22 + verticalLift * 0.16);
  const appendageDensity = clamp01(edgeRatio * 2.2 + (1 - horizontalBalance) * 0.35 + Math.max(0, width - height) * 0.18);
  const edgeComplexity = clamp01(edgeRatio * 2.9 + depth * 0.75);
  const buoyancy = clamp01(0.58 + verticalLift * 0.24 + openness * 0.22);
  const fluidity = clamp01(0.54 + elongation * 0.18 + openness * 0.2);
  const energy = clamp01(0.52 + edgeComplexity * 0.24 + appendageDensity * 0.18 + brightness * 0.08);
  const visualDepth = clamp01(0.72 + depth * 0.8 + openness * 0.18);
  const visualGlow = clamp01(0.72 + brightness * 0.24 + edgeComplexity * 0.1);
  const visualEdgeGlow = clamp01(0.78 + edgeComplexity * 0.18);
  const visualTrail = clamp01(0.68 + energy * 0.18 + buoyancy * 0.12);
  const visualSpread = clamp01(0.62 + openness * 0.18 + appendageDensity * 0.14);
  let motionType: CreatureMotionType = 'float';
  const actions: CreatureActionType[] = [];

  if (buoyancy > 0.66 && (openness > 0.5 || appendageDensity > 0.45 || aspect > 1.05)) {
    motionType = 'fly';
    actions.push('glide', 'flutter', 'hover', 'dart', 'trail');
  } else if (fluidity > 0.68 && elongation > 0.52) {
    motionType = 'swim';
    actions.push('swim', 'wiggle', 'sweep', 'shimmer', 'trail');
  } else if (roundness > 0.66 && energy > 0.6) {
    motionType = 'hop';
    actions.push('hop', 'bob', 'pulse', 'trail');
  } else {
    motionType = 'float';
    actions.push('drift', 'hover', 'spiral', 'shimmer', 'bloom');
  }

  const silhouette = aspect > 1.25
    ? '横向展开、带外伸轮廓'
    : aspect < 0.78
      ? '纵向拉伸、轻盈上扬'
      : roundness > 0.66
        ? '圆润紧凑、边缘柔软'
        : '不规则开放轮廓';

  return {
    version: 'cosmic-creature-v1',
    source: 'local-vision',
    summary: `本地粒子形态识别：${silhouette}，适合${movementLabel(motionType).join('、')}。`,
    form: {
      silhouette,
      symmetry: horizontalBalance > 0.74 ? 'left-right' : 'asymmetric',
      elongation,
      roundness,
      openness,
      appendageDensity,
      edgeComplexity
    },
    behavior: {
      locomotion: movementLabel(motionType),
      tempo: energy > 0.7 ? 'fast' : energy > 0.48 ? 'medium' : 'slow',
      energy,
      buoyancy,
      fluidity,
      curiosity: clamp01(0.5 + openness * 0.28),
      caution: clamp01(0.18 + (1 - roundness) * 0.2)
    },
    visual: {
      glow: visualGlow,
      edgeGlow: visualEdgeGlow,
      trailLength: visualTrail,
      particleSpread: visualSpread,
      depth: visualDepth
    },
    motionType,
    actionTypes: uniqueActions(actions)
  };
}

export function mergeArtworkAnalysis(local: AIArtworkAnalysis, remote: AIArtworkAnalysis): AIArtworkAnalysis {
  if (remote.source !== 'ark') return local;

  const remoteActions = remote.actionTypes.length > 0 ? remote.actionTypes : local.actionTypes;

  return {
    ...local,
    source: 'ark',
    summary: remote.summary || local.summary,
    form: {
      ...local.form,
      silhouette: remote.form.silhouette || local.form.silhouette,
      symmetry: remote.form.symmetry === 'unclear' ? local.form.symmetry : remote.form.symmetry
    },
    behavior: {
      ...local.behavior,
      locomotion: remote.behavior.locomotion.length > 0 ? remote.behavior.locomotion : local.behavior.locomotion,
      curiosity: Math.max(local.behavior.curiosity, remote.behavior.curiosity)
    },
    visual: {
      glow: Math.max(local.visual.glow, remote.visual.glow),
      edgeGlow: Math.max(local.visual.edgeGlow, remote.visual.edgeGlow),
      trailLength: Math.max(local.visual.trailLength, remote.visual.trailLength),
      particleSpread: Math.max(local.visual.particleSpread, remote.visual.particleSpread),
      depth: Math.max(local.visual.depth, remote.visual.depth)
    },
    motionType: remote.motionType,
    actionTypes: uniqueActions(remoteActions)
  };
}
