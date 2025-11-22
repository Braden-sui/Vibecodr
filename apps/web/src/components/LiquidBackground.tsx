import React, { useEffect, useRef } from "react";

// WHY: Provide a calm, interactive water-like background across the app with ripple response.
// INVARIANT: Keep simulation resolution bounded; avoid work when canvas/context unavailable.

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function createRippleSim(width: number, height: number) {
  const size = width * height;
  let bufA = new Float32Array(size);
  let bufB = new Float32Array(size);
  const damping = 0.985;

  const step = () => {
    for (let y = 1; y < height - 1; y++) {
      const yw = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = yw + x;
        const val =
          (bufA[i - 1] + bufA[i + 1] + bufA[i - width] + bufA[i + width]) / 2 - bufB[i];
        bufB[i] = val * damping;
      }
    }
    const tmp = bufA;
    bufA = bufB;
    bufB = tmp;
  };

  const disturb = (x: number, y: number, radius = 4, power = 1) => {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = x + dx;
        const py = y + dy;
        if (px <= 1 || px >= width - 1 || py <= 1 || py >= height - 1) continue;
        bufA[py * width + px] = power;
      }
    }
  };

  return { step, disturb, get buffer() { return bufA; }, width, height };
}

const LiquidBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const simRef = useRef<ReturnType<typeof createRippleSim> | null>(null);
  const parallaxRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      const simW = Math.min(320, Math.max(160, Math.floor(canvas.width / 6)));
      const simH = Math.min(200, Math.max(100, Math.floor(canvas.height / 6)));
      simRef.current = createRippleSim(simW, simH);
    };

    resize();
    window.addEventListener("resize", resize);

    const base1 = "#0b1224";
    const base2 = "#0f172a";
    const accent = "#2dd4bf";

    const render = () => {
      const sim = simRef.current;
      if (!sim) return;
      sim.step();

      const { buffer, width: sw, height: sh } = sim;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Base gradient
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, base1);
      grad.addColorStop(1, base2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Height-to-normal shading at sim resolution
      const image = ctx.createImageData(sw, sh);
      for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
          const i = y * sw + x;
          const nx = buffer[i - 1] - buffer[i + 1];
          const ny = buffer[i - sw] - buffer[i + sw];
          const shade = clamp(128 + (nx + ny) * 180, 0, 255);
          const o = i * 4;
          image.data[o] = shade;
          image.data[o + 1] = shade + 8;
          image.data[o + 2] = shade + 18;
          image.data[o + 3] = 64;
        }
      }

      // Upscale
      const off = document.createElement("canvas");
      off.width = sw;
      off.height = sh;
      const octx = off.getContext("2d");
      if (octx) {
        octx.putImageData(image, 0, 0);
        ctx.save();
        ctx.scale(width / sw, height / sh);
        ctx.drawImage(off, 0, 0);
        ctx.restore();
      }

      // Highlight sheen
      ctx.globalCompositeOperation = "screen";
      const light = ctx.createRadialGradient(
        width * (0.5 + parallaxRef.current.x * 0.06),
        height * (0.4 + parallaxRef.current.y * 0.06),
        Math.min(width, height) * 0.12,
        width * 0.5,
        height * 0.6,
        Math.min(width, height) * 0.75
      );
      light.addColorStop(0, `${accent}25`);
      light.addColorStop(1, "transparent");
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    const handlePointer = (event: PointerEvent) => {
      const sim = simRef.current;
      if (!sim) return;
      const rect = canvas.getBoundingClientRect();
      const xNorm = (event.clientX - rect.left) / rect.width;
      const yNorm = (event.clientY - rect.top) / rect.height;
      const sx = Math.floor(xNorm * sim.width);
      const sy = Math.floor(yNorm * sim.height);
      sim.disturb(sx, sy, 6, 1.2);
      parallaxRef.current.x = (xNorm - 0.5) * 2;
      parallaxRef.current.y = (yNorm - 0.5) * 2;
      document.documentElement.style.setProperty("--water-parallax-x", `${parallaxRef.current.x * 4}px`);
      document.documentElement.style.setProperty("--water-parallax-y", `${parallaxRef.current.y * 4}px`);
    };

    window.addEventListener("pointermove", handlePointer, { passive: true });
    window.addEventListener("pointerdown", handlePointer, { passive: true });

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("pointerdown", handlePointer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.9'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
};

export default LiquidBackground;
