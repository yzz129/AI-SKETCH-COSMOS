import { ChangeEvent, useRef } from 'react';
import { submitArtworkFile } from '../../lib/artwork/submitArtworkFile';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';

function renderModeLabel(hasSplat: boolean) {
  return hasSplat ? 'TripoSplat .splat' : '图片 3D 粒子化';
}

export function CosmicControlPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
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

  return (
    <section className="cosmic-panel" aria-label="星河画境控制面板" onPointerDown={(event) => event.stopPropagation()}>
      <div className="cosmic-panel__header">
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
            <dt>动作</dt>
            <dd>{latestArtwork.features.motionPreset}</dd>
          </div>
          <div>
            <dt>星尘</dt>
            <dd>{latestArtwork.particles.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>主色</dt>
            <dd>{latestArtwork.features.visualTraits.dominantColors.slice(0, 3).join(' / ')}</dd>
          </div>
          <div>
            <dt>分析</dt>
            <dd>{latestArtwork.features.subjectCategory} / {latestArtwork.features.behaviorTraits.locomotionType}</dd>
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
        <button type="button" className="cosmic-button cosmic-button--primary" onClick={() => inputRef.current?.click()} disabled={status === 'processing'}>
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
