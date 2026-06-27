import { Agent, callable, getAgentByName } from "agents";

type ShopState = { rev: number };

// Per-shop coordinator for the seller dashboard. One instance per shop (named by
// phone_number_id), holding the dashboard's live WebSocket(s).
//
// It carries no order data — Postgres stays the source of truth. It only bumps a
// revision counter when an order changes; the Agents SDK syncs that state to
// every connected dashboard, which refetches /orders. The rev is a change
// signal, not a store, so the DO and Postgres can't drift.
//
// Idle (no orders) it hibernates: connections stay open with no duration charge.
// A cross-DO orderChanged() call from the order-write path wakes it to push the
// new rev, then it sleeps again. This is why the per-customer OrderAgent isn't
// used here — the seller view is per-shop, so a per-shop DO holds the socket.
export class ShopAgent extends Agent<CloudflareBindings, ShopState> {
  initialState: ShopState = { rev: 0 };

  @callable()
  orderChanged(): void {
    this.setState({ rev: this.state.rev + 1 });
  }
}

// Nudge a shop's dashboards that an order changed. Best-effort: a failed push
// must never fail the order write or the seller action that triggered it, so we
// swallow errors (the dashboard also refetches on its next reconnect/state sync).
export async function notifyShop(
  env: CloudflareBindings,
  shopId: string,
): Promise<void> {
  try {
    const shop = await getAgentByName(env.ShopAgent, shopId);
    await shop.orderChanged();
  } catch (e) {
    console.error("shop notify failed", { shopId, error: (e as Error).message });
  }
}
