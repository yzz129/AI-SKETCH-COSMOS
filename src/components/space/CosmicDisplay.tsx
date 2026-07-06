import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import { DeepStarField } from './DeepStarField';
import { GalaxySpiral } from './GalaxySpiral';
import { Meteors } from './Meteors';
import { NebulaRibbons } from './NebulaRibbons';
import { ParticleAnimal } from './ParticleAnimal';
import { TwinkleStars } from './TwinkleStars';

export function CosmicDisplay() {
  return (
    <div className="webgl-stage">
      <Canvas
        className="webgl-canvas"
        camera={{ fov: 48, position: [0, 0, 8.5], near: 0.1, far: 120 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace
        }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor('#050816', 1);
          scene.background = new THREE.Color('#050816');
          scene.fog = new THREE.FogExp2('#050816', 0.018);
        }}
      >
        <PerspectiveCameraAnchor />
        <ambientLight intensity={0.22} color="#7b4dff" />
        <DeepStarField />
        <TwinkleStars />
        <NebulaRibbons />
        <GalaxySpiral
          position={[-5.25, 2.18, -9.4]}
          scale={1.85}
          rotation={[0.55, -0.24, -0.26]}
          count={7200}
          radius={2.55}
          coreRadius={0.42}
          arms={5}
          spin={2.9}
          brightness={1.32}
        />
        <GalaxySpiral
          position={[4.72, -2.34, -8.8]}
          scale={1.42}
          rotation={[0.42, 0.2, 0.2]}
          count={5600}
          radius={2.1}
          coreRadius={0.35}
          arms={4}
          spin={2.75}
          brightness={1.1}
        />
        <GalaxySpiral
          position={[0.76, -3.22, -10.5]}
          scale={0.72}
          rotation={[0.56, -0.44, -0.12]}
          count={2300}
          radius={1.35}
          coreRadius={0.22}
          arms={4}
          spin={2.45}
          brightness={0.82}
        />
        <GalaxySpiral
          position={[1.55, 0.88, -11.2]}
          scale={0.58}
          rotation={[0.64, -0.36, 0.42]}
          count={1900}
          radius={1.12}
          coreRadius={0.18}
          arms={3}
          spin={2.55}
          brightness={0.82}
        />
        <GalaxySpiral
          position={[2.62, 2.92, -12.2]}
          scale={0.52}
          rotation={[0.62, 0.16, -0.64]}
          count={1700}
          radius={1.05}
          coreRadius={0.2}
          arms={4}
          spin={2.9}
          brightness={0.78}
        />
        <GalaxySpiral
          position={[4.95, -0.72, -12.6]}
          scale={0.48}
          rotation={[0.48, -0.24, 0.32]}
          count={1600}
          radius={1}
          coreRadius={0.18}
          arms={3}
          spin={2.35}
          brightness={0.72}
        />
        <ParticleAnimal
          kind="rabbit"
          position={[3.15, 0.52, -5.1]}
          scale={0.22}
          color="#f7d6ff"
          accent="#64d9ff"
          phase={0.1}
        />
        <ParticleAnimal
          kind="cat"
          position={[-1.72, -0.82, -5.7]}
          scale={0.2}
          color="#d8c4ff"
          accent="#7b4dff"
          phase={1.7}
        />
        <ParticleAnimal
          kind="elephant"
          position={[0.7, -1.52, -5.35]}
          scale={0.23}
          color="#aebcff"
          accent="#64d9ff"
          phase={3.2}
        />
        <Meteors />
        <CameraRig />
        <EffectComposer multisampling={0}>
          <Bloom
            blendFunction={BlendFunction.ADD}
            intensity={0.35}
            luminanceThreshold={0.5}
            luminanceSmoothing={0.72}
            kernelSize={KernelSize.LARGE}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

function PerspectiveCameraAnchor() {
  return null;
}
