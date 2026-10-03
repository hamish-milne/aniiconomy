import { Effect, If, OneOf, select, subscribe, type Reactive } from "pipis";
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
  fairPrice,
} from "../data";
import { hoverTarget, hoverItem, hoverTrade, clearHover } from "../state";
import type { ChooseBlock, Item, Trade, TradeEntry } from "../data";

/** Formats a fair price, showing the inverse rate on a separate muted line when the price is below 1. */
export function FairPriceValue({ price }: { price: Reactive<number> }) {
  const priceText = select(price, (p) => formatNumber(p));
  const inverseText = select(price, (p) =>
    p > 0 && p < 1 ? `1 money ≈ ${formatNumber(1 / p)}` : "",
  );
  return (
    <>
      <span className="font-medium text-amber-300">{priceText}</span>
      <span className="ml-1.5 text-slate-500 empty:hidden">{inverseText}</span>
    </>
  );
}

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

/** Item half of the hover preview; scoped to its own narrowed `id` so all selects live here. */
const EMPTY_ITEM: Item = { name: "", icon: "" };

function ItemPreview({ id }: { id: Reactive<string> }) {
  const item = select(id, (i) => getItem(i) ?? EMPTY_ITEM);
  const icon = select(item, "icon");
  const name = select(item, "name");
  const type = select(item, "type");
  const hasPrice = select(id, (i) => fairPrice(i) !== undefined);
  const price = select(id, (i) => fairPrice(i) ?? 0);
  const limitText = select(item, (i) =>
    i.acquisition_limit ? `Limit: ${formatLimit(i.acquisition_limit)}` : "",
  );

  return (
    <div className="card-glow rounded-2xl bg-slate-900/90 p-4 ring-1 ring-indigo-400/20 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-lg">
        <span>{icon}</span>
        <span className="font-semibold text-white">{name}</span>
      </div>
      <p className="mt-1 text-xs uppercase tracking-wide text-indigo-300/70 empty:hidden">{type}</p>
      <If condition={hasPrice}>
        <p className="mt-2 text-sm">
          <span className="text-slate-400">Fair price: </span>
          <FairPriceValue price={price} />
        </p>
      </If>
      <p className="mt-1 text-xs text-slate-500 empty:hidden">{limitText}</p>
    </div>
  );
}

/** Trade half of the hover preview; scoped to its own narrowed `id` so all selects live here. */
const EMPTY_TRADE: Trade = { name: "", out: {} };

function TradePreview({ id }: { id: Reactive<string> }) {
  const trade = select(id, (i) => getTrade(i) ?? EMPTY_TRADE);
  const name = select(trade, "name");
  const inText = select(trade, (t) => (t.in ? `In: ${formatTradeOut(t.in)}` : ""));
  const outText = select(trade, (t) => `Out: ${formatTradeOut(t.out)}`);
  const limitText = select(trade, tradeLimitText);
  const tone = select(id, (i) => valueIndexTone(exchangeValueById[i]));
  const label = select(id, (i) => valueIndexLabel(exchangeValueById[i]));

  return (
    <div className="card-glow rounded-2xl bg-slate-900/90 p-4 ring-1 ring-indigo-400/20 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-white">{name}</p>
        <span
          data-tone={tone}
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset data-[tone=good]:bg-emerald-500/10 data-[tone=good]:text-emerald-300 data-[tone=good]:ring-emerald-400/30 data-[tone=average]:bg-amber-500/10 data-[tone=average]:text-amber-300 data-[tone=average]:ring-amber-400/30 data-[tone=poor]:bg-rose-500/10 data-[tone=poor]:text-rose-300 data-[tone=poor]:ring-rose-400/30 data-[tone=unknown]:bg-white/5 data-[tone=unknown]:text-slate-400 data-[tone=unknown]:ring-white/10"
        >
          {label}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-400 empty:hidden">{inText}</p>
      <p className="mt-1 text-xs text-slate-400">{outText}</p>
      <p className="mt-1 text-[11px] text-slate-500">{limitText}</p>
    </div>
  );
}

export function PreviewPanel() {
  const visible = select(hoverTarget, (t) => t !== null);
  const kind = select(hoverTarget, (t) => t?.kind ?? "none");

  // Kept stable (dummy "" value) while the hover kind doesn't match, so hovering between
  // items/trades of the same kind updates the scoped preview in place instead of remounting it.
  const itemId = select(hoverTarget, (t) => (t?.kind === "item" ? t.id : ""));
  const tradeId = select(hoverTarget, (t) => (t?.kind === "trade" ? t.id : ""));

  return (
    <div
      data-visible={visible}
      className="pointer-events-none fixed bottom-6 right-6 z-50 w-80 translate-y-4 scale-95 opacity-0 transition-all duration-300 ease-out data-visible:translate-y-0 data-visible:scale-100 data-visible:opacity-100"
    >
      <OneOf selector={kind}>
        {{
          item: <ItemPreview id={itemId} />,
          trade: <TradePreview id={tradeId} />,
          none: <span />,
        }}
      </OneOf>
    </div>
  );
}
