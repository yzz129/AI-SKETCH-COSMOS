import {
  AlertTriangle,
  Box,
  Check,
  Clock3,
  RefreshCw,
  RotateCcw,
  XCircle
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelAdminDesignerGeneration,
  confirmAdminDesignerGeneration,
  fetchAdminDesignerGenerations,
  resolveDesignerModelUrl,
  type DesignerGenerationJob,
  type DesignerGenerationStatus
} from '../../lib/artwork/designerGeneration';

const AdminGlbPreview = lazy(() => import('./AdminGlbPreview').then((module) => ({
  default: module.AdminGlbPreview
})));

const STATUS_LABELS: Record<DesignerGenerationStatus, string> = {
  queued: '排队中',
  submitting: '正在提交',
  waiting: '等待生成',
  running: '生成中',
  saving: '保存模型',
  review: '待审核',
  publishing: '提交中',
  ready: '已入星河',
  failed: '生成失败',
  cancelled: '已撤销'
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function formatBytes(value = 0) {
  if (value <= 0) return '—';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: DesignerGenerationStatus) {
  if (status === 'review') return 'review';
  if (status === 'ready') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  return 'pending';
}

export function DesignerReviewQueue() {
  const [jobs, setJobs] = useState<DesignerGenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<'confirm' | 'cancel' | ''>('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await fetchAdminDesignerGenerations(200);
      setJobs(result.jobs);
      setSelectedId((current) => (
        current && result.jobs.some((job) => job.id === current)
          ? current
          : result.jobs.find((job) => job.status === 'review')?.id ?? result.jobs[0]?.id ?? ''
      ));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模型审核列表加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null,
    [jobs, selectedId]
  );
  const reviewCount = jobs.filter((job) => job.status === 'review').length;
  const activeCount = jobs.filter((job) => ['queued', 'submitting', 'waiting', 'running', 'saving'].includes(job.status)).length;
  const modelUrl = selected?.modelUrl ? resolveDesignerModelUrl(selected.modelUrl) : '';

  const act = async (action: 'confirm' | 'cancel') => {
    if (!selected) return;
    setActing(action);
    setMessage('');
    try {
      const updated = action === 'confirm'
        ? await confirmAdminDesignerGeneration(selected.id)
        : await cancelAdminDesignerGeneration(selected.id);
      setJobs((current) => current.map((job) => job.id === updated.id ? updated : job));
      if (action === 'confirm') {
        localStorage.setItem('exhibition-model-library-changed', String(Date.now()));
        setMessage(`“${updated.name}”已提交到星河大屏。`);
      } else {
        setMessage(`“${updated.name}”已撤销。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setActing('');
    }
  };

  return (
    <section className="admin-designer-review" aria-label="设计师模型审核">
      <header className="admin-designer-review__head">
        <div>
          <span className="admin-eyebrow">MODEL REVIEW</span>
          <h2>设计师模型审核</h2>
          <p>用户提交后立即进入此列表；生成完成即可预览完整 GLB，并决定提交到大屏或撤销。</p>
        </div>
        <div className="admin-designer-review__summary">
          <span><Clock3 size={15} />生成中 <strong>{activeCount}</strong></span>
          <span><Box size={15} />待审核 <strong>{reviewCount}</strong></span>
          <button className="admin-icon-button" type="button" onClick={() => void load()} disabled={loading} title="刷新审核列表">
            <RefreshCw size={17} className={loading ? 'admin-spin' : undefined} />
          </button>
        </div>
      </header>

      {message ? <div className="admin-designer-review__message"><AlertTriangle size={16} />{message}</div> : null}

      <div className="admin-designer-review__layout">
        <aside className="admin-designer-review__list">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              className={job.id === selected?.id ? 'is-active' : ''}
              onClick={() => setSelectedId(job.id)}
            >
              <span className={`admin-review-status admin-review-status--${statusTone(job.status)}`}>{STATUS_LABELS[job.status]}</span>
              <strong>{job.name}</strong>
              <small>{formatDate(job.createdAt)}</small>
              <i style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }} />
            </button>
          ))}
          {!jobs.length && !loading ? <p>暂无设计师模型提交</p> : null}
        </aside>

        <article className="admin-designer-review__detail">
          {selected ? (
            <>
              <div className="admin-designer-review__meta">
                <div><span>作品名称</span><strong>{selected.name}</strong></div>
                <div><span>当前状态</span><strong>{STATUS_LABELS[selected.status]}</strong></div>
                <div><span>生成进度</span><strong>{Math.round(selected.progress * 100)}%</strong></div>
                <div><span>模型大小</span><strong>{formatBytes(selected.modelBytes)}</strong></div>
                <div><span>参考方式</span><strong>{selected.referenceMode === 'multi' ? '多视角' : '单图'}</strong></div>
                <div><span>任务编号</span><strong title={selected.id}>{selected.id.slice(-12)}</strong></div>
              </div>

              <div className="admin-designer-review__status-copy">
                <strong>{selected.message}</strong>
                <span>{selected.error || selected.sourceNames?.join('、') || '正在等待模型数据'}</span>
              </div>

              {modelUrl && ['review', 'ready'].includes(selected.status) ? (
                <Suspense fallback={<div className="admin-designer-review__preview-placeholder">正在加载 3D 预览…</div>}>
                  <AdminGlbPreview modelUrl={modelUrl} name={selected.name} />
                </Suspense>
              ) : (
                <div className="admin-designer-review__preview-placeholder">
                  <Box size={42} />
                  <strong>{selected.status === 'cancelled' ? '该任务已撤销' : selected.status === 'failed' ? '模型生成失败' : '模型生成完成后将在这里显示'}</strong>
                </div>
              )}

              <div className="admin-designer-review__actions">
                <button
                  type="button"
                  className="admin-review-confirm"
                  disabled={selected.status !== 'review' || Boolean(acting)}
                  onClick={() => void act('confirm')}
                >
                  {acting === 'confirm' ? <RefreshCw className="admin-spin" size={17} /> : <Check size={17} />}
                  提交到星河
                </button>
                <button
                  type="button"
                  className="admin-review-cancel"
                  disabled={['cancelled', 'publishing'].includes(selected.status) || Boolean(acting)}
                  onClick={() => void act('cancel')}
                >
                  {selected.status === 'ready' ? <RotateCcw size={17} /> : <XCircle size={17} />}
                  {selected.status === 'ready' ? '撤销入星河' : '撤销任务'}
                </button>
              </div>
            </>
          ) : <div className="admin-designer-review__preview-placeholder">请选择一条模型任务</div>}
        </article>
      </div>
    </section>
  );
}
