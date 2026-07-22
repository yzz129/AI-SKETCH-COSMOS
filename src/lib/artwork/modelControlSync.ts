export type RemoteModelPose = {
  yaw: number;
  pitch: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  active: boolean;
  receivedAt: number;
};

type OutgoingModelPose = Omit<RemoteModelPose, 'receivedAt'>;

type ModelControlSender = {
  send: (pose: OutgoingModelPose) => void;
  close: () => void;
};

const SEND_INTERVAL_MS = 25;
const RECONNECT_MAX_DELAY_MS = 8_000;
const CAPABILITY_RETRY_MS = 3_000;
const remotePoses = new Map<string, RemoteModelPose>();

let capabilityAvailable = false;
let capabilityExpiresAt = 0;
let capabilityRequest: Promise<boolean> | null = null;

let receiverUsers = 0;
let receiverSocket: WebSocket | null = null;
let receiverReconnectTimer: number | null = null;
let receiverReconnectDelay = 500;
let receiverConnecting = false;

function configuredApiBase() {
  if (typeof window === 'undefined') return null;
  const configuredBase = (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.trim();
  return configuredBase ? new URL(configuredBase, window.location.href) : null;
}

function modelControlUrl(role: 'controller' | 'display') {
  const url = configuredApiBase();
  if (!url) return null;
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/model-control`;
  url.search = '';
  url.searchParams.set('role', role);
  return url.toString();
}

async function supportsModelControl() {
  const baseUrl = configuredApiBase();
  if (!baseUrl) return false;
  if (Date.now() < capabilityExpiresAt) return capabilityAvailable;
  if (capabilityRequest) return capabilityRequest;

  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/health`;
  baseUrl.search = '';
  capabilityRequest = fetch(baseUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = await response.json() as Record<string, unknown>;
      return payload.modelControl === true;
    })
    .catch(() => false)
    .then((available) => {
      capabilityAvailable = available;
      capabilityExpiresAt = Date.now() + (available ? 60_000 : CAPABILITY_RETRY_MS);
      capabilityRequest = null;
      return available;
    });
  return capabilityRequest;
}

function pauseCapabilityChecks() {
  capabilityAvailable = false;
  capabilityExpiresAt = Date.now() + CAPABILITY_RETRY_MS;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function scheduleReceiverReconnect(delay = receiverReconnectDelay) {
  if (receiverUsers === 0 || receiverReconnectTimer !== null) return;
  receiverReconnectTimer = window.setTimeout(() => {
    receiverReconnectTimer = null;
    void connectReceiver();
  }, delay);
}

async function connectReceiver() {
  const url = modelControlUrl('display');
  if (!url || receiverUsers === 0 || receiverSocket || receiverConnecting) return;
  receiverConnecting = true;
  const available = await supportsModelControl();
  receiverConnecting = false;
  if (receiverUsers === 0 || receiverSocket) return;
  if (!available) {
    scheduleReceiverReconnect(CAPABILITY_RETRY_MS);
    return;
  }

  const socket = new WebSocket(url);
  receiverSocket = socket;
  let opened = false;

  socket.addEventListener('open', () => {
    opened = true;
    receiverReconnectDelay = 500;
  });
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (payload.type === 'heartbeat') return;
      if (
        payload.type !== 'pose'
        || typeof payload.artworkId !== 'string'
        || !isFiniteNumber(payload.yaw)
        || !isFiniteNumber(payload.pitch)
      ) {
        return;
      }

      remotePoses.set(payload.artworkId, {
        yaw: payload.yaw,
        pitch: payload.pitch,
        offsetX: isFiniteNumber(payload.offsetX)
          ? Math.max(-0.85, Math.min(0.85, payload.offsetX))
          : 0,
        offsetY: isFiniteNumber(payload.offsetY)
          ? Math.max(-0.85, Math.min(0.85, payload.offsetY))
          : 0,
        offsetZ: isFiniteNumber(payload.offsetZ)
          ? Math.max(-0.85, Math.min(0.85, payload.offsetZ))
          : 0,
        active: payload.active === true,
        receivedAt: performance.now()
      });
    } catch {
      // Ignore malformed relay messages and keep the live connection open.
    }
  });
  socket.addEventListener('close', () => {
    if (receiverSocket === socket) receiverSocket = null;
    if (!opened) pauseCapabilityChecks();
    scheduleReceiverReconnect(opened ? receiverReconnectDelay : CAPABILITY_RETRY_MS);
    receiverReconnectDelay = Math.min(RECONNECT_MAX_DELAY_MS, receiverReconnectDelay * 1.8);
  });
}

export function startRemoteModelControlReceiver() {
  receiverUsers += 1;
  void connectReceiver();

  return () => {
    receiverUsers = Math.max(0, receiverUsers - 1);
    if (receiverUsers > 0) return;

    if (receiverReconnectTimer !== null) {
      window.clearTimeout(receiverReconnectTimer);
      receiverReconnectTimer = null;
    }
    receiverSocket?.close();
    receiverSocket = null;
    remotePoses.clear();
  };
}

export function getRemoteModelPose(artworkId: string) {
  return remotePoses.get(artworkId) ?? null;
}

export function createModelControlSender(artworkId: string): ModelControlSender {
  const url = modelControlUrl('controller');
  let socket: WebSocket | null = null;
  let disposed = false;
  let reconnectTimer: number | null = null;
  let reconnectDelay = 500;
  let connecting = false;
  let flushTimer: number | null = null;
  let lastSentAt = 0;
  let pendingPose: OutgoingModelPose | null = null;

  const flush = () => {
    flushTimer = null;
    if (!pendingPose || socket?.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
      type: 'pose',
      artworkId,
      ...pendingPose
    }));
    pendingPose = null;
    lastSentAt = performance.now();
  };

  const scheduleFlush = () => {
    if (flushTimer !== null || !pendingPose) return;
    const delay = Math.max(0, SEND_INTERVAL_MS - (performance.now() - lastSentAt));
    flushTimer = window.setTimeout(flush, delay);
  };

  const scheduleReconnect = (delay = reconnectDelay) => {
    if (disposed || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (!url || disposed || socket || connecting) return;
    connecting = true;
    const available = await supportsModelControl();
    connecting = false;
    if (disposed || socket) return;
    if (!available) {
      scheduleReconnect(CAPABILITY_RETRY_MS);
      return;
    }

    const nextSocket = new WebSocket(url);
    socket = nextSocket;
    let opened = false;

    nextSocket.addEventListener('open', () => {
      opened = true;
      reconnectDelay = 500;
      scheduleFlush();
    });
    nextSocket.addEventListener('close', () => {
      if (socket === nextSocket) socket = null;
      if (!opened) pauseCapabilityChecks();
      scheduleReconnect(opened ? reconnectDelay : CAPABILITY_RETRY_MS);
      reconnectDelay = Math.min(RECONNECT_MAX_DELAY_MS, reconnectDelay * 1.8);
    });
  };

  void connect();

  return {
    send(pose) {
      if (disposed) return;
      pendingPose = pose;
      scheduleFlush();
    },
    close() {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (pendingPose && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'pose', artworkId, ...pendingPose, active: false }));
      }
      socket?.close();
      socket = null;
    }
  };
}
