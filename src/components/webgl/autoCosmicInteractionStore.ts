import { create } from 'zustand';

type NebulaPulse = {
  id: number;
  glyph: number;
};

type CreaturePulse = {
  id: number;
  creatureId: string | null;
};

type AutoCosmicInteractionState = {
  planetPulseId: number;
  nebulaPulse: NebulaPulse;
  creaturePulse: CreaturePulse;
  triggerPlanetPulse: () => void;
  triggerNebulaPulse: (glyph: number) => void;
  triggerCreatureBurst: (creatureId: string) => void;
};

export const useAutoCosmicInteractionStore = create<AutoCosmicInteractionState>((set) => ({
  planetPulseId: 0,
  nebulaPulse: {
    id: 0,
    glyph: 0
  },
  creaturePulse: {
    id: 0,
    creatureId: null
  },
  triggerPlanetPulse: () => set((state) => ({
    planetPulseId: state.planetPulseId + 1
  })),
  triggerNebulaPulse: (glyph) => set((state) => ({
    nebulaPulse: {
      id: state.nebulaPulse.id + 1,
      glyph
    }
  })),
  triggerCreatureBurst: (creatureId) => set((state) => ({
    creaturePulse: {
      id: state.creaturePulse.id + 1,
      creatureId
    }
  }))
}));
