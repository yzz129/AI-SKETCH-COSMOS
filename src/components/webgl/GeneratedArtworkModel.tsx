import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { isFlyingPreset, isPlantPreset, isSwimmingPreset } from '../../lib/motion/motionPresetGroups';
import type { MotionPreset } from '../../types/artwork';

type CompiledMaterialShader = Parameters<THREE.Material['onBeforeCompile']>[0];

type GeneratedArtworkModelProps = {
  modelUrl: string;
  colors: string[];
  motionPreset: MotionPreset;
  scale?: number;
  onReady?: () => void;
};

function resolveAnimationName(
  motionPreset: MotionPreset,
  actions: Record<string, THREE.AnimationAction | null>
) {
  const names = Object.keys(actions);
  const presetCandidates: Partial<Record<MotionPreset, string[]>> = {
    horseGallop: ['Gallop', 'Run', 'Walk', 'Idle'],
    deerBound: ['Jump', 'Hop', 'Run', 'Idle'],
    rabbitHop: ['Hop', 'Jump', 'Idle'],
    squirrelDart: ['Run', 'Jump', 'Idle'],
    elephantWalk: ['Walk', 'Idle'],
    bearLumber: ['Walk', 'Idle'],
    bipedJog: ['Run', 'Jog', 'Walk', 'Idle'],
    bipedDance: ['Dance', 'Wave', 'Idle'],
    bipedMarch: ['March', 'Walk', 'Idle'],
    bipedTiptoe: ['Walk', 'Idle'],
    characterBounce: ['Jump', 'Hop', 'Idle'],
    robotIdle: ['Idle', 'Walk'],
    snakeSlither: ['Crawl', 'Slither', 'Walk', 'Idle'],
    lizardScuttle: ['Crawl', 'Run', 'Walk', 'Idle'],
    crabSideStep: ['Walk', 'Crawl', 'Idle'],
    spiderCrawl: ['Crawl', 'Walk', 'Idle'],
    snailGlide: ['Crawl', 'Idle'],
    rocketBoost: ['Fly', 'Boost', 'Idle'],
    vehicleCruise: ['Drive', 'Move', 'Walk', 'Idle']
  };
  const candidates = presetCandidates[motionPreset]
    ?? (isFlyingPreset(motionPreset) ? ['Fly', 'Flying', 'WingFlap', 'Flap', 'Flutter', 'Idle']
      : isSwimmingPreset(motionPreset) ? ['Swim', 'Float', 'Idle']
        : isPlantPreset(motionPreset) ? ['Sway', 'Grow', 'Idle']
          : ['Run', 'Walk', 'Float', 'Idle']);

  return candidates.find((name) => names.includes(name)) || names[0];
}

export function GeneratedArtworkModel({
  modelUrl,
  colors,
  motionPreset,
  scale = 1,
  onReady
}: GeneratedArtworkModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shaderRefs = useRef<CompiledMaterialShader[]>([]);
  const gltf = useGLTF(modelUrl) as any;
  const scene = useMemo(() => normalizeGeneratedScene(cloneSkeleton(gltf.scene)), [gltf.scene]);
  const glowColor = useMemo(() => new THREE.Color(colors[1] ?? colors[0] ?? '#64d9ff'), [colors]);
  const { actions } = useAnimations(gltf.animations ?? [], scene);

  useEffect(() => {
    shaderRefs.current = [];

    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((sourceMaterial) => enhanceMaterialForSpace({
          sourceMaterial,
          fallbackColor: colors[0] ?? '#ffffff',
          glowColor,
          shaderRefs
        }));
      } else {
        mesh.material = enhanceMaterialForSpace({
          sourceMaterial: mesh.material,
          fallbackColor: colors[0] ?? '#ffffff',
          glowColor,
          shaderRefs
        });
      }

      mesh.visible = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    onReady?.();
  }, [colors, glowColor, scene]);

  useEffect(() => {
    const animationName = resolveAnimationName(motionPreset, actions);
    const action = animationName ? actions[animationName] : undefined;

    if (action) {
      action.reset().fadeIn(0.35).play();
    }

    return () => {
      action?.fadeOut(0.25);
    };
  }, [actions, motionPreset]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 1.05) * 0.045;

    shaderRefs.current.forEach((shader, index) => {
      shader.uniforms.uTime.value = t + index * 0.37;
    });

    group.scale.set(
      scale * (breath + Math.sin(t * 1.72) * 0.018),
      scale * (1 + Math.cos(t * 0.92) * 0.032),
      scale * (1 + Math.sin(t * 1.33) * 0.034)
    );

    if (isSwimmingPreset(motionPreset)) {
      group.rotation.y = Math.sin(t * 1.18) * 0.18;
    } else if (isPlantPreset(motionPreset)) {
      group.rotation.z = Math.sin(t * 0.72) * 0.12;
    } else if (motionPreset === 'snakeSlither' || motionPreset === 'eelWiggle') {
      group.rotation.y = Math.sin(t * 1.45) * 0.22;
      group.rotation.z = Math.sin(t * 1.05) * 0.08;
    } else {
      group.rotation.x = Math.sin(t * 0.58) * 0.035;
      group.rotation.y = Math.sin(t * 0.34) * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function normalizeGeneratedScene(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (Number.isFinite(maxDimension) && maxDimension > 0.0001) {
    const targetSize = 1.55;
    scene.position.sub(center);
    scene.scale.setScalar(targetSize / maxDimension);
  }

  return scene;
}

function enhanceMaterialForSpace({
  sourceMaterial,
  fallbackColor,
  glowColor,
  shaderRefs
}: {
  sourceMaterial: THREE.Material | undefined;
  fallbackColor: string;
  glowColor: THREE.Color;
  shaderRefs: MutableRefObject<CompiledMaterialShader[]>;
}) {
  const material = sourceMaterial?.clone?.() ?? new THREE.MeshStandardMaterial({
    color: new THREE.Color(fallbackColor)
  });

  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;
  material.opacity = 1;

  if ('emissive' in material && material.emissive instanceof THREE.Color) {
    material.emissive.copy(glowColor);
  }
  if ('emissiveIntensity' in material) {
    material.emissiveIntensity = 0.14;
  }
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.min(0.86, Math.max(0.48, material.roughness));
    material.metalness = Math.min(0.08, material.metalness);
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uGlowColor = { value: glowColor };
    shader.uniforms.uFlowStrength = { value: 0.022 };
    shaderRefs.current.push(shader);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uFlowStrength;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float cosmicWave = sin(position.y * 8.0 + uTime * 1.4)
          + cos(position.x * 6.0 - uTime * 1.1)
          + sin((position.x + position.z) * 5.0 + uTime * 0.8);
        transformed += normal * cosmicWave * uFlowStrength;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uGlowColor;`
      )
      .replace(
        '#include <dithering_fragment>',
        `float dreamPulse = 0.5 + 0.5 * sin(uTime * 1.6 + gl_FragCoord.y * 0.015);
        gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.9, gl_FragColor.rgb, dreamPulse * 0.28);
        gl_FragColor.rgb += uGlowColor * dreamPulse * 0.018;
        #include <dithering_fragment>`
      );
  };

  material.needsUpdate = true;
  return material;
}
