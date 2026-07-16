import type { SplatMesh as SparkSplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { CreaturePartActionPose } from './creaturePartActions';
import { integrateDampedAngle } from './jointMotionMath';
import { resolveRigAssetUrl } from './rigAssetUrl';

export type CpuSplatPartKind = 'body' | 'arm' | 'leg' | 'wing' | 'fin' | 'tail' | 'ear' | 'head';

export type CpuSplatPartDefinition = {
  index: number;
  id: string;
  parentIndex: number;
  kind: CpuSplatPartKind;
  side: 'left' | 'right' | 'center';
  pivot: [number, number, number];
  animation: {
    axis: [number, number, number];
    amplitude: number;
    frequency: number;
    phase: number;
  };
};

export type CpuSplatPartRig = {
  version: number;
  revision: number;
  enabled: boolean;
  strategy: 'cpu-splat-bone-mapping';
  motionMethod: 'cpu-rest-pose-bone-remapping';
  skinningMethod: 'cpu-linear-blend';
  segmentationMethod: 'generated-splat-multiview-fusion-v1';
  sourceGaussianCount: number;
  weightsUrl: string;
  weightsFormat: 'spark-rgba16ui-little-endian';
  weightsByteLength: number;
  maxInfluences: 4;
  bones: CpuSplatPartDefinition[];
};

type RuntimeBone = {
  definition: CpuSplatPartDefinition;
  pivot: THREE.Vector3;
  axis: THREE.Vector3;
  localRotation: THREE.Quaternion;
  deformRotation: THREE.Quaternion;
  deformMatrix: THREE.Matrix4;
  angle: number;
  angularVelocity: number;
};

type DynamicSplats = {
  indices: Uint32Array;
  boneIndices: Uint8Array;
  boneWeights: Float32Array;
  basePositions: Float32Array;
  baseRotations: Float32Array;
  baseScales: Float32Array;
  opacities: Float32Array;
  colors: Float32Array;
};

export type CpuSplatPartMotionRuntime = {
  mesh: SparkSplatMesh;
  bones: RuntimeBone[];
  splats: DynamicSplats;
  lastUpdateTime: number;
  updateOffset: number;
  updateInterval: number;
};

const MIN_UPDATE_HZ = 18;
const MAX_UPDATE_HZ = 24;
const INFLUENCE_SLOTS = 4;
// A point must belong primarily to one moving part before it is animated.
// Treating every tiny secondary weight as a moving point leaves a stationary
// copy-shaped collar around the limb and reads as extra arms/legs in a Splat.
const MIN_PRIMARY_PART_WEIGHT = 0.34;
const MOVING_KINDS = new Set<CpuSplatPartKind>([
  'arm',
  'leg',
  'wing',
  'fin',
  'tail',
  'ear',
  'head'
]);
const MAX_ANGLES: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 0.08,
  ear: 0.12,
  arm: 0.28,
  leg: 0.22,
  wing: 0.34,
  fin: 0.26,
  tail: 0.36
};
const ACTION_MAX_ANGLES: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 0.42,
  ear: 0.48,
  arm: 0.84,
  leg: 0.66,
  wing: 0.9,
  fin: 0.7,
  tail: 0.82
};
const JOINT_INERTIA: Record<CpuSplatPartKind, number> = {
  body: 1,
  head: 0.72,
  ear: 0.18,
  arm: 0.52,
  leg: 0.86,
  wing: 0.62,
  fin: 0.3,
  tail: 0.28
};
const ACTION_STIFFNESS: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 78,
  ear: 42,
  arm: 72,
  leg: 82,
  wing: 64,
  fin: 58,
  tail: 46
};
const NATURAL_STIFFNESS: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 34,
  ear: 22,
  arm: 38,
  leg: 46,
  wing: 40,
  fin: 34,
  tail: 24
};
const JOINT_DAMPING_RATIO: Record<CpuSplatPartKind, number> = {
  body: 1,
  head: 0.88,
  ear: 0.58,
  arm: 0.72,
  leg: 0.84,
  wing: 0.68,
  fin: 0.65,
  tail: 0.55
};
const MAX_ANGULAR_SPEED: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 3.2,
  ear: 5.4,
  arm: 5.1,
  leg: 4.1,
  wing: 5.8,
  fin: 5.2,
  tail: 5.6
};
const MAX_ANGULAR_ACCELERATION: Record<CpuSplatPartKind, number> = {
  body: 0,
  head: 32,
  ear: 68,
  arm: 54,
  leg: 42,
  wing: 62,
  fin: 58,
  tail: 64
};

const IDENTITY_QUATERNION = new THREE.Quaternion();
const TEMP_CENTER = new THREE.Vector3();
const TEMP_SCALE = new THREE.Vector3();
const TEMP_BASE_ROTATION = new THREE.Quaternion();
const TEMP_OUTPUT_ROTATION = new THREE.Quaternion();
const TEMP_BLEND_ROTATION = new THREE.Quaternion();
const TEMP_COLOR = new THREE.Color();
const TEMP_LOCAL_MATRIX = new THREE.Matrix4();
const TEMP_ROTATION_MATRIX = new THREE.Matrix4();
const TEMP_TRANSLATE_TO_PIVOT = new THREE.Matrix4();
const TEMP_TRANSLATE_FROM_PIVOT = new THREE.Matrix4();

export function isCpuSplatPartRig(value: unknown): value is CpuSplatPartRig {
  if (!value || typeof value !== 'object') return false;
  const rig = value as Partial<CpuSplatPartRig>;
  return rig.enabled === true
    && Number(rig.version) >= 14
    && rig.strategy === 'cpu-splat-bone-mapping'
    && rig.motionMethod === 'cpu-rest-pose-bone-remapping'
    && rig.skinningMethod === 'cpu-linear-blend'
    && rig.segmentationMethod === 'generated-splat-multiview-fusion-v1'
    && Number.isInteger(rig.sourceGaussianCount)
    && typeof rig.weightsUrl === 'string'
    && rig.weightsFormat === 'spark-rgba16ui-little-endian'
    && rig.maxInfluences === INFLUENCE_SLOTS
    && Array.isArray(rig.bones)
    && rig.bones.length > 1;
}

function readPackedWeights(buffer: ArrayBuffer, expectedValues: number) {
  if (buffer.byteLength !== expectedValues * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error(`Splat bone-map length mismatch: expected ${expectedValues * 2}, got ${buffer.byteLength}.`);
  }
  const output = new Uint16Array(expectedValues);
  const view = new DataView(buffer);
  for (let index = 0; index < expectedValues; index += 1) {
    output[index] = view.getUint16(index * Uint16Array.BYTES_PER_ELEMENT, true);
  }
  return output;
}

function createRuntimeBones(definitions: CpuSplatPartDefinition[]) {
  const ordered = [...definitions].sort((left, right) => left.index - right.index);
  return ordered.map((definition, expectedIndex) => {
    if (definition.index !== expectedIndex) {
      throw new Error(`Splat bone indices must be contiguous; expected ${expectedIndex}, got ${definition.index}.`);
    }
    const axis = new THREE.Vector3(...definition.animation.axis);
    if (axis.lengthSq() < 1e-10) axis.set(0, 0, 1);
    axis.normalize();
    return {
      definition,
      pivot: new THREE.Vector3(...definition.pivot),
      axis,
      localRotation: new THREE.Quaternion(),
      deformRotation: new THREE.Quaternion(),
      deformMatrix: new THREE.Matrix4(),
      angle: 0,
      angularVelocity: 0
    } satisfies RuntimeBone;
  });
}

function isMovingBone(bones: RuntimeBone[], index: number) {
  const bone = bones[index];
  return Boolean(bone && MOVING_KINDS.has(bone.definition.kind));
}

function captureDynamicSplats(mesh: SparkSplatMesh, bones: RuntimeBone[], packed: Uint16Array) {
  const active: number[] = [];
  for (let splatIndex = 0; splatIndex < mesh.numSplats; splatIndex += 1) {
    let primaryBoneIndex = 0;
    let primaryWeight = 0;
    const offset = splatIndex * INFLUENCE_SLOTS;
    for (let slot = 0; slot < INFLUENCE_SLOTS; slot += 1) {
      const value = packed[offset + slot];
      const boneIndex = value >>> 8;
      const weight = (value & 0xff) / 255;
      if (weight > primaryWeight) {
        primaryWeight = weight;
        primaryBoneIndex = boneIndex;
      }
    }
    if (primaryWeight >= MIN_PRIMARY_PART_WEIGHT && isMovingBone(bones, primaryBoneIndex)) {
      active.push(splatIndex);
    }
  }

  const count = active.length;
  const output: DynamicSplats = {
    indices: Uint32Array.from(active),
    boneIndices: new Uint8Array(count * INFLUENCE_SLOTS),
    boneWeights: new Float32Array(count * INFLUENCE_SLOTS),
    basePositions: new Float32Array(count * 3),
    baseRotations: new Float32Array(count * 4),
    baseScales: new Float32Array(count * 3),
    opacities: new Float32Array(count),
    colors: new Float32Array(count * 3)
  };

  for (let cursor = 0; cursor < count; cursor += 1) {
    const splatIndex = output.indices[cursor];
    const sourceOffset = splatIndex * INFLUENCE_SLOTS;
    const influenceOffset = cursor * INFLUENCE_SLOTS;
    let primaryBoneIndex = 0;
    let primaryWeight = 0;
    for (let slot = 0; slot < INFLUENCE_SLOTS; slot += 1) {
      const value = packed[sourceOffset + slot];
      const boneIndex = value >>> 8;
      const weight = (value & 0xff) / 255;
      if (weight > primaryWeight) {
        primaryWeight = weight;
        primaryBoneIndex = boneIndex < bones.length ? boneIndex : 0;
      }
    }
    // Exclusive rigid ownership is deliberate: a Gaussian cannot render in
    // two anatomical places, and each frame is rebuilt from the captured rest
    // pose. This removes the stretched/duplicated limb silhouette caused by
    // blending unrelated body and limb transforms.
    output.boneIndices[influenceOffset] = primaryBoneIndex;
    output.boneWeights[influenceOffset] = 1;

    const splat = mesh.packedSplats.getSplat(splatIndex);
    const i3 = cursor * 3;
    const i4 = cursor * 4;
    output.basePositions.set([splat.center.x, splat.center.y, splat.center.z], i3);
    output.baseRotations.set([splat.quaternion.x, splat.quaternion.y, splat.quaternion.z, splat.quaternion.w], i4);
    output.baseScales.set([splat.scales.x, splat.scales.y, splat.scales.z], i3);
    output.opacities[cursor] = splat.opacity;
    output.colors.set([splat.color.r, splat.color.g, splat.color.b], i3);
  }
  return output;
}

function chooseUpdateInterval(activeSplatCount: number) {
  if (activeSplatCount <= 24_000) return 1 / MAX_UPDATE_HZ;
  if (activeSplatCount <= 64_000) return 1 / 21;
  return 1 / MIN_UPDATE_HZ;
}

export async function installCpuSplatPartMotion({
  mesh,
  rig,
  rigUrl,
  signal
}: {
  mesh: SparkSplatMesh;
  rig: CpuSplatPartRig;
  rigUrl: string;
  signal: AbortSignal;
}): Promise<CpuSplatPartMotionRuntime> {
  if (mesh.numSplats !== rig.sourceGaussianCount) {
    throw new Error(`Splat bone-map model mismatch: model has ${mesh.numSplats}, map has ${rig.sourceGaussianCount}.`);
  }
  if (mesh.skinning) {
    mesh.skinning = null;
    mesh.updateGenerator();
  }

  const response = await fetch(resolveRigAssetUrl(rigUrl, rig.weightsUrl), {
    signal,
    cache: 'force-cache'
  });
  if (!response.ok) throw new Error(`Splat bone-map request failed with ${response.status}.`);
  const packed = readPackedWeights(
    await response.arrayBuffer(),
    rig.sourceGaussianCount * INFLUENCE_SLOTS
  );
  const bones = createRuntimeBones(rig.bones);
  const splats = captureDynamicSplats(mesh, bones, packed);
  if (!splats.indices.length) throw new Error('Splat bone-map contains no movable Gaussians.');
  const updateInterval = chooseUpdateInterval(splats.indices.length);

  return {
    mesh,
    bones,
    splats,
    lastUpdateTime: Number.NEGATIVE_INFINITY,
    updateOffset: (Math.abs(rig.revision) % 997) / 997 * updateInterval,
    updateInterval
  };
}

function locomotionMultiplier(kind: CpuSplatPartKind, locomotion: string) {
  if (locomotion === 'swimming') return kind === 'fin' || kind === 'tail' ? 0.78 : 0;
  if (locomotion === 'flying') {
    if (kind === 'wing') return 0.82;
    if (kind === 'tail') return 0.16;
    if (kind === 'head' || kind === 'ear') return 0.12;
    return 0;
  }
  if (locomotion === 'walking' || locomotion === 'running' || locomotion === 'hopping') {
    if (kind === 'arm' || kind === 'leg') return 0.78;
    if (kind === 'tail') return 0.2;
    if (kind === 'head' || kind === 'ear') return 0.16;
    return 0;
  }
  if (kind === 'head') return 0.16;
  if (kind === 'ear') return 0.2;
  return kind === 'arm' || kind === 'tail' ? 0.42 : 0.26;
}

function naturalMotionWave(kind: CpuSplatPartKind, phase: number) {
  const primary = Math.sin(phase);
  if (kind === 'wing') return primary * 0.84 + Math.sin(phase * 2 - 0.45) * 0.16;
  if (kind === 'tail' || kind === 'fin') return primary * 0.88 + Math.sin(phase * 2 + 0.65) * 0.12;
  if (kind === 'arm') return primary * 0.9 + Math.sin(phase * 2 + 0.8) * 0.1;
  if (kind === 'leg') return primary * 0.94 + Math.sin(phase * 2 - 0.35) * 0.06;
  if (kind === 'head') return primary * 0.76 + Math.sin(phase * 0.5 + 0.6) * 0.24;
  if (kind === 'ear') return primary * 0.7 + Math.sin(phase * 1.7 - 0.4) * 0.3;
  return primary;
}

function partSide(side: CpuSplatPartDefinition['side']) {
  if (side === 'left') return -1;
  if (side === 'right') return 1;
  return 0;
}

function interactionTargetAngle(
  definition: CpuSplatPartDefinition,
  action: CreaturePartActionPose | undefined
) {
  if (!action || action.kind === 'idle') return 0;
  const side = partSide(definition.side);
  const authoredDirection = Math.sign(definition.animation.amplitude) || 1;

  if (action.kind === 'fight') {
    if (definition.kind === 'arm' || definition.kind === 'wing' || definition.kind === 'fin') {
      const strikeMatch = side === 0 || side === action.punchSide;
      const punch = authoredDirection * action.punch * (strikeMatch ? 0.78 : -0.22);
      const windup = -authoredDirection * action.windup * (strikeMatch ? 0.34 : 0.1);
      const guard = -authoredDirection * side * action.targetSide * action.guard * 0.48;
      const grapple = authoredDirection * action.bite * (side === action.targetSide ? 0.42 : -0.14);
      const recoil = -authoredDirection * action.hit * (0.3 + Math.abs(side) * 0.1);
      return punch + windup + guard + grapple + recoil;
    }
    if (definition.kind === 'head') {
      return action.targetSide * (-action.bite * 0.4 + action.hit * 0.29)
        - action.targetSide * action.windup * 0.1
        + Math.sin(action.phase * 0.5) * action.struggle * 0.035;
    }
    if (definition.kind === 'ear') {
      return -side * action.targetSide * (action.bite * 0.24 + action.hit * 0.38)
        + Math.sin(action.phase + side * 1.2) * action.struggle * 0.045;
    }
    if (definition.kind === 'leg') {
      const kickMatch = side === 0 || side === action.kickSide;
      const kick = authoredDirection * action.kick * (kickMatch ? 0.62 : -0.18);
      const brace = authoredDirection * side * action.targetSide
        * (-0.24 * Math.max(action.punch, action.bite) + 0.14 * action.hit);
      return kick + brace + authoredDirection * action.curl * 0.12;
    }
    if (definition.kind === 'tail') {
      return Math.sin(action.phase * 0.72 + side) * 0.26 * action.struggle
        - action.targetSide * action.hit * 0.32
        + action.targetSide * action.kick * 0.18;
    }
  }

  if (action.kind === 'trapped') {
    const alternatingWave = Math.sin(action.phase + side * 1.45);
    const slowerWave = Math.sin(action.phase * 0.53 + side * 0.8);
    if (definition.kind === 'arm') {
      return authoredDirection * (
        alternatingWave * 0.68 * action.struggle
        - side * (0.22 * action.compression + 0.18 * action.curl)
      );
    }
    if (definition.kind === 'leg') {
      return authoredDirection * (
        -alternatingWave * 0.5 * action.struggle
        + side * (0.14 * action.compression - 0.12 * action.curl)
      );
    }
    if (definition.kind === 'wing' || definition.kind === 'fin') {
      return authoredDirection * alternatingWave * 0.74 * action.struggle;
    }
    if (definition.kind === 'head') {
      return slowerWave * 0.38 * action.struggle + action.curl * 0.1;
    }
    if (definition.kind === 'ear') {
      return -side * slowerWave * 0.43 * action.struggle;
    }
    if (definition.kind === 'tail') {
      return Math.sin(action.phase * 0.78 + side) * 0.7 * action.struggle;
    }
  }

  if (action.kind === 'victory') {
    if (definition.kind === 'arm' || definition.kind === 'wing' || definition.kind === 'fin') {
      return authoredDirection * (0.38 + Math.sin(action.phase + side) * 0.12) * action.struggle;
    }
    if (definition.kind === 'head' || definition.kind === 'ear' || definition.kind === 'tail') {
      return Math.sin(action.phase * 0.72 + side) * 0.18 * action.struggle;
    }
  }

  if (action.kind === 'impact') {
    if (definition.kind === 'head') return 0.24 * action.hit;
    if (definition.kind === 'arm' || definition.kind === 'wing' || definition.kind === 'fin') {
      return -authoredDirection * (0.26 + side * 0.06) * action.hit;
    }
    if (definition.kind === 'leg' || definition.kind === 'tail' || definition.kind === 'ear') {
      return Math.sin(action.phase + side) * 0.2 * action.hit;
    }
  }

  return 0;
}

function integrateJointRotation(
  bone: RuntimeBone,
  targetAngle: number,
  deltaTime: number,
  actionActive: boolean
) {
  const kind = bone.definition.kind;
  const inertia = JOINT_INERTIA[kind];
  const stiffness = actionActive ? ACTION_STIFFNESS[kind] : NATURAL_STIFFNESS[kind];
  if (stiffness <= 0) {
    bone.angle = 0;
    bone.angularVelocity = 0;
    return;
  }
  integrateDampedAngle(
    bone,
    targetAngle,
    deltaTime,
    inertia,
    stiffness,
    JOINT_DAMPING_RATIO[kind],
    MAX_ANGULAR_SPEED[kind],
    MAX_ANGULAR_ACCELERATION[kind],
    ACTION_MAX_ANGLES[kind]
  );
}

function updateBoneTransforms(
  runtime: CpuSplatPartMotionRuntime,
  time: number,
  deltaTime: number,
  energy: number,
  locomotion: string,
  action: CreaturePartActionPose | undefined
) {
  const actionEnergy = action
    ? Math.max(
        action.punch,
        action.kick,
        action.bite,
        action.hit,
        action.guard,
        action.windup,
        action.curl,
        action.struggle,
        action.compression
      )
    : 0;
  for (const bone of runtime.bones) {
    const { definition, pivot } = bone;
    const moving = MOVING_KINDS.has(definition.kind);
    const maximum = MAX_ANGLES[definition.kind];
    const requested = Math.abs(definition.animation.amplitude)
      * energy
      * locomotionMultiplier(definition.kind, locomotion);
    const amplitude = moving ? Math.min(requested, maximum) : 0;
    const phase = time * definition.animation.frequency + definition.animation.phase;
    const naturalAngle = naturalMotionWave(definition.kind, phase) * amplitude;
    const actionAngle = interactionTargetAngle(definition, action);
    const targetAngle = THREE.MathUtils.clamp(
      naturalAngle + actionAngle,
      -ACTION_MAX_ANGLES[definition.kind],
      ACTION_MAX_ANGLES[definition.kind]
    );
    integrateJointRotation(bone, targetAngle, deltaTime, actionEnergy > 0.01);
    bone.localRotation.setFromAxisAngle(bone.axis, bone.angle);

    TEMP_TRANSLATE_TO_PIVOT.makeTranslation(pivot.x, pivot.y, pivot.z);
    TEMP_ROTATION_MATRIX.makeRotationFromQuaternion(bone.localRotation);
    TEMP_TRANSLATE_FROM_PIVOT.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    TEMP_LOCAL_MATRIX.copy(TEMP_TRANSLATE_TO_PIVOT)
      .multiply(TEMP_ROTATION_MATRIX)
      .multiply(TEMP_TRANSLATE_FROM_PIVOT);

    const parent = definition.parentIndex >= 0 ? runtime.bones[definition.parentIndex] : undefined;
    if (parent && MOVING_KINDS.has(parent.definition.kind)) {
      bone.deformMatrix.multiplyMatrices(parent.deformMatrix, TEMP_LOCAL_MATRIX);
      bone.deformRotation.multiplyQuaternions(parent.deformRotation, bone.localRotation).normalize();
    } else {
      bone.deformMatrix.copy(TEMP_LOCAL_MATRIX);
      bone.deformRotation.copy(bone.localRotation);
    }
  }
}

function writeDynamicSplats(runtime: CpuSplatPartMotionRuntime) {
  const { mesh, bones, splats } = runtime;
  for (let cursor = 0; cursor < splats.indices.length; cursor += 1) {
    const i3 = cursor * 3;
    const i4 = cursor * 4;
    const baseX = splats.basePositions[i3];
    const baseY = splats.basePositions[i3 + 1];
    const baseZ = splats.basePositions[i3 + 2];
    let movingWeight = 0;
    let movingBone: RuntimeBone | undefined;

    for (let slot = 0; slot < INFLUENCE_SLOTS; slot += 1) {
      const influence = i4 + slot;
      const weight = splats.boneWeights[influence];
      if (weight <= 0) continue;
      const bone = bones[splats.boneIndices[influence]];
      const moving = Boolean(bone && MOVING_KINDS.has(bone.definition.kind));
      if (moving && weight > movingWeight) {
        movingWeight = weight;
        movingBone = bone;
      }
    }

    TEMP_CENTER.set(baseX, baseY, baseZ);
    TEMP_BLEND_ROTATION.copy(IDENTITY_QUATERNION);
    if (movingBone && movingWeight > 0) {
      // Use the complete hierarchical joint matrix. The previous code composed
      // parent and child rotations, then rotated around only the child's pivot;
      // chained tails/fins therefore orbited around the wrong point and looked
      // disassembled. Exclusive ownership makes this a rigid part transform.
      TEMP_BLEND_ROTATION.copy(movingBone.deformRotation);
      TEMP_CENTER.applyMatrix4(movingBone.deformMatrix);
    }
    TEMP_BASE_ROTATION.set(
      splats.baseRotations[i4],
      splats.baseRotations[i4 + 1],
      splats.baseRotations[i4 + 2],
      splats.baseRotations[i4 + 3]
    );
    TEMP_OUTPUT_ROTATION.copy(TEMP_BLEND_ROTATION).multiply(TEMP_BASE_ROTATION).normalize();
    TEMP_SCALE.fromArray(splats.baseScales, i3);
    TEMP_COLOR.fromArray(splats.colors, i3);
    mesh.packedSplats.setSplat(
      splats.indices[cursor],
      TEMP_CENTER,
      TEMP_SCALE,
      TEMP_OUTPUT_ROTATION,
      splats.opacities[cursor],
      TEMP_COLOR
    );
  }
}

export function updateCpuSplatPartMotion(
  runtime: CpuSplatPartMotionRuntime,
  time: number,
  motionEnergy: number,
  locomotion: string,
  action?: CreaturePartActionPose
) {
  if (!Number.isFinite(runtime.lastUpdateTime)) {
    runtime.lastUpdateTime = time - runtime.updateOffset;
  }
  if (time - runtime.lastUpdateTime < runtime.updateInterval) return;
  const deltaTime = THREE.MathUtils.clamp(time - runtime.lastUpdateTime, runtime.updateInterval, 0.12);
  runtime.lastUpdateTime = time;
  updateBoneTransforms(
    runtime,
    time,
    deltaTime,
    THREE.MathUtils.clamp(motionEnergy, 0, 0.62),
    locomotion,
    action
  );
  writeDynamicSplats(runtime);
  runtime.mesh.packedSplats.needsUpdate = true;
}

export function disposeCpuSplatPartMotion(runtime: CpuSplatPartMotionRuntime | null) {
  if (!runtime) return;
  for (const bone of runtime.bones) {
    bone.localRotation.identity();
    bone.deformRotation.identity();
    bone.deformMatrix.identity();
    bone.angle = 0;
    bone.angularVelocity = 0;
  }
  writeDynamicSplats(runtime);
  runtime.mesh.packedSplats.needsUpdate = true;
}
