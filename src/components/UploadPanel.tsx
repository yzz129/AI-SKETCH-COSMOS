import { ChangeEvent, useRef } from 'react';
import { analyzeArtworkFeatures } from '../lib/ai/analyzeArtworkFeatures';
import { useArtworkStore } from '../stores/artworkStore';
import { useSketchStore } from '../stores/useSketchStore';
import { processArtworkImage } from '../utils/artworkImage';

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const artworks = useArtworkStore((state) => state.artworks);
  const latestArtwork = useArtworkStore((state) => state.latestArtwork);
  const addArtwork = useArtworkStore((state) => state.addArtwork);
  const clearArtworks = useArtworkStore((state) => state.clearArtworks);
  const status = useSketchStore((state) => state.status);
  const message = useSketchStore((state) => state.message);
  const isIdleMode = useSketchStore((state) => state.isIdleMode);
  const setProcessing = useSketchStore((state) => state.setProcessing);
  const setError = useSketchStore((state) => state.setError);
  const setIdleMode = useSketchStore((state) => state.setIdleMode);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setProcessing('正在去白底、识别行为特征并生成 3D 粒子生命...');
      const artwork = await processArtworkImage(file);
      const features = await analyzeArtworkFeatures(file);

      addArtwork(artwork, features);
      useSketchStore.setState({
        status: 'ready',
        message: `${artwork.name} 已进入星河：3D 粒子生命 / ${features.motionPreset}`,
        isIdleMode: false,
        lastActivityAt: Date.now()
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '作品进入星河失败，请换一张更清晰的图片。');
    } finally {
      event.target.value = '';
    }
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

  return (
    <section className="upload-panel" aria-label="Cosmic artwork upload panel" onPointerDown={(event) => event.stopPropagation()}>
      <div>
        <p className="upload-kicker">Cosmic Gallery</p>
        <h1>星河画境</h1>
        <p className="upload-status">{message}</p>
      </div>

      <div className="creature-count" aria-label="Creature count">
        <span>{artworks.length}</span>
        <span>{artworks.length === 1 ? 'work in orbit' : 'works in orbit'}</span>
        {isIdleMode ? <span className="idle-pill">Idle</span> : null}
      </div>

      {latestArtwork ? (
        <dl className="upload-meta" aria-label="Processed image metadata">
          <div>
            <dt>Source</dt>
            <dd>{latestArtwork.name}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Image particles</dd>
          </div>
          <div>
            <dt>Motion</dt>
            <dd>{latestArtwork.features.motionPreset}</dd>
          </div>
          <div>
            <dt>Particles</dt>
            <dd>{latestArtwork.particles.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Colors</dt>
            <dd>{latestArtwork.features.visualTraits.dominantColors.slice(0, 3).join(', ')}</dd>
          </div>
        </dl>
      ) : null}

      <div className="upload-actions">
        <input
          ref={inputRef}
          className="upload-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileChange}
        />
        <button type="button" className="upload-button" onClick={() => inputRef.current?.click()} disabled={status === 'processing'}>
          {status === 'processing' ? '识别中...' : '发射作品'}
        </button>
        <button type="button" className="ghost-button" onClick={clearArtworks} disabled={status === 'processing'}>
          Clear
        </button>
      </div>

      <div className="screen-actions">
        <button type="button" className="ghost-button" onClick={enterFullscreen}>
          Fullscreen
        </button>
        <button type="button" className="ghost-button" onClick={() => setIdleMode(!isIdleMode)}>
          {isIdleMode ? 'Pause Idle' : 'Idle Mode'}
        </button>
      </div>
    </section>
  );
}
