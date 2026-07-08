from datetime import datetime, timezone
from pathlib import Path
from threading import Lock


BACKEND_ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = BACKEND_ROOT / "data" / "generation-perf.log"
_log_lock = Lock()


def log_perf(artwork_id: str, scope: str, stage: str, message: str = "") -> None:
    suffix = f" {message}" if message else ""
    line = f"[perf][{datetime.now(timezone.utc).isoformat()}][{artwork_id}][{scope}] {stage}{suffix}"
    print(line, flush=True)
    with _log_lock:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as file:
            file.write(f"{line}\n")
