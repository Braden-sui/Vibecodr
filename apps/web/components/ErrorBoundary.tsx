"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary to prevent white screen crashes.
 * Catches unhandled errors in the React tree and displays a recovery UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console for debugging
    console.error("E-VIBECODR-0001 Uncaught error in React tree", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="max-w-md space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              An unexpected error occurred. Try refreshing the page or going back to the home page.
            </p>
            {this.state.error && (
              <details className="rounded-lg border bg-muted/50 p-3 text-left text-xs">
                <summary className="cursor-pointer font-medium">Error details</summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-destructive">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex justify-center gap-3">
              <Button onClick={this.handleReset} variant="outline" className="gap-2">
                Try again
              </Button>
              <Button onClick={this.handleReload} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
