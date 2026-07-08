import {
  ArrowLeft,
  Database,
  ExternalLink,
  FileJson,
  Image,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteBackendArtwork,
  deleteBackendArtworkRecord,
  type BackendArtworkStatus,
  fetchBackendArtworkPage,
  patchBackendArtworkRecord,
  restoreBackendArtwork
} from '../../lib/artwork/backendArtworkLibrary';
import type { BackendArtworkRecord } from '../../stores/artworkStore';
import './admin.css';

const PAGE_SIZE = 20;

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatMB(record: BackendArtworkRecord) {
  const count = record.gaussianCount ?? record.gaussianModel?.gaussianCount;
  if (!count) return '-';
  return `${Math.round(count / 1000)}k`;
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonField(value: string, field: string) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    throw new Error(`${field} JSON 格式不正确`);
  }
}

export function ArtworkAdminPage() {
  const [records, setRecords] = useState<BackendArtworkRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<BackendArtworkStatus>('active');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftFeatures, setDraftFeatures] = useState('{}');
  const [draftGaussian, setDraftGaussian] = useState('{}');

  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? records[0] ?? null,
    [records, selectedId]
  );

  const filteredRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) => {
      return [
        record.id,
        record.name,
        record.splatUrl,
        record.features?.motionPreset
      ].some((value) => String(value ?? '').toLowerCase().includes(keyword));
    });
  }, [query, records]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, page * PAGE_SIZE + records.length);
  const pageOptions = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index),
    [totalPages]
  );
  const selectedCount = selectedIds.size;
  const isDeletedView = status === 'deleted';
  const allVisibleSelected = filteredRecords.length > 0
    && filteredRecords.every((record) => selectedIds.has(record.id));

  const loadRecords = async (targetPage = page, targetStatus = status) => {
    setIsLoading(true);
    setMessage('');
    try {
      const result = await fetchBackendArtworkPage(PAGE_SIZE, targetPage * PAGE_SIZE, targetStatus);
      const nextRecords = result.records;
      setRecords(nextRecords);
      setTotal(result.total);
      setSelectedIds((current) => new Set(
        [...current].filter((id) => nextRecords.some((record) => record.id === id))
      ));
      setSelectedId((current) => current && nextRecords.some((record) => record.id === current)
        ? current
        : nextRecords[0]?.id ?? null);
      setMessage(`已载入第 ${targetPage + 1} 页，共 ${result.total} 条${targetStatus === 'deleted' ? '已移除' : '当前'}作品记录`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRecordSelection = (recordId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        filteredRecords.forEach((record) => next.delete(record.id));
      } else {
        filteredRecords.forEach((record) => next.add(record.id));
      }
      return next;
    });
  };

  useEffect(() => {
    void loadRecords(page, status);
  }, [page, status]);

  useEffect(() => {
    if (!selected) {
      setDraftName('');
      setDraftFeatures('{}');
      setDraftGaussian('{}');
      return;
    }
    setDraftName(selected.name ?? selected.id);
    setDraftFeatures(prettyJson(selected.features));
    setDraftGaussian(prettyJson(selected.gaussianModel));
  }, [selected]);

  const saveSelected = async () => {
    if (!selected) return;
    setMessage('');
    try {
      const features = parseJsonField(draftFeatures, 'Features');
      const gaussianModel = parseJsonField(draftGaussian, 'Gaussian');
      await patchBackendArtworkRecord(selected.id, {
        name: draftName.trim() || selected.id,
        width: selected.width ?? null,
        height: selected.height ?? null,
        aspect: selected.aspect ?? null,
        features,
        gaussianModel
      });
      setMessage('保存成功');
      await loadRecords(page);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  const changeStatus = (nextStatus: BackendArtworkStatus) => {
    setStatus(nextStatus);
    setSelectedIds(new Set());
    setSelectedId(null);
    setRecords([]);
    setQuery('');
    if (page !== 0) {
      setPage(0);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`从前端页面移除 ${selected.name ?? selected.id}？模型文件会保留，可在“已移除”中恢复。`);
    if (!confirmed) return;

    setMessage('');
    try {
      await deleteBackendArtwork(selected.id);
      setMessage('已从前端页面移除，模型文件已保留');
      const nextPage = records.length <= 1 && page > 0 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadRecords(nextPage);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移除失败');
    }
  };

  const restoreSelected = async () => {
    if (!selected) return;
    setMessage('');
    try {
      await restoreBackendArtwork(selected.id);
      setMessage('已恢复到前端页面');
      const nextPage = records.length <= 1 && page > 0 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadRecords(nextPage, status);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    }
  };

  const deleteSelectedRecord = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`彻底删除 ${selected.name ?? selected.id}？这会同时删除数据库记录和本地模型文件，无法恢复。`);
    if (!confirmed) return;

    setMessage('');
    try {
      await deleteBackendArtworkRecord(selected.id);
      setMessage('已彻底删除数据库记录和模型文件');
      const nextPage = records.length <= 1 && page > 0 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadRecords(nextPage, status);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '彻底删除失败');
    }
  };

  const runSelectedBatchAction = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const confirmed = window.confirm(isDeletedView
      ? `批量恢复 ${ids.length} 个作品到前端页面？`
      : `批量从前端页面移除 ${ids.length} 个作品？模型文件会保留，可恢复。`);
    if (!confirmed) return;

    setMessage('');
    setIsLoading(true);
    try {
      await Promise.all(ids.map((id) => isDeletedView ? restoreBackendArtwork(id) : deleteBackendArtwork(id)));
      setSelectedIds(new Set());
      setMessage(isDeletedView ? `已恢复 ${ids.length} 个作品` : `已移除 ${ids.length} 个作品`);
      const nextPage = records.length <= ids.length && page > 0 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadRecords(nextPage, status);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isDeletedView ? '批量恢复失败' : '批量移除失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <Database size={22} />
          <div>
            <h1>作品数据管理</h1>
            <span>SQLite / TripoSplat Library</span>
          </div>
        </div>
        <nav className="admin-actions">
          <a className="admin-icon-button" href="/" title="返回星河">
            <ArrowLeft size={18} />
          </a>
          <button className="admin-icon-button" type="button" onClick={() => loadRecords(page)} disabled={isLoading} title="刷新">
            <RefreshCw size={18} />
          </button>
        </nav>
      </header>

      <section className="admin-metrics" aria-label="数据概览">
        <div>
          <span>{isDeletedView ? '已移除作品' : '当前作品'}</span>
          <strong>{total}</strong>
        </div>
        <div>
          <span>本页 Splat</span>
          <strong>{records.filter((record) => record.splatUrl || record.gaussianModel?.splatUrl).length}</strong>
        </div>
        <div>
          <span>本页已识别动作</span>
          <strong>{records.filter((record) => record.features?.motionPreset).length}</strong>
        </div>
      </section>

      <section className="admin-workspace">
        <aside className="admin-list-pane">
          <label className="admin-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称 / ID / 动作"
            />
          </label>

          <div className="admin-status-tabs" role="tablist" aria-label="作品状态">
            <button
              type="button"
              className={status === 'active' ? 'is-active' : ''}
              onClick={() => changeStatus('active')}
              role="tab"
              aria-selected={status === 'active'}
            >
              当前作品
            </button>
            <button
              type="button"
              className={status === 'deleted' ? 'is-active' : ''}
              onClick={() => changeStatus('deleted')}
              role="tab"
              aria-selected={status === 'deleted'}
            >
              已移除
            </button>
          </div>

          <div className="admin-bulkbar">
            <label>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisibleSelection}
                disabled={filteredRecords.length === 0}
              />
              当前页
            </label>
            <span>已选 {selectedCount}</span>
            <button type="button" onClick={runSelectedBatchAction} disabled={selectedCount === 0 || isLoading}>
              {isDeletedView ? '批量恢复' : '批量移除'}
            </button>
          </div>

          <div className="admin-record-list">
            {filteredRecords.map((record) => (
              <div
                key={record.id}
                className={`admin-record ${selected?.id === record.id ? 'is-active' : ''} ${selectedIds.has(record.id) ? 'is-checked' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(record.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(record.id);
                  }
                }}
              >
                <span
                  className="admin-record__check"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(record.id)}
                    onChange={() => toggleRecordSelection(record.id)}
                    aria-label={`选择 ${record.name ?? record.id}`}
                  />
                </span>
                <span className="admin-record__thumb">
                  {record.previewUrl ? <img src={record.previewUrl} alt="" /> : <Image size={18} />}
                </span>
                <span className="admin-record__body">
                  <strong>{record.name ?? record.id}</strong>
                  <em>{record.features?.motionPreset ?? 'spiritFloat'} · {formatMB(record)}</em>
                </span>
              </div>
            ))}
          </div>
          <div className="admin-pagination">
            <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page <= 0 || isLoading}>
              上一页
            </button>
            <select
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
              aria-label="选择页码"
            >
              {pageOptions.map((value) => (
                <option key={value} value={value}>
                  第 {value + 1} 页
                </option>
              ))}
            </select>
            <span>{pageStart}-{pageEnd} / {total}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} disabled={page >= totalPages - 1 || isLoading}>
              下一页
            </button>
          </div>
        </aside>

        <section className="admin-detail-pane">
          {selected ? (
            <>
              <div className="admin-detail-head">
                <div>
                  <span className="admin-eyebrow">{selected.id}</span>
                  <h2>{selected.name ?? selected.id}</h2>
                </div>
                <div className="admin-detail-actions">
                  {selected.splatUrl ? (
                    <a className="admin-icon-button" href={selected.splatUrl} target="_blank" rel="noreferrer" title="打开 .splat">
                      <ExternalLink size={18} />
                    </a>
                  ) : null}
                  {isDeletedView ? (
                    <>
                      <button className="admin-icon-button admin-icon-button--restore" type="button" onClick={restoreSelected} title="恢复">
                        <RotateCcw size={18} />
                      </button>
                      <button className="admin-icon-button admin-icon-button--danger" type="button" onClick={deleteSelectedRecord} title="彻底删除">
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <button className="admin-icon-button admin-icon-button--danger" type="button" onClick={deleteSelected} title="移除">
                      <Trash2 size={18} />
                    </button>
                  )}
                  <button className="admin-save" type="button" onClick={saveSelected}>
                    <Save size={17} />
                    保存
                  </button>
                </div>
              </div>

              <div className="admin-form-grid">
                <label className="admin-field">
                  <span>名称</span>
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                </label>
                <label className="admin-field">
                  <span>创建时间</span>
                  <input value={formatDate(selected.createdAt)} readOnly />
                </label>
                {isDeletedView ? (
                  <label className="admin-field">
                    <span>移除时间</span>
                    <input value={formatDate(selected.deletedAt)} readOnly />
                  </label>
                ) : null}
                <label className="admin-field">
                  <span>Gaussian Count</span>
                  <input value={selected.gaussianCount ?? selected.gaussianModel?.gaussianCount ?? '-'} readOnly />
                </label>
                <label className="admin-field">
                  <span>资源</span>
                  <input value={selected.splatUrl ?? selected.plyUrl ?? '-'} readOnly />
                </label>
              </div>

              <div className="admin-editor-grid">
                <label className="admin-json-field">
                  <span><FileJson size={16} /> Features</span>
                  <textarea value={draftFeatures} onChange={(event) => setDraftFeatures(event.target.value)} />
                </label>
                <label className="admin-json-field">
                  <span><FileJson size={16} /> Gaussian Model</span>
                  <textarea value={draftGaussian} onChange={(event) => setDraftGaussian(event.target.value)} />
                </label>
              </div>
            </>
          ) : (
            <div className="admin-empty">暂无作品记录</div>
          )}
        </section>
      </section>

      {message ? <div className="admin-toast">{message}</div> : null}
    </main>
  );
}
