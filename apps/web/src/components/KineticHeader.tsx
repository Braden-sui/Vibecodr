import React, { useRef, useState, useMemo } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";

interface KineticHeaderProps {
    text: string;
    className?: string;
}

/**
 * KineticHeader - Interactive header with variable font weight on hover.
 * Uses CSS animations instead of framer-motion to prevent re-animation on re-renders.
 */
const KineticHeader = ({ text, className }: KineticHeaderProps) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const [weight, setWeight] = useState(400);
    const shouldReduceMotion = useReducedMotion();

    // Memoize the character array to prevent re-renders from causing re-animation
    const characters = useMemo(() => text.split(""), [text]);

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
        <h1
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={className}
            aria-label={text}
            style={{
                fontVariationSettings: `'wght' ${weight}`,
                transition: shouldReduceMotion ? "none" : "font-variation-settings 0.2s ease-out",
            }}
        >
            <span className="sr-only">{text}</span>
            {characters.map((char, i) => (
                <span
                    key={`${text}-${i}`}
                    aria-hidden="true"
                    className="inline-block animate-in fade-in slide-in-from-bottom-2"
                    style={{
                        animationDelay: shouldReduceMotion ? "0ms" : `${i * 30}ms`,
                        animationDuration: shouldReduceMotion ? "0ms" : "400ms",
                        animationFillMode: "both",
                    }}
                >
                    {char === " " ? "\u00A0" : char}
                </span>
            ))}
        </h1>
    );
};

export default KineticHeader;
