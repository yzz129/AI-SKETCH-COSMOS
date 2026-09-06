import {
  Box,
  Check,
  Copy,
  Download,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Sparkles,
  Trash2,
  WandSparkles
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  createDesignerGeneration,
  confirmDesignerGeneration,
  designerDownloadUrl,
  fetchDesignerGeneration,
  fetchDesignerHealth,
  fetchLatestDesignerGeneration,
  type DesignerGenerationJob,
  type DesignerReferenceImage,
  type DesignerViewType
} from '../lib/artwork/designerGeneration';
import '../styles/designer.css';

const DesignerGlbPreview = lazy(() => import('../components/designer/DesignerGlbPreview')
  .then((module) => ({ default: module.DesignerGlbPreview })));

const VIEW_OPTIONS: Array<{ id: DesignerViewType; label: string; short: string; optional: boolean }> = [
  { id: 'front', label: '正面', short: '正', optional: false },
  { id: 'back', label: '背面', short: '背', optional: true },
  { id: 'left', label: '左侧', short: '左', optional: true },
  { id: 'right', label: '右侧', short: '右', optional: true },
  { id: 'left_front', label: '左前 45°', short: '左前', optional: true },
  { id: 'right_front', label: '右前 45°', short: '右前', optional: true },
  { id: 'top', label: '顶部', short: '顶', optional: true },
  { id: 'bottom', label: '底部', short: '底', optional: true }
];
const MAX_NAME_LENGTH = 24;
const DESIGNER_DRAFT_NAME_KEY = 'designer-draft-name';
const DESIGNER_DRAFT_MODE_KEY = 'designer-draft-mode';
const DESIGNER_ACTIVE_JOB_KEY = 'designer-active-job-id';
const DESIGNER_REFERENCE_DB = 'designer-reference-draft';

function notifyExhibitionModelPublished(modelId: string) {
  try {
    window.localStorage.setItem('exhibition-model-library-changed', JSON.stringify({
      type: 'published',
      id: modelId,
      at: Date.now()
    }));
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('exhibition-model-library-changed');
      channel.postMessage({ type: 'published', id: modelId });
      channel.close();
    }
  } catch {
    // Cross-tab notification is optional; the display also polls the backend.
  }
}

type PersistedReference = {
  view: DesignerViewType;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

function openReferenceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DESIGNER_REFERENCE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('references', { keyPath: 'view' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readReferenceDrafts(): Promise<DesignerReferenceImage[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openReferenceDatabase();
  try {
    const records = await new Promise<PersistedReference[]>((resolve, reject) => {
      const request = database.transaction('references').objectStore('references').getAll();
      request.onsuccess = () => resolve(request.result as PersistedReference[]);
      request.onerror = () => reject(request.error);
    });
    return records.map((record) => ({
      view: record.view,
      file: new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified })
    }));
  } finally {
    database.close();
  }
}

async function writeReferenceDraft(reference: DesignerReferenceImage) {
  if (!('indexedDB' in window)) return;
  const database = await openReferenceDatabase();
  try {
    const transaction = database.transaction('references', 'readwrite');
    transaction.objectStore('references').put({
      view: reference.view,
      blob: reference.file,
      name: reference.file.name,
      type: reference.file.type,
      lastModified: reference.file.lastModified
    } satisfies PersistedReference);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function removeReferenceDraft(view?: DesignerViewType) {
  if (!('indexedDB' in window)) return;
  const database = await openReferenceDatabase();
  try {
    const transaction = database.transaction('references', 'readwrite');
    const store = transaction.objectStore('references');
    if (view) store.delete(view); else store.clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

async function normalizeReference(file: File, view: DesignerViewType) {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1440;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('当前浏览器无法处理图片');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const toBlob = (quality: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败')), 'image/jpeg', quality);
  });
  let blob = await toBlob(0.88);
  if (blob.size > 500 * 1024) blob = await toBlob(0.74);
  if (blob.size > 500 * 1024) blob = await toBlob(0.6);
  return new File([blob], `${view}-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

function DesignerHeader() {
  return (
    <header className="designer-hero">
      <div className="designer-brand-row">
        <img src="/brand/dadakido-logo.png" alt="DadaKido" />
        <span><Sparkles size={14} /> 星河画境</span>
      </div>
      <div className="designer-story">
        <div className="designer-mascot" aria-hidden="true">
          <i /><i />
          <img src="/brand/dadakido-mascot.png" alt="" />
        </div>
        <div>
          <p className="designer-eyebrow">3D CREATION · DESIGNER CHANNEL</p>
          <h1><span>设计</span><span>成模</span><span>入星河</span></h1>
          <p>上传单图或多视角参考图，生成带 PBR 材质的 GLB；生成完成后，作品会自动进入星河大屏。</p>
        </div>
      </div>
    </header>
  );
}

function ReferenceSlot({
  option,
  reference,
  disabled,
  onChange,
  onRemove
}: {
  option: typeof VIEW_OPTIONS[number];
  reference?: DesignerReferenceImage;
  disabled?: boolean;
  onChange: (view: DesignerViewType, file: File) => void;
  onRemove: (view: DesignerViewType) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => reference ? URL.createObjectURL(reference.file) : '', [reference]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onChange(option.id, file);
    event.target.value = '';
  };
  return (
    <div className={`designer-view-slot${reference ? ' has-image' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleInput} />
      {reference ? (
        <>
          <button type="button" className="designer-view-preview" onClick={() => inputRef.current?.click()} disabled={disabled}>
            <img src={preview} alt={`${option.label}参考图`} />
            <span>{option.label}</span>
          </button>
          <button type="button" className="designer-view-remove" onClick={() => onRemove(option.id)} aria-label={`移除${option.label}`}>
            <Trash2 size={14} />
          </button>
        </>
      ) : (
        <button type="button" className="designer-view-empty" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <strong>{option.short}</strong>
          <span>{option.label}</span>
          <small>{option.optional ? '选填' : '必填'}</small>
        </button>
      )}
    </div>
  );
}

export function DesignerPage() {
  const [name, setName] = useState(() => window.localStorage.getItem(DESIGNER_DRAFT_NAME_KEY) ?? '');
  const [mode, setMode] = useState<'single' | 'multi'>(() => (
    window.localStorage.getItem(DESIGNER_DRAFT_MODE_KEY) === 'multi' ? 'multi' : 'single'
  ));
  const [references, setReferences] = useState<DesignerReferenceImage[]>([]);
  const [preparingView, setPreparingView] = useState<DesignerViewType | null>(null);
  const [job, setJob] = useState<DesignerGenerationJob | null>(null);
  const [error, setError] = useState('');
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloadLinkVisible, setDownloadLinkVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const autoPublishingJobRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readReferenceDrafts().then((drafts) => {
      if (!cancelled) setReferences(mode === 'single' ? drafts.filter((item) => item.view === 'front') : drafts);
    }).catch(() => undefined);
    const linkedJobId = new URLSearchParams(window.location.search).get('job')?.trim();
    const activeJobId = linkedJobId || window.localStorage.getItem(DESIGNER_ACTIVE_JOB_KEY);
    const restoreLatest = () => fetchLatestDesignerGeneration().then((restoredJob) => {
      if (!cancelled && restoredJob) setJob(restoredJob);
    }).catch(() => undefined);
    if (activeJobId) {
      void fetchDesignerGeneration(activeJobId).then((restoredJob) => {
        if (!cancelled) setJob(restoredJob);
      }).catch(() => {
        window.localStorage.removeItem(DESIGNER_ACTIVE_JOB_KEY);
        return restoreLatest();
      });
    } else {
      void restoreLatest();
    }
    return () => { cancelled = true; };
  }, []); // Restore the initial mode only once; later mode changes manage drafts directly.

  useEffect(() => {
    window.localStorage.setItem(DESIGNER_DRAFT_NAME_KEY, name);
  }, [name]);

  useEffect(() => {
    window.localStorage.setItem(DESIGNER_DRAFT_MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (job?.id) window.localStorage.setItem(DESIGNER_ACTIVE_JOB_KEY, job.id);
  }, [job?.id]);

  useEffect(() => {
    void fetchDesignerHealth()
      .then((status) => setServiceReady(status.ready))
      .catch(() => setServiceReady(false));
  }, []);

  const autoPublishForGalaxy = useCallback(async (jobId: string) => {
    if (autoPublishingJobRef.current === jobId) return;
    autoPublishingJobRef.current = jobId;
    setError('');
    try {
      const published = await confirmDesignerGeneration(jobId);
      setJob(published);
      if (published.modelId) notifyExhibitionModelPublished(published.modelId);
    } catch (publishError) {
      setError(publishError instanceof Error
        ? `模型已生成，正在重试自动加入星河：${publishError.message}`
        : '模型已生成，正在重试自动加入星河');
    } finally {
      autoPublishingJobRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (job?.status === 'review') void autoPublishForGalaxy(job.id);
  }, [autoPublishForGalaxy, job?.id, job?.status]);

  useEffect(() => {
    if (!job || ['ready', 'failed', 'cancelled'].includes(job.status)) return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchDesignerGeneration(job.id).then((next) => {
        if (cancelled) return;
        setJob(next);
        if (next.status === 'review') void autoPublishForGalaxy(next.id);
      }).catch((pollError) => {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : '查询生成进度失败');
      });
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoPublishForGalaxy, job?.id, job?.status]);

  const setReference = async (view: DesignerViewType, file: File) => {
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
      setError('请选择 JPG、PNG 或 WEBP 图片');
      return;
    }
    setError('');
    setPreparingView(view);
    try {
      const normalized = await normalizeReference(file, view);
      const nextReference = { view, file: normalized };
      setReferences((current) => [
        ...current.filter((item) => item.view !== view),
        nextReference
      ].sort((left, right) => VIEW_OPTIONS.findIndex((item) => item.id === left.view) - VIEW_OPTIONS.findIndex((item) => item.id === right.view)));
      await writeReferenceDraft(nextReference);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : '图片处理失败');
    } finally {
      setPreparingView(null);
    }
  };

  const changeMode = (next: 'single' | 'multi') => {
    setMode(next);
    if (next === 'single') {
      setReferences((current) => current.filter((item) => item.view === 'front'));
      void Promise.all(VIEW_OPTIONS.filter((item) => item.id !== 'front').map((item) => removeReferenceDraft(item.id)));
    }
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const front = references.find((item) => item.view === 'front');
    if (!trimmedName) return setError('请先给作品命名');
    if (!front) return setError('请上传正面参考图');
    setError('');
    setSubmitting(true);
    try {
      const ordered = [front, ...references.filter((item) => item.view !== 'front')];
      const created = await createDesignerGeneration(trimmedName, ordered);
      setJob(created);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setName('');
    setMode('single');
    setReferences([]);
    setJob(null);
    setError('');
    setDownloadLinkVisible(false);
    setCopyFeedback('');
    window.localStorage.removeItem(DESIGNER_ACTIVE_JOB_KEY);
    window.localStorage.removeItem(DESIGNER_DRAFT_NAME_KEY);
    window.localStorage.removeItem(DESIGNER_DRAFT_MODE_KEY);
    void removeReferenceDraft();
  };

  const copyDownloadLink = async () => {
    if (!job?.modelUrl) return;
    const downloadUrl = designerDownloadUrl(job.modelUrl);
    try {
      await navigator.clipboard.writeText(downloadUrl);
      setCopyFeedback('链接已复制，请粘贴到手机浏览器下载');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = downloadUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      setCopyFeedback(copied ? '链接已复制，请粘贴到手机浏览器下载' : '请长按下方链接复制');
    }
  };

  const isPublished = job?.status === 'ready';
  const isCancelled = job?.status === 'cancelled';
  const working = Boolean(job && !['ready', 'failed', 'cancelled'].includes(job.status));
  const progress = Math.round((job?.progress ?? 0) * 100);
  const downloadUrl = job?.modelUrl ? designerDownloadUrl(job.modelUrl) : '';

  return (
    <main className="designer-page" translate="no">
      <div className="designer-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <div className="designer-shell">
        <DesignerHeader />

        {isPublished && job?.modelUrl ? (
          <section className="designer-result-card" aria-live="polite">
            <div className="designer-result-heading">
              <span className="designer-success-icon"><Check size={25} /></span>
              <div>
                <p>已自动进入星河大屏</p>
                <h2>{job.name}</h2>
                <span>模型正在沿用 GLB 展品运动逻辑 · GLB / PBR · {formatElapsed(job.elapsedSeconds)}</span>
              </div>
            </div>
            <Suspense fallback={<div className="designer-preview-loading"><LoaderCircle /> 正在打开 3D 预览…</div>}>
              <DesignerGlbPreview url={job.modelUrl} name={job.name} />
            </Suspense>
            {error ? <p className="designer-error">{error}</p> : null}
            <div className="designer-result-actions">
              <button type="button" onClick={() => setDownloadLinkVisible(true)}><Download size={18} />获取下载链接</button>
              <button type="button" onClick={reset}><WandSparkles size={18} />继续创作</button>
            </div>
            {downloadLinkVisible ? (
              <div className="designer-download-link" role="status">
                <span>请复制链接到手机浏览器打开，即可下载 GLB 文件</span>
                <a href={downloadUrl} target="_blank" rel="noreferrer">{downloadUrl}</a>
                <button type="button" onClick={() => void copyDownloadLink()}><Copy size={16} />一键复制链接</button>
                {copyFeedback ? <small>{copyFeedback}</small> : null}
              </div>
            ) : null}
          </section>
        ) : working ? (
          <section className="designer-progress-card" aria-live="polite">
            <div className="designer-progress-orbit"><Box size={54} /><i /><i /><i /></div>
            <p>正在生成「{job?.name}」</p>
            <h2>{job?.message}</h2>
            <div className="designer-progress-track"><span style={{ width: `${Math.max(5, progress)}%` }} /></div>
            <div className="designer-progress-meta"><strong>{progress}%</strong><span>已用时 {formatElapsed(job?.elapsedSeconds ?? 0)}</span></div>
            {error ? <p className="designer-error">{error}</p> : null}
            <small>生成完成后会自动进入星河，可先离开，稍后回来查看。</small>
          </section>
        ) : (
          <div className="designer-workspace">
            <section className="designer-form-card">
              <div className="designer-section-heading">
                <span>01</span><div><h2>命名作品</h2><p>名称会显示在大屏模型上方</p></div>
              </div>
              <label className="designer-name-field">
                <input
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="例如：稻田未来号"
                  onChange={(event) => setName(event.target.value)}
                />
                <span>{name.length}/{MAX_NAME_LENGTH}</span>
              </label>

              <div className="designer-section-heading designer-section-heading--views">
                <span>02</span><div><h2>上传参考图</h2><p>多视角能让结构与背面更准确</p></div>
              </div>
              <div className="designer-mode-tabs" role="tablist">
                <button type="button" className={mode === 'single' ? 'is-active' : ''} onClick={() => changeMode('single')}>
                  <ImagePlus size={18} /><span><strong>单图生成</strong><small>只需一张正面图</small></span>
                </button>
                <button type="button" className={mode === 'multi' ? 'is-active' : ''} onClick={() => changeMode('multi')}>
                  <Layers3 size={18} /><span><strong>多视角生成</strong><small>正面必填，其余选填</small></span>
                </button>
              </div>
              <div className={`designer-view-grid designer-view-grid--${mode}`}>
                {VIEW_OPTIONS.map((option) => (
                  <ReferenceSlot
                    key={option.id}
                    option={option}
                    reference={references.find((item) => item.view === option.id)}
                    disabled={mode === 'single' && option.id !== 'front'}
                    onChange={setReference}
                    onRemove={(view) => {
                      setReferences((current) => current.filter((item) => item.view !== view));
                      void removeReferenceDraft(view);
                    }}
                  />
                ))}
              </div>
              {preparingView ? <p className="designer-processing"><LoaderCircle size={15} /> 正在优化{VIEW_OPTIONS.find((item) => item.id === preparingView)?.label}图片…</p> : null}
              {error || job?.status === 'failed' || isCancelled ? <p className="designer-error">{error || job?.error || job?.message || '生成失败，请重试'}</p> : null}
              <button
                type="button"
                className="designer-generate-button"
                disabled={submitting || preparingView !== null || serviceReady === false}
                onClick={submit}
              >
                {submitting ? <LoaderCircle className="is-spinning" size={20} /> : <WandSparkles size={20} />}
                {serviceReady === false ? '生成服务暂未就绪' : submitting ? '正在提交…' : '生成 GLB 并进入星河'}
              </button>
              <p className="designer-privacy">参考图仅用于本次 3D 建模 · 生成完成后自动进入星河</p>
            </section>

          </div>
        )}
      </div>
    </main>
  );
}
