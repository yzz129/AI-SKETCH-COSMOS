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

  if (!isTripoSplatGenerationEnabled()) {
    sketchStore.setProcessing('正在本地去白底、提取主色并生成 3D 粒子生命...');
    await addLocalParticleArtwork(file);
    return;
  }

  try {
    sketchStore.setProcessing('正在提交 TripoSplat 后端任务，等待 .splat 模型生成...');
    const artworkPromise = processArtworkImage(file);
    const featuresPromise = analyzeArtworkFeatures(file);
    const gaussianModel = await generateGaussianArtworkModel({
      file,
      format: 'splat',
      onProgress: (result) => {
        useSketchStore.setState({
          status: 'processing',
          message: progressMessage(result)
        });
      }
    });

    const [artwork, features] = await Promise.all([artworkPromise, featuresPromise]);
    useArtworkStore.getState().addArtwork(artwork, features, undefined, gaussianModel);
    void updateBackendArtworkMetadata(artwork, features, gaussianModel);
    useSketchStore.setState({
      status: 'ready',
      message: splatReadyMessage(artwork, features)
    });
  } catch (error) {
    console.warn('[triposplat] backend-first generation failed; falling back to local particles:', error);
    useSketchStore.getState().setProcessing('TripoSplat 后端不可用或生成失败，正在回退到本地粒子生命...');
    await addLocalParticleArtwork(file);
  }
}
