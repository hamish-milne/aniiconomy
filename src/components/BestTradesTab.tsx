import { reactive, select, List, OneOf, type Reactive } from "pipis";
import { report, formatMoney, formatNumber, horizonLabel } from "../data";
import { TradeEntryRow } from "./Shared";
import type { BestValuePlan } from "../report";

type Sel = { budget: number; horizon: string };

function isEmptyPlan(plan: BestValuePlan | undefined): boolean {
  return !plan || plan.trades.length === 0 || plan.value === 0;
}

function pickHorizon(plans: BestValuePlan[], preferred?: string): string {
  const byPreferred = plans.find((p) => p.horizon === preferred);
  if (byPreferred && !isEmptyPlan(byPreferred)) return byPreferred.horizon;
  return (plans.find((p) => !isEmptyPlan(p)) ?? plans[0])?.horizon ?? preferred ?? "day";
}

/** Shown only while `status` is "empty" - never read for real data, just keeps the prop type non-optional. */
const EMPTY_BEST_VALUE_PLAN: BestValuePlan = {
  horizon: "day",
  money_spent: 0,
  value: 0,
  trades: [],
};

/** Scoped to the narrowed current plan so its selects aren't mixed into the tab's top-level state. */
function ReadyBestTradesPlan({ plan }: { plan: Reactive<BestValuePlan> }) {
  const moneySpent = select(plan, (p) => formatMoney(p.money_spent));
  const value = select(plan, (p) => formatNumber(p.value));
  const trades = select(plan, (p) => p.trades);
  return (
    <div className="space-y-3 rounded-xl bg-white/2 p-4 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <span>
          Spent: <strong className="text-white">{moneySpent}</strong>
        </span>
        <span>
          Value: <strong className="text-amber-300">{value}</strong>
        </span>
      </div>
      <ul className="space-y-1.5">
        <List items={trades} itemKey={(_entry, i) => i}>
          {(_entry, i) => <TradeEntryRow trades={trades} index={i} />}
        </List>
      </ul>
    </div>
  );
}

/** Shows the current plan, or a fallback message when the budget/horizon combination yields nothing. */
function BestTradesPlanPanel({ plan }: { plan: Reactive<BestValuePlan | undefined> }) {
  const status = select(plan, (p) => (p ? "ready" : "empty") as "ready" | "empty");
  const readyPlan = select(plan, (p) => p ?? EMPTY_BEST_VALUE_PLAN);
  return (
    <OneOf selector={status}>
      {{
        ready: <ReadyBestTradesPlan plan={readyPlan} />,
        empty: <p className="text-sm text-slate-500">No plan available for this combination.</p>,
      }}
    </OneOf>
  );
}

export function BestTradesTab() {
  const groups = report.overall_best_trades;
  const firstGroup = groups[0];

  const sel = reactive<Sel>({
    budget: firstGroup?.budget ?? 0,
    horizon: pickHorizon(firstGroup?.plans ?? []),
  });

  function selectBudget(budget: number) {
    const current = sel.value;
    const plans = groups.find((g) => g.budget === budget)?.plans ?? [];
    sel.value = { budget, horizon: pickHorizon(plans, current.horizon) };
  }

  function selectHorizon(horizon: string) {
    sel.value = { ...sel.value, horizon };
  }

  const budgets = select(sel, () => groups.map((g) => g.budget));
  const plansForBudget = select(sel, (s) => groups.find((g) => g.budget === s.budget)?.plans ?? []);
  const horizonsForBudget = select(plansForBudget, (plans) => plans.map((p) => p.horizon));
  const currentPlan = select(sel, (s) => {
    const plans = groups.find((g) => g.budget === s.budget)?.plans ?? [];
    return plans.find((p) => p.horizon === s.horizon) ?? plans[0];
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          Budget
        </h3>
        <div className="flex flex-wrap gap-2">
          <List items={budgets} itemKey={(b) => b}>
            {(budget) => {
              const active = select(sel, (s) => s.budget === budget);
              return (
                <button
                  onclick={() => selectBudget(budget)}
                  data-active={active}
                  className="rounded-full bg-white/5 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 data-active:bg-indigo-500/20 data-active:text-indigo-200 data-active:ring-indigo-400/40"
                >
                  {formatMoney(budget)}
                </button>
              );
            }}
          </List>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          Horizon
        </h3>
        <div className="flex flex-wrap gap-2">
          <List items={horizonsForBudget} itemKey={(h) => h}>
            {(h) => {
              const active = select(sel, (s) => s.horizon === h);
              const disabled = select(sel, (s) =>
                isEmptyPlan(
                  groups.find((g) => g.budget === s.budget)?.plans.find((p) => p.horizon === h),
                ),
              );
              return (
                <button
                  onclick={() => selectHorizon(h)}
                  disabled={disabled}
                  data-active={active}
                  className="rounded-full bg-white/5 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 data-active:bg-indigo-500/20 data-active:text-indigo-200 data-active:ring-indigo-400/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/5"
                >
                  {horizonLabel(h)}
                </button>
              );
            }}
          </List>
        </div>
      </section>

      <BestTradesPlanPanel plan={currentPlan} />
    </div>
  );
}
