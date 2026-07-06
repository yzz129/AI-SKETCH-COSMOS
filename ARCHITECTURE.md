# AI Sketch Cosmos — 项目架构文档

## 一、项目概述

**AI Sketch Cosmos**（星河画境）是一个将 2D 画作转化为 3D 星空粒子生命的 Web 应用。用户上传手绘/儿童画，AI 识别画作特征后，将其渲染为可交互的 3D 粒子生物，在深空场景中漂浮游动。

### 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | React 19 + TypeScript 5.7 |
| 3D 渲染 | Three.js 0.171 + @react-three/fiber 9.6 + @react-three/drei 10.7 |
| 后处理 | @react-three/postprocessing 3.0 / UnrealBloomPass |
| 状态管理 | Zustand 5.0 |
| 动画 | GSAP 3.15 |
| 构建 | Vite 6.0 |
| 图标 | Lucide React 0.468 |

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│  index.html                                             │
│  └─ <div id="root">                                     │
│      └─ main.tsx (StrictMode)                           │
│          └─ App.tsx                                     │
│              └─ WebGLCanvas                             │
│                  ├─ Canvas (R3F)                        │
│                  │   ├─ Scene (= CosmicScene)           │
│                  │   │   ├─ CameraRig                   │
│                  │   │   ├─ DeepSpaceBackground         │
│                  │   │   │   ├─ GradientSky             │
│                  │   │   │   ├─ DeferredMount           │
│                  │   │   │   │   ├─ DeepStarField       │
│                  │   │   │   │   ├─ TwinkleStars        │
│                  │   │   │   │   ├─ GalaxyBand          │
│                  │   │   │   │   │   └─ GalaxySpiral×6  │
│                  │   │   │   │   ├─ NebulaLayer         │
│                  │   │   │   │   ├─ NebulaRibbons       │
│                  │   │   │   │   ├─ OrbitalPlanets      │
│                  │   │   │   │   └─ ForegroundBokehDust │
│                  │   │   │   └─ ForegroundDust          │
│                  │   │   ├─ PointerInteractionField     │
│                  │   │   ├─ StarFood                    │
│                  │   │   ├─ Lighting                    │
│                  │   │   ├─ SpotlightDirector           │
│                  │   │   └─ OrbitArtwork                │
│                  │   │       └─ ArtworkEntity×N         │
│                  │   │           └─ SpaceCreature       │
│                  │   │               ├─ ParticleCreature│
│                  │   │               ├─ ParticleCreatureTrail│
│                  │   │               └─ CreatureAuraDust│
│                  │   └─ Effects (Bloom + Cinematic)     │
│                  └─ CosmicControlPanel (UI overlay)     │
└─────────────────────────────────────────────────────────┘
```

### 数据流

```
用户上传图片
  → UploadPanel
    → imageSampling.ts (采样像素点 → SampledParticleShape)
    → aiImageService.ts (调用 AI 识别画作特征 → AIArtworkAnalysis)
    → artworkStore.ts / useSketchStore.ts (存储 state)
      → OrbitArtwork → ArtworkEntity → SpaceCreature (3D 渲染)
      → SpotlightDirector (触发特写镜头)
        → CameraRig (摄像机推近)
```

---

## 三、文件详解

### 3.1 入口文件

#### `index.html`
HTML 入口，包含 `<div id="root">` 和 `<script type="module" src="/src/main.tsx">`。设置 `theme-color` 为 `#020711`。

#### `src/main.tsx`
```tsx
// React 18+ createRoot API，挂载 App 到 #root
// 引入全局样式 styles.css 和 styles/cosmic.css
createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
```

#### `src/App.tsx`
```tsx
// 顶层组件，渲染 WebGLCanvas
export default function App() {
  return (
    <main className="display-shell" aria-label="星河画境">
      <WebGLCanvas />
    </main>
  );
}
```

---

### 3.2 核心 WebGL 组件

#### `src/components/webgl/WebGLCanvas.tsx`
全屏 Canvas 容器，核心功能：
- **R3F Canvas 配置**：`camera={{ position: [0,0,6], fov: 50 }}`，`dpr={[1, 1.5]}`
- **坍缩特效交互**：监听 `pointerdown/move/up`，将屏幕坐标归一化后存入 `useSketchStore.collapse`
- **穿透点击**：`.cosmic-panel` 和 `.upload-panel` 区域的事件不触发坍缩

#### `src/components/webgl/Scene.tsx` → `CosmicScene.tsx`
场景根组件，组合所有子组件：
```tsx
<fogExp2 attach="fog" args={['#120b2f', 0.025]} />
<CameraRig />
<DeepSpaceBackground />
<PointerInteractionField />
<StarFood />
<Lighting />
<SpotlightDirector />
<OrbitArtwork />
```

---

### 3.3 背景星空系统

#### `src/components/webgl/DeepSpaceBackground.tsx`
背景分层渲染，使用 `DeferredMount` 延迟挂载以优化首屏性能：

| 顺序 | 延迟 | 组件 | 粒子数 | 说明 |
|---|---|---|---|---|
| 即时 | 0ms | GradientSky | 0 | 天空球渐变背景 |
| 1 | 200ms | DeepStarField | 8,000 | 深空星星 |
| 2 | 600ms | TwinkleStars | 1,200 | 闪烁星星 |
| 3 | 800ms | GalaxyBand | 47,780 | 6 个螺旋星系 |
| 4 | 1500ms | NebulaLayer | 46,140 | 8 片彩色星云 |
| 5 | 2500ms | NebulaRibbons | 70,600 | dadakido 文字星云 |
| 6 | 2800ms | OrbitalPlanets | - | 轨道星球 |
| 7 | 3000ms | ForegroundBokehDust | 80 | 前景散景 |
| 即时 | 0ms | ForegroundDust | 72 | 前景微尘 |

#### `src/components/webgl/GradientSky.tsx`
深空背景天空球，使用 `BackSide` 渲染的球体 + 自定义 ShaderMaterial，混合深蓝、紫、青色渐变。

#### `src/components/webgl/DeepStarField.tsx`
8,000 颗深空星星，分布在 ±50 单位的立方体中。使用 AdditiveBlending 高斯衰减点精灵，缓慢绕 Y/X 轴旋转。

#### `src/components/webgl/TwinkleStars.tsx`
1,200 颗闪烁星星，使用网格分布 + 随机抖动避免均匀感。每颗星有独立的闪烁速度和强度，高 alpha 值（0.3-0.95）产生明显的明暗交替。

#### `src/components/webgl/GalaxyBand.tsx` + `GalaxySpiral.tsx`
6 个螺旋星系的配置与渲染：
- **GalaxyBand**：定义 6 组螺旋星系的 position/scale/count/颜色模式，响应式缩放
- **GalaxySpiral**：每个星系包含 4 层：
  - `coreGlow`：核心光晕（~260 粒子，AdditiveBlending）
  - `spiralParticles`：旋臂粒子（~count 粒子，螺旋分布）
  - `spiralMist`：旋臂星雾（~mistCount 粒子，更宽的散布）
  - `diskMaterial`：星系盘面（DoubleSide ShaderMaterial + FBM 噪声）

颜色模式 `colorMode` 有 4 种：`hero`（蓝紫）、`bottom`（橙紫）、`violet`（紫）、`warm`（暖色）。

#### `src/components/webgl/NebulaLayer.tsx`
8 片彩色星云 + 7 片暗色云层，使用椭圆分布粒子 + 自定义 ShaderMaterial。每片星云有独立的中心位置、半径、颜色和旋转速度。

#### `src/components/webgl/NebulaRibbons.tsx`（dadakido 文字星云）
**项目最核心的展示组件**，使用 SDF（有符号距离函数）定义每个字母的形状：
- `GLYPH_CENTERS`：8 个字母 (d-a-d-a-k-i-d-o) 的 X 轴中心位置
- `logoDensity()`：计算任意 (x,y) 点属于哪个字母、密度多高
  - 'd'/'a'/'o'：环形 + 竖线
  - 'k'：竖线 + 两条斜线
  - 'i'：竖线 + 顶部圆点
- **三层粒子**：
  1. `TEXT_PARTICLES`（58,000）：主体文字粒子，带深度
  2. `HALO_PARTICLES`（7,600）：外扩光晕
  3. `BRIDGE_PARTICLES`（5,000）：字母间连接星尘
- **ShaderMaterial 特效**：
  - `uBurstGlyph` / `uBurstProgress`：点击字母触发粒子爆开
  - 每个字母有独立的呼吸缩放、Yaw/Pitch/Roll 旋转
  - `aGlyph` 属性驱动每个字母不同节奏的动画
- **懒加载**：使用 `requestIdleCallback` 延迟 70K 粒子的创建

#### `src/components/webgl/ForegroundDust.tsx`
72 个前景微尘粒子，分布在前景（z: 0.8-2.5），简单的 AdditiveBlending 圆形光点，带闪烁动画。

#### `src/components/webgl/ForegroundBokehDust.tsx`
80 个前景散景粒子，使用环形 alpha 蒙版（`smoothstep(0.5,0.0,d) * smoothstep(0.02,0.48,d)`）模拟失焦光斑效果。

---

### 3.4 摄像机与交互

#### `src/components/webgl/CameraRig.tsx`
摄像机控制，两种模式：
- **默认模式**：TrackballControls 自由旋转（360°），target 带轻微自动漂移
- **特写模式**（spotlight 激活时）：
  - `fly-in`（0-2s）：摄像机从远处推进到距画作 2.8 单位
  - `showcase`（2-10s）：绕画作缓慢轨道旋转
  - `release`（10-12s）：退回默认视角

#### `src/components/webgl/SpotlightDirector.tsx`
纯逻辑组件，管理特写镜头的时间线：
```
fly-in (2s) → showcase (8s) → release (2s) → idle
```
通过 `useSketchStore.advanceSpotlight/endSpotlight` 推进阶段。

#### `src/components/webgl/PointerInteractionField.tsx`
不可见的交互平面（opacity: 0），检测鼠标位置和点击：
- `pointerMove`：更新 creature 行为系统中的指针世界坐标
- `pointerDown`：在点击位置生成 `StarFood`

#### `src/components/webgl/Lighting.tsx`
场景光照：hemisphereLight + directionalLight + 2 个 pointLight（紫 + 蓝）。

---

### 3.5 画作粒子生物系统

#### `src/components/webgl/SpaceCreature.tsx`
将上传的画作渲染为 3D 粒子生物，核心功能：
- **路径运动**：CatmullRom 曲线定义运动轨迹，`progress` 在 0-1 间循环
- **行为系统**：食物吸引、指针避让、群体避让
- **入场动画**：`entryProgress` 在 1.15s 内从 entry 位置 lerp 到路径
- **特写模式**：spotlight 激活时居中放大（scale 0.5→2.8x），缓慢 Y 轴自转，释放后渐变回路径
- **交互脉冲**：点击生物触发 pulse + burst 动画
- **子组件**：
  - `ParticleCreature`：主体粒子渲染（自定义 ShaderMaterial，支持 flow/breath/glow）
  - `ParticleCreatureTrail`：尾部拖尾粒子
  - `CreatureAuraDust`：光环尘埃粒子

#### `src/components/webgl/ArtworkEntity.tsx`
`SpaceCreature` 的薄包装，透传 `artwork` 和 `index`。

#### `src/components/webgl/OrbitArtwork.tsx`
遍历 `useArtworkStore.artworks[]`，为每个画作渲染一个 `ArtworkEntity`。

#### `src/components/webgl/ParticleCreature.tsx`
画作主体粒子渲染器，使用自定义 ShaderMaterial：
- 支持 `flowAmount`（粒子流动强度）
- 支持 `breathAmount`（呼吸缩放）
- `behaviorSignature` 控制 glow/edgeGlow/particleSpread/depth
- `interactionPulseRef` 和 `burstRef` 驱动交互动画

#### `src/components/webgl/ParticleCreatureTrail.tsx`
画作尾部拖尾粒子，跟随主体运动方向，有渐变淡出。

#### `src/components/webgl/CreatureAuraDust.tsx`
画作周围的光环尘埃，根据 `motionType` 调整散布模式。

---

### 3.6 后处理

#### `src/components/webgl/Effects.tsx`
后处理管线：
1. **RenderPass**：基础渲染
2. **UnrealBloomPass**：泛光效果（strength=1.4, threshold=0.12, radius=0.4）
3. **CinematicPass**：自定义 ShaderPass
   - 暗角（vignette）：`smoothstep(0.86, 0.2, length(p))`
   - 胶片颗粒（grain）：hash 函数生成随机噪点
4. **OutputPass**：输出到屏幕

Bloom 参数延迟激活（700ms + requestIdleCallback），避免首帧闪烁。

---

### 3.7 性能优化

#### `src/components/webgl/DeferredMount.tsx`
通用延迟挂载包装器：
```tsx
<DeferredMount timeout={200}>
  <HeavyComponent />
</DeferredMount>
```
使用 `requestIdleCallback` 在浏览器空闲时挂载子组件，避免 `useMemo` 中的同步粒子计算阻塞 FCP。

---

### 3.8 UI 组件

#### `src/components/ui/CosmicControlPanel.tsx`
右下角控制面板，显示：
- 当前画作数量
- 空闲/活跃状态指示
- 清空画作按钮

#### `src/components/UploadPanel.tsx`
左上角上传面板，包含：
- 文件选择器（接受图片格式）
- AI 识别状态显示
- 画作特征信息展示
- 上传/清空操作按钮

---

### 3.9 状态管理

#### `src/stores/useSketchStore.ts`
全局状态（Zustand），管理：
```typescript
type SketchStore = {
  creatures: Creature[];          // 已创建的粒子生物列表
  latestCreature: Creature | null; // 最新创建
  status: 'idle'|'processing'|'ready'|'error';
  collapse: CollapseState;       // 坍缩特效状态
  spotlight: SpotlightState;     // 特写镜头状态
  // actions...
};
```

**持久化**：`creatures` 数据通过 `localStorage`（key: `cosmos-sketch-creatures`）持久化存储，页面刷新后自动恢复。

**关键 Actions**：
- `addCreatureFromShape(shape)`：创建新生物 + 自动触发 spotlight + 自动持久化
- `clearCreatures()`：清空生物并清除 localStorage
- `beginCollapse(center)` / `endCollapse()`：坍缩特效
- `beginSpotlight(id)` / `advanceSpotlight(phase)` / `endSpotlight()`：特写镜头

**SpotlightState** 四阶段：
```typescript
type SpotlightPhase = 'fly-in' | 'showcase' | 'release' | 'idle';
```

#### `src/stores/artworkStore.ts`
画作特征存储（Zustand），管理：
- `artworks: StoredArtwork[]`：已上传画作列表（含 AI 分析结果）
- `addArtwork()` / `updateArtworkAnalysis()`：添加和更新画作
- **持久化**：`artworks` 数据通过 **IndexedDB**（数据库: `cosmos-sketch-db`）持久化，支持大量粒子数据（单作品可达 30K 粒子点），刷新不丢失

---

### 3.10 工具与服务

#### `src/services/aiImageService.ts`
AI 画作识别服务：
- `analyzeArtworkBehavior(file)`：调用 `/api/ai-recognize`，返回 `AIArtworkAnalysis`
- `normalizeAIArtworkAnalysis(raw)`：校验和规范化 AI 返回的 JSON
- `fallbackAnalysis(fileName)`：AI 不可用时的本地回退分析（根据文件名推断类型）
- `imageToCreatureTexture(input)`：图片转 creature 纹理（当前为 mock）

**AIArtworkAnalysis 结构**：
```typescript
{
  form: { silhouette, symmetry, elongation, roundness, openness, ... }
  behavior: { locomotion, tempo, energy, buoyancy, fluidity, ... }
  visual: { glow, edgeGlow, trailLength, particleSpread, depth }
  motionType: 'fly' | 'hop' | 'swim' | 'run' | 'walk' | 'float'
  actionTypes: ['glide', 'hover', 'flutter', ...]  // 3-5个
}
```

#### `src/utils/creatureMotion.ts`
生物运动配置与预设：
- `getCreatureMotionPreset(type, signature)`：获取运动预设（速度、旋转幅度、拖尾强度等）
- `createCreatureMotionConfig(index, type, signature)`：生成运动配置（phase、speed、seed 等）
- `getCreatureMotionPose(type, time, phase)`：获取当前帧的运动姿态（位置偏移、旋转、缩放）
- `getCreatureActionPose(action, time, phase)`：获取行为动画姿态
- `pickCreatureAction(actions, time, phase)`：从 actionTypes 中随机选择一个当前行为

**支持的运动类型**：fly、hop、swim、run、walk、float

**支持的行为类型**（21 种）：glide、hover、drift、orbit、spiral、flutter、swim、dart、pulse、breathe、bob、hop、tumble、loop、sweep、wiggle、shimmer、bloom、stretch、trail、approach、retreat

#### `src/utils/creatureBehavior.ts`
生物行为系统（Zustand store）：
- `creaturePositions`：所有生物的世界坐标（供群体避让计算）
- `foods: StarFood[]`：点击生成的星食粒子
- `pointerWorld`：鼠标指针的 3D 世界坐标
- `nearestFoodAttraction(pos, time)`：计算最近食物的吸引力
- `pointerAvoidance(pos)`：计算指针避让力
- `crowdAvoidance(id, pos)`：计算群体避让力

#### `src/utils/imageSampling.ts`
图片像素采样：将上传的图片转为 `SampledParticleShape`（包含采样点坐标、颜色、透明度）。

#### `src/utils/imageToParticleCloud.ts`
图片转 3D 粒子云的完整流程：采样 → 深度估计 → 3D 分布 → 生成 BufferGeometry。

#### `src/utils/artworkImage.ts`
画作图像处理：加载、缩放、预处理。

#### `src/utils/storage.ts`
持久化工具层：
- `artworks` 使用 **IndexedDB**（数据库: `cosmos-sketch-db`，store: `artworks`）存储大量粒子数据，避开 localStorage 5MB 限制
- `creatures` 使用 **localStorage**（key: `cosmos-sketch-creatures`）存储较轻量的 sketch 生物数据
- 提供 `loadArtworks<T>()`、`persistArtworks()`、`clearPersistedArtworks()` 异步接口
- 提供 `loadSketchCreatures<T>()`、`persistSketchCreatures()` 同步接口
- 存储失败时输出 `console.warn` 便于诊断

---

### 3.11 类型定义

#### `src/types/artwork.ts`
画作相关的 TypeScript 类型：
```typescript
type ArtworkFeatureResult = {
  subjectCategory: string;
  morphology: { hasWings, wingCount, hasLegs, ... };
  behaviorTraits: { locomotionType, energyLevel, personalityFeel };
  visualTraits: { dominantColors, brightness, softness, textureStyle };
  motionPreset: MotionPreset;
};

type Artwork3DModelResult = { modelUrl: string; thumbnailUrl?: string };
```

#### `src/lib/`（AI 与图像处理）
- `lib/ai/analyzeArtworkFeatures.ts`：AI 画作特征分析
- `lib/ai/generateArtworkModel3D.ts`：3D 模型生成（调用 Hyper3D API）
- `lib/image/extractDominantColors.ts`：提取图片主色调
- `lib/image/prepareImageFor3DGeneration.ts`：图片预处理（为 3D 生成准备）
- `lib/motion/resolveMotionPreset.ts`：运动预设解析

---

### 3.12 样式

#### `src/styles.css`
全局样式：
- `display-shell`：固定全屏容器，径向渐变背景（紫 + 青）
- `webgl-stage`：Canvas 容器，带暗角叠加层
- `upload-panel`：左上角毛玻璃面板（backdrop-filter: blur）
- 响应式：`@media (max-width: 640px)` 移动端适配

#### `src/styles/cosmic.css`
宇宙主题样式变量和面板组件样式。

---

## 四、关键数据流

### 画作上传 → 3D 展示流程
```
1. 用户选择图片文件
2. UploadPanel 调用 imageSampling → 生成 SampledParticleShape
3. 同时调用 aiImageService.analyzeArtworkBehavior → 获取 AIArtworkAnalysis
4. useArtworkStore.addArtwork(artwork, features) → 持久化到 localStorage
5. OrbitArtwork 检测到新的 artwork → 挂载 ArtworkEntity → SpaceCreature
6. SpotlightDirector 监听 spotlight 状态 → 管理时间线
7. CameraRig 检测 spotlight → 推近摄像机
8. SpaceCreature 检测 spotlight → 放大/居中/旋转展示
9. 12s 后 spotlight 结束 → creature 恢复正常路径运动
10. 所有 artworks 和 creatures 自动持久化到 localStorage，刷新不丢失
```

### 坍缩特效流程
```
1. 用户在 Canvas 上按下鼠标
2. WebGLCanvas.handleStagePointerDown:
   → touchActivity()（退出空闲模式）
   → beginCollapse([screenX, screenY])（保存归一化坐标）
3. 拖拽移动 → updateCollapseCenter([x, y])（更新坐标）
4. 松开鼠标 → endCollapse()（记录 holdDuration）
5. 其他组件可读取 useSketchStore.collapse 来响应坍缩效果
```

---

## 五、性能策略

| 策略 | 实现 |
|---|---|
| 延迟挂载 | `DeferredMount` + `requestIdleCallback` 分 7 阶段加载 ~18 万粒子 |
| 懒初始化 | `NebulaRibbons` 内部 `requestIdleCallback` 延迟 70K 粒子创建 |
| 状态持久化 | `useArtworkStore` + `useSketchStore` 自动同步到 localStorage，页面刷新后恢复 |
| ShaderMaterial 复用 | 同类型粒子共享 ShaderMaterial 实例（如 GalaxySpiral 的 core/particles/mist） |
| BufferGeometry | 所有粒子使用 Float32Array + BufferAttribute，避免垃圾回收 |
| frustumCulled | 大部分粒子组件开启视锥体裁剪 |
| dpr 限制 | `dpr={[1, 1.5]}` 限制像素比 |
| depthWrite: false | 粒子不需要深度写入，避免排序开销 |

---

## 六、粒子总数统计

| 组件 | 粒子数 |
|---|---|
| NebulaRibbons (dadakido) | 70,600 |
| NebulaLayer (8 片星云) | 46,140 |
| GalaxyBand (6 个星系) | 47,780 |
| DeepStarField | 8,000 |
| DarkNebulaClouds | 5,700 |
| TwinkleStars | 1,200 |
| ForegroundBokehDust | 80 |
| ForegroundDust | 72 |
| **总计** | **~179,572** |

---

## 七、关键配置参数

### 摄像机
```
默认位置: (0, 0, 6)
FOV: 50
近平面: 0.1, 远平面: 100
特写距离: 2.8
```

### Bloom 后处理
```
strength: 1.4
threshold: 0.12
radius: 0.4
```

### 特写镜头时间线
```
fly-in: 2s (粒子飞入 + 摄像机推进)
showcase: 8s (悬浮展示 + 轨道旋转)
release: 2s (退回默认)
```

### dadakido 文字星云
```
字母间距系数: LETTER_SPREAD = 2.5
采样宽度: WORD_WIDTH = 30.0
主体粒子: 58,000
光晕粒子: 7,600
桥接粒子: 5,000
```
