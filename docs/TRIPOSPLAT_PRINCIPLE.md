# TripoSplat 原理深度解析

> TripoSplat 将单张 2D 图片转化为高质量、可变数量的 3D Gaussian Splat。
> 由 VAST-AI 研究院开发，MIT License，代码 ~2,000 LOC，依赖极简。

---

## 一、总览：从图片到 3D 的完整流程

```
输入图片 (任意尺寸)
    │
    ▼
┌──────────────────────────────────────────────────┐
│ 阶段 1：预处理 (Preprocess)                        │
│   BiRefNet 去底 → 腐蚀 alpha → 裁剪主体 → 合成黑底   │
│   输出：1024×1024 RGB 图片                          │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│ 阶段 2：编码 (Encode)                              │
│   ├─ DINOv3 ViT-H/16+ → 视觉特征 (1280 维)         │
│   └─ Flux2 VAE Encoder → 潜空间特征 (128 维)        │
│   输出：cond = { feature1, feature2 }              │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│ 阶段 3：流匹配采样 (Flow Matching Sample)           │
│   LatentSeqMMFlowModel (1B 参数级)                 │
│   从纯噪声出发，Euler 迭代去噪，生成潜空间编码       │
│   输出：latent ∈ R^(1×8192×16)                     │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│ 阶段 4：解码 (Decode)                              │
│   ├─ OctreeProbabilityFixedlenDecoder → 八叉树采样  │
│   └─ ElasticGaussianFixedlenDecoder → Gaussian 参数 │
│   输出：Gaussian 对象 (xyz, rgb, scale, rot, opacity)│
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│ 阶段 5：导出 (Export)                              │
│   可选格式：.ply (ASCII+Splat) / .splat (紧凑二进制) │
└──────────────────────────────────────────────────┘
```

---

## 二、五大模型详解

### 2.1 BiRefNet — 背景移除

| 属性 | 值 |
|------|-----|
| 骨干网络 | Swin-Large（embed_dim=192, depths=[2,2,18,2], num_heads=[6,12,24,48]） |
| 解码器 | ASPP-Deformable Decoder（空洞空间金字塔池化 + 可变形卷积） |
| 输入 | 任意尺寸 RGB 图片 |
| 输出 | RGBA 图片（alpha 通道为前景 mask） |

**工作原理**：
1. Swin-L 骨干提取多尺度特征（4 个 stage，窗口注意力 window_size=12）
2. ASPP-Deformable 模块用不同空洞率（6/12/18）捕获多尺度上下文
3. 可变形卷积应不规则物体边界
4. 上采样 + 逐层适融合恢复到原图分辨率
5. Sigmoid 输出 alpha matte

**预处理后处理**：
- 腐蚀 alpha 边缘（3×3 MinFilter，去除分割边界伪影）
- 计算 alpha>0 区域的包围盒
- 1.2× 扩展裁剪 + 缩放至 1024×1024
- 合成纯黑背景

### 2.2 DINOv3 ViT-H/16+ — 视觉编码器

| 属性 | 值 |
|------|-----|
| 类型 | Vision Transformer（从头实现，零外部依赖） |
| Patch 尺寸 | 16×16 |
| 嵌入维度 | 1280 |
| 注意力头数 | 20 |
| 层数 | 32 |
| 位置编码 | 2D Rotary Position Embedding (RoPE) |
| 寄存器 token | 4 个（register tokens，提升注意力质量） |
| 输入 | 1024×1024 RGB，归一化 (mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]) |
| 输出 | (1, 4101, 1280) — CLS + 4 registers + 64×64 patches |

**关键设计**：
- **2D RoPE**：分别对 H/W 维度编码旋转位置信息，保留 2D 空间结构
- **LayerScale**：每个 attention/MLP 输出乘可学习标量，稳定深层训练
- **SwiGLU MLP**：`silu(gate_proj(x)) * up_proj(x)` 激活函数
- CLS token + register tokens 不参与 RoPE（`num_prefix_tokens=5`）

### 2.3 Flux2 VAE Encoder — 潜空间编码器

| 属性 | 值 |
|------|-----|
| 类型 | VAE 编码器（从头实现） |
| 输入 | 1024×1024，归一化到 [-1, 1] |
| 输出 | (1, 4096, 128) 潜空间特征 |
| 压缩比 | 16× 空间压缩（64×64 → latent tokens） |

**关键设计**：
- **ResNet Block + Attention**：每个下采样阶段含残差卷积 + 自注意力
- **2× 下采样**：逐步将 1024×1024 压缩到 64×64 latent grid
- **确定性/随机编码**：`deterministic=False` 时添加高斯噪声（变分推理）
- 输出补齐 5 个零 token（匹配 DINOv3 的 CLS+registers 数量）

### 2.4 LatentSeqMMFlowModel — 流匹配去噪模型

这是 TripoSplat 的**核心生成模型**，参数量级约 1B。

| 属性 | 值 |
|------|-----|
| Query token 数量 | 8192 |
| 输入/输出通道 | 16 |
| 模型维度 | 1024 |
| 条件通道 1 | 1280（DINOv3 特征） |
| 条件通道 2 | 128（VAE 特征） |
| 注意力头数 | 16 |
| Transformer 块数 | 24 + 2 refiner |
| MLP 比率 | 4 |
| 相机条件 | 可选 5 维 |

**架构**：
```
噪声 latent (1, 8192, 16) ──┐
相机噪声 (1, 1, 5) ─────────┤
                             ├──→ 24× UnifiedTransformerBlock
DINOv3 条件 (1, 4101, 1280) ─┤     (交叉注意力 + 自注意力 + FFN)
VAE 条件 (1, 4101, 128) ────┘     ↓
                             2× RefinerBlock
                                  ↓
                             预测速度场 v ∈ R^(1×8192×16)
```

**UnifiedTransformerBlock 设计**：
- **自注意力**：8192 个 query token 之间相互注意（QK RMSNorm + RoPE）
- **交叉注意力**：query token 关注 DINOv3 + VAE 条件特征
- **自适应调制 (AdaLN)**：时间步嵌入 → 预测 scale/shift/gate，调制每层输出
- **共享调制**：`share_mod=True` 时自注意力和交叉注意力共享同一组调制参数
- **Shift Table**：`use_shift_table=True` 优化注意力偏移

**流匹配 (Flow Matching) 原理**：
- 目标：学习一个速度场 v(x_t, t, cond)，将纯噪声逐步推向目标分布
- 训练：在噪声-数据对之间构造线性插值路径 x_t = t·x_1 + (1-t)·x_0
- 推理（本文档焦点）：从 x_0 ~ N(0,1) 出发，沿预测速度场积分

**Euler 采样器 (FlowEulerCfgSampler)**：
```
x_0 = 随机噪声
for t in [1, ..., 0]:  # shift 调整时间步分布
    v = model(x_t, t, cond)
    x_t = x_t - v * Δt   # Euler 步
return x_0  # 即生成的潜空间编码
```

- **时间步调度 (shift)**：`t_seq = shift * linspace(1,0) / (1 + (shift-1) * linspace(1,0))`
  - shift=1 → 均匀分布
  - shift=3 → 更多步集中在高噪声早期（推荐值）
- **CFG (Classifier-Free Guidance)**：
  - `guidance_scale > 1`：运行条件 + 无条件两次前向，`pred = s·cond_pred - (s-1)·uncond_pred`
  - `guidance_scale ≤ 1`：只跑条件路径，速度翻倍

### 2.5 OctreeGaussianDecoder — 八叉树 + Gaussian 解码器

将潜空间编码解码为具体的 3D Gaussian 参数。

#### 2.5.1 OctreeProbabilityFixedlenDecoder（八叉树概率解码器）

| 属性 | 值 |
|------|-----|
| 模型维度 | 1024 |
| 条件通道 | 16（latent 通道数） |
| Transformer 块数 | 4 |
| 注意力头数 | 16 |

**工作原理**：
1. 输入 latent code (8192, 16)
2. 交叉注意力 Transformer 处理，输出每个 token 的概率分布
3. **概率采样**（非 argmax）：用 Halton 准随机序列从概率分布中采样八叉树结构
4. 八叉树定义空间中哪些区域应放置 Gaussian

**Halton 序列**：低差异准随机序列，比纯随机采样更均匀地覆盖空间，避免 Gaussian 聚集。

#### 2.5.2 ElasticGaussianFixedlenDecoder（弹性 Gaussian 参数解码器）

| 属性 | 值 |
|------|-----|
| 输入通道 | 3（空间坐标） |
| 模型维度 | 1024 |
| 条件通道 | 16 |
| 注意力头数 | 16 |
| Transformer 块数 | 16 |
| 每点 Gaussian 数 | 32 |

**输出参数**（每个 Gaussian）：
| 参数 | 维度 | 激活函数 | 说明 |
|------|------|----------|------|
| `_xyz` | (N, 3) | 无（直接坐标） | 3D 位置 |
| `_features_dc` | (N, 1, 3) | 无 → SH DC | RGB 颜色（球谐 0 阶） |
| `_opacity` | (N, 1) | sigmoid + bias=0.1 | 不透明度 |
| `_scaling` | (N, 3) | softplus + bias=0.004 → square → sqrt | 椭球缩放（各向异性） |
| `_rotation` | (N, 4) | 归一化四元数 | 椭球旋转 |

**弹性设计**：
- `perturb_offset=True`：对八叉树采样的中心点施加可学习偏移
- `offset_scale=0.05`：偏移幅度
- `perturb_size=1.5`：扰动范围
- 每个八叉树节点固定生成 32 个 Gaussian（`gaussians_per_point=32`）
- 学习率缩放：`_xyz=1.0, _features_dc=1.0, _opacity=1.0, _scaling=1.0, _rotation=0.1`（旋转保守更新）

---

## 三、Gaussian Splat 数据格式

### 3.1 3D Gaussian 的数学表示

每个 Gaussian 由以下参数定义：

```
G_i = { μ_i, Σ_i, α_i, c_i }
```

| 符号 | 含义 | 维度 |
|------|------|------|
| μ (xyz) | 3D 中心位置 | (N, 3) |
| Σ (scaling + rotation) | 3×3 协方差矩阵 | 由 scale(3) + rot(4) 构造 |
| α (opacity) | 不透明度 | (N, 1) |
| c (features_dc) | RGB 颜色（球谐 DC） | (N, 3) |

**协方差矩阵分解**：`Σ = RSS^T R^T`
- S = diag(scale_x, scale_y, scale_z)：各向异性缩放
- R = quat_to_matrix(rotation)：旋转矩阵

### 3.2 导出格式

#### .ply（标准 Gaussian Splat 格式）
```
ply
format binary_little_endian 1.0
element vertex N
property float x, y, z           # 位置
property float nx, ny, nz        # 法线（占位）
property float f_dc_0..f_dc_2    # RGB
property float opacity           # 不透明度
property float scale_0..scale_2  # 缩放
property float rot_0..rot_3      # 旋转四元数
end_header
<binary data>
```
坐标变换：`[[1,0,0],[0,0,-1],[0,1,0]]`（Z-up → Y-up）

#### .splat（紧凑格式，32 字节/粒）
```
每个 Gaussian 32 字节：
├─ xyz:    float32×3 = 12 bytes
├─ scale:  float32×3 = 12 bytes
├─ rgba:   uint8×4   =  4 bytes  (RGB from SH DC, A from opacity)
└─ rot:    uint8×4   =  4 bytes  (归一化四元数 → [0,255])
```
按 `opacity × |scale|` 降序排列，优化渲染顺序。

---

## 四、推理管线参数

### 4.1 模型权重

| 组件 | 推荐路径 | 格式 |
|------|----------|------|
| 流匹配模型 | `triposplat_fp16.safetensors` | safetensors |
| 解码器 | `triposplat_vae_decoder_fp16.safetensors` | safetensors |
| DINOv3 ViT | `dino_v3_vit_h.safetensors` | safetensors |
| Flux2 VAE | `flux2-vae.safetensors` | safetensors |
| BiRefNet | `birefnet.safetensors` | safetensors |

所有模型均使用 **safetensors** 格式（安全、快速、无代码执行风险）。

### 4.2 关键超参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `steps` | 20 | 10~50 | Euler 采样步数，越多质量越好但线性增时 |
| `guidance_scale` | 3.0 | 1~7 | CFG 引导强度，越高越贴合原图但可能过饱和 |
| `shift` | 3.0 | 1~5 | 时间步偏移，>1 给高噪声阶段分配更多步 |
| `num_gaussians` | 262144 | 32768~262144 | Gaussian 数量，越多细节越丰富 |
| `seed` | 42 | 任意 | 随机种子，相同 seed 产生相同结果 |
| `erode_radius` | 1 | 0~3 | Alpha 腐蚀半径，防止分割边缘伪影 |

### 4.3 数据类型策略

| 设备 | 编码器精度 | 模型精度 |
|------|-----------|----------|
| CUDA GPU | bfloat16 | float16 |
| CPU | float32（可配 bfloat16） | float32 |

### 4.4 多密度生成

TripoSplat 支持一次编码 + 一次采样 → 多次解码：

```python
# 一次前向，多种 Gaussian 密度
gaussians, preview = pipeline.run(
    image,
    num_gaussians=[32768, 65536, 131072, 262144]
)
# gaussians = [Gaussian(32768), Gaussian(65536), ...]
```

去噪只跑一次，解码器针对不同 `num_gaussians` 重放，大幅节省时间。

---

## 五、代码架构

```
triposplat.py (611 行)              model.py (1726 行)
═══════════════════════              ═══════════════════
Gaussian 类                          DinoV3ViT (ViT-H/16+)
  ├─ 参数存储/激活                     Flux2VAEEncoder
  ├─ PLY 导出                         BiRefNet (Swin-L + ASPP)
  └─ SPLAT 导出                       LatentSeqMMFlowModel
                                        ├─ TimestepEmbedder
FlowEulerCfgSampler                     ├─ UnifiedTransformerBlock×24
  ├─ Euler 积分                         └─ RefinerBlock×2
  └─ CFG 推理                          
                                      OctreeProbabilityFixedlenDecoder
组件加载器                               ├─ ModulatedCrossOnlyTransformer×4
  ├─ load_dinov3()                      └─ Halton 概率采样
  ├─ load_vae_encoder()
  ├─ load_rmbg()                      ElasticGaussianFixedlenDecoder
  ├─ load_flow_model()                  ├─ TransformerBase×16
  └─ load_decoder()                     └─ 参数预测头

TripoSplatPipeline                    OctreeGaussianDecoder
  ├─ preprocess_image()                 └─ 八叉树 + Gaussian 解码
  ├─ encode_image()
  ├─ sample_latent()
  ├─ decode_latent()
  └─ run()
```

---

## 六、与传统方法对比

| 特性 | TripoSplat | 传统 MVS + 3DGS | NeRF 类方法 |
|------|-----------|-----------------|------------|
| 输入 | 单张图片 | 多视角图片 (≥20) | 多视角图片 (≥20) |
| 推理时间 | ~30s (20 steps, 262K gaussians) | 数分钟~数小时 | 数小时 |
| 输出 | 3D Gaussian Splat | 3D Gaussian Splat | 神经辐射场 |
| 依赖 | numpy, safetensors, torch, pillow | COLMAP, OpenCV, CUDA 工具链 | 复杂训练框架 |
| 代码量 | ~2,000 LOC | 数万 LOC | 数万 LOC |
| 质量 | 单图推测，细节由生成模型补全 | 多图重建，几何准确 | 多图优化，新视角逼真 |

---

## 七、关键创新点

1. **流匹配替代扩散**：流匹配 (Flow Matching) 比 DDPM 采样更快更稳定，Euler 积分 20 步即可，无需 SDE 求解器。

2. **潜空间生成**：不在像素/RGB 空间操作，而是在 16 维潜空间生成 8192 个 token，大幅降低计算量。

3. **八叉树概率采样**：不用 argmax 确定空间结构，而是用 Halton 准随机序列概率采样，Gaussian 分布更均匀自然。

4. **多模态条件融合**：DINOv3（语义理解）+ Flux2 VAE（纹理细节），互补编码图片信息。

5. **弹性 Gaussian**：每个八叉树节点可偏移 + 微调，32 个 Gaussian/节点，适应不同几何复杂度。

6. **极简依赖**：所有模型从头实现（无 transformers/diffusers），模型权重用 safetensors 格式，代码可读性强。

---

## 八、在 AI Sketch Cosmos 中的集成

```
用户上传画作
    │
    ├──→ 前端：图像采样 → 粒子云 → SpaceCreature (即时展示)
    │
    └──→ 后端 (可选)：POST /api/artworks
              │
              ├── 阶段 1: TripoSplat 预处理 (BiRefNet 去底)
              ├── 阶段 2: DINOv3 + VAE 编码
              ├── 阶段 3: Flow Matching 采样 (20 steps)
              ├── 阶段 4: 八叉树解码 → 262K Gaussians
              └── 阶段 5: 导出 .splat + manifest.json
                        │
                        ▼
               前端 Spark.js 渲染 3D Gaussian Splat
               (替代默认粒子生命，提供更真实的 3D 展示)
```

### 8.1 双路径入场：先可见，再增强

AI Sketch Cosmos 没有把用户体验完全绑定在一次耗时的 3D 推理上，而是采用两条可以并行工作的路径：

| 路径 | 产物 | 优点 | 适用情况 |
|------|------|------|----------|
| 前端即时路径 | 从原图颜色与轮廓采样得到的图片粒子 | 不依赖 GPU，上传后可以快速进入场景 | 后端未配置、任务排队、生成失败或等待期间 |
| TripoSplat 路径 | `model.splat` 形式的 3D Gaussian | 具有真实空间位置、尺度、旋转和多视角外观 | 后端和模型权重可用时 |

基础 `.splat` 生成完成后即可展示，不必等待语义部位分析。后端随后可以继续生成 `rig.json` 与 `rig-weights.bin`，前端轮询到资源后再给当前模型安装 GPU 蒙皮。这种“基础模型先到、动作能力后到”的设计缩短了首屏等待时间，也避免 Rig 失败阻塞作品入场。

### 8.2 从 Gaussian 资产到 SpaceCreature

TripoSplat 的输出本身是一组静态 Gaussian。它只回答“这个物体在三维空间中是什么样子”，并不包含“如何在星河中生活”。`SpaceCreature` 在资产外层补上运行时状态：

1. 根据作品索引和识别特征分配轨道半径、速度、相位、漂浮幅度与基础姿态。
2. 根据当前距离和相机状态更新模型缩放、朝向、可见性与渲染顺序。
3. 在聚光、爆散、战斗、受困、传送等事件发生时切换专用运动状态。
4. 把摆手、迈腿、摆尾等局部动作转换成少量骨骼矩阵，再由 GPU 对原始 Gaussian 做双四元数变形。
5. 当 Rig 不存在或质量检查失败时，继续显示完整静态模型和整体运动，不拆分、不丢失作品。

因此，TripoSplat 是“身体生成器”，`SpaceCreature`、行为状态库和自动事件导演共同构成“生命系统”。

---

## 九、功能玩法：一件画作如何成为宇宙生物

### 9.1 核心玩法循环

```text
选择画作
   ↓
识别主体特征 + 创建后端任务
   ↓
图片粒子或 Gaussian 基础模型准备完成
   ↓
新作品聚光入场：fly-in → showcase → release
   ↓
回到星河轨道，与其他作品和环境共同运动
   ↓
玩家投喂 / 点击互动 + 系统自动遭遇
   ↓
获得经验、升级、产生新的动作和战斗关系
```

这里的目标不是让用户反复执行复杂指令，而是让上传后的作品持续产生可观察的变化。玩家提供画作并进行轻量互动，系统负责维持背景生态；即使玩家不操作，生物仍会漂浮、追逐、避让和触发环境事件。

### 9.2 玩家可以做什么

| 玩家操作 | 系统响应 | 与 TripoSplat 的关系 |
|----------|----------|----------------------|
| 上传图片 | 创建作品、识别特征、启动生成任务，并在就绪后安排聚光入场 | 生成 `.splat` 的入口 |
| 拖动场景 | 暂停默认自动环绕，改变相机观察角度 | 从不同方向观察 Gaussian 的体积感 |
| 点击空闲生物 | 记录当前空间位置，触发彩色爆散、流星轨迹和重生聚合 | 粒子代理负责特效，原模型在合适阶段重新出现 |
| 点击空白星空 | 在点击位置投放星光食物，附近生物会向食物靠近 | 属于前端行为层，不改变 `.splat` 文件 |
| 按住并拖动画布 | 以指针为中心启动全屏引力透镜、旋涡、冲击波和色差 | 属于后处理层，不修改 Gaussian 数据 |
| 隐藏面板或进入全屏 | 保留沉浸式星河画面，适合展览和大屏播放 | 只影响页面呈现 |

点击生物并不是聚光展示的入口。聚光流程主要服务于“新作品首次入场”，由 `SpotlightDirector` 自动推进；普通点击用于爆散与重生。若生物正在聚光或参与战斗、吸入等事件，点击爆散会被暂时禁止，避免多个状态同时改写位置和透明度。

### 9.3 新作品聚光状态机

新模型准备后，聚光系统按以下阶段运行：

1. **`fly-in`**：生物从场景外沿带着入场轨迹飞向展示位置，相机开始靠近。
2. **`showcase`**：模型在近景中保持可读的朝向与尺度，突出 Gaussian 细节和局部动作。
3. **`release`**：生物离开展示位，镜头和模型逐渐回到常规轨道。
4. **`idle`**：取消聚光专用约束，重新参与普通生态与自动事件。

模型未真正加载完成时不会贸然开始展示；同时上传多件作品时，导演会按准备状态依次处理，避免相机争抢。

### 9.4 投喂、经验与等级

生物初始等级为 `LV 0`。系统会周期性产生星尘投喂事件，生物吸收后积累经验，模型旁的等级徽章显示等级与经验进度。当前升级阈值为：

\[
XP_{required}(L) = 100 + 42L
\]

例如，`LV 0 → LV 1` 需要 100 点经验，`LV 1 → LV 2` 需要 142 点经验。一次奖励超过当前阈值时，剩余经验会继续用于后续等级，因此允许连续升级。

等级不仅是展示信息，也会参与生态判断：

- 高等级或经验进度更高的生物在遭遇比较中排名更高。
- 战斗胜者直接提升 1 级并清空当前经验，随后播放胜利动作。
- 败者降低 1 级并清空当前经验，但不会低于 `LV 0`。
- 用于运动决策的战斗强度还会结合作品的稳定索引，防止所有生物拥有完全相同的基础参数。

### 9.5 自动生态事件

`AutoCosmicInteractions` 定期读取已挂载生物的位置、进化记录、行星位置、传送门和当前聚光状态，并生成以下事件：

| 事件 | 可见表现 | 状态结果 |
|------|----------|----------|
| 追逐与逃跑 | 强势生物靠近目标，弱势生物改变运动方向 | 形成后续战斗或传送意图 |
| 碰撞 | 两个模型短暂冲击、弹开并播放局部受力动作 | 经过冷却后恢复普通轨道 |
| 战斗 | 双方朝向彼此、接近并播放攻击动作 | 根据等级与经验排名决定胜负 |
| 胜利 / 失败 | 胜者庆祝，败者进入受击或重生节奏 | 胜者 `+1` 级，败者 `-1` 级且最低为 0 |
| 行星吸入 | 生物被吸向行星，出现旋涡、挣扎、受困和逃脱 | 记录一次行星受困，不销毁作品 |
| 传送门 | 被追逐目标接近入口并从另一个出口出现 | 快速改变空间位置并继续生态行为 |
| 加速 | 生物短时间提高飞行速度并留下更明显轨迹 | 持续时间结束后恢复基础运动 |

这些事件带有距离门槛、扫描间隔、持续时间和冷却。聚光生命周期具有更高优先级；已经参与事件的生物不会被新的冲突事件重复占用。

---

## 十、语义部位 Rig 与局部动作

### 10.1 为什么不能简单拆模型

Gaussian Splat 不是传统的三角网格。若直接按二维分割图把手、脚或尾巴拆成多个 `.splat`，连接处容易产生空洞、重叠和深度错误。当前方案保留单一 `model.splat`，只额外生成每个 Gaussian 对应的骨骼索引和权重：

```text
model.splat          原始完整模型，始终优先显示
rig.json             骨骼、语义部位、质量信息和动作资源清单
rig-weights.bin      按原始 Gaussian 顺序保存的四组骨骼索引与权重
```

部位内部以刚性权重为主，只在关节连接面的窄带内混合父骨与子骨。这样既能让手脚整体移动，又能减少整片软拉伸和模型接缝。

### 10.2 运行时动作

前端每帧只计算少量骨骼矩阵，并更新骨骼纹理；大量 Gaussian 的实际变形由 GPU 完成。行为层可以根据作品形态和事件选择动作，例如：

- 日常漂浮时的摆手、摆脚、摆翅或摆尾；
- 战斗时的朝向、攻击与受击动作；
- 胜利后的庆祝动作；
- 行星吸入期间的挣扎与蜷缩；
- 聚光展示中的局部表演动作。

不可见、爆散中或距离裁剪的模型不会继续提交无意义的骨骼更新。Rig 资源超时、版本不匹配或质量门禁失败时，系统回退为完整模型的整体运动。

---

## 十一、状态优先级与容错设计

同一个生物可能同时接收到玩家输入、聚光命令和自动事件。为避免位置、缩放、透明度被多个系统争抢，运行时按大致优先级处理：

```text
新作品聚光 / 明确的过场状态
        ↓
传送、行星吸入、战斗等独占事件
        ↓
玩家点击爆散与重生
        ↓
追逐、食物吸引、指针避让
        ↓
普通轨道、漂浮和呼吸运动
```

关键容错策略包括：

- **TripoSplat 未启用**：使用图片粒子继续完整的场景与交互体验。
- **基础 `.splat` 可用、Rig 未完成**：立即显示静态完整模型，后台继续分析。
- **Rig 失败或置信度不足**：不生成低质量骨骼，保留整体运动。
- **模型资源暂时不可用**：前端通过状态与轮询等待，不让错误动作资源覆盖有效模型。
- **事件冲突**：独占事件期间忽略新的爆散输入，结束后清理临时状态并回归轨道。

这种分层让生成质量、网络速度和语义识别结果只影响“增强程度”，而不轻易破坏“作品能够进入星河”这一基本体验。

---

## 十二、阅读建议与相关文档

- 想了解用户从上传到入场的完整过程：阅读 [详细流程](详细流程.md)。
- 想调整推理速度与显存占用：阅读 [TripoSplat 加速说明](TRIPOSPLAT_SPEEDUP.md)。
- 想了解单一 Splat 的部位动作和权重格式：阅读 [GPU Splat Skinning](GPU_SPLAT_SKINNING.md)。
- 想搭建前端、FastAPI 和 GPU 生成环境：阅读 [部署指南](DEPLOYMENT.md)。
- 想了解项目模块边界：阅读 [系统架构](../ARCHITECTURE.md)。

> 论文：[Generative 3D Gaussians with Learned Density Control](https://arxiv.org/abs/2605.16355)
> 仓库：[VAST-AI/TripoSplat](https://github.com/VAST-AI-Research/TripoSplat)
