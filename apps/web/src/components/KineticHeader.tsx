import React, { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface KineticHeaderProps {
    text: string;
    className?: string;
}

const KineticHeader = ({ text, className }: KineticHeaderProps) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const [weight, setWeight] = useState(400);
    const shouldReduceMotion = useReducedMotion();

    const handleMouseMove = (e: React.MouseEvent) => {
        if (shouldReduceMotion || !ref.current) return;

        const rect = ref.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const distance = Math.sqrt(
            Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
        );

        // Map distance to weight (closer = bolder)
        // Max weight 800, Min weight 400. Influence radius 300px.
        const maxDist = 300;
        const intensity = Math.max(0, 1 - distance / maxDist);
        const newWeight = 400 + intensity * 400; // Range 400-800

        setWeight(newWeight);
    };

    const handleMouseLeave = () => {
        if (shouldReduceMotion) return;
        setWeight(400);
    };

    return (
        <motion.h1
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={className}
            style={{
                fontVariationSettings: `'wght' ${weight}`,
                transition: shouldReduceMotion ? "none" : "font-variation-settings 0.2s ease-out",
            }}
        >
            {text.split("").map((char, i) => (
                <motion.span
                    key={i}
                    initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                        delay: shouldReduceMotion ? 0 : i * 0.05,
                        duration: shouldReduceMotion ? 0 : 0.5,
                        ease: "backOut"
                    }}
                    className="inline-block"
                >
                    {char === " " ? "\u00A0" : char}
                </motion.span>
            ))}
        </motion.h1>
    );
};

export default KineticHeader;
