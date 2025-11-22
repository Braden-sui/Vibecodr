import React, { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform, animate } from "framer-motion";
import { interpolate } from "flubber";

// Pre-defined blob paths (normalized to 100x100 viewbox for simplicity, will scale)
const blobPaths = [
    "M44.7,-76.4C58.9,-69.2,71.8,-59.1,81.6,-46.6C91.4,-34.1,98.1,-19.2,95.8,-5.3C93.5,8.6,82.2,21.5,70.6,32.2C59,42.9,47.1,51.4,34.8,58.6C22.5,65.8,9.8,71.7,-2.3,75.7C-14.4,79.7,-25.9,81.8,-36.6,76.3C-47.3,70.8,-57.2,57.7,-65.3,43.8C-73.4,29.9,-79.7,15.2,-80.8,-0.1C-81.9,-15.4,-77.8,-31.3,-68.6,-44.1C-59.4,-56.9,-45.1,-66.6,-30.6,-73.5C-16.1,-80.4,-1.4,-84.5,12.4,-82.3C26.2,-80.1,30.5,-83.6,44.7,-76.4Z",
    "M41.9,-73.4C54.6,-65.2,65.4,-54.3,73.4,-41.6C81.4,-28.9,86.6,-14.4,85.2,-0.5C83.8,13.4,75.8,26.8,66.1,38.2C56.4,49.6,45,59,32.5,65.4C20,71.8,6.4,75.2,-6.4,73.9C-19.2,72.6,-31.2,66.6,-42.3,59.1C-53.4,51.6,-63.6,42.6,-70.6,31.5C-77.6,20.4,-81.4,7.2,-79.6,-5.2C-77.8,-17.6,-70.4,-29.2,-61.2,-39.1C-52,-49,-41,-57.2,-29.3,-64.2C-17.6,-71.2,-5.2,-77,7.8,-75.4C20.8,-73.8,31.6,-64.8,41.9,-73.4Z",
    "M36.6,-64.7C47.9,-57.1,57.9,-48.3,65.7,-37.8C73.5,-27.3,79.1,-15.1,78.4,-3.2C77.7,8.7,70.7,20.3,62.2,30.3C53.7,40.3,43.7,48.7,32.8,55.4C21.9,62.1,10.1,67.1,-1.4,69.5C-12.9,71.9,-24.1,71.7,-34.6,66.3C-45.1,60.9,-54.9,50.3,-62.4,38.2C-69.9,26.1,-75.1,12.5,-74.3,0.5C-73.5,-11.5,-66.7,-21.9,-58.1,-31.2C-49.5,-40.5,-39.1,-48.7,-28.4,-56.6C-17.7,-64.5,-6.7,-72.1,5.1,-72.9C16.9,-73.7,25.3,-72.3,36.6,-64.7Z"
];

const LiquidBackground = () => {
    const pathIndex = useMotionValue(0);
    const colors = ["#E67E22", "#2C3E50", "#16A085"]; // Coral, Navy, Teal
    const colorIndex = useMotionValue(0);
    const pointerX = useSpring(0, { stiffness: 60, damping: 14 });
    const pointerY = useSpring(0, { stiffness: 60, damping: 14 });

    const path = useTransform(pathIndex, (latest) => {
        const index = Math.round(latest) % blobPaths.length;
        const nextIndex = (index + 1) % blobPaths.length;
        const progress = latest - Math.floor(latest);
        return interpolate(blobPaths[index], blobPaths[nextIndex])(progress);
    });

    const color = useTransform(colorIndex, (latest) => colors[Math.round(latest) % colors.length]);

    const parallaxX = useTransform(pointerX, (v) => v * 0.02);
    const parallaxY = useTransform(pointerY, (v) => v * 0.02);
    const parallaxX2 = useTransform(pointerX, (v) => v * -0.015);
    const parallaxY2 = useTransform(pointerY, (v) => v * -0.015);

    useEffect(() => {
        const controls = animate(pathIndex, blobPaths.length * 10, {
            duration: 20,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
        });

        const colorControls = animate(colorIndex, colors.length * 10, {
            duration: 30,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "linear",
        });

        const handlePointer = (event: PointerEvent) => {
            const { innerWidth, innerHeight } = window;
            const x = (event.clientX / innerWidth - 0.5) * 2;
            const y = (event.clientY / innerHeight - 0.5) * 2;
            pointerX.set(x);
            pointerY.set(y);
        };

        window.addEventListener("pointermove", handlePointer);

        return () => {
            controls.stop();
            colorControls.stop();
            window.removeEventListener("pointermove", handlePointer);
        };
    }, [pathIndex, colorIndex, pointerX, pointerY, colors.length]);

    return (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
            <motion.svg
                viewBox="-100 -100 200 200"
                className="absolute top-[-25%] left-[-15%] w-[70vw] h-[70vw] opacity-25 blur-2xl mix-blend-screen"
                style={{ translateX: parallaxX, translateY: parallaxY }}
            >
                <motion.path d={path} fill={color} />
            </motion.svg>

            <motion.svg
                viewBox="-100 -100 200 200"
                className="absolute bottom-[-25%] right-[-15%] w-[80vw] h-[80vw] opacity-18 blur-2xl mix-blend-screen"
                style={{ rotate: 180, translateX: parallaxX2, translateY: parallaxY2 }}
            >
                <motion.path d={path} fill={colors[1]} />
            </motion.svg>
        </div>
    );
};

export default LiquidBackground;
