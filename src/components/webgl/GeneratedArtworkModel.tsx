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
  onReady?: (profile: GeneratedArtworkModelProfile) => void;
  /** Render a stable opaque GLB without animation or vertex displacement. */
  staticModel?: boolean;
  /** Turn plate-like exhibits so their broad decorated face points forward. */
  orientFlatModelToViewer?: boolean;
  /** Release a rotating one-off GLB from the Drei/Three cache when it leaves the scene. */
  releaseResourcesOnUnmount?: boolean;
};

export type GeneratedArtworkModelProfile = {
  isFlat: boolean;
};

const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
const IDENTITY_QUATERNION = new THREE.Quaternion();

function GeneratedArtworkModelAnimation({
  groupRef,
  shaderRefs,
  scale,
  motionPreset
}: {
  groupRef: MutableRefObject<THREE.Group | null>;
  shaderRefs: MutableRefObject<CompiledMaterialShader[]>;
  scale: number;
  motionPreset: MotionPreset;
}) {
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const t = clock.elapsedTime;
    shaderRefs.current.forEach((shader, index) => {
      shader.uniforms.uTime.value = t + index * 0.37;
    });

    const breath = 1 + Math.sin(t * 1.05) * 0.045;

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

  return null;
}

function resolveFlatModelProfile(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const dimensions = [size.x, size.y, size.z] as const;
  const ordered = dimensions
    .map((value, axis) => ({ axis, value }))
    .sort((left, right) => left.value - right.value);
  const largest = Math.max(ordered[2].value, 0.0001);
  // A plate has one clearly shallow axis, while its other two dimensions
  // still form a readable face. This excludes rods and tall narrow objects.
  const isFlat = ordered[0].value / largest <= 0.2
    && ordered[1].value / largest >= 0.28;
  const normal = ordered[0].axis === 0
    ? new THREE.Vector3(1, 0, 0)
    : ordered[0].axis === 1
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);

  return {
    isFlat,
    correction: new THREE.Quaternion().setFromUnitVectors(normal, MODEL_FORWARD)
  };
}

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
  onReady,
  staticModel = false,
  orientFlatModelToViewer = false,
  releaseResourcesOnUnmount = false
}: GeneratedArtworkModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shaderRefs = useRef<CompiledMaterialShader[]>([]);
  const onReadyRef = useRef(onReady);
  const gltf = useGLTF(modelUrl) as any;
  const primaryColor = colors[0] ?? '#ffffff';
  const secondaryColor = colors[1] ?? primaryColor;
  const preparedModel = useMemo(() => {
    const clonedScene = cloneSkeleton(gltf.scene);
    const flatProfile = resolveFlatModelProfile(clonedScene);
    return {
      scene: normalizeGeneratedScene(clonedScene, staticModel ? 1.75 : 1.55),
      ...flatProfile
    };
  }, [gltf.scene, staticModel]);
  const { scene } = preparedModel;
  const flatFacingEnabled = orientFlatModelToViewer && preparedModel.isFlat;
  const flatCorrection = useMemo(
    () => preparedModel.correction.clone(),
    [preparedModel.correction]
  );
  const glowColor = useMemo(() => new THREE.Color(secondaryColor), [secondaryColor]);
  const { actions } = useAnimations(staticModel ? [] : (gltf.animations ?? []), scene);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    shaderRefs.current = [];

    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((sourceMaterial) => staticModel
          ? prepareStableMaterial(sourceMaterial, primaryColor, flatFacingEnabled)
          : enhanceMaterialForSpace({
            sourceMaterial,
            fallbackColor: primaryColor,
            glowColor,
            shaderRefs
          }));
      } else {
        mesh.material = staticModel
          ? prepareStableMaterial(mesh.material, primaryColor, flatFacingEnabled)
          : enhanceMaterialForSpace({
            sourceMaterial: mesh.material,
            fallbackColor: primaryColor,
            glowColor,
            shaderRefs
          });
      }

      mesh.visible = true;
      // Keep culling enabled for permanent exhibits; they are still kept in
      // the scene, but off-screen cards do not consume draw time. Dynamic
      // generated creatures retain the legacy no-cull behavior for entry and
      // spotlight choreography.
      mesh.frustumCulled = staticModel;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    onReadyRef.current?.({ isFlat: flatFacingEnabled });
  }, [flatFacingEnabled, glowColor, primaryColor, scene, staticModel]);

  useEffect(() => {
    if (staticModel) return;

    const animationName = resolveAnimationName(motionPreset, actions);
    const action = animationName ? actions[animationName] : undefined;

    if (action) {
      action.reset().fadeIn(0.35).play();
    }

    return () => {
      action?.fadeOut(0.25);
    };
  }, [actions, motionPreset, staticModel]);

  useEffect(() => () => {
    if (!releaseResourcesOnUnmount) return;
    const disposedTextures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (!(value instanceof THREE.Texture) || disposedTextures.has(value)) continue;
          value.dispose();
          disposedTextures.add(value);
        }
        material.dispose();
      }
    });
    useGLTF.clear(modelUrl);
  }, [modelUrl, releaseResourcesOnUnmount, scene]);

  useEffect(() => {
    if (!staticModel) return;
    const group = groupRef.current;
    if (!group) return;
    group.scale.setScalar(scale);
    group.quaternion.copy(flatFacingEnabled ? flatCorrection : IDENTITY_QUATERNION);
  }, [flatCorrection, flatFacingEnabled, scale, staticModel]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
      {!staticModel ? (
        <GeneratedArtworkModelAnimation
          groupRef={groupRef}
          shaderRefs={shaderRefs}
          scale={scale}
          motionPreset={motionPreset}
        />
      ) : null}
    </group>
  );
}

function prepareStableMaterial(
  sourceMaterial: THREE.Material | undefined,
  fallbackColor: string,
  doubleSided: boolean
) {
  const material = sourceMaterial?.clone?.() ?? new THREE.MeshStandardMaterial({ color: fallbackColor });
  // Preserve every authored GLB texture, tint, emissive value, roughness and
  // metalness exactly. The title color belongs to the label only and must
  // never leak into the model material.
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.depthTest = true;
  material.blending = THREE.NormalBlending;
  if (doubleSided) material.side = THREE.DoubleSide;
  if (material instanceof THREE.MeshStandardMaterial) {
    // The exhibition sits in a dark space scene. Reuse the authored base-color
    // texture as a subtle emissive source so its exact colors remain readable
    // without replacing or tinting the original material.
    if (material.map && !material.emissiveMap) material.emissiveMap = material.map;
    if (material.emissiveMap) {
      material.emissive.set('#ffffff');
      material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.28);
    }
    material.envMapIntensity = Math.max(material.envMapIntensity, 1.15);
  }
  material.needsUpdate = true;
  return material;
}

function normalizeGeneratedScene(scene: THREE.Object3D, targetSize: number) {
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (Number.isFinite(maxDimension) && maxDimension > 0.0001) {
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
