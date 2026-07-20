import {
  Brush,
  Eraser,
  FlipHorizontal2,
  Highlighter,
  Paintbrush,
  Palette,
  Pencil,
  Redo2,
  Sparkles,
  Trash2,
  Undo2
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 1500;
const PARTICLE_CANVAS_SIZE = 600;
const PARTICLE_FRAME_INTERVAL = 1000 / 30;
const MAX_PARTICLES = 36;
const MAX_HISTORY = 12;

const COLORS = [
  '#f58fcb',
  '#49c6e5',
  '#ff8a3d',
  '#ffd166',
  '#62c370',
  '#8f5cff',
  '#ff0000',
  '#17265f'
];

type BrushTool = 'pencil' | 'marker' | 'watercolor' | 'crayon' | 'eraser';

type Point = {
  x: number;
  y: number;
  pressure: number;
};

type StarParticle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  sparkle: boolean;
};

export type CosmicDrawingBoardHandle = {
  toFile: () => Promise<File | null>;
};

type CosmicDrawingBoardProps = {
  disabled?: boolean;
  initialSnapshot?: string | null;
  onDrawingChange?: (hasDrawing: boolean, snapshot: string | null) => void;
};

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
    y: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    pressure: event.pressure > 0 ? event.pressure : 0.5
  };
}

function rgba(color: string, alpha: number) {
  const normalized = color.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createParticleSprite(color: string, sparkle: boolean) {
  const sprite = document.createElement('canvas');
  const size = 32;
  const center = size / 2;
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  context.translate(center, center);

  if (sparkle) {
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 7;
    context.lineCap = 'round';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-11, 0);
    context.lineTo(11, 0);
    context.moveTo(0, -11);
    context.lineTo(0, 11);
    context.moveTo(-6, -6);
    context.lineTo(6, 6);
    context.moveTo(6, -6);
    context.lineTo(-6, 6);
    context.stroke();
  } else {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, 10);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.18, color);
    glow.addColorStop(0.52, rgba(color, 0.48));
    glow.addColorStop(1, rgba(color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, 10, 0, Math.PI * 2);
    context.fill();
  }
  return sprite;
}

function traceSmoothPath(context: CanvasRenderingContext2D, points: Point[]) {
  const first = points[0];
  context.beginPath();
  context.moveTo(first.x, first.y);

  if (points.length === 1) {
    context.lineTo(first.x + 0.01, first.y + 0.01);
    return;
  }

  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
    return;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2
    );
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  context.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
}

function createGrainPattern(
  context: CanvasRenderingContext2D,
  color: string,
  tool: 'pencil' | 'crayon'
) {
  const texture = document.createElement('canvas');
  const size = tool === 'pencil' ? 28 : 36;
  texture.width = size;
  texture.height = size;
  const textureContext = texture.getContext('2d');
  if (!textureContext) return color;

  let seed = [...`${tool}-${color}`]
    .reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const grains = tool === 'pencil' ? 250 : 420;

  for (let index = 0; index < grains; index += 1) {
    const opacity = tool === 'pencil'
      ? 0.16 + random() * 0.34
      : 0.22 + random() * 0.48;
    const grainWidth = tool === 'pencil' ? 1 : 1 + Math.floor(random() * 3);
    textureContext.fillStyle = rgba(color, opacity);
    textureContext.fillRect(
      Math.floor(random() * size),
      Math.floor(random() * size),
      grainWidth,
      1
    );
  }

  return context.createPattern(texture, 'repeat') ?? color;
}

function loadSnapshot(canvas: HTMLCanvasElement, snapshot: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext('2d');
      if (context) {
        context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        context.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
      resolve();
    };
    image.onerror = () => reject(new Error('Drawing snapshot could not be restored.'));
    image.src = snapshot;
  });
}

export const CosmicDrawingBoard = forwardRef<CosmicDrawingBoardHandle, CosmicDrawingBoardProps>(
  function CosmicDrawingBoard({ disabled = false, initialSnapshot = null, onDrawingChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particleCanvasRef = useRef<HTMLCanvasElement>(null);
    const strokeBaseRef = useRef<HTMLCanvasElement | null>(null);
    const strokePointsRef = useRef<Point[]>([]);
    const drawingRef = useRef(false);
    const particlesRef = useRef<StarParticle[]>([]);
    const particleSpritesRef = useRef(new Map<string, HTMLCanvasElement>());
    const particleFrameRef = useRef<number | null>(null);
    const particleFrameTimeRef = useRef(0);
    const lastParticlePointRef = useRef<Point | null>(null);
    const historyRef = useRef<string[]>([]);
    const redoRef = useRef<string[]>([]);
    const initialSnapshotRef = useRef(initialSnapshot);
    const [tool, setTool] = useState<BrushTool>('pencil');
    const [color, setColor] = useState(COLORS[0]);
    const [brushSize, setBrushSize] = useState(18);
    const [mirror, setMirror] = useState(false);
    const [hasDrawing, setHasDrawing] = useState(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const syncHistoryState = () => {
      setCanUndo(historyRef.current.length > 1);
      setCanRedo(redoRef.current.length > 0);
    };

    const setDrawingState = (nextValue: boolean, snapshot: string | null) => {
      setHasDrawing(nextValue);
      onDrawingChange?.(nextValue, snapshot);
    };

    const saveSnapshot = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const snapshot = canvas.toDataURL('image/webp', 0.82);
      historyRef.current.push(snapshot);
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
      redoRef.current = [];
      setDrawingState(true, snapshot);
      syncHistoryState();
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      const initializeCanvas = async () => {
        const savedSnapshot = initialSnapshotRef.current;
        if (savedSnapshot) {
          try {
            await loadSnapshot(canvas, savedSnapshot);
            historyRef.current = [savedSnapshot];
            redoRef.current = [];
            setDrawingState(true, savedSnapshot);
            syncHistoryState();
            return;
          } catch {
            setDrawingState(false, null);
          }
        }

        context.fillStyle = '#fffefb';
        context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        historyRef.current = [canvas.toDataURL('image/webp', 0.82)];
        redoRef.current = [];
        syncHistoryState();
      };

      void initializeCanvas();
    }, []);

    useEffect(() => () => {
      if (particleFrameRef.current !== null) {
        window.cancelAnimationFrame(particleFrameRef.current);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      toFile: () => new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || !hasDrawing) {
          resolve(null);
          return;
        }
        canvas.toBlob((blob) => {
          resolve(blob ? new File([blob], `星河手绘-${Date.now()}.png`, { type: 'image/png' }) : null);
        }, 'image/png');
      })
    }), [hasDrawing]);

    const renderStroke = () => {
      const canvas = canvasRef.current;
      const strokeBase = strokeBaseRef.current;
      const points = strokePointsRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !strokeBase || !context || points.length === 0) return;

      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.drawImage(strokeBase, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const drawOne = (pathPoints: Point[]) => {
        const averagePressure = pathPoints.reduce((sum, point) => sum + point.pressure, 0)
          / pathPoints.length;
        const pressure = 0.78 + averagePressure * 0.38;
        const strokePath = (
          width: number,
          alpha: number,
          strokeStyle: string | CanvasPattern = color,
          blur = 0
        ) => {
          context.save();
          context.globalCompositeOperation = 'source-over';
          context.globalAlpha = alpha;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.lineWidth = Math.max(0.8, width);
          context.strokeStyle = strokeStyle;
          context.shadowColor = blur > 0 ? rgba(color, 0.38) : 'transparent';
          context.shadowBlur = blur;
          traceSmoothPath(context, pathPoints);
          context.stroke();
          context.restore();
        };

        if (tool === 'pencil') {
          strokePath(brushSize * 0.5 * pressure, 0.68);
          strokePath(
            brushSize * 0.44 * pressure,
            0.72,
            createGrainPattern(context, color, 'pencil')
          );
        } else if (tool === 'marker') {
          strokePath(brushSize * 2.16 * pressure, 0.58);
          strokePath(brushSize * 1.72 * pressure, 0.12);
        } else if (tool === 'watercolor') {
          strokePath(brushSize * 2.02 * pressure, 0.055, color, brushSize * 0.2);
          strokePath(brushSize * 1.76 * pressure, 0.085);
          strokePath(brushSize * 1.42 * pressure, 0.1);
        } else if (tool === 'crayon') {
          strokePath(brushSize * 1.12 * pressure, 0.54);
          strokePath(
            brushSize * 1.04 * pressure,
            0.82,
            createGrainPattern(context, color, 'crayon')
          );
        } else {
          strokePath(brushSize * 2.35 * pressure, 1, '#fffefb');
        }
      };

      drawOne(points);
      if (mirror) {
        drawOne(points.map((point) => ({
          x: CANVAS_WIDTH - point.x,
          y: point.y,
          pressure: point.pressure
        })));
      }
    };

    const getParticleSprite = (particle: StarParticle) => {
      const key = `${particle.color}-${particle.sparkle ? 'star' : 'dust'}`;
      const cached = particleSpritesRef.current.get(key);
      if (cached) return cached;
      if (particleSpritesRef.current.size > 24) particleSpritesRef.current.clear();
      const sprite = createParticleSprite(particle.color, particle.sparkle);
      particleSpritesRef.current.set(key, sprite);
      return sprite;
    };

    const animateParticles = (time: number) => {
      const particleCanvas = particleCanvasRef.current;
      const context = particleCanvas?.getContext('2d');
      if (!particleCanvas || !context) {
        particleFrameRef.current = null;
        return;
      }
      const elapsedMilliseconds = particleFrameTimeRef.current > 0
        ? time - particleFrameTimeRef.current
        : PARTICLE_FRAME_INTERVAL;
      if (particleFrameTimeRef.current > 0 && elapsedMilliseconds < PARTICLE_FRAME_INTERVAL) {
        particleFrameRef.current = window.requestAnimationFrame(animateParticles);
        return;
      }
      const elapsed = particleFrameTimeRef.current > 0
        ? Math.min(3, elapsedMilliseconds / 16.67)
        : 2;
      particleFrameTimeRef.current = time;
      context.clearRect(0, 0, PARTICLE_CANVAS_SIZE, PARTICLE_CANVAS_SIZE);
      context.save();
      context.scale(PARTICLE_CANVAS_SIZE / CANVAS_WIDTH, PARTICLE_CANVAS_SIZE / CANVAS_HEIGHT);
      context.globalCompositeOperation = 'lighter';

      const activeParticles: StarParticle[] = [];
      for (const particle of particlesRef.current) {
        particle.life -= elapsed;
        if (particle.life <= 0) continue;
        particle.x += particle.velocityX * elapsed;
        particle.y += particle.velocityY * elapsed;
        particle.velocityX *= 0.985 ** elapsed;
        particle.velocityY = particle.velocityY * (0.985 ** elapsed) - 0.012 * elapsed;
        const progress = particle.life / particle.maxLife;
        const alpha = Math.min(1, progress * 1.8) * Math.min(1, (1 - progress) * 5);
        context.globalAlpha = alpha;
        const sprite = getParticleSprite(particle);
        const drawSize = particle.size * (particle.sparkle ? 5 : 3.2) * (0.78 + progress * 0.4);
        context.drawImage(
          sprite,
          particle.x - drawSize / 2,
          particle.y - drawSize / 2,
          drawSize,
          drawSize
        );
        activeParticles.push(particle);
      }
      context.restore();
      particlesRef.current = activeParticles;

      if (activeParticles.length > 0) {
        particleFrameRef.current = window.requestAnimationFrame(animateParticles);
      } else {
        particleFrameRef.current = null;
        particleFrameTimeRef.current = 0;
      }
    };

    const startParticleAnimation = () => {
      if (particleFrameRef.current !== null) return;
      particleFrameTimeRef.current = 0;
      particleFrameRef.current = window.requestAnimationFrame(animateParticles);
    };

    const emitParticleBurst = (point: Point, count: number) => {
      const particleColors = tool === 'eraser'
        ? ['#ffffff', '#8ee8ff', '#b6c8ff']
        : [color, '#ffffff', '#7fdfff', '#ffd86b'];
      const effectiveCount = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? Math.min(1, count)
        : count;
      for (let index = 0; index < effectiveCount; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.4 + Math.random() * 1.7;
        const maxLife = 18 + Math.random() * 12;
        particlesRef.current.push({
          x: point.x + (Math.random() - 0.5) * 12,
          y: point.y + (Math.random() - 0.5) * 12,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - 0.35,
          life: maxLife,
          maxLife,
          size: 2.2 + Math.random() * 4.2,
          color: particleColors[index % particleColors.length],
          sparkle: index % 3 === 0
        });
      }
      if (particlesRef.current.length > MAX_PARTICLES) {
        particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
      }
      startParticleAnimation();
    };

    const emitParticleTrail = (point: Point, burst = false) => {
      const previous = lastParticlePointRef.current;
      if (!previous || burst) {
        emitParticleBurst(point, burst ? 4 : 1);
        lastParticlePointRef.current = point;
        return;
      }
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (distance < 18) return;
      const steps = Math.min(3, Math.max(1, Math.ceil(distance / 40)));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        emitParticleBurst({
          x: previous.x + (point.x - previous.x) * ratio,
          y: previous.y + (point.y - previous.y) * ratio,
          pressure: point.pressure
        }, 1);
      }
      lastParticlePointRef.current = point;
    };

    const beginStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = canvasPoint(event, event.currentTarget);
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!strokeBaseRef.current) {
        strokeBaseRef.current = document.createElement('canvas');
        strokeBaseRef.current.width = CANVAS_WIDTH;
        strokeBaseRef.current.height = CANVAS_HEIGHT;
      }
      const baseContext = strokeBaseRef.current.getContext('2d');
      if (!baseContext) return;
      baseContext.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      baseContext.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawingRef.current = true;
      strokePointsRef.current = [point];
      renderStroke();
      lastParticlePointRef.current = null;
      emitParticleTrail(point, true);
    };

    const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || disabled) return;
      event.preventDefault();
      const point = canvasPoint(event, event.currentTarget);
      const points = strokePointsRef.current;
      const previous = points[points.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
      points.push(point);
      renderStroke();
      emitParticleTrail(point);
    };

    const finishStroke = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      strokePointsRef.current = [];
      lastParticlePointRef.current = null;
      saveSnapshot();
    };

    const undo = async () => {
      const canvas = canvasRef.current;
      if (!canvas || historyRef.current.length <= 1) return;
      const current = historyRef.current.pop();
      if (current) redoRef.current.push(current);
      const snapshot = historyRef.current[historyRef.current.length - 1];
      await loadSnapshot(canvas, snapshot);
      const nextHasDrawing = historyRef.current.length > 1;
      setDrawingState(nextHasDrawing, nextHasDrawing ? snapshot : null);
      syncHistoryState();
    };

    const redo = async () => {
      const canvas = canvasRef.current;
      const snapshot = redoRef.current.pop();
      if (!canvas || !snapshot) return;
      historyRef.current.push(snapshot);
      await loadSnapshot(canvas, snapshot);
      setDrawingState(true, snapshot);
      syncHistoryState();
    };

    const clear = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      context.fillStyle = '#fffefb';
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      historyRef.current = [canvas.toDataURL('image/webp', 0.82)];
      redoRef.current = [];
      setDrawingState(false, null);
      syncHistoryState();
    };

    const tools: Array<{ value: BrushTool; label: string; icon: typeof Pencil }> = [
      { value: 'pencil', label: '铅笔', icon: Pencil },
      { value: 'marker', label: '马克笔', icon: Highlighter },
      { value: 'watercolor', label: '水彩笔', icon: Brush },
      { value: 'crayon', label: '蜡笔', icon: Paintbrush },
      { value: 'eraser', label: '橡皮', icon: Eraser }
    ];

    const updateBrushSizeFromPointer = (event: ReactPointerEvent<HTMLInputElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const nextSize = Math.round((6 + ratio * 48) / 2) * 2;
      setBrushSize(Math.min(54, Math.max(6, nextSize)));
    };

    const beginBrushSizeDrag = (event: ReactPointerEvent<HTMLInputElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateBrushSizeFromPointer(event);
    };

    const continueBrushSizeDrag = (event: ReactPointerEvent<HTMLInputElement>) => {
      const isDragging = event.currentTarget.hasPointerCapture(event.pointerId)
        || event.buttons === 1
        || event.pressure > 0;
      if (disabled || !isDragging) return;
      event.preventDefault();
      updateBrushSizeFromPointer(event);
    };

    return (
      <section className="cosmic-drawing-board" aria-label="星河手绘板">
        <div className="cosmic-paper-frame">
          <canvas
            ref={canvasRef}
            className="cosmic-paper-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            aria-label="手绘画布"
            onPointerDown={beginStroke}
            onPointerMove={continueStroke}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onPointerLeave={finishStroke}
          />
          <canvas
            ref={particleCanvasRef}
            className="cosmic-paper-particles"
            width={PARTICLE_CANVAS_SIZE}
            height={PARTICLE_CANVAS_SIZE}
            aria-hidden="true"
          />
          {!hasDrawing ? (
            <div className="cosmic-paper-hint" aria-hidden="true">
              <Sparkles size={22} />
              <span>从这里画出你的星河生命</span>
            </div>
          ) : null}
          <div className="cosmic-drawing-tools" aria-label="画板工具">
          <div className="cosmic-color-row" role="group" aria-label="画笔颜色">
            <span className="cosmic-rail-label">颜色</span>
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={color === value ? 'is-selected' : undefined}
                style={{ '--drawing-color': value } as React.CSSProperties}
                aria-label={`选择颜色 ${value}`}
                aria-pressed={color === value}
                disabled={disabled || tool === 'eraser'}
                onClick={() => setColor(value)}
              />
            ))}
            <label
              className={`cosmic-custom-color${!COLORS.includes(color) ? ' is-selected' : ''}`}
              style={{ '--drawing-color': color } as React.CSSProperties}
              title="自定义颜色"
              aria-label="自定义画笔颜色"
            >
              <Palette size={17} aria-hidden="true" />
              <input
                type="color"
                value={color}
                disabled={disabled || tool === 'eraser'}
                aria-label="选择自定义颜色"
                onInput={(event) => setColor(event.currentTarget.value)}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <label className="cosmic-brush-size">
              <span>粗细</span>
              <div
                className="cosmic-brush-size-control"
                style={{
                  '--brush-size-progress': `${((brushSize - 6) / 48) * 100}%`,
                  '--brush-thumb-bottom': `${14 + ((brushSize - 6) / 48) * 92}px`
                } as React.CSSProperties}
              >
                <input
                  type="range"
                  min="6"
                  max="54"
                  step="2"
                  value={brushSize}
                  disabled={disabled}
                  aria-label="调整笔触粗细"
                  onPointerDown={beginBrushSizeDrag}
                  onPointerMove={continueBrushSizeDrag}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
                <b aria-hidden="true" />
              </div>
              <i
                className={`is-${tool}`}
                style={{
                  '--drawing-color': tool === 'eraser' ? '#fffefb' : color,
                  width: Math.max(8, brushSize * 0.52),
                  height: Math.max(8, brushSize * 0.52)
                } as React.CSSProperties}
              />
            </label>
          </div>

          <div className="cosmic-tool-rail">
          <div className="cosmic-brush-grid" role="group" aria-label="画笔工具">
            {tools.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                data-brush={value}
                className={tool === value ? 'is-selected' : undefined}
                aria-pressed={tool === value}
                disabled={disabled}
                onClick={() => setTool(value)}
              >
                <Icon size={20} strokeWidth={2} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="cosmic-drawing-utilities" role="group" aria-label="画布操作">
            <button type="button" disabled={disabled || !canUndo} onClick={() => void undo()}>
              <Undo2 size={19} aria-hidden="true" />
              <span>撤销</span>
            </button>
            <button type="button" disabled={disabled || !canRedo} onClick={() => void redo()}>
              <Redo2 size={19} aria-hidden="true" />
              <span>重做</span>
            </button>
            <button
              type="button"
              className={mirror ? 'is-selected' : undefined}
              aria-pressed={mirror}
              disabled={disabled}
              onClick={() => setMirror((current) => !current)}
            >
              <FlipHorizontal2 size={19} aria-hidden="true" />
              <span>镜像</span>
            </button>
            <button type="button" disabled={disabled || !hasDrawing} onClick={clear}>
              <Trash2 size={19} aria-hidden="true" />
              <span>清空</span>
            </button>
          </div>
          </div>
          </div>
        </div>
      </section>
    );
  }
);
