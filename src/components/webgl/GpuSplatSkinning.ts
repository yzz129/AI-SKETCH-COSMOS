import type { SplatMesh as SparkSplatMesh, SplatSkinning as SparkSplatSkinning } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { resolveRigAssetUrl } from './rigAssetUrl';

export type GpuSplatBoneKind = 'body' | 'arm' | 'leg' | 'wing' | 'fin' | 'tail' | 'ear' | 'head';

export type GpuSplatBone = {
  index: number;
  id: string;
  parentIndex: number;
  kind: GpuSplatBoneKind;
  side: 'left' | 'right' | 'center';
  pivot: [number, number, number];
  animation: {
    axis: [number, number, number];
    amplitude: number;
    frequency: number;
    phase: number;
  };
};

export type GpuSplatSkinningRig = {
  version: number;
  revision: number;
  enabled: boolean;
  strategy: 'gpu-splat-skinning';
  skinningMethod: 'dual-quaternion';
  segmentationMethod: 'distal-depth-track-v1';
  sourceGaussianCount: number;
  weightsUrl: string;
  weightsFormat: 'spark-rgba16ui-little-endian';
  weightsByteLength: number;
  maxInfluences: 4;
  bones: GpuSplatBone[];
};

type RuntimeBone = {
  definition: GpuSplatBone;
  parent: RuntimeBone | null;
  restLocalPosition: THREE.Vector3;
  restGlobal: THREE.Matrix4;
  inverseRestGlobal: THREE.Matrix4;
  currentLocal: THREE.Matrix4;
  currentGlobal: THREE.Matrix4;
  deform: THREE.Matrix4;
  axis: THREE.Vector3;
  rotation: THREE.Quaternion;
  deformRotation: THREE.Quaternion;
  deformTranslation: THREE.Vector3;
  deformScale: THREE.Vector3;
};

export type GpuSplatSkinningRuntime = {
  mesh: SparkSplatMesh;
  skinning: SparkSplatSkinning;
  bones: RuntimeBone[];
};

const IDENTITY_QUATERNION = new THREE.Quaternion();
const ZERO_POSITION = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const MAX_ARTICULATION_ANGLE = 0.72;
const REAL_QUATERNION = new THREE.Quaternion();
const TRANSLATION_QUATERNION = new THREE.Quaternion();
const DUAL_QUATERNION = new THREE.Quaternion();

function isFiniteQuaternion(value: THREE.Quaternion) {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z)
    && Number.isFinite(value.w);
}

function isFiniteVector(value: THREE.Vector3) {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

/**
 * Upload an already-composed rigid deformation to Spark.
 *
 * Spark's shader decodes translation as `2 * dual * conjugate(real)`, so the
 * dual component must be `0.5 * translation * rotation`. Calling
 * `setBoneQuatPos()` with an identity rest pose stores only
 * `0.5 * translation`; that is not the same transform once the bone rotates
 * and causes child joints to drift and tear away from the body.
 */
// This direct buffer layout belongs to Spark 0.1.10. package.json pins that
// exact version so an internal layout change cannot silently corrupt a rig.
export function writeRigidDualQuaternion(
  skinning: SparkSplatSkinning,
  boneIndex: number,
  rotation: THREE.Quaternion,
  translation: THREE.Vector3
) {
  const offset = boneIndex * 16;
  if (!isFiniteQuaternion(rotation)
    || rotation.lengthSq() < 1e-12
    || !isFiniteVector(translation)) {
    skinning.boneData[offset + 8] = 0;
    skinning.boneData[offset + 9] = 0;
    skinning.boneData[offset + 10] = 0;
    skinning.boneData[offset + 11] = 1;
    skinning.boneData[offset + 12] = 0;
    skinning.boneData[offset + 13] = 0;
    skinning.boneData[offset + 14] = 0;
    skinning.boneData[offset + 15] = 0;
    return;
  }

  REAL_QUATERNION.copy(rotation).normalize();
  TRANSLATION_QUATERNION.set(translation.x, translation.y, translation.z, 0);
  DUAL_QUATERNION.copy(TRANSLATION_QUATERNION).multiply(REAL_QUATERNION);

  skinning.boneData[offset + 8] = REAL_QUATERNION.x;
  skinning.boneData[offset + 9] = REAL_QUATERNION.y;
  skinning.boneData[offset + 10] = REAL_QUATERNION.z;
  skinning.boneData[offset + 11] = REAL_QUATERNION.w;
  skinning.boneData[offset + 12] = DUAL_QUATERNION.x * 0.5;
  skinning.boneData[offset + 13] = DUAL_QUATERNION.y * 0.5;
  skinning.boneData[offset + 14] = DUAL_QUATERNION.z * 0.5;
  skinning.boneData[offset + 15] = DUAL_QUATERNION.w * 0.5;
}

export function isGpuSplatSkinningRig(value: unknown): value is GpuSplatSkinningRig {
  if (!value || typeof value !== 'object') return false;
  const rig = value as Partial<GpuSplatSkinningRig>;
  return rig.enabled === true
    && Number.isInteger(rig.version)
    && Number(rig.version) >= 7
    && rig.strategy === 'gpu-splat-skinning'
    && rig.skinningMethod === 'dual-quaternion'
    && rig.segmentationMethod === 'distal-depth-track-v1'
    && rig.weightsFormat === 'spark-rgba16ui-little-endian'
    && Number.isInteger(rig.sourceGaussianCount)
    && typeof rig.weightsUrl === 'string'
    && Array.isArray(rig.bones)
    && rig.bones.length > 1;
}

function readLittleEndianWeights(buffer: ArrayBuffer, expectedValues: number) {
  if (buffer.byteLength !== expectedValues * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error(`Splat skinning weight length mismatch: expected ${expectedValues * 2}, got ${buffer.byteLength}.`);
  }
  const values = new Uint16Array(expectedValues);
  const view = new DataView(buffer);
  for (let index = 0; index < expectedValues; index += 1) {
    values[index] = view.getUint16(index * 2, true);
  }
  return values;
}

function createRuntimeBones(definitions: GpuSplatBone[]) {
  const ordered = [...definitions].sort((left, right) => left.index - right.index);
  if (ordered.some((bone, index) => bone.index !== index)) {
    throw new Error('Splat skinning bones must use contiguous indices.');
  }
  const runtime: RuntimeBone[] = [];
  for (const definition of ordered) {
    const parent = definition.parentIndex >= 0 ? runtime[definition.parentIndex] : null;
    if (definition.parentIndex >= 0 && !parent) {
      throw new Error(`Missing parent bone ${definition.parentIndex} for ${definition.id}.`);
    }
    const pivot = new THREE.Vector3(...definition.pivot);
    const parentPivot = parent ? new THREE.Vector3(...parent.definition.pivot) : ZERO_POSITION;
    const restLocalPosition = pivot.clone().sub(parentPivot);
    const restLocal = new THREE.Matrix4().compose(restLocalPosition, IDENTITY_QUATERNION, UNIT_SCALE);
    const restGlobal = parent
      ? new THREE.Matrix4().multiplyMatrices(parent.restGlobal, restLocal)
      : restLocal.clone();
    runtime.push({
      definition,
      parent,
      restLocalPosition,
      restGlobal,
      inverseRestGlobal: restGlobal.clone().invert(),
      currentLocal: new THREE.Matrix4(),
      currentGlobal: new THREE.Matrix4(),
      deform: new THREE.Matrix4(),
      axis: new THREE.Vector3(...definition.animation.axis).normalize(),
      rotation: new THREE.Quaternion(),
      deformRotation: new THREE.Quaternion(),
      deformTranslation: new THREE.Vector3(),
      deformScale: new THREE.Vector3(1, 1, 1)
    });
  }
  return runtime;
}

export async function installGpuSplatSkinning({
  mesh,
  rig,
  rigUrl,
  signal
}: {
  mesh: SparkSplatMesh;
  rig: GpuSplatSkinningRig;
  rigUrl: string;
  signal: AbortSignal;
}): Promise<GpuSplatSkinningRuntime> {
  if (mesh.numSplats !== rig.sourceGaussianCount) {
    throw new Error(`Splat skinning model mismatch: model has ${mesh.numSplats}, rig has ${rig.sourceGaussianCount}.`);
  }
  const [{ SplatSkinning }, response] = await Promise.all([
    import('@sparkjsdev/spark'),
    fetch(resolveRigAssetUrl(rigUrl, rig.weightsUrl), { signal, cache: 'force-cache' })
  ]);
  if (!response.ok) {
    throw new Error(`Splat skinning weights request failed with ${response.status}.`);
  }
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const expectedValues = rig.sourceGaussianCount * 4;
  const weights = readLittleEndianWeights(buffer, expectedValues);
  const skinning = new SplatSkinning({
    mesh,
    numSplats: rig.sourceGaussianCount,
    numBones: rig.bones.length
  });
  skinning.skinData.set(weights, 0);
  skinning.skinTexture.needsUpdate = true;
  for (let index = 0; index < rig.bones.length; index += 1) {
    skinning.setRestQuatPos(index, IDENTITY_QUATERNION, ZERO_POSITION);
    writeRigidDualQuaternion(skinning, index, IDENTITY_QUATERNION, ZERO_POSITION);
  }
  mesh.skinning = skinning;
  mesh.updateGenerator();
  skinning.updateBones();
  return {
    mesh,
    skinning,
    bones: createRuntimeBones(rig.bones)
  };
}

function locomotionEnergy(kind: GpuSplatBoneKind, locomotion: string) {
  if (kind === 'wing') return locomotion === 'flying' ? 1.0 : 0.68;
  if (kind === 'fin' || kind === 'tail') return locomotion === 'swimming' ? 1.0 : 0.78;
  if (kind === 'leg') return ['walking', 'running', 'hopping'].includes(locomotion) ? 1.0 : 0.62;
  return 1.0;
}

export function updateGpuSplatSkinning(
  runtime: GpuSplatSkinningRuntime,
  time: number,
  energy: number,
  locomotion: string
) {
  const bones = runtime.bones;
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    const animation = bone.definition.animation;
    const kindEnergy = locomotionEnergy(bone.definition.kind, locomotion);
    const angle = bone.definition.kind === 'body'
      ? 0
      : THREE.MathUtils.clamp(
          Math.sin(time * animation.frequency + animation.phase) * animation.amplitude * energy * kindEnergy,
          -MAX_ARTICULATION_ANGLE,
          MAX_ARTICULATION_ANGLE
        );
    bone.rotation.setFromAxisAngle(bone.axis, angle);
    bone.currentLocal.compose(bone.restLocalPosition, bone.rotation, UNIT_SCALE);
    if (bone.parent) {
      bone.currentGlobal.multiplyMatrices(bone.parent.currentGlobal, bone.currentLocal);
    } else {
      bone.currentGlobal.copy(bone.currentLocal);
    }
    bone.deform.multiplyMatrices(bone.currentGlobal, bone.inverseRestGlobal);
    bone.deform.decompose(bone.deformTranslation, bone.deformRotation, bone.deformScale);
    writeRigidDualQuaternion(
      runtime.skinning,
      index,
      bone.deformRotation,
      bone.deformTranslation
    );
  }
  runtime.skinning.updateBones();
}

export function disposeGpuSplatSkinning(runtime: GpuSplatSkinningRuntime | null) {
  if (!runtime) return;
  if (runtime.mesh.skinning === runtime.skinning) {
    runtime.mesh.skinning = null;
    runtime.mesh.updateGenerator();
  }
  runtime.skinning.skinTexture.dispose();
  runtime.skinning.boneTexture.dispose();
}
