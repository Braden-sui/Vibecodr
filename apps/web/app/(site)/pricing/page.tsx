"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Star, Users } from "lucide-react";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for trying out Vibecodr",
    icon: Zap,
    color: "text-gray-600",
    features: [
      "25 MB bundle size",
      "5,000 runs/month",
      "1 GB storage",
      "Community support",
      "Basic analytics",
    ],
    cta: "Current Plan",
    disabled: true,
  },
  {
    name: "Creator",
    price: "$12",
    period: "per month",
    description: "For active creators sharing apps",
    icon: Star,
    color: "text-blue-600",
    popular: true,
    features: [
      "25 MB bundle size",
      "50,000 runs/month",
      "10 GB storage",
      "Priority support",
      "Advanced analytics",
      "Custom domain",
    ],
    cta: "Upgrade to Creator",
    disabled: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "per month",
    description: "For professionals with larger projects",
    icon: Zap,
    color: "text-purple-600",
    features: [
      "100 MB bundle size",
      "250,000 runs/month",
      "50 GB storage",
      "Priority support",
      "Advanced analytics",
      "Custom domain",
      "Private vibes",
      "Team collaboration (3 seats)",
    ],
    cta: "Upgrade to Pro",
    disabled: false,
  },
  {
    name: "Team",
    price: "$199",
    period: "per month",
    description: "For teams building at scale",
    icon: Users,
    color: "text-orange-600",
    features: [
      "250 MB bundle size",
      "1,000,000 runs/month",
      "250 GB storage",
      "Dedicated support",
      "Custom analytics",
      "Custom domain",
      "Private vibes",
      "Unlimited team seats",
      "SSO & advanced security",
    ],
    cta: "Upgrade to Team",
    disabled: true,
  },
];

export default function PricingPage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-12 text-center">
        <h1 className="mb-4 text-4xl font-bold">Choose Your Plan</h1>
        <p className="text-lg text-muted-foreground">
          Scale your runnable apps with the plan that fits your needs
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const Icon = plan.icon;
          return (
            <Card
              key={plan.name}
              className={`relative vc-surface border-0 ${plan.popular ? "ring-2 ring-blue-500 shadow-lg" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-blue-500 text-white">Most Popular</Badge>
                </div>
              )}

              <CardHeader>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${plan.color}`} />
                  <CardTitle>{plan.name}</CardTitle>
                </div>
                <div className="mb-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.period && (
                    <span className="text-muted-foreground"> / {plan.period}</span>
                  )}
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
                  variant={plan.popular ? "default" : "outline"}
                  disabled={plan.disabled}
                >
                  {plan.cta}
                </Button>

                {plan.disabled && (
                  <p className="text-center text-xs text-muted-foreground">
                    Your current plan
                  </p>
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
