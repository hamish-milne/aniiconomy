import {
  tradeIds,
  getTrade,
  formatLimit,
  exchangeValueById,
  valueIndexTone,
  valueIndexLabel,
} from "../data";
import { MapChips, TradeOutChips } from "./Shared";

const sortedTradeIds = [...tradeIds].sort((a, b) => {
  const av = exchangeValueById[a];
  const bv = exchangeValueById[b];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return bv - av;
});

export function TradesTab() {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
        Trades ({tradeIds.length})
      </h2>
      <div className="space-y-2">
        {sortedTradeIds.map((id) => {
          const trade = getTrade(id)!;
          const limit = formatLimit({
            per_day: trade.per_day,
            per_week: trade.per_week,
            per_month: trade.per_month,
            per_season: trade.per_season,
          });
          const tone = valueIndexTone(exchangeValueById[id]);
          const label = valueIndexLabel(exchangeValueById[id]);
          return (
            <div className="rounded-xl bg-white/3 p-3 ring-1 ring-white/5 transition hover:bg-white/7 hover:ring-indigo-400/30">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">{trade.name}</p>
                <span
                  data-tone={tone}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset data-[tone=good]:bg-emerald-500/10 data-[tone=good]:text-emerald-300 data-[tone=good]:ring-emerald-400/30 data-[tone=average]:bg-amber-500/10 data-[tone=average]:text-amber-300 data-[tone=average]:ring-amber-400/30 data-[tone=poor]:bg-rose-500/10 data-[tone=poor]:text-rose-300 data-[tone=poor]:ring-rose-400/30 data-[tone=unknown]:bg-white/5 data-[tone=unknown]:text-slate-400 data-[tone=unknown]:ring-white/10"
                >
                  {label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {trade.in ? (
                  <>
                    <MapChips map={trade.in} />
                    <span className="text-xs text-slate-500">→</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">Free →</span>
                )}
                <TradeOutChips out={trade.out} />
              </div>
              {limit ? <p className="mt-2 text-[11px] text-slate-500">Limit: {limit}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
