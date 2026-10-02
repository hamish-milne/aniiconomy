import { itemIds, getItem, formatLimit } from "../data";
import { hoverItem, clearHover } from "../state";

export function ItemsTab() {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
        Items ({itemIds.length})
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {itemIds.map((id) => {
          const item = getItem(id)!;
          return (
            <div
              onmouseenter={() => hoverItem(id)}
              onmouseleave={clearHover}
              className="flex items-start gap-3 rounded-xl bg-white/3 p-3 ring-1 ring-white/5 transition hover:bg-white/7 hover:ring-indigo-400/30"
            >
              <span className="text-xl">{item.icon}</span>
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-100">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {item.type ?? "resource"}
                  {item.acquisition_limit ? ` · limit ${formatLimit(item.acquisition_limit)}` : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
