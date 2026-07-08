export type CreatureMotionType = 'fly' | 'hop' | 'swim' | 'run' | 'walk' | 'crawl' | 'float';

export const CREATURE_ACTION_TYPES = [
  'glide',
  'hover',
  'drift',
  'orbit',
  'spiral',
  'flutter',
  'swim',
  'dart',
  'pulse',
  'breathe',
  'bob',
  'hop',
  'tumble',
  'loop',
  'sweep',
  'wiggle',
  'shimmer',
  'bloom',
  'stretch',
  'trail',
  'approach',
  'retreat'
] as const;

export type CreatureActionType = typeof CREATURE_ACTION_TYPES[number];

export type CreatureBehaviorSignature = {
  energy: number;
  buoyancy: number;
  fluidity: number;
  glow: number;
  edgeGlow: number;
  trailLength: number;
  particleSpread: number;
  depth: number;
};

export type CreatureMotionConfig = {
  baseX: number;
  baseY: number;
  baseZ: number;
  entryX: number;
  entryY: number;
  entryZ: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  speed: number;
  phase: number;
  baseScale: number;
  seed: number;
};

export type CreatureMotionPose = {
  extraX: number;
  extraY: number;
  extraZ: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  wingFlap: number;
  waveAmplitude: number;
  waveFrequency: number;
};

export type CreatureActionPose = {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  roll: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  flowMultiplier: number;
  trailMultiplier: number;
};

export type CreatureMotionPreset = {
  speed: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  flowAmount: number;
  trailIntensity: number;
  rotationAmount: number;
};

const DEFAULT_SIGNATURE: CreatureBehaviorSignature = {
  energy: 0.5,
  buoyancy: 0.58,
  fluidity: 0.54,
  glow: 0.68,
  edgeGlow: 0.72,
  trailLength: 0.56,
  particleSpread: 0.5,
  depth: 0.62
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mix(min: number, max: number, amount: number) {
  return min + (max - min) * clamp(amount, 0, 1);
}

function normalizeSignature(signature?: Partial<CreatureBehaviorSignature>): CreatureBehaviorSignature {
  return {
    energy: clamp(signature?.energy ?? DEFAULT_SIGNATURE.energy, 0, 1),
    buoyancy: clamp(signature?.buoyancy ?? DEFAULT_SIGNATURE.buoyancy, 0, 1),
    fluidity: clamp(signature?.fluidity ?? DEFAULT_SIGNATURE.fluidity, 0, 1),
    glow: clamp(signature?.glow ?? DEFAULT_SIGNATURE.glow, 0, 1),
    edgeGlow: clamp(signature?.edgeGlow ?? DEFAULT_SIGNATURE.edgeGlow, 0, 1),
    trailLength: clamp(signature?.trailLength ?? DEFAULT_SIGNATURE.trailLength, 0, 1),
    particleSpread: clamp(signature?.particleSpread ?? DEFAULT_SIGNATURE.particleSpread, 0, 1),
    depth: clamp(signature?.depth ?? DEFAULT_SIGNATURE.depth, 0, 1)
  };
}

export function createCreatureBehaviorSignature(signature?: Partial<CreatureBehaviorSignature>) {
  return normalizeSignature(signature);
}

export function detectCreatureMotionType(name: string): CreatureMotionType {
  const normalized = name.toLowerCase();

  if (/bird|eagle|duck|goose|swan|parrot|crow|wing|kite|butterfly/.test(normalized)) return 'fly';
  if (/rabbit|bunny|hare|jump|hop|bounce/.test(normalized)) return 'hop';
  if (/fish|whale|shark|dolphin|sea|ocean|water|wave/.test(normalized)) return 'swim';
  if (/cat|kitty|tiger|lion|run|fast/.test(normalized)) return 'run';
  if (/elephant|walk|slow/.test(normalized)) return 'walk';

  return 'float';
}

export function getCreatureMotionPreset(
  motionType: CreatureMotionType,
  signature?: Partial<CreatureBehaviorSignature>
): CreatureMotionPreset {
  const behavior = normalizeSignature(signature);
  const energyBoost = mix(0.92, 1.42, behavior.energy);
  const fluidBoost = mix(0.94, 1.28, behavior.fluidity);
  const buoyancyBoost = mix(0.82, 1.24, behavior.buoyancy);
  const trailBoost = mix(0.74, 1.38, behavior.trailLength);
  const spreadBoost = mix(0.9, 1.18, behavior.particleSpread);
  const base = (() => {
    switch (motionType) {
      case 'fly':
        return { speed: 0.34, radiusX: 1.18, radiusY: 0.62, radiusZ: 1.22, flowAmount: 1.08, trailIntensity: 1.08, rotationAmount: 0.11 };
      case 'swim':
        return { speed: 0.3, radiusX: 1.22, radiusY: 0.34, radiusZ: 0.96, flowAmount: 1.08, trailIntensity: 1.0, rotationAmount: 0.1 };
      case 'hop':
        return { speed: 0.25, radiusX: 0.62, radiusY: 0.72, radiusZ: 0.76, flowAmount: 0.78, trailIntensity: 0.82, rotationAmount: 0.08 };
      case 'run':
        return { speed: 0.32, radiusX: 0.9, radiusY: 0.32, radiusZ: 0.86, flowAmount: 0.88, trailIntensity: 0.92, rotationAmount: 0.09 };
      case 'walk':
        return { speed: 0.2, radiusX: 0.56, radiusY: 0.26, radiusZ: 0.6, flowAmount: 0.68, trailIntensity: 0.72, rotationAmount: 0.06 };
      case 'crawl':
        return { speed: 0.18, radiusX: 0.66, radiusY: 0.18, radiusZ: 0.58, flowAmount: 0.62, trailIntensity: 0.64, rotationAmount: 0.055 };
      case 'float':
      default:
        return { speed: 0.24, radiusX: 0.72, radiusY: 0.44, radiusZ: 0.8, flowAmount: 0.82, trailIntensity: 0.86, rotationAmount: 0.075 };
    }
  })();

  return {
    speed: base.speed * energyBoost,
    radiusX: base.radiusX * spreadBoost * mix(0.92, 1.18, behavior.fluidity),
    radiusY: base.radiusY * buoyancyBoost,
    radiusZ: base.radiusZ * mix(0.9, 1.22, behavior.depth),
    flowAmount: clamp(base.flowAmount * fluidBoost * mix(0.92, 1.18, behavior.glow), 0.2, 1.5),
    trailIntensity: clamp(base.trailIntensity * trailBoost, 0.2, 1.28),
    rotationAmount: base.rotationAmount * mix(0.84, 1.3, behavior.energy)
  };
}

export function createCreatureMotionConfig(
  index: number,
  motionType: CreatureMotionType,
  signature?: Partial<CreatureBehaviorSignature>
): CreatureMotionConfig {
  const phase = index * 1.91 + 0.45;
  const edgeSide = index % 2 === 0 ? -1 : 1;
  const preset = getCreatureMotionPreset(motionType, signature);

  return {
    baseX: Math.max(-2.5, Math.min(3.5, Math.cos(phase) * 2.6 + 0.45)),
    baseY: Math.max(-1.3, Math.min(1.4, Math.sin(phase) * 1.08)),
    baseZ: -2.35 + (index % 6) * 0.58,
    entryX: edgeSide * (4.4 + (index % 3) * 0.32),
    entryY: Math.sin(phase + 1.2) * 1.35,
    entryZ: -4.2 - (index % 2) * 0.45,
    radiusX: preset.radiusX * (0.82 + (index % 3) * 0.08),
    radiusY: preset.radiusY * (0.86 + (index % 4) * 0.06),
    radiusZ: preset.radiusZ * (0.84 + (index % 4) * 0.07),
    speed: preset.speed * (0.88 + (index % 5) * 0.045),
    phase,
    baseScale: Math.max(0.7, 1.15 - index * 0.05),
    seed: phase * 10.37
  };
}

export function pickCreatureAction(actions: CreatureActionType[], time: number, phase: number) {
  if (actions.length === 0) return 'drift';

  const segment = Math.floor((time + phase * 2.7) / 4.6);
  const noise = Math.sin(segment * 12.9898 + phase * 78.233) * 43758.5453;
  const index = Math.abs(Math.floor(noise)) % actions.length;
  return actions[index];
}

export function getCreatureActionPose(action: CreatureActionType, time: number, phase: number): CreatureActionPose {
  const pulse = Math.sin(time * 1.2 + phase);
  const quick = Math.sin(time * 3.1 + phase);
  const drift = Math.sin(time * 0.55 + phase);
  const none: CreatureActionPose = {
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    roll: 0,
    yaw: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    flowMultiplier: 1,
    trailMultiplier: 1
  };

  switch (action) {
    case 'glide':
      return { ...none, offsetY: Math.sin(time * 1.05 + phase) * 0.1, offsetZ: Math.cos(time * 0.78 + phase) * 0.07, roll: drift * 0.14, yaw: Math.sin(time * 0.68 + phase) * 0.12, scaleX: 1.04, scaleY: 0.98, flowMultiplier: 1.08, trailMultiplier: 1.32 };
    case 'hover':
      return { ...none, offsetY: Math.sin(time * 1.45 + phase) * 0.11, offsetZ: Math.cos(time * 0.92 + phase) * 0.06, roll: drift * 0.06, yaw: Math.sin(time * 0.7 + phase) * 0.1, flowMultiplier: 1.05, trailMultiplier: 1.12 };
    case 'orbit':
      return { ...none, offsetX: Math.cos(time * 0.96 + phase) * 0.14, offsetY: Math.sin(time * 0.96 + phase) * 0.11, yaw: Math.sin(time * 0.82 + phase) * 0.18, trailMultiplier: 1.28 };
    case 'spiral':
      return { ...none, offsetX: Math.cos(time * 1.15 + phase) * 0.15, offsetY: Math.sin(time * 1.15 + phase) * 0.15, roll: quick * 0.18, yaw: Math.cos(time * 0.82 + phase) * 0.15, flowMultiplier: 1.18, trailMultiplier: 1.34 };
    case 'flutter':
      return { ...none, offsetY: Math.sin(time * 5.2 + phase) * 0.055 + Math.sin(time * 1.32 + phase) * 0.09, offsetZ: Math.cos(time * 1.7 + phase) * 0.05, roll: Math.sin(time * 4.7 + phase) * 0.14, yaw: Math.sin(time * 1.05 + phase) * 0.16, scaleX: 1 + Math.abs(quick) * 0.035, scaleY: 1 + quick * 0.03, flowMultiplier: 1.3, trailMultiplier: 1.28 };
    case 'swim':
      return { ...none, offsetX: Math.sin(time * 0.86 + phase) * 0.12, offsetY: Math.sin(time * 1.12 + phase) * 0.06, roll: Math.sin(time * 1.6 + phase) * 0.12, scaleX: 1 + quick * 0.024, scaleY: 1 - quick * 0.018, flowMultiplier: 1.22, trailMultiplier: 1.16 };
    case 'dart': {
      const burst = Math.max(0, Math.sin(time * 2.4 + phase));
      return { ...none, offsetX: burst * 0.22, offsetZ: -burst * 0.08, roll: burst * -0.16, scaleX: 1 + burst * 0.08, scaleY: 1 - burst * 0.04, flowMultiplier: 1.24, trailMultiplier: 1.36 };
    }
    case 'pulse':
      return { ...none, scaleX: 1 + pulse * 0.05, scaleY: 1 + pulse * 0.05, scaleZ: 1 + pulse * 0.08, flowMultiplier: 1.08 };
    case 'breathe':
      return { ...none, scaleX: 1 + pulse * 0.025, scaleY: 1 + pulse * 0.035, scaleZ: 1 + pulse * 0.03, flowMultiplier: 0.94 };
    case 'bob':
      return { ...none, offsetY: Math.sin(time * 1.65 + phase) * 0.14, scaleY: 1 + Math.max(0, quick) * 0.025 };
    case 'hop': {
      const hop = Math.max(0, Math.sin(time * 2.25 + phase));
      return { ...none, offsetY: hop * 0.3, roll: Math.sin(time * 2.25 + phase) * 0.08, scaleX: 1 + (1 - hop) * 0.035, scaleY: 1 + hop * 0.06, trailMultiplier: 0.9 };
    }
    case 'tumble':
      return { ...none, offsetY: drift * 0.06, roll: Math.sin(time * 1.4 + phase) * 0.28, yaw: Math.cos(time * 0.9 + phase) * 0.18, flowMultiplier: 0.98 };
    case 'loop':
      return { ...none, offsetX: Math.cos(time * 1.1 + phase) * 0.16, offsetY: Math.sin(time * 1.1 + phase) * 0.17, roll: Math.sin(time * 1.1 + phase) * 0.22, trailMultiplier: 1.22 };
    case 'sweep':
      return { ...none, offsetX: Math.sin(time * 0.72 + phase) * 0.18, roll: Math.sin(time * 1.2 + phase) * 0.09, scaleX: 1.03, flowMultiplier: 1.1 };
    case 'wiggle':
      return { ...none, offsetX: Math.sin(time * 3.4 + phase) * 0.045, roll: Math.sin(time * 3.7 + phase) * 0.1, scaleX: 1 + quick * 0.025, flowMultiplier: 1.25 };
    case 'shimmer':
      return { ...none, offsetZ: Math.sin(time * 2.4 + phase) * 0.04, scaleZ: 1 + pulse * 0.05, flowMultiplier: 1.18, trailMultiplier: 1.08 };
    case 'bloom': {
      const bloom = 0.5 + Math.sin(time * 0.95 + phase) * 0.5;
      return { ...none, scaleX: 1 + bloom * 0.06, scaleY: 1 + bloom * 0.06, scaleZ: 1 + bloom * 0.1, flowMultiplier: 1.12 };
    }
    case 'stretch':
      return { ...none, scaleX: 1 + Math.sin(time * 1.35 + phase) * 0.07, scaleY: 1 - Math.sin(time * 1.35 + phase) * 0.035, flowMultiplier: 1.06 };
    case 'trail':
      return { ...none, offsetZ: Math.sin(time * 0.8 + phase) * 0.05, trailMultiplier: 1.38, flowMultiplier: 1.08 };
    case 'approach':
      return { ...none, offsetZ: Math.sin(time * 0.7 + phase) * 0.12 + 0.06, scaleX: 1.02, scaleY: 1.02, trailMultiplier: 0.88 };
    case 'retreat':
      return { ...none, offsetX: Math.sin(time * 1.2 + phase) * -0.08, offsetZ: -0.1 + Math.cos(time * 0.7 + phase) * 0.05, roll: drift * -0.11, trailMultiplier: 1.18 };
    case 'drift':
    default:
      return { ...none, offsetX: drift * 0.04, offsetY: Math.sin(time * 0.82 + phase) * 0.08, offsetZ: Math.cos(time * 0.58 + phase) * 0.05, roll: drift * 0.04, flowMultiplier: 0.86 };
  }
}

export function getCreatureMotionPose(motionType: CreatureMotionType, time: number, phase: number): CreatureMotionPose {
  const pulse = Math.sin(time * 1.2 + phase);

  switch (motionType) {
    case 'fly': {
      const flap = Math.sin(time * 5.2 + phase);
      return {
        extraX: Math.sin(time * 0.7 + phase) * 0.04,
        extraY: Math.sin(time * 1.6 + phase) * 0.16,
        extraZ: Math.cos(time * 0.9 + phase) * 0.05,
        rotationZ: Math.sin(time * 1.35 + phase) * 0.12,
        scaleX: 1 + Math.abs(flap) * 0.025,
        scaleY: 1 + flap * 0.035,
        wingFlap: flap,
        waveAmplitude: 0.012,
        waveFrequency: 3.8
      };
    }
    case 'hop': {
      const hop = Math.max(0, Math.sin(time * 2.25 + phase));
      const squash = Math.max(0, Math.sin(time * 2.25 + phase + Math.PI));
      return {
        extraX: Math.sin(time * 0.5 + phase) * 0.035,
        extraY: hop * 0.34,
        extraZ: Math.sin(time * 0.8 + phase) * 0.04,
        rotationZ: Math.sin(time * 1.2 + phase) * 0.055,
        scaleX: 1 + squash * 0.045,
        scaleY: 1 + hop * 0.08 - squash * 0.055,
        wingFlap: Math.sin(time * 3.4 + phase),
        waveAmplitude: 0.006,
        waveFrequency: 2.2
      };
    }
    case 'swim':
      return {
        extraX: Math.sin(time * 0.78 + phase) * 0.11,
        extraY: Math.sin(time * 1.05 + phase) * 0.08,
        extraZ: Math.cos(time * 0.72 + phase) * 0.08,
        rotationZ: Math.sin(time * 1.55 + phase) * 0.13,
        scaleX: 1 + Math.sin(time * 2.0 + phase) * 0.025,
        scaleY: 1 - Math.sin(time * 2.0 + phase) * 0.016,
        wingFlap: Math.sin(time * 4.0 + phase),
        waveAmplitude: 0.035,
        waveFrequency: 7.0
      };
    case 'run': {
      const cadence = Math.sin(time * 4.0 + phase);
      return {
        extraX: Math.sin(time * 0.95 + phase) * 0.13,
        extraY: Math.abs(cadence) * 0.08,
        extraZ: Math.sin(time * 0.55 + phase) * 0.05,
        rotationZ: cadence * 0.055,
        scaleX: 1 + cadence * 0.032,
        scaleY: 1 - cadence * 0.024,
        wingFlap: Math.sin(time * 3.1 + phase),
        waveAmplitude: 0.013,
        waveFrequency: 4.6
      };
    }
    case 'walk':
      return {
        extraX: Math.sin(time * 0.42 + phase) * 0.04,
        extraY: Math.sin(time * 1.0 + phase) * 0.035,
        extraZ: Math.sin(time * 0.42 + phase) * 0.05,
        rotationZ: Math.sin(time * 0.9 + phase) * 0.025,
        scaleX: 1 + pulse * 0.01,
        scaleY: 1 - pulse * 0.008,
        wingFlap: Math.sin(time * 1.8 + phase),
        waveAmplitude: 0.006,
        waveFrequency: 1.7
      };
    case 'crawl':
      return {
        extraX: Math.sin(time * 0.7 + phase) * 0.065,
        extraY: Math.abs(Math.sin(time * 1.45 + phase)) * 0.028,
        extraZ: Math.sin(time * 0.92 + phase) * 0.08,
        rotationZ: Math.sin(time * 1.8 + phase) * 0.052,
        scaleX: 1 + Math.sin(time * 1.7 + phase) * 0.035,
        scaleY: 1 - Math.abs(Math.sin(time * 1.7 + phase)) * 0.022,
        wingFlap: Math.sin(time * 2.2 + phase),
        waveAmplitude: 0.026,
        waveFrequency: 5.6
      };
    case 'float':
    default:
      return {
        extraX: Math.sin(time * 0.45 + phase) * 0.035,
        extraY: Math.sin(time * 0.9 + phase) * 0.11,
        extraZ: Math.cos(time * 0.54 + phase) * 0.08,
        rotationZ: Math.sin(time * 0.8 + phase) * 0.06,
        scaleX: 1 + pulse * 0.018,
        scaleY: 1 + pulse * 0.018,
        wingFlap: Math.sin(time * 1.6 + phase),
        waveAmplitude: 0.008,
        waveFrequency: 2.8
      };
  }
}

export function getTrailProfile(motionType: CreatureMotionType, signature?: Partial<CreatureBehaviorSignature>) {
  const behavior = normalizeSignature(signature);
  const boost = mix(0.78, 1.45, behavior.trailLength);

  switch (motionType) {
    case 'fly':
      return { count: Math.round(170 * boost), length: 1.25 * boost, spread: 0.34 };
    case 'swim':
      return { count: Math.round(150 * boost), length: 1.12 * boost, spread: 0.22 };
    case 'run':
      return { count: Math.round(120 * boost), length: 0.78 * boost, spread: 0.18 };
    case 'hop':
      return { count: Math.round(105 * boost), length: 0.7 * boost, spread: 0.2 };
    case 'walk':
      return { count: Math.round(95 * boost), length: 0.64 * boost, spread: 0.16 };
    case 'crawl':
      return { count: Math.round(90 * boost), length: 0.58 * boost, spread: 0.14 };
    case 'float':
    default:
      return { count: Math.round(120 * boost), length: 0.84 * boost, spread: 0.22 };
  }
}
