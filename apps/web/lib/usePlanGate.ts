"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Plan, hasFeature, hasPremiumAccess, type PlanFeatures } from "@vibecodr/shared";
import { quotaApi } from "./api";
import { trackClientError } from "./analytics";
import { useBuildAuthInit } from "./client-auth";

/**
 * Plan gate hook for checking premium feature access
 *
 * WHY: Studio power tools like advanced ZIP analysis are gated behind Creator/Pro/Team tiers.
 * This hook fetches the user's plan and provides feature access checks.
 * Server remains the single source of truth - this is for UX gating only.
 */
export interface UsePlanGateResult {
  plan: Plan;
  isLoading: boolean;
  error: string | null;
  isPremium: boolean;
  hasFeature: <K extends keyof PlanFeatures>(feature: K) => boolean;
  refetch: () => Promise<void>;
}

export function usePlanGate(): UsePlanGateResult {
  const { isSignedIn } = useAuth();
  const buildAuthInit = useBuildAuthInit();
  const [plan, setPlan] = useState<Plan>(Plan.FREE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    if (!isSignedIn) {
      setPlan(Plan.FREE);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const init = await buildAuthInit();
      const response = await quotaApi.getUserQuota(init);

      if (!response.ok) {
        throw new Error("Failed to fetch plan information");
      }

      const data = await response.json();
      if (data?.plan) {
        setPlan(data.plan as Plan);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch plan";
      setError(message);
      // Default to FREE on error for safety
      setPlan(Plan.FREE);
      trackClientError("E-VIBECODR-0907", {
        area: "planGate.fetch",
        message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [buildAuthInit, isSignedIn]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const checkFeature = useCallback(
    <K extends keyof PlanFeatures>(feature: K): boolean => {
      return hasFeature(plan, feature);
    },
    [plan]
  );

  return {
    plan,
    isLoading,
    error,
    isPremium: hasPremiumAccess(plan),
    hasFeature: checkFeature,
    refetch: fetchPlan,
  };
}

/**
 * Premium feature gate component props
 */
export interface PremiumGateProps {
  feature: keyof PlanFeatures;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}
