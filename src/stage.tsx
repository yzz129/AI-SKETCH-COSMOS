import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

export type SceneMode = 'aquarium';

type Personality = 'shy' | 'curious' | 'slow' | 'social';
type CreatureKind = 'fish' | 'jellyfish' | 'squid' | 'whale' | 'turtle' | 'seahorse' | 'crab';

type BirthInfo = {
  name: string;
  kind: CreatureKind;
  personality: Personality;
};

type OverlayState = {
  fps: number;
  creatures: number;
  scanActive: boolean;
  latestBirth: BirthInfo;
  scene: SceneMode;
  setScene: (scene: SceneMode) => void;
};

type AquariumStageProps = {
  overlay: (state: OverlayState) => React.ReactNode;
};

type Creature = {
  id: number;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  baseScale: number;
  phase: number;
  personality: Personality;
  kind: CreatureKind;
  foodPull: number;
};

type FoodBag = {
  sprite: THREE.Sprite;
  life: number;
};

type Bubble = {
  sprite: THREE.Sprite;
  speed: number;
  drift: number;
};

type AnimatedReef = {
  group: THREE.Group;
  phase: number;
  sway: number;
};

type AquariumEnvironment = {
  group: THREE.Group;
  corals: AnimatedReef[];
  waterMaterial: THREE.ShaderMaterial;
  currentMaterial: THREE.ShaderMaterial;
  backWall: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  currentPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  baseWidth: number;
};

const names = ['Nana', 'Toto', 'Mimi', 'Kiki', 'Lulu', 'Poco', 'Sora', 'Bibi', 'Momo'];
const kinds: CreatureKind[] = ['fish', 'fish', 'fish', 'jellyfish', 'squid', 'whale', 'turtle', 'seahorse', 'crab'];
const personalities: Personality[] = ['shy', 'curious', 'slow', 'social'];
const colorSets = [
  ['#f14d4d', '#f5d94c', '#2f8fe8'],
  ['#f266a6', '#ffb64c', '#3aa968'],
  ['#1b75d1', '#f4f4f4', '#f2cd43'],
  ['#42b883', '#f5a642', '#e85d75'],
  ['#8a66d9', '#4fc3e6', '#f9e15d'],
  ['#f26a2e', '#f0f0f0', '#282828']
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const vividOnly = (colors: string[]) => colors.filter((color) => !['#ffffff', '#f0f0f0', '#f4f4f4'].includes(color.toLowerCase()));

function jitter(value: number, amount = 2.5) {
  return value + rand(-amount, amount);
}

function makeCircleTexture(color: string, radius = 58) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.58, color);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: new THREE.Color('#28ddff') },
      uMid: { value: new THREE.Color('#008ee4') },
      uDeep: { value: new THREE.Color('#032b83') }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uDeep;
      varying vec2 vUv;

      float wave(vec2 p, float speed, float scale) {
        return sin((p.x * 8.0 + p.y * 3.0 + uTime * speed) * scale);
      }

      void main() {
        float depth = smoothstep(0.0, 1.0, vUv.y);
        vec3 color = mix(uDeep, uMid, depth);
        color = mix(color, uTop, smoothstep(0.62, 1.0, depth) * 0.55);

        float current = wave(vUv + vec2(uTime * 0.012, 0.0), 0.55, 1.0) * 0.5 + 0.5;
        float slow = wave(vUv.yx + vec2(0.2, uTime * 0.018), 0.28, 1.7) * 0.5 + 0.5;
        float caustic = pow(abs(sin((vUv.x * 26.0 + vUv.y * 18.0 + uTime * 0.8) + slow * 1.4)), 18.0);
        caustic += pow(abs(sin((vUv.x * -18.0 + vUv.y * 24.0 - uTime * 0.65) + current)), 20.0);
        caustic *= 0.04 + depth * 0.09;

        float beam = smoothstep(0.94, 0.2, abs(fract(vUv.x * 6.0 + sin(uTime * 0.08) * 0.12) - 0.5));
        beam *= smoothstep(1.0, 0.14, vUv.y) * 0.07;

        float vignette = smoothstep(0.88, 0.1, distance(vUv, vec2(0.5, 0.52)));
        color += vec3(0.38, 0.96, 1.0) * caustic;
        color += vec3(0.8, 1.0, 1.0) * beam;
        color *= 0.68 + vignette * 0.52;

        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
}

function makeCurrentMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        float ripple = sin(vUv.x * 34.0 + vUv.y * 12.0 + uTime * 1.4);
        ripple += sin(vUv.x * -16.0 + vUv.y * 28.0 - uTime * 1.05);
        float line = smoothstep(1.55, 1.92, ripple);
        float fade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.2, vUv.y);
        gl_FragColor = vec4(0.68, 1.0, 1.0, line * fade * 0.16);
      }
    `
  });
}

function tubeBetween(points: THREE.Vector3[], radius: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 18, radius, 9, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeCoralGroup(height: number, color: string) {
  const group = new THREE.Group();
  const mainMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    metalness: 0.02,
    emissive: new THREE.Color(color).multiplyScalar(0.18)
  });
  const tipColor = new THREE.Color(color).lerp(new THREE.Color('#fff8d4'), 0.22);
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: tipColor,
    roughness: 0.36,
    emissive: new THREE.Color(color).multiplyScalar(0.32)
  });
  const radius = rand(0.035, 0.07);
  const trunk = tubeBetween([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(rand(-0.05, 0.08), height * 0.34, rand(-0.05, 0.05)),
    new THREE.Vector3(rand(-0.1, 0.12), height * 0.72, rand(-0.06, 0.08)),
    new THREE.Vector3(rand(-0.08, 0.08), height, rand(-0.05, 0.06))
  ], radius, mainMaterial);
  group.add(trunk);

  const branchCount = Math.floor(rand(3, 7));
  for (let i = 0; i < branchCount; i += 1) {
    const startY = height * rand(0.24, 0.84);
    const side = i % 2 === 0 ? 1 : -1;
    const end = new THREE.Vector3(side * rand(0.18, 0.55), startY + rand(0.12, 0.42), rand(-0.18, 0.16));
    const branch = tubeBetween([
      new THREE.Vector3(rand(-0.04, 0.04), startY, rand(-0.04, 0.04)),
      new THREE.Vector3(end.x * 0.46, startY + rand(0.05, 0.2), end.z * 0.4),
      end
    ], radius * rand(0.5, 0.82), mainMaterial);
    group.add(branch);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * rand(0.72, 1.16), 10, 8), tipMaterial);
    tip.position.copy(end);
    tip.castShadow = true;
    group.add(tip);
  }

  return group;
}

function makeAnemone(color: string) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    emissive: new THREE.Color(color).multiplyScalar(0.24)
  });
  const tentacles = Math.floor(rand(12, 22));
  for (let i = 0; i < tentacles; i += 1) {
    const angle = (i / tentacles) * Math.PI * 2;
    const length = rand(0.24, 0.62);
    const root = new THREE.Vector3(Math.cos(angle) * rand(0.02, 0.12), 0, Math.sin(angle) * rand(0.02, 0.12));
    const tip = new THREE.Vector3(Math.cos(angle) * rand(0.08, 0.22), length, Math.sin(angle) * rand(0.08, 0.22));
    group.add(tubeBetween([root, new THREE.Vector3(root.x * 0.5, length * 0.55, root.z * 0.5), tip], rand(0.018, 0.032), material));
  }
  return group;
}

function makeRock() {
  const material = new THREE.MeshStandardMaterial({
    color: pick(['#d8f4ff', '#94c9d8', '#fff1d5', '#7ab4c5']),
    roughness: 0.78,
    metalness: 0
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 22, 14), material);
  mesh.scale.set(rand(1.0, 2.6), rand(0.32, 0.78), rand(0.38, 1.0));
  mesh.rotation.set(rand(-0.12, 0.12), rand(0, Math.PI), rand(-0.12, 0.12));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildAquariumEnvironment(width: number, height: number) {
  const group = new THREE.Group();
  const corals: AnimatedReef[] = [];
  const waterMaterial = makeWaterMaterial();
  const currentMaterial = makeCurrentMaterial();

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5, 64, 36), waterMaterial);
  backWall.position.z = -6.8;
  group.add(backWall);

  const currentPlane = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5, 24, 12), currentMaterial);
  currentPlane.position.z = 3.7;
  group.add(currentPlane);

  const seabedMaterial = new THREE.MeshStandardMaterial({
    color: '#e8f8d0',
    roughness: 0.68,
    metalness: 0.02,
    emissive: new THREE.Color('#0a8fd8').multiplyScalar(0.12)
  });
  const seabedGeometry = new THREE.PlaneGeometry(width * 1.3, height * 0.28, 96, 8);
  const seabedPositions = seabedGeometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < seabedPositions.count; i += 1) {
    const x = seabedPositions.getX(i);
    const y = seabedPositions.getY(i);
    const vertical = (y / (height * 0.28)) + 0.5;
    seabedPositions.setY(i, y + Math.sin(x * 0.78) * 0.06 * vertical);
    seabedPositions.setZ(i, Math.sin(x * 1.4 + vertical * 3.0) * 0.08 + rand(-0.025, 0.025));
  }
  seabedGeometry.computeVertexNormals();
  const seabed = new THREE.Mesh(seabedGeometry, seabedMaterial);
  seabed.position.set(0, -height * 0.52, -1.7);
  seabed.receiveShadow = true;
  group.add(seabed);

  const reefColors = ['#ff3c8f', '#ffcc24', '#fb7045', '#23e7b6', '#18dfff', '#815cff', '#f7f2ff'];
  for (let i = 0; i < 72; i += 1) {
    const x = rand(-width * 0.55, width * 0.55);
    const layer = rand(0, 1);
    const z = rand(-3.9, 1.25);
    const baseY = -height * 0.49 + layer * rand(-0.1, 0.24);
    const h = rand(0.48, 1.95) * (z < -1.5 ? 1.15 : 0.92);
    const coral = Math.random() < 0.72 ? makeCoralGroup(h, pick(reefColors)) : makeAnemone(pick(reefColors));
    coral.position.set(x, baseY, z);
    coral.rotation.set(rand(-0.08, 0.08), rand(-0.4, 0.4), rand(-0.12, 0.12));
    coral.scale.setScalar(rand(0.72, 1.28));
    group.add(coral);
    corals.push({ group: coral, phase: rand(0, Math.PI * 2), sway: rand(0.012, 0.045) });
  }

  for (let i = 0; i < 30; i += 1) {
    const rock = makeRock();
    rock.position.set(rand(-width * 0.56, width * 0.56), rand(-height * 0.55, -height * 0.43), rand(-3.7, 1.4));
    group.add(rock);
  }

  for (let i = 0; i < 18; i += 1) {
    const glow = new THREE.PointLight(pick([0xff44ae, 0x2bf7cc, 0xffe76a, 0x40e0ff, 0x9674ff]), rand(0.12, 0.42), rand(1.6, 3.5), 1.4);
    glow.position.set(rand(-width * 0.5, width * 0.5), rand(-height * 0.42, -height * 0.16), rand(-2.6, 1.2));
    group.add(glow);
  }

  return { group, corals, waterMaterial, currentMaterial, backWall, currentPlane, baseWidth: width } satisfies AquariumEnvironment;
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}

function makeBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  const water = ctx.createLinearGradient(0, 0, 0, canvas.height);
  water.addColorStop(0, '#27e8ff');
  water.addColorStop(0.2, '#06bff2');
  water.addColorStop(0.54, '#008adf');
  water.addColorStop(0.82, '#0759b3');
  water.addColorStop(1, '#07337c');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const turquoiseBloom = ctx.createRadialGradient(canvas.width * 0.2, canvas.height * 0.26, 80, canvas.width * 0.24, canvas.height * 0.2, canvas.width * 0.58);
  turquoiseBloom.addColorStop(0, 'rgba(148,255,250,.42)');
  turquoiseBloom.addColorStop(0.45, 'rgba(0,221,255,.14)');
  turquoiseBloom.addColorStop(1, 'rgba(0,115,200,0)');
  ctx.fillStyle = turquoiseBloom;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const deepVignette = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.42, 180, canvas.width * 0.5, canvas.height * 0.52, canvas.width * 0.76);
  deepVignette.addColorStop(0, 'rgba(255,255,255,0)');
  deepVignette.addColorStop(0.62, 'rgba(0,69,150,.16)');
  deepVignette.addColorStop(1, 'rgba(0,12,68,.46)');
  ctx.fillStyle = deepVignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 24; i += 1) {
    const x = (i / 17) * canvas.width + rand(-80, 80);
    const beam = ctx.createLinearGradient(x, 0, x + rand(-120, 120), canvas.height);
    beam.addColorStop(0, 'rgba(255,255,255,.42)');
    beam.addColorStop(0.42, 'rgba(137,255,255,.13)');
    beam.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 70, 0);
    ctx.lineTo(x + 70, 0);
    ctx.lineTo(x + rand(40, 220), canvas.height);
    ctx.lineTo(x + rand(-230, -30), canvas.height);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,.24)';
  ctx.lineWidth = 1.6;
  for (let y = 34; y < 275; y += 18) {
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 24) {
      const yy = y + Math.sin(x * 0.013 + y) * 7 + Math.cos(x * 0.021) * 3;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  const sand = ctx.createLinearGradient(0, 790, 0, canvas.height);
  sand.addColorStop(0, 'rgba(48,218,255,.06)');
  sand.addColorStop(0.36, 'rgba(87,237,255,.28)');
  sand.addColorStop(0.68, 'rgba(255,255,255,.35)');
  sand.addColorStop(1, 'rgba(255,244,196,.82)');
  ctx.fillStyle = sand;
  ctx.fillRect(0, 770, canvas.width, 310);

  for (let i = 0; i < 210; i += 1) {
    const color = pick(['#ff3d91', '#ffe12b', '#ff742b', '#23f3b7', '#14e4ff', '#7a52ff', '#fdf4ff']);
    drawCoral(ctx, rand(-80, canvas.width + 80), rand(815, 1105), rand(62, 255), color, rand(0.48, 0.92));
  }

  for (let i = 0; i < 34; i += 1) {
    const x = rand(0, canvas.width);
    const y = rand(715, 1040);
    const glow = ctx.createRadialGradient(x, y, 4, x, y, rand(70, 190));
    glow.addColorStop(0, pick(['rgba(255,244,92,.84)', 'rgba(255,66,190,.68)', 'rgba(0,255,223,.62)', 'rgba(255,255,255,.78)', 'rgba(118,86,255,.58)']));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 220, y - 220, 440, 440);
  }

  for (let i = 0; i < 36; i += 1) {
    const x = rand(-40, canvas.width + 40);
    const y = rand(880, 1080);
    const r = rand(38, 130);
    const rock = ctx.createRadialGradient(x - r * 0.28, y - r * 0.36, 4, x, y, r);
    rock.addColorStop(0, 'rgba(255,255,255,.95)');
    rock.addColorStop(1, 'rgba(159,231,255,.18)');
    ctx.fillStyle = rock;
    ctx.beginPath();
    ctx.ellipse(x, y, r * rand(1.2, 2.4), r, rand(-0.35, 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLargeAnimalTexture(kind: 'shark' | 'ray') {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(320, 160);
  const body = ctx.createLinearGradient(-180, -80, 180, 100);
  body.addColorStop(0, 'rgba(230,255,255,.72)');
  body.addColorStop(0.42, 'rgba(50,174,225,.9)');
  body.addColorStop(1, 'rgba(0,72,154,.42)');
  ctx.fillStyle = body;
  ctx.strokeStyle = 'rgba(255,255,255,.34)';
  ctx.lineWidth = 4;

  if (kind === 'ray') {
    ctx.beginPath();
    ctx.moveTo(-240, 12);
    ctx.quadraticCurveTo(-86, -130, 56, -24);
    ctx.quadraticCurveTo(196, -82, 240, 16);
    ctx.quadraticCurveTo(86, 104, -58, 38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(92, 22);
    ctx.bezierCurveTo(190, 42, 246, 90, 306, 132);
    ctx.strokeStyle = 'rgba(210,250,255,.48)';
    ctx.lineWidth = 8;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(-10, 0, 190, 72, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(162, -5);
    ctx.lineTo(292, -78);
    ctx.lineTo(246, 0);
    ctx.lineTo(304, 76);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-72, -62);
    ctx.quadraticCurveTo(-38, -142, 14, -54);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-58, 58);
    ctx.quadraticCurveTo(-12, 138, 46, 52);
    ctx.fillStyle = 'rgba(225,255,255,.52)';
    ctx.fill();
  }

  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawCoral(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = rand(7, 14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + rand(-25, 25), y - h * 0.35, x + rand(-30, 30), y - h * 0.7, x + rand(-10, 10), y - h);
  ctx.stroke();
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    const branchY = y - h * rand(0.28, 0.8);
    ctx.moveTo(x + rand(-8, 8), branchY);
    ctx.bezierCurveTo(x + rand(-55, 55), branchY - rand(8, 30), x + rand(-80, 80), branchY - rand(20, 60), x + rand(-70, 70), branchY - rand(30, 80));
    ctx.stroke();
  }
  ctx.restore();
}

function roughStroke(ctx: CanvasRenderingContext2D, stroke: () => void, repeats = 3) {
  for (let i = 0; i < repeats; i += 1) {
    ctx.save();
    ctx.translate(rand(-1.4, 1.4), rand(-1.4, 1.4));
    stroke();
    ctx.restore();
  }
}

function drawScribbles(ctx: CanvasRenderingContext2D, colors: string[], bounds: { x: number; y: number; w: number; h: number }) {
  const vivid = vividOnly(colors);
  const palette = vivid.length > 0 ? vivid : colors;
  ctx.save();
  ctx.globalAlpha = 1;
  for (let i = 0; i < 15; i += 1) {
    ctx.fillStyle = pick(palette);
    ctx.globalAlpha = rand(0.5, 0.78);
    ctx.beginPath();
    ctx.ellipse(
      bounds.x + rand(22, bounds.w - 22),
      bounds.y + rand(18, bounds.h - 18),
      rand(30, 86),
      rand(19, 54),
      rand(-0.8, 0.8),
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.globalAlpha = 0.94;
  ctx.lineCap = 'round';
  for (let i = 0; i < 88; i += 1) {
    ctx.strokeStyle = pick(palette);
    ctx.lineWidth = rand(4.5, 13);
    ctx.beginPath();
    const y = bounds.y + rand(8, bounds.h - 8);
    ctx.moveTo(bounds.x + rand(6, 22), y);
    for (let x = bounds.x + 20; x < bounds.x + bounds.w - 10; x += rand(18, 34)) {
      ctx.lineTo(x, y + rand(-12, 12));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function makeCreatureTexture(kind: CreatureKind, colors: string[]) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(180, 120);
  ctx.rotate(rand(-0.06, 0.06));
  ctx.translate(-180, -120);

  ctx.shadowColor = 'rgba(0,30,70,.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = 'rgba(255,255,255,.74)';
  drawPaperSilhouette(ctx, kind, true);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  drawPaperSilhouette(ctx, kind, false);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,252,241,.24)';
  ctx.fillRect(34, 24, 292, 194);
  const wash = ctx.createLinearGradient(54, 42, 300, 184);
  const palette = vividOnly(colors);
  const ink = palette.length >= 2 ? palette : colors;
  wash.addColorStop(0, `${ink[0]}f2`);
  wash.addColorStop(0.5, `${ink[1 % ink.length]}dd`);
  wash.addColorStop(1, `${ink[2 % ink.length]}ea`);
  ctx.fillStyle = wash;
  ctx.fillRect(40, 28, 286, 186);
  drawScribbles(ctx, colors, { x: 55, y: 44, w: 250, h: 150 });
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  for (let i = 0; i < 36; i += 1) {
    ctx.beginPath();
    ctx.arc(rand(56, 304), rand(42, 204), rand(0.8, 2.1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,.72)';
  ctx.lineWidth = 6.5;
  roughStroke(ctx, () => drawPaperSilhouette(ctx, kind, false, true), 2);
  ctx.strokeStyle = 'rgba(29,29,29,.92)';
  ctx.lineWidth = 4.2;
  roughStroke(ctx, () => drawPaperSilhouette(ctx, kind, false, true), 3);
  drawDetails(ctx, kind, colors);
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = 'rgba(0,0,0,.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    ctx.moveTo(rand(42, 320), rand(36, 206));
    ctx.lineTo(rand(42, 320), rand(36, 206));
    ctx.stroke();
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawPaperSilhouette(ctx: CanvasRenderingContext2D, kind: CreatureKind, padded: boolean, strokeOnly = false) {
  const pad = padded ? 12 : 0;
  const fillOrStroke = () => {
    if (strokeOnly) ctx.stroke();
    else ctx.fill();
  };

  ctx.beginPath();
  if (kind === 'jellyfish') {
    ctx.ellipse(154, 84, 66 + pad, 43 + pad, 0, Math.PI, 0);
    ctx.quadraticCurveTo(226 + pad, 132, 82 - pad, 132);
    ctx.closePath();
    fillOrStroke();
    if (!strokeOnly) {
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        const x = 100 + i * 18;
        ctx.moveTo(x, 126);
        ctx.bezierCurveTo(x - 22, 158, x + 23, 168, x + rand(-10, 10), 208);
        fillOrStroke();
      }
    }
    return;
  }
  if (kind === 'squid') {
    ctx.moveTo(168, 34 - pad);
    ctx.lineTo(235 + pad, 122);
    ctx.quadraticCurveTo(174, 164 + pad, 98 - pad, 122);
    ctx.closePath();
    fillOrStroke();
    return;
  }
  if (kind === 'whale') {
    ctx.ellipse(155, 116, 106 + pad, 56 + pad, 0, 0, Math.PI * 2);
    fillOrStroke();
    ctx.beginPath();
    ctx.moveTo(246, 102);
    ctx.lineTo(320 + pad, 63 - pad);
    ctx.lineTo(296, 115);
    ctx.lineTo(322 + pad, 168 + pad);
    ctx.closePath();
    fillOrStroke();
    return;
  }
  if (kind === 'turtle') {
    ctx.ellipse(165, 119, 76 + pad, 50 + pad, 0, 0, Math.PI * 2);
    fillOrStroke();
    ctx.beginPath();
    ctx.ellipse(250, 110, 28 + pad, 24 + pad, 0, 0, Math.PI * 2);
    fillOrStroke();
    return;
  }
  if (kind === 'seahorse') {
    ctx.ellipse(173, 98, 42 + pad, 62 + pad, 0.18, 0, Math.PI * 2);
    fillOrStroke();
    ctx.beginPath();
    ctx.moveTo(138, 62);
    ctx.quadraticCurveTo(88 - pad, 42 - pad, 96, 92);
    ctx.quadraticCurveTo(114, 118, 154, 108);
    fillOrStroke();
    return;
  }
  if (kind === 'crab') {
    ctx.ellipse(178, 124, 62 + pad, 44 + pad, 0, 0, Math.PI * 2);
    fillOrStroke();
    ctx.beginPath();
    ctx.arc(97, 90, 26 + pad, 0, Math.PI * 2);
    ctx.arc(258, 90, 26 + pad, 0, Math.PI * 2);
    fillOrStroke();
    return;
  }

  ctx.ellipse(156, 120, 78 + pad, 48 + pad, 0, 0, Math.PI * 2);
  fillOrStroke();
  ctx.beginPath();
  ctx.moveTo(224, 118);
  ctx.lineTo(310 + pad, 70 - pad);
  ctx.lineTo(288, 120);
  ctx.lineTo(310 + pad, 170 + pad);
  ctx.closePath();
  fillOrStroke();
}

function drawDetails(ctx: CanvasRenderingContext2D, kind: CreatureKind, colors: string[]) {
  ctx.strokeStyle = 'rgba(40,40,40,.72)';
  ctx.lineWidth = 2.5;
  if (kind === 'fish' || kind === 'whale' || kind === 'turtle') {
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(124 + i * 22, 120, 24 + i * 3, -1.05, 1.05);
      ctx.stroke();
    }
  }
  if (kind === 'jellyfish') {
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      const x = 100 + i * 18;
      ctx.moveTo(x, 126);
      ctx.bezierCurveTo(x - 19, 154, x + 23, 168, x + rand(-10, 10), 206);
      ctx.strokeStyle = pick(colors);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  if (kind === 'squid') {
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      const x = 112 + i * 23;
      ctx.moveTo(x, 140);
      ctx.lineTo(x + rand(-10, 10), 200);
      ctx.strokeStyle = pick(colors);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#1f1f1f';
  ctx.beginPath();
  ctx.arc(kind === 'whale' ? 110 : 119, kind === 'squid' ? 96 : 101, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(kind === 'whale' ? 107 : 116, kind === 'squid' ? 93 : 98, 3, 0, Math.PI * 2);
  ctx.fill();
}

function makeFoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 210;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.strokeStyle = '#2d2d2d';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(36, 28, 108, 138, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2772f';
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    ctx.arc(rand(60, 124), rand(72, 140), rand(4, 8), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1d1d1d';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FOOD', 90, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCreature(id: number, scene: THREE.Scene, width: number, height: number, birth?: Partial<BirthInfo>) {
  const kind = birth?.kind ?? pick(kinds);
  const personality = birth?.personality ?? pick(personalities);
  const material = new THREE.SpriteMaterial({
    map: makeCreatureTexture(kind, pick(colorSets)),
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  const sprite = new THREE.Sprite(material);
  const baseScale = kind === 'whale' ? rand(1.18, 1.62) : kind === 'crab' ? rand(0.52, 0.74) : rand(0.68, 1.16);
  sprite.scale.set(baseScale * 1.55, baseScale, 1);
  sprite.position.set(rand(-width * 0.47, width * 0.47), rand(-height * 0.26, height * 0.36), rand(-1.2, 1.2));
  scene.add(sprite);

  return {
    id,
    sprite,
    material,
    velocity: new THREE.Vector3(rand(-0.09, 0.09), rand(-0.035, 0.035), 0),
    target: new THREE.Vector3(rand(-width * 0.46, width * 0.46), rand(-height * 0.28, height * 0.34), 0),
    baseScale,
    phase: rand(0, Math.PI * 2),
    personality,
    kind,
    foodPull: personality === 'curious' ? 1.5 : personality === 'slow' ? 0.55 : 1
  } satisfies Creature;
}

function worldFromPointer(event: PointerEvent | MouseEvent, element: HTMLElement, camera: THREE.OrthographicCamera) {
  const rect = element.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  return new THREE.Vector3(
    x * (camera.right - camera.left) * 0.5,
    y * (camera.top - camera.bottom) * 0.5,
    0
  );
}

export function AquariumStage({ overlay }: AquariumStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{ spawnBirth: () => BirthInfo } | null>(null);
  const [fps, setFps] = useState(60);
  const [creatures, setCreatures] = useState(0);
  const [scanActive, setScanActive] = useState(true);
  const [latestBirth, setLatestBirth] = useState<BirthInfo>({
    name: 'Nana',
    kind: 'fish',
    personality: 'curious'
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'aquarium-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#031e53');
    scene.fog = new THREE.FogExp2(0x0868a6, 0.045);
    const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
    camera.position.set(0, 0, 10);
    scene.add(new THREE.HemisphereLight(0xb8f6ff, 0x063b7a, 1.9));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(-4.5, 5.8, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x67f4ff, 0.85);
    rimLight.position.set(4, 2.5, 4);
    scene.add(rimLight);

    const bubbleTexture = makeCircleTexture('rgba(255,255,255,.75)', 46);
    const foodTexture = makeFoodTexture();
    const bubbles: Bubble[] = [];
    const foods: FoodBag[] = [];
    const creaturesRef: Creature[] = [];
    const largeAnimals: THREE.Sprite[] = [];

    const getBounds = () => {
      const aspect = Math.max(host.clientWidth / Math.max(host.clientHeight, 1), 1);
      const worldHeight = 9;
      const worldWidth = worldHeight * aspect;
      return { width: worldWidth, height: worldHeight };
    };

    const initialBounds = getBounds();
    const environment = buildAquariumEnvironment(initialBounds.width, initialBounds.height);
    scene.add(environment.group);

    for (let i = 0; i < 82; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: bubbleTexture,
        transparent: true,
        opacity: rand(0.32, 0.7),
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      const sprite = new THREE.Sprite(material);
      const scale = rand(0.035, 0.11);
      sprite.scale.set(scale, scale, 1);
      const bounds = getBounds();
      sprite.position.set(rand(-bounds.width * 0.5, bounds.width * 0.5), rand(-bounds.height * 0.45, bounds.height * 0.5), rand(-2, 1.5));
      bubbles.push({ sprite, speed: rand(0.1, 0.36), drift: rand(0.01, 0.06) });
      scene.add(sprite);
    }

    const spawnBirth = () => {
      const bounds = getBounds();
      const info: BirthInfo = {
        name: pick(names),
        kind: pick(kinds),
        personality: pick(personalities)
      };
      const creature = makeCreature(Date.now() + creaturesRef.length, scene, bounds.width, bounds.height, info);
      creature.sprite.position.set(-bounds.width * 0.46, -bounds.height * 0.32, 1.8);
      creature.sprite.scale.multiplyScalar(0.18);
      creature.target.set(rand(-bounds.width * 0.18, bounds.width * 0.28), rand(-bounds.height * 0.08, bounds.height * 0.28), 0);
      creaturesRef.push(creature);
      setLatestBirth(info);
      setScanActive(true);
      window.setTimeout(() => setScanActive(false), 2000);
      setCreatures(creaturesRef.length);
      return info;
    };

    for (let i = 0; i < 42; i += 1) {
      const bounds = getBounds();
      creaturesRef.push(makeCreature(i, scene, bounds.width, bounds.height));
    }
    setCreatures(creaturesRef.length);
    window.setTimeout(() => setScanActive(false), 1800);
    apiRef.current = { spawnBirth };

    const pointer = {
      active: false,
      position: new THREE.Vector3(999, 999, 0)
    };

    const makeFood = (position: THREE.Vector3) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: foodTexture,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: THREE.NormalBlending
      }));
      sprite.position.copy(position);
      sprite.position.z = 2.2;
      sprite.scale.set(0.62, 0.74, 1);
      scene.add(sprite);
      foods.push({ sprite, life: 7.5 });
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.active = true;
      pointer.position.copy(worldFromPointer(event, host, camera));
    };
    const onPointerLeave = () => {
      pointer.active = false;
      pointer.position.set(999, 999, 0);
    };
    const onPointerDown = (event: PointerEvent) => {
      makeFood(worldFromPointer(event, host, camera));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        spawnBirth();
      }
    };

    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);

    const resize = () => {
      const bounds = getBounds();
      camera.left = -bounds.width / 2;
      camera.right = bounds.width / 2;
      camera.top = bounds.height / 2;
      camera.bottom = -bounds.height / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      environment.backWall.scale.set(bounds.width / 24 + 0.1, bounds.height / 13.5 + 0.1, 1);
      environment.currentPlane.scale.set(bounds.width / 24 + 0.1, bounds.height / 13.5 + 0.1, 1);
      environment.group.scale.x = bounds.width / environment.baseWidth;
    };
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let raf = 0;
    let frameCounter = 0;
    let frameTime = 0;

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.033);
      const time = clock.elapsedTime;
      const bounds = getBounds();

      environment.waterMaterial.uniforms.uTime.value = time;
      environment.currentMaterial.uniforms.uTime.value = time;
      environment.backWall.position.y = Math.sin(time * 0.08) * 0.04;
      environment.currentPlane.position.x = Math.sin(time * 0.12) * 0.08;
      environment.corals.forEach((coral) => {
        coral.group.rotation.z = Math.sin(time * 0.52 + coral.phase) * coral.sway;
        coral.group.rotation.x = Math.cos(time * 0.37 + coral.phase) * coral.sway * 0.35;
      });

      bubbles.forEach((bubble, index) => {
        bubble.sprite.position.y += dt * bubble.speed;
        bubble.sprite.position.x += Math.sin(time * 0.5 + index) * dt * bubble.drift;
        if (bubble.sprite.position.y > bounds.height * 0.52) {
          bubble.sprite.position.y = -bounds.height * 0.52;
          bubble.sprite.position.x = rand(-bounds.width * 0.52, bounds.width * 0.52);
        }
      });

      largeAnimals.forEach((animal, index) => {
        animal.position.x += dt * (index === 0 ? -0.055 : 0.045);
        animal.position.y += Math.sin(time * 0.35 + index) * dt * 0.05;
        animal.rotation.z = Math.sin(time * 0.28 + index) * 0.04;
        if (animal.position.x < -bounds.width * 0.62) animal.position.x = bounds.width * 0.58;
        if (animal.position.x > bounds.width * 0.62) animal.position.x = -bounds.width * 0.58;
      });

      foods.forEach((food, index) => {
        food.life -= dt;
        food.sprite.rotation.z = Math.sin(time * 1.7 + index) * 0.08;
        food.sprite.position.y += Math.sin(time * 2.1 + index) * dt * 0.06;
        food.sprite.material.opacity = clamp(food.life / 2, 0, 0.96);
      });
      for (let i = foods.length - 1; i >= 0; i -= 1) {
        if (foods[i].life <= 0) {
          scene.remove(foods[i].sprite);
          foods[i].sprite.material.dispose();
          foods.splice(i, 1);
        }
      }

      const groupCenter = new THREE.Vector3();
      creaturesRef.forEach((creature) => groupCenter.add(creature.sprite.position));
      groupCenter.multiplyScalar(1 / Math.max(creaturesRef.length, 1));

      for (const creature of creaturesRef) {
        const position = creature.sprite.position;
        if (position.distanceTo(creature.target) < 0.52 || Math.random() < 0.0025) {
          creature.target.set(rand(-bounds.width * 0.48, bounds.width * 0.48), rand(-bounds.height * 0.28, bounds.height * 0.34), rand(-0.8, 1.2));
        }

        const desired = creature.target.clone().sub(position).multiplyScalar(0.09);
        if (foods.length > 0) {
          let closest = foods[0].sprite.position;
          let closestDistance = position.distanceTo(closest);
          foods.forEach((food) => {
            const d = position.distanceTo(food.sprite.position);
            if (d < closestDistance) {
              closestDistance = d;
              closest = food.sprite.position;
            }
          });
          desired.add(closest.clone().sub(position).multiplyScalar(0.26 * creature.foodPull / Math.max(closestDistance, 0.5)));
        }

        if (pointer.active) {
          const d = position.distanceTo(pointer.position);
          if (d < 1.25) {
            const away = position.clone().sub(pointer.position).normalize();
            const force = creature.personality === 'shy' ? 1.8 : creature.personality === 'curious' ? 0.7 : 1.15;
            desired.add(away.multiplyScalar((1.25 - d) * force));
          }
        }

        if (creature.personality === 'social') {
          desired.add(groupCenter.clone().sub(position).multiplyScalar(0.01));
        }

        creature.velocity.add(desired.multiplyScalar(dt));
        creature.velocity.x += Math.sin(time * 0.55 + creature.phase) * dt * 0.045;
        creature.velocity.y += Math.cos(time * 0.44 + creature.phase) * dt * 0.025;
        const speedLimit = creature.personality === 'slow' ? 0.28 : creature.personality === 'shy' ? 0.58 : 0.45;
        if (creature.velocity.length() > speedLimit) creature.velocity.setLength(speedLimit);
        creature.velocity.multiplyScalar(0.996);
        position.addScaledVector(creature.velocity, dt * 2.35);

        if (position.x > bounds.width * 0.55) position.x = -bounds.width * 0.55;
        if (position.x < -bounds.width * 0.55) position.x = bounds.width * 0.55;
        position.y = clamp(position.y, -bounds.height * 0.38, bounds.height * 0.43);

        const direction = creature.velocity.x >= 0 ? 1 : -1;
        const swim = Math.sin(time * (creature.kind === 'jellyfish' ? 1.7 : 2.7) + creature.phase);
        const targetScale = creature.baseScale * (1 + Math.abs(swim) * 0.02);
        creature.sprite.scale.x = THREE.MathUtils.lerp(creature.sprite.scale.x, targetScale * 1.55 * direction, 0.045);
        creature.sprite.scale.y = THREE.MathUtils.lerp(creature.sprite.scale.y, targetScale * (1 + swim * 0.012), 0.05);
        creature.sprite.rotation.z = creature.velocity.y * 0.22 + swim * 0.025;
      }

      frameCounter += 1;
      frameTime += dt;
      if (frameTime >= 0.5) {
        setFps(Math.round(frameCounter / frameTime));
        frameCounter = 0;
        frameTime = 0;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', resize);
      apiRef.current = null;
      creaturesRef.forEach((creature) => {
        scene.remove(creature.sprite);
        creature.material.map?.dispose();
        creature.material.dispose();
      });
      bubbles.forEach((bubble) => {
        scene.remove(bubble.sprite);
        bubble.sprite.material.dispose();
      });
      foods.forEach((food) => food.sprite.material.dispose());
      largeAnimals.forEach((animal) => {
        scene.remove(animal);
        animal.material.map?.dispose();
        animal.material.dispose();
      });
      scene.remove(environment.group);
      disposeObject3D(environment.group);
      bubbleTexture.dispose();
      foodTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const state = useMemo<OverlayState>(() => ({
    fps,
    creatures,
    scanActive,
    latestBirth,
    scene: 'aquarium',
    setScene: () => undefined
  }), [fps, creatures, scanActive, latestBirth]);

  return (
    <div className="stage-host" ref={hostRef}>
      <div className="hud-layer">{overlay(state)}</div>
    </div>
  );
}
