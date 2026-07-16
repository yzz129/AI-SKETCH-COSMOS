import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getCreatureEvolution,
  getCreatureExperienceProgress
} from './creatureEvolutionStore';

type CreatureLevelBadgeProps = {
  creatureId: string;
  index: number;
  height: number;
  renderOrderRef?: MutableRefObject<number>;
  reappearRef?: MutableRefObject<number>;
};

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawBadge(canvas: HTMLCanvasElement, level: number, progress: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  roundedRect(context, 9, 8, 238, 56, 18);
  const panel = context.createLinearGradient(9, 8, 247, 64);
  panel.addColorStop(0, 'rgba(9, 18, 52, 0.9)');
  panel.addColorStop(0.55, 'rgba(23, 14, 65, 0.88)');
  panel.addColorStop(1, 'rgba(7, 28, 58, 0.88)');
  context.fillStyle = panel;
  context.fill();

  context.font = '600 25px system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = '#dff8ff';
  context.shadowColor = '#7fe7ff';
  context.shadowBlur = 8;
  context.fillText(`LV ${level}`, 24, 35);
  context.shadowBlur = 0;

  roundedRect(context, 105, 27, 122, 15, 7.5);
  context.fillStyle = 'rgba(20, 35, 74, 0.92)';
  context.fill();
  const fillWidth = Math.max(0, 118 * THREE.MathUtils.clamp(progress, 0, 1));
  if (fillWidth > 0.5) {
    roundedRect(context, 107, 29, fillWidth, 11, 5.5);
    const bar = context.createLinearGradient(107, 29, 225, 40);
    bar.addColorStop(0, '#52d9ff');
    bar.addColorStop(0.55, '#8d8cff');
    bar.addColorStop(1, '#dc72ff');
    context.fillStyle = bar;
    context.fill();
  }
}

export function CreatureLevelBadge({
  creatureId,
  index,
  height,
  renderOrderRef,
  reappearRef
}: CreatureLevelBadgeProps) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const lastLevelRef = useRef(-1);
  const lastProgressBucketRef = useRef(-1);
  const badge = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    });
    return { canvas, texture, material };
  }, []);

  useEffect(() => () => {
    badge.material.dispose();
    badge.texture.dispose();
  }, [badge]);

  useFrame(() => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const record = getCreatureEvolution(creatureId, index);
    const progress = getCreatureExperienceProgress(creatureId, index);
    const progressBucket = Math.floor(progress * 32);
    if (record.level !== lastLevelRef.current || progressBucket !== lastProgressBucketRef.current) {
      drawBadge(badge.canvas, record.level, progress);
      badge.texture.needsUpdate = true;
      lastLevelRef.current = record.level;
      lastProgressBucketRef.current = progressBucket;
    }
    sprite.renderOrder = (renderOrderRef?.current ?? 10) + 12;
    badge.material.opacity = THREE.MathUtils.clamp(reappearRef?.current ?? 1, 0, 1) * 0.92;
  });

  return (
    <sprite
      ref={spriteRef}
      material={badge.material}
      position={[0, height * 0.58 + 0.15, 0.04]}
      scale={[0.64, 0.18, 1]}
      frustumCulled={false}
    />
  );
}
