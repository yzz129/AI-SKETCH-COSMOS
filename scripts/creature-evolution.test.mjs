import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEvolutionExperience,
  baseStrengthForIndex,
  canDefeatEvolution,
  canDefeatLevel,
  compareEvolutionRank,
  combatPowerFor,
  degradeAfterDefeat,
  evolveAfterVictory,
  experienceProgress,
  experienceRequiredForLevel
} from '../src/components/webgl/creatureEvolutionMath.mjs';

test('all creatures start at level zero and strength follows artwork order', () => {
  assert.ok(baseStrengthForIndex(0) > baseStrengthForIndex(1));
  assert.ok(baseStrengthForIndex(1) > baseStrengthForIndex(8));
  assert.ok(combatPowerFor(0, 0) > combatPowerFor(1, 0));
});

test('dust experience fills the bar and can level up', () => {
  const record = { level: 0, experience: 0 };
  addEvolutionExperience(record, experienceRequiredForLevel(0) * 0.4);
  assert.equal(record.level, 0);
  assert.ok(Math.abs(experienceProgress(record) - 0.4) < 1e-9);
  addEvolutionExperience(record, experienceRequiredForLevel(0) * 0.6);
  assert.equal(record.level, 1);
  assert.equal(record.experience, 0);
});

test('victory raises level while defeat and planet penalties stop at zero', () => {
  const record = { level: 0, experience: 60 };
  evolveAfterVictory(record);
  assert.equal(record.level, 1);
  assert.equal(record.experience, 0);
  degradeAfterDefeat(record);
  degradeAfterDefeat(record);
  assert.equal(record.level, 0);
  assert.equal(record.experience, 0);
});

test('evolution increases combat power', () => {
  assert.ok(combatPowerFor(4, 3) > combatPowerFor(4, 2));
});

test('only a strictly higher-level creature can defeat another creature', () => {
  assert.equal(canDefeatLevel(1, 0), true);
  assert.equal(canDefeatLevel(3, 1), true);
  assert.equal(canDefeatLevel(0, 0), false);
  assert.equal(canDefeatLevel(2, 2), false);
  assert.equal(canDefeatLevel(0, 1), false);
});

test('experience bar progress breaks ties within the same level', () => {
  const fullerBar = { level: 2, experience: 72 };
  const lowerBar = { level: 2, experience: 31 };
  assert.ok(compareEvolutionRank(fullerBar, lowerBar) > 0);
  assert.equal(canDefeatEvolution(fullerBar, lowerBar), true);
  assert.equal(canDefeatEvolution(lowerBar, fullerBar), false);
  assert.equal(canDefeatEvolution({ level: 2, experience: 72 }, fullerBar), false);
  assert.equal(canDefeatEvolution({ level: 3, experience: 0 }, fullerBar), true);
});
