"use client";

import { useState, useEffect } from "react";
import { useBuildAuthInit } from "@/lib/client-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { quotaApi } from "@/lib/api";
import { Plan, UserQuotaResponseSchema, type UserQuotaResponse } from "@vibecodr/shared";

export function QuotaUsage() {
  const buildAuthInit = useBuildAuthInit();
  const [quota, setQuota] = useState<UserQuotaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchQuota = async () => {
    try {
      const init = await buildAuthInit();
      const response = await quotaApi.getUserQuota(init);

      if (!response.ok) throw new Error("Failed to fetch quota");

      const data = await response.json();
      const parsed = UserQuotaResponseSchema.parse(data);
      setQuota(parsed);
    } catch (error) {
      const shouldLogError = typeof process === "undefined" || process.env.NODE_ENV !== "test";
      if (shouldLogError && typeof console !== "undefined" && typeof console.error === "function") {
        console.error("Failed to fetch quota:", error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  const getPercentage = (used: number, limit: number): number => {
    return Math.min(100, (used / limit) * 100);
  };

  const getProgressColor = (percentage: number): string => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 75) return "bg-orange-500";
    return "bg-blue-500";
  };

  const getPlanBadgeColor = (plan: Plan): string => {
    switch (plan) {
      case Plan.FREE:
        return "bg-gray-500";
      case Plan.CREATOR:
        return "bg-blue-500";
      case Plan.PRO:
        return "bg-purple-500";
      case Plan.TEAM:
        return "bg-gradient-to-r from-yellow-500 to-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage & Quota</CardTitle>
          <CardDescription>Loading your usage statistics...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!quota) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage & Quota</CardTitle>
          <CardDescription>Failed to load quota information</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const storagePercent = getPercentage(quota.usage.storage, quota.limits.maxStorage);
  const runsPercent = getPercentage(quota.usage.runs, quota.limits.maxRuns);
  const needsUpgrade = storagePercent >= 80 || runsPercent >= 80;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Usage & Quota</CardTitle>
          <CardDescription>Your current plan and usage</CardDescription>
        </div>
        <Badge className={`${getPlanBadgeColor(quota.plan)} text-white`}>
          {quota.plan.toUpperCase()}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Storage Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Storage</span>
            <span className="text-muted-foreground">
              {formatBytes(quota.usage.storage)} / {formatBytes(quota.limits.maxStorage)}
            </span>
          </div>
          <Progress
            value={storagePercent}
            className="h-2"
            indicatorClassName={getProgressColor(storagePercent)}
          />
          {storagePercent >= 75 && (
            <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {storagePercent >= 90
                ? "Storage nearly full! Upgrade to continue."
                : `You've used ${storagePercent.toFixed(0)}% of your storage.`}
            </p>
          )}
        </div>

        {/* Runs Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Runs (this month)</span>
            <span className="text-muted-foreground">
              {formatNumber(quota.usage.runs)} / {formatNumber(quota.limits.maxRuns)}
            </span>
          </div>
          <Progress
            value={runsPercent}
            className="h-2"
            indicatorClassName={getProgressColor(runsPercent)}
          />
          {runsPercent >= 75 && (
            <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {runsPercent >= 90
                ? "Play limit nearly reached! Upgrade for more plays."
                : `You've used ${runsPercent.toFixed(0)}% of your monthly plays.`}
            </p>
          )}
        </div>

        {/* Bundle Size Limit */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Max Vibe Size</span>
            <span className="text-muted-foreground">
              {formatBytes(quota.limits.maxBundleSize)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Maximum size for a single vibe upload
          </p>
        </div>

        {/* Upgrade CTA */}
        {needsUpgrade && quota.plan !== Plan.TEAM && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20 p-4">
            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5" />
              <div className="flex-1 space-y-2">
                <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-100">
                  Running low on resources
                </h4>
                <p className="text-xs text-orange-800 dark:text-orange-200">
                  Upgrade your plan to get more storage, plays, and room for bigger apps.
                </p>
                <Link to="/pricing">
                  <Button size="sm" className="gap-1">
                    <Zap className="h-3 w-3" />
                    Upgrade Plan
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Plan benefits */}
        {quota.plan === Plan.FREE && !needsUpgrade && (
          <div className="text-center text-sm text-muted-foreground">
            <Link to="/pricing" className="text-blue-600 dark:text-blue-400 hover:underline">
              Upgrade to Creator
            </Link>{" "}
            for 10x more plays (50k/month)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
