// Plans by posts per month. Prices live in Lemon Squeezy; only the limits live here.

export interface Plan {
  id: string;
  name: string;
  postsPerMonth: number;
  sites: number;
  /** Posts are written with the customer's own Anthropic key. */
  ownKey: boolean;
}

export const PLANS: Record<string, Plan> = {
  trial: { id: "trial", name: "Trial", postsPerMonth: 2, sites: 1, ownKey: false },
  starter: { id: "starter", name: "Starter", postsPerMonth: 8, sites: 1, ownKey: false },
  growth: { id: "growth", name: "Growth", postsPerMonth: 30, sites: 5, ownKey: false },
  byok: { id: "byok", name: "Own key", postsPerMonth: 60, sites: 10, ownKey: true },
};

export const planFor = (id: string): Plan => PLANS[id] ?? PLANS.trial!;

export const month = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

/** Why a new post can't be written right now, or null when it can. */
export function blockedReason(plan: Plan, status: string, postsThisMonth: number, hasOwnKey: boolean): string | null {
  if (status !== "active" && status !== "on_trial") return "The subscription isn't active. Update billing to continue.";
  if (plan.ownKey && !hasOwnKey) return "This plan uses your own Anthropic key. Add it under Settings.";
  if (postsThisMonth >= plan.postsPerMonth)
    return `This month's ${plan.postsPerMonth} posts are used. Upgrade or wait until next month.`;
  return null;
}
