import { reactive } from "pipis";

export type TabId = "shopping" | "best" | "prices" | "items" | "trades";
export const activeTab = reactive<TabId>("shopping");

export type HoverTarget = { kind: "item" | "trade"; id: string } | null;
export const hoverTarget = reactive<HoverTarget>(null);

export function hoverItem(id: string): void {
  hoverTarget.value = { kind: "item", id };
}

export function hoverTrade(id: string): void {
  hoverTarget.value = { kind: "trade", id };
}

export function clearHover(): void {
  hoverTarget.value = null;
}
