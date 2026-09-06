import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { fetchAdminAuthStatus, loginAdmin, logoutAdmin } from '../../lib/artwork/adminAuth';
import './admin.css';

const ArtworkAdminPage = lazy(() => import('./ArtworkAdminPage').then((module) => ({
  default: module.ArtworkAdminPage
})));

export function AdminRoute() {
  const [status, setStatus] = useState<'checking' | 'signed-out' | 'signed-in'>('checking');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useLayoutEffect(() => {
    // The public galaxy intentionally locks the document to the viewport. The
    // admin console is a document-style page, especially on phones, so give
    // the root page back its native vertical scrolling while this route is
    // mounted. Keeping this scoped to a route class avoids changing WebGL
    // pointer/viewport behaviour on the public display.
    const root = document.documentElement;
    const body = document.body;
    root.classList.add('admin-route-active');
    body.classList.add('admin-route-active');

    return () => {
      root.classList.remove('admin-route-active');
      body.classList.remove('admin-route-active');
    };
  }, []);

  useEffect(() => {
    void fetchAdminAuthStatus()
      .then((result) => setStatus(result.authenticated ? 'signed-in' : 'signed-out'))
      .catch(() => {
        setStatus('signed-out');
        setMessage('暂时无法连接管理服务，请确认后台已启动。');
      });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const result = await loginAdmin(password);
      if (result.authenticated) {
        setPassword('');
        setStatus('signed-in');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    try {
      await logoutAdmin();
    } finally {
      setStatus('signed-out');
      setPassword('');
    }
  };

  if (status === 'checking') {
    return <div className="admin-auth-loading" role="status">正在验证后台登录状态…</div>;
  }

  if (status === 'signed-in') {
    return (
      <Suspense fallback={<div className="admin-auth-loading" role="status">正在加载管理中心…</div>}>
        <ArtworkAdminPage onLogout={() => void signOut()} />
      </Suspense>
    );
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-login-mark"><ShieldCheck size={28} /></div>
        <span className="admin-eyebrow">COSMOS SECURE CONSOLE</span>
        <h1 id="admin-login-title">进入星河管理中心</h1>
        <p>请输入后台管理密码。验证成功后，本设备会通过加密会话自动记住 30 天。</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-password">管理密码</label>
          <div className="admin-password-field">
            <LockKeyhole size={18} />
            <input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="请输入管理密码"
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {message ? <div className="admin-login-message" role="alert">{message}</div> : null}
          <button className="admin-login-submit" type="submit" disabled={!password || submitting}>
            {submitting ? '正在验证…' : '安全登录'}
          </button>
        </form>
        <small>密码只发送至本机管理后端；浏览器不保存明文密码。</small>
      </section>
    </main>
  );
}
