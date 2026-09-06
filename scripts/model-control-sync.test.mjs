import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/artwork/modelControlSync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const control = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('remote control releases exactly five seconds after the last active pose', () => {
  const pose = {
    yaw: 0,
    pitch: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    active: true,
    receivedAt: 10_000
  };

  assert.equal(control.REMOTE_MODEL_CONTROL_IDLE_MS, 5_000);
  assert.equal(control.isRemoteModelPoseActive(pose, 14_999), true);
  assert.equal(control.isRemoteModelPoseActive(pose, 15_000), false);
  assert.equal(control.isRemoteModelPoseActive({ ...pose, active: false }, 10_001), false);
});
