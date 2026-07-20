# TripoSplat Backend

This optional backend converts uploaded 2D artwork into TripoSplat Gaussian
assets and exposes `.splat` / `.ply` files to the React front end.

The existing front-end page still works without this service. Enable it only
when a GPU machine has TripoSplat and the model weights installed.

## Front-End Env

```bash
VITE_TRIPOSPLAT_ENABLED=true
VITE_TRIPOSPLAT_API_BASE=http://127.0.0.1:8000
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
set TRIPOSPLAT_MAX_WORKERS=2
set TRIPOSPLAT_MAX_ACTIVE_JOBS=24
set TRIPOSPLAT_MAX_UPLOAD_BYTES=15728640
```

Run the service:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Use one Uvicorn worker per GPU service. The in-process queue deliberately owns
the cached GPU model and job registry; multiple Uvicorn workers would create
separate registries and duplicate the model in GPU memory. Scale beyond one GPU
by running one service instance per GPU behind an external durable queue.

Uploads are isolated in UUID-named artwork directories. The API admits at most
`TRIPOSPLAT_MAX_ACTIVE_JOBS` queued or processing jobs, returns HTTP `429` with
`Retry-After` when full, serializes access to the shared GPU pipeline, and
removes completed job state after `TRIPOSPLAT_JOB_RETENTION_SECONDS` (default
3600 seconds). `TRIPOSPLAT_MAX_WORKERS` controls concurrent preparation work;
GPU inference itself remains exclusive for model safety.

## API

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
