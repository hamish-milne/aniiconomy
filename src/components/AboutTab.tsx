export function AboutTab() {
  return (
    <div className="space-y-6 text-sm text-slate-300">
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          What is this?
        </h2>
        <p>
          Aniiconomy is a report on the Aniimo in-game economy: what things are really worth, which
          trades are worth doing, and how best to spend your money or turn a starting item into as
          much of something else as possible.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          How to use the tabs
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-slate-100">Fair Prices</span> — the "true" money value of every
            item, worked out from all the ways you can trade for it.
          </li>
          <li>
            <span className="text-slate-100">Shopping Lists</span> — pick an item, a budget, and a
            time horizon, and see the cheapest set of trades that gets you the most of that item.
          </li>
          <li>
            <span className="text-slate-100">Best Trades</span> — like Shopping Lists, but instead
            of maximizing one item, it maximizes the total value of everything you end up with.
          </li>
          <li>
            <span className="text-slate-100">Items</span> — a browsable list of every item, hover
            for details.
          </li>
          <li>
            <span className="text-slate-100">Trades</span> — every trade in the game, sorted by how
            good a deal it is, with hoverable chips for what goes in and out.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
          How the numbers were worked out
        </h2>
        <div className="space-y-3">
          <p>
            <span className="text-slate-100">Fair price</span> — for each item, we worked out the
            cheapest way to produce one extra unit of it using real money and trades, allowing
            leftovers of other items but never going into debt on them. That cheapest cost is the
            item's fair price.
          </p>
          <p>
            <span className="text-slate-100">Exchange value index</span> — using those fair prices,
            we compare what a trade gives you to what it costs you, to see if it's a good deal. This
            doesn't account for trade limits (like "once per day").
          </p>
          <p>
            <span className="text-slate-100">Shopping lists</span> — for a given item, budget, and
            time horizon, we find the plan that gets the most of that item, then among plans that
            get that same amount, the cheapest one. Trades are respected if they could only be done
            so many times per day/week/month/season.
          </p>
          <p>
            <span className="text-slate-100">Best trades</span> — the same approach, but instead of
            maximizing one item, it maximizes the total fair-price value of everything you end up
            with.
          </p>
        </div>
      </section>
    </div>
  );
}
