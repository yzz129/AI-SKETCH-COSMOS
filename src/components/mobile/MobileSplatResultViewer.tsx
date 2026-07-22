import { OrbitControls, Stars } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentRef,
  type PointerEvent as ReactPointerEvent
} from 'react';
import * as THREE from 'three';
import { createModelControlSender } from '../../lib/artwork/modelControlSync';
import type { StoredArtwork } from '../../stores/artworkStore';
import { SplatCreatureModel } from '../webgl/SplatCreatureModel';

export type MobileSplatResultViewerHandle = {
  capture: () => Promise<Blob | null>;
};

type MobileSplatResultViewerProps = {
  artwork: StoredArtwork;
  gameControlsEnabled?: boolean;
  onReady?: () => void;
};

const GAME_MODEL_Z_RANGE = 1.55;
const GAME_PLANAR_POSITION_LIMIT = 0.85;
const GAME_DEPTH_POSITION_LIMIT = 0.85;
const MOBILE_PREVIEW_X_LIMIT = 0.68;
const MOBILE_PREVIEW_Y_LIMIT = 0.58;
const GAME_PLANAR_SPEED = 0.34;
const GAME_DEPTH_SPEED = 0.3;
const GAME_MIN_SCALE = 0.72;
const GAME_MAX_SCALE = 1.28;
const GAME_JUMP_SCREEN_SCALE = 0.34;

export const MobileSplatResultViewer = forwardRef<
  MobileSplatResultViewerHandle,
  MobileSplatResultViewerProps
>(function MobileSplatResultViewer({ artwork, gameControlsEnabled = false, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const modelGroupRef = useRef<THREE.Group>(null);
  const senderRef = useRef<ReturnType<typeof createModelControlSender> | null>(null);
  const isDraggingRef = useRef(false);
  const projectedOriginRef = useRef(new THREE.Vector3());
  const mobileModelCenterRef = useRef(new THREE.Vector3());
  const mobileCameraRightRef = useRef(new THREE.Vector3());
  const mobileCameraUpRef = useRef(new THREE.Vector3());
  const mobileCameraForwardRef = useRef(new THREE.Vector3());
  const initialDistanceRef = useRef<number | null>(null);
  const gamePositionRef = useRef(new THREE.Vector3());
  const planarJoystickRef = useRef(new THREE.Vector2());
  const depthJoystickRef = useRef(0);
  const planarJoystickActiveRef = useRef(false);
  const depthJoystickActiveRef = useRef(false);
  const planarThumbRef = useRef<HTMLSpanElement>(null);
  const depthThumbRef = useRef<HTMLSpanElement>(null);
  const jumpHeightRef = useRef(0);
  const jumpVelocityRef = useRef(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true);
  const [isPlanarJoystickActive, setIsPlanarJoystickActive] = useState(false);
  const [isDepthJoystickActive, setIsDepthJoystickActive] = useState(false);
  const model = artwork.gaussianModel;
  const sourceArtworkId = model?.sourceArtworkId ?? artwork.id;

  useEffect(() => {
    const sender = createModelControlSender(sourceArtworkId);
    senderRef.current = sender;
    return () => {
      sender.close();
      senderRef.current = null;
    };
  }, [sourceArtworkId]);

  const sendCurrentPose = useCallback((active: boolean) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const rawYaw = -controls.getAzimuthalAngle();
    const yaw = Math.atan2(Math.sin(rawYaw), Math.cos(rawYaw));
    const distance = controls.object.position.distanceTo(controls.target);
    const initialDistance = initialDistanceRef.current ?? distance;
    initialDistanceRef.current = initialDistance;
    const cameraOffsetZ = distance <= initialDistance
      ? (initialDistance - distance) / Math.max(0.01, initialDistance - 2.6)
      : -(distance - initialDistance) / Math.max(0.01, 7 - initialDistance);
    controls.object.updateMatrixWorld();
    const position = gamePositionRef.current;
    let offsetX: number;
    let offsetY: number;
    if (gameControlsEnabled) {
      offsetX = position.x;
      offsetY = THREE.MathUtils.clamp(
        position.y + jumpHeightRef.current * GAME_JUMP_SCREEN_SCALE,
        -GAME_PLANAR_POSITION_LIMIT,
        GAME_PLANAR_POSITION_LIMIT
      );
    } else {
      modelGroupRef.current?.updateWorldMatrix(true, false);
      const projectedOrigin = modelGroupRef.current
        ? modelGroupRef.current.getWorldPosition(projectedOriginRef.current).project(controls.object)
        : projectedOriginRef.current.set(0, 0, 0).project(controls.object);
      offsetX = projectedOrigin.x;
      offsetY = projectedOrigin.y;
    }
    senderRef.current?.send({
      yaw,
      pitch: controls.getPolarAngle() - Math.PI / 2,
      offsetX: THREE.MathUtils.clamp(
        offsetX,
        -GAME_PLANAR_POSITION_LIMIT,
        GAME_PLANAR_POSITION_LIMIT
      ),
      offsetY: THREE.MathUtils.clamp(
        offsetY,
        -GAME_PLANAR_POSITION_LIMIT,
        GAME_PLANAR_POSITION_LIMIT
      ),
      // The fullscreen depth joystick and the regular pinch zoom are two
      // independent controls. Adding them made a previous pinch gesture keep
      // the outgoing value pinned at either limit, so moving the joystick no
      // longer changed the model size on the display.
      offsetZ: THREE.MathUtils.clamp(
        gameControlsEnabled ? gamePositionRef.current.z : cameraOffsetZ,
        -GAME_DEPTH_POSITION_LIMIT,
        GAME_DEPTH_POSITION_LIMIT
      ),
      active
    });
  }, [gameControlsEnabled]);

  const updateMobileModelTransform = useCallback(() => {
    const controls = controlsRef.current;
    const modelGroup = modelGroupRef.current;
    if (!controls || !modelGroup) return;
    const camera = controls.object;
    const position = gamePositionRef.current;
    const baseDistance = initialDistanceRef.current
      ?? camera.position.distanceTo(controls.target);
    initialDistanceRef.current = baseDistance;
    const depthDistance = THREE.MathUtils.clamp(
      baseDistance - position.z * GAME_MODEL_Z_RANGE,
      2.55,
      7
    );

    camera.updateMatrixWorld();
    camera.getWorldDirection(mobileCameraForwardRef.current).normalize();
    mobileCameraRightRef.current.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    mobileCameraUpRef.current.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    mobileModelCenterRef.current
      .copy(camera.position)
      .addScaledVector(mobileCameraForwardRef.current, depthDistance);

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const halfHeight = Math.tan(
      THREE.MathUtils.degToRad(perspectiveCamera.getEffectiveFOV() * 0.5)
    ) * depthDistance;
    const halfWidth = halfHeight * perspectiveCamera.aspect;
    const logicalScreenY = THREE.MathUtils.clamp(
      position.y + jumpHeightRef.current * GAME_JUMP_SCREEN_SCALE,
      -GAME_PLANAR_POSITION_LIMIT,
      GAME_PLANAR_POSITION_LIMIT
    );
    const previewScreenX = position.x
      / GAME_PLANAR_POSITION_LIMIT
      * MOBILE_PREVIEW_X_LIMIT;
    const previewScreenY = logicalScreenY
      / GAME_PLANAR_POSITION_LIMIT
      * MOBILE_PREVIEW_Y_LIMIT;

    modelGroup.position
      .copy(mobileModelCenterRef.current)
      .addScaledVector(mobileCameraRightRef.current, previewScreenX * halfWidth)
      .addScaledVector(mobileCameraUpRef.current, previewScreenY * halfHeight);
    modelGroup.scale.setScalar(THREE.MathUtils.lerp(
      GAME_MIN_SCALE,
      GAME_MAX_SCALE,
      (position.z + GAME_DEPTH_POSITION_LIMIT) / (GAME_DEPTH_POSITION_LIMIT * 2)
    ));
  }, []);

  useEffect(() => {
    if (!gameControlsEnabled || state !== 'ready') {
      planarJoystickRef.current.set(0, 0);
      depthJoystickRef.current = 0;
      planarJoystickActiveRef.current = false;
      depthJoystickActiveRef.current = false;
      setIsPlanarJoystickActive(false);
      setIsDepthJoystickActive(false);
      jumpHeightRef.current = 0;
      jumpVelocityRef.current = 0;
      return undefined;
    }

    let frame = 0;
    let previousTime = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.034, Math.max(0, (now - previousTime) / 1_000));
      previousTime = now;
      const planar = planarJoystickRef.current;
      const depth = depthJoystickRef.current;
      const position = gamePositionRef.current;
      let changed = false;

      if (planar.lengthSq() > 0.0004) {
        position.x = THREE.MathUtils.clamp(
          position.x + planar.x * GAME_PLANAR_SPEED * delta,
          -GAME_PLANAR_POSITION_LIMIT,
          GAME_PLANAR_POSITION_LIMIT
        );
        position.y = THREE.MathUtils.clamp(
          position.y + planar.y * GAME_PLANAR_SPEED * delta,
          -GAME_PLANAR_POSITION_LIMIT,
          GAME_PLANAR_POSITION_LIMIT
        );
        changed = true;
      }

      if (Math.abs(depth) > 0.02) {
        position.z = THREE.MathUtils.clamp(
          position.z + depth * GAME_DEPTH_SPEED * delta,
          -GAME_DEPTH_POSITION_LIMIT,
          GAME_DEPTH_POSITION_LIMIT
        );
        changed = true;
      }

      if (jumpHeightRef.current > 0 || jumpVelocityRef.current > 0) {
        jumpVelocityRef.current -= 4.2 * delta;
        jumpHeightRef.current += jumpVelocityRef.current * delta;
        if (jumpHeightRef.current <= 0) {
          jumpHeightRef.current = 0;
          jumpVelocityRef.current = 0;
        }
        changed = true;
      }

      updateMobileModelTransform();
      if (changed) sendCurrentPose(true);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      planarJoystickRef.current.set(0, 0);
      depthJoystickRef.current = 0;
      planarJoystickActiveRef.current = false;
      depthJoystickActiveRef.current = false;
      sendCurrentPose(false);
    };
  }, [gameControlsEnabled, sendCurrentPose, state, updateMobileModelTransform]);

  const updateJoystick = (
    kind: 'planar' | 'depth',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2 - 24);
    let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    let y = ((rect.top + rect.height / 2) - event.clientY) / radius;
    if (kind === 'depth') x = 0;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    if (kind === 'planar') {
      planarJoystickRef.current.set(x, y);
      if (planarThumbRef.current) {
        planarThumbRef.current.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${-y * radius}px))`;
      }
    } else {
      depthJoystickRef.current = y;
      if (depthThumbRef.current) {
        depthThumbRef.current.style.transform = `translate(-50%, calc(-50% + ${-y * radius}px))`;
      }
    }
  };

  const startJoystick = (
    kind: 'planar' | 'depth',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setAutoRotateEnabled(false);
    if (kind === 'planar') {
      planarJoystickActiveRef.current = true;
      setIsPlanarJoystickActive(true);
    } else {
      depthJoystickActiveRef.current = true;
      setIsDepthJoystickActive(true);
    }
    updateJoystick(kind, event);
  };

  const moveJoystick = (
    kind: 'planar' | 'depth',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const active = kind === 'planar'
      ? planarJoystickActiveRef.current
      : depthJoystickActiveRef.current;
    if (active) updateJoystick(kind, event);
  };

  const releaseJoystick = (kind: 'planar' | 'depth') => {
    if (kind === 'planar') {
      planarJoystickRef.current.set(0, 0);
      planarJoystickActiveRef.current = false;
      setIsPlanarJoystickActive(false);
      if (planarThumbRef.current) planarThumbRef.current.style.transform = 'translate(-50%, -50%)';
    } else {
      depthJoystickRef.current = 0;
      depthJoystickActiveRef.current = false;
      setIsDepthJoystickActive(false);
      if (depthThumbRef.current) depthThumbRef.current.style.transform = 'translate(-50%, -50%)';
    }
    if (
      !planarJoystickActiveRef.current
      && !depthJoystickActiveRef.current
      && jumpVelocityRef.current === 0
    ) sendCurrentPose(false);
  };

  const triggerJump = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setAutoRotateEnabled(false);
    if (jumpHeightRef.current <= 0.001) jumpVelocityRef.current = 1.6;
  };

  useImperativeHandle(ref, () => ({
    capture: () => new Promise<Blob | null>((resolve) => {
      if (!canvasRef.current || state !== 'ready') {
        resolve(null);
        return;
      }
      canvasRef.current.toBlob(resolve, 'image/png');
    })
  }), [state]);

  if (!model?.splatUrl) {
    return (
      <div className="mobile-splat-viewer__fallback">
        <p>当前任务没有返回可浏览的 .splat 模型。</p>
      </div>
    );
  }

  return (
    <div className="mobile-splat-viewer" data-state={state}>
      <Canvas
        camera={{ position: [0, 0.12, 4.4], fov: 42, near: 0.01, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ alpha: false, antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
          gl.setClearColor('#020719', 1);
        }}
      >
        <Stars radius={20} depth={10} count={260} factor={1.5} saturation={0.2} fade speed={0.35} />
        <group ref={modelGroupRef}>
          <SplatCreatureModel
            url={model.splatUrl}
            rigUrl={model.rigUrl}
            colors={artwork.features.visualTraits.dominantColors}
            features={artwork.features}
            scale={2.45}
            allowDistanceCulling={false}
            onReady={() => {
              setState('ready');
              onReady?.();
            }}
            onError={() => setState('error')}
          />
        </group>
        <OrbitControls
          ref={controlsRef}
          enablePan={!gameControlsEnabled}
          enableZoom={!gameControlsEnabled}
          enableDamping
          dampingFactor={0.08}
          panSpeed={0.55}
          zoomSpeed={0.65}
          screenSpacePanning
          minDistance={2.6}
          maxDistance={7}
          minTargetRadius={0}
          maxTargetRadius={1.2}
          autoRotate={state === 'ready' && autoRotateEnabled}
          autoRotateSpeed={0.55}
          onStart={() => {
            isDraggingRef.current = true;
            setAutoRotateEnabled(false);
            sendCurrentPose(true);
          }}
          onChange={() => {
            if (isDraggingRef.current) sendCurrentPose(true);
          }}
          onEnd={() => {
            isDraggingRef.current = false;
            sendCurrentPose(false);
          }}
        />
      </Canvas>

      {state === 'loading' ? (
        <div className="mobile-splat-viewer__overlay" aria-live="polite">
          <span className="mobile-splat-viewer__loader" aria-hidden="true" />
          <p>正在把真实 3D 模型装进手机…</p>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="mobile-splat-viewer__overlay mobile-splat-viewer__overlay--error" role="alert">
          <p>模型载入失败，可以下载模型后在支持 Gaussian Splat 的设备中查看。</p>
        </div>
      ) : null}
      {state === 'ready' ? (
        <div className="mobile-splat-viewer__hint" aria-hidden="true">
          <span>单指旋转</span>
          <i />
          <span>双指移动 / 前后</span>
        </div>
      ) : null}
      {state === 'ready' && gameControlsEnabled ? (
        <div
          className="mobile-model-game-controls"
          aria-label="模型游戏控制器"
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="mobile-model-joystick-cluster">
            <span className="mobile-model-control-label">自由移动</span>
            <div
              className={`mobile-model-joystick mobile-model-joystick--planar${isPlanarJoystickActive ? ' is-active' : ''}`}
              role="slider"
              tabIndex={0}
              aria-label="自由移动轮盘"
              aria-valuetext={isPlanarJoystickActive ? '正在移动' : '居中'}
              onPointerDown={(event) => startJoystick('planar', event)}
              onPointerMove={(event) => moveJoystick('planar', event)}
              onPointerUp={() => releaseJoystick('planar')}
              onPointerCancel={() => releaseJoystick('planar')}
            >
              <span className="mobile-model-joystick__orbit" aria-hidden="true" />
              <span ref={planarThumbRef} className="mobile-model-joystick__thumb" aria-hidden="true" />
            </div>
          </div>
          <div className="mobile-model-depth-controls">
            <button
              type="button"
              className="mobile-model-jump-button"
              onPointerDown={triggerJump}
            ><b aria-hidden="true"><i /></b><span>跳跃</span></button>
            <div className="mobile-model-joystick-cluster">
              <span className="mobile-model-control-label">前后距离</span>
              <div
                className={`mobile-model-joystick mobile-model-joystick--depth${isDepthJoystickActive ? ' is-active' : ''}`}
                role="slider"
                tabIndex={0}
                aria-label="前后移动轮盘"
                aria-valuetext={isDepthJoystickActive ? '正在调整距离' : '居中'}
                onPointerDown={(event) => startJoystick('depth', event)}
                onPointerMove={(event) => moveJoystick('depth', event)}
                onPointerUp={() => releaseJoystick('depth')}
                onPointerCancel={() => releaseJoystick('depth')}
              >
                <span className="mobile-model-joystick__depth-label is-front">前</span>
                <span className="mobile-model-joystick__depth-label is-back">后</span>
                <span ref={depthThumbRef} className="mobile-model-joystick__thumb" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
