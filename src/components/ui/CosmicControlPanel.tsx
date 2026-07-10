import { ChangeEvent, useRef, useState } from 'react';
import { Eye, EyeOff, Upload } from 'lucide-react';
import { submitArtworkFile } from '../../lib/artwork/submitArtworkFile';
import { useArtworkStore, type StoredArtwork } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';

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
  const [isHidden, setIsHidden] = useState(false);
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
        <input
          ref={inputRef}
          className="cosmic-panel__input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileChange}
        />
        <button
          type="button"
          className="cosmic-panel-compact__upload"
          onClick={openArtworkPicker}
          disabled={status === 'processing'}
        >
          <Upload size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>{status === 'processing' ? '生成中' : '发布作品'}</span>
        </button>
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
