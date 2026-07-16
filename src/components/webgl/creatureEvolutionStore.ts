import { create, type StoreApi } from 'zustand';
import {
  addEvolutionExperience,
  combatPowerFor,
  degradeAfterDefeat,
  evolveAfterVictory,
  experienceProgress,
  experienceRequiredForLevel
} from './creatureEvolutionMath';

export type CreatureEvolutionRecord = {
  index: number;
  level: number;
  experience: number;
  victories: number;
  defeats: number;
  planetTraps: number;
  revision: number;
  changedAt: number;
};

export type PersistedCreatureEvolution = Pick<
  CreatureEvolutionRecord,
  'level' | 'experience' | 'victories' | 'defeats' | 'planetTraps' | 'revision'
>;

export type CreatureAiIntent = {
  mode: 'chase' | 'flee';
  targetId: string;
  strength: number;
  expiresAt: number;
};

type CreatureEvolutionState = {
  records: Record<string, CreatureEvolutionRecord>;
  intents: Record<string, CreatureAiIntent>;
  ensureCreature: (id: string, index: number) => CreatureEvolutionRecord;
  ensureCreatures: (creatures: ReadonlyArray<{ id: string; index: number }>) => void;
  hydrateCreatures: (creatures: ReadonlyArray<{
    id: string;
    index: number;
    evolution: PersistedCreatureEvolution;
  }>) => void;
  addDustExperience: (id: string, amount: number) => void;
  addDustExperienceBatch: (updates: ReadonlyArray<{ id: string; amount: number }>) => void;
  recordVictory: (id: string) => void;
  recordDefeat: (id: string) => void;
  recordPlanetTrap: (id: string) => void;
  setIntent: (id: string, intent: CreatureAiIntent) => void;
  replaceIntents: (intents: Record<string, CreatureAiIntent>) => void;
  clearIntent: (id: string) => void;
};

function nowSeconds() {
  return typeof performance === 'undefined' ? 0 : performance.now() * 0.001;
}

function createRecord(index: number): CreatureEvolutionRecord {
  return {
    index,
    level: 0,
    experience: 0,
    victories: 0,
    defeats: 0,
    planetTraps: 0,
    revision: 0,
    changedAt: nowSeconds()
  };
}

function updateRecord(
  id: string,
  mutate: (record: CreatureEvolutionRecord) => boolean,
  set: StoreApi<CreatureEvolutionState>['setState']
) {
  set((state) => {
    const current = state.records[id];
    if (!current) return state;
    const next = { ...current };
    if (!mutate(next)) return state;
    next.revision += 1;
    next.changedAt = nowSeconds();
    return { records: { ...state.records, [id]: next } };
  });
}

export const useCreatureEvolutionStore = create<CreatureEvolutionState>((set, get) => ({
  records: {},
  intents: {},
  ensureCreature: (id, index) => {
    const existing = get().records[id];
    if (existing) {
      if (existing.index !== index) existing.index = index;
      return existing;
    }
    const created = createRecord(index);
    set((state) => ({ records: { ...state.records, [id]: created } }));
    return created;
  },
  ensureCreatures: (creatures) => set((state) => {
    let records = state.records;
    for (const creature of creatures) {
      const existing = records[creature.id];
      if (existing && existing.index === creature.index) continue;
      if (records === state.records) records = { ...state.records };
      records[creature.id] = existing
        ? { ...existing, index: creature.index }
        : createRecord(creature.index);
    }
    return records === state.records ? state : { records };
  }),
  hydrateCreatures: (creatures) => set((state) => {
    let records = state.records;
    for (const creature of creatures) {
      const current = records[creature.id];
      if (current && current.revision > creature.evolution.revision) continue;
      const next: CreatureEvolutionRecord = {
        index: creature.index,
        level: Math.max(0, Math.floor(creature.evolution.level)),
        experience: Math.max(0, creature.evolution.experience),
        victories: Math.max(0, Math.floor(creature.evolution.victories)),
        defeats: Math.max(0, Math.floor(creature.evolution.defeats)),
        planetTraps: Math.max(0, Math.floor(creature.evolution.planetTraps)),
        revision: Math.max(0, Math.floor(creature.evolution.revision)),
        changedAt: nowSeconds()
      };
      if (
        current
        && current.index === next.index
        && current.level === next.level
        && current.experience === next.experience
        && current.victories === next.victories
        && current.defeats === next.defeats
        && current.planetTraps === next.planetTraps
        && current.revision === next.revision
      ) continue;
      if (records === state.records) records = { ...state.records };
      records[creature.id] = next;
    }
    return records === state.records ? state : { records };
  }),
  addDustExperience: (id, amount) => updateRecord(id, (record) => {
    if (!(amount > 0)) return false;
    addEvolutionExperience(record, amount);
    return true;
  }, set),
  addDustExperienceBatch: (updates) => set((state) => {
    let records = state.records;
    const changedAt = nowSeconds();
    for (const update of updates) {
      if (!(update.amount > 0)) continue;
      const current = records[update.id];
      if (!current) continue;
      const next = { ...current };
      addEvolutionExperience(next, update.amount);
      next.revision += 1;
      next.changedAt = changedAt;
      if (records === state.records) records = { ...state.records };
      records[update.id] = next;
    }
    return records === state.records ? state : { records };
  }),
  recordVictory: (id) => updateRecord(id, (record) => {
    evolveAfterVictory(record);
    record.victories += 1;
    return true;
  }, set),
  recordDefeat: (id) => updateRecord(id, (record) => {
    degradeAfterDefeat(record);
    record.defeats += 1;
    return true;
  }, set),
  recordPlanetTrap: (id) => updateRecord(id, (record) => {
    degradeAfterDefeat(record);
    record.defeats += 1;
    record.planetTraps += 1;
    return true;
  }, set),
  setIntent: (id, intent) => set((state) => ({
    intents: { ...state.intents, [id]: intent }
  })),
  replaceIntents: (intents) => set((state) => {
    const previousIds = Object.keys(state.intents);
    const nextIds = Object.keys(intents);
    if (
      previousIds.length === nextIds.length
      && nextIds.every((id) => state.intents[id] === intents[id])
    ) return state;
    return { intents };
  }),
  clearIntent: (id) => set((state) => {
    if (!state.intents[id]) return state;
    const intents = { ...state.intents };
    delete intents[id];
    return { intents };
  })
}));

export function getCreatureEvolution(id: string, index = 0) {
  return useCreatureEvolutionStore.getState().records[id]
    ?? useCreatureEvolutionStore.getState().ensureCreature(id, index);
}

export function getCreatureCombatPower(id: string, index = 0) {
  const record = getCreatureEvolution(id, index);
  return combatPowerFor(record.index, record.level);
}

export function getCreatureExperienceProgress(id: string, index = 0) {
  return experienceProgress(getCreatureEvolution(id, index));
}

export function getCreatureExperienceRequired(id: string, index = 0) {
  return experienceRequiredForLevel(getCreatureEvolution(id, index).level);
}
