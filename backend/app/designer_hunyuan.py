"""Hunyuan 3D generation jobs submitted from the public designer page.

Tencent credentials stay on the server. Completed GLB files are copied into
the permanent exhibition asset directory and registered in the exhibition DB,
so they inherit the same movement and showcase behaviour as award exhibits.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .exhibition_db import create_exhibition_model, delete_exhibition_model, get_exhibition_model
from .submission_telemetry import (
    find_latest_designer_job_id,
    record_submission_created,
    record_submission_cancelled,
    record_submission_finished,
    record_submission_published,
    record_submission_started,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = Path(__file__).resolve().parents[1] / "data" / "designer-generations"
EXHIBITION_ROOT = PROJECT_ROOT / "public" / "exhibition-models"
HOST = "ai3d.tencentcloudapi.com"
SERVICE = "ai3d"
VERSION = "2025-05-13"
MAX_IMAGE_TOTAL_BYTES = 4 * 1024 * 1024
MAX_IMAGE_COUNT = 8
# Hunyuan 3D Pro includes three shared concurrent jobs by default. Accounts
# with purchased concurrency packs can raise the environment value without a
# code-side cap.
MAX_ACTIVE_JOBS = max(1, int(os.getenv("HUNYUAN_DESIGNER_CONCURRENCY", "3")))
MAX_PENDING_JOBS = max(MAX_ACTIVE_JOBS, int(os.getenv("HUNYUAN_DESIGNER_QUEUE_LIMIT", "3000")))
POLL_SECONDS = max(3, int(os.getenv("HUNYUAN_DESIGNER_POLL_SECONDS", "5")))
JOB_TIMEOUT_SECONDS = max(300, int(os.getenv("HUNYUAN_DESIGNER_TIMEOUT_SECONDS", "2700")))
ALLOWED_VIEWS = {"front", "back", "left", "right", "top", "bottom", "left_front", "right_front"}
TITLE_COLORS = (
    "#f97316", "#8b5cf6", "#eab308", "#ef4444", "#3b82f6", "#ec4899",
    "#84cc16", "#f59e0b", "#a855f7", "#0ea5e9", "#f43f5e", "#65a30d",
)
ACTIVE_STATUSES = {"queued", "submitting", "waiting", "running", "saving", "publishing"}
TERMINAL_STATUSES = {"ready", "failed", "cancelled"}


def _load_server_credentials() -> None:
    if os.environ.get("TENCENT_SECRET_ID") and os.environ.get("TENCENT_SECRET_KEY"):
        return
    configured = os.getenv("HUNYUAN_ENV_FILE", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates.extend((PROJECT_ROOT / ".env.local", Path(r"D:\混元3d\.env")))
    for path in candidates:
        if not path.is_file():
            continue
        for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key in {"TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENT_REGION"} and key not in os.environ:
                os.environ[key] = value.strip().strip("\"'")
        if os.environ.get("TENCENT_SECRET_ID") and os.environ.get("TENCENT_SECRET_KEY"):
            return


_load_server_credentials()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_hex(value: bytes | str) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def _hmac_sha256(key: bytes | str, message: str) -> bytes:
    raw_key = key.encode("utf-8") if isinstance(key, str) else key
    return hmac.new(raw_key, message.encode("utf-8"), hashlib.sha256).digest()


def _signed_request(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    secret_id = os.environ.get("TENCENT_SECRET_ID", "").strip()
    secret_key = os.environ.get("TENCENT_SECRET_KEY", "").strip()
    region = os.environ.get("TENCENT_REGION", "ap-guangzhou").strip() or "ap-guangzhou"
    if not secret_id or not secret_key:
        raise RuntimeError("3D 生成服务尚未配置")

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    timestamp = int(time.time())
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    content_type = "application/json; charset=utf-8"
    canonical_headers = f"content-type:{content_type}\nhost:{HOST}\n"
    signed_headers = "content-type;host"
    canonical_request = "\n".join(
        ["POST", "/", "", canonical_headers, signed_headers, _sha256_hex(body)]
    )
    credential_scope = f"{date}/{SERVICE}/tc3_request"
    string_to_sign = "\n".join(
        ["TC3-HMAC-SHA256", str(timestamp), credential_scope, _sha256_hex(canonical_request)]
    )
    secret_date = _hmac_sha256(f"TC3{secret_key}", date)
    secret_service = _hmac_sha256(secret_date, SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = _hmac_sha256(secret_signing, string_to_sign).hex()
    authorization = (
        f"TC3-HMAC-SHA256 Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    request = Request(
        f"https://{HOST}/",
        data=body,
        method="POST",
        headers={
            "Authorization": authorization,
            "Content-Type": content_type,
            "Host": HOST,
            "X-TC-Action": action,
            "X-TC-Version": VERSION,
            "X-TC-Region": region,
            "X-TC-Timestamp": str(timestamp),
        },
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"3D 生成接口返回 HTTP {error.code}: {detail[:500]}") from error
    except URLError as error:
        raise RuntimeError(f"无法连接 3D 生成服务：{error.reason}") from error


def _response_error(response: dict[str, Any]) -> str | None:
    error = response.get("Response", {}).get("Error")
    if isinstance(error, dict):
        return f"{error.get('Code', 'TencentError')}: {error.get('Message', '请求失败')}"
    return None


@dataclass
class DesignerGenerationJob:
    id: str
    name: str
    referenceMode: str
    status: str = "queued"
    progress: float = 0.0
    message: str = "任务已进入 3D 生成队列"
    providerJobId: str | None = None
    pendingPath: str | None = None
    modelId: str | None = None
    modelUrl: str | None = None
    error: str | None = None
    createdAt: str = ""
    startedAt: str | None = None
    completedAt: str | None = None
    cancelledAt: str | None = None
    elapsedSeconds: int = 0
    sessionKey: str | None = None


_jobs: dict[str, DesignerGenerationJob] = {}
_job_lock = threading.Lock()
_state_write_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=MAX_ACTIVE_JOBS, thread_name_prefix="hunyuan-designer")


def _state_path(job_id: str) -> Path:
    return DATA_ROOT / job_id / "state.json"


def _persist_job(job: DesignerGenerationJob) -> None:
    with _state_write_lock:
        path = _state_path(job.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.part")
        temporary.write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def _restore_jobs() -> None:
    if not DATA_ROOT.is_dir():
        return
    restored: dict[str, DesignerGenerationJob] = {}
    for job_dir in DATA_ROOT.glob("designer-job-*"):
        state_path = job_dir / "state.json"
        try:
            if state_path.is_file():
                payload = json.loads(state_path.read_text(encoding="utf-8-sig"))
                fields = DesignerGenerationJob.__dataclass_fields__
                job = DesignerGenerationJob(**{key: value for key, value in payload.items() if key in fields})
            else:
                metadata_path = job_dir / "job.json"
                if not metadata_path.is_file():
                    continue
                metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
                preview_path = job_dir / "preview.glb"
                has_preview = preview_path.is_file()
                job = DesignerGenerationJob(
                    id=str(metadata.get("id") or job_dir.name),
                    name=str(metadata.get("name") or "未命名作品")[:24],
                    referenceMode="multi" if len(metadata.get("views", [])) > 1 else "single",
                    status="review" if has_preview else "failed",
                    progress=1.0 if has_preview else 0.0,
                    message="模型已生成，请后台审核" if has_preview else "历史任务未保留待审模型",
                    pendingPath=str(preview_path) if has_preview else None,
                    modelUrl=(
                        f"/triposplat/api/designer/generations/{str(metadata.get('id') or job_dir.name)}/model"
                        if has_preview else None
                    ),
                    error=None if has_preview else "服务升级前的任务没有可恢复模型",
                    createdAt=datetime.fromtimestamp(metadata_path.stat().st_mtime, tz=timezone.utc).isoformat(),
                    completedAt=datetime.fromtimestamp(job_dir.stat().st_mtime, tz=timezone.utc).isoformat(),
                )
                _persist_job(job)
            if job.status in ACTIVE_STATUSES:
                job.status = "failed"
                job.message = "服务重启前任务未完成，请重新生成"
                job.error = "生成服务重启，原任务已中止"
                job.completedAt = _now_iso()
                _persist_job(job)
            restored[job.id] = job
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
    with _job_lock:
        _jobs.update(restored)


_restore_jobs()


def designer_service_status() -> dict[str, Any]:
    with _job_lock:
        active = sum(job.status in ACTIVE_STATUSES for job in _jobs.values())
    return {
        "ready": bool(os.environ.get("TENCENT_SECRET_ID") and os.environ.get("TENCENT_SECRET_KEY")),
        "provider": "3D generation service",
        "model": "PBR GLB",
        "output": "GLB",
        "multiView": True,
        "confirmationRequired": False,
        "activeJobs": active,
        "maxActiveJobs": MAX_ACTIVE_JOBS,
    }


def create_designer_job(
    name: str,
    images: list[tuple[str, str, bytes]],
    *,
    session_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    normalized_name = " ".join(name.split()).strip()[:24]
    if not normalized_name:
        raise ValueError("请先填写作品名称")
    if not images or images[0][0] != "front":
        raise ValueError("请上传正面参考图")
    if len(images) > MAX_IMAGE_COUNT:
        raise ValueError("最多可上传 8 张参考图")
    if any(view not in ALLOWED_VIEWS for view, _, _ in images):
        raise ValueError("参考图包含不支持的视角")
    if len({view for view, _, _ in images}) != len(images):
        raise ValueError("同一视角只能上传一张参考图")
    if sum(len(content) for _, _, content in images) > MAX_IMAGE_TOTAL_BYTES:
        raise ValueError("全部参考图总大小不能超过 4MB，请压缩后重试")
    if not designer_service_status()["ready"]:
        raise RuntimeError("3D 生成服务尚未配置完成")

    normalized_session_id = (session_id or "").strip()[:128]
    session_key = _sha256_hex(normalized_session_id) if normalized_session_id else None

    with _job_lock:
        pending = sum(job.status in ACTIVE_STATUSES for job in _jobs.values())
        if pending >= MAX_PENDING_JOBS:
            raise RuntimeError("设计师生成队列已满，请稍后重试")
        job_id = f"designer-job-{uuid.uuid4().hex}"
        job = DesignerGenerationJob(
            id=job_id,
            name=normalized_name,
            referenceMode="multi" if len(images) > 1 else "single",
            createdAt=_now_iso(),
            sessionKey=session_key,
        )
        _jobs[job_id] = job

    job_dir = DATA_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    saved_images: list[tuple[str, str, Path]] = []
    for index, (view, original_name, content) in enumerate(images):
        suffix = Path(original_name).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            suffix = ".jpg"
        target = job_dir / f"{index:02d}-{view}{suffix}"
        target.write_bytes(content)
        saved_images.append((view, original_name, target))
    (job_dir / "job.json").write_text(
        json.dumps({
            "id": job_id,
            "name": normalized_name,
            "views": [view for view, _, _ in saved_images],
            "sourceNames": [original_name for _, original_name, _ in saved_images],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _persist_job(job)
    record_submission_created(
        job_id=job_id,
        submission_id=(session_id or "").strip()[:128] or None,
        artwork_id=job_id,
        source_filename="、".join(original_name for _, original_name, _ in saved_images)[:500],
        input_bytes=sum(path.stat().st_size for _, _, path in saved_images),
        channel="designer",
        reference_mode=job.referenceMode,
        client_ip=client_ip,
        user_agent=user_agent,
    )
    _executor.submit(_run_job, job_id, saved_images)
    return get_designer_job(job_id) or {}


def get_designer_job(job_id: str) -> dict[str, Any] | None:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        payload = asdict(job)
    if job.startedAt and job.status in ACTIVE_STATUSES:
        try:
            started = datetime.fromisoformat(job.startedAt)
            payload["elapsedSeconds"] = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
        except ValueError:
            pass
    payload.pop("providerJobId", None)
    payload.pop("pendingPath", None)
    payload.pop("sessionKey", None)
    for key in ("message", "error"):
        if isinstance(payload.get(key), str):
            payload[key] = re.sub(
                r"(?:腾讯\s*)?混元\s*3D(?:\s*Pro)?|腾讯\s*混元|混元|Tencent\s*Hunyuan(?:\s*3D)?(?:\s*Pro)?|Hunyuan(?:\s*3D)?(?:\s*Pro)?",
                "3D 生成服务",
                payload[key],
                flags=re.IGNORECASE,
            )
    job_meta_path = DATA_ROOT / job_id / "job.json"
    if job_meta_path.is_file():
        try:
            metadata = json.loads(job_meta_path.read_text(encoding="utf-8-sig"))
            payload["views"] = metadata.get("views", [])
            payload["sourceNames"] = metadata.get("sourceNames", [])
        except (OSError, TypeError, json.JSONDecodeError):
            payload["views"] = []
            payload["sourceNames"] = []
    model_path = get_designer_model_path(job_id)
    payload["modelBytes"] = model_path.stat().st_size if model_path else 0
    return payload


def list_designer_jobs(*, limit: int = 100) -> list[dict[str, Any]]:
    with _job_lock:
        jobs = sorted(_jobs.values(), key=lambda item: item.createdAt, reverse=True)[:max(1, min(limit, 500))]
        job_ids = [job.id for job in jobs]
    return [payload for job_id in job_ids if (payload := get_designer_job(job_id)) is not None]


def get_latest_designer_job(session_id: str) -> dict[str, Any] | None:
    normalized_session_id = session_id.strip()[:128]
    if not normalized_session_id:
        return None
    session_key = _sha256_hex(normalized_session_id)
    with _job_lock:
        matching = [job for job in _jobs.values() if job.sessionKey == session_key]
        latest = max(matching, key=lambda item: item.createdAt, default=None)
        job_id = latest.id if latest else None
    if not job_id:
        job_id = find_latest_designer_job_id(normalized_session_id)
    return get_designer_job(job_id) if job_id else None


def _job_is_cancelled(job_id: str) -> bool:
    with _job_lock:
        job = _jobs.get(job_id)
        return job is None or job.status == "cancelled"


def get_designer_model_path(job_id: str) -> Path | None:
    with _job_lock:
        job = _jobs.get(job_id)
        pending_path = job.pendingPath if job else None
    if not pending_path:
        return None
    path = Path(pending_path)
    return path if path.is_file() else None


def confirm_designer_job(job_id: str) -> dict[str, Any] | None:
    already_publishing = False
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        if job.status in {"publishing", "ready"}:
            already_publishing = True
        elif job.status != "review" or not job.pendingPath:
            raise RuntimeError("模型尚未生成完成，暂时不能加入星河")
        else:
            job.status = "publishing"
            job.progress = 1.0
            job.message = "正在将确认后的模型加入星河"
        pending_path = Path(job.pendingPath) if job.pendingPath else None
        existing_model_id = job.modelId
        model_id = f"designer-{uuid.uuid4().hex[:16]}"
        name = job.name
        reference_mode = job.referenceMode

    if already_publishing:
        return get_designer_job(job_id)

    # A previous publication may have registered the exhibition row before a
    # Windows file-lock prevented preview cleanup. Repair that partial publish
    # in place instead of creating a duplicate exhibition model.
    if existing_model_id:
        existing_record = get_exhibition_model(existing_model_id)
        if existing_record:
            filename = Path(str(existing_record["modelUrl"])).name
            target = EXHIBITION_ROOT / filename
            preview_path = DATA_ROOT / job_id / "preview.glb"
            source = pending_path if pending_path and pending_path.is_file() else preview_path
            if not target.is_file():
                if not source.is_file():
                    raise RuntimeError("待确认的 GLB 文件不存在，请重新生成")
                temporary = EXHIBITION_ROOT / f".{filename}.part"
                EXHIBITION_ROOT.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copy2(source, temporary)
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
            _update_job(
                job_id,
                status="ready",
                progress=1.0,
                message="GLB 已自动进入星河",
                modelId=existing_model_id,
                modelUrl=f"/triposplat/exhibition-models/{filename}",
                pendingPath=str(target),
                completedAt=_now_iso(),
            )
            record_submission_published(job_id=job_id, model_id=existing_model_id)
            return get_designer_job(job_id)

    try:
        if pending_path is None or not pending_path.is_file():
            raise RuntimeError("待确认的 GLB 文件不存在，请重新生成")
        filename = f"{model_id}.glb"
        EXHIBITION_ROOT.mkdir(parents=True, exist_ok=True)
        target = EXHIBITION_ROOT / filename
        temporary = EXHIBITION_ROOT / f".{filename}.part"
        try:
            shutil.copy2(pending_path, temporary)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        color_index = int(hashlib.sha256(model_id.encode("utf-8")).hexdigest()[:4], 16) % len(TITLE_COLORS)
        job_meta_path = DATA_ROOT / job_id / "job.json"
        source_names = ""
        if job_meta_path.is_file():
            try:
                metadata = json.loads(job_meta_path.read_text(encoding="utf-8-sig"))
                source_names = "、".join(str(value) for value in metadata.get("sourceNames", []))[:250]
            except (OSError, json.JSONDecodeError, TypeError):
                source_names = ""
        record = create_exhibition_model({
            "id": model_id,
            "name": name,
            "modelUrl": f"/exhibition-models/{filename}",
            "previewUrl": None,
            "color": TITLE_COLORS[color_index],
            "position": [0, 0, 0],
            "scale": 0.4,
            "sourceFolder": "设计师生成",
            "sourceImage": source_names,
            "referenceMode": reference_mode,
            "entryType": "contest",
        })
        _update_job(
            job_id,
            status="ready",
            message="GLB 已自动进入星河",
            modelId=record["id"],
            modelUrl=f"/triposplat/exhibition-models/{filename}",
            pendingPath=str(target),
            completedAt=_now_iso(),
        )
        # The preview can still be streamed by the browser on Windows. Cleanup
        # is best-effort and must never roll back an otherwise valid publish.
        try:
            pending_path.unlink(missing_ok=True)
        except OSError:
            pass
        record_submission_published(job_id=job_id, model_id=record["id"])
        return get_designer_job(job_id)
    except Exception:
        if 'target' in locals():
            target.unlink(missing_ok=True)
        _update_job(job_id, status="review", message="模型已生成，请预览确认")
        raise


def cancel_designer_job(job_id: str) -> dict[str, Any] | None:
    already_cancelled = False
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        if job.status == "publishing":
            raise RuntimeError("模型正在提交，请稍后再撤销")
        if job.status == "cancelled":
            already_cancelled = True
        pending_path = Path(job.pendingPath) if job.pendingPath else None
        model_id = job.modelId

    if already_cancelled:
        return get_designer_job(job_id)

    if model_id:
        delete_exhibition_model(model_id)
    _update_job(
        job_id,
        status="cancelled",
        message="本次模型已撤销，不会进入星河",
        cancelledAt=_now_iso(),
        completedAt=_now_iso(),
    )
    if pending_path and pending_path.is_file() and not model_id:
        pending_path.unlink(missing_ok=True)
    record_submission_cancelled(job_id=job_id)
    return get_designer_job(job_id)


def _update_job(job_id: str, **values: Any) -> None:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        if job.status == "cancelled" and values.get("status") != "cancelled":
            return
        for key, value in values.items():
            setattr(job, key, value)
        snapshot = DesignerGenerationJob(**asdict(job))
        _persist_job(snapshot)


def _run_job(job_id: str, images: list[tuple[str, str, Path]]) -> None:
    started = time.monotonic()
    _update_job(job_id, status="submitting", progress=0.08, message="正在提交参考图", startedAt=_now_iso())
    with _job_lock:
        created_at = _jobs.get(job_id).createdAt if _jobs.get(job_id) else None
    queue_ms = 0.0
    if created_at:
        try:
            queue_ms = max(0.0, (datetime.now(timezone.utc) - datetime.fromisoformat(created_at)).total_seconds() * 1000)
        except ValueError:
            queue_ms = 0.0
    record_submission_started(job_id=job_id, queue_ms=queue_ms)
    try:
        primary = base64.b64encode(images[0][2].read_bytes()).decode("ascii")
        payload: dict[str, Any] = {
            "Model": "3.1",
            "EnablePBR": True,
            "FaceCount": 100000,
            "GenerateType": "Normal",
            "ImageBase64": primary,
        }
        if len(images) > 1:
            payload["MultiViewImages"] = [
                {
                    "ViewType": view,
                    "ViewImageBase64": base64.b64encode(path.read_bytes()).decode("ascii"),
                }
                for view, _, path in images[1:]
            ]
        encoded_size = len(primary) + sum(len(item["ViewImageBase64"]) for item in payload.get("MultiViewImages", []))
        if encoded_size > 6 * 1024 * 1024:
            raise RuntimeError("参考图编码后超过 6MB 限制，请压缩图片")

        response = _signed_request("SubmitHunyuanTo3DProJob", payload)
        error = _response_error(response)
        if error:
            raise RuntimeError(error)
        provider_job_id = str(response.get("Response", response).get("JobId", "")).strip()
        if not provider_job_id:
            raise RuntimeError("3D 生成服务未返回任务编号")
        _update_job(job_id, providerJobId=provider_job_id, status="waiting", progress=0.16, message="3D 生成任务正在排队")

        result_files: list[dict[str, Any]] = []
        while time.monotonic() - started < JOB_TIMEOUT_SECONDS:
            time.sleep(POLL_SECONDS)
            if _job_is_cancelled(job_id):
                return
            query = _signed_request("QueryHunyuanTo3DProJob", {"JobId": provider_job_id})
            error = _response_error(query)
            if error:
                raise RuntimeError(error)
            body = query.get("Response", query)
            status = str(body.get("Status", "UNKNOWN")).upper()
            elapsed = int(time.monotonic() - started)
            if status == "FAIL":
                raise RuntimeError(str(body.get("ErrorMessage") or body.get("ErrorCode") or "3D 模型生成失败"))
            if status == "DONE":
                result_files = [item for item in (body.get("ResultFile3Ds") or []) if isinstance(item, dict)]
                break
            progress = min(0.88, 0.22 + elapsed / 300 * 0.58)
            _update_job(
                job_id,
                status="running" if status == "RUN" else "waiting",
                progress=progress,
                message="正在生成几何与 PBR 纹理" if status == "RUN" else "3D 生成任务正在排队",
                elapsedSeconds=elapsed,
            )
        else:
            raise RuntimeError("3D 模型生成超时，请稍后重新提交")

        glb_file = next(
            (item for item in result_files if str(item.get("Type", "")).upper() == "GLB" and item.get("Url")),
            next((item for item in result_files if str(item.get("Url", "")).lower().split("?", 1)[0].endswith(".glb")), None),
        )
        if not glb_file:
            raise RuntimeError("3D 模型已完成，但没有返回 GLB 文件")
        if _job_is_cancelled(job_id):
            return
        _update_job(job_id, status="saving", progress=0.92, message="正在准备可交互的 GLB 预览")

        job_dir = DATA_ROOT / job_id
        target = job_dir / "preview.glb"
        temporary = job_dir / ".preview.glb.part"
        try:
            with urlopen(str(glb_file["Url"]), timeout=180) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            if temporary.stat().st_size < 20 or temporary.read_bytes()[:4] != b"glTF":
                raise RuntimeError("下载到的文件不是有效 GLB")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

        if _job_is_cancelled(job_id):
            target.unlink(missing_ok=True)
            return

        elapsed = int(time.monotonic() - started)
        _update_job(
            job_id,
            status="review",
            progress=1.0,
            message="模型已生成，请全方位预览后确认",
            pendingPath=str(target),
            modelUrl=f"/triposplat/api/designer/generations/{job_id}/model",
            completedAt=_now_iso(),
            elapsedSeconds=elapsed,
        )
        record_submission_finished(
            job_id=job_id,
            status="review",
            success=True,
            total_ms=elapsed * 1000,
            generation_ms=elapsed * 1000,
            output_bytes=target.stat().st_size,
        )
        # Designer submissions publish as soon as the GLB is ready. Keeping the
        # existing confirmation function as the single publication path makes
        # the operation idempotent and preserves exhibition/telemetry updates.
        confirm_designer_job(job_id)
    except Exception as error:  # noqa: BLE001 - expose a concise job error to its submitting page
        elapsed = int(time.monotonic() - started)
        _update_job(
            job_id,
            status="failed",
            message="生成失败",
            error=str(error)[:800],
            completedAt=_now_iso(),
            elapsedSeconds=elapsed,
        )
        record_submission_finished(
            job_id=job_id,
            status="failed",
            success=False,
            total_ms=elapsed * 1000,
            generation_ms=elapsed * 1000,
            error_message=str(error),
        )
