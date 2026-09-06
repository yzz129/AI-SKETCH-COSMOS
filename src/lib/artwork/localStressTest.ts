import { useArtworkStore, type StoredArtwork } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';

export const LOCAL_STRESS_ARTWORK_PREFIX = 'local-stress:';
export const MAX_LOCAL_STRESS_TOTAL = 4_000;

export function isLocalStressArtwork(artwork: Pick<StoredArtwork, 'id'>) {
  return artwork.id.startsWith(LOCAL_STRESS_ARTWORK_PREFIX);
}

function createLocalStressArtwork(source: StoredArtwork, index: number, createdAt: number): StoredArtwork {
  const id = `${LOCAL_STRESS_ARTWORK_PREFIX}${index + 1}`;
  return {
    ...source,
    id,
    name: `压力测试 ${index + 1} · ${source.name}`,
    createdAt,
    model3d: source.model3d
      ? { ...source.model3d, taskId: id, createdAt }
      : undefined,
    gaussianModel: source.gaussianModel
      ? {
          ...source.gaussianModel,
          jobId: id,
          sourceArtworkId: undefined,
          createdAt,
          message: 'local stress-test clone'
        }
      : undefined
  };
}

export function runLocalArtworkStressTest(requestedTarget: number) {
  const sourceArtworks = useArtworkStore.getState().artworks.filter(
    (artwork) => !isLocalStressArtwork(artwork)
  );
  if (sourceArtworks.length === 0) {
    useSketchStore.getState().setError('大屏模型库为空，请先上传或同步至少一个模型。');
    return 0;
  }

  const safeTarget = Math.max(
    sourceArtworks.length,
    Math.min(
      MAX_LOCAL_STRESS_TOTAL,
      Number.isFinite(requestedTarget) ? Math.max(1, Math.round(requestedTarget)) : sourceArtworks.length
    )
  );
  const stressCount = safeTarget - sourceArtworks.length;
  const createdAt = Date.now();
  const stressArtworks = Array.from({ length: stressCount }, (_, index) => (
    createLocalStressArtwork(sourceArtworks[index % sourceArtworks.length], index, createdAt + index)
  ));

  useArtworkStore.setState((state) => ({
    artworks: [...sourceArtworks, ...stressArtworks],
    latestArtwork: state.latestArtwork && !isLocalStressArtwork(state.latestArtwork)
      ? state.latestArtwork
      : sourceArtworks[0] ?? null
  }));
  useSketchStore.setState({
    status: 'idle',
    message: `压力测试已启动，共 ${safeTarget} 个模型。`
  });
  return safeTarget;
}

export function clearLocalArtworkStressTest() {
  const currentArtworks = useArtworkStore.getState().artworks;
  const removedArtworks = currentArtworks.filter(isLocalStressArtwork);
  const retainedArtworks = currentArtworks.filter((artwork) => !isLocalStressArtwork(artwork));
  for (const artwork of removedArtworks) {
    useSketchStore.getState().cancelSpotlight(artwork.id);
  }
  useArtworkStore.setState((state) => ({
    artworks: retainedArtworks,
    latestArtwork: state.latestArtwork && !isLocalStressArtwork(state.latestArtwork)
      ? state.latestArtwork
      : retainedArtworks[0] ?? null
  }));
  useSketchStore.setState({ status: 'idle', message: '压力测试模型已清除。' });
  return removedArtworks.length;
}
