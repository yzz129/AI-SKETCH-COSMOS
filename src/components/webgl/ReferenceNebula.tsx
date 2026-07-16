import { useEffect, useMemo } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  referenceNebulaFragmentShader,
  referenceNebulaVertexShader
} from './referenceNebulaShaders';
import { GalaxyNebulaVolume } from './GalaxyNebulaVolume';

const REFERENCE_TEXTURE_URL = '/textures/nebula-reference.png';
const REFERENCE_ASPECT = 1016 / 585;
const REFERENCE_CORE_UV = new THREE.Vector2(0.49, 0.51);

type NebulaLayerDefinition = {
  profile: number;
  opacity: number;
  flowMultiplier: number;
  speedMultiplier: number;
  angularMultiplier: number;
  phase: number;
  scale: number;
  z: number;
  tint: string;
  renderOffset: number;
};

const NEBULA_LAYERS: readonly NebulaLayerDefinition[] = [
  { profile: 0, opacity: 0.68, flowMultiplier: 0.52, speedMultiplier: 0.72, angularMultiplier: 0.72, phase: 0, scale: 1, z: 0, tint: '#ffffff', renderOffset: 1 },
  { profile: 1, opacity: 0.42, flowMultiplier: 1, speedMultiplier: 1, angularMultiplier: 1, phase: 2.14, scale: 1.008, z: -0.08, tint: '#ffffff', renderOffset: 2 },
  { profile: 2, opacity: 0.30, flowMultiplier: -0.82, speedMultiplier: 1.18, angularMultiplier: 0.86, phase: 4.37, scale: 0.995, z: 0.095, tint: '#ffffff', renderOffset: 3 },
  { profile: 3, opacity: 0.28, flowMultiplier: 0.98, speedMultiplier: 0.82, angularMultiplier: 0.58, phase: 1.27, scale: 1.038, z: -0.15, tint: '#ffffff', renderOffset: 4 }
];

const VALIDATION_LAYER: readonly NebulaLayerDefinition[] = [
  { profile: 0, opacity: 1, flowMultiplier: 0, speedMultiplier: 0, angularMultiplier: 0, phase: 0, scale: 1, z: 0, tint: '#ffffff', renderOffset: 0 }
];

export interface ReferenceNebulaOptions {
  position?: [number, number, number];
  scale?: number;
  rotation?: number | [number, number, number];
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  flowStrength?: number;
  flowSpeed?: number;
  angularFlow?: number;
  coreProtection?: number;
  edgeFade?: number;
  depthTest?: boolean;
  opaqueReference?: boolean;
}

type ReferenceNebulaProps = ReferenceNebulaOptions & {
  radius?: number;
  renderOrder?: number;
};

function getRotation(rotation: ReferenceNebulaOptions['rotation']): [number, number, number] {
  if (Array.isArray(rotation)) return rotation;
  return [0, 0, rotation ?? 0];
}

function isStaticValidationMode() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('nebulaTime') === '0';
}

export function ReferenceNebula({
  position = [0, 0, 0],
  scale = 1,
  rotation = 0,
  opacity = 1,
  brightness = 1,
  contrast = 1,
  saturation = 1,
  flowStrength = 0.0022,
  flowSpeed = 1 / 32,
  angularFlow = 0.1,
  coreProtection = 0.13,
  edgeFade = 0.075,
  depthTest = true,
  opaqueReference = false,
  radius = 1,
  renderOrder = 3
}: ReferenceNebulaProps) {
  const gl = useThree((state) => state.gl);
  const texture = useLoader(THREE.TextureLoader, REFERENCE_TEXTURE_URL);
  const staticValidation = useMemo(isStaticValidationMode, []);
  const resolvedRotation = useMemo(() => getRotation(rotation), [rotation]);
  const layerDefinitions = opaqueReference ? VALIDATION_LAYER : NEBULA_LAYERS;
  const materials = useMemo(() => layerDefinitions.map((layer) => new THREE.ShaderMaterial({
      uniforms: {
        uNebulaTexture: { value: texture },
        uTime: { value: 0 },
        uOpacity: { value: opacity },
        uBrightness: { value: brightness },
        uContrast: { value: contrast },
        uSaturation: { value: saturation },
        uFlowStrength: { value: flowStrength * layer.flowMultiplier },
        uFlowSpeed: { value: flowSpeed * layer.speedMultiplier },
        uAngularFlow: { value: angularFlow * layer.angularMultiplier },
        uCoreProtection: { value: coreProtection },
        uEdgeFade: { value: edgeFade },
        uOpaqueReference: { value: opaqueReference ? 1 : 0 },
        uLayerProfile: { value: layer.profile },
        uLayerOpacity: { value: layer.opacity },
        uLayerTint: { value: new THREE.Color(layer.tint) },
        uFlowPhase: { value: layer.phase },
        uCoreUV: { value: REFERENCE_CORE_UV.clone() }
      },
      vertexShader: referenceNebulaVertexShader,
      fragmentShader: referenceNebulaFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest,
      toneMapped: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    })), [
    angularFlow,
    brightness,
    contrast,
    coreProtection,
    depthTest,
    edgeFade,
    flowSpeed,
    flowStrength,
    layerDefinitions,
    opacity,
    opaqueReference,
    saturation,
    texture
  ]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(
    radius * 2,
    (radius * 2) / REFERENCE_ASPECT,
    1,
    1
  ), [radius]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
  }, [gl, texture]);

  useEffect(() => () => {
    geometry.dispose();
    materials.forEach((material) => material.dispose());
  }, [geometry, materials]);

  useFrame(({ clock }) => {
    const time = staticValidation ? 0 : clock.elapsedTime;
    materials.forEach((material) => {
      material.uniforms.uTime.value = time;
    });
  });

  return (
    <group position={position} rotation={resolvedRotation} scale={scale}>
      {!opaqueReference && (
        <GalaxyNebulaVolume
          radius={radius}
          opacity={opacity}
          staticTime={staticValidation}
          renderOrder={renderOrder}
        />
      )}
      {layerDefinitions.map((layer, index) => (
        <mesh
          key={`${layer.profile}-${layer.phase}`}
          position={[0, 0, layer.z * radius]}
          scale={layer.scale}
          renderOrder={renderOrder + layer.renderOffset}
          raycast={() => null}
          frustumCulled={false}
        >
          <primitive object={geometry} attach="geometry" />
          <primitive object={materials[index]} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

useLoader.preload(THREE.TextureLoader, REFERENCE_TEXTURE_URL);
