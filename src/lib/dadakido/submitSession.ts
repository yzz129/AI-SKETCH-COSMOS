const DEFAULT_API_BASE = '/dadakido-api';
const SUBMIT_SESSION_STORAGE_KEY = 'ai-sketch-cosmos:submit-session';
const CHECK_IN_BY_CODE_URL = '/dadakido-checkin-api/api/v1/users/me/visit-bookings/check-in-by-code';

type JsonRecord = Record<string, unknown>;

export type SubmitLaunchContext = {
  token: string;
  code: string;
};

export type DadakidoUser = {
  id: string;
  name: string;
  avatarUrl?: string;
  mobile?: string;
  raw: JsonRecord;
};

export type CourseSlot = {
  id: string;
  label: string;
  startAt?: string;
  endAt?: string;
  remaining?: number;
  available: boolean;
  raw: JsonRecord;
};

export type CourseBooking = {
  id: string;
  code?: string;
  projectId?: string;
  slotId?: string;
  status?: string;
  qrCodeDataUrl?: string;
  slotLabel?: string;
  raw: JsonRecord;
};

const checkInRequests = new Map<string, Promise<CourseBooking>>();

export class DadakidoApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DadakidoApiError';
    this.status = status;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function firstString(record: JsonRecord | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(record: JsonRecord | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function nestedRecord(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

const BOOKING_CODE_KEYS = new Set([
  'code',
  'booking_code',
  'bookingCode',
  'reservation_code',
  'reservationCode',
  'check_in_code',
  'checkInCode',
  'verification_code',
  'verificationCode',
  'consume_code',
  'consumeCode',
  'course_code',
  'courseCode',
  'project_code',
  'projectCode'
]);

function findBookingCode(value: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  for (const [key, entry] of Object.entries(record)) {
    if (!BOOKING_CODE_KEYS.has(key)) continue;
    if (typeof entry === 'string' && /^\d{6}$/.test(entry.trim())) return entry.trim();
    if (typeof entry === 'number' && Number.isInteger(entry)) {
      const numericCode = String(entry).padStart(6, '0');
      if (/^\d{6}$/.test(numericCode)) return numericCode;
    }
  }
  for (const entry of Object.values(record)) {
    const nestedCode = findBookingCode(entry, depth + 1);
    if (nestedCode) return nestedCode;
  }
  return undefined;
}

function unwrapPayload(payload: unknown): unknown {
  let current = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = asRecord(current);
    if (!record) break;
    const next = record.data ?? record.result;
    if (next === undefined) break;
    current = next;
  }
  return current;
}

function extractCollection(payload: unknown, keys: string[]) {
  const unwrapped = unwrapPayload(payload);
  if (Array.isArray(unwrapped)) return unwrapped;
  const record = asRecord(unwrapped);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function errorMessage(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  const message = firstString(record, ['message', 'error', 'detail']);
  return message ?? fallback;
}

function apiBase() {
  return (import.meta.env.VITE_DADAKIDO_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
}

async function apiRequest(path: string, token: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const requestUrl = /^https?:\/\//i.test(path) || path.startsWith('/dadakido-checkin-api/')
      ? path
      : `${apiBase()}${path}`;
    const response = await fetch(requestUrl, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const fallback = response.status === 401
        ? '登录信息已失效，请返回小程序重新进入。'
        : `活动服务请求失败（${response.status}）。`;
      throw new DadakidoApiError(errorMessage(payload, fallback), response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof DadakidoApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('活动服务连接超时，请检查网络后重试。');
    }
    throw new Error('暂时无法连接活动服务，请检查网络后重试。');
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseParams(value: string) {
  return new URLSearchParams(value.replace(/^[?#]/, ''));
}

function storedLaunchContext() {
  try {
    const value = window.sessionStorage.getItem(SUBMIT_SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SubmitLaunchContext>;
    if (!parsed.token || !parsed.code) return null;
    return parsed as SubmitLaunchContext;
  } catch {
    return null;
  }
}

function removeTokenFromAddress(query: URLSearchParams, hash: URLSearchParams) {
  const hadToken = query.has('token') || query.has('accessToken') || hash.has('token') || hash.has('accessToken');
  if (!hadToken) return;
  query.delete('token');
  query.delete('accessToken');
  hash.delete('token');
  hash.delete('accessToken');
  const queryText = query.toString();
  const hashText = hash.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${queryText ? `?${queryText}` : ''}${hashText ? `#${hashText}` : ''}`
  );
}

export function readSubmitLaunchContext(): SubmitLaunchContext | null {
  if (typeof window === 'undefined') return null;
  const query = parseParams(window.location.search);
  const hash = parseParams(window.location.hash);
  const incomingToken = hash.get('token') ?? hash.get('accessToken') ?? query.get('token') ?? query.get('accessToken');
  const incomingCode = hash.get('code') ?? query.get('code');
  const hasIncomingContext = Boolean(incomingToken || incomingCode);

  removeTokenFromAddress(query, hash);

  if (!hasIncomingContext) return storedLaunchContext();
  if (!incomingToken || !incomingCode) return null;

  const context: SubmitLaunchContext = {
    token: incomingToken,
    code: incomingCode
  };
  try {
    window.sessionStorage.setItem(SUBMIT_SESSION_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // The in-memory context remains usable if session storage is unavailable.
  }
  return context;
}

export function isSixDigitCode(code: string) {
  return /^\d{6}$/.test(code);
}

export function isTokenExpired(token: string) {
  try {
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return false;
    const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(paddedPayload)) as { exp?: number };
    return typeof decoded.exp === 'number' && decoded.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export async function fetchCurrentUser(token: string): Promise<DadakidoUser> {
  const payload = unwrapPayload(await apiRequest('/api/v1/users/me', token));
  const raw = asRecord(payload);
  if (!raw) throw new Error('用户信息格式不正确，请联系活动工作人员。');
  const profile = nestedRecord(raw, ['profile', 'wechatProfile', 'userInfo']);
  return {
    id: firstString(raw, ['id', '_id', 'userId', 'openid']) ?? 'current-user',
    name: firstString(raw, ['nickname', 'nickName', 'displayName', 'name'])
      ?? firstString(profile, ['nickname', 'nickName', 'displayName', 'name'])
      ?? '星河创作者',
    avatarUrl: firstString(raw, ['avatarUrl', 'avatar', 'headImgUrl'])
      ?? firstString(profile, ['avatarUrl', 'avatar', 'headImgUrl']),
    mobile: firstString(raw, ['mobile', 'phone', 'phoneNumber']),
    raw
  };
}

function formatSlotLabel(startAt?: string, endAt?: string) {
  if (!startAt) return '可预约时段';
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return startAt;
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(start);
  if (!endAt) return date;
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return `${date} – ${endAt}`;
  const endTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(end);
  return `${date} – ${endTime}`;
}

function normalizeSlot(value: unknown, index: number): CourseSlot | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = firstString(raw, ['id', '_id', 'slotId', 'scheduleId', 'courseScheduleId']);
  if (!id) return null;
  const startAt = firstString(raw, ['startAt', 'startTime', 'startsAt', 'date', 'bookingDate']);
  const endAt = firstString(raw, ['endAt', 'endTime', 'endsAt']);
  const remaining = firstNumber(raw, ['remaining', 'remainingCount', 'availableCount', 'remainingCapacity']);
  const status = firstString(raw, ['status'])?.toLowerCase();
  const explicitlyAvailable = raw.isAvailable ?? raw.available ?? raw.enabled;
  const available = explicitlyAvailable === false
    ? false
    : remaining === undefined || remaining > 0;
  return {
    id,
    label: firstString(raw, ['label', 'title', 'name']) ?? formatSlotLabel(startAt, endAt) ?? `时段 ${index + 1}`,
    startAt,
    endAt,
    remaining,
    available: available && !['full', 'closed', 'cancelled', 'expired'].includes(status ?? ''),
    raw
  };
}

export async function fetchAvailableSlots(token: string, projectId: string) {
  const payload = await apiRequest(`/api/v1/courses/${encodeURIComponent(projectId)}/available-slots`, token);
  return extractCollection(payload, ['slots', 'items', 'list', 'records'])
    .map(normalizeSlot)
    .filter((slot): slot is CourseSlot => Boolean(slot?.available));
}

function normalizeBooking(value: unknown): CourseBooking | null {
  const unwrapped = unwrapPayload(value);
  const responseRecord = asRecord(unwrapped);
  const raw = responseRecord
    ? nestedRecord(responseRecord, ['booking', 'visitBooking', 'visit_booking']) ?? responseRecord
    : null;
  if (!raw) return null;
  const id = firstString(raw, ['id', '_id', 'bookingId', 'booking_id', 'courseBookingId', 'course_booking_id']);
  if (!id) return null;
  const project = nestedRecord(raw, ['project', 'course', 'event']);
  const ticket = nestedRecord(raw, ['ticket']);
  const slot = nestedRecord(raw, ['slot', 'schedule', 'courseSchedule', 'session'])
    ?? (ticket ? nestedRecord(ticket, ['session']) : null);
  const qrCode = nestedRecord(raw, ['qrCode']);
  const startAt = firstString(slot, ['startAt', 'startTime', 'date'])
    ?? firstString(raw, ['startAt', 'startTime', 'bookingDate']);
  const endAt = firstString(slot, ['endAt', 'endTime'])
    ?? firstString(raw, ['endAt', 'endTime']);
  return {
    id,
    code: findBookingCode(raw),
    projectId: firstString(raw, ['projectId', 'project_id', 'courseId', 'course_id'])
      ?? firstString(project, ['id', '_id', 'projectId', 'project_id', 'courseId', 'course_id']),
    slotId: firstString(raw, ['slotId', 'slot_id', 'scheduleId', 'schedule_id', 'courseScheduleId', 'course_schedule_id'])
      ?? firstString(slot, ['id', '_id']),
    status: firstString(raw, ['checkedInAt', 'checked_in_at'])
      ? 'checked_in'
      : firstString(raw, ['status', 'bookingStatus', 'booking_status', 'checkInStatus', 'check_in_status'])
        ?? firstString(ticket, ['status', 'bookingStatus', 'booking_status']),
    qrCodeDataUrl: firstString(raw, [
      'qrCodeDataUrl',
      'qr_code_data_url',
      'qrCodeUrl',
      'qr_code_url',
      'checkInQrCodeDataUrl',
      'check_in_qr_code_data_url'
    ])
      ?? firstString(qrCode, ['dataUrl', 'url'])
      ?? firstString(ticket, [
        'qrCodeDataUrl',
        'qr_code_data_url',
        'qrCodeUrl',
        'qr_code_url',
        'checkInQrCodeDataUrl',
        'check_in_qr_code_data_url'
      ]),
    slotLabel: firstString(raw, ['slotLabel', 'slot_label', 'visitTimeLabel', 'visit_time_label'])
      ?? firstString(slot, ['label', 'title', 'name'])
      ?? (startAt ? formatSlotLabel(startAt, endAt) : undefined),
    raw
  };
}

export async function fetchVisitBookingByCode(token: string, code: string) {
  try {
    const payload = await apiRequest(
      `/api/v1/users/me/visit-bookings/by-code/${encodeURIComponent(code)}`,
      token
    );
    const booking = normalizeBooking(payload);
    if (!booking) return null;
    const inactiveStatuses = new Set(['cancelled', 'canceled', 'expired', 'rejected', 'refunded']);
    if (inactiveStatuses.has(booking.status?.toLowerCase() ?? '')) return null;
    return { ...booking, code: booking.code ?? code };
  } catch (error) {
    if (error instanceof DadakidoApiError && error.status === 404) return null;
    throw error;
  }
}

export function checkInVisitBookingByCode(token: string, code: string) {
  const requestKey = `${token}\u0000${code}`;
  const existingRequest = checkInRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = apiRequest(CHECK_IN_BY_CODE_URL, token, {
    method: 'POST',
    body: JSON.stringify({ code })
  }).then((payload): CourseBooking => {
    const booking = normalizeBooking(payload);
    if (booking) {
      return {
        ...booking,
        code: booking.code ?? code,
        status: 'checked_in'
      };
    }
    const raw = asRecord(unwrapPayload(payload)) ?? {};
    return {
      id: `checked-in-${code}`,
      code,
      status: 'checked_in',
      raw
    };
  });

  checkInRequests.set(requestKey, request);
  void request.catch(() => {
    checkInRequests.delete(requestKey);
  });
  return request;
}

export async function createCourseBooking(
  token: string,
  projectId: string,
  slot: CourseSlot
) {
  const slotField = import.meta.env.VITE_DADAKIDO_BOOKING_SLOT_FIELD?.trim() || 'slotId';
  const payload = await apiRequest(`/api/v1/courses/${encodeURIComponent(projectId)}/bookings`, token, {
    method: 'POST',
    body: JSON.stringify({ [slotField]: slot.id })
  });
  const booking = normalizeBooking(payload);
  if (!booking) throw new Error('预约已提交，但返回数据中缺少预约 ID。');
  return booking;
}
