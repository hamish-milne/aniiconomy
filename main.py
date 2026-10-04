import itertools
import json
import pulp
import re
import yaml

# Scaling multipliers relative to the target time horizon, applied to any
# per_day/per_week/per_month/per_season limit (defaults to 4-week months).
TIME_MULTIPLIERS = {
    "day":    {"per_day": 1.0,  "per_week": 0,    "per_month": 0,   "per_season": 0},
    "week":   {"per_day": 7.0,  "per_week": 1.0,  "per_month": 0,   "per_season": 0},
    "month":  {"per_day": 28.0, "per_week": 4.0,  "per_month": 1.0, "per_season": 0},
    "season": {"per_day": 84.0, "per_week": 12.0, "per_month": 3.0, "per_season": 1.0},
}

def build_base_engine(yaml_data: dict[str, dict], time_horizon="month", exchange_cat="Continuous",
                       exclude_free_trades=False, items: dict[str, dict] | None = None):
    """
    Builds the base LP engine from YAML data.
    Scales all limits based on the requested time_horizon ('day', 'week', 'month').
    """
    prob = pulp.LpProblem("Game_Economy_Core", pulp.LpMaximize)
    
    exchange_vars: dict[str, pulp.LpVariable] = {}
    item_ledgers: dict[str, pulp.LpVariable] = {}
    item_acquired: dict[str, pulp.LpVariable] = {}  # gross production only, for acquisition_limit caps
    mult = TIME_MULTIPLIERS[time_horizon]

    def credit(item: str, qty: float, var: pulp.LpVariable) -> None:
        item_ledgers[item] = item_ledgers.get(item, 0) + (qty * var)
        item_acquired[item] = item_acquired.get(item, 0) + (qty * var)

    def apply_period_limits(expr, limits: dict, label: str) -> None:
        nonlocal prob
        for period in ('per_day', 'per_week', 'per_month', 'per_season'):
            if period in limits:
                prob += expr <= limits[period] * mult[period], f"{label}_{period[len('per_'):].capitalize()}"

    for ex_name, exchange in yaml_data.items():
        # Auto-refilling currency trades (no 'in', just a free 'out' and a
        # per_X cap) represent passive income, not something spendable on
        # demand - excluded from fair-price pricing so their outputs don't
        # collapse to a "free" marginal cost, but kept for shopping lists.
        if exclude_free_trades and 'in' not in exchange:
            continue

        # 1. Create the Main Exchange Variable (cat chosen by caller: Continuous for pricing, Integer for shopping)
        v_main = prob.add_variable(f"Ex_{ex_name}", lowBound=0, cat=exchange_cat)
        exchange_vars[exchange['name']] = v_main
        
        # 2. Apply Daily/Weekly/Monthly Constraints
        # Scales the limit provided in the YAML to match the horizon
        apply_period_limits(v_main, exchange, f"Limit_{ex_name}")

        # 3. Process Inputs (spending only affects the net ledger, not gross acquisition)
        for item, qty in exchange.get('in', {}).items():
            item_ledgers[item] = item_ledgers.get(item, 0) - (qty * v_main)
            
        # 4. Process Outputs (Handling both items and CHOOSE blocks)
        outputs = exchange.get('out', {})
        
        # Standard dictionary format (e.g., glimmer: 120)
        if isinstance(outputs, dict):
            for item, qty in outputs.items():
                credit(item, qty, v_main)

        # List format containing CHOOSE elements
        elif isinstance(outputs, list):
            for block_idx, element in enumerate(outputs):

                # Standard guaranteed item inside a list
                if isinstance(element, dict) and 'CHOOSE' not in element:
                    for item, qty in element.items():
                        credit(item, qty, v_main)

                # Dynamic CHOOSE block parsing
                elif isinstance(element, dict) and 'CHOOSE' in element:
                    choice_options = element['CHOOSE']
                    branch_vars = []

                    # 1. Loop through each individual branch (choice option)
                    for opt_idx, branch in enumerate(choice_options):
                        # Count of units choosing this branch (not a single flag -
                        # Binary would cap the whole trade at 1 unit using it).
                        v_branch = prob.add_variable(
                            f"Choice_{ex_name}_B{block_idx}_Branch{opt_idx}",
                            lowBound=0, cat=exchange_cat
                        )
                        branch_vars.append(v_branch)

                        # 2. Credit EVERY item contained inside this specific branch
                        for item, qty in branch.items():
                            credit(item, qty, v_branch)

                    # The sum of chosen branches equals the total number of packs bought
                    prob += pulp.lpSum(branch_vars) == v_main, f"Choose_Constraint_{ex_name}_B{block_idx}"

    # 5. Apply per-item acquisition limits (total ever produced, regardless of
    # how it's spent - unlike the net ledger's >=0 supply constraint, this
    # caps the gross amount a player could realistically obtain in the horizon).
    if items:
        for item, acquired in item_acquired.items():
            limit = items.get(item, {}).get('acquisition_limit')
            if limit:
                apply_period_limits(acquired, limit, f"AcquisitionLimit_{item}")

    return prob, item_ledgers, exchange_vars

# =====================================================================
# REPORT 1: SHADOW PRICING (Must remain Continuous)
# =====================================================================
# Hours of "time" (normal gameplay grinding) available per time_horizon, used to
# seed the fair-price solve so credits/time-bought items are valued realistically
# instead of either "free" (unbounded grinding) or "worthless" (no time at all).
PLAYTIME_PER_DAY = 2
TIME_SUPPLY_HOURS = {
    "day": PLAYTIME_PER_DAY,
    "week": PLAYTIME_PER_DAY * 7,
    "month": PLAYTIME_PER_DAY * 28,
    "season": PLAYTIME_PER_DAY * 84
}


def generate_fair_price_report(item_names: list[str], trades: dict[str, dict], time_horizon="month",
                                items: dict[str, dict] | None = None):
    # Pricing one item at a time: pin its demand to 1, allow surplus (>=0) on
    # every other item, and minimize money spent. The dual (.pi) of the demand
    # constraint proved unreliable, so read the price straight off the
    # minimized objective instead. `time` is given a starting supply (rather
    # than just >=0) so grinding-based trades (time -> credits -> ...) are
    # valued against a realistic amount of normal gameplay, not infinite or zero.
    horizons = ["day", "week", "month", "season"]
    # Items only obtainable from a longer-horizon trade (e.g. per_season limits)
    # can't be priced at a shorter horizon - retry at increasingly long horizons.
    fallback_horizons = horizons[horizons.index(time_horizon):]
    fair_prices = {}
    for target_item in item_names:
        if target_item == 'money':
            continue
        # `ephemeral` items (intermediate, unstockpileable - expire if unused)
        # only have value through the trades that consume them immediately,
        # never on their own, so their balance is always priced at zero.
        if items and items.get(target_item, {}).get('type') == 'ephemeral':
            continue
        print(f"  Pricing {target_item}...")
        for horizon in fallback_horizons:
            time_supply = TIME_SUPPLY_HOURS[horizon]
            prob, item_ledgers, _ = build_base_engine(trades, time_horizon=horizon, exchange_cat="Continuous",
                                                       exclude_free_trades=True, items=items)
            prob.sense = pulp.LpMinimize
            prob += -item_ledgers['money']  # money is negative when spent; minimize the spend
            for item, ledger in item_ledgers.items():
                if item == 'money':
                    continue
                if item == target_item:
                    prob += ledger == 1, f"Demand_{item}"
                elif item == 'time':
                    prob += ledger >= -time_supply, f"Supply_{item}"
                else:
                    prob += ledger >= 0, f"Supply_{item}"

            stats = prob.solve(pulp.COIN_CMD(msg=False))
            if stats.has_solution:
                fair_prices[target_item] = stats.objective
                break
        else:
            print(f"Fair price solve failed for {target_item} at all horizons from {time_horizon}: {stats.status_str}")
    return fair_prices


def _trade_output_value(trade: dict, fair_prices: dict[str, float]) -> float:
    """Total fair-priced value of a trade's outputs (best branch for CHOOSE blocks)."""
    outputs = trade.get('out', {})
    if isinstance(outputs, dict):
        return sum(qty * fair_prices.get(item, 0) for item, qty in outputs.items())
    value = 0.0
    for element in outputs:
        if 'CHOOSE' in element:
            value += max(
                sum(qty * fair_prices.get(item, 0) for item, qty in branch.items())
                for branch in element['CHOOSE']
            )
        else:
            value += sum(qty * fair_prices.get(item, 0) for item, qty in element.items())
    return value


def revalue_material_fair_prices(fair_prices: dict[str, float], material_items: list[str],
                                  trades: dict[str, dict]) -> None:
    # `material` items (e.g. capaseed) have no real value of their own - their
    # acquisition-cost price can be wildly wrong whenever they're a co-product of
    # some other trade. Instead, price them by the best per-unit payoff among the
    # trades that actually consume them (output value minus the value of any
    # other inputs spent alongside it). This is a closed-form calculation rather
    # than an LP, since crediting fair-priced output value as an LP objective lets
    # the solver exploit any uncapped trade with a (slightly inconsistent) positive
    # margin and run it an unbounded number of times.
    for _ in material_items:
        for material in material_items:
            best_value = 0.0
            for trade in trades.values():
                qty_in = trade.get('in', {}).get(material)
                if not qty_in:
                    continue
                other_input_value = sum(
                    qty * fair_prices.get(item, 0)
                    for item, qty in trade.get('in', {}).items() if item != material
                )
                net_value = (_trade_output_value(trade, fair_prices) - other_input_value) / qty_in
                best_value = max(best_value, net_value)
            fair_prices[material] = best_value


def _add_surplus_constraints(prob: pulp.LpProblem, item_ledgers: dict[str, pulp.LpVariable], exempt: set[str]) -> None:
    """Require every non-exempt item's ledger to stay non-negative (no deficit spending)."""
    for item, ledger in item_ledgers.items():
        if item not in exempt:
            prob += ledger >= 0, f"Supply_{item}"


def _trade_possible_outputs(trade: dict) -> set[str]:
    """Every item a trade could produce, including any CHOOSE branch (not just the one chosen)."""
    outputs = trade.get('out', {})
    if isinstance(outputs, dict):
        return set(outputs)
    items = set()
    for element in outputs:
        if 'CHOOSE' in element:
            for branch in element['CHOOSE']:
                items.update(branch)
        else:
            items.update(element)
    return items


def prune_irrelevant_trades(recipe: dict[str, float], trades: dict[str, dict], target_item: str) -> dict[str, float]:
    # The basket-value tie-break can pull in trades that only maximize value on
    # the side and never actually feed the target item - drop anything that
    # isn't (transitively) required to produce it.
    needed_items = {target_item}
    needed_trades: set[str] = set()
    changed = True
    while changed:
        changed = False
        for name, qty in recipe.items():
            if not name.startswith("Ex_") or qty <= 0:
                continue
            ex_name = name[len("Ex_"):]
            if ex_name in needed_trades:
                continue
            if needed_items & _trade_possible_outputs(trades[ex_name]):
                needed_trades.add(ex_name)
                needed_items.update(item for item in trades[ex_name].get('in', {}) if item != 'money')
                changed = True

    return {
        name: qty for name, qty in recipe.items()
        if (name.startswith("Ex_") and name[len("Ex_"):] in needed_trades)
        or (name.startswith("Choice_") and re.match(r"^Choice_(.*)_B\d+_Branch\d+$", name).group(1) in needed_trades)
    }

# =====================================================================
# REPORT 2: SHOPPING STRATEGY (Must be forced to Discrete/Integer)
# =====================================================================
def generate_shopping_recipe(trades: dict[str, dict], target_item: str, budget: float, time_horizon="month",
                              fair_prices: dict[str, float] | None = None, items: dict[str, dict] | None = None):
    # Exchange variables are built as Integer so the solver guarantees a realistic
    # game plan (e.g., buy exactly 2 packs, not 2.4); choice variables stay Binary.
    prob, item_ledgers, _ = build_base_engine(trades, time_horizon=time_horizon, exchange_cat="Integer", items=items)
    prob.sense = pulp.LpMaximize
    
    prob += item_ledgers[target_item]
    prob += item_ledgers['money'] >= -budget
    _add_surplus_constraints(prob, item_ledgers, {target_item, 'money'})

    stats = prob.solve(pulp.COIN_CMD(msg=False))
    if not stats.has_solution:
        raise RuntimeError(f"Shopping recipe solve failed: {stats.status_str}")
    best_quantity = stats.objective

    # Stage 2: among plans achieving that same quantity, spend the least money
    # (maximize the money ledger, since it's negative when spent).
    prob2, item_ledgers2, _ = build_base_engine(trades, time_horizon=time_horizon, exchange_cat="Integer", items=items)
    prob2.sense = pulp.LpMaximize
    prob2 += item_ledgers2['money']
    prob2 += item_ledgers2[target_item] >= best_quantity
    prob2 += item_ledgers2['money'] >= -budget
    _add_surplus_constraints(prob2, item_ledgers2, {target_item, 'money'})

    stats2 = prob2.solve(pulp.COIN_CMD(msg=False))
    if not stats2.has_solution:
        raise RuntimeError(f"Shopping recipe cost-minimization solve failed: {stats2.status_str}")
    money_spent = stats2.objective

    if fair_prices is None:
        recipe = {v.name: v.varValue for v in prob2.variables() if v.varValue > 0}
        return recipe, best_quantity

    # Stage 3: among plans tying on quantity and money spent, break ties by
    # maximizing total basket value (fair-priced), so e.g. CHOOSE branches
    # don't arbitrarily settle on near-worthless items like plentiful credits.
    # Leftover time gets a slightly higher weight than any single item's value
    # bias, so the solver stops grinding time away for marginal basket value
    # that doesn't actually help reach the target item.
    time_weight = max(fair_prices.values(), default=0) * 1.05
    prob3, item_ledgers3, _ = build_base_engine(trades, time_horizon=time_horizon, exchange_cat="Integer", items=items)
    prob3.sense = pulp.LpMaximize
    prob3 += pulp.lpSum(
        fair_prices.get(item, 0) * ledger
        for item, ledger in item_ledgers3.items() if item not in (target_item, 'money', 'time')
    ) + time_weight * item_ledgers3.get('time', 0)
    prob3 += item_ledgers3[target_item] >= best_quantity
    prob3 += item_ledgers3['money'] >= -budget
    prob3 += item_ledgers3['money'] <= money_spent
    _add_surplus_constraints(prob3, item_ledgers3, {target_item, 'money'})

    stats3 = prob3.solve(pulp.COIN_CMD(msg=False))
    if not stats3.has_solution:
        # Fall back to the stage-2 plan if the tie-break solve fails for any reason.
        recipe = {v.name: v.varValue for v in prob2.variables() if v.varValue > 0}
        return recipe, best_quantity
    recipe = {v.name: v.varValue for v in prob3.variables() if v.varValue > 0}
    recipe = prune_irrelevant_trades(recipe, trades, target_item)
    return recipe, best_quantity


def generate_best_value_recipe(trades: dict[str, dict], budget: float, fair_prices: dict[str, float],
                                time_horizon="month", items: dict[str, dict] | None = None) -> tuple[dict[str, float], float]:
    """Like generate_shopping_recipe, but maximizes total fair-priced basket value with no fixed target item."""
    prob, item_ledgers, _ = build_base_engine(trades, time_horizon=time_horizon, exchange_cat="Integer", items=items)
    prob.sense = pulp.LpMaximize
    prob += pulp.lpSum(fair_prices.get(item, 0) * ledger for item, ledger in item_ledgers.items() if item != 'money')
    prob += item_ledgers['money'] >= -budget
    _add_surplus_constraints(prob, item_ledgers, {'money'})

    stats = prob.solve(pulp.COIN_CMD(msg=False))
    if not stats.has_solution:
        raise RuntimeError(f"Best-value solve failed: {stats.status_str}")
    best_value = stats.objective

    # Stage 2: among plans achieving that same value, spend the least money.
    prob2, item_ledgers2, _ = build_base_engine(trades, time_horizon=time_horizon, exchange_cat="Integer", items=items)
    prob2.sense = pulp.LpMaximize
    prob2 += item_ledgers2['money']
    prob2 += pulp.lpSum(fair_prices.get(item, 0) * ledger for item, ledger in item_ledgers2.items()
                         if item != 'money') >= best_value
    prob2 += item_ledgers2['money'] >= -budget
    _add_surplus_constraints(prob2, item_ledgers2, {'money'})

    stats2 = prob2.solve(pulp.COIN_CMD(msg=False))
    if not stats2.has_solution:
        raise RuntimeError(f"Best-value cost-minimization solve failed: {stats2.status_str}")
    recipe = {v.name: v.varValue for v in prob2.variables() if v.varValue > 0}
    return recipe, best_value


def order_shopping_recipe(recipe: dict[str, float], trades: dict[str, dict]) -> list[str]:
    """
    Expands an Ex_* recipe into a per-unit execution order where every trade's
    inputs are already covered by prior outputs ('money' is treated as an
    always-available real-currency top-up, not something that must be produced).
    Consecutive repeats of the same trade are grouped into (name, count) pairs;
    once a trade becomes executable, the scheduler keeps repeating it until it
    runs out or gets blocked, instead of interleaving with other ready trades.
    """
    remaining = {
        name[len("Ex_"):]: int(round(qty))
        for name, qty in recipe.items() if name.startswith("Ex_")
    }
    balances: dict[str, float] = {}
    order: list[str] = []

    def guaranteed_outputs(ex_name: str) -> dict[str, float]:
        """Outputs that always happen (dict form, or non-CHOOSE entries of a list)."""
        outputs = trades[ex_name].get('out', {})
        result: dict[str, float] = {}
        if isinstance(outputs, dict):
            result.update(outputs)
        elif isinstance(outputs, list):
            for element in outputs:
                if isinstance(element, dict) and 'CHOOSE' not in element:
                    for item, qty in element.items():
                        result[item] = result.get(item, 0) + qty
        return result

    # For each unit of a CHOOSE-containing trade, work out which branch each
    # block picked. Any pairing across blocks that matches each block's own
    # branch totals is valid (the LP only constrains per-block sums), so units
    # are assigned branches in the order they appear in the recipe.
    choice_outputs_by_unit: dict[str, list[dict[str, float]]] = {}
    for ex_name, count in remaining.items():
        outputs = trades[ex_name].get('out', {})
        if not isinstance(outputs, list):
            continue
        block_assignments = []
        for block_idx, element in enumerate(outputs):
            if not (isinstance(element, dict) and 'CHOOSE' in element):
                continue
            choice_options = element['CHOOSE']
            assignment = []
            for opt_idx, branch in enumerate(choice_options):
                qty = int(round(recipe.get(f"Choice_{ex_name}_B{block_idx}_Branch{opt_idx}", 0)))
                assignment.extend([branch] * qty)
            assignment = (assignment + [{}] * count)[:count]
            block_assignments.append(assignment)
        if block_assignments:
            per_unit = []
            for u in range(count):
                merged: dict[str, float] = {}
                for assignment in block_assignments:
                    for item, qty in assignment[u].items():
                        merged[item] = merged.get(item, 0) + qty
                per_unit.append(merged)
            choice_outputs_by_unit[ex_name] = per_unit

    unit_index: dict[str, int] = {}

    def can_afford(ex_name: str) -> bool:
        inputs = trades[ex_name].get('in', {})
        return all(item == 'money' or balances.get(item, 0) >= qty for item, qty in inputs.items())

    def execute(ex_name: str) -> None:
        for item, qty in trades[ex_name].get('in', {}).items():
            if item != 'money':
                balances[item] -= qty
        for item, qty in guaranteed_outputs(ex_name).items():
            balances[item] = balances.get(item, 0) + qty
        if ex_name in choice_outputs_by_unit:
            idx = unit_index.get(ex_name, 0)
            for item, qty in choice_outputs_by_unit[ex_name][idx].items():
                balances[item] = balances.get(item, 0) + qty
            unit_index[ex_name] = idx + 1
        order.append(ex_name)
        remaining[ex_name] -= 1
        if remaining[ex_name] <= 0:
            del remaining[ex_name]

    # Dependency "level" per item: 0 if buyable with money alone, otherwise
    # 1 + the deepest level among its own non-money inputs. Scheduling the
    # lowest-level affordable trade first front-loads raw purchases before
    # anything that consumes them, grouping runs instead of interleaving.
    def all_possible_outputs(ex_name: str) -> set[str]:
        items = set(guaranteed_outputs(ex_name))
        outputs = trades[ex_name].get('out', {})
        if isinstance(outputs, list):
            for element in outputs:
                if isinstance(element, dict) and 'CHOOSE' in element:
                    for branch in element['CHOOSE']:
                        items.update(branch)
        return items

    item_level: dict[str, int] = {}
    changed = True
    while changed:
        changed = False
        for ex_name in remaining:
            non_money = [item for item in trades[ex_name].get('in', {}) if item != 'money']
            if all(item in item_level for item in non_money):
                lvl = 0 if not non_money else 1 + max(item_level[item] for item in non_money)
                for item in all_possible_outputs(ex_name):
                    if item_level.get(item, lvl + 1) > lvl:
                        item_level[item] = lvl
                        changed = True

    def trade_level(ex_name: str) -> int:
        non_money = [item for item in trades[ex_name].get('in', {}) if item != 'money']
        return 0 if not non_money else 1 + max(item_level.get(item, 0) for item in non_money)

    current = None
    while remaining:
        if current not in remaining or not can_afford(current):
            candidates = [ex_name for ex_name in remaining if can_afford(ex_name)]
            if not candidates:
                raise RuntimeError(f"Could not find a valid execution order; stuck on: {remaining}")
            current = min(candidates, key=trade_level)
        execute(current)

    grouped = [(ex_name, len(list(group))) for ex_name, group in itertools.groupby(order)]

    # An earlier trade's outputs can always be stockpiled and only spent later,
    # so if the same trade recurs further down the list (just interleaved with
    # others), fold every occurrence's count into its *last* appearance instead
    # of listing it multiple times.
    last_index = {ex_name: i for i, (ex_name, _) in enumerate(grouped)}
    totals: dict[str, int] = {}
    for ex_name, count in grouped:
        totals[ex_name] = totals.get(ex_name, 0) + count

    return [
        (ex_name, totals[ex_name])
        for i, (ex_name, _) in enumerate(grouped)
        if i == last_index[ex_name]
    ]


def describe_chosen_branches(ex_name: str, recipe: dict[str, float], trades: dict[str, dict]) -> list[dict]:
    """
    Per CHOOSE block in ex_name with a non-zero pick, {"block": block_index,
    "picks": [{"index": branch_index, "count": n}, ...]} - the reward items are
    looked up from the trade data itself (via block/branch index), not duplicated here.
    """
    blocks = []
    outputs = trades[ex_name].get('out', {})
    if not isinstance(outputs, list):
        return blocks
    for block_idx, element in enumerate(outputs):
        if not (isinstance(element, dict) and 'CHOOSE' in element):
            continue
        picks = []
        for opt_idx, branch in enumerate(element['CHOOSE']):
            branch_qty = int(round(recipe.get(f"Choice_{ex_name}_B{block_idx}_Branch{opt_idx}", 0)))
            if branch_qty > 0:
                picks.append({"index": opt_idx, "count": branch_qty})
        if picks:
            blocks.append({"block": block_idx, "picks": picks})
    return blocks


def format_fair_price(price: float | None) -> str:
    """Normal decimal for prices >= 1 money; an inverse ratio for tiny fractions."""
    if price is None or price <= 0:
        return "N/A"
    if price >= 1:
        return f"{price:,.2f}"
    return f"{price:.4f} (1 money ≈ {1 / price:,.1f})"


def compute_exchange_value_ratio(trade: dict, fair_prices: dict[str, float]) -> float | None:
    """Output value / input value, both priced in money. CHOOSE blocks assume the best branch."""
    def item_value(item: str) -> float:
        return 1.0 if item == 'money' else fair_prices.get(item, 0.0)

    input_value = sum(qty * item_value(item) for item, qty in trade.get('in', {}).items())
    if input_value <= 0:
        return None

    output_value = 0.0
    outputs = trade.get('out', {})
    if isinstance(outputs, dict):
        output_value = sum(qty * item_value(item) for item, qty in outputs.items())
    elif isinstance(outputs, list):
        for element in outputs:
            if isinstance(element, dict) and 'CHOOSE' not in element:
                output_value += sum(qty * item_value(item) for item, qty in element.items())
            elif isinstance(element, dict) and 'CHOOSE' in element:
                branch_values = [
                    sum(qty * item_value(item) for item, qty in branch.items())
                    for branch in element['CHOOSE']
                ]
                output_value += max(branch_values, default=0.0)

    return output_value / input_value


def compute_money_spent(recipe: dict[str, float], trades: dict[str, dict]) -> float:
    return sum(
        trades[name[len("Ex_"):]].get('in', {}).get('money', 0) * qty
        for name, qty in recipe.items() if name.startswith("Ex_")
    )


def traffic_light(ratio: float | None) -> str:
    if ratio is None:
        return "⚪"
    if ratio >= 1.2:
        return "🟢"
    if ratio >= 0.9:
        return "🟡"
    return "🔴"


def _build_trade_entries(recipe: dict[str, float], trades: dict[str, dict]) -> list[dict]:
    """Ordered, grouped trade list for a recipe, shared by the JSON data and markdown renderer."""
    entries = []
    for ex_name, count in order_shopping_recipe(recipe, trades):
        entry = {"id": ex_name, "count": count}
        branches = describe_chosen_branches(ex_name, recipe, trades)
        if branches:
            entry["branches"] = branches
        entries.append(entry)
    return entries


def generate_report_data(yaml_data: dict, time_horizon="month", budgets=(0, 10, 20, 50, 100)) -> dict:
    """Runs every solve and returns a plain-data structure, independent of markdown/any other output format."""
    items = yaml_data['items']
    trades = yaml_data['trades']
    horizons = ["day", "week", "month", "season"]

    valuable_items = [name for name, info in items.items() if info.get('type') == 'valuable']
    material_items = [name for name, info in items.items() if info.get('type') == 'material']

    # Priced against every item (not just the ones displayed), since trades
    # consume/produce plenty of unpriced items too.
    print("Computing fair prices...")
    fair_prices = generate_fair_price_report([name for name in items if name != 'money'], trades, time_horizon=time_horizon, items=items)
    # `material` items (e.g. capaseed) are only worth what they can be converted
    # into, not what they cost to acquire - revalue them accordingly.
    revalue_material_fair_prices(fair_prices, material_items, trades)

    trade_ratios = {ex_name: compute_exchange_value_ratio(trade, fair_prices) for ex_name, trade in trades.items()}
    exchange_value_index = [
        {
            "id": ex_name,
            "limits": {key: trades[ex_name][key] for key in ('per_day', 'per_week', 'per_month', 'per_season')
                       if key in trades[ex_name]},
            "value_index": trade_ratios[ex_name],
        }
        for ex_name in sorted(trades, key=lambda n: trade_ratios[n] if trade_ratios[n] is not None else float('-inf'),
                               reverse=True)
    ]

    shopping_lists = {}
    for item in valuable_items:
        print(f"Computing shopping lists for {item}...")
        budget_plans = []
        for budget in budgets:
            # Collect one result per horizon, then drop duplicates (same money
            # spent and quantity), keeping the shortest horizon that achieves them.
            seen: set[tuple[float, float]] = set()
            plans = []
            for horizon in horizons:
                try:
                    recipe, quantity = generate_shopping_recipe(trades, target_item=item, budget=budget, time_horizon=horizon, fair_prices=fair_prices, items=items)
                except RuntimeError:
                    continue
                money_spent = compute_money_spent(recipe, trades)
                key = (round(money_spent, 6), quantity)
                if key in seen:
                    continue
                seen.add(key)
                plans.append({
                    "horizon": horizon,
                    "money_spent": money_spent,
                    "quantity": quantity,
                    "trades": _build_trade_entries(recipe, trades) if quantity > 0 else [],
                })
            budget_plans.append({"budget": budget, "plans": plans})
        shopping_lists[item] = budget_plans

    overall_best_trades = []
    for budget in budgets:
        print(f"Computing overall best trades for budget {budget}...")
        seen: set[tuple[float, float]] = set()
        plans = []
        for horizon in horizons:
            try:
                recipe, value = generate_best_value_recipe(trades, budget=budget, fair_prices=fair_prices, time_horizon=horizon, items=items)
            except RuntimeError:
                continue
            money_spent = compute_money_spent(recipe, trades)
            key = (round(money_spent, 6), round(value, 6))
            if key in seen:
                continue
            seen.add(key)
            plans.append({
                "horizon": horizon,
                "money_spent": money_spent,
                "value": value,
                "trades": _build_trade_entries(recipe, trades),
            })
        overall_best_trades.append({"budget": budget, "plans": plans})

    return {
        "items": items,
        "trades": trades,
        "time_horizon": time_horizon,
        "fair_prices": fair_prices,
        "exchange_value_index": exchange_value_index,
        "shopping_lists": shopping_lists,
        "overall_best_trades": overall_best_trades,
    }


def generate_markdown_report(report_data: dict) -> str:
    items = report_data['items']
    trades = report_data['trades']
    fair_prices = report_data['fair_prices']
    priced_items = [name for name, info in items.items() if info.get('type') in ('valuable', 'currency')]

    lines = ["# Aniimo Economy Report", ""]

    lines.append("## Fair Prices")
    lines.append("")
    lines.append("Marginal cost, in real money, to obtain one more unit of each item (see Methodology).")
    lines.append("")
    lines.append("| Item | Fair Price (money) |")
    lines.append("|---|---|")
    for item in priced_items:
        icon = items[item].get('icon', '')
        lines.append(f"| {icon} {items[item]['name']} | {format_fair_price(fair_prices.get(item))} |")
    lines.append("")

    lines.append("## Exchange Value Index")
    lines.append("")
    lines.append("Output value ÷ input value for each exchange, both priced in money. Above 100% returns "
                  "more value than it costs; below 100% is a net money sink. `CHOOSE` blocks assume the "
                  "best available branch is picked. Sorted highest value first.")
    lines.append("")
    lines.append("| Exchange | Limits | Value Index |  |")
    lines.append("|---|---|---|---|")
    for entry in report_data['exchange_value_index']:
        ratio = entry['value_index']
        limits = ", ".join(f"{qty}/{period[len('per_'):]}" for period, qty in entry['limits'].items()) or "—"
        pct = f"{ratio * 100:,.1f}%" if ratio is not None else "N/A"
        lines.append(f"| {trades[entry['id']]['name']} | {limits} | {pct} | {traffic_light(ratio)} |")
    lines.append("")

    def render_trade_entries(entries: list[dict]) -> None:
        for trade in entries:
            suffix = f" (x{trade['count']})" if trade['count'] > 1 else ""
            lines.append(f"- {trades[trade['id']]['name']}{suffix}")
            outputs = trades[trade['id']].get('out', {})
            for i, block in enumerate(trade.get('branches', [])):
                choices = outputs[block['block']]['CHOOSE']
                desc = ", ".join(
                    " & ".join(f"{items[item]['name']} x{qty}" for item, qty in choices[pick['index']].items())
                    + f" (x{pick['count']})"
                    for pick in block['picks']
                )
                lines.append(f"  - Block {i + 1}: {desc}")

    lines.append("## Shopping Lists")
    lines.append("")
    for item, budget_plans in report_data['shopping_lists'].items():
        icon = items[item].get('icon', '')
        lines.append(f"### {icon} {items[item]['name']}")
        lines.append("")
        for entry in budget_plans:
            budget = entry['budget']
            if not entry['plans']:
                lines.append(f"**Budget: {budget} money** — _no plan found_")
                lines.append("")
                continue
            for plan in entry['plans']:
                lines.append(f"**Budget: {budget} money (spent {plan['money_spent']:,.2f}) — {plan['horizon']} horizon**")
                lines.append("")
                if plan['quantity'] <= 0:
                    lines.append("_Not affordable at this budget._")
                    lines.append("")
                    continue
                lines.append(f"Yields **{plan['quantity']:,.0f}x {items[item]['name']}**:")
                lines.append("")
                render_trade_entries(plan['trades'])
                lines.append("")

    lines.append("## Overall Best Trades")
    lines.append("")
    lines.append("The highest total fair-priced basket value achievable for each budget, regardless of "
                  "which items it's made up of.")
    lines.append("")
    for entry in report_data['overall_best_trades']:
        budget = entry['budget']
        if not entry['plans']:
            lines.append(f"**Budget: {budget} money** — _no plan found_")
            lines.append("")
            continue
        for plan in entry['plans']:
            lines.append(f"**Budget: {budget} money (spent {plan['money_spent']:,.2f}) — {plan['horizon']} horizon**")
            lines.append("")
            lines.append(f"Total basket value: **{plan['value']:,.2f} money**")
            lines.append("")
            render_trade_entries(plan['trades'])
            lines.append("")

    lines.append("## Methodology")
    lines.append("")
    lines.append("- **Fair price**: solved per item as a continuous LP — pin that item's net production to "
                  "exactly 1 unit, allow surplus (but not deficit) of every other item, and minimize real "
                  "money spent. The minimized objective is the marginal price.")
    lines.append("- **Exchange value index**: a static valuation of each exchange's inputs/outputs using the "
                  "fair prices above; it ignores `per_day`/`per_week`/`per_month`/`per_season` limits.")
    lines.append("- **Shopping lists**: solved as a two-stage integer program (maximize target item quantity, "
                  "then minimize money spent for that same quantity) over the given time horizon, respecting "
                  "all trade limits. The execution order greedily schedules trades so no item balance goes "
                  "negative, front-loading trades that only need money.")
    lines.append("- **Overall best trades**: the same two-stage approach, but maximizing total fair-priced "
                  "basket value across all items instead of the quantity of a single target item.")

    return "\n".join(lines)


game_economy_yaml = yaml.safe_load(open("data.yaml"))
report_data = generate_report_data(game_economy_yaml, time_horizon="month")

with open("src/report.json", "w", encoding="utf-8") as f:
    json.dump(report_data, f, indent=2, ensure_ascii=False)
print("Data written to report.json")

report = generate_markdown_report(report_data)
with open("report.md", "w", encoding="utf-8") as f:
    f.write(report)
print("Report written to report.md")
