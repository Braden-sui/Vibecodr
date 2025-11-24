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
    // Soft fog to blend distant clouds
    scene.fog = new THREE.FogExp2(0x123a88, 0.0012);

    const camera = new THREE.PerspectiveCamera(35, width / height, 1, 3000);
    camera.position.set(0, 0, 800);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false }); // Antialias false for performance with many particles
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

    // --- Texture Generation ---
    const generateCloudTexture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new THREE.Texture();

      // Soft radial gradient for a "puff"
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
      gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.5)");
      gradient.addColorStop(0.8, "rgba(255, 255, 255, 0.1)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0.0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);

      const texture = new THREE.CanvasTexture(canvas);
      return texture;
    };

    const cloudTexture = generateCloudTexture();

    // --- Cloud Generation ---
    const cloudCount = 8000; // Number of particles
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(cloudCount * 3);
    const colors = new Float32Array(cloudCount * 3);
    const sizes = new Float32Array(cloudCount);

    const color1 = new THREE.Color("#ff8c4a"); // Sunset Orange (Sun side)
    const color2 = new THREE.Color("#a0133c"); // Crimson (Mid)
    const color3 = new THREE.Color("#123a88"); // Deep Blue (Shadow side)
    const sunDirection = new THREE.Vector3(-0.5, 0.5, 0.8).normalize(); // Direction of the "sun"

    // Create clusters of clouds
    const clusterCount = 40;
    for (let i = 0; i < cloudCount; i++) {
      // Distribute particles among clusters
      const clusterIdx = Math.floor((i / cloudCount) * clusterCount);

      // Cluster centers (randomly placed in the sky volume)
      // We use a pseudo-random offset based on clusterIdx to keep them consistent but scattered
      const clusterX = (Math.sin(clusterIdx * 123.45) * 800);
      const clusterY = (Math.cos(clusterIdx * 678.90) * 200) + 50;
      const clusterZ = (Math.sin(clusterIdx * 321.01) * 400) - 200;

      // Particle offset within the cluster (ellipsoid shape)
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 120;
      const heightOffset = (Math.random() - 0.5) * 60;

      const x = clusterX + Math.cos(angle) * radius;
      const y = clusterY + heightOffset + Math.sin(angle) * radius * 0.4;
      const z = clusterZ + Math.sin(angle) * radius * 0.8;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // --- Lighting Simulation ---
      // Determine "facing" relative to sun for this particle within its cluster
      // Particles on the "sun side" of the cluster get warmer colors
      const particlePos = new THREE.Vector3(x, y, z);
      const clusterPos = new THREE.Vector3(clusterX, clusterY, clusterZ);
      const toParticle = new THREE.Vector3().subVectors(particlePos, clusterPos).normalize();

      const sunAlignment = toParticle.dot(sunDirection); // -1 (shadow) to 1 (highlight)

      const mixedColor = new THREE.Color();
      if (sunAlignment > 0.2) {
        // Highlight side
        mixedColor.copy(color2).lerp(color1, (sunAlignment - 0.2) * 1.2);
        // Add a rim light boost (white) for very high alignment
        if (sunAlignment > 0.7) {
          mixedColor.lerp(new THREE.Color("#ffffff"), (sunAlignment - 0.7) * 0.8);
        }
      } else {
        // Shadow side
        mixedColor.copy(color2).lerp(color3, Math.abs(sunAlignment) * 0.8);
      }

      colors[i * 3] = mixedColor.r;
      colors[i * 3 + 1] = mixedColor.g;
      colors[i * 3 + 2] = mixedColor.b;

      // Randomize sizes slightly for variety
      sizes[i] = 150 + Math.random() * 100;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // We can use a custom attribute or just uniforms, but for standard PointsMaterial, 
    // we can't easily vary size per vertex without a custom shader. 
    // However, standard PointsMaterial `size` is global. 
    // To get varying sizes efficiently without custom shaders, we can use the 'size' uniform 
    // and rely on perspective attenuation. 
    // If we really need per-particle size control, we'd need ShaderMaterial. 
    // For now, let's stick to a global size that looks good with perspective.

    const material = new THREE.PointsMaterial({
      size: 180,
      map: cloudTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending, // Normal blending for "solid" looking clouds, Additive for "glow"
      sizeAttenuation: true,
    });

    const cloudSystem = new THREE.Points(geometry, material);
    scene.add(cloudSystem);

    // --- Animation ---
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      const time = performance.now() * 0.001;

      // Drift the entire cloud system slowly
      cloudSystem.rotation.y = time * 0.02;

      // Optional: We could update positions here for individual particle drift, 
      // but rotating the container is much more performant.

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

      geometry.dispose();
      material.dispose();
      cloudTexture.dispose();
      renderer.dispose();

      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [prefersReducedMotion]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Background Gradient Layer */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0b0d48_0%,#123a88_24%,#73124a_46%,#a0133c_64%,#ff521b_78%,#ff8c4a_100%)]" />

      {/* Subtle overlay for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.15),transparent_45%)] opacity-60 mix-blend-screen" />

      {/* The WebGL Canvas Container */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Bottom fade to blend with page content if needed */}
      <div className="absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-[rgba(255,115,53,0.3)] via-transparent to-transparent" />
    </div>
  );
};

export default EtheriaSkyBackground;
