export type SubmissionTelemetryRow = {
  jobId: string;
  submissionId?: string | null;
  clientKey: string;
  artworkId: string;
  sourceFilename?: string | null;
  channel?: 'submit' | 'designer' | string;
  referenceMode?: 'single' | 'multi' | string | null;
  modelId?: string | null;
  publishedAt?: string | null;
  status: 'queued' | 'processing' | 'ready' | 'failed' | string;
  success: boolean;
  submittedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  inputBytes: number;
  outputBytes: number;
  queueMs?: number | null;
  generationMs?: number | null;
  totalMs?: number | null;
  errorMessage?: string | null;
  user?: SubmissionUserProfile | null;
  booking?: SubmissionBookingSnapshot | null;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type SubmissionUserProfile = {
  id?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  mobile?: string | null;
  raw?: Record<string, unknown> | null;
};

export type SubmissionBookingSnapshot = {
  id?: string | null;
  code?: string | null;
  projectId?: string | null;
  slotId?: string | null;
  slotLabel?: string | null;
  status?: string | null;
  raw?: Record<string, unknown> | null;
};

export type SubmissionUserSummary = {
  userKey: string;
  profile?: SubmissionUserProfile | null;
  latestBooking?: SubmissionBookingSnapshot | null;
  submissions: number;
  successes: number;
  trafficBytes: number;
  averageTotalMs?: number | null;
  firstSubmittedAt?: string | null;
  lastSubmittedAt?: string | null;
};

export type SubmissionUserDetail = {
  userKey: string;
  profile?: SubmissionUserProfile | null;
  latestBooking?: SubmissionBookingSnapshot | null;
  clientIp?: string | null;
  userAgent?: string | null;
  submissions: SubmissionTelemetryRow[];
};

export type SubmissionMetrics = {
  windowHours: number;
  daily?: {
    date: string;
    timezoneOffsetMinutes: number;
    availableDates: string[];
    totalUploads: number;
    uniqueUsers: number;
  };
  summary: {
    submissions: number;
    uniqueClients: number;
    identifiedUsers?: number;
    identifiedSubmissions?: number;
    successes: number;
    failures: number;
    pending: number;
    successRate?: number | null;
    averageTotalMs?: number | null;
    p50TotalMs?: number | null;
    p95TotalMs?: number | null;
    averageQueueMs?: number | null;
    averageGenerationMs?: number | null;
    inputBytes: number;
    outputBytes: number;
    totalUploadedModels?: number;
    usersLastMinute?: number;
  };
  hourly: Array<{ bucket: string; count: number }>;
  minuteUsers?: Array<{ timestamp: string; count: number }>;
  channels?: Record<'submit' | 'designer', {
    submissions: number;
    uniqueClients: number;
    successes: number;
    failures: number;
    pending: number;
    successRate?: number | null;
    averageTotalMs?: number | null;
    inputBytes: number;
    outputBytes: number;
  }>;
  recent: SubmissionTelemetryRow[];
  queue?: {
    queued: number;
    processing: number;
    active: number;
    capacity: number;
    slotsAvailable: number;
  };
};

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

export async function fetchSubmissionUsers(query = '', limit = 40, offset = 0) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const params = new URLSearchParams({ query, limit: String(limit), offset: String(offset) });
  const response = await fetch(`${baseUrl}/api/admin/submission-users?${params}`, { cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new Error(`用户资料加载失败：${response.status}`);
  return await response.json() as { total: number; users: SubmissionUserSummary[] };
}

export async function fetchSubmissionUserDetail(userKey: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${baseUrl}/api/admin/submission-users/${encodeURIComponent(userKey)}`, { cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new Error(`用户详情加载失败：${response.status}`);
  return await response.json() as SubmissionUserDetail;
}

export async function fetchSubmissionMetrics(
  windowHours = 24,
  limit = 16,
  chartDate?: string
): Promise<SubmissionMetrics> {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const params = new URLSearchParams({
    windowHours: String(windowHours),
    limit: String(limit),
    timezoneOffsetMinutes: '480'
  });
  if (chartDate) params.set('chartDate', chartDate);
  const response = await fetch(`${baseUrl}/api/admin/submission-metrics?${params}`, { cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new Error(`提交统计加载失败：${response.status}`);
  return await response.json() as SubmissionMetrics;
}
