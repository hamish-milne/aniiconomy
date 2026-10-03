import { select, OneOf } from "pipis";
import { activeTab, type TabId } from "./state";
import { ShoppingListsTab } from "./components/ShoppingListsTab";
import { BestTradesTab } from "./components/BestTradesTab";
import { FairPricesTab } from "./components/FairPricesTab";
import { ItemsTab } from "./components/ItemsTab";
import { TradesTab } from "./components/TradesTab";
import { AboutTab } from "./components/AboutTab";
import { PreviewPanel } from "./components/Shared";

const tabs: { id: TabId; label: string }[] = [
  { id: "shopping", label: "Shopping Lists" },
  { id: "best", label: "Best Trades" },
  { id: "prices", label: "Fair Prices" },
  { id: "items", label: "Items" },
  { id: "trades", label: "Trades" },
  { id: "about", label: "About" },
];

export function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="starfield" />
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-8 space-y-1 text-center">
          <h1 className="bg-linear-to-r from-indigo-300 via-fuchsia-200 to-indigo-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            Aniiconomy
          </h1>
          <p className="text-sm text-slate-400">
            Game economy report — fair prices, shopping lists &amp; best trades
          </p>
        </header>

        <nav className="mb-8 flex flex-wrap justify-center gap-2">
          {tabs.map((tab) => {
            const active = select(activeTab, (t) => t === tab.id);
            return (
              <button
                onclick={() => (activeTab.value = tab.id)}
                data-active={active}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white data-active:bg-indigo-500/90 data-active:text-white data-active:shadow-lg data-active:shadow-indigo-900/50 data-active:ring-indigo-400/50"
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <main className="rounded-3xl bg-white/2 p-6 ring-1 ring-white/10 backdrop-blur-sm sm:p-8">
          <OneOf selector={activeTab}>
            {{
              shopping: <ShoppingListsTab />,
              best: <BestTradesTab />,
              prices: <FairPricesTab />,
              items: <ItemsTab />,
              trades: <TradesTab />,
              about: <AboutTab />,
            }}
          </OneOf>
        </main>
      </div>

      <PreviewPanel />
    </div>
  );
}
