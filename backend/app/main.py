import asyncio
import asyncio
import json
import os
import re
import shutil
import uuid
from math import isfinite, pi
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai_model_registry import ai_model_status
from .admin_auth import (
    ensure_admin_auth_schema,
    is_admin_authenticated,
    issue_admin_session,
    require_admin,
    revoke_admin_session,
    verify_password,
)
from .artwork_features import analyze_artwork_features
from .artwork_db import (
    backfill_existing_outputs,
    count_artworks,
    delete_artwork_permanently,
    get_artwork,
    list_artworks,
    restore_artwork,
    soft_delete_artwork,
    update_artwork_evolution,
    update_artwork_metadata,
)
from .exhibition_db import (
    create_exhibition_model,
    delete_exhibition_model,
    ensure_exhibition_schema,
    get_exhibition_model,
    list_exhibition_models,
    restore_exhibition_model,
    seed_exhibition_models,
    update_exhibition_model,
)
from .designer_hunyuan import (
    cancel_designer_job,
    confirm_designer_job,
    create_designer_job,
    designer_service_status,
    get_designer_job,
    get_latest_designer_job,
    get_designer_model_path,
    list_designer_jobs,
)
from .jobs import JobQueueFullError, job_to_response, jobs
from .model_control import model_control_hub
from .perf_logger import log_perf
from .content_moderation import (
    CONTENT_MODERATION_REJECTED,
    CONTENT_MODERATION_UNAVAILABLE,
    ContentModerationRejectedError,
    ContentModerationUnavailableError,
    InvalidArtworkImageError,
    mask_sensitive_text,
    moderate_image_data_url,
    moderate_image_file,
)
from .schemas import (
    ArtworkEvolutionBatchUpdate,
    ArtworkMetadataUpdate,
    ExhibitionModel,
    ExhibitionModelCreate,
    ExhibitionModelUpdate,
    JobResponse,
    JobStatus,
    PersistedArtwork,
)
from .storage import UploadTooLargeError, create_artwork_dir, ensure_output_root, output_roots, save_upload
from .submission_telemetry import (
    claim_submission_opportunity,
    ensure_submission_telemetry_schema,
    get_submission_eligibility,
    get_submission_metrics,
    get_submission_user_detail,
    get_submission_users,
    mark_interrupted_submissions_failed,
    release_submission_opportunity,
)
from .system_settings import (
    ensure_system_settings_schema,
    get_submit_test_entry_setting,
    set_submit_test_entry_setting,
)
from .triposplat_worker import triposplat_config_status


app = FastAPI(title="AI Sketch Cosmos 3D Model Service")
MAX_UPLOAD_BYTES = int(os.getenv("TRIPOSPLAT_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
SUBMISSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class ArtworkFeatureRequest(BaseModel):
    imageDataUrl: str


class SubmissionEligibilityRequest(BaseModel):
    userContext: dict[str, object] | None = None


class SubmitTestEntrySettingUpdate(BaseModel):
    enabled: bool


class AdminLoginRequest(BaseModel):
    password: str


class MultiRootStaticFiles(StaticFiles):
    """Serve the canonical asset directory plus any legacy cwd-relative directory."""

    def __init__(self, directories: tuple[Path, ...]) -> None:
        super().__init__(directory=str(directories[0]))
        self.all_directories = [str(directory) for directory in directories]

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200 and Path(path).suffix.lower() in {".splat", ".ply", ".bin"}:
            response.headers["Content-Type"] = "application/octet-stream"
            response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
            response.headers["CDN-Cache-Control"] = "public, max-age=86400"
        return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

ensure_output_root()
app.mount("/assets", MultiRootStaticFiles(output_roots()), name="assets")
EXHIBITION_ASSET_ROOT = Path(__file__).resolve().parents[2] / "public" / "exhibition-models"
if EXHIBITION_ASSET_ROOT.is_dir():
    app.mount("/exhibition-models", StaticFiles(directory=str(EXHIBITION_ASSET_ROOT)), name="exhibition-models")


@app.on_event("startup")
def hydrate_artwork_database():
    imported = backfill_existing_outputs()
    if imported:
        print(f"[artwork-db] imported {imported} existing artwork outputs")
    ensure_exhibition_schema()
    ensure_submission_telemetry_schema()
    interrupted = mark_interrupted_submissions_failed()
    if interrupted:
        print(f"[submission-telemetry] marked {interrupted} interrupted job(s) as failed")
    ensure_system_settings_schema()
    ensure_admin_auth_schema()
    seeded = seed_exhibition_models()
    if seeded:
        print(f"[exhibition-db] seeded {seeded} permanent exhibition models")


@app.get("/health")
def health():
    return {"ok": True, "modelControl": True}


@app.get("/api/designer/health")
def designer_health():
    return designer_service_status()


@app.post("/api/designer/generations", status_code=202)
async def create_designer_generation(
    request: Request,
    response: Response,
    name: str = Form(..., min_length=1, max_length=24),
    viewTypes: str = Form(..., max_length=256),
    sessionId: str | None = Form(default=None, max_length=128),
    images: list[UploadFile] = File(...),
):
    try:
        parsed_views = json.loads(viewTypes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="视角参数格式错误") from exc
    if not isinstance(parsed_views, list) or len(parsed_views) != len(images):
        raise HTTPException(status_code=400, detail="参考图和视角数量不一致")
    uploaded: list[tuple[str, str, bytes]] = []
    for view, image in zip(parsed_views, images, strict=True):
        content_type = (image.content_type or "").lower()
        if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
            raise HTTPException(status_code=400, detail="仅支持 JPG、PNG 和 WEBP 图片")
        uploaded.append((str(view), image.filename or f"{view}.jpg", await image.read()))
    try:
        forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        client_ip = request.headers.get("cf-connecting-ip") or forwarded_for or (request.client.host if request.client else None)
        normalized_session_id = (sessionId or "").strip()[:128]
        job = create_designer_job(
            mask_sensitive_text(name),
            uploaded,
            session_id=normalized_session_id,
            client_ip=client_ip,
            user_agent=request.headers.get("user-agent"),
        )
        if normalized_session_id:
            forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
            response.set_cookie(
                "designer_session",
                normalized_session_id,
                max_age=60 * 60 * 24 * 365,
                httponly=True,
                secure=request.url.scheme == "https" or forwarded_proto == "https",
                samesite="lax",
                path="/",
            )
        return job
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/designer/generations/latest")
def get_latest_designer_generation(
    request: Request,
    sessionId: str | None = Query(default=None, max_length=128),
):
    session_id = (sessionId or request.cookies.get("designer_session") or "").strip()[:128]
    if not session_id:
        raise HTTPException(status_code=404, detail="没有可恢复的生成任务")
    job = get_latest_designer_job(session_id)
    if job is None:
        raise HTTPException(status_code=404, detail="没有可恢复的生成任务")
    return job


@app.get("/api/designer/generations/{job_id}")
def get_designer_generation(job_id: str):
    job = get_designer_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="设计师生成任务不存在或服务已重启")
    return job


@app.get("/api/designer/generations/{job_id}/model")
def get_designer_generation_model(job_id: str, download: bool = Query(False)):
    model_path = get_designer_model_path(job_id)
    if model_path is None:
        raise HTTPException(status_code=404, detail="待确认模型不存在或尚未生成完成")
    response_kwargs = {
        "media_type": "model/gltf-binary",
        "headers": {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    }
    if download:
        response_kwargs["filename"] = f"{job_id}.glb"
    return FileResponse(model_path, **response_kwargs)


@app.post("/api/designer/generations/{job_id}/confirm")
def confirm_designer_generation(job_id: str):
    try:
        job = confirm_designer_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="设计师生成任务不存在或服务已重启")
    return job


@app.get("/api/admin/designer-generations")
def admin_designer_generations(request: Request, limit: int = Query(100, ge=1, le=500)):
    require_admin(request)
    return {"jobs": list_designer_jobs(limit=limit)}


@app.post("/api/admin/designer-generations/{job_id}/confirm")
def admin_confirm_designer_generation(job_id: str, request: Request):
    require_admin(request)
    try:
        job = confirm_designer_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="设计师生成任务不存在")
    return job


@app.post("/api/admin/designer-generations/{job_id}/cancel")
def admin_cancel_designer_generation(job_id: str, request: Request):
    require_admin(request)
    try:
        job = cancel_designer_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="设计师生成任务不存在")
    return job


@app.get("/health/triposplat")
def triposplat_health():
    return {**triposplat_config_status(), "queue": jobs.stats()}


@app.get("/health/ai")
def ai_health():
    return ai_model_status()


@app.get("/api/settings/submit-test-entry")
def submit_test_entry_setting():
    """Public read used by /submit before offering the controlled test bypass."""
    return get_submit_test_entry_setting()


@app.get("/api/admin/auth/status")
def admin_auth_status(request: Request):
    return {"authenticated": is_admin_authenticated(request)}


@app.post("/api/admin/auth/login")
def admin_auth_login(payload: AdminLoginRequest, request: Request, response: Response):
    if not verify_password(payload.password, request):
        raise HTTPException(status_code=401, detail="密码错误")
    issue_admin_session(response, request)
    return {"authenticated": True}


@app.post("/api/admin/auth/logout")
def admin_auth_logout(request: Request, response: Response):
    revoke_admin_session(response, request)
    return {"authenticated": False}


@app.put("/api/admin/settings/submit-test-entry")
def update_submit_test_entry_setting(payload: SubmitTestEntrySettingUpdate, request: Request):
    require_admin(request)
    return set_submit_test_entry_setting(payload.enabled)


@app.post("/api/ai/artwork-features")
@app.post("/api/artwork-features")
def artwork_features(payload: ArtworkFeatureRequest):
    image_data_url = payload.imageDataUrl.strip()
    if not image_data_url.startswith("data:image/") or ";base64," not in image_data_url[:100]:
        raise HTTPException(status_code=400, detail="imageDataUrl must be a Base64 image data URL")
    if len(image_data_url) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="imageDataUrl is too large")
    try:
        features, completion = analyze_artwork_features(image_data_url)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="AI feature recognition is temporarily unavailable") from exc
    return {
        "features": features,
        "provider": completion.provider,
        "model": completion.model,
    }


@app.post("/api/ai/content-moderation")
@app.post("/api/content-moderation")
def content_moderation(payload: ArtworkFeatureRequest):
    try:
        result = moderate_image_data_url(payload.imageDataUrl.strip())
    except ContentModerationRejectedError as exc:
        return JSONResponse(
            status_code=422,
            content={
                "allowed": False,
                "category": exc.result.category,
                "confidence": exc.result.confidence,
                "code": CONTENT_MODERATION_REJECTED,
                "message": str(exc),
            },
        )
    except InvalidArtworkImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ContentModerationUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "allowed": False,
                "code": CONTENT_MODERATION_UNAVAILABLE,
                "message": str(exc),
            },
        )
    return {
        "allowed": True,
        "category": result.category,
        "confidence": result.confidence,
    }


@app.websocket("/api/model-control")
async def model_control(websocket: WebSocket):
    role = websocket.query_params.get("role", "")
    if role == "display":
        await model_control_hub.connect_display(websocket)
        try:
            while True:
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=8)
                except asyncio.TimeoutError:
                    await model_control_hub.send_heartbeat(websocket)
        except WebSocketDisconnect:
            pass
        finally:
            await model_control_hub.disconnect_display(websocket)
        return

    if role == "admin":
        if not is_admin_authenticated(websocket):
            await websocket.close(code=1008, reason="admin authentication required")
            return
        await websocket.accept()
        try:
            while True:
                payload = await websocket.receive_json()
                if not isinstance(payload, dict) or payload.get("type") != "display-command":
                    continue
                command = payload.get("command")
                if command not in {"clear-artworks", "stress-start", "stress-clear", "toggle-fullscreen"}:
                    continue
                outgoing = {"type": "display-command", "command": command}
                if command == "stress-start":
                    target = payload.get("target")
                    if not isinstance(target, (int, float)) or not isfinite(target):
                        continue
                    outgoing["target"] = max(1, min(4000, round(float(target))))
                await model_control_hub.broadcast_command(outgoing)
        except WebSocketDisconnect:
            return

    if role != "controller":
        await websocket.close(code=1008, reason="invalid model-control role")
        return

    await websocket.accept()
    last_message_at = 0.0
    try:
        while True:
            payload = await websocket.receive_json()
            now = perf_counter()
            if now - last_message_at < 0.025 or not isinstance(payload, dict):
                continue

            artwork_id = payload.get("artworkId")
            yaw = payload.get("yaw")
            pitch = payload.get("pitch")
            offset_x = payload.get("offsetX", 0)
            offset_y = payload.get("offsetY", 0)
            offset_z = payload.get("offsetZ", 0)
            if (
                not isinstance(artwork_id, str)
                or not SUBMISSION_ID_PATTERN.fullmatch(artwork_id)
                or not isinstance(yaw, (int, float))
                or not isinstance(pitch, (int, float))
                or not isinstance(offset_x, (int, float))
                or not isinstance(offset_y, (int, float))
                or not isinstance(offset_z, (int, float))
                or not isfinite(yaw)
                or not isfinite(pitch)
                or not isfinite(offset_x)
                or not isfinite(offset_y)
                or not isfinite(offset_z)
            ):
                continue

            last_message_at = now
            await model_control_hub.broadcast_pose({
                "type": "pose",
                "artworkId": artwork_id,
                "yaw": max(-pi, min(pi, float(yaw))),
                "pitch": max(-pi / 2, min(pi / 2, float(pitch))),
                "offsetX": max(-0.85, min(0.85, float(offset_x))),
                "offsetY": max(-0.85, min(0.85, float(offset_y))),
                "offsetZ": max(-0.85, min(0.85, float(offset_z))),
                "active": bool(payload.get("active", False)),
            })
    except WebSocketDisconnect:
        return


@app.post("/api/submission-eligibility")
def submission_eligibility(payload: SubmissionEligibilityRequest):
    return get_submission_eligibility(payload.userContext)


@app.get("/api/artworks", response_model=list[PersistedArtwork])
def get_artworks(
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    status: str = Query("active", pattern="^(active|deleted|all)$"),
    sort: str = Query("created_desc", pattern="^(created_desc|level_desc)$"),
):
    response.headers["X-Total-Count"] = str(count_artworks(status=status))
    return list_artworks(limit=limit, offset=offset, status=status, sort=sort)


@app.get("/api/admin/submission-metrics")
@app.get("/api/metrics/submissions")
def submission_metrics(
    request: Request,
    windowHours: int = Query(24, ge=1, le=168),
    limit: int = Query(16, ge=1, le=100),
    chartDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    timezoneOffsetMinutes: int = Query(480, ge=-720, le=840),
):
    """Return generation timing, outcome, and traffic aggregates for admins."""
    require_admin(request)
    return {
        **get_submission_metrics(
            window_hours=windowHours,
            limit=limit,
            chart_date=chartDate,
            timezone_offset_minutes=timezoneOffsetMinutes,
        ),
        "queue": jobs.stats(),
    }


@app.get("/api/admin/submission-users")
def submission_users(
    request: Request,
    query: str = Query("", max_length=100),
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    require_admin(request)
    return get_submission_users(query=query, limit=limit, offset=offset)


@app.get("/api/admin/submission-users/{user_id}")
def submission_user_detail(user_id: str, request: Request):
    require_admin(request)
    detail = get_submission_user_detail(user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="submission user not found")
    return detail


@app.get("/api/exhibition-models", response_model=list[ExhibitionModel])
def get_exhibition_models(includeDeleted: bool = Query(False)):
    return list_exhibition_models(include_deleted=includeDeleted)


@app.get("/api/exhibition-models/{model_id}", response_model=ExhibitionModel)
def get_exhibition_model_by_id(model_id: str):
    model = get_exhibition_model(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="exhibition model not found")
    return model


@app.post("/api/exhibition-models", response_model=ExhibitionModel, status_code=201)
def create_exhibition_model_record(payload: ExhibitionModelCreate, request: Request):
    require_admin(request)
    try:
        return create_exhibition_model(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/exhibition-models/{model_id}", response_model=ExhibitionModel)
def patch_exhibition_model(model_id: str, payload: ExhibitionModelUpdate, request: Request):
    require_admin(request)
    try:
        model = update_exhibition_model(model_id, {key: value for key, value in payload.model_dump().items() if value is not None})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if model is None:
        raise HTTPException(status_code=404, detail="exhibition model not found")
    return model


@app.delete("/api/exhibition-models/{model_id}")
def remove_exhibition_model(model_id: str, request: Request):
    require_admin(request)
    if not delete_exhibition_model(model_id):
        raise HTTPException(status_code=404, detail="exhibition model not found")
    return {"ok": True}


@app.post("/api/exhibition-models/{model_id}/restore")
def restore_exhibition_model_record(model_id: str, request: Request):
    require_admin(request)
    if not restore_exhibition_model(model_id):
        raise HTTPException(status_code=404, detail="exhibition model not found")
    return {"ok": True}


@app.get("/api/artworks/{artwork_id}", response_model=PersistedArtwork)
def get_artwork_by_id(artwork_id: str):
    artwork = get_artwork(artwork_id)
    if artwork is None:
        raise HTTPException(status_code=404, detail="artwork not found")
    return artwork


@app.post("/api/artworks", response_model=JobResponse)
def create_artwork_job(
    request: Request,
    image: UploadFile = File(...),
    numGaussians: int = Form(65_536),
    format: str = Form("splat"),
    features: str | None = Form(None),
    submissionId: str | None = Form(None),
    name: str | None = Form(None, max_length=18),
    userContext: str | None = Form(None),
    anonymous: bool = Form(False),
):
    request_start = perf_counter()
    triposplat_status = triposplat_config_status()
    if not triposplat_status["ready"]:
        raise HTTPException(status_code=503, detail={"message": "3D model service is not ready", "status": triposplat_status})

    export_format = format.lower()
    if export_format not in {"splat", "ply", "both"}:
        raise HTTPException(status_code=400, detail="format must be one of: splat, ply, both")

    if numGaussians < 4_096 or numGaussians > 262_144:
        raise HTTPException(status_code=400, detail="numGaussians must be between 4096 and 262144")

    client_submission_id = submissionId.strip() if submissionId else None
    if client_submission_id and not SUBMISSION_ID_PATTERN.fullmatch(client_submission_id):
        raise HTTPException(status_code=400, detail="submissionId contains invalid characters")

    parsed_user_context = None
    if not anonymous and userContext and len(userContext) <= 512 * 1024:
        try:
            parsed_user_context = json.loads(userContext)
            if not isinstance(parsed_user_context, dict):
                parsed_user_context = None
        except json.JSONDecodeError:
            parsed_user_context = None

    job_id = f"job_{uuid.uuid4().hex}"
    artwork_id, artwork_dir = create_artwork_dir()
    opportunity = claim_submission_opportunity(
        user_context=parsed_user_context,
        job_id=job_id,
        submission_id=client_submission_id,
        artwork_id=artwork_id,
    )
    if not opportunity.get("eligible", False):
        shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SUBMISSION_LIMIT_REACHED",
                "message": "每位预约用户只有一次创作机会，本次创作已经完成。",
                "artworkId": opportunity.get("artworkId"),
                "status": opportunity.get("status"),
            },
        )
    claim_identity_key = opportunity.get("identityKey")

    try:
        reservation_id: str | None = jobs.reserve()
    except JobQueueFullError as exc:
        release_submission_opportunity(
            identity_key=claim_identity_key if isinstance(claim_identity_key, str) else None,
            job_id=job_id,
        )
        shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(
            status_code=429,
            detail="generation queue is full; retry later",
            headers={"Retry-After": "30"},
        ) from exc

    try:
        try:
            moderate_image_file(image.file)
        except ContentModerationRejectedError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": CONTENT_MODERATION_REJECTED,
                    "message": str(exc),
                    "category": exc.result.category,
                    "confidence": exc.result.confidence,
                },
            ) from exc
        except ContentModerationUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": CONTENT_MODERATION_UNAVAILABLE,
                    "message": str(exc),
                },
            ) from exc
        except InvalidArtworkImageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        safe_name = mask_sensitive_text(name).strip() if name else None
        if not safe_name:
            safe_name = None

        source_suffix = Path(image.filename or '').suffix.lower()
        if source_suffix not in {'.jpg', '.jpeg', '.png', '.webp'}:
            source_suffix = '.png'
        source_filename = f'anonymous-artwork{source_suffix}' if anonymous else (image.filename or 'source.png')

        save_start = perf_counter()
        source_path = save_upload(
            image.file,
            artwork_dir,
            source_filename,
            max_bytes=MAX_UPLOAD_BYTES,
        )
        log_perf(
            artwork_id,
            "request",
            "save_upload",
            (
                f"elapsed={perf_counter() - save_start:.3f}s "
                f"filename={source_filename} bytes={source_path.stat().st_size}"
            ),
        )
        parsed_features = None
        if features:
            try:
                parsed_features = json.loads(features)
                if not isinstance(parsed_features, dict):
                    raise ValueError("features must decode to an object")
            except (json.JSONDecodeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=f"invalid features JSON: {exc}") from exc

        forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        client_ip = None if anonymous else (
            request.headers.get("cf-connecting-ip")
            or forwarded_for
            or (request.client.host if request.client else None)
        )

        job = jobs.create(
            job_id=job_id,
            artwork_id=artwork_id,
            submission_id=client_submission_id,
            artwork_dir=artwork_dir,
            source_path=source_path,
            num_gaussians=numGaussians,
            export_format=export_format,
            display_name=safe_name,
            features=parsed_features,
            source_filename=source_filename,
            source_size_bytes=source_path.stat().st_size,
            user_context=parsed_user_context,
            client_ip=client_ip,
            user_agent=None if anonymous else request.headers.get("user-agent"),
            reservation_id=reservation_id,
        )
        reservation_id = None
        claim_identity_key = None
    except UploadTooLargeError as exc:
        if artwork_dir is not None:
            shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(status_code=413, detail=f"image exceeds {MAX_UPLOAD_BYTES} bytes") from exc
    except JobQueueFullError as exc:
        if artwork_dir is not None:
            shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(
            status_code=429,
            detail="generation queue is full; retry later",
            headers={"Retry-After": "30"},
        ) from exc
    except Exception:
        if artwork_dir is not None:
            shutil.rmtree(artwork_dir, ignore_errors=True)
        raise
    finally:
        jobs.release(reservation_id)
        release_submission_opportunity(
            identity_key=claim_identity_key if isinstance(claim_identity_key, str) else None,
            job_id=job_id,
        )
    log_perf(
        artwork_id,
        job.job_id,
        "request:end",
        (
            f"elapsed={perf_counter() - request_start:.3f}s gaussians={numGaussians} format={export_format}"
        ),
    )
    return job_to_response(job)


@app.patch("/api/artworks/{artwork_id}/metadata")
def patch_artwork_metadata(artwork_id: str, payload: ArtworkMetadataUpdate, request: Request):
    require_admin(request)
    safe_name = mask_sensitive_text(payload.name).strip() if payload.name is not None else None
    updated = update_artwork_metadata(
        artwork_id,
        name=safe_name,
        width=payload.width,
        height=payload.height,
        aspect=payload.aspect,
        features=payload.features,
        gaussian_model=payload.gaussianModel,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.patch("/api/artworks/evolution")
def patch_artwork_evolution(payload: ArtworkEvolutionBatchUpdate):
    records = [record.model_dump() for record in payload.records]
    updated = update_artwork_evolution(records)
    return {"ok": True, "updated": updated}


@app.delete("/api/artworks/{artwork_id}")
def remove_artwork(artwork_id: str, request: Request):
    require_admin(request)
    deleted = soft_delete_artwork(artwork_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.post("/api/artworks/{artwork_id}/restore")
def restore_removed_artwork(artwork_id: str, request: Request):
    require_admin(request)
    restored = restore_artwork(artwork_id)
    if not restored:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.delete("/api/artworks/{artwork_id}/permanent")
def remove_artwork_permanently(artwork_id: str, request: Request):
    require_admin(request)
    deleted = delete_artwork_permanently(artwork_id, delete_files=True)
    if not deleted:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    waitMs: int = Query(0, ge=0, le=30_000),
    lastStatus: JobStatus | None = None,
    lastProgress: float | None = None,
):
    job = jobs.get(job_id)
    if (
        waitMs > 0
        and job is not None
        and (lastStatus is not None or lastProgress is not None)
    ):
        deadline = asyncio.get_running_loop().time() + waitMs / 1000
        while (
            job.status not in {JobStatus.ready, JobStatus.failed}
            and (lastStatus is None or job.status == lastStatus)
            and (lastProgress is None or job.progress == lastProgress)
        ):
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            await asyncio.sleep(min(1.0, remaining))
            job = jobs.get(job_id)
            if job is None:
                break
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job_to_response(job)
