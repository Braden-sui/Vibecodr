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

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x72c8f1, 200, 1200);

    const camera = new THREE.PerspectiveCamera(30, width / height, 1, 3000);
    camera.position.z = 600;

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

    const ambientLight = new THREE.AmbientLight(0x99ccff, 0.85);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    directionalLight.position.set(0.5, 0.5, 1);
    scene.add(directionalLight);

    const generateCloudTexture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) {
        console.error("E-VIBECODR-0603 etheria sky texture context missing");
        return new THREE.Texture();
      }

      const gradient = context.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 2,
      );

      gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.7)");
      gradient.addColorStop(0.8, "rgba(235, 245, 255, 0.1)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      return new THREE.CanvasTexture(canvas);
    };

    const cloudTexture = generateCloudTexture();
    const geometry = new THREE.PlaneGeometry(128, 128);
    const baseMaterial = new THREE.MeshLambertMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>[] = [];
    const cloudCount = 180;
    const yMin = -60;
    const yMax = 420;

    for (let i = 0; i < cloudCount; i++) {
      const material = baseMaterial.clone();
      const cloud = new THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>(geometry, material);

      cloud.position.x = Math.random() * 1000 - 500;
      const yPos = Math.random() * (yMax - yMin) + yMin;
      cloud.position.y = yPos;
      cloud.position.z = i * 2 - 160;

      const fadeRange = 240;
      const opacityFactor = Math.max(0, Math.min(1, (yPos - yMin) / fadeRange));
      material.opacity = 0.82 * opacityFactor;

      cloud.rotation.z = Math.random() * Math.PI;
      const scale = Math.random() * 1.8 + 0.6;
      cloud.scale.set(scale, scale, 1);

      scene.add(cloud);
      clouds.push(cloud);
    }

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      clouds.forEach((cloud) => {
        const driftSpeed = 0.18 + cloud.scale.x * 0.08;
        cloud.position.x -= driftSpeed;
        if (cloud.position.x < -640) {
          cloud.position.x = 640;
        }
        cloud.rotation.z += 0.0006;
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
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#1e4877_0%,#4584b4_50%,#72c8f1_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.24),transparent_42%),radial-gradient(circle_at_82%_12%,rgba(255,255,255,0.18),transparent_38%)] opacity-70 mix-blend-screen" />
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#d7f1ff]/65 via-transparent to-transparent" />
    </div>
  );
};

export default EtheriaSkyBackground;
