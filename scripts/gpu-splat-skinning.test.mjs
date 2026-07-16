import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import * as THREE from 'three';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'splat-skinning-test-'));
const compiledModule = path.join(temporaryDirectory, 'GpuSplatSkinning.mjs');

await build({
  entryPoints: ['src/components/webgl/GpuSplatSkinning.ts'],
  outfile: compiledModule,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent'
});

const { writeRigidDualQuaternion } = await import(pathToFileURL(compiledModule).href);

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function decodeTranslation(real, dual) {
  return new THREE.Vector3(
    2 * (-dual.w * real.x + dual.x * real.w - dual.y * real.z + dual.z * real.y),
    2 * (-dual.w * real.y + dual.x * real.z + dual.y * real.w - dual.z * real.x),
    2 * (-dual.w * real.z - dual.x * real.y + dual.y * real.x + dual.z * real.w)
  );
}

function readDualQuaternion(rotation, translation) {
  const skinning = { boneData: new Float32Array(16) };
  writeRigidDualQuaternion(skinning, 0, rotation, translation);
  return {
    real: new THREE.Quaternion(...skinning.boneData.slice(8, 12)),
    dual: new THREE.Quaternion(...skinning.boneData.slice(12, 16))
  };
}

function expectVectorClose(actual, expected, tolerance = 1e-6) {
  assert.ok(actual.distanceTo(expected) <= tolerance, `${actual.toArray()} != ${expected.toArray()}`);
}

test('encodes the rigid transform expected by the Spark shader', () => {
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0.3, -0.7, 0.4).normalize(),
    0.72
  );
  const translation = new THREE.Vector3(0.21, -0.13, 0.08);
  const { real, dual } = readDualQuaternion(rotation, translation);

  assert.ok(Math.abs(real.length() - 1) < 1e-6);
  assert.ok(Math.abs(real.dot(dual)) < 1e-6);
  expectVectorClose(decodeTranslation(real, dual), translation);

  const point = new THREE.Vector3(0.42, -0.18, 0.09);
  const expected = point.clone().applyQuaternion(rotation).add(translation);
  const decoded = point.clone().applyQuaternion(real).add(decodeTranslation(real, dual));
  expectVectorClose(decoded, expected);
});

test('keeps a rotating joint pivot fixed', () => {
  const pivot = new THREE.Vector3(0.34, -0.22, 0.17);
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    0.72
  );
  const translation = pivot.clone().sub(pivot.clone().applyQuaternion(rotation));
  const { real, dual } = readDualQuaternion(rotation, translation);
  const decodedTranslation = decodeTranslation(real, dual);

  expectVectorClose(pivot.clone().applyQuaternion(real).add(decodedTranslation), pivot);
  const offset = new THREE.Vector3(0.11, -0.06, 0.02);
  const expected = pivot.clone().add(offset.clone().applyQuaternion(rotation));
  const decoded = pivot.clone().add(offset).applyQuaternion(real).add(decodedTranslation);
  expectVectorClose(decoded, expected);
});

test('uses an exact identity dual quaternion for the rest pose', () => {
  const { real, dual } = readDualQuaternion(
    new THREE.Quaternion(),
    new THREE.Vector3()
  );

  assert.deepEqual(real.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(dual.toArray(), [0, 0, 0, 0]);
});
