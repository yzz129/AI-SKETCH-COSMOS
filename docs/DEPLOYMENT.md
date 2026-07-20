# AI Sketch Cosmos 部署指南

## 一、部署架构

```
用户浏览器
    │
    ├──→ 静态文件 (HTML/JS/CSS)          ← Nginx / Vite Preview / CDN
    │
    ├──→ AI 画作识别 API                  ← Vite 中间件 或 独立 Node 服务
    │    POST /api/artwork-features        (火山方舟 Ark API 代理)
    │    POST /api/ai-recognize
    │
    └──→ 3D Gaussian Splat API (可选)     ← FastAPI + GPU 服务器
         POST /api/artworks
         GET  /api/jobs/{jobId}
```

---

## 二、方案 A：最小部署（仅前端 + AI 识别）

不需要 GPU，一台普通服务器即可。

### 硬件

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 2 GB | 4 GB |
| 磁盘 | 1 GB | 5 GB |
| GPU | 不需要 | - |

### 软件

| 项目 | 版本 |
|------|------|
| Node.js | ≥ 18 |
| npm | ≥ 9 |

### 步骤

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
echo "ARK_API_KEY=your-key" > .env.local

# 3. 构建前端
npm run build

# 4. 部署 dist/ 到任意静态服务器
# 方案 a: Vite preview（开发/演示）
npm run preview -- --host 0.0.0.0 --port 4173

# 方案 b: Nginx
cp -r dist/* /var/www/cosmos/
# nginx.conf:
# root /var/www/cosmos;
# index index.html;
# location / { try_files $uri $uri/ /index.html; }

# 方案 c: 一键部署到 Vercel / Netlify / Cloudflare Pages
# 构建命令: npm run build
# 输出目录: dist
```

手机拍照/上传页位于 `/submit`。Nginx、CDN 或静态托管必须启用 SPA 回退，否则直接访问 `/submit` 会返回 404。局域网联调可运行 `npm run dev:lan`，并让 FastAPI 监听 `0.0.0.0`；手机必须访问电脑的局域网 IP，不能使用手机自己的 `127.0.0.1`。

### 缺点：无 AI 识别功能

构建后的静态文件不含 Vite 中间件，`/api/artwork-features` 不可用。需要 AI 识别的话用方案 B。

---

## 三、方案 B：标准部署（前端 + AI 识别）

需要 Node.js 运行时（Vite 中间件代理 AI API）。

### 硬件

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 2 GB | 4 GB |
| 磁盘 | 5 GB | 10 GB |
| GPU | 不需要 | - |

### 步骤

```bash
# 1. 安装依赖
npm install

# 2. 配置
echo "ARK_API_KEY=your-ark-api-key" > .env.local

# 3. 生产模式启动（Vite preview + 中间件）
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

或者用 PM2 守护：

```bash
npm install -g pm2
pm2 start "npm run preview -- --host 0.0.0.0 --port 4173" --name cosmos
```

### 前端如何访问 AI API

开发模式（`npm run dev`）下 Vite 中间件自动生效。生产模式（`npm run preview`）同样生效。

AI API 调用链路：
```
浏览器 → POST /api/artwork-features → Vite 中间件 → Ark API → Vite 中间件 → 浏览器
```

---

## 四、方案 C：完整部署（前端 + AI + 3D Gaussian Splat）

需要一台带 **NVIDIA GPU** 的服务器运行 TripoSplat 后端。

### 硬件

| 项目 | 前端服务器 | GPU 服务器 |
|------|-----------|------------|
| CPU | 4 核 | 8 核 |
| 内存 | 4 GB | 32 GB |
| 磁盘 | 10 GB | 50 GB (模型权重 ~10GB) |
| GPU | 不需要 | **NVIDIA GPU ≥ 8GB 显存** (RTX 3070+/A10/A100) |

### GPU 服务器软件

| 项目 | 版本/说明 |
|------|-----------|
| Python | ≥ 3.10 |
| CUDA | ≥ 11.8 |
| PyTorch | ≥ 2.0 (CUDA 版) |
| 模型权重 | 5 个 safetensors 文件 (~10 GB) |

### 步骤

#### 1. 前端服务器（同方案 B）

```bash
npm install
echo "ARK_API_KEY=your-key" > .env.local
echo "VITE_TRIPOSPLAT_ENABLED=true" >> .env.local
echo "VITE_TRIPOSPLAT_API_BASE=http://GPU服务器IP:8000" >> .env.local
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

#### 2. GPU 服务器

```bash
# 安装依赖
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install torch numpy safetensors pillow tqdm

# 下载模型权重 (从 HuggingFace)
hf download VAST-AI/TripoSplat --local-dir ckpts/

# 配置环境变量
cat > .env << EOF
TRIPOSPLAT_REPO_ROOT=$(pwd)/TripoSplat
TRIPOSPLAT_CKPT_PATH=$(pwd)/ckpts/diffusion_models/triposplat_fp16.safetensors
TRIPOSPLAT_DECODER_PATH=$(pwd)/ckpts/vae/triposplat_vae_decoder_fp16.safetensors
TRIPOSPLAT_DINOV3_PATH=$(pwd)/ckpts/clip_vision/dino_v3_vit_h.safetensors
TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH=$(pwd)/ckpts/vae/flux2-vae.safetensors
TRIPOSPLAT_RMBG_PATH=$(pwd)/ckpts/background_removal/birefnet.safetensors
TRIPOSPLAT_DEVICE=cuda
TRIPOSPLAT_STEPS=15
TRIPOSPLAT_GUIDANCE_SCALE=1.0
TRIPOSPLAT_COMPILE=true
EOF

# 启动服务 (PM2 守护)
pip install pm2  # 或使用 systemd
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 五、环境变量完整清单

### 前端 (.env.local)

| 变量 | 必填 | 说明 |
|------|------|------|
| `ARK_API_KEY` | 推荐 | 火山方舟 API 密钥（AI 画作识别 + 3D 生成） |
| `VITE_TRIPOSPLAT_ENABLED` | 否 | `true` 启用 TripoSplat 后端 |
| `VITE_TRIPOSPLAT_API_BASE` | 否 | TripoSplat API 地址，默认 `http://127.0.0.1:8000` |

### GPU 后端 (backend/.env)

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `TRIPOSPLAT_REPO_ROOT` | 是 | - | TripoSplat 代码路径 |
| `TRIPOSPLAT_CKPT_PATH` | 是 | - | 流匹配模型权重 |
| `TRIPOSPLAT_DECODER_PATH` | 是 | - | 解码器权重 |
| `TRIPOSPLAT_DINOV3_PATH` | 是 | - | DINOv3 权重 |
| `TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH` | 是 | - | VAE 编码器权重 |
| `TRIPOSPLAT_RMBG_PATH` | 是 | - | 背景移除模型 |
| `TRIPOSPLAT_DEVICE` | 否 | `cuda` | `cuda` 或 `cpu` |
| `TRIPOSPLAT_STEPS` | 否 | `15` | 采样步数（10~20，越少越快） |
| `TRIPOSPLAT_SEED` | 否 | `42` | 随机种子 |
| `TRIPOSPLAT_GUIDANCE_SCALE` | 否 | `1.0` | CFG 引导强度（≤1 关闭，速度翻倍；>1 质量更好） |
| `TRIPOSPLAT_SHIFT` | 否 | `3.0` | 时间步偏移 |
| `TRIPOSPLAT_COMPILE` | 否 | `false` | `true` 启用 torch.compile（首次慢，后续快 10-30%） |
| `TRIPOSPLAT_COMPILE_MODE` | 否 | `reduce-overhead` | torch.compile 模式 |
| `TRIPOSPLAT_SKIP_WARMUP` | 否 | - | 已废弃，改用 `TRIPOSPLAT_WARMUP`（默认关闭） |
| `TRIPOSPLAT_WARMUP` | 否 | `false` | `true` 启用模型预热（首次初始化跑一次微型前向，消耗 ~5s 但后续请求更稳定） |
| `TRIPOSPLAT_CPU_DTYPE` | 否 | `float32` | CPU 模式精度 |
| `TRIPOSPLAT_CPU_NUM_GAUSSIANS_CAP` | 否 | `32768` | CPU 模式 Gaussian 上限 |
| `TRIPOSPLAT_CPU_TIMEOUT_SECONDS` | 否 | `900` | CPU 子进程超时 |

---

## 六、推荐云服务商

| 方案 | 前端 | GPU 后端 | 月费估算 |
|------|------|----------|---------|
| **最小** | Vercel (免费) | 不需要 | ¥0 |
| **标准** | 阿里云 ECS 2C4G | 不需要 | ~¥50/月 |
| **完整** | 同上 | AutoDL A10 (按量) | ~¥2/小时 (GPU) |
| **完整** | 同上 | 阿里云 GPU A10 | ~¥3000/月 (包月) |

---

## 七、生产环境优化建议

1. **前端**：`dist/` 部署到 CDN + Nginx 反向代理 API 请求
2. **AI API**：Vite preview 仅适合低流量，高并发改用独立 Express/FastAPI 服务代理 Ark API
3. **GPU 后端**：加请求队列（当前已单线程串行），避免并发 OOM
4. **缓存**：Nginx 缓存 `/assets/` 下的 .splat/.ply 文件（静态、不变）
5. **HTTPS**：生产环境必须，用 Let's Encrypt 或云厂商 SSL 证书
6. **监控**：`/health` 端点供健康检查，GPU 服务加 `/health/triposplat` 检查模型加载状态
