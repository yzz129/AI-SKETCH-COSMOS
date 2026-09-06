import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/components/webgl/modelPresentationVisibility.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const visibility = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('an unloaded async model keeps its model group and badge hidden', () => {
  assert.equal(visibility.resolveModelPresentationVisibility(true, 0), 0);
  assert.equal(visibility.isModelPresentationVisible(true, 0), false);
  assert.equal(visibility.isModelPresentationVisible(true, 0.001), false);
});

test('model and badge share the same reveal progress after loading', () => {
  assert.equal(visibility.resolveModelPresentationVisibility(true, 0.35), 0.35);
  assert.equal(visibility.isModelPresentationVisible(true, 0.35), true);
  assert.equal(visibility.resolveModelPresentationVisibility(true, 4), 1);
});

test('synchronous particle creatures remain immediately visible', () => {
  assert.equal(visibility.resolveModelPresentationVisibility(false, 0), 1);
  assert.equal(visibility.isModelPresentationVisible(false, 0), true);
});
