import { create } from 'zustand';

type NebulaPulse = {
  id: number;
  glyph: number;
};

type CreaturePulse = {
  id: number;
  creatureId: string | null;
};

type PlanetPulse = {
  id: number;
  planetIndex: number;
};

type AutoCosmicInteractionState = {
  planetPulse: PlanetPulse;
  nebulaPulse: NebulaPulse;
  creaturePulse: CreaturePulse;
  triggerPlanetPulse: (planetIndex: number) => void;
  triggerNebulaPulse: (glyph: number) => void;
  triggerCreatureBurst: (creatureId: string) => void;
};

export const useAutoCosmicInteractionStore = create<AutoCosmicInteractionState>((set) => ({
  planetPulse: {
    id: 0,
    planetIndex: -1
  },
  nebulaPulse: {
    id: 0,
    glyph: 0
  },
  creaturePulse: {
    id: 0,
    creatureId: null
  },
  triggerPlanetPulse: (planetIndex) => set((state) => ({
    planetPulse: {
      id: state.planetPulse.id + 1,
      planetIndex
    }
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
