import asyncio
from time import monotonic
from typing import Any

from fastapi import WebSocket


class ModelControlHub:
    """In-memory relay for transient mobile-to-display model controls."""

    _LATEST_POSE_TTL_SECONDS = 300
    _LATEST_POSE_LIMIT = 256

    def __init__(self) -> None:
        self._displays: set[WebSocket] = set()
        self._display_send_locks: dict[WebSocket, asyncio.Lock] = {}
        self._latest_poses: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def connect_display(self, websocket: WebSocket) -> None:
        await websocket.accept()
        send_lock = asyncio.Lock()
        now = monotonic()
        async with self._lock:
            self._purge_latest_poses(now)
            self._displays.add(websocket)
            self._display_send_locks[websocket] = send_lock
            latest_poses = tuple(payload for _, payload in self._latest_poses.values())

        try:
            # A phone can start moving a model before the display socket or the
            # newly generated model is ready. Replay the most recent pose so the
            # first interaction is not lost during that timing window.
            async with send_lock:
                for payload in latest_poses:
                    await websocket.send_json(payload)
        except Exception:
            await self.disconnect_display(websocket)
            raise

    async def disconnect_display(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._displays.discard(websocket)
            self._display_send_locks.pop(websocket, None)

    def _purge_latest_poses(self, now: float) -> None:
        expired = [
            artwork_id
            for artwork_id, (received_at, _) in self._latest_poses.items()
            if now - received_at > self._LATEST_POSE_TTL_SECONDS
        ]
        for artwork_id in expired:
            self._latest_poses.pop(artwork_id, None)

        overflow = len(self._latest_poses) - self._LATEST_POSE_LIMIT
        if overflow > 0:
            oldest = sorted(self._latest_poses.items(), key=lambda entry: entry[1][0])[:overflow]
            for artwork_id, _ in oldest:
                self._latest_poses.pop(artwork_id, None)

    async def broadcast_pose(self, payload: dict[str, Any]) -> None:
        artwork_id = payload.get("artworkId")
        now = monotonic()
        async with self._lock:
            if isinstance(artwork_id, str):
                self._latest_poses[artwork_id] = (now, dict(payload))
                self._purge_latest_poses(now)
            displays = tuple(
                (display, self._display_send_locks[display])
                for display in self._displays
                if display in self._display_send_locks
            )

        disconnected: list[WebSocket] = []
        for display, send_lock in displays:
            try:
                async with send_lock:
                    await display.send_json(payload)
            except Exception:
                disconnected.append(display)

        if disconnected:
            async with self._lock:
                for display in disconnected:
                    self._displays.discard(display)
                    self._display_send_locks.pop(display, None)

    async def send_heartbeat(self, websocket: WebSocket) -> None:
        async with self._lock:
            send_lock = self._display_send_locks.get(websocket)
        if send_lock is None:
            return
        async with send_lock:
            await websocket.send_json({"type": "heartbeat"})


model_control_hub = ModelControlHub()
