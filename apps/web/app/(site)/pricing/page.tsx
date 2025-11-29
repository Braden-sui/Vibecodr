"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePlanGate } from "@/lib/usePlanGate";
import { Plan } from "@vibecodr/shared";
import { Check, Zap, Star, Users } from "lucide-react";
import { toast } from "@/lib/toast";

type PlanCard = {
  id: Plan;
  name: string;
  price: string;
  period: string;
  description: string;
  icon: typeof Zap;
  color: string;
  features: string[];
  cta: string;
  popular?: boolean;
  locked?: boolean;
};

const plans: PlanCard[] = [
  {
    id: Plan.FREE,
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for trying out Vibecodr",
    icon: Zap,
    color: "text-gray-600",
    features: [
      "Up to 5,000 plays/month",
      "Space for small personal vibes (1 GB storage)",
      "Apps up to 25 MB each",
      "Community support",
      "Basic analytics",
    ],
    cta: "Start for free",
  },
  {
    id: Plan.CREATOR,
    name: "Creator",
    price: "$12",
    period: "per month",
    description: "For active creators sharing apps",
    icon: Star,
    color: "text-blue-600",
    popular: true,
    features: [
      "Up to 50,000 plays/month",
      "Room for a growing library of vibes (10 GB storage)",
      "Apps up to 25 MB each",
      "Priority support",
      "Advanced analytics",
      "Custom domain",
    ],
    cta: "Upgrade to Creator",
  },
  {
    id: Plan.PRO,
    name: "Pro",
    price: "$49",
    period: "per month",
    description: "For professionals with larger projects",
    icon: Zap,
    color: "text-purple-600",
    features: [
      "Up to 250,000 plays/month",
      "Bigger vibes and projects (50 GB storage)",
      "Apps up to 100 MB each",
      "Priority support",
      "Advanced analytics",
      "Custom domain",
      "Private vibes",
      "Team collaboration (3 seats)",
    ],
    cta: "Upgrade to Pro",
  },
  {
    id: Plan.TEAM,
    name: "Team",
    price: "$199",
    period: "per month",
    description: "For teams building at scale",
    icon: Users,
    color: "text-orange-600",
    features: [
      "Up to 1,000,000 plays/month",
      "Shared workspace for teams (250 GB storage)",
      "Apps up to 250 MB each",
      "Dedicated support",
      "Custom analytics",
      "Custom domain",
      "Private vibes",
      "Unlimited team seats",
      "SSO & advanced security",
    ],
    cta: "Contact sales",
    locked: true,
  },
];

export default function PricingPage() {
  const { plan: currentPlan, isLoading } = usePlanGate();
  const isPaidSubscriber = currentPlan !== Plan.FREE;
  const currentPlanName = plans.find((p) => p.id === currentPlan)?.name ?? currentPlan;

  const handleUpgradeClick = (plan: PlanCard) => {
    if (plan.locked) {
      // Team plan - contact sales
      window.location.href = "mailto:sales@vibecodr.space?subject=Team%20Plan%20Inquiry";
      return;
    }
    // Show coming soon toast for other upgrade paths
    toast({
      title: "Billing coming soon",
      description: `Upgrades to ${plan.name} will be available soon. We'll notify you when self-service billing is ready.`,
    });
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-12 text-center space-y-3">
        <h1 className="text-4xl font-bold">Choose Your Plan</h1>
        <p className="text-lg text-muted-foreground">
          Pick a plan that matches how many vibes you publish and how often people play them.
        </p>
        {isPaidSubscriber && (
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
            Thanks for being a subscriber — you&apos;re on the {currentPlanName} plan.
          </div>
        )}
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = currentPlan === plan.id;
          const buttonLabel = isCurrent ? "Current plan" : plan.cta;

          return (
            <Card
              key={plan.name}
              className={`relative vc-surface border-0 ${
                plan.popular ? "ring-2 ring-blue-500 shadow-lg" : ""
              } ${isCurrent ? "outline outline-2 outline-primary/70" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-blue-500 text-white">Most Popular</Badge>
                </div>
              )}
              {isCurrent && !plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">Your plan</Badge>
                </div>
              )}

              <CardHeader>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${plan.color}`} />
                  <CardTitle>{plan.name}</CardTitle>
                </div>
                <div className="mb-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-muted-foreground"> / {plan.period}</span>}
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={plan.popular || isCurrent ? "default" : "outline"}
                  disabled={isCurrent || isLoading}
                  onClick={() => !isCurrent && handleUpgradeClick(plan)}
                >
                  {isLoading ? "Checking plan..." : buttonLabel}
                </Button>

                {isCurrent && (
                  <p className="text-center text-xs text-muted-foreground">Your current plan</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-16 space-y-8">
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold">All plans include</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="vc-surface border-0">
            <CardHeader>
              <CardTitle className="text-lg">Fast & Secure</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                All vibes run in sandboxed environments with strict security policies and no
                outbound network access (premium VM tiers coming soon).
              </p>
            </CardContent>
          </Card>

          <Card className="vc-surface border-0">
            <CardHeader>
              <CardTitle className="text-lg">Zero Egress Fees</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Powered by Cloudflare R2 for zero data transfer costs on all your runnable apps.
              </p>
            </CardContent>
          </Card>

          <Card className="vc-surface border-0">
            <CardHeader>
              <CardTitle className="text-lg">Built-in Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Track runs, performance metrics, and user engagement with built-in analytics for
                all vibes.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Need a custom plan?{" "}
            <a href="mailto:sales@vibecodr.space" className="text-blue-600 hover:underline">
              Contact sales
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
