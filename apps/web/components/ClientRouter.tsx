"use client";

import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

export function ClientRouter({ children }: { children: ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>;
}
