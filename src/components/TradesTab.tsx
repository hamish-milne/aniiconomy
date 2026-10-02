import {
  tradeIds,
  getTrade,
  formatTradeOut,
  formatLimit,
  exchangeValueById,
  valueIndexTone,
  valueIndexLabel,
} from "../data";
import { hoverTrade, clearHover } from "../state";

export function TradesTab() {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
        Trades ({tradeIds.length})
      </h2>
      <div className="space-y-2">
        {tradeIds.map((id) => {
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
            <div
              onmouseenter={() => hoverTrade(id)}
              onmouseleave={clearHover}
              className="cursor-default rounded-xl bg-white/3 p-3 ring-1 ring-white/5 transition hover:bg-white/7 hover:ring-indigo-400/30"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">{trade.name}</p>
                <span
                  data-tone={tone}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset data-[tone=good]:bg-emerald-500/10 data-[tone=good]:text-emerald-300 data-[tone=good]:ring-emerald-400/30 data-[tone=average]:bg-amber-500/10 data-[tone=average]:text-amber-300 data-[tone=average]:ring-amber-400/30 data-[tone=poor]:bg-rose-500/10 data-[tone=poor]:text-rose-300 data-[tone=poor]:ring-rose-400/30 data-[tone=unknown]:bg-white/5 data-[tone=unknown]:text-slate-400 data-[tone=unknown]:ring-white/10"
                >
                  {label}
                </span>
              </div>
              {trade.in ? (
                <p className="mt-1 text-xs text-slate-400">In: {formatTradeOut(trade.in)}</p>
              ) : (
                null
              )}
              <p className="mt-1 text-xs text-slate-400">Out: {formatTradeOut(trade.out)}</p>
              {limit ? <p className="mt-1 text-[11px] text-slate-500">Limit: {limit}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
