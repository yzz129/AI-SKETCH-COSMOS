import {
  ArchiveRestore,
  Box,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  createExhibitionModel,
  deleteExhibitionModel,
  fetchExhibitionModels,
  restoreExhibitionModel,
  type ExhibitionModelRecord,
  updateExhibitionModel
} from '../../lib/artwork/exhibitionModelLibrary';

const AdminGlbPreview = lazy(() => import('./AdminGlbPreview').then((module) => ({
  default: module.AdminGlbPreview
})));

const PAGE_SIZE = 8;
const EXHIBITION_LIBRARY_CHANGED_EVENT = 'exhibition-model-library-changed';

function notifyExhibitionLibraryChanged() {
  const changedAt = Date.now();
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(EXHIBITION_LIBRARY_CHANGED_EVENT);
    channel.postMessage({ changedAt });
    channel.close();
  }
  window.localStorage.setItem(EXHIBITION_LIBRARY_CHANGED_EVENT, String(changedAt));
}

type NewExhibitionModel = {
  id: string;
  name: string;
  modelUrl: string;
  color: string;
  entryType: 'award' | 'contest';
};

const EMPTY_NEW_MODEL: NewExhibitionModel = {
  id: '',
  name: '',
  modelUrl: '',
  color: '#f97316',
  entryType: 'award'
};

function exhibitionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.includes('404')
    ? '后台接口尚未重启，当前仅能查看本地展品；重启服务后即可增删改查。'
    : message;
}

function originalGlbFilename(modelUrl: string) {
  try {
    const pathname = new URL(modelUrl, window.location.origin).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? modelUrl);
  } catch {
    return decodeURIComponent(modelUrl.split(/[?#]/)[0].split('/').pop() ?? modelUrl);
  }
}

export function ExhibitionModelAdminPanel() {
  const [records, setRecords] = useState<ExhibitionModelRecord[]>([]);
  const [draft, setDraft] = useState<NewExhibitionModel>(EMPTY_NEW_MODEL);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState<'all' | 'award' | 'contest'>('all');
  const [page, setPage] = useState(0);

  const filteredRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records.filter((record) => {
      if (entryFilter !== 'all' && record.entryType !== entryFilter) return false;
      return !keyword || `${record.name} ${record.id} ${record.modelUrl}`.toLowerCase().includes(keyword);
    });
  }, [entryFilter, query, records]);
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = useMemo(
    () => filteredRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredRecords, page]
  );
  const selected = visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0] ?? null;

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const nextRecords = await fetchExhibitionModels({ includeDeleted: showDeleted });
      const nextVisible = nextRecords.filter((record) => showDeleted ? record.isDeleted : !record.isDeleted);
      setRecords(nextVisible);
      setSelectedId((current) => current && nextVisible.some((record) => record.id === current)
        ? current
        : nextVisible[0]?.id ?? null);
    } catch (error) {
      setMessage(exhibitionErrorMessage(error, '常驻展品加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    void load();
  }, [showDeleted]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  useEffect(() => {
    if (visibleRecords.length > 0 && !visibleRecords.some((record) => record.id === selectedId)) {
      setSelectedId(visibleRecords[0].id);
    }
  }, [selectedId, visibleRecords]);

  const patchLocal = (id: string, patch: Partial<ExhibitionModelRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  };

  const changePage = (nextPage: number) => {
    const safePage = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPage(safePage);
    setSelectedId(filteredRecords[safePage * PAGE_SIZE]?.id ?? null);
  };

  const save = async (record: ExhibitionModelRecord) => {
    setLoading(true);
    setMessage('');
    try {
      const next = await updateExhibitionModel(record.id, {
        name: record.name,
        modelUrl: record.modelUrl,
        color: record.color,
        position: record.position,
        scale: record.scale,
        previewUrl: record.previewUrl,
        entryType: record.entryType
      });
      patchLocal(record.id, next);
      notifyExhibitionLibraryChanged();
      setMessage(`已保存：${next.name}`);
    } catch (error) {
      setMessage(exhibitionErrorMessage(error, '常驻展品保存失败'));
    } finally {
      setLoading(false);
    }
  };

  const restore = async (record: ExhibitionModelRecord) => {
    setLoading(true);
    setMessage('');
    try {
      await restoreExhibitionModel(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      notifyExhibitionLibraryChanged();
      setMessage(`已恢复：${record.name}`);
    } catch (error) {
      setMessage(exhibitionErrorMessage(error, '常驻展品恢复失败'));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (record: ExhibitionModelRecord) => {
    if (!window.confirm(`移除常驻展品“${record.name}”？`)) return;
    setLoading(true);
    setMessage('');
    try {
      await deleteExhibitionModel(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      notifyExhibitionLibraryChanged();
      setMessage(`已移除：${record.name}`);
    } catch (error) {
      setMessage(exhibitionErrorMessage(error, '常驻展品移除失败'));
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!draft.id.trim() || !draft.name.trim() || !draft.modelUrl.trim()) {
      setMessage('新增展品需要填写 id、名称和 GLB 地址');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const created = await createExhibitionModel({
        id: draft.id.trim(),
        name: draft.name.trim(),
        modelUrl: draft.modelUrl.trim(),
        color: draft.color,
        position: [0, 0, 0],
        scale: 0.4,
        referenceMode: 'single',
        entryType: draft.entryType
      });
      setRecords((current) => [...current, created]);
      setSelectedId(created.id);
      setDraft(EMPTY_NEW_MODEL);
      setShowCreate(false);
      notifyExhibitionLibraryChanged();
      setMessage(`已新增：${created.name}`);
    } catch (error) {
      setMessage(exhibitionErrorMessage(error, '常驻展品新增失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="admin-exhibition" className="admin-module admin-exhibition-panel" aria-label="常驻星河展品管理">
      <header className="admin-module-head">
        <div>
          <h2>GLB 展品</h2>
          <p>独立于等级系统，保留模型原始材质和颜色。点击列表即可查看真实 3D 模型。</p>
        </div>
        <div className="admin-module-actions">
          <button className="admin-secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'admin-spin' : undefined} />刷新
          </button>
          <button className="admin-primary-button" type="button" onClick={() => setShowCreate((value) => !value)} disabled={showDeleted}>
            <Plus size={15} />新增展品
          </button>
        </div>
      </header>

      {showCreate ? (
        <div className="admin-exhibition-create">
          <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="唯一 id" aria-label="新展品 id" />
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="展品名称" aria-label="新展品名称" />
          <input value={draft.modelUrl} onChange={(event) => setDraft({ ...draft, modelUrl: event.target.value })} placeholder="/exhibition-models/model.glb" aria-label="新展品 GLB 地址" />
          <input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} aria-label="新展品标题颜色" />
          <select value={draft.entryType} onChange={(event) => setDraft({ ...draft, entryType: event.target.value as 'award' | 'contest' })} aria-label="新展品类别">
            <option value="award">获奖作品</option><option value="contest">参赛作品</option>
          </select>
          <button className="admin-primary-button" type="button" onClick={() => void create()} disabled={loading}><Plus size={15} />确认新增</button>
        </div>
      ) : null}

      <div className="admin-exhibition-toolbar">
        <label className="admin-search">
          <Search size={16} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="搜索名称、ID 或地址" />
        </label>
        <div className="admin-segmented" role="tablist" aria-label="常驻展品状态">
          <button type="button" className={!showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(false)} role="tab" aria-selected={!showDeleted}>当前展品</button>
          <button type="button" className={showDeleted ? 'is-active' : ''} onClick={() => setShowDeleted(true)} role="tab" aria-selected={showDeleted}>回收站</button>
        </div>
        <select className="admin-entry-filter" value={entryFilter} onChange={(event) => { setEntryFilter(event.target.value as typeof entryFilter); setPage(0); }} aria-label="GLB 作品类别">
          <option value="all">全部类别</option><option value="award">获奖作品</option><option value="contest">参赛作品</option>
        </select>
        <span className="admin-record-count">{filteredRecords.length} 个模型</span>
      </div>

      <div className="admin-exhibition-workspace">
        <div className="admin-exhibition-browser">
          <div className="admin-exhibition-list">
            {visibleRecords.map((record) => (
              <button
                type="button"
                className={`admin-exhibition-item ${selected?.id === record.id ? 'is-active' : ''}`}
                key={record.id}
                onClick={() => setSelectedId(record.id)}
              >
                <span className="admin-exhibition-item__icon"><Box size={18} /></span>
                <span><strong>{record.name} <em className={`admin-entry-badge admin-entry-badge--${record.entryType}`}>{record.entryType === 'contest' ? '参赛' : '获奖'}</em></strong><small>{originalGlbFilename(record.modelUrl)}</small></span>
                <i style={{ background: record.color }} aria-label={`标题颜色 ${record.color}`} />
              </button>
            ))}
            {visibleRecords.length === 0 ? <div className="admin-empty admin-empty--compact">没有匹配的 GLB 展品</div> : null}
          </div>
          <div className="admin-pagination admin-pagination--compact">
            <button type="button" onClick={() => changePage(page - 1)} disabled={page === 0}><ChevronLeft size={15} />上一页</button>
            <span>{page + 1} / {pageCount}</span>
            <button type="button" onClick={() => changePage(page + 1)} disabled={page >= pageCount - 1}>下一页<ChevronRight size={15} /></button>
          </div>
        </div>

        <div className="admin-exhibition-detail">
          {selected ? (
            <>
              <Suspense fallback={<div className="admin-glb-preview admin-glb-preview--loading">正在加载 3D 预览…</div>}>
                <AdminGlbPreview key={selected.modelUrl} modelUrl={selected.modelUrl} name={selected.name} />
              </Suspense>
              <div className="admin-exhibition-editor">
                <div className="admin-exhibition-editor__title">
                  <div><h3>{selected.name}</h3><span>{selected.id}</span></div>
                  <div className="admin-module-actions">
                    {showDeleted ? (
                      <button className="admin-secondary-button" type="button" onClick={() => void restore(selected)} disabled={loading}><ArchiveRestore size={15} />恢复</button>
                    ) : (
                      <>
                        <button className="admin-danger-button" type="button" onClick={() => void remove(selected)} disabled={loading}><Trash2 size={15} />移除</button>
                        <button className="admin-primary-button" type="button" onClick={() => void save(selected)} disabled={loading}><Save size={15} />保存</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="admin-exhibition-fields">
                  <label><span>展品名称</span><input value={selected.name} disabled={showDeleted} onChange={(event) => patchLocal(selected.id, { name: event.target.value })} /></label>
                  <label><span>模型缩放</span><input type="number" min="0.1" max="3" step="0.01" value={selected.scale} disabled={showDeleted} onChange={(event) => patchLocal(selected.id, { scale: Number(event.target.value) || 0.4 })} /></label>
                  <label className="admin-field-wide"><span>GLB 地址</span><input value={selected.modelUrl} disabled={showDeleted} onChange={(event) => patchLocal(selected.id, { modelUrl: event.target.value })} /></label>
                  <label className="admin-field-wide"><span>原始 GLB 文件名（修改文件时按此名称查找）</span><input value={originalGlbFilename(selected.modelUrl)} readOnly /></label>
                  <label><span>标题颜色</span><div className="admin-color-field"><input type="color" value={selected.color} disabled={showDeleted} onChange={(event) => patchLocal(selected.id, { color: event.target.value })} /><code>{selected.color}</code></div></label>
                  <label><span>展品属性</span><input value="永久漂浮 · 不参与等级" readOnly /></label>
                  <label><span>作品类别</span><select value={selected.entryType} disabled={showDeleted} onChange={(event) => patchLocal(selected.id, { entryType: event.target.value as 'award' | 'contest' })}><option value="award">获奖作品</option><option value="contest">参赛作品</option></select></label>
                </div>
              </div>
            </>
          ) : <div className="admin-empty">选择一个展品查看 3D 模型</div>}
        </div>
      </div>
      {message ? <p className="admin-inline-message">{message}</p> : null}
    </section>
  );
}
