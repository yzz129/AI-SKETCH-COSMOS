import { ChangeEvent, useRef, useState } from 'react';
import { Eye, EyeOff, Gauge } from 'lucide-react';
import { submitArtworkFile } from '../../lib/artwork/submitArtworkFile';
import { useArtworkStore, type StoredArtwork } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';

const LOCAL_STRESS_ARTWORK_PREFIX = 'local-stress:';
const MAX_LOCAL_STRESS_TOTAL = 1_000;

function isLocalStressArtwork(artwork: Pick<StoredArtwork, 'id'>) {
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

function renderModeLabel(hasSplat: boolean) {
  return hasSplat ? 'TripoSplat .splat' : '图片 3D 粒子化';
}

function formatCount(value: number | undefined) {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString();
}

function formatArtworkSize(artwork: StoredArtwork) {
  const aspect = Number.isFinite(artwork.aspect) ? artwork.aspect.toFixed(2) : '-';
  return `${Math.round(artwork.width)} × ${Math.round(artwork.height)} / 比例 ${aspect}`;
}

function formatStructure(artwork: StoredArtwork) {
  const { morphology } = artwork.features;
  const parts = [
    morphology.hasHead ? '头部' : null,
    morphology.hasArms ? '手臂' : null,
    morphology.hasLegs ? `${morphology.legCount} 腿` : null,
    morphology.hasWings ? `${morphology.wingCount} 翅膀` : null,
    morphology.hasTail ? '尾巴' : null,
    morphology.hasFins ? '鱼鳍' : null
  ].filter(Boolean);

  return `${parts.length ? parts.join(' / ') : '无明确肢体'} · ${morphology.bodyOrientation} · ${morphology.silhouetteComplexity}`;
}

function formatBehavior(artwork: StoredArtwork) {
  const { behaviorTraits } = artwork.features;
  return `${behaviorTraits.locomotionType} / ${behaviorTraits.energyLevel} / ${behaviorTraits.personalityFeel}`;
}

function formatVisualTraits(artwork: StoredArtwork) {
  const { visualTraits } = artwork.features;
  return `${visualTraits.brightness} / ${visualTraits.softness} / ${visualTraits.textureStyle}`;
}

function formatModelId(artwork: StoredArtwork) {
  return artwork.gaussianModel?.sourceArtworkId ?? artwork.id;
}

type WindowWithFilePicker = Window & {
  showOpenFilePicker?: (options?: {
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<Array<{ getFile: () => Promise<File> }>>;
};

export function CosmicControlPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isHidden, setIsHidden] = useState(true);
  const [stressTarget, setStressTarget] = useState('60');
  const artworks = useArtworkStore((state) => state.artworks);
  const latestArtwork = useArtworkStore((state) => state.latestArtwork);
  const clearArtworks = useArtworkStore((state) => state.clearArtworks);
  const status = useSketchStore((state) => state.status);
  const message = useSketchStore((state) => state.message);
  const setError = useSketchStore((state) => state.setError);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await submitArtworkFile(file);
    } catch (error) {
      setError(error instanceof Error ? error.message : '作品进入星河失败，请换一张更清晰的图片。');
    } finally {
      event.target.value = '';
    }
  };

  const openArtworkPicker = async () => {
    if (status === 'processing') return;

    const isFullscreenLike = Boolean(document.fullscreenElement)
      || (
        Math.abs(window.innerWidth - window.screen.width) <= 2
        && Math.abs(window.innerHeight - window.screen.height) <= 2
      );
    const picker = (window as WindowWithFilePicker).showOpenFilePicker;

    if (isFullscreenLike && picker) {
      try {
        const [handle] = await picker({
          excludeAcceptAllOption: false,
          multiple: false,
          types: [{
            description: 'Artwork image',
            accept: {
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp']
            }
          }]
        });
        const file = await handle?.getFile();
        if (file) {
          await submitArtworkFile(file);
        }

        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => undefined);
        }
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('[cosmos] showOpenFilePicker failed:', error);
      }
    }

    if (isFullscreenLike) {
      setError('当前浏览器全屏上传会退出全屏，请先退出全屏后上传，或使用支持文件选择 API 的浏览器。');
      return;
    }

    inputRef.current?.click();
  };

  const clearAllArtworks = () => {
    clearArtworks();
    useSketchStore.setState({
      status: 'idle',
      message: '星河已清空，可以继续发射新的作品。'
    });
  };

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setError('当前浏览器不支持全屏展示。');
    }
  };

  const localStressCount = artworks.reduce(
    (count, artwork) => count + (isLocalStressArtwork(artwork) ? 1 : 0),
    0
  );
  const localSourceCount = artworks.length - localStressCount;

  const runLocalStressTest = () => {
    const requestedTotal = Number.parseInt(stressTarget, 10);
    const sourceArtworks = useArtworkStore.getState().artworks.filter(
      (artwork) => !isLocalStressArtwork(artwork)
    );
    if (sourceArtworks.length === 0) {
      setError('本地模型库为空，请先上传或同步至少一个模型。');
      return;
    }
    const safeTarget = Math.max(
      sourceArtworks.length,
      Math.min(
        MAX_LOCAL_STRESS_TOTAL,
        Number.isFinite(requestedTotal) ? Math.max(1, requestedTotal) : sourceArtworks.length
      )
    );
    const stressCount = safeTarget - sourceArtworks.length;
    const createdAt = Date.now();
    const stressArtworks = Array.from({ length: stressCount }, (_, index) => (
      createLocalStressArtwork(
        sourceArtworks[index % sourceArtworks.length],
        index,
        createdAt + index
      )
    ));
    useArtworkStore.setState((state) => ({
      artworks: [...sourceArtworks, ...stressArtworks],
      latestArtwork: state.latestArtwork && !isLocalStressArtwork(state.latestArtwork)
        ? state.latestArtwork
        : sourceArtworks[0] ?? null
    }));
    setStressTarget(String(safeTarget));
    useSketchStore.setState({
      status: 'idle',
      message: `本地压力测试已启动：${sourceArtworks.length} 个真实模型 + ${stressCount} 个本地副本，共 ${safeTarget} 个。`
    });
  };

  const clearLocalStressTest = () => {
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
    useSketchStore.setState({
      status: 'idle',
      message: '本地压力测试模型已清除，真实作品保持不变。'
    });
  };

  const hasSplat = latestArtwork?.gaussianModel?.status === 'ready' && Boolean(latestArtwork.gaussianModel.splatUrl);
  const latestDustCount = latestArtwork
    ? hasSplat
      ? latestArtwork.gaussianModel?.gaussianCount
      : latestArtwork.particles.length
    : 0;
  const latestDustLabel = hasSplat ? '高斯点' : '图片粒子';

  if (isHidden) {
    return (
      <div className="cosmic-panel-compact" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="cosmic-panel-toggle"
          aria-label="显示控制面板"
          title="显示控制面板"
          onClick={() => setIsHidden(false)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Eye size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section className="cosmic-panel" aria-label="星河画境控制面板" onPointerDown={(event) => event.stopPropagation()}>
      <div className="cosmic-panel__header">
        <button
          type="button"
          className="cosmic-panel__hide"
          aria-label="隐藏控制面板"
          title="隐藏控制面板"
          onClick={() => setIsHidden(true)}
        >
          <EyeOff size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1>星河画境</h1>
        <p>上传画纸，后端生成 .splat 模型后进入星河；失败时自动回退为本地 3D 星光粒子生命。</p>
      </div>

      <div className="cosmic-panel__stat" aria-label="当前星河作品数量">
        <span>{artworks.length}</span>
        <span>当前星河作品</span>
      </div>

      <p className="cosmic-panel__status">{message}</p>

      {latestArtwork ? (
        <dl className="cosmic-panel__meta" aria-label="最新作品信息">
          <div>
            <dt>作品</dt>
            <dd>{latestArtwork.name}</dd>
          </div>
          <div>
            <dt>形态</dt>
            <dd>{renderModeLabel(hasSplat)}</dd>
          </div>
          <div>
            <dt>ID</dt>
            <dd>{formatModelId(latestArtwork)}</dd>
          </div>
          <div>
            <dt>尺寸</dt>
            <dd>{formatArtworkSize(latestArtwork)}</dd>
          </div>
          <div>
            <dt>动作</dt>
            <dd>{latestArtwork.features.motionPreset}</dd>
          </div>
          <div>
            <dt>星尘</dt>
            <dd>{formatCount(latestDustCount)} {latestDustLabel}</dd>
          </div>
          <div>
            <dt>主色</dt>
            <dd>{latestArtwork.features.visualTraits.dominantColors.slice(0, 5).join(' / ')}</dd>
          </div>
          <div>
            <dt>类别</dt>
            <dd>{latestArtwork.features.subjectCategory}</dd>
          </div>
          <div>
            <dt>结构</dt>
            <dd>{formatStructure(latestArtwork)}</dd>
          </div>
          <div>
            <dt>行为</dt>
            <dd>{formatBehavior(latestArtwork)}</dd>
          </div>
          <div>
            <dt>视觉</dt>
            <dd>{formatVisualTraits(latestArtwork)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="cosmic-panel__stress" aria-label="本地模型压力测试">
        <div className="cosmic-panel__stress-heading">
          <span><Gauge size={16} strokeWidth={2.2} aria-hidden="true" />本地模型压力测试</span>
          <em>{localStressCount} 测试 / {artworks.length} 总计</em>
        </div>
        <p>仅复用当前已载入的本地模型，不调用生成接口，也不写入后台成长数据。</p>
        <div className="cosmic-panel__stress-controls">
          <label htmlFor="local-stress-target">目标上屏总数</label>
          <input
            id="local-stress-target"
            type="number"
            min={1}
            max={MAX_LOCAL_STRESS_TOTAL}
            step={1}
            inputMode="numeric"
            value={stressTarget}
            onChange={(event) => setStressTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runLocalStressTest();
            }}
            disabled={status === 'processing'}
          />
        </div>
        <div className="cosmic-panel__stress-actions">
          <button
            type="button"
            className="cosmic-button cosmic-button--stress"
            onClick={runLocalStressTest}
            disabled={status === 'processing' || localSourceCount === 0}
          >
            开始压力测试
          </button>
          <button
            type="button"
            className="cosmic-button"
            onClick={clearLocalStressTest}
            disabled={status === 'processing' || localStressCount === 0}
          >
            清除测试模型
          </button>
        </div>
      </div>

      <div className="cosmic-panel__actions">
        <input
          ref={inputRef}
          className="cosmic-panel__input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileChange}
        />
        <button type="button" className="cosmic-button cosmic-button--primary" onClick={openArtworkPicker} disabled={status === 'processing'}>
          {status === 'processing' ? '生成中...' : '发射作品'}
        </button>
        <button type="button" className="cosmic-button" onClick={clearAllArtworks} disabled={status === 'processing'}>
          清空星河
        </button>
        <button type="button" className="cosmic-button" onClick={enterFullscreen}>
          全屏展示
        </button>
      </div>
    </section>
  );
}
