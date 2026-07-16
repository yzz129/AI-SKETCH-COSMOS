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
import { updateBackendArtworkMetadata } from './backendArtworkLibrary';

function localReadyMessage(artwork: ProcessedArtworkImage, features: ArtworkFeatureResult) {
  return `${artwork.name} 已进入星河：3D 粒子生命 / ${features.motionPreset}`;
}

function splatReadyMessage(artwork: ProcessedArtworkImage, features: ArtworkFeatureResult) {
  return `${artwork.name} 已进入星河：TripoSplat .splat / ${features.motionPreset}`;
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
    return result.message ?? 'TripoSplat 后端已排队，正在等待 GPU 生成 .splat...';
  }

  if (result.status === 'processing') {
    const percent = typeof result.progress === 'number'
      ? ` ${Math.round(result.progress * 100)}%`
      : '';
    return result.message ?? `TripoSplat 正在生成 Gaussian Splat${percent}...`;
  }

  if (result.status === 'ready') {
    return 'TripoSplat 模型已生成，正在加入星河...';
  }

  return result.message ?? 'TripoSplat 生成失败，正在回退到本地粒子生命...';
}

async function addLocalParticleArtwork(file: File) {
  const [artwork, features] = await Promise.all([
    processArtworkImage(file),
    analyzeArtworkFeatures(file)
  ]);
  useArtworkStore.getState().addArtwork(artwork, features);
  useSketchStore.setState({
    status: 'ready',
    message: localReadyMessage(artwork, features)
  });
}

export async function submitArtworkFile(file: File) {
  const sketchStore = useSketchStore.getState();
  const flowStartedAt = performance.now();
  const logStage = (stage: string) => {
    console.info(`[artwork-submit] ${stage} +${((performance.now() - flowStartedAt) / 1000).toFixed(2)}s`);
  };

  if (!isTripoSplatGenerationEnabled()) {
    sketchStore.setProcessing('正在本地去白底、提取主色并生成 3D 粒子生命...');
    await addLocalParticleArtwork(file);
    return;
  }

  try {
    sketchStore.setProcessing('正在提交 TripoSplat 后端任务，等待 .splat 模型生成...');
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
      format: 'splat',
      features: fallbackFeatures,
      onProgress: (result) => {
        useSketchStore.setState({
          status: 'processing',
          message: progressMessage(result)
        });
      }
    });
    logStage('triposplat ready');

    const displayedFeatures = recognizedFeatures ?? fallbackFeatures;
    const displayedArtwork = useArtworkStore.getState().addArtwork(artwork, displayedFeatures, undefined, gaussianModel);
    logStage('artwork added to scene');
    useSketchStore.setState({
      status: 'ready',
      message: `${artwork.name} 已进入星河：基础 .splat 已显示，GPU 骨骼将在后台热加载...`
    });

    useArtworkStore.getState().updateArtworkFeatures(displayedArtwork.id, displayedFeatures);
    void updateBackendArtworkMetadata(artwork, displayedFeatures, gaussianModel);
    useSketchStore.setState({
      status: 'ready',
      message: splatReadyMessage(artwork, displayedFeatures)
    });
    logStage(`scene motion updated / ${displayedFeatures.motionPreset}`);

    if (!recognizedFeatures) {
      void featuresPromise.then((lateFeatures) => {
        if (!lateFeatures) return;
        useArtworkStore.getState().updateArtworkFeatures(displayedArtwork.id, lateFeatures);
        void updateBackendArtworkMetadata(artwork, lateFeatures, gaussianModel);
        logStage(`late scene motion updated / ${lateFeatures.motionPreset}`);
      });
    }
  } catch (error) {
    console.warn('[triposplat] backend-first generation failed; falling back to local particles:', error);
    useSketchStore.getState().setProcessing('TripoSplat 后端不可用或生成失败，正在回退到本地粒子生命...');
    await addLocalParticleArtwork(file);
  }
}
