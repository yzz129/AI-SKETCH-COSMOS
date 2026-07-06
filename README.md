# 🌌 AI-SKETCH-COSMOS · 星河画境

> 将儿童画作转化为 3D 粒子生命，让每一笔涂鸦在星河中自由游弋。

## ✨ 简介

**星河画境** 是一个基于 WebGL 的沉浸式 3D 星空画廊。上传一张画作图片，AI 会自动识别画面的形态特征与行为倾向，然后将它转化为由数千个彩色粒子构成的 3D 生物，漂浮在深邃的宇宙场景中。

每个粒子生命都拥有独特的运动模式——飞翔、游动、跳跃、漂浮——并伴有星云、流星、星系旋臂等绚丽的宇宙背景。

## 🎬 功能

- **🖼️ AI 画作识别** — 上传 PNG/JPEG/WebP 图片，通过火山方舟 Ark API 分析形态、色彩与行为倾向
- **✨ 3D 粒子生命** — 画作被采样为数万个彩色粒子，在三维空间中重组为可动生物
- **🌠 宇宙场景** — 深空背景、星系旋臂、星云带、流星层、闪烁星辰、Kepler 轨道行星等多层视觉效果
- **🪐 轨道行星** — 4 颗粒子行星绕中心 dadakido 做开普勒轨道运动（内快外慢），带 billboard 光环和卫星
- **🎯 智能运动** — AI 分析结果匹配运动模式（飞翔/游动/跳跃/漂浮/奔跑/行走），生物与行星共享 Kepler 物理轨道
- **🖱️ 交互控制** — 鼠标/触摸拖拽旋转视角，粒子生命响应指针靠近，点击投喂星食
- **📐 全响应式** — UI 面板和 3D 场景自动适应任意屏幕尺寸（375px 手机 ~ 4K 大屏），粒子密度随窗口大小动态缩放
- **✨ 触摸拖尾** — 鼠标/触屏划过产生彩色 3D 粒子拖尾光效
- **🖥️ 全屏展示** — 支持全屏模式，适合大屏展览

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript 5.7 |
| 构建 | Vite 6（含 AI 中间件插件） |
| 3D 渲染 | Three.js 0.171 + @react-three/fiber 9.6 + @react-three/drei 10.7 |
| 后处理 | @react-three/postprocessing 3.0 |
| 状态管理 | Zustand 5.0 |
| 动画 | GSAP 3.15 |
| AI 识别 | 火山方舟 Ark API（doubao-seed-2-0-lite） |
| 3D 生成 | 火山方舟 Hyper3D（hyper3d-gen2）+ TripoSplat（可选） |
| 后端框架 | FastAPI 0.115（可选 GPU 后端） |
| 3D Splat | TripoSplat（VAST-AI，MIT License） |
| 图标 | Lucide React |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 安装

```bash
git clone https://github.com/yzz129/AI-SKETCH-COSMOS.git
cd AI-SKETCH-COSMOS
npm install
```

### 配置 API Key

在项目根目录创建 `.env.local` 文件：

```env
ARK_API_KEY=your-ark-api-key-here
```

> 需要火山方舟 Ark API 密钥（用于 AI 画作识别 + Hyper3D 模型生成）。如未配置，将使用本地默认形态。

### TripoSplat 后端（可选）

将 2D 画作转为 3D Gaussian Splat 资产，需要 GPU 环境：

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

在 `backend/.env` 中配置模型路径（共 5 个模型文件，从 [HuggingFace](https://huggingface.co/VAST-AI/TripoSplat) 下载）：

```env
TRIPOSPLAT_REPO_ROOT=D:\path\to\TripoSplat
TRIPOSPLAT_CKPT_PATH=D:\models\triposplat_fp16.safetensors
TRIPOSPLAT_DECODER_PATH=D:\models\triposplat_vae_decoder_fp16.safetensors
TRIPOSPLAT_DINOV3_PATH=D:\models\dino_v3_vit_h.safetensors
TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH=D:\models\flux2-vae.safetensors
TRIPOSPLAT_RMBG_PATH=D:\models\birefnet.safetensors
TRIPOSPLAT_DEVICE=cuda
```

启动：

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

前端启用 TripoSplat（`.env.local`）：
```env
VITE_TRIPOSPLAT_ENABLED=true
VITE_TRIPOSPLAT_API_BASE=http://127.0.0.1:8000
```

### 开发

```bash
npm run dev
```

访问 `http://127.0.0.1:5173`

### 构建

```bash
npm run build
npm run preview
```

## 📂 项目结构

```
├── src/                     # 前端源码
│   ├── components/
│   │   ├── webgl/           # WebGL/Three.js 场景组件（50+文件）
│   │   │   ├── CosmicScene.tsx         # 主场景（含 ResponsiveCamera FOV 自适应）
│   │   │   ├── OrbitalPlanets.tsx      # Kepler 轨道行星（开普勒物理 + billboard 光环）
│   │   │   ├── SpaceCreature.tsx       # 粒子生命核心（Kepler 轨道运动）
│   │   │   ├── ParticleCreature.tsx    # 粒子生命渲染器
│   │   │   ├── CameraRig.tsx           # 摄像机控制（特写/轨道）
│   │   │   ├── NebulaRibbons.tsx       # dadakido 文字星云（70K+ 粒子 SDF）
│   │   │   ├── GalaxySpiral.tsx        # 星系旋臂
│   │   │   └── ...                     # 更多场景元素
│   │   └── ui/               # UI 面板（CosmicControlPanel / TouchTrailCanvas / UploadPanel）
│   ├── lib/                  # AI + 图像处理逻辑
│   ├── services/             # API 服务层
│   ├── stores/               # Zustand 状态管理
│   ├── utils/                # 工具函数（粒子采样 / 行为推断 / Kepler 轨道）
│   └── types/                # TypeScript 类型定义
├── backend/                  # 后端（可选 GPU 服务）
│   ├── app/
│   │   ├── main.py           # FastAPI 应用（CORS / 路由 / 参数校验）
│   │   ├── schemas.py        # Pydantic 数据模型
│   │   ├── jobs.py           # 任务注册表（线程池异步执行）
│   │   ├── storage.py        # 文件系统操作（上传 / manifest）
│   │   ├── triposplat_worker.py  # TripoSplat 管线加载与推理
│   │   └── triposplat_cli.py     # CLI 入口（CPU 子进程）
│   └── TripoSplat/           # TripoSplat 源码（VAST-AI, MIT License）
│       ├── triposplat.py     # 管线 + Gaussian 数据结构（611 行）
│       ├── model.py          # 神经网络模型定义（1726 行）
│       └── run_example.py    # 示例推理脚本
├── vite.config.ts            # Vite 配置（含 AI 识别 + Hyper3D 中间件插件）
├── package.json              # 前端依赖
└── tsconfig.json             # TypeScript 配置
```

## 🎨 工作原理

### 前端流程（粒子生命）
1. **上传** — 用户上传画作图片
2. **去底** — 本地处理，去除白色背景，提取主体
3. **采样** — 将图像主体采样为粒子云（颜色 + 位置）
4. **AI 识别** — 通过 Vite 中间件调用火山方舟 Ark API 分析形态特征与行为倾向
5. **映射** — 将 AI 分析结果映射为运动类型（fly/hop/swim/run/walk/float）和动作集
6. **渲染** — 在 Three.js 场景中以 Kepler 轨道粒子生命形式呈现

### 后端流程（3D Gaussian Splat，可选）
1. **上传** — 图片通过 `POST /api/artworks` 发送到 FastAPI 后端
2. **预处理** — BiRefNet 去底 + 1024×1024 居中裁剪
3. **编码** — DINOv3 ViT 提取视觉特征 + Flux2 VAE 潜空间编码
4. **采样** — LatentSeqMMFlowModel 流匹配去噪（Euler 采样器，CFG 引导）
5. **解码** — 八叉树概率采样 + Elastic Gaussian 参数预测
6. **导出** — 生成 `.splat` / `.ply` 文件 + `manifest.json`
7. **展示** — 前端 Spark.js 渲染 Gaussian Splat 3D 模型

## 📄 License

MIT
