import { ChangeEvent, useRef } from 'react';
import { submitArtworkFile } from '../lib/artwork/submitArtworkFile';
import { useArtworkStore } from '../stores/artworkStore';
import { useSketchStore } from '../stores/useSketchStore';

export function UploadPanel() {
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
      </div>

      {latestArtwork ? (
        <dl className="upload-meta" aria-label="Processed image metadata">
          <div>
            <dt>Source</dt>
            <dd>{latestArtwork.name}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{latestArtwork.gaussianModel?.status === 'ready' ? 'TripoSplat .splat' : 'Image particles'}</dd>
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
          {status === 'processing' ? '生成中...' : '发射作品'}
        </button>
        <button type="button" className="ghost-button" onClick={clearArtworks} disabled={status === 'processing'}>
          Clear
        </button>
      </div>

      <div className="screen-actions">
        <button type="button" className="ghost-button" onClick={enterFullscreen}>
          Fullscreen
        </button>
      </div>
    </section>
  );
}
