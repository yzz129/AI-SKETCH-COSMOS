import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/webgl/displayModelPolicy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const policy = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('fixed awards and the unified dynamic queue share a strict 40-model budget', () => {
  assert.equal(policy.MAX_ACTIVE_DISPLAY_MODELS, 40);
  assert.equal(policy.FIXED_AWARD_MODEL_COUNT, 23);
  assert.equal(policy.MAX_VARIABLE_DISPLAY_MODELS, 17);
  assert.equal(policy.MAX_ACTIVE_DESIGNER_MODELS, 17);
  assert.equal(policy.MAX_ACTIVE_SUBMIT_MODELS, 17);

  assert.equal(23 + policy.MAX_VARIABLE_DISPLAY_MODELS, 40);
});

test('splat and GLB records merge into one chronological queue', () => {
  const queue = policy.mergeDynamicDisplayQueues(
    [
      { key: 'submit:oldest', kind: 'submit', createdAt: 100 },
      { key: 'submit:newer', kind: 'submit', createdAt: 400 }
    ],
    [
      { key: 'designer:middle', kind: 'designer', createdAt: 200 },
      { key: 'designer:newest', kind: 'designer', createdAt: 500 }
    ]
  );
  assert.deepEqual(queue.map((entry) => entry.key), [
    'submit:oldest',
    'designer:middle',
    'submit:newer',
    'designer:newest'
  ]);
});

test('memory pressure reduces model count without changing render quality', () => {
  assert.equal(policy.normalizeVariableModelLimit(Number.NaN), 17);
  assert.equal(policy.normalizeVariableModelLimit(80), 17);
  assert.equal(policy.normalizeVariableModelLimit(-3), 0);
  assert.equal(policy.reduceVariableModelLimit(17), 11);
  assert.equal(policy.reduceVariableModelLimit(11), 5);
  assert.equal(policy.reduceVariableModelLimit(3), 0);
});

test('the unified mixed-format queue persists and rotates through 17 live positions', () => {
  const models = Array.from({ length: 32 }, (_, index) => ({
    key: `${index % 2 ? 'designer' : 'submit'}:${index}`,
    createdAt: index
  }));
  const offset = policy.getNewestModelWindowOffset(models.length, policy.MAX_VARIABLE_DISPLAY_MODELS);
  assert.equal(offset, 15);
  assert.deepEqual(policy.selectRotatingModels(models, 17, offset), models.slice(15));
  assert.deepEqual(
    policy.selectRotatingModels(models, 17, offset + 1),
    models.slice(16).concat(models[0])
  );
  assert.equal(policy.DYNAMIC_MODEL_ROTATION_MS, 30_000);
  assert.equal(policy.DYNAMIC_MODELS_REPLACED_PER_CYCLE, 1);
});

test('rotating selection visits models beyond the first visible window', () => {
  const models = Array.from({ length: 50 }, (_, index) => index);
  assert.deepEqual(policy.selectRotatingModels(models, 4, 0), [0, 1, 2, 3]);
  assert.deepEqual(policy.selectRotatingModels(models, 4, 48), [48, 49, 0, 1]);
});

test('a new model evicts the globally oldest active entry regardless of format', () => {
  const models = Array.from({ length: 17 }, (_, index) => ({
    key: `${index % 2 ? 'designer' : 'submit'}:${index}`,
    createdAt: index
  }));
  const newModel = { key: 'designer:new', createdAt: 99 };
  const merged = policy.mergeDynamicDisplayQueues(models, [newModel]);
  const offset = policy.getNewestModelWindowOffset(merged.length, 17);
  const visible = policy.selectRotatingModels(merged, 17, offset);

  assert.equal(offset, 1);
  assert.equal(visible.some((entry) => entry.key === models[0].key), false);
  assert.equal(visible.at(-1)?.key, newModel.key);
});

test('a newly generated or spotlighted model bypasses the ordinary admission queue', () => {
  assert.deepEqual(
    policy.prioritizeActiveModelIds(['old-1', 'old-2', 'new'], ['new', 'old-2']),
    ['new', 'old-2', 'old-1']
  );
});
