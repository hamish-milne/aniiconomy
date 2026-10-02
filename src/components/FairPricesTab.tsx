import { report, formatNumber } from "../data";
import { hoverItem, clearHover } from "../state";

export function FairPricesTab() {
  const rows = Object.keys(report.fair_prices)
    .filter((id) => report.items[id])
    .sort((a, b) => report.fair_prices[b] - report.fair_prices[a]);

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
        Fair prices ({report.time_horizon})
      </h2>
      <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-white/5">
            {rows.map((id) => {
              const item = report.items[id];
              return (
                <tr
                  onmouseenter={() => hoverItem(id)}
                  onmouseleave={clearHover}
                  className="cursor-default transition hover:bg-white/4"
                >
                  <td className="w-10 px-3 py-2 text-lg">{item.icon}</td>
                  <td className="px-3 py-2 text-slate-200">{item.name}</td>
                  <td className="px-3 py-2 text-right font-medium text-amber-300">
                    {formatNumber(report.fair_prices[id])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
