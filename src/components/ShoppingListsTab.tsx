import { reactive, select, List, OneOf, type Reactive } from "pipis";
import { report, getItem, formatMoney, formatNumber, horizonLabel, valuableIds } from "../data";
import { TradeEntryRow } from "./Shared";
import { hoverItem, clearHover } from "../state";
import type { ShoppingPlan } from "../report";

type Sel = { valuable: string; budget: number; horizon: string };

function firstPlans(id: string) {
  return report.shopping_lists[id] ?? [];
}

function isEmptyPlan(plan: ShoppingPlan | undefined): boolean {
  return !plan || plan.trades.length === 0 || plan.quantity === 0;
}

/** Prefers `preferred` if it's a usable (non-empty) plan, else the first non-empty plan, else just the first. */
function pickHorizon(plans: ShoppingPlan[], preferred?: string): string {
  const byPreferred = plans.find((p) => p.horizon === preferred);
  if (byPreferred && !isEmptyPlan(byPreferred)) return byPreferred.horizon;
  return (plans.find((p) => !isEmptyPlan(p)) ?? plans[0])?.horizon ?? preferred ?? "day";
}

/** Scoped to the narrowed current plan so its selects aren't mixed into the tab's top-level state. */
function ReadyShoppingPlan({ plan }: { plan: Reactive<ShoppingPlan> }) {
  const moneySpent = select(plan, (p) => formatMoney(p.money_spent));
  const quantity = select(plan, (p) => formatNumber(p.quantity));
  const trades = select(plan, (p) => p.trades);
  return (
    <div className="space-y-3 rounded-xl bg-white/2 p-4 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <span>
          Spent: <strong className="text-white">{moneySpent}</strong>
        </span>
        <span>
          Yields: <strong className="text-white">{quantity}×</strong>
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

/** Shown only while `status` is "empty" - never read for real data, just keeps the prop type non-optional. */
const EMPTY_SHOPPING_PLAN: ShoppingPlan = {
  horizon: "day",
  money_spent: 0,
  quantity: 0,
  trades: [],
};

/** Shows the current plan, or a fallback message when the budget/horizon combination yields nothing. */
function ShoppingPlanPanel({ plan }: { plan: Reactive<ShoppingPlan | undefined> }) {
  const status = select(plan, (p) => (p ? "ready" : "empty") as "ready" | "empty");
  const readyPlan = select(plan, (p) => p ?? EMPTY_SHOPPING_PLAN);
  return (
    <OneOf selector={status}>
      {{
        ready: <ReadyShoppingPlan plan={readyPlan} />,
        empty: <p className="text-sm text-slate-500">No plan available for this combination.</p>,
      }}
    </OneOf>
  );
}

export function ShoppingListsTab() {
  const valuables = valuableIds.filter((id) => firstPlans(id).length > 0);
  const firstValuable = valuables[0];
  const firstBudget = firstPlans(firstValuable)[0];

  const sel = reactive<Sel>({
    valuable: firstValuable,
    budget: firstBudget?.budget ?? 0,
    horizon: pickHorizon(firstBudget?.plans ?? []),
  });

  function selectValuable(id: string) {
    const plans = firstPlans(id);
    const budget = plans[0]?.budget ?? 0;
    sel.value = {
      valuable: id,
      budget,
      horizon: pickHorizon(plans[0]?.plans ?? []),
    };
  }

  function selectBudget(budget: number) {
    const current = sel.value;
    const plans = firstPlans(current.valuable).find((bp) => bp.budget === budget)?.plans ?? [];
    sel.value = { ...current, budget, horizon: pickHorizon(plans, current.horizon) };
  }

  function selectHorizon(horizon: string) {
    sel.value = { ...sel.value, horizon };
  }

  const budgetsForValuable = select(sel, (s) => firstPlans(s.valuable).map((bp) => bp.budget));
  const plansForBudget = select(
    sel,
    (s) => firstPlans(s.valuable).find((bp) => bp.budget === s.budget)?.plans ?? [],
  );
  const horizonsForBudget = select(plansForBudget, (plans) => plans.map((p) => p.horizon));
  const currentPlan = select(sel, (s) => {
    const plans = firstPlans(s.valuable).find((bp) => bp.budget === s.budget)?.plans ?? [];
    return plans.find((p) => p.horizon === s.horizon) ?? plans[0];
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">Item</h3>
        <div className="flex flex-wrap gap-2">
          {valuables.map((id) => {
            const item = getItem(id)!;
            const active = select(sel, (s) => s.valuable === id);
            return (
              <button
                onclick={() => selectValuable(id)}
                onmouseenter={() => hoverItem(id)}
                onmouseleave={clearHover}
                data-active={active}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 data-active:bg-indigo-500/20 data-active:text-indigo-200 data-active:ring-indigo-400/40"
              >
                <span>{item.icon}</span>
                <span>{item.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          Budget
        </h3>
        <div className="flex flex-wrap gap-2">
          <List items={budgetsForValuable} itemKey={(b) => b}>
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
                  firstPlans(s.valuable)
                    .find((bp) => bp.budget === s.budget)
                    ?.plans.find((p) => p.horizon === h),
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

      <ShoppingPlanPanel plan={currentPlan} />
    </div>
  );
}
