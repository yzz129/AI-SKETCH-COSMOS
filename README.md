# AI Sketch Cosmos

将 2D 画作转化为 3D 粒子生物，在宇宙场景中自由游动的交互式 Web 应用。

## 功能

- **2D → 3D 粒子化**：上传画作图片，自动提取边缘、色彩和纹理特征，生成粒子和 Gaussian Splat 3D 模型
- **宇宙场景**：粒子生物在星空、星云、银河中按轨道运行，支持鼠标/触屏交互
- **TripoSplat 集成**：可选后端将画作转换为高质量 3D Gaussian Splat 模型
- **聚光灯模式**：点击生物进入特写展示，相机拉近 + 粒子细节增强
- **点击爆开特效**：点击/触摸生物触发流星拖尾爆炸效果，粒子向外扩散后重新聚合

## 技术栈

| 层 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 3D 渲染 | Three.js + @react-three/fiber + @react-three/drei |
| 后处理 | EffectComposer + UnrealBloomPass + 自定义 GLSL Shader |
| 3D 模型 | @sparkjsdev/spark (Gaussian Splat 渲染) |
| 状态管理 | Zustand |
| 2D Canvas | 原生 Canvas 2D (划屏拖尾特效) |
| AI 识别 | 火山方舟 Ark API |
| 后端 (可选) | FastAPI + TripoSplat + PyTorch |
| 构建 | Vite |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 特效系统

### 划屏拖尾 (TouchTrailCanvas)
2D Canvas 叠加层，鼠标/触摸移动时产生彩虹粒子拖尾：柔光外发光 + 亮核心，AdditiveBlending 叠加。

### 点击爆开流星拖尾 (SplatCreatureModel 粒子代理)
点击 3D 生物时触发：
- **420 个粒子**从模型表面采样，球面均匀向外扩散
- 片段着色器采用**高斯衰减**函数，实现柔和流星效果
- 流星形态：微小高亮头部 + 锥形渐变宽度的发光轨迹
- 颜色覆盖**全彩虹光谱**，高饱和度（98%~100%）
- 粒子随时间指数衰减（`exp(-dist * 2.8)`），符合物理光照衰减规律

### 全屏塌陷后处理 (Effects CollapsePass)
长按/拖拽时触发引力透镜效果：径向拉拽 + 旋涡扭曲 + 冲击波环 + 色差偏移。

## 后端 (可选)

参见 [backend/README.md](backend/README.md)

启用 TripoSplat 3D 生成需设置环境变量：
```bash
VITE_TRIPOSPLAT_ENABLED=true
VITE_TRIPOSPLAT_API_BASE=http://127.0.0.1:8000
```

## 项目结构

```
src/
├── components/
│   ├── ui/           # TouchTrailCanvas, CosmicControlPanel, UploadPanel
│   └── webgl/        # 3D 场景组件 (SpaceCreature, SplatCreatureModel, Effects 等)
├── lib/              # AI 生成、图像处理、运动计算
├── hooks/            # 自定义 React Hooks
├── stores/           # Zustand 状态管理
├── utils/            # 工具函数
└── styles/           # CSS 样式
backend/              # FastAPI + TripoSplat (可选)
docs/                 # 部署指南、加速文档
```

## 部署

参考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)