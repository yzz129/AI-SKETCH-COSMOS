import { useEffect, useRef } from 'react';

type TrailParticle = {
  x: number;
  y: number;
  size: number;
  speed: number;
  angle: number;
  spin: number;
  hue: number;
  depth: number; // 0-1, near→far parallax
};

export function TouchTrailCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let animationFrame = 0;
    let particlesArray: TrailParticle[] = [];
    let hue = 0;
    const mouse = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const createParticle = (): TrailParticle => ({
      x: mouse.x,
      y: mouse.y,
      size: Math.random() * 2.5 + 0.8,
      speed: Math.random() * 2 + 0.4,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.1,
      hue,
      depth: Math.random() * 0.45 + 0.55,
    });

    const emitParticles = (x: number, y: number) => {
      mouse.x = x;
      mouse.y = y;
      for (let i = 0; i < 3; i += 1) {
        particlesArray.push(createParticle());
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      emitParticles(event.x, event.y);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      emitParticles(touch.clientX, touch.clientY);
    };

    const handleParticles = () => {
      for (let i = 0; i < particlesArray.length; i += 1) {
        const particle = particlesArray[i];
        particle.angle += particle.spin;
        particle.x += Math.cos(particle.angle) * particle.speed;
        particle.y += Math.sin(particle.angle) * particle.speed;

        if (particle.size > 0.12) {
          particle.size -= 0.06;
        }

        const d = particle.depth;

        // Subtle outer glow — depth hint only
        ctx.fillStyle = `hsla(${particle.hue}, 80%, 65%, ${0.12 * d})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Crisp bright core
        ctx.fillStyle = `hsla(${particle.hue}, 90%, 72%, ${0.85 * d})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 0.55, 0, Math.PI * 2);
        ctx.fill();

        if (particle.size <= 0.12) {
          particlesArray.splice(i, 1);
          i -= 1;
        }
      }
    };

    const animate = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      handleParticles();
      ctx.globalCompositeOperation = 'source-over';
      hue += 1.2;
      animationFrame = requestAnimationFrame(animate);
    };

    resizeCanvas();
    animate();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      particlesArray = [];
    };
  }, []);

  return <canvas ref={canvasRef} className="touch-trail-canvas" aria-hidden="true" />;
}
