export type SubmitTestEntrySetting = {
  enabled: boolean;
  updatedAt?: string | null;
};

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

export async function fetchSubmitTestEntrySetting(): Promise<SubmitTestEntrySetting> {
  const base = apiBase();
  if (!base) return { enabled: false };
  const response = await fetch(`${base}/api/settings/submit-test-entry`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`测试入口配置读取失败：${response.status}`);
  return await response.json() as SubmitTestEntrySetting;
}

export async function updateSubmitTestEntrySetting(enabled: boolean): Promise<SubmitTestEntrySetting> {
  const base = apiBase();
  if (!base) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${base}/api/admin/settings/submit-test-entry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error(`测试入口配置保存失败：${response.status}`);
  return await response.json() as SubmitTestEntrySetting;
}
