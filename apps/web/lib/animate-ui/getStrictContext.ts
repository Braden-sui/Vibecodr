 "use client";

import * as React from "react";

// WHY: Reusable helper for React contexts that fail fast when used outside their Provider.
// This lives in animate-ui so future components can share strict context wiring, even if
// there are periods where no direct callers exist.
export function getStrictContext<T>(name?: string) {
  const Context = React.createContext<T | undefined>(undefined);

  type ProviderProps = {
    value: T;
    children?: React.ReactNode;
  };

  const Provider = ({ value, children }: ProviderProps) => {
    return React.createElement(Context.Provider, { value }, children);
  };

  const useStrictContext = () => {
    const context = React.useContext(Context);
    if (context === undefined) {
      const label = name ?? "Context";
      throw new Error(`${label} must be used within its Provider`);
    }
    return context;
  };

  return [Provider, useStrictContext] as const;
}

