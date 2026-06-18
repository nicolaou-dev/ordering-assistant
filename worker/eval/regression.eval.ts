// Regression suite: near-deterministic outcomes that must stay green. Gated by
// `pnpm worker eval` (evalite run --threshold). Keep only robust, outcome-based
// checks here — probabilistic behaviour belongs in capability.eval.ts.

import { orderingEval } from "./harness";

orderingEval("greeting: pickup/delivery prompt, no products", {
  turns: ["hi"],
  expected: {
    replies: [
      {
        turn: 0,
        present: ["fulfillment_prompt"],
        // The greeting rides in the fulfillment_prompt's message, so no separate
        // text alongside it.
        absent: ["text", "product_list", "menu", "order_summary"],
      },
    ],
    state: { empty: true },
  },
});

orderingEval("fulfillment recorded, no premature summary", {
  turns: ["hi", "delivery please"],
  expected: {
    replies: [{ turn: 1, absent: ["order_summary"] }],
    state: { fulfillment: "delivery" },
  },
});

orderingEval("tap delivery button: sets fulfillment, continues", {
  turns: [{ tap: "delivery" }],
  expected: {
    state: { fulfillment: "delivery" },
    // The "here's the menu" line rides in the menu reply's message, so no
    // separate text alongside it.
    replies: [{ turn: 0, present: ["menu"], absent: ["text"] }],
  },
});

orderingEval("named item -> product_list", {
  turns: ["for pickup, I'd like a falafel wrap"],
  expected: { replies: [{ turn: 0, present: ["product_list"] }] },
});

orderingEval("add from summary -> no menu", {
  turns: ["pickup, one coca cola", "that's all", "actually add a sprite too"],
  expected: {
    replies: [{ turn: 2, absent: ["menu"] }],
    state: { itemsInclude: ["sprite"] },
  },
});

orderingEval("happy path -> order submitted", {
  turns: ["pickup, one coca cola", "that's all", "yes, confirm and place it"],
  expected: { state: { empty: true }, submitted: true },
});

// Checkout shows the item summary first (so they can catch a wrong item before
// entering an address), then — for delivery — collects the address and places
// the order on the go-ahead.
orderingEval("checkout (delivery): summary first, then address, then submit", {
  turns: [
    "delivery, one coca cola",
    { checkout: true },
    "yep that's right",
    "12 Oak Street, Springfield, 12345",
    "yes, go ahead",
  ],
  expected: {
    replies: [{ turn: 1, present: ["order_summary"] }],
    submitted: true,
  },
});

orderingEval("checkout (pickup): summary, then submit on confirm", {
  turns: ["pickup, one coca cola", { checkout: true }, "yes, place it"],
  expected: {
    replies: [{ turn: 1, present: ["order_summary"] }],
    submitted: true,
  },
});
