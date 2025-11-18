"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { Flag, AlertTriangle } from "lucide-react";
import { moderationApi } from "@/lib/api";

interface ReportButtonProps {
  targetType: "post" | "comment";
  targetId: string;
  variant?: "icon" | "text";
  className?: string;
}

const REPORT_REASONS = [
  { value: "spam", label: "Spam or misleading" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "copyright", label: "Copyright violation" },
  { value: "other", label: "Other" },
];

export function ReportButton({ targetType, targetId, variant = "icon", className }: ReportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!reason) return;

    setIsSubmitting(true);
    try {
      const response = await moderationApi.report({
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        let errorBody: any = null;
        try {
          errorBody = await response.json();
        } catch (error) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0506 submit report error JSON parse failed", {
              targetType,
              targetId,
              status: response.status,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const description =
          errorBody && typeof errorBody.error === "string"
            ? errorBody.error
            : "Failed to submit report";
        throw new Error(description);
      }

      setSubmitted(true);
      setTimeout(() => {
        setIsOpen(false);
        setSubmitted(false);
        setReason("");
        setDetails("");
      }, 2000);
    } catch (error) {
      console.error("Failed to submit report:", error);
      toast({ title: "Failed to submit report", description: error instanceof Error ? error.message : "Unknown error", variant: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon" className={className}>
            <Flag className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className={className}>
            <Flag className="h-3 w-3 mr-1" />
            Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        {submitted ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <AlertTriangle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <DialogTitle className="mb-2">Report Submitted</DialogTitle>
            <DialogDescription>
              Thank you for helping keep Vibecodr safe. Our moderation team will review this report.
            </DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report {targetType === "post" ? "Post" : "Comment"}</DialogTitle>
              <DialogDescription>
                Help us maintain a safe and respectful community. Reports are reviewed by our moderation team.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reason">Reason *</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id="reason">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="details">Additional details (optional)</Label>
                <Textarea
                  id="details"
                  placeholder="Provide any additional context that might help our review..."
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">{details.length}/500</p>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20 p-3">
                <p className="text-xs text-orange-800 dark:text-orange-200">
                  <strong>Note:</strong> False reports may result in account restrictions. Please only report content that violates our community guidelines.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!reason || isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit Report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
