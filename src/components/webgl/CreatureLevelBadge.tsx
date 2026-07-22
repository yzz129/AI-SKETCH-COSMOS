import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getCreatureEvolution,
  getCreatureExperienceProgress
} from './creatureEvolutionStore';

type CreatureLevelBadgeProps = {
  creatureId: string;
  name: string;
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

function fitCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  const characters = Array.from(value);
  while (characters.length > 1 && context.measureText(`${characters.join('')}…`).width > maxWidth) {
    characters.pop();
  }
  return `${characters.join('')}…`;
}

function drawBadge(canvas: HTMLCanvasElement, name: string, level: number, progress: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  roundedRect(context, 9, 7, 302, 56, 18);
  const namePanel = context.createLinearGradient(9, 7, 311, 63);
  namePanel.addColorStop(0, 'rgba(12, 32, 69, 0.9)');
  namePanel.addColorStop(0.48, 'rgba(38, 20, 80, 0.9)');
  namePanel.addColorStop(1, 'rgba(10, 43, 70, 0.88)');
  context.fillStyle = namePanel;
  context.fill();
  context.strokeStyle = 'rgba(125, 225, 255, 0.42)';
  context.lineWidth = 1.5;
  context.stroke();

  context.font = '600 25px system-ui, "Microsoft YaHei", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const nameText = context.createLinearGradient(42, 0, 278, 0);
  nameText.addColorStop(0, '#79e8ff');
  nameText.addColorStop(0.5, '#f1e8ff');
  nameText.addColorStop(1, '#ff9ed8');
  context.fillStyle = nameText;
  context.shadowColor = 'rgba(121, 232, 255, 0.65)';
  context.shadowBlur = 8;
  context.fillText(fitCanvasText(context, name, 266), 160, 35);
  context.shadowBlur = 0;

  roundedRect(context, 9, 80, 302, 56, 18);
  const panel = context.createLinearGradient(9, 80, 311, 136);
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
  context.fillText(`LV ${level}`, 24, 107);
  context.shadowBlur = 0;

  roundedRect(context, 122, 99, 168, 15, 7.5);
  context.fillStyle = 'rgba(20, 35, 74, 0.92)';
  context.fill();
  const fillWidth = Math.max(0, 164 * THREE.MathUtils.clamp(progress, 0, 1));
  if (fillWidth > 0.5) {
    roundedRect(context, 124, 101, fillWidth, 11, 5.5);
    const bar = context.createLinearGradient(124, 101, 288, 112);
    bar.addColorStop(0, '#52d9ff');
    bar.addColorStop(0.55, '#8d8cff');
    bar.addColorStop(1, '#dc72ff');
    context.fillStyle = bar;
    context.fill();
  }
}

export function CreatureLevelBadge({
  creatureId,
  name,
  index,
  height,
  renderOrderRef,
  reappearRef
}: CreatureLevelBadgeProps) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const lastNameRef = useRef('');
  const lastLevelRef = useRef(-1);
  const lastProgressBucketRef = useRef(-1);
  const badge = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 144;
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
    if (name !== lastNameRef.current || record.level !== lastLevelRef.current || progressBucket !== lastProgressBucketRef.current) {
      drawBadge(badge.canvas, name, record.level, progress);
      badge.texture.needsUpdate = true;
      lastNameRef.current = name;
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
      position={[0, height * 0.58 + 0.24, 0.04]}
      scale={[0.8, 0.36, 1]}
      frustumCulled={false}
    />
  );
}
