# TripoSplat Backend

This optional backend converts uploaded 2D artwork into TripoSplat Gaussian
assets and exposes `.splat` / `.ply` files to the React front end.

The existing front-end page still works without this service. Enable it only
when a GPU machine has TripoSplat and the model weights installed.

## Front-End Env

```bash
VITE_TRIPOSPLAT_ENABLED=true
VITE_TRIPOSPLAT_API_BASE=http://127.0.0.1:8000
VITE_CONTENT_MODERATION_ENABLED=true
VITE_CONTENT_MODERATION_REQUIRED=true
```

If either value is missing, uploads keep using the existing local particle
pipeline only.

## Back-End Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Install TripoSplat and its PyTorch/model dependencies in the same environment,
then set the weight paths:

```bash
set TRIPOSPLAT_REPO_ROOT=D:\path\to\TripoSplat
set TRIPOSPLAT_CKPT_PATH=D:\models\triposplat_fp16.safetensors
set TRIPOSPLAT_DECODER_PATH=D:\models\triposplat_vae_decoder_fp16.safetensors
set TRIPOSPLAT_DINOV3_PATH=D:\models\dino_v3_vit_h.safetensors
set TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH=D:\models\flux2-vae.safetensors
set TRIPOSPLAT_RMBG_PATH=D:\models\birefnet.safetensors
set TRIPOSPLAT_DEVICE=cuda
set TRIPOSPLAT_MAX_WORKERS=32
set ARK_IMAGE_MODELS=doubao-seedream-4-5-251128,doubao-seedream-5-0-260128,doubao-seedream-5-0-lite-260128,doubao-seedream-4-0-250828
set TRIPOSPLAT_MAX_ACTIVE_JOBS=3000
set TRIPOSPLAT_ESTIMATED_JOB_SECONDS=50
set TRIPOSPLAT_EFFECTIVE_PARALLEL_JOBS=1
set TRIPOSPLAT_JOB_RETENTION_SECONDS=86400
set TRIPOSPLAT_MAX_UPLOAD_BYTES=15728640
set ARK_API_KEY=your-ark-api-key
set SEEDREAM_API_KEY=your-ark-api-key
set TENCENT_SECRET_ID=your-tencent-secret-id
set TENCENT_SECRET_KEY=your-tencent-secret-key
set TENCENT_REGION=ap-guangzhou
set CONTENT_MODERATION_ENABLED=true
set CONTENT_MODERATION_REQUIRED=true
set CONTENT_MODERATION_THRESHOLD=0.82
```

FastAPI uses the configured Ark vision candidates first and automatically falls
back to Tencent Hunyuan vision for feature recognition, semantic articulation,
and high-confidence content moderation. Reference-image generation uses all
configured Seedream candidates before trying Hunyuan `SubmitHunyuanImageJob`.
Candidate order can be overridden with the comma-separated `ARK_VISION_MODELS`,
`ARK_IMAGE_MODELS`, and `HUNYUAN_VISION_MODELS` environment variables.
`CONTENT_MODERATION_THRESHOLD` is clamped to `0.50`-`0.99`; the default `0.82`
is intentionally conservative to reduce false positives. Set
`CONTENT_MODERATION_REQUIRED=false` only when a temporary fail-open mode is
explicitly acceptable.

Run the service:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Use one Uvicorn worker per GPU service. The in-process queue deliberately owns
the cached GPU model and job registry; multiple Uvicorn workers would create
separate registries and duplicate the model in GPU memory. Scale beyond one GPU
by running one service instance per GPU behind an external durable queue.

Uploads are isolated in UUID-named artwork directories. Queue capacity is reserved
atomically before content moderation and disk writes, so a burst cannot over-admit
expensive work. The API admits at most `TRIPOSPLAT_MAX_ACTIVE_JOBS` reserved,
queued, or processing jobs and returns HTTP `429` with `Retry-After` when full.
Job responses include `queuePosition`, `estimatedWaitSeconds`, and `queueCapacity`.
`TRIPOSPLAT_ESTIMATED_JOB_SECONDS` and `TRIPOSPLAT_EFFECTIVE_PARALLEL_JOBS`
control the estimate shown to clients. GPU inference itself remains exclusive for
model safety even when `TRIPOSPLAT_MAX_WORKERS` allows preparation overlap.

The default queue capacity is 3000 so a single event can accept roughly three
thousand submissions for gradual processing. This is still an in-process queue:
for production deployments that must survive service or machine restarts, replace
it with Redis/Celery (or another durable queue) and object storage.

## API

`GET /health/ai` reports configured providers, candidate models, and the latest
sanitized probe result. Run `python ../scripts/probe-ai-models.py` from this
directory for a real vision and image-generation probe, or add `--vision-only`
to avoid image-generation charges.

`POST /api/artworks`

Multipart form fields:

- `image`: source PNG/JPEG/WebP file
- `numGaussians`: `4096` to `262144`, default `65536`
- `format`: `splat`, `ply`, or `both`, default `splat`
- `submissionId`: optional client-generated request ID used to correlate every
  poll response with the originating phone submission

Returns:

```json
{
  "jobId": "job_...",
  "artworkId": "artwork_...",
  "submissionId": "client-request-uuid",
  "status": "queued"
}
```

`GET /api/jobs/{jobId}` returns status and, when ready, asset URLs:

```json
{
  "jobId": "job_...",
  "artworkId": "artwork_...",
  "submissionId": "client-request-uuid",
  "status": "ready",
  "progress": 1,
  "artwork": {
    "splatUrl": "/assets/artwork_.../model.splat",
    "plyUrl": "/assets/artwork_.../model.ply",
    "previewUrl": "/assets/artwork_.../preprocessed_image.webp",
    "manifestUrl": "/assets/artwork_.../manifest.json",
    "gaussianCount": 65536
  }
}
```
