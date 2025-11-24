import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";

// WHY: Render the Etheria Sky cloud field as a non-interactive global background.
// INVARIANT: Background stays behind all content, respects reduced-motion, and cleans up WebGL resources.
const EtheriaSkyBackground = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const gradientRef = useRef<HTMLDivElement | null>(null);
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

    // We'll store initial random offsets to maintain "shape" during recycling
    const randomOffsets = new Float32Array(cloudCount * 3);

    // Deterministic random helper
    // Allows us to get the same "random" value for a specific particle index every time
    const getDeterministicRandom = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };

    // Create clusters of clouds
    const clusterCount = 40;
    for (let i = 0; i < cloudCount; i++) {
      // Distribute particles among clusters
      const clusterIdx = Math.floor((i / cloudCount) * clusterCount);

      // Cluster centers (randomly placed in the sky volume)
      const clusterX = (Math.sin(clusterIdx * 123.45) * 800);
      const clusterY = (Math.cos(clusterIdx * 678.90) * 200) + 50;
      // We spread Z widely for the "infinite" tunnel feel
      const clusterZ = (Math.sin(clusterIdx * 321.01) * 800) - 400; 

      // Particle offset within the cluster (ellipsoid shape)
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 120;
      const heightOffset = (Math.random() - 0.5) * 60;

      const offsetX = Math.cos(angle) * radius;
      const offsetY = heightOffset + Math.sin(angle) * radius * 0.4;
      const offsetZ = Math.sin(angle) * radius * 0.8;

      const x = clusterX + offsetX;
      const y = clusterY + offsetY;
      const z = clusterZ + offsetZ;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Store offsets relative to "center" for recycling logic
      randomOffsets[i * 3] = offsetX; // not strictly used but good for reshaping
      randomOffsets[i * 3 + 1] = offsetY;
      randomOffsets[i * 3 + 2] = offsetZ;

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

      // Randomize sizes slightly for variety (deterministic)
      const rSize = getDeterministicRandom(i * 91.345);
      sizes[i] = 150 + rSize * 100;
    }

    // Store original positions for parallax calculations (base reference)
    // We act on a "virtual" Z position that loops
    const originalPositions = new Float32Array(positions); // Correctly initialize from initial positions
    const originalZ = new Float32Array(cloudCount);
    for(let i=0; i<cloudCount; i++) {
        originalZ[i] = positions[i * 3 + 2];
    }

    // Opacity buffer for fade in/out
    const opacities = new Float32Array(cloudCount);
    opacities.fill(1); // Start fully visible, animate loop will adjust

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("opacity", new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Custom shader to support per-particle opacity and size attenuation
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: cloudTexture },
        scale: { value: height / (2 * Math.tan((35 * Math.PI) / 360)) } // Perspective scale for fov 35
      },
      vertexShader: `
        attribute float opacity;
        attribute float size;
        varying float vOpacity;
        varying vec3 vColor;
        void main() {
          vOpacity = opacity;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // Size attenuation matches THREE.PointsMaterial
          gl_PointSize = size * (scale / -mvPosition.z);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying float vOpacity;
        varying vec3 vColor;
        void main() {
          vec4 texColor = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, texColor.a * vOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const cloudSystem = new THREE.Points(geometry, material);
    scene.add(cloudSystem);

    // --- Animation ---
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      const time = performance.now() * 0.001;
      const scrollY = window.scrollY;
      
      // 1. Infinite Camera Movement
      // "Virtual" camera Z based on scroll. 
      // 800 is start. We move deeper (negative) as we scroll.
      // We multiply scrollY to make the journey feel faster/longer.
      const virtualCameraZ = 800 - (scrollY * 1.5);
      
      // 2. Shift Gradient Background (Cyclical)
      if (gradientRef.current) {
        // Loop the background translation every 2000px of scroll to avoid running out
        const gradientLoop = (scrollY * 0.4) % 1000; 
        gradientRef.current.style.transform = `translateY(-${gradientLoop}px)`;
      }

      // 3. Infinite Cloud Looping
      const currentPositions = geometry.attributes.position.array as Float32Array;
      const currentOpacities = geometry.attributes.opacity.array as Float32Array;
      const tunnelLength = 2000; // Depth of the cloud tunnel
      const tunnelStart = 800;   // Where particles "start" relative to camera (behind)
      const tunnelEnd = -1200;   // Where particles "end" (far distance)
      const fadeDistance = 600;  // Distance over which to fade in/out

      for (let i = 0; i < cloudCount; i++) {
        const ix = i * 3;
        
        // Calculate relative Z distance to the "virtual camera"
        let relativeZ = originalZ[i] - virtualCameraZ;
        
        // Wrap the Z coordinate within the tunnel length to create infinity
        const offsetZ = relativeZ - tunnelEnd;
        const wrappedZ = ((offsetZ % tunnelLength) + tunnelLength) % tunnelLength;
        const finalZ = wrappedZ + tunnelEnd;
        
        // Parallax / Cloud Parting Logic
        const progress = (finalZ - tunnelEnd) / tunnelLength; 
        const spread = 1 + (progress * progress * progress * 2);

        // Deterministic X/Y expansion
        // We use the stored original positions to ensure the cloud shape is preserved but expanded
        currentPositions[ix] = originalPositions[ix] * spread;
        currentPositions[ix + 1] = originalPositions[ix+1] * spread;
        currentPositions[ix + 2] = finalZ;

        // Fade Logic
        // We want to fade IN at the far end (tunnelEnd) and OUT at the near end (tunnelStart)
        // Distance from far end
        const distFromFar = finalZ - tunnelEnd; // 0 to 2000
        
        let alpha = 0.45; // Max base opacity
        
        if (distFromFar < fadeDistance) {
           // Fading in from distance
           alpha *= (distFromFar / fadeDistance);
        } else if (distFromFar > (tunnelLength - fadeDistance)) {
           // Fading out near camera/behind
           const distFromNear = tunnelLength - distFromFar;
           alpha *= (distFromNear / fadeDistance);
        }
        
        currentOpacities[i] = Math.max(0, alpha);
      }
      
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.opacity.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      const nextWidth = Math.max(1, mount.clientWidth || window.innerWidth);
      const nextHeight = Math.max(1, mount.clientHeight || window.innerHeight);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      
      // Update shader scale uniform for correct point sizing
      material.uniforms.scale.value = nextHeight / (2 * Math.tan((35 * Math.PI) / 360));
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
      <div 
        ref={gradientRef}
        className="absolute inset-0 bg-[linear-gradient(180deg,#0b0d48_0%,#123a88_24%,#73124a_46%,#a0133c_64%,#ff521b_78%,#ff8c4a_100%)]" 
      />

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
