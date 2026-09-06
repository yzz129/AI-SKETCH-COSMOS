import { CheckCircle2, Cpu, Database, Gauge, Maximize2, RefreshCw, Server, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSubmitTestEntrySetting,
  updateSubmitTestEntrySetting
} from '../../lib/artwork/systemSettings';
import { submitArtworkFile } from '../../lib/artwork/submitArtworkFile';
import { createDisplayAdminControlSender, type DisplayAdminCommand } from '../../lib/artwork/modelControlSync';
import { MAX_LOCAL_STRESS_TOTAL } from '../../lib/artwork/localStressTest';

type HealthState = {
  backend: 'checking' | 'online' | 'offline';
  ai: 'checking' | 'online' | 'offline';
  detail: string;
};

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

export function AdminSystemPanel() {
  const uploadRef = useRef<HTMLInputElement>(null);
  const displaySenderRef = useRef<ReturnType<typeof createDisplayAdminControlSender> | null>(null);
  const [health, setHealth] = useState<HealthState>({ backend: 'checking', ai: 'checking', detail: '正在检查服务状态…' });
  const [loading, setLoading] = useState(false);
  const [testEntryEnabled, setTestEntryEnabled] = useState<boolean | null>(null);
  const [testEntrySaving, setTestEntrySaving] = useState(false);
  const [testEntryMessage, setTestEntryMessage] = useState('');
  const [stressTarget, setStressTarget] = useState('60');
  const [displayMessage, setDisplayMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const base = apiBase();
    if (!base) {
      setHealth({ backend: 'offline', ai: 'offline', detail: '未配置后端地址' });
      return;
    }
    setLoading(true);
    const [backendResult, aiResult] = await Promise.allSettled([
      fetch(`${base}/health`, { cache: 'no-store' }),
      fetch(`${base}/health/ai`, { cache: 'no-store' })
    ]);
    const backendOnline = backendResult.status === 'fulfilled' && backendResult.value.ok;
    const aiOnline = aiResult.status === 'fulfilled' && aiResult.value.ok;
    setHealth({
      backend: backendOnline ? 'online' : 'offline',
      ai: aiOnline ? 'online' : 'offline',
      detail: backendOnline ? '核心接口响应正常' : '后端连接失败，请检查看门狗和 8000 端口'
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    displaySenderRef.current = createDisplayAdminControlSender();
    void load();
    void fetchSubmitTestEntrySetting()
      .then((setting) => setTestEntryEnabled(setting.enabled))
      .catch(() => {
        setTestEntryEnabled(null);
        setTestEntryMessage('配置接口暂不可用，请重启后台服务后重试。');
      });
    return () => {
      displaySenderRef.current?.close();
      displaySenderRef.current = null;
    };
  }, [load]);

  const sendDisplayCommand = (command: DisplayAdminCommand, message: string) => {
    displaySenderRef.current?.send(command);
    setDisplayMessage(message);
  };

  const uploadArtwork = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setDisplayMessage('正在上传作品…');
    try {
      await submitArtworkFile(file);
      setDisplayMessage('作品已上传，大屏将自动载入。');
    } catch (error) {
      setDisplayMessage(error instanceof Error ? error.message : '作品上传失败');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const toggleTestEntry = async () => {
    if (testEntryEnabled === null || testEntrySaving) return;
    const nextEnabled = !testEntryEnabled;
    setTestEntrySaving(true);
    setTestEntryMessage('');
    try {
      const setting = await updateSubmitTestEntrySetting(nextEnabled);
      setTestEntryEnabled(setting.enabled);
      setTestEntryMessage(setting.enabled ? '测试入口已打开，/submit 将显示模拟预约全流程入口。' : '测试入口已关闭，/submit 不再显示测试入口。');
    } catch (error) {
      setTestEntryMessage(error instanceof Error ? error.message : '测试入口配置保存失败');
    } finally {
      setTestEntrySaving(false);
    }
  };

  const statusIcon = (status: HealthState['backend']) => status === 'online'
    ? <CheckCircle2 size={19} />
    : <TriangleAlert size={19} />;

  return (
    <section className="admin-module admin-system-panel" aria-label="系统状态">
      <header className="admin-module-head">
        <div><h2>系统状态</h2></div>
        <button className="admin-secondary-button" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'admin-spin' : undefined} />重新检查
        </button>
      </header>
      <div className="admin-system-grid">
        <article className={`admin-system-card is-${health.backend}`}>
          <Server size={22} /><div><span>核心后端</span><strong>{health.backend === 'online' ? '运行正常' : '连接异常'}</strong><small>{health.detail}</small></div>{statusIcon(health.backend)}
        </article>
        <article className={`admin-system-card is-${health.ai}`}>
          <Cpu size={22} /><div><span>AI 模型服务</span><strong>{health.ai === 'online' ? '配置可用' : '需要检查'}</strong><small>识图、生图和三维生成供应商状态</small></div>{statusIcon(health.ai)}
        </article>
        <article className="admin-system-card is-online">
          <Database size={22} /><div><span>本地数据库</span><strong>SQLite 持久化</strong><small>作品、GLB 展品与提交统计独立存储</small></div><CheckCircle2 size={19} />
        </article>
      </div>
      <section className="admin-display-control" aria-labelledby="display-control-title">
        <header>
          <div><h3 id="display-control-title">大屏控制</h3></div>
          {displayMessage ? <span role="status">{displayMessage}</span> : null}
        </header>
        <div className="admin-display-control__actions">
          <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadArtwork} />
          <button type="button" className="admin-secondary-button" onClick={() => uploadRef.current?.click()} disabled={uploading}>
            <Upload size={16} />{uploading ? '上传中' : '上传作品'}
          </button>
          <label className="admin-stress-target">
            <Gauge size={16} />
            <span>上屏数量</span>
            <input
              type="number"
              min={1}
              max={MAX_LOCAL_STRESS_TOTAL}
              value={stressTarget}
              onChange={(event) => setStressTarget(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="admin-primary-button"
            onClick={() => sendDisplayCommand({ command: 'stress-start', target: Number.parseInt(stressTarget, 10) || 60 }, '压力测试指令已发送。')}
          >
            开始压力测试
          </button>
          <button type="button" className="admin-secondary-button" onClick={() => sendDisplayCommand({ command: 'stress-clear' }, '测试模型清除指令已发送。')}>
            清除测试模型
          </button>
          <button type="button" className="admin-secondary-button" onClick={() => sendDisplayCommand({ command: 'toggle-fullscreen' }, '全屏切换指令已发送。')}>
            <Maximize2 size={16} />切换全屏
          </button>
          <button type="button" className="admin-danger-button" onClick={() => sendDisplayCommand({ command: 'clear-artworks' }, '清空指令已发送。')}>
            <Trash2 size={16} />清空大屏
          </button>
        </div>
      </section>
      <section className="admin-feature-control" aria-labelledby="submit-test-entry-title">
        <span className="admin-feature-control__icon"><ShieldCheck size={21} /></span>
        <div>
          <h3 id="submit-test-entry-title">/submit 测试入口</h3>
          <p>打开后，/submit 可用模拟预约用户完成签到、创作、生成和结果查看全流程。</p>
          {testEntryMessage ? <small role="status">{testEntryMessage}</small> : null}
        </div>
        <button
          type="button"
          className={`admin-switch${testEntryEnabled ? ' is-on' : ''}`}
          role="switch"
          aria-checked={Boolean(testEntryEnabled)}
          aria-label="打开或关闭 /submit 测试入口"
          onClick={() => void toggleTestEntry()}
          disabled={testEntryEnabled === null || testEntrySaving}
        >
          <span />
          <strong>{testEntrySaving ? '保存中' : testEntryEnabled ? '已打开' : testEntryEnabled === false ? '已关闭' : '不可用'}</strong>
        </button>
      </section>
    </section>
  );
}
