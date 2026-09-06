import { analyzeArtworkFeatures } from '../ai/analyzeArtworkFeatures';
import {
  generateGaussianArtworkModel,
  isTripoSplatGenerationEnabled
} from '../ai/generateGaussianArtworkModel';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import type { ArtworkFeatureResult, ArtworkGaussianModelResult } from '../../types/artwork';
import { processArtworkImage } from '../../utils/artworkImage';
import type { ProcessedArtworkImage } from '../../utils/artworkImage';
import {
  isArtworkModerationError,
  maskSensitiveText,
  moderateArtworkImage
} from '../../utils/contentModeration';
import { updateBackendArtworkMetadata } from './backendArtworkLibrary';

function localReadyMessage(artwork: ProcessedArtworkImage, features: ArtworkFeatureResult) {
  return `${artwork.name} 已进入星河：3D 粒子生命 / ${features.motionPreset}`;
}

function splatReadyMessage(artwork: ProcessedArtworkImage, features: ArtworkFeatureResult) {
  return `${artwork.name} 已进入星河：3D 模型 / ${features.motionPreset}`;
}

function quickFallbackFeatures(artwork: ProcessedArtworkImage): ArtworkFeatureResult {
  return {
    subjectCategory: 'abstract',
    morphology: {
      hasWings: false,
      wingCount: 0,
      hasLegs: false,
      legCount: 0,
      hasTail: false,
      hasFins: false,
      hasArms: false,
      hasHead: false,
      bodyOrientation: 'floating',
      silhouetteComplexity: 'medium'
    },
    behaviorTraits: {
      locomotionType: 'floating',
      energyLevel: 'gentle',
      personalityFeel: 'dreamy'
    },
    visualTraits: {
      dominantColors: dominantColorsFromArtwork(artwork),
      brightness: 'medium',
      softness: 'soft',
      textureStyle: 'handdrawn'
    },
    motionPreset: 'spiritFloat'
  };
}

function dominantColorsFromArtwork(artwork: ProcessedArtworkImage) {
  if (!artwork.particles.length) return ['#64d9ff', '#ffd166', '#bba7ff'];

  const buckets = new Map<string, number>();
  const stride = Math.max(1, Math.floor(artwork.particles.length / 900));
  for (let i = 0; i < artwork.particles.length; i += stride) {
    const particle = artwork.particles[i];
    const r = Math.round(particle.r / 32) * 32;
    const g = Math.round(particle.g / 32) * 32;
    const b = Math.round(particle.b / 32) * 32;
    const key = [r, g, b]
      .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0'))
      .join('');
    buckets.set(key, (buckets.get(key) ?? 0) + particle.alpha);
  }

  const colors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([color]) => `#${color}`);

  return colors.length ? colors : ['#64d9ff', '#ffd166', '#bba7ff'];
}

function progressMessage(result: ArtworkGaussianModelResult) {
  if (result.status === 'queued') {
    const position = typeof result.queuePosition === 'number' && result.queuePosition > 0
      ? `当前第 ${result.queuePosition} 位`
      : '已进入队列';
    const waitMinutes = typeof result.estimatedWaitSeconds === 'number' && result.estimatedWaitSeconds > 0
      ? `，预计等待约 ${Math.max(1, Math.ceil(result.estimatedWaitSeconds / 60))} 分钟`
      : '';
    return `生成任务${position}${waitMinutes}；你可以先去参观其他展会项目。`;
  }

  if (result.status === 'processing') {
    const percent = typeof result.progress === 'number'
      ? ` ${Math.round(result.progress * 100)}%`
      : '';
    return `正在生成 3D 模型${percent}...`;
  }

  if (result.status === 'ready') {
    return '3D 模型已生成，正在加入星河...';
  }

  return '3D 模型生成失败，正在准备备用效果...';
}

async function addLocalParticleArtwork(file: File, requestedName?: string) {
  const [artwork, features] = await Promise.all([
    processArtworkImage(file),
    analyzeArtworkFeatures(file)
  ]);
  const namedArtwork = requestedName ? { ...artwork, name: requestedName } : artwork;
  const storedArtwork = useArtworkStore.getState().addArtwork(namedArtwork, features);
  useSketchStore.setState({
    status: 'ready',
    message: localReadyMessage(namedArtwork, features)
  });
  return storedArtwork;
}

export type SubmitArtworkFileOptions = {
  allowLocalFallback?: boolean;
  name?: string;
  onGaussianProgress?: (result: ArtworkGaussianModelResult) => void;
  submissionId?: string;
  signal?: AbortSignal;
  userContext?: Record<string, unknown>;
  anonymous?: boolean;
};

function createSubmissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function submitArtworkFile(
  file: File,
  {
    allowLocalFallback = true,
    name,
    onGaussianProgress,
    submissionId,
    signal,
    userContext,
    anonymous = false
  }: SubmitArtworkFileOptions = {}
) {
  const sketchStore = useSketchStore.getState();
  const safeName = name ? maskSensitiveText(name).trim() || undefined : undefined;
  // Give every browser upload a stable per-submission key so the backend can
  // attribute timing and traffic even when the caller does not provide one.
  const effectiveSubmissionId = submissionId ?? createSubmissionId();
  const flowStartedAt = performance.now();
  const logStage = (stage: string) => {
    console.info(`[artwork-submit] ${stage} +${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s`);
  };
  const backendGenerationEnabled = isTripoSplatGenerationEnabled();

  // The FastAPI generation endpoint performs its own moderation before queueing.
  // Local-only mode needs the Vite preflight because it never reaches FastAPI.
  if (!backendGenerationEnabled) {
    sketchStore.setProcessing('正在进行内容安全检测...');
    try {
      await moderateArtworkImage(file, signal);
      logStage('content moderation passed');
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : '内容安全检测失败，请稍后重试。';
      sketchStore.setError(message);
      throw error;
    }
  }

  if (!backendGenerationEnabled) {
    if (!allowLocalFallback) {
      const error = new Error('3D 模型服务尚未配置，当前作品无法发送到大屏。');
      sketchStore.setError(error.message);
      throw error;
    }
    sketchStore.setProcessing('正在本地去白底、提取主色并生成 3D 粒子生命...');
    return addLocalParticleArtwork(file, safeName);
  }

  try {
    sketchStore.setProcessing('正在提交生成任务，等待 3D 模型生成...');
    logStage('start');
    const artworkPromise = processArtworkImage(file).then((artwork) => {
      logStage('local artwork processed');
      return artwork;
    });
    let recognizedFeatures: ArtworkFeatureResult | null = null;
    const featuresPromise = analyzeArtworkFeatures(file)
      .then((features) => {
        recognizedFeatures = features;
        logStage(`ai features ready / ${features.motionPreset}`);
        return features;
      })
      .catch((error) => {
        console.warn('[artwork-submit] AI feature recognition failed after model display; keeping fallback motion.', error);
        return null;
      });
    const artwork = await artworkPromise;
    logStage('original triposplat input prepared');
    const fallbackFeatures = quickFallbackFeatures(artwork);
    // Start reconstruction immediately. The refined feature request already
    // runs in parallel and can update motion after the intact Splat appears.
    const gaussianModel = await generateGaussianArtworkModel({
      file,
      name: safeName,
      submissionId: effectiveSubmissionId,
      signal,
      format: 'splat',
      features: fallbackFeatures,
      userContext,
      anonymous,
      onProgress: (result) => {
        onGaussianProgress?.(result);
        useSketchStore.setState({
          status: 'processing',
          message: progressMessage(result)
        });
      }
    });
    logStage('triposplat ready');

    const namedArtwork = {
      ...artwork,
      name: gaussianModel.artworkName ?? safeName ?? artwork.name
    };
    const displayedFeatures = recognizedFeatures ?? fallbackFeatures;
    const displayedArtwork = useArtworkStore.getState().addArtwork(namedArtwork, displayedFeatures, undefined, gaussianModel);
    logStage('artwork added to scene');
    useSketchStore.setState({
      status: 'ready',
      message: `${namedArtwork.name} 已进入星河：基础 3D 模型已显示，动态效果将在后台加载...`
    });

    useArtworkStore.getState().updateArtworkFeatures(displayedArtwork.id, displayedFeatures);
    void updateBackendArtworkMetadata(namedArtwork, displayedFeatures, gaussianModel);
    useSketchStore.setState({
      status: 'ready',
      message: splatReadyMessage(namedArtwork, displayedFeatures)
    });
    logStage(`scene motion updated / ${displayedFeatures.motionPreset}`);

    if (!recognizedFeatures) {
      void featuresPromise.then((lateFeatures) => {
        if (!lateFeatures) return;
        useArtworkStore.getState().updateArtworkFeatures(displayedArtwork.id, lateFeatures);
        void updateBackendArtworkMetadata(namedArtwork, lateFeatures, gaussianModel);
        logStage(`late scene motion updated / ${lateFeatures.motionPreset}`);
      });
    }
    return displayedArtwork;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    if (isArtworkModerationError(error)) {
      useSketchStore.getState().setError(error.message);
      throw error;
    }
    if (!allowLocalFallback) {
      const message = error instanceof Error
        ? error.message
        : '3D 模型服务暂时不可用或生成失败，请稍后重试。';
      useSketchStore.getState().setError(message);
      throw error;
    }
    console.warn('[triposplat] backend-first generation failed; falling back to local particles:', error);
    useSketchStore.getState().setProcessing('3D 模型生成失败，正在准备备用效果...');
    return addLocalParticleArtwork(file, safeName);
  }
}
