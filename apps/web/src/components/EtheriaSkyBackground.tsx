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
    camera.position.set(0, 40, 620);

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

    const ambientLight = new THREE.AmbientLight(new THREE.Color("#1b2440"), 0.9);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(new THREE.Color(palette.ember), 0.92);
    sunLight.position.set(0.45, 0.75, 0.8);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(new THREE.Color("#6b32ff"), 0.3);
    rimLight.position.set(-0.65, 0.3, 0.35);
    scene.add(rimLight);

    const hemi = new THREE.HemisphereLight(new THREE.Color("#1f3a6a"), new THREE.Color(palette.orange), 0.55);
    scene.add(hemi);

    const generateCloudTexture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext("2d");
      if (!context) {
        console.error("E-VIBECODR-0603 etheria sky texture context missing");
        return new THREE.Texture();
      }

      const gridSize = 96;
      const grid = new Float32Array((gridSize + 1) * (gridSize + 1));
      for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random();
      }

      const sampleNoise = (x: number, y: number) => {
        const gx = Math.floor(x);
        const gy = Math.floor(y);
        const tx = x - gx;
        const ty = y - gy;
        const idx = (gx % gridSize) + (gy % gridSize) * (gridSize + 1);
        const idxRight = idx + 1;
        const idxDown = idx + (gridSize + 1);
        const idxDownRight = idxDown + 1;
        const top = grid[idx] * (1 - tx) + grid[idxRight] * tx;
        const bottom = grid[idxDown] * (1 - tx) + grid[idxDownRight] * tx;
        return top * (1 - ty) + bottom * ty;
      };

      const fbm = (nx: number, ny: number) => {
        let value = 0;
        let amplitude = 0.65;
        let frequency = 1;
        for (let i = 0; i < 5; i++) {
          value += amplitude * sampleNoise(nx * frequency, ny * frequency);
          frequency *= 2;
          amplitude *= 0.5;
        }
        return value;
      };

      const image = context.createImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const nx = x / canvas.width;
          const ny = y / canvas.height;

          const billow = fbm(nx * 2.6, ny * 2.0);
          const structure = fbm(nx * 1.0 + 14, ny * 1.0 + 28);
          const densityBase = billow * 0.65 + structure * 0.55;
          let density = Math.max(0, densityBase - 0.38);
          density = Math.pow(density, 1.8);

          const heightMask = Math.max(0, 1 - Math.pow(ny * 1.12, 2.2));
          density *= heightMask;

          const softness = Math.pow(1 - ny, 2.2) * 0.25;
          const light = 0.62 + density * 0.32 + softness;

          const r = 242;
          const g = 248 - ny * 22;
          const b = 255 - ny * 18;

          const alpha = Math.min(255, Math.max(0, density * 255));
          const idx = (y * canvas.width + x) * 4;
          image.data[idx] = Math.min(255, r * light);
          image.data[idx + 1] = Math.min(255, g * light);
          image.data[idx + 2] = Math.min(255, b * light);
          image.data[idx + 3] = alpha;
        }
      }

      context.putImageData(image, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy =
        typeof renderer.capabilities.getMaxAnisotropy === "function"
          ? renderer.capabilities.getMaxAnisotropy()
          : 1;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    };

    const cloudTexture = generateCloudTexture();
    cloudTexture.minFilter = THREE.LinearMipmapLinearFilter;
    cloudTexture.generateMipmaps = true;
    // 3D volumetric-ish clouds built from clustered puffs (instanced spheres).
    const puffGeometry = new THREE.SphereGeometry(18, 18, 14);
    const puffMaterial = new THREE.MeshPhysicalMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      roughness: 0.85,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.8,
      transmission: 0.02,
      ior: 1.1,
      color: new THREE.Color("#f8fbff"),
      emissive: new THREE.Color("#1f2340"),
      emissiveIntensity: 0.06,
    });

    const puffHighlightMaterial = new THREE.MeshPhysicalMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
      transmission: 0.05,
      ior: 1.08,
      color: new THREE.Color("#e6f2ff"),
      emissive: new THREE.Color("#6fb5ff"),
      emissiveIntensity: 0.16,
      blending: THREE.AdditiveBlending,
    });

    const clusters: {
      x: number;
      y: number;
      z: number;
      drift: number;
      puffIndices: number[];
      rotation: number;
    }[] = [];

    // Increase density while keeping cohesive, cloud-like masses.
    const clusterCount = 140;
    const puffsPerCluster = 10;
    const totalPuffs = clusterCount * puffsPerCluster;
    const puffMesh = new THREE.InstancedMesh(puffGeometry, puffMaterial, totalPuffs);
    const puffHighlightMesh = new THREE.InstancedMesh(puffGeometry, puffHighlightMaterial, totalPuffs);
    puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    puffHighlightMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(puffMesh);
    scene.add(puffHighlightMesh);

    const temp = new THREE.Object3D();
    const yMin = 140;
    const yMax = 520;

    for (let c = 0; c < clusterCount; c++) {
      const baseX = Math.random() * 1100 - 550;
      const baseY = Math.random() * (yMax - yMin) + yMin;
      const baseZ = c * 1.8 - 320;
      const drift = 0.08 + Math.random() * 0.06;
      const rotation = (Math.random() - 0.5) * 0.25;

      const puffIndices: number[] = [];
      for (let p = 0; p < puffsPerCluster; p++) {
        const idx = c * puffsPerCluster + p;
        puffIndices.push(idx);

        const offsetX = (Math.random() - 0.5) * 110;
        const offsetY = (Math.random() - 0.1) * 52 + Math.max(0, (baseY - yMin) * 0.1);
        const offsetZ = (Math.random() - 0.5) * 26;
        const scale = 1.6 + Math.random() * 2.3;
        const flatten = 0.7 + Math.random() * 0.28;

        temp.position.set(baseX + offsetX, baseY + offsetY, baseZ + offsetZ);
        temp.scale.set(scale * 1.2, scale * flatten, scale * 1.05);
        temp.rotation.set(0, 0, (Math.random() - 0.5) * 0.6);
        temp.updateMatrix();
        puffMesh.setMatrixAt(idx, temp.matrix);

        const highlightScale = scale * 1.15;
        temp.scale.set(highlightScale * 1.3, highlightScale * flatten, highlightScale * 1.05);
        temp.rotation.set(0, 0, (Math.random() - 0.5) * 0.4);
        temp.updateMatrix();
        puffHighlightMesh.setMatrixAt(idx, temp.matrix);

        const opacityWeight = Math.max(0, Math.min(1, (baseY - yMin) / (yMax - yMin)));
        const opacity = 0.82 + opacityWeight * 0.15;
        puffMesh.setColorAt(idx, new THREE.Color().setScalar(opacity));
        puffHighlightMesh.setColorAt(idx, new THREE.Color().setScalar(opacity));
      }

      clusters.push({ x: baseX, y: baseY, z: baseZ, drift, puffIndices, rotation });
    }

    puffMesh.instanceMatrix.needsUpdate = true;
    puffHighlightMesh.instanceMatrix.needsUpdate = true;

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      clusters.forEach((cluster, clusterIdx) => {
        const t = performance.now();
        const buoyancy = Math.sin(t * 0.00008 + clusterIdx * 0.15) * 6;
        cluster.x -= cluster.drift * (1 + (clusterIdx % 5) * 0.02);
        cluster.y = cluster.y + buoyancy * 0.01;
        cluster.rotation += 0.00008;

        if (cluster.x < -760) {
          cluster.x = 760;
        }

        cluster.puffIndices.forEach((idx) => {
          const jitter = Math.sin((idx + clusterIdx) * 0.12 + performance.now() * 0.00009) * 1.7;
          const wobble = Math.cos((idx + clusterIdx * 2) * 0.15 + performance.now() * 0.00008) * 1.3;

          temp.position.set(cluster.x + jitter, cluster.y + wobble, cluster.z);
          temp.rotation.set(0, 0, cluster.rotation + (idx % 3) * 0.04);
          const baseScale = 1.5 + ((idx % puffsPerCluster) / puffsPerCluster) * 1.6;
          temp.scale.set(baseScale * 1.3, baseScale * 0.75, baseScale * 1.18);
          temp.updateMatrix();
          puffMesh.setMatrixAt(idx, temp.matrix);

          temp.scale.set(baseScale * 1.42, baseScale * 0.8, baseScale * 1.22);
          temp.updateMatrix();
          puffHighlightMesh.setMatrixAt(idx, temp.matrix);
        });
      });

      puffMesh.instanceMatrix.needsUpdate = true;
      puffHighlightMesh.instanceMatrix.needsUpdate = true;

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

      puffMesh.geometry.dispose();
      puffMesh.material.dispose();
      puffHighlightMesh.geometry.dispose();
      puffHighlightMesh.material.dispose();
      scene.remove(puffMesh);
      scene.remove(puffHighlightMesh);

      cloudTexture.dispose();
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
      <div ref={mountRef} className="absolute inset-x-0 top-0 h-[72vh] md:h-[64vh] lg:h-[58vh]" />
      <div className="absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-[rgba(255,115,53,0.4)] via-transparent to-transparent" />
    </div>
  );
};

export default EtheriaSkyBackground;
