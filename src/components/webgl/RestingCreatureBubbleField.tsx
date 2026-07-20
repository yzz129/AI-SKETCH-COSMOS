import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  type CreatureBubbleScreenAnchor,
  getCreatureBubbleDensityScale,
  getCreatureBubbleScreenAnchor
} from './creatureActivity';

type RestingBubbleEntry = {
  id: string;
  previewUrl: string;
  bubbleIndex: number;
  anchor?: CreatureBubbleScreenAnchor;
};

type RestingCreatureBubbleFieldProps = {
  entries: RestingBubbleEntry[];
  atlasSources: string[];
  bubbleCount: number;
};

const ATLAS_TILE_SIZE = 96;
const MAX_ATLAS_SIDE = 4096;
const DEPTH_SEQUENCE = 0.438579021;
const RESTING_BUBBLE_RENDER_ORDER = 3;

const BUBBLE_VERTEX_SHADER = `
  attribute vec2 aScreenPosition;
  attribute vec2 aAtlasOffset;
  attribute float aViewDepth;
  attribute float aPointSize;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uAspect;
  uniform float uTanHalfFov;
  varying vec2 vAtlasOffset;
  varying float vDepthFade;

  void main() {
    vAtlasOffset = aAtlasOffset;
    float viewDepth = max(7.2, aViewDepth);
    vec2 floatingAnchor = clamp(
      aScreenPosition,
      vec2(-0.98, -0.94),
      vec2(0.98, 0.94)
    );

    float halfHeight = uTanHalfFov * viewDepth;
    vec3 viewPosition = vec3(
      floatingAnchor.x * halfHeight * uAspect,
      floatingAnchor.y * halfHeight,
      -viewDepth
    );
    float perspectiveScale = clamp(15.0 / viewDepth, 0.42, 1.72);
    gl_Position = projectionMatrix * vec4(viewPosition, 1.0);
    gl_PointSize = aPointSize > 0.0
      ? aPointSize * uPixelRatio
      : uPointSize * perspectiveScale;
    vDepthFade = smoothstep(38.0, 8.0, viewDepth);
  }
`;

const BUBBLE_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform float uAtlasGrid;
  varying vec2 vAtlasOffset;
  varying float vDepthFade;

  float contentAt(vec2 uv) {
    vec4 sampleColor = texture2D(uAtlas, uv);
    float sampleBrightness = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
    return sampleColor.a * smoothstep(0.025, 0.13, sampleBrightness);
  }

  void main() {
    vec2 pointUv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
    vec2 atlasUv = vAtlasOffset + pointUv / uAtlasGrid;
    vec4 preview = texture2D(uAtlas, atlasUv);
    float luminance = dot(preview.rgb, vec3(0.299, 0.587, 0.114));
    float previewAlpha = preview.a * smoothstep(0.025, 0.14, luminance);
    vec2 tileCenter = vAtlasOffset + vec2(0.5) / uAtlasGrid;
    vec2 probe = vec2(0.18) / uAtlasGrid;
    float tilePresence = contentAt(tileCenter);
    tilePresence = max(tilePresence, contentAt(tileCenter + vec2(probe.x, 0.0)));
    tilePresence = max(tilePresence, contentAt(tileCenter - vec2(probe.x, 0.0)));
    tilePresence = max(tilePresence, contentAt(tileCenter + vec2(0.0, probe.y)));
    tilePresence = max(tilePresence, contentAt(tileCenter - vec2(0.0, probe.y)));
    tilePresence = max(tilePresence, contentAt(tileCenter + probe));
    tilePresence = max(tilePresence, contentAt(tileCenter - probe));
    tilePresence = max(tilePresence, contentAt(tileCenter + vec2(probe.x, -probe.y)));
    tilePresence = max(tilePresence, contentAt(tileCenter + vec2(-probe.x, probe.y)));
    if (tilePresence < 0.025) discard;
    if (previewAlpha < 0.012) discard;

    vec2 edgeProbe = vec2(1.5) / (96.0 * uAtlasGrid);
    float centerMask = contentAt(atlasUv);
    float leftMask = contentAt(atlasUv - vec2(edgeProbe.x, 0.0));
    float rightMask = contentAt(atlasUv + vec2(edgeProbe.x, 0.0));
    float downMask = contentAt(atlasUv - vec2(0.0, edgeProbe.y));
    float upMask = contentAt(atlasUv + vec2(0.0, edgeProbe.y));
    float silhouetteEdge = max(
      max(abs(centerMask - leftMask), abs(centerMask - rightMask)),
      max(abs(centerMask - downMask), abs(centerMask - upMask))
    );
    float edgeStrength = smoothstep(0.035, 0.28, silhouetteEdge);
    float scanline = smoothstep(0.12, 0.58, fract(pointUv.y * 20.0));
    vec3 mutedPreview = mix(vec3(luminance), preview.rgb, 0.72);
    vec3 ghostPreview = mix(mutedPreview, vec3(0.48, 0.76, 1.0), 0.14);
    float fillOpacity = previewAlpha * mix(0.07, 0.125, vDepthFade);
    float outlineOpacity = edgeStrength * mix(0.34, 0.49, vDepthFade);
    float scanlineOpacity = mix(0.78, 1.0, scanline);
    float ghostAlpha = max(fillOpacity, outlineOpacity) * tilePresence * scanlineOpacity;
    if (ghostAlpha < 0.008) discard;
    gl_FragColor = vec4(ghostPreview, ghostAlpha);
  }
`;

type ImageContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const imageContentBoundsCache = new Map<string, ImageContentBounds | null>();

function findImageContentBounds(image: HTMLImageElement): ImageContentBounds | null {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const sampleScale = Math.min(1, 192 / Math.max(sourceWidth, sourceHeight));
  const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
  const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sampleContext) return null;

  try {
    sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const offset = (y * sampleWidth + x) * 4;
        const alpha = pixels[offset + 3];
        const brightness = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        if (alpha < 18 || brightness < 20) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return null;

    const padding = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.08));
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(sampleWidth - 1, maxX + padding);
    maxY = Math.min(sampleHeight - 1, maxY + padding);
    return {
      x: minX / sampleScale,
      y: minY / sampleScale,
      width: (maxX - minX + 1) / sampleScale,
      height: (maxY - minY + 1) / sampleScale
    };
  } catch {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }
}

export function RestingCreatureBubbleField({
  entries,
  atlasSources,
  bubbleCount
}: RestingCreatureBubbleFieldProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pixelRatio = useThree((state) => state.gl.getPixelRatio());
  const viewportAspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const atlasKey = useMemo(
    () => Array.from(new Set(atlasSources.filter(Boolean)))
      .sort((left, right) => left.localeCompare(right))
      .join('\n'),
    [atlasSources]
  );
  const uniqueUrls = useMemo(() => atlasKey ? atlasKey.split('\n') : [], [atlasKey]);
  const atlasGrid = Math.max(1, Math.ceil(Math.sqrt(uniqueUrls.length || 1)));
  const atlasSize = Math.min(MAX_ATLAS_SIDE, atlasGrid * ATLAS_TILE_SIZE);
  const atlasTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = atlasSize;
    canvas.height = atlasSize;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }, [atlasSize]);

  useEffect(() => {
    const canvas = atlasTexture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.clearRect(0, 0, canvas.width, canvas.height);
    let cancelled = false;
    const tileSize = canvas.width / atlasGrid;

    uniqueUrls.forEach((url, index) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (cancelled) return;
        const hasCachedBounds = imageContentBoundsCache.has(url);
        const bounds = hasCachedBounds
          ? imageContentBoundsCache.get(url) ?? null
          : findImageContentBounds(image);
        if (!hasCachedBounds) imageContentBoundsCache.set(url, bounds);
        if (!bounds) return;
        const column = index % atlasGrid;
        const row = Math.floor(index / atlasGrid);
        const scale = Math.min(tileSize / bounds.width, tileSize / bounds.height) * 0.76;
        const width = bounds.width * scale;
        const height = bounds.height * scale;
        const x = column * tileSize + (tileSize - width) * 0.5;
        const y = row * tileSize + (tileSize - height) * 0.5;
        context.drawImage(
          image,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          x,
          y,
          width,
          height
        );
        atlasTexture.needsUpdate = true;
      };
      image.src = url;
    });

    return () => {
      cancelled = true;
    };
  }, [atlasGrid, atlasKey, atlasTexture, uniqueUrls]);

  useEffect(() => () => atlasTexture.dispose(), [atlasTexture]);

  const urlIndex = useMemo(
    () => new Map(uniqueUrls.map((url, index) => [url, index])),
    [uniqueUrls]
  );
  const densityScale = getCreatureBubbleDensityScale(bubbleCount);
  const geometryData = useMemo(() => {
    const positions = new Float32Array(entries.length * 3);
    const screenPositions = new Float32Array(entries.length * 2);
    const atlasOffsets = new Float32Array(entries.length * 2);
    const viewDepths = new Float32Array(entries.length);
    const pointSizes = new Float32Array(entries.length);
    entries.forEach((entry, index) => {
      const anchor = entry.anchor ?? getCreatureBubbleScreenAnchor(entry.bubbleIndex, bubbleCount);
      const depthUnit = (0.5 + (entry.bubbleIndex + 1) * DEPTH_SEQUENCE) % 1;
      const depth = 8.5 + depthUnit * 22;
      screenPositions[index * 2] = anchor.x;
      screenPositions[index * 2 + 1] = anchor.y;
      const tileIndex = urlIndex.get(entry.previewUrl) ?? 0;
      atlasOffsets[index * 2] = (tileIndex % atlasGrid) / atlasGrid;
      atlasOffsets[index * 2 + 1] = 1 - (Math.floor(tileIndex / atlasGrid) + 1) / atlasGrid;
      viewDepths[index] = depth;
      pointSizes[index] = entry.anchor?.pointSize ?? 0;
    });
    return { positions, screenPositions, atlasOffsets, viewDepths, pointSizes };
  }, [atlasGrid, bubbleCount, entries, urlIndex, viewportAspect]);
  const pointSize = THREE.MathUtils.clamp(72 * densityScale, 14, 72) * pixelRatio;
  const uniforms = useMemo(() => ({
    uAtlas: { value: atlasTexture },
    uAtlasGrid: { value: atlasGrid },
    uPointSize: { value: pointSize },
    uPixelRatio: { value: pixelRatio },
    uAspect: { value: viewportAspect },
    uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(25)) }
  }), [atlasGrid, atlasTexture, pointSize, viewportAspect]);

  useFrame(({ camera }) => {
    if (!materialRef.current) return;
    if (camera instanceof THREE.PerspectiveCamera) {
      materialRef.current.uniforms.uAspect.value = camera.aspect;
      materialRef.current.uniforms.uTanHalfFov.value = Math.tan(
        THREE.MathUtils.degToRad(camera.getEffectiveFOV() * 0.5)
      );
    }
  });

  if (entries.length === 0) return null;

  return (
    <points frustumCulled={false} renderOrder={RESTING_BUBBLE_RENDER_ORDER}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometryData.positions, 3]} />
        <bufferAttribute attach="attributes-aScreenPosition" args={[geometryData.screenPositions, 2]} />
        <bufferAttribute attach="attributes-aAtlasOffset" args={[geometryData.atlasOffsets, 2]} />
        <bufferAttribute attach="attributes-aViewDepth" args={[geometryData.viewDepths, 1]} />
        <bufferAttribute attach="attributes-aPointSize" args={[geometryData.pointSizes, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={BUBBLE_VERTEX_SHADER}
        fragmentShader={BUBBLE_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        depthTest
        blending={THREE.NormalBlending}
        toneMapped={false}
      />
    </points>
  );
}
