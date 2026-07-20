import type { StoredArtwork } from '../../stores/artworkStore';
import type { CreatureBubbleScreenAnchor } from './creatureActivity';
import { SpaceCreature } from './SpaceCreature';

type ArtworkEntityProps = {
  artwork: StoredArtwork;
  index: number;
  active: boolean;
  bubbleIndex: number;
  bubbleCount: number;
  crowdScale: number;
  ambientMotionEnabled: boolean;
  restAnchor?: CreatureBubbleScreenAnchor;
  onRestAnchorCapture?: (id: string, anchor: CreatureBubbleScreenAnchor) => void;
  showEntryTrail?: boolean;
};

export function ArtworkEntity({
  artwork,
  index,
  active,
  bubbleIndex,
  bubbleCount,
  crowdScale,
  ambientMotionEnabled,
  restAnchor,
  onRestAnchorCapture,
  showEntryTrail = false
}: ArtworkEntityProps) {
  return (
    <SpaceCreature
      artwork={artwork}
      index={index}
      active={active}
      bubbleIndex={bubbleIndex}
      bubbleCount={bubbleCount}
      crowdScale={crowdScale}
      ambientMotionEnabled={ambientMotionEnabled}
      restAnchor={restAnchor}
      onRestAnchorCapture={onRestAnchorCapture}
      showEntryTrail={showEntryTrail}
    />
  );
}
