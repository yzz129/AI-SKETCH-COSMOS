# 🌌 AI-SKETCH-COSMOS · 星河画境

> 将儿童画作转化为 3D 粒子生命，让每一笔涂鸦在星河中自由游弋。

## ✨ 简介

**星河画境** 是一个基于 WebGL 的沉浸式 3D 星空画廊。上传一张画作图片，AI 会自动识别画面的形态特征与行为倾向，然后将它转化为由数千个彩色粒子构成的 3D 生物，漂浮在深邃的宇宙场景中。

每个粒子生命都拥有独特的运动模式——飞翔、游动、跳跃、漂浮——并伴有星云、流星、星系旋臂等绚丽的宇宙背景。

## 🎬 功能

- **🖼️ AI 画作识别** — 上传 PNG/JPEG/WebP 图片，通过火山方舟 Ark API 分析形态、色彩与行为倾向
- **✨ 3D 粒子生命** — 画作被采样为数万个彩色粒子，在三维空间中重组为可动生物
- **🌠 宇宙场景** — 深空背景、星系旋臂、星云带、流星层、闪烁星辰等多层视觉效果
- **🎯 智能运动** — 根据 AI 分析结果自动匹配运动模式（飞翔/游动/跳跃/漂浮/奔跑/行走）
- **🖱️ 交互控制** — 鼠标/触摸拖拽旋转视角，粒子生命会响应指针靠近
- **😴 空闲模式** — 90 秒无操作后自动进入舒缓的自动漫游状态
- **🖥️ 全屏展示** — 支持全屏模式，适合大屏展览

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 3D 渲染 | Three.js + @react-three/fiber + @react-three/drei |
| 后处理 | @react-three/postprocessing |
| 状态管理 | Zustand |
| 动画 | GSAP |
| AI 接口 | 火山方舟 Ark API（doubao-seed-2.0-lite） |
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

> 需要火山方舟 Ark API 密钥，用于调用 AI 画作识别服务。如未配置，将使用本地默认形态。

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
src/
├── components/
│   ├── webgl/          # WebGL/Three.js 场景组件
│   │   ├── CosmicScene.tsx        # 主场景组合
│   │   ├── ParticleCreature.tsx   # 粒子生命核心
│   │   ├── GalaxySpiral.tsx       # 星系旋臂
│   │   ├── NebulaRibbons.tsx      # 星云带
│   │   ├── MeteorLayer.tsx        # 流星层
│   │   ├── DeepStarField.tsx      # 深空星场
│   │   ├── OrbitArtwork.tsx       # 轨道画作展示
│   │   └── ...                    # 更多场景元素
│   ├── space/          # 早期空间场景组件
│   └── ui/             # UI 面板组件
├── lib/
│   ├── ai/             # AI 分析逻辑
│   ├── image/          # 图像处理（去底、颜色提取）
│   └── motion/         # 运动预设解析
├── services/           # API 服务层
├── stores/             # Zustand 状态管理
├── utils/              # 工具函数（粒子采样、行为推断等）
├── hooks/              # 自定义 Hooks
└── types/              # TypeScript 类型定义
```

## 🎨 工作原理

1. **上传** — 用户上传画作图片
2. **去底** — 本地处理，去除白色背景，提取主体
3. **采样** — 将图像主体采样为粒子云（颜色 + 位置）
4. **AI 识别** — 调用火山方舟 API 分析画作的形态特征与行为倾向
5. **映射** — 将 AI 分析结果映射为运动类型（fly/hop/swim/run/walk/float）和动作集
6. **渲染** — 在 Three.js 场景中以粒子生命形式呈现，配合宇宙背景效果

## 📄 License

MIT
