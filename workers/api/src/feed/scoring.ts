import { Plan, normalizePlan } from "@vibecodr/shared";

export type ForYouScoreInput = {
  createdAtSec: number;
  nowSec: number;
  stats: { runs: number; likes: number; remixes: number };
  authorFollowers: number;
  authorIsFeatured: boolean;
  authorPlan?: Plan | null;
  hasCapsule: boolean;
};

export function computeForYouScore(input: ForYouScoreInput): number {
  const ageHours = Math.max(0, (input.nowSec - input.createdAtSec) / 3600);
  const recencyDecay = Math.exp(-ageHours / 72); // ~3-day half-life
  const log1p = (n: number) => Math.log(1 + Math.max(0, n));

  const plan =
    input.authorPlan != null ? normalizePlan(input.authorPlan, Plan.FREE) : null;
  const featuredBoost = input.authorIsFeatured ? 0.05 : 0;
  const planBoost = plan === Plan.PRO || plan === Plan.TEAM ? 0.03 : 0;
  const capsuleBoost = input.hasCapsule ? 0.1 : 0;

  return (
    0.45 * recencyDecay +
    0.2 * log1p(input.stats.runs) +
    0.15 * log1p(input.stats.likes) +
    0.1 * log1p(input.stats.remixes) +
    0.05 * log1p(input.authorFollowers) +
    capsuleBoost +
    featuredBoost +
    planBoost
  );
}
