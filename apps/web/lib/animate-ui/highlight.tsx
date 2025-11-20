"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { useDataState } from "./useDataState";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HighlightContextValue = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  setRect: (rect: DOMRect | null) => void;
};

const HighlightContext = React.createContext<HighlightContextValue | undefined>(
  undefined
);

function useHighlightContext(): HighlightContextValue {
  const ctx = React.useContext(HighlightContext);
  if (!ctx) {
    throw new Error("Highlight primitives must be used within <Highlight>");
  }
  return ctx;
}

export interface HighlightProps
  extends React.HTMLAttributes<HTMLDivElement> {
  radiusClassName?: string;
}

export function Highlight({
  className,
  children,
  radiusClassName,
  ...props
}: HighlightProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = React.useState<Bounds | null>(null);

  const setRect = React.useCallback((rect: DOMRect | null) => {
    const container = containerRef.current;
    if (!container || !rect) {
      setBounds(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    setBounds({
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const contextValue = React.useMemo<HighlightContextValue>(
    () => ({ containerRef, setRect }),
    [setRect]
  );

  return (
    <HighlightContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={cn("relative", className)}
        {...props}
      >
        <AnimatePresence>
          {bounds && (
            <motion.div
              key="highlight"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className={cn(
                "absolute bg-accent/60",
                radiusClassName ?? "rounded-sm"
              )}
              style={{
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
              }}
            />
          )}
        </AnimatePresence>
        {children}
      </div>
    </HighlightContext.Provider>
  );
}

export interface HighlightItemProps
  extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

export const HighlightItem = React.forwardRef<
  HTMLElement,
  HighlightItemProps
>(function HighlightItem(
  { className, asChild, children, ...props },
  forwardedRef
) {
  const { containerRef, setRect } = useHighlightContext();
  const [highlighted, localRef] = useDataState<HTMLElement>(
    "highlighted",
    forwardedRef
  );

  React.useLayoutEffect(() => {
    const node = localRef.current;
    const container = containerRef.current;
    if (!node || !container) return;

    if (highlighted) {
      const rect = node.getBoundingClientRect();
      setRect(rect);
    }
  }, [highlighted, containerRef, setRect, localRef]);

  const Comp: React.ElementType = asChild ? React.Fragment : "div";

  const setNodeRef = (node: HTMLElement | null) => {
    (localRef as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  if (asChild) {
    const child =
      children as React.ReactElement<
        { className?: string } & React.RefAttributes<HTMLElement>
      >;
    return (
      <Comp>
        {React.cloneElement(child, {
          ref: setNodeRef,
          className: cn(className, child.props.className),
          ...props,
        })}
      </Comp>
    );
  }

  return (
    <div ref={setNodeRef} className={className} {...props}>
      {children}
    </div>
  );
});
