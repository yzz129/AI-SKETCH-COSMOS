export const MIN_CREATURE_LEVEL = 0;

export function experienceRequiredForLevel(level) {
  const safeLevel = Math.max(MIN_CREATURE_LEVEL, Math.floor(Number.isFinite(level) ? level : 0));
  return 100 + safeLevel * 42;
}

export function baseStrengthForIndex(index) {
  const safeIndex = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  return 1.72 / (1 + safeIndex * 0.085);
}

export function combatPowerFor(index, level) {
  const safeLevel = Math.max(MIN_CREATURE_LEVEL, Math.floor(Number.isFinite(level) ? level : 0));
  return baseStrengthForIndex(index) * (1 + safeLevel * 0.28 + safeLevel * safeLevel * 0.012);
}

export function canDefeatLevel(attackerLevel, defenderLevel) {
  const safeAttackerLevel = Math.max(
    MIN_CREATURE_LEVEL,
    Math.floor(Number.isFinite(attackerLevel) ? attackerLevel : MIN_CREATURE_LEVEL)
  );
  const safeDefenderLevel = Math.max(
    MIN_CREATURE_LEVEL,
    Math.floor(Number.isFinite(defenderLevel) ? defenderLevel : MIN_CREATURE_LEVEL)
  );
  return safeAttackerLevel > safeDefenderLevel;
}

export function compareEvolutionRank(first, second) {
  const firstLevel = Math.max(
    MIN_CREATURE_LEVEL,
    Math.floor(Number.isFinite(first?.level) ? first.level : MIN_CREATURE_LEVEL)
  );
  const secondLevel = Math.max(
    MIN_CREATURE_LEVEL,
    Math.floor(Number.isFinite(second?.level) ? second.level : MIN_CREATURE_LEVEL)
  );
  if (firstLevel !== secondLevel) return firstLevel - secondLevel;
  const firstExperience = Math.max(0, Number.isFinite(first?.experience) ? first.experience : 0);
  const secondExperience = Math.max(0, Number.isFinite(second?.experience) ? second.experience : 0);
  return firstExperience - secondExperience;
}

export function canDefeatEvolution(attacker, defender) {
  return compareEvolutionRank(attacker, defender) > 1e-6;
}

export function addEvolutionExperience(record, amount) {
  let remaining = Math.max(0, Number.isFinite(amount) ? amount : 0);
  let levelsGained = 0;
  while (remaining > 0) {
    const required = experienceRequiredForLevel(record.level);
    const accepted = Math.min(remaining, required - record.experience);
    record.experience += accepted;
    remaining -= accepted;
    if (record.experience + 1e-8 < required) break;
    record.level += 1;
    record.experience = 0;
    levelsGained += 1;
  }
  return levelsGained;
}

export function evolveAfterVictory(record) {
  record.level += 1;
  record.experience = 0;
  return record.level;
}

export function degradeAfterDefeat(record) {
  record.level = Math.max(MIN_CREATURE_LEVEL, record.level - 1);
  record.experience = 0;
  return record.level;
}

export function experienceProgress(record) {
  return Math.max(0, Math.min(1, record.experience / experienceRequiredForLevel(record.level)));
}
