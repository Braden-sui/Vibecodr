import React, { useRef, forwardRef } from "react";
import { motion, useMotionValue, useSpring, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

interface VibeCardProps extends HTMLMotionProps<"div"> {
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  accentColor?: string;
}

const VibeCard = forwardRef<HTMLDivElement, VibeCardProps>(({ children, className, onClick, accentColor = "bg-accent", ...props }, ref) => {
  const localRef = useRef<HTMLDivElement | null>(null);

  // Magnetic Effect State
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth spring physics for the magnetic pull; higher damping keeps micro-movements from jittering
  const springConfig = { damping: 22, stiffness: 150, mass: 0.1 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Use localRef for measurements
    if (!localRef.current) return;

    const rect = localRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const distanceX = e.clientX - centerX;
    const distanceY = e.clientY - centerY;

    // Magnetic pull strength (gentle to avoid jitter)
    x.set(distanceX * 0.08);
    y.set(distanceY * 0.08);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={(node) => {
        localRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      }}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        x: springX,
        y: springY,
      }}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative group bg-card rounded-xl p-6 shadow-vc-soft hover:shadow-vc-hover transition-shadow duration-300 cursor-pointer overflow-hidden border border-border/50",
        className
      )}
      {...props}
    >
      {/* Geometric Accent */}
      <div className={cn("absolute top-0 right-0 w-16 h-16 opacity-10 rounded-bl-full transition-transform group-hover:scale-150 duration-500", accentColor)} />

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
});

VibeCard.displayName = "VibeCard";

export default VibeCard;
