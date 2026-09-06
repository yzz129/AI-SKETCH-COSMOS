import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  IdCard,
  MapPin,
  Phone,
  Timer,
  RefreshCw,
  Search,
  Smartphone,
  Upload,
  UserRound,
  Users
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  fetchSubmissionMetrics,
  fetchSubmissionUserDetail,
  fetchSubmissionUsers,
  type SubmissionMetrics,
  type SubmissionTelemetryRow,
  type SubmissionUserDetail,
  type SubmissionUserSummary
} from '../../lib/artwork/submissionMetrics';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(milliseconds?: number | null) {
  if (!Number.isFinite(milliseconds ?? NaN)) return '—';
  const seconds = (milliseconds ?? 0) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function statusLabel(row: SubmissionTelemetryRow) {
  if (row.status === 'ready') return row.channel === 'designer' ? '已入星河' : '成功';
  if (row.status === 'review') return '待后台审核';
  if (row.status === 'cancelled') return '已撤销';
  if (row.status === 'failed') return '失败';
  if (row.status === 'processing') return '生成中';
  return '排队中';
}

function telemetryErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '提交统计加载失败';
  return message.includes('404')
    ? '后台统计接口尚未重启（404），请重启 AI Sketch Cosmos Dev Watchdog 后刷新。'
    : message;
}

function deviceLabel(userAgent?: string | null) {
  if (!userAgent) return '历史数据未记录';
  const browser = /MicroMessenger/i.test(userAgent) ? '微信'
    : /Edg/i.test(userAgent) ? 'Edge'
      : /Chrome/i.test(userAgent) ? 'Chrome'
        : /Safari/i.test(userAgent) ? 'Safari' : '其他浏览器';
  const device = /iPhone|iPad/i.test(userAgent) ? 'iOS'
    : /Android/i.test(userAgent) ? 'Android'
      : /Windows/i.test(userAgent) ? 'Windows' : '其他设备';
  return `${device} · ${browser}`;
}

function profileValue(value?: string | null) {
  return value?.trim() || '未提供';
}

export function SubmissionMetricsPanel() {
  const [windowHours, setWindowHours] = useState(24);
  const [metrics, setMetrics] = useState<SubmissionMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const deferredUserQuery = useDeferredValue(userQuery);
  const [users, setUsers] = useState<SubmissionUserSummary[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [selectedUserKey, setSelectedUserKey] = useState('');
  const [selectedUser, setSelectedUser] = useState<SubmissionUserDetail | null>(null);
  const [userLoading, setUserLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [nextMetrics, nextUsers] = await Promise.all([
        fetchSubmissionMetrics(windowHours, 100),
        fetchSubmissionUsers(deferredUserQuery, 60)
      ]);
      setMetrics(nextMetrics);
      setUsers(nextUsers.users);
      setUserTotal(nextUsers.total);
      setSelectedUserKey((current) => (
        current && nextUsers.users.every((user) => user.userKey !== current) ? '' : current
      ));
    } catch (error) {
      setMessage(telemetryErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [deferredUserQuery, windowHours]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selectedUserKey) {
      setSelectedUser(null);
      return;
    }
    let cancelled = false;
    setUserLoading(true);
    void fetchSubmissionUserDetail(selectedUserKey)
      .then((detail) => {
        if (!cancelled) setSelectedUser(detail);
      })
      .catch((error) => {
        if (!cancelled) setMessage(telemetryErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setUserLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedUserKey]);

  const chartMax = useMemo(
    () => Math.max(1, ...(metrics?.hourly.map((item) => item.count) ?? [])),
    [metrics?.hourly]
  );
  const summary = metrics?.summary;
  const queue = metrics?.queue;
  const totalTraffic = (summary?.inputBytes ?? 0) + (summary?.outputBytes ?? 0);
  const trafficPerSubmission = summary?.submissions ? totalTraffic / summary.submissions : 0;
  const submitChannel = metrics?.channels?.submit;
  const designerChannel = metrics?.channels?.designer;

  return (
    <section id="admin-telemetry" className="admin-module admin-telemetry-panel" aria-label="提交与流量监控">
      <div className="admin-telemetry-head">
        <div>
          <span className="admin-eyebrow">SUBMISSION PULSE</span>
          <h2>提交与生成监控</h2>
          <p>实时观察用户提交、生成成功率、耗时和模型流量；数据按时间窗口汇总。</p>
        </div>
        <div className="admin-telemetry-actions">
          <select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value))} aria-label="统计时间窗口">
            <option value={24}>最近 24 小时</option>
            <option value={72}>最近 3 天</option>
            <option value={168}>最近 7 天</option>
          </select>
          <button className="admin-icon-button" type="button" onClick={() => void load()} disabled={loading} title="刷新统计">
            <RefreshCw size={16} className={loading ? 'admin-spin' : undefined} />
          </button>
        </div>
      </div>

      {message ? <div className="admin-telemetry-message"><AlertTriangle size={16} />{message}</div> : null}

      <div className="admin-telemetry-cards">
        <div className="admin-telemetry-card admin-telemetry-card--mint">
          <span><Users size={16} />用户 / 提交次数</span>
          <strong>{summary ? `${summary.uniqueClients} / ${summary.submissions}` : '—'}</strong>
          <small>{summary ? `${summary.successes} 次成功，${summary.failures} 次失败，${summary.pending} 次进行中` : '等待数据'}</small>
          <small>{summary ? `已识别 ${summary.identifiedUsers ?? 0} 位真实用户` : ''}</small>
        </div>
        <div className="admin-telemetry-card admin-telemetry-card--blue">
          <span><CheckCircle2 size={16} />生成成功率</span>
          <strong>{summary?.successRate == null ? '—' : `${(summary.successRate * 100).toFixed(1)}%`}</strong>
          <small>按已完成任务计算</small>
        </div>
        <div className="admin-telemetry-card admin-telemetry-card--amber">
          <span><Clock3 size={16} />平均总耗时</span>
          <strong>{formatDuration(summary?.averageTotalMs)}</strong>
          <small>中位数 {formatDuration(summary?.p50TotalMs)}</small>
        </div>
        <div className="admin-telemetry-card admin-telemetry-card--violet">
          <span><Gauge size={16} />队列占用</span>
          <strong>{queue ? `${queue.active} / ${queue.capacity}` : '—'}</strong>
          <small>{queue ? `可用 ${queue.slotsAvailable} 个位置` : '等待数据'}</small>
        </div>
        <div className="admin-telemetry-card admin-telemetry-card--slate">
          <span><Timer size={16} />P95 总耗时</span>
          <strong>{formatDuration(summary?.p95TotalMs)}</strong>
          <small>95% 已完成任务不超过此时间</small>
        </div>
        <div className="admin-telemetry-card admin-telemetry-card--cyan">
          <span><Activity size={16} />平均任务流量</span>
          <strong>{formatBytes(trafficPerSubmission)}</strong>
          <small>上传与生成资源合计 / 提交数</small>
        </div>
      </div>

      <section className="admin-channel-summary" aria-label="提交来源分类统计">
        <article>
          <header><span className="admin-channel-badge admin-channel-badge--submit">用户 Splat</span><strong>{submitChannel?.submissions ?? 0} 次</strong></header>
          <div><span>提交人数</span><strong>{submitChannel?.uniqueClients ?? 0}</strong></div>
          <div><span>成功率</span><strong>{submitChannel?.successRate == null ? '—' : `${(submitChannel.successRate * 100).toFixed(1)}%`}</strong></div>
          <div><span>平均总用时</span><strong>{formatDuration(submitChannel?.averageTotalMs)}</strong></div>
          <div><span>总流量</span><strong>{formatBytes((submitChannel?.inputBytes ?? 0) + (submitChannel?.outputBytes ?? 0))}</strong></div>
        </article>
        <article>
          <header><span className="admin-channel-badge admin-channel-badge--designer">设计师 GLB</span><strong>{designerChannel?.submissions ?? 0} 次</strong></header>
          <div><span>设计师人数</span><strong>{designerChannel?.uniqueClients ?? 0}</strong></div>
          <div><span>成功率</span><strong>{designerChannel?.successRate == null ? '—' : `${(designerChannel.successRate * 100).toFixed(1)}%`}</strong></div>
          <div><span>平均总用时</span><strong>{formatDuration(designerChannel?.averageTotalMs)}</strong></div>
          <div><span>总流量</span><strong>{formatBytes((designerChannel?.inputBytes ?? 0) + (designerChannel?.outputBytes ?? 0))}</strong></div>
        </article>
      </section>

      <section className="admin-users-section" aria-label="提交用户档案">
        <div className="admin-subsection-head admin-users-head">
          <div><Users size={17} /><h3>提交用户</h3></div>
          <span>{userTotal} 位已识别用户 · 历史未采集记录不计入</span>
        </div>
        <div className="admin-users-toolbar">
          <label className="admin-users-search">
            <Search size={15} />
            <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="搜索昵称、手机号、用户 ID 或活动码" aria-label="搜索提交用户" />
          </label>
        </div>
        <div className="admin-users-workspace">
          <div className="admin-user-list" aria-label="用户列表">
            {users.map((user) => {
              const profile = user.profile;
              const successRate = user.submissions ? Math.round((user.successes / user.submissions) * 100) : 0;
              return (
                <button key={user.userKey} type="button" className={`admin-user-card${selectedUserKey === user.userKey ? ' is-active' : ''}`} onClick={() => setSelectedUserKey(user.userKey)}>
                  <span className="admin-user-avatar">
                    {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <UserRound size={21} />}
                  </span>
                  <span className="admin-user-card__copy">
                    <strong>{profileValue(profile?.name)}</strong>
                    <small>{profile?.mobile || `ID ${user.userKey}`}</small>
                    <em>{user.submissions} 次提交 · {successRate}% 成功 · 最近 {formatDate(user.lastSubmittedAt)}</em>
                  </span>
                </button>
              );
            })}
            {!users.length ? <p className="admin-muted admin-user-empty">{userQuery ? '没有匹配的用户' : '暂无已关联真实身份的提交'}</p> : null}
          </div>

          <div className="admin-user-detail">
            {!selectedUserKey ? (
              <div className="admin-user-detail-empty"><UserRound size={30} /><strong>选择一位用户</strong><span>查看完整资料、预约信息和历次提交作品。</span></div>
            ) : userLoading || !selectedUser ? (
              <div className="admin-user-detail-empty"><RefreshCw className="admin-spin" size={24} /><span>正在加载用户档案…</span></div>
            ) : (
              <>
                <header className="admin-user-profile-head">
                  <span className="admin-user-avatar admin-user-avatar--large">
                    {selectedUser.profile?.avatarUrl ? <img src={selectedUser.profile.avatarUrl} alt="" /> : <UserRound size={29} />}
                  </span>
                  <div><span>用户档案</span><h4>{profileValue(selectedUser.profile?.name)}</h4><small>{selectedUser.submissions.length} 条提交记录</small></div>
                </header>
                <div className="admin-user-profile-grid">
                  <div><IdCard size={15} /><span>用户 ID</span><strong>{profileValue(selectedUser.profile?.id)}</strong></div>
                  <div><Phone size={15} /><span>手机号</span><strong>{profileValue(selectedUser.profile?.mobile)}</strong></div>
                  <div><MapPin size={15} /><span>最近 IP</span><strong>{profileValue(selectedUser.clientIp)}</strong></div>
                  <div><Smartphone size={15} /><span>设备</span><strong>{deviceLabel(selectedUser.userAgent)}</strong></div>
                </div>
                <div className="admin-user-booking">
                  <h5>最近预约信息</h5>
                  <div><span>预约编号</span><strong>{profileValue(selectedUser.latestBooking?.id)}</strong></div>
                  <div><span>活动码</span><strong>{profileValue(selectedUser.latestBooking?.code)}</strong></div>
                  <div><span>预约时段</span><strong>{profileValue(selectedUser.latestBooking?.slotLabel)}</strong></div>
                  <div><span>签到状态</span><strong>{profileValue(selectedUser.latestBooking?.status)}</strong></div>
                </div>
                <details className="admin-user-raw">
                  <summary>查看提交时的完整接口资料</summary>
                  <pre>{JSON.stringify({ user: selectedUser.profile?.raw ?? null, booking: selectedUser.latestBooking?.raw ?? null }, null, 2)}</pre>
                </details>
                <div className="admin-user-submissions">
                  <h5>作品与提交历史</h5>
                  {selectedUser.submissions.map((row) => (
                    <div key={row.jobId} className="admin-user-submission-row">
                      <span className={`admin-status-pill admin-status-pill--${row.success ? 'success' : row.status === 'failed' ? 'danger' : 'pending'}`}>{statusLabel(row)}</span>
                      <span><strong>{row.sourceFilename || row.artworkId}</strong><small>{row.artworkId} · {formatDate(row.submittedAt)}</small></span>
                      <em>{formatDuration(row.totalMs)}</em>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="admin-telemetry-grid">
        <section className="admin-traffic-card" aria-label="流量监控">
          <div className="admin-subsection-head">
            <div><Activity size={17} /><h3>流量监控</h3></div>
            <span>窗口内</span>
          </div>
          <div className="admin-traffic-stats">
            <div><Upload size={15} /><span>上传流量</span><strong>{formatBytes(summary?.inputBytes ?? 0)}</strong></div>
            <div><Download size={15} /><span>生成资源</span><strong>{formatBytes(summary?.outputBytes ?? 0)}</strong></div>
          </div>
          <div className="admin-latency-breakdown" aria-label="任务阶段耗时">
            <div><span>平均排队</span><strong>{formatDuration(summary?.averageQueueMs)}</strong></div>
            <div><span>平均生成</span><strong>{formatDuration(summary?.averageGenerationMs)}</strong></div>
            <div><span>总耗时 P50</span><strong>{formatDuration(summary?.p50TotalMs)}</strong></div>
            <div><span>总耗时 P95</span><strong>{formatDuration(summary?.p95TotalMs)}</strong></div>
          </div>
          <div className="admin-hourly-chart" aria-label="每小时提交量">
            {(metrics?.hourly ?? []).map((item) => (
              <span key={item.bucket} style={{ height: `${Math.max(6, (item.count / chartMax) * 100)}%` }} title={`${item.bucket}: ${item.count} 次`} />
            ))}
            {metrics?.hourly.length === 0 ? <em>暂无提交记录</em> : null}
          </div>
        </section>

        <section className="admin-recent-card" aria-label="最近提交">
          <div className="admin-subsection-head">
            <div><Clock3 size={17} /><h3>最近提交</h3></div>
            <span>{metrics?.recent.length ?? 0} 条</span>
          </div>
          <div className="admin-recent-list">
            {(metrics?.recent ?? []).map((row) => (
              <div className="admin-recent-row" key={row.jobId}>
                <div className="admin-recent-main">
                  <strong><span className={`admin-channel-badge admin-channel-badge--${row.channel === 'designer' ? 'designer' : 'submit'}`}>{row.channel === 'designer' ? '设计师 GLB' : '用户 Splat'}</span>{row.user?.name ? `${row.user.name} · ${row.sourceFilename || row.artworkId}` : row.sourceFilename || row.artworkId}</strong>
                  <span>{formatDate(row.submittedAt)} · {row.channel === 'designer' ? `设计师会话 ${row.clientKey}` : row.user?.id ? `用户 ${row.user.id}` : '历史数据未关联用户'} · {row.artworkId}</span>
                </div>
                <div className={`admin-status-pill admin-status-pill--${row.success ? 'success' : row.status === 'failed' ? 'danger' : 'pending'}`}>
                  {row.success ? <CheckCircle2 size={13} /> : row.status === 'failed' ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
                  {statusLabel(row)}
                </div>
                <span className="admin-recent-duration">{formatDuration(row.totalMs)}</span>
              </div>
            ))}
            {metrics?.recent.length === 0 ? <p className="admin-muted">暂无提交记录</p> : null}
          </div>
        </section>
      </div>

      <section className="admin-jobs-table-section" aria-label="最近任务阶段明细">
        <div className="admin-subsection-head">
          <div><Gauge size={17} /><h3>最近任务阶段明细</h3></div>
          <span>数据每 30 秒自动刷新</span>
        </div>
        <div className="admin-jobs-table-wrap">
          <table className="admin-jobs-table">
            <thead><tr><th>来源</th><th>提交时间</th><th>开始时间</th><th>结束时间</th><th>用户 / 会话</th><th>文件 / 作品</th><th>状态</th><th>排队</th><th>生成</th><th>总耗时</th><th>上传</th><th>生成资源</th><th>错误信息</th></tr></thead>
            <tbody>
              {(metrics?.recent ?? []).map((row) => (
                <tr key={row.jobId}>
                  <td><span className={`admin-channel-badge admin-channel-badge--${row.channel === 'designer' ? 'designer' : 'submit'}`}>{row.channel === 'designer' ? '设计师 GLB' : '用户 Splat'}</span></td>
                  <td>{formatDate(row.submittedAt)}</td>
                  <td>{formatDate(row.startedAt)}</td>
                  <td>{formatDate(row.finishedAt)}</td>
                  <td><strong>{row.channel === 'designer' ? '设计师' : row.user?.name || '未关联'}</strong><small>{row.channel === 'designer' ? row.clientKey : row.user?.mobile || row.user?.id || '历史数据'}</small></td>
                  <td><strong>{row.sourceFilename || row.artworkId}</strong><small>{row.artworkId}</small></td>
                  <td>{statusLabel(row)}</td>
                  <td>{formatDuration(row.queueMs)}</td>
                  <td>{formatDuration(row.generationMs)}</td>
                  <td>{formatDuration(row.totalMs)}</td>
                  <td>{formatBytes(row.inputBytes)}</td>
                  <td>{formatBytes(row.outputBytes)}</td>
                  <td className={row.errorMessage ? 'is-error' : ''}>{row.errorMessage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {metrics?.recent.length === 0 ? <p className="admin-muted">当前统计窗口内暂无任务数据</p> : null}
      </section>
    </section>
  );
}
