import {
  Activity,
  ArrowLeft,
  Box,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  ExternalLink,
  Eye,
  FileJson,
  Image,
  LayoutDashboard,
  Library,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Trash2
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';
import {
  deleteBackendArtwork,
  deleteBackendArtworkRecord,
  type BackendArtworkStatus,
  fetchBackendArtworkPage,
  patchBackendArtworkRecord,
  restoreBackendArtwork
} from '../../lib/artwork/backendArtworkLibrary';
import { type BackendArtworkRecord, useArtworkStore } from '../../stores/artworkStore';
import { experienceRequiredForLevel } from '../webgl/creatureEvolutionMath';
import { fetchSubmissionMetrics, type SubmissionMetrics } from '../../lib/artwork/submissionMetrics';
import './admin.css';
import { ExhibitionModelAdminPanel } from './ExhibitionModelAdminPanel';
import { SubmissionMetricsPanel } from './SubmissionMetricsPanel';
import { AdminSystemPanel } from './AdminSystemPanel';
import { DesignerReviewQueue } from './DesignerReviewQueue';

const AdminArtworkPreviewModal = lazy(() => import('./AdminArtworkPreviewModal').then((module) => ({
  default: module.AdminArtworkPreviewModal
})));

const PAGE_SIZE = 20;
const ARTWORK_LIBRARY_CHANGED_EVENT = 'artwork-library-changed';

type AdminSection = 'overview' | 'artworks' | 'designer' | 'exhibition' | 'submissions' | 'system';

const ADMIN_SECTIONS: Array<{
  id: AdminSection;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: '总览', description: '运营概况', icon: LayoutDashboard },
  { id: 'artworks', label: '作品库', description: 'Splat 与成长数据', icon: Library },
  { id: 'designer', label: '模型审核', description: '生成状态与入星河审核', icon: ClipboardCheck },
  { id: 'exhibition', label: 'GLB 展品', description: '预览与增删改查', icon: Box },
  { id: 'submissions', label: '提交监控', description: '耗时、成功率与流量', icon: Activity },
  { id: 'system', label: '系统状态', description: '服务和加载策略', icon: Server }
];

const ADMIN_TIME_ZONE = 'Asia/Shanghai';
const ADMIN_DATE_QUERY_KEY = 'chartDate';
const ADMIN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const ADMIN_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: ADMIN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function todayInAdminTimeZone() {
  return ADMIN_DATE_FORMATTER.format(new Date());
}

function initialOverviewDate() {
  if (typeof window === 'undefined') return todayInAdminTimeZone();
  const value = new URLSearchParams(window.location.search).get(ADMIN_DATE_QUERY_KEY) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayInAdminTimeZone();
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function MinuteUploadChart({
  points,
  selectedDate
}: {
  points: Array<{ timestamp: string; count: number }>;
  selectedDate: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const height = 284;
  const padding = { top: 22, right: 24, bottom: 44, left: 12 };
  const width = Math.max(720, (Math.max(1, points.length - 1) * 4) + padding.left + padding.right);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const yTicks = maxCount > 1 ? [maxCount, Math.ceil(maxCount / 2), 0] : [1, 0];
  const xFor = (index: number) => padding.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (count: number) => padding.top + plotHeight - (count / maxCount) * plotHeight;
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point.count).toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L ${xFor(points.length - 1).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} L ${xFor(0).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`
    : '';
  const xTickIndices = points.length > 1
    ? Array.from(new Set([
      ...Array.from({ length: 12 }, (_, index) => index * 120),
      points.length - 1
    ])).filter((index) => index < points.length)
    : [0];

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || points.length === 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (selectedDate !== todayInAdminTimeZone()) {
        scroller.scrollLeft = 0;
        return;
      }
      const timeParts = ADMIN_TIME_FORMATTER.formatToParts(new Date());
      const hour = Number(timeParts.find((part) => part.type === 'hour')?.value ?? 0);
      const minute = Number(timeParts.find((part) => part.type === 'minute')?.value ?? 0);
      const currentMinuteIndex = Math.min(points.length - 1, hour * 60 + minute);
      scroller.scrollLeft = Math.max(0, xFor(currentMinuteIndex) - scroller.clientWidth * 0.72);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [points.length, selectedDate]);

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.pointerId = -1;
    setIsDragging(false);
  };

  const nonZeroPoints = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.count > 0);

  if (!points.length) {
    return <div className="admin-chart-empty">暂无分钟上传数据</div>;
  }

  return (
    <div className="admin-line-chart-layout">
      <svg className="admin-line-chart-axis" viewBox={`0 0 54 ${height}`} aria-hidden="true">
        {yTicks.map((value) => {
          const y = yFor(value);
          return (
            <g key={value}>
              <line x1={46} x2={54} y1={y} y2={y} className="admin-chart-gridline" />
              <text x={40} y={y + 4} textAnchor="end" className="admin-chart-axis-label">{value}</text>
            </g>
          );
        })}
        <text x={4} y={13} className="admin-chart-axis-title">人数</text>
      </svg>
      <div
        ref={scrollerRef}
        className={`admin-line-chart-scroll${isDragging ? ' is-dragging' : ''}`}
        role="region"
        tabIndex={0}
        aria-label={`${selectedDate} 全天每分钟上传人数，可左右拖动查看`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startScrollLeft: event.currentTarget.scrollLeft
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsDragging(true);
        }}
        onPointerMove={(event) => {
          if (dragRef.current.pointerId !== event.pointerId) return;
          event.currentTarget.scrollLeft = dragRef.current.startScrollLeft
            - (event.clientX - dragRef.current.startX);
        }}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.currentTarget.scrollBy({
            left: event.key === 'ArrowLeft' ? -240 : 240,
            behavior: 'smooth'
          });
        }}
      >
        <svg
          className="admin-line-chart"
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${width}px`, height: `${height}px` }}
          role="img"
          aria-label={`${selectedDate} 全天每分钟上传人数折线图`}
        >
          <title>{selectedDate} 全天每分钟上传人数</title>
          {yTicks.map((value) => {
            const y = yFor(value);
            return <line key={value} x1={0} x2={width} y1={y} y2={y} className="admin-chart-gridline" />;
          })}
          <path d={areaPath} className="admin-chart-area" />
          <path d={linePath} className="admin-chart-line" />
          {nonZeroPoints.map(({ point, index }) => (
            <circle key={point.timestamp} cx={xFor(index)} cy={yFor(point.count)} r={3.2} className="admin-chart-point">
              <title>{`${ADMIN_TIME_FORMATTER.format(new Date(point.timestamp))} · ${point.count} 人`}</title>
            </circle>
          ))}
          {xTickIndices.map((index) => (
            <g key={`${points[index]?.timestamp}-${index}`}>
              <line x1={xFor(index)} x2={xFor(index)} y1={padding.top} y2={padding.top + plotHeight} className="admin-chart-time-gridline" />
              <text
                x={xFor(index)}
                y={height - 14}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                className="admin-chart-axis-label"
              >
                {ADMIN_TIME_FORMATTER.format(new Date(points[index].timestamp))}
              </text>
            </g>
          ))}
          <text x={width - padding.right} y={height - 1} textAnchor="end" className="admin-chart-axis-title">时间</text>
        </svg>
      </div>
    </div>
  );
}

function notifyArtworkLibraryChanged() {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(ARTWORK_LIBRARY_CHANGED_EVENT);
    channel.postMessage({ changedAt: Date.now() });
    channel.close();
  }
  localStorage.setItem(ARTWORK_LIBRARY_CHANGED_EVENT, String(Date.now()));
}

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

export function ArtworkAdminPage({ onLogout }: { onLogout?: () => void }) {
  const removeArtwork = useArtworkStore((store) => store.removeArtwork);
  const upsertBackendArtwork = useArtworkStore((store) => store.upsertBackendArtwork);
  const [section, setSection] = useState<AdminSection>('overview');
  const [overviewMetrics, setOverviewMetrics] = useState<SubmissionMetrics | null>(null);
  const [overviewDate, setOverviewDate] = useState(initialOverviewDate);
  const [records, setRecords] = useState<BackendArtworkRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<BackendArtworkStatus>('active');
  const [sortByLevel, setSortByLevel] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftFeatures, setDraftFeatures] = useState('{}');
  const [draftGaussian, setDraftGaussian] = useState('{}');
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null);

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
  const availableOverviewDates = overviewMetrics?.daily?.availableDates ?? [];
  const earliestOverviewDate = availableOverviewDates[availableOverviewDates.length - 1];
  const latestOverviewDate = todayInAdminTimeZone();
  const allVisibleSelected = filteredRecords.length > 0
    && filteredRecords.every((record) => selectedIds.has(record.id));

  const loadRecords = async (
    targetPage = page,
    targetStatus = status,
    targetSortByLevel = sortByLevel
  ) => {
    setIsLoading(true);
    setMessage('');
    try {
      const result = await fetchBackendArtworkPage(
        PAGE_SIZE,
        targetPage * PAGE_SIZE,
        targetStatus,
        targetSortByLevel ? 'level_desc' : 'created_desc'
      );
      const nextRecords = result.records;
      setRecords(nextRecords);
      setTotal(result.total);
      setSelectedIds((current) => new Set(
        [...current].filter((id) => nextRecords.some((record) => record.id === id))
      ));
      setSelectedId((current) => current && nextRecords.some((record) => record.id === current)
        ? current
        : nextRecords[0]?.id ?? null);
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

  const changeOverviewDate = (nextDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    setOverviewDate(nextDate);
    const url = new URL(window.location.href);
    url.searchParams.set(ADMIN_DATE_QUERY_KEY, nextDate);
    window.history.pushState({}, '', url);
  };

  useEffect(() => {
    void loadRecords(page, status, sortByLevel);
  }, [page, status, sortByLevel]);

  useEffect(() => {
    const handlePopState = () => setOverviewDate(initialOverviewDate());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (section !== 'overview') return;
    let cancelled = false;
    const loadOverviewMetrics = async () => {
      try {
        const nextMetrics = await fetchSubmissionMetrics(24, 1, overviewDate);
        if (!cancelled) setOverviewMetrics(nextMetrics);
      } catch {
        if (!cancelled) setOverviewMetrics(null);
      }
    };
    void loadOverviewMetrics();
    const timer = window.setInterval(() => void loadOverviewMetrics(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [overviewDate, section]);

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

  const toggleLevelSort = () => {
    setSortByLevel((current) => !current);
    setSelectedIds(new Set());
    setSelectedId(null);
    setRecords([]);
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
      removeArtwork(selected.id);
      notifyArtworkLibraryChanged();
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
      upsertBackendArtwork({ ...selected, isDeleted: false, deletedAt: null });
      notifyArtworkLibraryChanged();
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
      removeArtwork(selected.id);
      notifyArtworkLibraryChanged();
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
      if (isDeletedView) {
        const selectedRecords = records.filter((record) => selectedIds.has(record.id));
        selectedRecords.forEach((record) => upsertBackendArtwork({ ...record, isDeleted: false, deletedAt: null }));
      } else {
        ids.forEach(removeArtwork);
      }
      notifyArtworkLibraryChanged();
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

  const runSelectedPermanentDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const confirmed = window.confirm(`彻底删除 ${ids.length} 个作品？这会同时删除数据库记录和本地模型文件，无法恢复。`);
    if (!confirmed) return;

    setMessage('');
    setIsLoading(true);
    try {
      await Promise.all(ids.map((id) => deleteBackendArtworkRecord(id)));
      ids.forEach(removeArtwork);
      notifyArtworkLibraryChanged();
      setSelectedIds(new Set());
      setMessage(`已彻底删除 ${ids.length} 个作品`);
      const nextPage = records.length <= ids.length && page > 0 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadRecords(nextPage, status);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量彻底删除失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span><Database size={22} /></span>
          <div><strong>星河管理中心</strong><small>Cosmos Console</small></div>
        </div>
        <nav className="admin-sidebar-nav" aria-label="后台栏目">
          {ADMIN_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}>
                <Icon size={19} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            );
          })}
        </nav>
        <a className="admin-sidebar-back" href="/"><ArrowLeft size={17} />返回星河</a>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-brand">
            <div>
              <h1>{ADMIN_SECTIONS.find((item) => item.id === section)?.label}</h1>
              <span>{ADMIN_SECTIONS.find((item) => item.id === section)?.description}</span>
            </div>
          </div>
          <nav className="admin-actions">
            <span className="admin-live-indicator"><i />管理服务</span>
            <button className="admin-icon-button" type="button" onClick={() => loadRecords(page)} disabled={isLoading} title="刷新作品数据">
              <RefreshCw size={18} />
            </button>
            <button className="admin-secondary-button admin-logout-button" type="button" onClick={onLogout} title="退出后台登录">
              <LogOut size={16} />退出
            </button>
          </nav>
        </header>

      {section === 'overview' ? (
        <section className="admin-overview" aria-label="后台控制中心">
          <div className="admin-overview-title">
            <h2>星河运营台</h2>
          </div>
          <div className="admin-overview-metrics" aria-label="用户上传统计">
            <div>
              <span>用户上传模型总数</span>
              <strong>{overviewMetrics?.summary.totalUploadedModels?.toLocaleString() ?? '—'}</strong>
            </div>
            <div>
              <span>当前每分钟上传人数</span>
              <strong>{overviewMetrics?.summary.usersLastMinute?.toLocaleString() ?? '—'}</strong>
            </div>
          </div>
          <section className="admin-overview-chart-card" aria-label="每分钟上传人数趋势">
            <div className="admin-overview-chart-head">
              <div>
                <h3>全天每分钟上传人数</h3>
                <small>
                  {overviewMetrics?.daily
                    ? `${overviewMetrics.daily.totalUploads} 次上传 · ${overviewMetrics.daily.uniqueUsers} 位用户 · 数据永久保存在服务器`
                    : '正在读取全天历史数据…'}
                </small>
              </div>
              <div className="admin-overview-chart-controls">
                <button
                  type="button"
                  aria-label="查看前一天"
                  title="前一天"
                  disabled={Boolean(earliestOverviewDate && overviewDate <= earliestOverviewDate)}
                  onClick={() => changeOverviewDate(shiftDateKey(overviewDate, -1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <label>
                  <CalendarDays size={16} aria-hidden="true" />
                  <span className="sr-only">选择统计日期</span>
                  <input
                    type="date"
                    value={overviewDate}
                    min={earliestOverviewDate}
                    max={latestOverviewDate}
                    list="admin-overview-available-dates"
                    onChange={(event) => changeOverviewDate(event.target.value)}
                  />
                </label>
                <datalist id="admin-overview-available-dates">
                  {availableOverviewDates.map((date) => <option key={date} value={date} />)}
                </datalist>
                <button
                  type="button"
                  aria-label="查看后一天"
                  title="后一天"
                  disabled={overviewDate >= latestOverviewDate}
                  onClick={() => changeOverviewDate(shiftDateKey(overviewDate, 1))}
                >
                  <ChevronRight size={16} />
                </button>
                {overviewDate !== latestOverviewDate ? (
                  <button type="button" className="admin-chart-today" onClick={() => changeOverviewDate(latestOverviewDate)}>
                    今天
                  </button>
                ) : null}
              </div>
            </div>
            <MinuteUploadChart points={overviewMetrics?.minuteUsers ?? []} selectedDate={overviewDate} />
            <p className="admin-chart-drag-hint">拖动图表或使用底部滚动条查看全天 00:00–23:59；键盘可用左右方向键。</p>
          </section>
        </section>
      ) : null}

      {section === 'exhibition' ? <ExhibitionModelAdminPanel /> : null}
      {section === 'designer' ? <DesignerReviewQueue /> : null}
      {section === 'submissions' ? <SubmissionMetricsPanel /> : null}
      {section === 'system' ? <AdminSystemPanel /> : null}

      {section === 'artworks' ? <section className="admin-workspace">
        <aside className="admin-list-pane">
          <div className="admin-list-tools">
            <label className="admin-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称 / ID / 动作"
              />
            </label>
            <button
              className={`admin-sort-button ${sortByLevel ? 'is-active' : ''}`}
              type="button"
              onClick={toggleLevelSort}
              aria-pressed={sortByLevel}
              title="按等级从高到低排序"
            >
              等级降序
            </button>
          </div>

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
            {isDeletedView ? (
              <button
                className="admin-bulkbar__danger"
                type="button"
                onClick={runSelectedPermanentDelete}
                disabled={selectedCount === 0 || isLoading}
              >
                彻底删除
              </button>
            ) : null}
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
                  <em>
                    LV {record.evolution?.level ?? 0} · {record.features?.motionPreset ?? 'spiritFloat'} · {formatMB(record)}
                  </em>
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
                  {(selected.splatUrl ?? selected.gaussianModel?.splatUrl) ? (
                    <button
                      className="admin-secondary-button"
                      type="button"
                      title="预览 3D 模型"
                      onClick={() => setPreviewRecordId(selected.id)}
                    >
                      <Eye size={17} />预览模型
                    </button>
                  ) : null}
                  {selected.splatUrl ? (
                    <a className="admin-icon-button" href={selected.splatUrl} target="_blank" rel="noreferrer" title="打开模型">
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

              <section className="admin-evolution" aria-label="模型成长信息">
                <div className="admin-evolution__head">
                  <div>
                    <span>模型成长</span>
                    <strong>LV {selected.evolution?.level ?? 0}</strong>
                  </div>
                  <small>最近同步：{formatDate(selected.evolution?.updatedAt)}</small>
                </div>
                <div className="admin-evolution__progress" aria-label="升级进度">
                  <span style={{
                    width: `${Math.min(
                      100,
                      ((selected.evolution?.experience ?? 0)
                        / experienceRequiredForLevel(selected.evolution?.level ?? 0)) * 100
                    )}%`
                  }} />
                </div>
                <div className="admin-evolution__stats">
                  <div><span>当前经验</span><strong>{Math.round(selected.evolution?.experience ?? 0)} / {experienceRequiredForLevel(selected.evolution?.level ?? 0)}</strong></div>
                  <div><span>获胜次数</span><strong>{selected.evolution?.victories ?? 0}</strong></div>
                  <div><span>失败次数</span><strong>{selected.evolution?.defeats ?? 0}</strong></div>
                  <div><span>星球困住</span><strong>{selected.evolution?.planetTraps ?? 0}</strong></div>
                  <div><span>数据版本</span><strong>#{selected.evolution?.revision ?? 0}</strong></div>
                </div>
              </section>

              <section className="admin-model-downloads" aria-label="模型文件下载">
                <div className="admin-model-downloads__head">
                  <h3>模型文件</h3>
                </div>
                <div className="admin-model-downloads__list">
                  {(selected.splatUrl ?? selected.gaussianModel?.splatUrl) ? (
                    <a href={selected.splatUrl ?? selected.gaussianModel?.splatUrl} target="_blank" rel="noreferrer">
                      <span><ExternalLink size={15} />主模型</span>
                      <code>3D 模型文件</code>
                    </a>
                  ) : null}
                </div>
              </section>

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
      </section> : null}

      {message ? <div className="admin-toast">{message}</div> : null}
      {previewRecordId && selected?.id === previewRecordId && (selected.splatUrl ?? selected.gaussianModel?.splatUrl) ? (
        <Suspense fallback={null}>
          <AdminArtworkPreviewModal
            name={selected.name ?? selected.id}
            splatUrl={(selected.splatUrl ?? selected.gaussianModel?.splatUrl)!}
            features={selected.features}
            onClose={() => setPreviewRecordId(null)}
          />
        </Suspense>
      ) : null}
      </div>
    </main>
  );
}
