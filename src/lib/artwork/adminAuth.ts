export type AdminAuthStatus = { authenticated: boolean };

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

async function parseAuthResponse(response: Response) {
  if (response.ok) return await response.json() as AdminAuthStatus;
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  throw new Error(payload?.detail || `后台认证失败：${response.status}`);
}

export async function fetchAdminAuthStatus() {
  const base = apiBase();
  if (!base) return { authenticated: false };
  return await parseAuthResponse(await fetch(`${base}/api/admin/auth/status`, {
    cache: 'no-store',
    credentials: 'include'
  }));
}

export async function loginAdmin(password: string) {
  const base = apiBase();
  if (!base) throw new Error('作品后台尚未配置。');
  return await parseAuthResponse(await fetch(`${base}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password })
  }));
}

export async function logoutAdmin() {
  const base = apiBase();
  if (!base) return { authenticated: false };
  return await parseAuthResponse(await fetch(`${base}/api/admin/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  }));
}
