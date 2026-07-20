import {
  ArrowLeft,
  Box,
  Camera,
  Check,
  Crop as CropIcon,
  Copy,
  Download,
  ImagePlus,
  Maximize2,
  Minimize2,
  PenTool,
  Rotate3D,
  Sparkles,
  WandSparkles,
  X
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent
} from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  CosmicDrawingBoard,
  type CosmicDrawingBoardHandle
} from '../components/mobile/CosmicDrawingBoard';
import type { MobileSplatResultViewerHandle } from '../components/mobile/MobileSplatResultViewer';
import { submitArtworkFile } from '../lib/artwork/submitArtworkFile';
import type { StoredArtwork } from '../stores/artworkStore';
import type { ArtworkGaussianModelResult } from '../types/artwork';
import { useSketchStore } from '../stores/useSketchStore';
import '../styles/mobile-upload.css';

const MobileSplatResultViewer = lazy(() => import('../components/mobile/MobileSplatResultViewer')
  .then((module) => ({ default: module.MobileSplatResultViewer })));

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ACCEPTED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;
const DRAWING_DRAFT_STORAGE_KEY = 'ai-sketch-cosmos:submit-drawing-draft';

function readDrawingDraft() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(DRAWING_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

type CreationMode = 'upload' | 'drawing';

type MobileBrandHeroProps = {
  variant: 'mobile-upload-header' | 'mobile-generation-header' | 'mobile-result-header';
  title: string;
  description: string;
  animatedTitle: boolean;
  titleId?: string;
};

function MobileBrandHero({ variant, title, description, animatedTitle, titleId }: MobileBrandHeroProps) {
  return (
    <header className={`mobile-brand-hero ${variant}`}>
      <div className="mobile-brand-lockup">
        <img className="mobile-dadakido-logo" src="/brand/dadakido-logo.png" alt="DadaKido" />
        <span className="mobile-brand-cosmos"><Sparkles size={14} />星河画境</span>
      </div>
      <div className="mobile-brand-story">
        <div className="mobile-brand-mascot-stage" aria-hidden="true">
          <span className="mobile-brand-orbit mobile-brand-orbit--outer" />
          <span className="mobile-brand-orbit mobile-brand-orbit--inner" />
          <i className="mobile-brand-star mobile-brand-star--one" />
          <i className="mobile-brand-star mobile-brand-star--two" />
          <i className="mobile-brand-star mobile-brand-star--three" />
          <img className="mobile-dadakido-mascot" src="/brand/dadakido-mascot.png" alt="" />
        </div>
        <div className="mobile-brand-copy">
          <h1
            id={titleId}
            className={animatedTitle ? undefined : 'mobile-brand-title--static'}
            aria-label={title}
          >
            {animatedTitle
              ? title
              : Array.from(title, (character, index) => (
                <span key={`${character}-${index}`} aria-hidden="true">{character}</span>
              ))}
          </h1>
          <p>{description}</p>
        </div>
      </div>
    </header>
  );
}

function MobileGenerationProgress({ progress, failed = false }: { progress: number; failed?: boolean }) {
  const displayedProgress = Math.round(Math.min(100, Math.max(0, progress)));
  return (
    <div
      className={`mobile-generation-progress${failed ? ' is-error' : ''}${displayedProgress === 100 ? ' is-complete' : ''}`}
      aria-label={`生成进度 ${displayedProgress}%`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={displayedProgress}
    >
      <div><i style={{ width: `${displayedProgress}%` }}><b /></i></div>
      <span>{displayedProgress}%</span>
    </div>
  );
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const WECHAT_BROWSER_PATTERN = /MicroMessenger/i;

function isWeChatBrowser() {
  return typeof window !== 'undefined' && WECHAT_BROWSER_PATTERN.test(window.navigator.userAgent);
}

function toAbsoluteDownloadUrl(url: string) {
  try {
    return new URL(url, `${window.location.origin}/`).href;
  } catch {
    return url;
  }
}

async function copyText(value: string) {
  try {
    await window.navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadUrl(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with ${response.status}`);
    triggerBlobDownload(await response.blob(), filename);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取这张图片，请重新选择。'));
    image.src = url;
  });
}

async function createCroppedImageFile(
  sourceFile: File,
  cropArea: PixelCrop,
  renderedWidth: number,
  renderedHeight: number
) {
  const sourceUrl = URL.createObjectURL(sourceFile);
  try {
    const image = await loadImage(sourceUrl);
    const scaleX = image.naturalWidth / renderedWidth;
    const scaleY = image.naturalHeight / renderedHeight;
    const sourceX = Math.max(0, cropArea.x * scaleX);
    const sourceY = Math.max(0, cropArea.y * scaleY);
    const sourceWidth = Math.min(image.naturalWidth - sourceX, cropArea.width * scaleX);
    const sourceHeight = Math.min(image.naturalHeight - sourceY, cropArea.height * scaleY);
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error('请先选择需要保留的图片区域。');
    const outputScale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法裁剪图片，请重新选择。');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    const outputType = sourceFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputType, outputType === 'image/jpeg' ? 0.92 : undefined);
    });
    if (!blob) throw new Error('图片裁剪失败，请重新尝试。');
    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || '星河画作';
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${baseName}-裁剪.${extension}`, { type: outputType });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function MobileUploadPage() {
  const isWeChat = isWeChatBrowser();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const drawingBoardRef = useRef<CosmicDrawingBoardHandle>(null);
  const viewerRef = useRef<MobileSplatResultViewerHandle>(null);
  const modelFullscreenRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const previewUrlRef = useRef('');
  const cropSourceUrlRef = useRef('');
  const activeSubmissionRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const progressCompletionTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<CreationMode>('drawing');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadSourceFile, setUploadSourceFile] = useState<File | null>(null);
  const [cropSourceFile, setCropSourceFile] = useState<File | null>(null);
  const [cropSourceUrl, setCropSourceUrl] = useState('');
  const [cropSelection, setCropSelection] = useState<Crop>({
    unit: '%',
    x: 5,
    y: 5,
    width: 90,
    height: 90
  });
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<PixelCrop | null>(null);
  const [isApplyingCrop, setIsApplyingCrop] = useState(false);
  const [drawingDraft, setDrawingDraft] = useState<string | null>(readDrawingDraft);
  const [hasDrawing, setHasDrawing] = useState(Boolean(drawingDraft));
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<StoredArtwork | null>(null);
  const [generationPreview, setGenerationPreview] = useState<ArtworkGaussianModelResult | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [isModelFullscreen, setIsModelFullscreen] = useState(false);
  const [wechatDownloadPrompt, setWechatDownloadPrompt] = useState<{
    kind: 'image' | 'model';
    url: string;
    filename: string;
    copied?: boolean;
  } | null>(null);
  const [showGenerationProgress, setShowGenerationProgress] = useState(false);
  const status = useSketchStore((state) => state.status);
  const message = useSketchStore((state) => state.message);
  const setError = useSketchStore((state) => state.setError);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsModelFullscreen(document.fullscreenElement === modelFullscreenRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const toggleModelFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await modelFullscreenRef.current?.requestFullscreen();
  };

  const downloadAsset = async (url: string, filename: string, kind: 'image' | 'model') => {
    const absoluteUrl = toAbsoluteDownloadUrl(url);
    if (isWeChat) {
      setWechatDownloadPrompt({ kind, url: absoluteUrl, filename });
      return;
    }
    await downloadUrl(absoluteUrl, filename);
  };

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const syncVisibleViewport = () => {
      const visibleHeight = Math.max(320, Math.round(viewport?.height ?? window.innerHeight));
      root.style.setProperty('--mobile-visual-height', `${visibleHeight}px`);
      root.classList.toggle('mobile-viewport-short', visibleHeight < 720);
      root.classList.toggle('mobile-viewport-tight', visibleHeight < 660);
    };

    syncVisibleViewport();
    window.addEventListener('resize', syncVisibleViewport);
    window.addEventListener('orientationchange', syncVisibleViewport);
    viewport?.addEventListener('resize', syncVisibleViewport);
    viewport?.addEventListener('scroll', syncVisibleViewport);

    return () => {
      window.removeEventListener('resize', syncVisibleViewport);
      window.removeEventListener('orientationchange', syncVisibleViewport);
      viewport?.removeEventListener('resize', syncVisibleViewport);
      viewport?.removeEventListener('scroll', syncVisibleViewport);
      root.style.removeProperty('--mobile-visual-height');
      root.classList.remove('mobile-viewport-short');
      root.classList.remove('mobile-viewport-tight');
    };
  }, []);

  useEffect(() => () => {
    activeSubmissionRef.current?.controller.abort();
    activeSubmissionRef.current = null;
    if (progressCompletionTimerRef.current !== null) {
      window.clearTimeout(progressCompletionTimerRef.current);
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (cropSourceUrlRef.current) URL.revokeObjectURL(cropSourceUrlRef.current);
  }, []);

  useEffect(() => {
    if (!result || !showGenerationProgress) return;
    progressCompletionTimerRef.current = window.setTimeout(() => {
      progressCompletionTimerRef.current = null;
      setShowGenerationProgress(false);
    }, 1100);
    return () => {
      if (progressCompletionTimerRef.current !== null) {
        window.clearTimeout(progressCompletionTimerRef.current);
        progressCompletionTimerRef.current = null;
      }
    };
  }, [result, showGenerationProgress]);

  useEffect(() => {
    if (!submitting) return undefined;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const installPreviewFile = (nextFile: File, readyMessage: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setFile(nextFile);
    useSketchStore.setState({ status: 'idle', message: readyMessage });
  };

  const closeCropEditor = () => {
    if (cropSourceUrlRef.current) URL.revokeObjectURL(cropSourceUrlRef.current);
    cropSourceUrlRef.current = '';
    setCropSourceUrl('');
    setCropSourceFile(null);
    setCropSelection({ unit: '%', x: 5, y: 5, width: 90, height: 90 });
    setCroppedAreaPixels(null);
    setIsApplyingCrop(false);
  };

  const replaceUploadFile = (nextFile: File) => {
    if (!ACCEPTED_IMAGE_TYPES.has(nextFile.type) && !ACCEPTED_IMAGE_EXTENSION.test(nextFile.name)) {
      setError('请选择 JPG、PNG 或 WebP 图片；当前暂不支持 HEIC/HEIF。');
      return;
    }
    if (nextFile.size > MAX_UPLOAD_BYTES) {
      setError(`图片大小为 ${formatMegabytes(nextFile.size)}，请压缩到 15 MB 以内。`);
      return;
    }
    if (cropSourceUrlRef.current) URL.revokeObjectURL(cropSourceUrlRef.current);
    const nextCropUrl = URL.createObjectURL(nextFile);
    cropSourceUrlRef.current = nextCropUrl;
    setCropSourceFile(nextFile);
    setCropSourceUrl(nextCropUrl);
    setCropSelection({ unit: '%', x: 5, y: 5, width: 90, height: 90 });
    setCroppedAreaPixels(null);
    useSketchStore.setState({ status: 'idle', message: '拖动裁剪框或调整边角，自由选择需要保留的区域。' });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = '';
    if (nextFile) replaceUploadFile(nextFile);
  };

  const applyCrop = async () => {
    const cropImage = cropImageRef.current;
    if (!cropSourceFile || !croppedAreaPixels || !cropImage || isApplyingCrop) return;
    setIsApplyingCrop(true);
    try {
      const croppedFile = await createCroppedImageFile(
        cropSourceFile,
        croppedAreaPixels,
        cropImage.width,
        cropImage.height
      );
      setUploadSourceFile(cropSourceFile);
      installPreviewFile(croppedFile, '裁剪完成，确认后即可生成你的 3D 星河生命。');
      closeCropEditor();
    } catch (error) {
      setIsApplyingCrop(false);
      setError(error instanceof Error ? error.message : '图片裁剪失败，请重新尝试。');
    }
  };

  const cancelCrop = () => {
    closeCropEditor();
    if (!file) {
      useSketchStore.setState({
        status: 'idle',
        message: '拍摄纸上画作，或从手机相册选择一张图片。'
      });
    }
  };

  const clearUpload = () => {
    closeCropEditor();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
    setFile(null);
    setUploadSourceFile(null);
    useSketchStore.setState({
      status: 'idle',
      message: '拍摄纸上画作，或从手机相册选择一张图片。'
    });
  };

  const handleDrawingChange = (nextHasDrawing: boolean, snapshot: string | null) => {
    const nextDraft = nextHasDrawing ? snapshot : null;
    setHasDrawing(nextHasDrawing);
    setDrawingDraft(nextDraft);
    try {
      if (nextDraft) window.sessionStorage.setItem(DRAWING_DRAFT_STORAGE_KEY, nextDraft);
      else window.sessionStorage.removeItem(DRAWING_DRAFT_STORAGE_KEY);
    } catch {
      // The in-memory draft still preserves mode switches when storage is unavailable.
    }
  };

  const beginGeneration = async () => {
    if (activeSubmissionRef.current) return;
    const submissionId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const controller = new AbortController();
    activeSubmissionRef.current = { id: submissionId, controller };
    try {
      let submissionFile = file;
      if (mode === 'drawing') {
        submissionFile = await drawingBoardRef.current?.toFile() ?? null;
        if (submissionFile) {
          installPreviewFile(submissionFile, '手绘作品已保存，正在准备生成 3D 星河生命。');
        }
      }
      if (!submissionFile) return;

      setSubmitting(true);
      setShowGenerationProgress(true);
      setResult(null);
      setGenerationPreview(null);
      setViewerReady(false);
      const generatedArtwork = await submitArtworkFile(submissionFile, {
        allowLocalFallback: false,
        submissionId,
        signal: controller.signal,
        onGaussianProgress: (progress) => {
          if (activeSubmissionRef.current?.id !== submissionId) return;
          setGenerationPreview((current) => {
            if (!current?.previewUrl && !progress.previewUrl) return current;
            return {
              ...current,
              ...progress,
              previewUrl: progress.previewUrl ?? current?.previewUrl
            };
          });
        }
      });
      if (activeSubmissionRef.current?.id !== submissionId) return;
      if (mode === 'drawing') handleDrawingChange(false, null);
      setResult(generatedArtwork);
    } catch (error) {
      if (controller.signal.aborted || activeSubmissionRef.current?.id !== submissionId) return;
      if (useSketchStore.getState().status !== 'error') {
        setError(error instanceof Error ? error.message : '作品生成失败，请稍后重试。');
      }
    } finally {
      if (activeSubmissionRef.current?.id === submissionId) {
        activeSubmissionRef.current = null;
        setSubmitting(false);
      }
    }
  };

  const resetAll = () => {
    activeSubmissionRef.current?.controller.abort();
    activeSubmissionRef.current = null;
    clearUpload();
    setResult(null);
    setGenerationPreview(null);
    setViewerReady(false);
    setShowGenerationProgress(false);
    if (progressCompletionTimerRef.current !== null) {
      window.clearTimeout(progressCompletionTimerRef.current);
      progressCompletionTimerRef.current = null;
    }
    setMode('drawing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleViewerReady = () => {
    setViewerReady(true);
  };

  const saveCurrentView = async () => {
    const snapshot = await viewerRef.current?.capture();
    if (snapshot) triggerBlobDownload(snapshot, `我的星河生命-3D视角-${Date.now()}.png`);
  };

  const explicitProgress = Number(message.match(/(\d{1,3})%/)?.[1] ?? 0);
  const estimatedProgress = Math.min(
    96,
    10
      + 34 * (1 - Math.exp(-elapsedSeconds / 8))
      + 52 * (1 - Math.exp(-elapsedSeconds / 75))
  );
  const generationProgress = Math.min(96, Math.max(explicitProgress, estimatedProgress));
  const canGenerate = mode === 'drawing' ? hasDrawing : Boolean(file) && !cropSourceFile;

  const progressiveEffectUrl = result?.gaussianModel?.previewUrl ?? generationPreview?.previewUrl;

  if (result || progressiveEffectUrl) {
    const generationComplete = Boolean(result);
    const generationFailed = !result && !submitting && status === 'error';
    const backendEffectUrl = progressiveEffectUrl;
    const effectUrl = backendEffectUrl ?? '';
    const effectReady = Boolean(backendEffectUrl);
    const modelUrl = result?.gaussianModel?.splatUrl;

    return (
      <main className={`mobile-upload-page mobile-upload-page--result${isWeChat ? ' mobile-upload-page--wechat' : ''}`} translate="no">
        <div className="mobile-cosmos-backdrop" aria-hidden="true" />
        <section className="mobile-creation-shell mobile-result-shell">
          <MobileBrandHero
            variant="mobile-result-header"
            title={generationComplete ? '你的星河生命诞生了' : '先看看它的效果图'}
            animatedTitle={isWeChat}
            description={generationComplete
              ? '效果图与 3D 模型已经准备好，也已送入星河。'
              : '效果图已经生成，3D 模型正在后台继续构建。'}
          />

          <ol className="mobile-result-steps is-progressive" aria-label="生成阶段">
            <li className="is-done"><span><Check size={17} /></span><p>效果图已生成</p></li>
            <li className={generationComplete ? 'is-done' : generationFailed ? 'is-error' : 'is-active'}>
              <span><Box size={18} /></span><p>{generationComplete ? '3D 生成完成' : '3D 后台生成'}</p>
            </li>
            <li className={generationComplete ? 'is-done' : undefined}>
              <span><Sparkles size={18} /></span><p>{generationComplete ? '已送入星河' : '等待最终合成'}</p>
            </li>
          </ol>

          {showGenerationProgress ? (
            <MobileGenerationProgress
              progress={generationComplete ? 100 : generationProgress}
              failed={generationFailed}
            />
          ) : null}

          <section className="mobile-result-section" aria-labelledby="effect-image-title">
            <div className="mobile-result-heading">
              <div>
                <h2 id="effect-image-title">AI 效果图</h2>
                <p>{generationComplete ? '效果图与下方的 3D 模型会一起保留。' : '先欣赏效果图，不用停在进度条前等待。'}</p>
              </div>
              <button
                type="button"
                className="mobile-inline-action"
                disabled={!effectReady}
                onClick={() => effectUrl && void downloadAsset(effectUrl, `我的星河生命-效果图-${Date.now()}.png`, 'image')}
              >
                <Download size={17} />
                下载效果图
              </button>
            </div>
            <div className={`mobile-effect-frame${effectReady ? '' : ' is-preparing'}`}>
              {effectUrl ? <img src={effectUrl} alt="AI 生成的效果图" /> : null}
              {!effectReady ? (
                <div className="mobile-effect-preparing" aria-live="polite">
                  <WandSparkles size={20} />
                  <span>正在等待 AI 原始效果图…</span>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="mobile-text-download"
              onClick={() => previewUrl && void downloadAsset(previewUrl, `我的原画-${Date.now()}.png`, 'image')}
            >
              <Download size={16} />
              同时下载我的原画
            </button>
          </section>

          <section className="mobile-result-section" aria-labelledby="real-model-title">
            <div className="mobile-result-heading mobile-result-heading--model">
              <div>
                <h2 id="real-model-title">真实 3D 模型</h2>
                <p>{generationComplete ? '拖动旋转 · 双指缩放' : '效果图展示期间继续在后台生成'}</p>
              </div>
              {generationComplete ? <div className="mobile-model-actions">
                <button type="button" className="mobile-inline-action" disabled={!viewerReady} onClick={() => void saveCurrentView()}>
                  <Rotate3D size={17} />
                  保存视角
                </button>
                <button
                  type="button"
                  className="mobile-inline-action"
                  disabled={!viewerReady}
                  onClick={() => void toggleModelFullscreen()}
                >
                  {isModelFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                  {isModelFullscreen ? '退出全屏' : '全屏查看'}
                </button>
                <button
                  type="button"
                  className="mobile-inline-action"
                  disabled={!modelUrl}
                  onClick={() => modelUrl && void downloadAsset(modelUrl, `我的星河生命-${Date.now()}.splat`, 'model')}
                >
                  <Download size={17} />
                  下载模型
                </button>
              </div> : null}
            </div>

            <div ref={modelFullscreenRef} className="mobile-model-fullscreen-stage">
            {isModelFullscreen ? (
              <button type="button" className="mobile-model-fullscreen-back" onClick={() => void toggleModelFullscreen()}>
                <ArrowLeft size={20} />
                返回结果页
              </button>
            ) : null}
            {result ? (
              <Suspense fallback={(
                <div className="mobile-splat-viewer__fallback"><p>正在加载 3D 查看器…</p></div>
              )}>
                <MobileSplatResultViewer ref={viewerRef} artwork={result} onReady={handleViewerReady} />
              </Suspense>
            ) : (
              <div className={`mobile-splat-viewer__fallback mobile-model-pending${generationFailed ? ' is-error' : ''}`} role="status" aria-live="polite">
                <span className="mobile-model-pending__icon" aria-hidden="true">
                  {generationFailed ? <WandSparkles size={25} /> : <Box size={25} />}
                </span>
                <strong>{generationFailed ? '效果图已保留，3D 模型未能完成' : '3D 模型正在后台生成'}</strong>
                <p>{generationFailed ? message : generationPreview?.message ?? message}</p>
                {!generationFailed ? <i className="mobile-model-pending__pulse" aria-hidden="true"><b /><b /><b /></i> : null}
              </div>
            )}
            </div>
          </section>

          {generationComplete || generationFailed ? (
            <button type="button" className="mobile-submit-button mobile-create-again" onClick={resetAll}>
              <Sparkles size={19} />
              {generationComplete ? '再创作一只' : '返回重新创作'}
            </button>
          ) : null}
        </section>
        {wechatDownloadPrompt ? (
          <div className="mobile-wechat-download" role="dialog" aria-modal="true" aria-labelledby="wechat-download-title">
            <button
              type="button"
              className="mobile-wechat-download__close"
              aria-label="关闭下载提示"
              onClick={() => setWechatDownloadPrompt(null)}
            >
              <X size={20} />
            </button>
            {wechatDownloadPrompt.kind === 'image' ? (
              <>
                <h2 id="wechat-download-title">长按图片保存</h2>
                <p>在图片上长按，选择“保存图片”即可存入手机相册。</p>
                <img src={wechatDownloadPrompt.url} alt="可长按保存的高清图片" />
              </>
            ) : (
              <>
                <h2 id="wechat-download-title">在浏览器中下载模型</h2>
                <p>微信网页暂不支持直接保存 .splat 模型。复制链接后，点击微信右上角“在浏览器打开”即可下载。</p>
                <button
                  type="button"
                  className="mobile-wechat-download__copy"
                  onClick={() => {
                    void copyText(wechatDownloadPrompt.url).then(() => {
                      setWechatDownloadPrompt((current) => current ? { ...current, copied: true } : current);
                    });
                  }}
                >
                  <Copy size={18} />
                  {wechatDownloadPrompt.copied ? '链接已复制' : '复制模型下载链接'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </main>
    );
  }

  if (submitting) {
    return (
      <main className={`mobile-upload-page mobile-upload-page--generating${isWeChat ? ' mobile-upload-page--wechat' : ''}`} translate="no">
        <div className="mobile-cosmos-backdrop" aria-hidden="true" />
        <section className="mobile-creation-shell mobile-generation-shell">
          <MobileBrandHero
            variant="mobile-generation-header"
            title="正在唤醒你的星河生命"
            animatedTitle={isWeChat}
            description="不用盯着进度条，你的画已经开始在星尘中获得立体形态。"
          />

          <div className="mobile-generation-preview">
            <img src={previewUrl} alt="正在生成 3D 的画作" />
            <div className="mobile-generation-particles" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <span className="mobile-generation-orbit" aria-hidden="true" />
          </div>

          <MobileGenerationProgress progress={generationProgress} />

          <ol className="mobile-generation-steps">
            <li className="is-done"><span><Check size={15} /></span><p>画作已接收</p></li>
            <li className="is-active"><span><Box size={16} /></span><p>重建 3D 形态</p></li>
            <li><span><Sparkles size={16} /></span><p>送入星河</p></li>
          </ol>

          <div className={`mobile-upload-status mobile-upload-status-${status}`} aria-live="polite">
            <span className="mobile-status-dot" aria-hidden="true" />
            <div>
              <strong>{elapsedSeconds < 8 ? '正在分析线条与颜色' : '正在生成真实 3D 模型'}</strong>
              <p>{message}</p>
            </div>
          </div>
          <p className="mobile-wait-note">页面会在完成后自动展示结果，可以先欣赏画作的星尘变化。</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`mobile-upload-page${isWeChat ? ' mobile-upload-page--wechat' : ''}`} translate="no">
      <div className="mobile-cosmos-backdrop" aria-hidden="true" />
      <section className="mobile-creation-shell" aria-labelledby="mobile-upload-title">
        <MobileBrandHero
          variant="mobile-upload-header"
          title="把想象画进星河"
          animatedTitle={isWeChat}
          description="拍下纸上画作，或亲手画出一只星河生命。"
          titleId="mobile-upload-title"
        />

        <div className="mobile-creation-tabs" role="tablist" aria-label="选择创作方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'upload'}
            className={mode === 'upload' ? 'is-selected' : undefined}
            onClick={() => setMode('upload')}
          >
            <Camera size={19} />
            拍照上传
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'drawing'}
            className={mode === 'drawing' ? 'is-selected' : undefined}
            onClick={() => setMode('drawing')}
          >
            <PenTool size={19} />
            手绘创作
          </button>
        </div>

        <input
          ref={cameraInputRef}
          className="mobile-upload-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
        />
        <input
          ref={galleryInputRef}
          className="mobile-upload-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onFileChange}
        />

        {mode === 'upload' ? (
          <section className="mobile-upload-workspace" role="tabpanel" aria-label="拍照上传画作">
            {cropSourceUrl ? (
              <div className="mobile-image-cropper" aria-label="裁剪上传图片">
                <div className="mobile-image-cropper__viewport">
                  <ReactCrop
                    crop={cropSelection}
                    minWidth={36}
                    minHeight={36}
                    keepSelection
                    ruleOfThirds
                    onChange={(_, percentCrop) => setCropSelection(percentCrop)}
                    onComplete={(pixelCrop) => setCroppedAreaPixels(pixelCrop)}
                  >
                    <img
                      ref={cropImageRef}
                      src={cropSourceUrl}
                      alt="待自由裁剪的画作"
                      onLoad={(event) => {
                        const { width, height } = event.currentTarget;
                        setCroppedAreaPixels({
                          unit: 'px',
                          x: width * 0.05,
                          y: height * 0.05,
                          width: width * 0.9,
                          height: height * 0.9
                        });
                      }}
                    />
                  </ReactCrop>
                </div>
                <div className="mobile-crop-actions">
                  <button type="button" className="mobile-secondary-button" disabled={isApplyingCrop} onClick={cancelCrop}>
                    <X size={17} />
                    取消
                  </button>
                  <button
                    type="button"
                    className="mobile-secondary-button mobile-crop-confirm"
                    disabled={!croppedAreaPixels || isApplyingCrop}
                    onClick={() => void applyCrop()}
                  >
                    <Check size={17} />
                    {isApplyingCrop ? '正在裁剪' : '确认'}
                  </button>
                </div>
              </div>
            ) : previewUrl ? (
              <div className="mobile-upload-preview">
                <img src={previewUrl} alt="待提交画作预览" />
                <button
                  type="button"
                  className="mobile-preview-crop-button"
                  onClick={() => {
                    const source = uploadSourceFile ?? file;
                    if (source) replaceUploadFile(source);
                  }}
                >
                  <CropIcon size={16} />
                  重新裁剪
                </button>
                <div className="mobile-upload-file-meta">
                  <span>{file?.name}</span>
                  <span>{file ? formatMegabytes(file.size) : null}</span>
                </div>
              </div>
            ) : (
              <button type="button" className="mobile-upload-placeholder" onClick={() => cameraInputRef.current?.click()}>
                <span aria-hidden="true"><ImagePlus size={32} /></span>
                <strong>让画作完整进入取景框</strong>
                <p>保持纸张平整、光线均匀，支持 JPG、PNG、WebP</p>
              </button>
            )}

            <div className="mobile-capture-actions">
              <button type="button" className="mobile-secondary-button" onClick={() => cameraInputRef.current?.click()}>
                <Camera size={18} />
                拍摄画作
              </button>
              <button type="button" className="mobile-secondary-button" onClick={() => galleryInputRef.current?.click()}>
                <ImagePlus size={18} />
                从相册选择
              </button>
            </div>
            {file ? (
              <button type="button" className="mobile-reset-button" onClick={clearUpload}>清除并重新选择</button>
            ) : null}
          </section>
        ) : (
          <div className="mobile-drawing-panel" role="tabpanel" aria-label="手绘创作">
            <CosmicDrawingBoard
              ref={drawingBoardRef}
              initialSnapshot={drawingDraft}
              onDrawingChange={handleDrawingChange}
            />
          </div>
        )}

        <div className={`mobile-upload-status mobile-upload-status-${status}`} aria-live="polite">
          <span className="mobile-status-dot" aria-hidden="true" />
          <p>{mode === 'drawing' && !hasDrawing ? '选一支画笔，在白色画纸上开始创作。' : message}</p>
        </div>

        <button
          type="button"
          className="mobile-submit-button"
          disabled={!canGenerate}
          onClick={() => void beginGeneration()}
        >
          <WandSparkles size={20} />
          {mode === 'drawing' ? '完成创作并生成 3D' : '用这幅画生成 3D'}
        </button>
      </section>
    </main>
  );
}
