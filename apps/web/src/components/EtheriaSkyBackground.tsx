import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";

// WHY: Render the Etheria Sky cloud field as a non-interactive global background.
// INVARIANT: Background stays behind all content, respects reduced-motion, and cleans up WebGL resources.
const EtheriaSkyBackground = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const mount = mountRef.current;
    if (!mount) return;

    const hasWebGLSupport =
      typeof window !== "undefined" &&
      (Reflect.has(window, "WebGLRenderingContext") || Reflect.has(window, "WebGL2RenderingContext"));
    if (!hasWebGLSupport) {
      return;
    }

    const { clientWidth, clientHeight } = mount;
    const width = Math.max(1, clientWidth || window.innerWidth);
    const height = Math.max(1, clientHeight || window.innerHeight);

    const palette = {
      top: "#0b0d48",
      midBlue: "#123a88",
      magenta: "#73124a",
      crimson: "#a0133c",
      orange: "#ff521b",
      ember: "#ff8c4a",
    };

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(new THREE.Color(palette.midBlue), 180, 1100);

    const camera = new THREE.PerspectiveCamera(30, width / height, 1, 3000);
    camera.position.z = 620;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (error) {
      console.error("E-VIBECODR-0601 etheria sky renderer init failed", error);
      return;
    }

    const glContext = renderer.getContext();
    if (!glContext) {
      console.error("E-VIBECODR-0602 etheria sky webgl unavailable");
      renderer.dispose();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.pointerEvents = "none";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(new THREE.Color("#1b133b"), 0.82);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(new THREE.Color(palette.ember), 1.1);
    sunLight.position.set(0.35, 0.65, 0.9);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(new THREE.Color("#6b32ff"), 0.35);
    rimLight.position.set(-0.55, 0.25, 0.4);
    scene.add(rimLight);

    const hemi = new THREE.HemisphereLight(new THREE.Color(palette.top), new THREE.Color(palette.orange), 0.65);
    scene.add(hemi);

    const generateCloudTexture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) {
        console.error("E-VIBECODR-0603 etheria sky texture context missing");
        return new THREE.Texture();
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      const drawBlob = (cx: number, cy: number, r: number, alpha: number) => {
        const g = context.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * alpha})`);
        g.addColorStop(0.45, `rgba(255,255,255,${0.65 * alpha})`);
        g.addColorStop(0.8, `rgba(240,245,255,${0.18 * alpha})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = g;
        context.fillRect(cx - r, cy - r, r * 2, r * 2);
      };

      for (let i = 0; i < 16; i++) {
        const cx = Math.random() * canvas.width;
        const cy = Math.random() * canvas.height * 0.6;
        const r = 50 + Math.random() * 90;
        const alpha = 0.6 + Math.random() * 0.4;
        drawBlob(cx, cy, r, alpha);
      }

      // Soft streaks to mimic wind-swept tops.
      context.globalAlpha = 0.08;
      context.fillStyle = "rgba(255,255,255,0.45)";
      for (let i = 0; i < 6; i++) {
        const y = Math.random() * canvas.height * 0.45;
        const h = 10 + Math.random() * 18;
        context.fillRect(-20, y, canvas.width + 40, h);
      }
      context.globalAlpha = 1;

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy = typeof renderer.capabilities.getMaxAnisotropy === "function"
        ? renderer.capabilities.getMaxAnisotropy()
        : 1;
      return texture;
    };

    const cloudTexture = generateCloudTexture();
    const geometry = new THREE.PlaneGeometry(140, 140);
    const baseMaterial = new THREE.MeshLambertMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: new THREE.Color("#fff8f0"),
    });

    const clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>[] = [];
    const cloudCount = 210;
    const yMin = 120;
    const yMax = 520;

    for (let i = 0; i < cloudCount; i++) {
      const material = baseMaterial.clone();
      const cloud = new THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>(geometry, material);

      cloud.position.x = Math.random() * 1100 - 550;
      const yPos = Math.random() * (yMax - yMin) + yMin;
      cloud.position.y = yPos;
      cloud.position.z = i * 1.5 - 260;

      const verticalWeight = Math.max(0, Math.min(1, (yPos - yMin) / (yMax - yMin)));
      const fadeFloor = Math.max(0, Math.min(1, (yPos - yMin) / 140));
      material.opacity = 0.85 * Math.pow(verticalWeight, 0.85) * fadeFloor;

      cloud.rotation.z = Math.random() * Math.PI;
      const scale = Math.random() * 2 + 0.9;
      cloud.scale.set(scale * 1.25, scale, 1);

      scene.add(cloud);
      clouds.push(cloud);
    }

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      clouds.forEach((cloud, idx) => {
        const driftSpeed = 0.12 + cloud.scale.x * 0.04 + (idx % 7) * 0.002;
        cloud.position.x -= driftSpeed;
        if (cloud.position.x < -720) {
          cloud.position.x = 720;
        }
        cloud.rotation.z += 0.0004;
      });

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      const nextWidth = Math.max(1, mount.clientWidth || window.innerWidth);
      const nextHeight = Math.max(1, mount.clientHeight || window.innerHeight);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameId);

      clouds.forEach((cloud) => {
        cloud.material.dispose();
        scene.remove(cloud);
      });

      baseMaterial.dispose();
      cloudTexture.dispose();
      geometry.dispose();
      renderer.dispose();

      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [prefersReducedMotion]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0b0d48_0%,#123a88_24%,#73124a_46%,#a0133c_64%,#ff521b_78%,#ff8c4a_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.25),transparent_45%),radial-gradient(circle_at_80%_12%,rgba(255,255,255,0.18),transparent_40%)] opacity-70 mix-blend-screen" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(120%_80%_at_50%_100%,rgba(255,115,53,0.55),transparent_60%)] mix-blend-screen" />
      <div ref={mountRef} className="absolute inset-x-0 top-0 h-[62vh] md:h-[55vh] lg:h-[50vh]" />
      <div className="absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-[rgba(255,115,53,0.4)] via-transparent to-transparent" />
    </div>
  );
};

export default EtheriaSkyBackground;
