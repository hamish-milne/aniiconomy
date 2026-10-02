import { Effect, OneOf, select, subscribe, type Reactive } from "pipis";
import {
  getItem,
  getTrade,
  formatNumber,
  formatLimit,
  formatTradeOut,
  resolveBranchPick,
  exchangeValueById,
  valueIndexTone,
  valueIndexLabel,
} from "../data";
import { report } from "../data";
import { hoverTarget, hoverItem, hoverTrade, clearHover } from "../state";
import type { ChooseBlock, Trade, TradeEntry } from "../data";

/** A compact, hoverable item pill; `onLeave` lets a containing row restore its own preview instead of clearing it. */
export function ItemChip({
  id,
  count,
  onLeave,
}: {
  id: string;
  count?: number;
  onLeave?: () => void;
}) {
  const item = getItem(id);
  return (
    <span
      onmouseenter={() => hoverItem(id)}
      onmouseleave={() => (onLeave ?? clearHover)()}
      className="inline-flex cursor-default items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-200 ring-1 ring-white/10 transition hover:bg-indigo-500/15 hover:ring-indigo-400/40"
    >
      <span>{item?.icon ?? "❔"}</span>
      {count !== undefined ? <span className="text-slate-400">{formatNumber(count)}×</span> : null}
      <span>{item?.name ?? id}</span>
    </span>
  );
}

export function MapChips({ map, onLeave }: { map: Record<string, number>; onLeave?: () => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(map).map(([id, qty]) => (
        <ItemChip id={id} count={qty} onLeave={onLeave} />
      ))}
    </div>
  );
}

/** Renders a trade's `out` field as chips: a flat bundle, or a row of bundles/CHOOSE groups. */
export function TradeOutChips({ out, onLeave }: { out: Trade["out"]; onLeave?: () => void }) {
  if (!Array.isArray(out)) return <MapChips map={out} onLeave={onLeave} />;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {out.map((block) => {
        if (!("CHOOSE" in block)) return <MapChips map={block} onLeave={onLeave} />;
        const options = (block as ChooseBlock).CHOOSE;
        return (
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/3 px-1.5 py-1 ring-1 ring-white/10">
            {[
              <span className="text-[10px] uppercase tracking-wide text-slate-500">choose</span>,
              ...options.flatMap((option, j) => [
                j > 0 ? <span className="text-slate-600">/</span> : null,
                <MapChips map={option} onLeave={onLeave} />,
              ]),
            ]}
          </div>
        );
      })}
    </div>
  );
}

function formatBranches(entry: TradeEntry | undefined): string {
  if (!entry?.branches?.length) return "";
  return entry.branches
    .map((branch) =>
      branch.picks
        .map((p) => `${resolveBranchPick(entry.id, branch.block, p.index)} ×${p.count}`)
        .join(", "),
    )
    .join("\n");
}

/**
 * Renders trade entry `index` of `trades`, reading live by index rather than taking a static
 * `TradeEntry` prop - `List` reuses the mounted row when the key repeats across updates (e.g. the
 * same trade leading two different plans), so a baked-in prop would go stale.
 */
export function TradeEntryRow({
  trades,
  index,
}: {
  trades: Reactive<TradeEntry[]>;
  index: number;
}) {
  const entry = select(trades, (arr) => arr[index]);
  const name = select(entry, (e) => (e ? (getTrade(e.id)?.name ?? e.id) : ""));
  const count = select(entry, (e) => (e ? formatNumber(e.count) : ""));
  const branchText = select(entry, formatBranches);
  let current: TradeEntry | undefined;

  return (
    <li
      onmouseenter={() => current && hoverTrade(current.id)}
      onmouseleave={clearHover}
      className="flex cursor-default flex-col gap-1.5 rounded-lg bg-white/3 px-3 py-2 ring-1 ring-white/5 transition hover:bg-white/7 hover:ring-indigo-400/20"
    >
      <Effect>{() => subscribe(entry, (e) => (current = e))}</Effect>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-100">{name}</span>
        <span className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300 ring-1 ring-indigo-400/20">
          ×{count}
        </span>
      </div>
      <div className="flex flex-col gap-1 pl-1 text-[11px] whitespace-pre-line text-slate-500 empty:hidden">
        {branchText}
      </div>
    </li>
  );
}

function tradeLimitText(trade: {
  per_day?: number;
  per_week?: number;
  per_month?: number;
  per_season?: number;
}): string {
  return (
    formatLimit({
      per_day: trade.per_day,
      per_week: trade.per_week,
      per_month: trade.per_month,
      per_season: trade.per_season,
    }) || "No acquisition limit"
  );
}

export function PreviewPanel() {
  const visible = select(hoverTarget, (t) => t !== null);
  const kind = select(hoverTarget, (t) => t?.kind ?? "none");

  // Kept stable while the hover kind is unchanged, so hovering between items/trades of the same
  // kind updates text in place instead of remounting the preview card.
  const itemId = select(hoverTarget, (t) => (t?.kind === "item" ? t.id : ""));
  const itemIcon = select(itemId, (id) => getItem(id)?.icon ?? "");
  const itemName = select(itemId, (id) => getItem(id)?.name ?? "");
  const itemType = select(itemId, (id) => getItem(id)?.type ?? "");
  // Label folded into the text itself (rather than a nested span) so `empty:hidden` can hide the
  // whole line based on the <p>'s own text-node content.
  const itemPriceText = select(itemId, (id) => {
    const price = report.fair_prices[id];
    return price !== undefined ? `Fair price: ${formatNumber(price)}` : "";
  });
  const itemLimitText = select(itemId, (id) => {
    const limit = getItem(id)?.acquisition_limit;
    return limit ? `Limit: ${formatLimit(limit)}` : "";
  });

  const tradeId = select(hoverTarget, (t) => (t?.kind === "trade" ? t.id : ""));
  const tradeName = select(tradeId, (id) => getTrade(id)?.name ?? "");
  const tradeInText = select(tradeId, (id) => {
    const trade = getTrade(id);
    return trade?.in ? `In: ${formatTradeOut(trade.in)}` : "";
  });
  const tradeOutText = select(tradeId, (id) => {
    const trade = getTrade(id);
    return trade ? `Out: ${formatTradeOut(trade.out)}` : "";
  });
  const tradeLimit = select(tradeId, (id) => {
    const trade = getTrade(id);
    return trade ? tradeLimitText(trade) : "";
  });
  const tradeValueTone = select(tradeId, (id) => valueIndexTone(exchangeValueById[id]));
  const tradeValueLabel = select(tradeId, (id) => valueIndexLabel(exchangeValueById[id]));

  return (
    <div
      data-visible={visible}
      className="pointer-events-none fixed bottom-6 right-6 z-50 w-80 translate-y-4 scale-95 opacity-0 transition-all duration-300 ease-out data-visible:translate-y-0 data-visible:scale-100 data-visible:opacity-100"
    >
      <OneOf selector={kind}>
        {{
          item: (
            <div className="card-glow rounded-2xl bg-slate-900/90 p-4 ring-1 ring-indigo-400/20 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-lg">
                <span>{itemIcon}</span>
                <span className="font-semibold text-white">{itemName}</span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-indigo-300/70 empty:hidden">
                {itemType}
              </p>
              <p className="mt-2 text-sm font-medium text-amber-300 empty:hidden">
                {itemPriceText}
              </p>
              <p className="mt-1 text-xs text-slate-500 empty:hidden">{itemLimitText}</p>
            </div>
          ),
          trade: (
            <div className="card-glow rounded-2xl bg-slate-900/90 p-4 ring-1 ring-indigo-400/20 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-white">{tradeName}</p>
                <span
                  data-tone={tradeValueTone}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset data-[tone=good]:bg-emerald-500/10 data-[tone=good]:text-emerald-300 data-[tone=good]:ring-emerald-400/30 data-[tone=average]:bg-amber-500/10 data-[tone=average]:text-amber-300 data-[tone=average]:ring-amber-400/30 data-[tone=poor]:bg-rose-500/10 data-[tone=poor]:text-rose-300 data-[tone=poor]:ring-rose-400/30 data-[tone=unknown]:bg-white/5 data-[tone=unknown]:text-slate-400 data-[tone=unknown]:ring-white/10"
                >
                  {tradeValueLabel}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400 empty:hidden">{tradeInText}</p>
              <p className="mt-1 text-xs text-slate-400">{tradeOutText}</p>
              <p className="mt-1 text-[11px] text-slate-500">{tradeLimit}</p>
            </div>
          ),
          none: <span />,
        }}
      </OneOf>
    </div>
  );
}
