import type { AniiconomyReport, ChooseBlock, Item, Trade, TradeEntry } from "./report";
import rawReport from "./report.json";

export const report = rawReport as unknown as AniiconomyReport;
export type { Item, Trade, TradeEntry, ChooseBlock };

export function getItem(id: string): Item | undefined {
  return report.items[id];
}

export function getTrade(id: string): Trade | undefined {
  return report.trades[id];
}

export function itemName(id: string): string {
  return getItem(id)?.name ?? id;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatLimit(limit: Record<string, number | undefined>): string {
  return Object.entries(limit)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${v}/${k.replace("per_", "")}`)
    .join(", ");
}

export function fairPrice(id: string): number | undefined {
  return report.fair_prices[id];
}

/** Renders a trade's `out` field (a flat map, or a list of maps/CHOOSE blocks) as plain text. */
export function formatMap(map: Record<string, number>): string {
  return Object.entries(map)
    .map(([k, v]) => `${formatNumber(v)}× ${itemName(k)}`)
    .join(", ");
}

export function formatTradeOut(out: Trade["out"]): string {
  if (!Array.isArray(out)) return formatMap(out);
  return out
    .map((block) => {
      if ("CHOOSE" in block) {
        return `choose one of: ${(block as ChooseBlock).CHOOSE.map(formatMap).join(" / ")}`;
      }
      return formatMap(block);
    })
    .join("; ");
}

/** Resolves a CHOOSE branch pick to the item bundle it selects, via the trade's `out` array. */
export function resolveBranchPick(tradeId: string, block: number, index: number): string {
  const trade = getTrade(tradeId);
  const outBlock = Array.isArray(trade?.out) ? trade.out[block] : undefined;
  if (outBlock && "CHOOSE" in outBlock) {
    const option = (outBlock as ChooseBlock).CHOOSE[index];
    if (option) return formatMap(option);
  }
  return `option #${index}`;
}

export const itemIds = Object.keys(report.items);
export const tradeIds = Object.keys(report.trades);
export const valuableIds = itemIds.filter((id) => report.items[id].type === "valuable");

export const horizons = ["day", "week", "month", "season"] as const;

export function horizonLabel(h: string): string {
  return h.charAt(0).toUpperCase() + h.slice(1);
}

/** trade id -> value_index, a ratio where 1 (100%) is an exactly average deal. */
export const exchangeValueById: Record<string, number | null> = Object.fromEntries(
  report.exchange_value_index.map((e) => [e.id, e.value_index]),
);

export type ValueTone = "good" | "average" | "poor" | "unknown";

export function valueIndexTone(value: number | null | undefined): ValueTone {
  if (value == null) return "unknown";
  if (value >= 1.2) return "good";
  if (value >= 0.8) return "average";
  return "poor";
}

export function valueIndexLabel(value: number | null | undefined): string {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}
