import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/lib/artwork/mobileGenerationHistory.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const history = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function createLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

test('anonymous guest restore stores only the completed artwork ID', () => {
  const localStorage = createLocalStorage();
  globalThis.window = { localStorage };
  const artwork = {
    id: 'local-artwork-id',
    name: '不应写入游客恢复记录',
    createdAt: 123,
    gaussianModel: { sourceArtworkId: 'backend-artwork-id' }
  };

  assert.equal(history.rememberAnonymousLastArtwork(artwork), 'backend-artwork-id');
  assert.equal(history.readAnonymousLastArtworkId(), 'backend-artwork-id');
  assert.deepEqual(
    JSON.parse(localStorage.values.get('ai-sketch-cosmos:anonymous-last-artwork')),
    { version: 1, artworkId: 'backend-artwork-id' }
  );

  history.clearAnonymousLastArtwork();
  assert.equal(history.readAnonymousLastArtworkId(), null);
  delete globalThis.window;
});
