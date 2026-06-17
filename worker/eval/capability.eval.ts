// Capability suite: probabilistic behaviour, personas, and known gaps. Measured
// (trialCount > 1 for a stable pass-rate) and inspected via `pnpm worker eval:all`
// or the watch UI — NOT gated, since a single run is a noisy sample and some
// cases document gaps we haven't fixed yet.

import { orderingEval } from "./harness";

orderingEval("menu offered after fulfillment", {
  turns: ["hi", "pickup"],
  expected: { replies: [{ turn: 1, present: ["menu"] }] },
  trialCount: 3,
});

orderingEval("broad term -> helpful, doesn't over-list", {
  turns: ["what pizzas do you have?"],
  expected: {
    rubric: "Did the assistant avoid dumping every product as text, and either show a few cards, offer the menu, or ask the customer to narrow down?",
  },
  trialCount: 3,
});

orderingEval("no match -> alternative, not a flat no", {
  turns: ["do you have any sushi for pickup?"],
  expected: {
    replies: [{ turn: 0, absent: ["product_list"] }],
    rubric: "The shop has no sushi. Did the assistant avoid a bare 'no' and point the customer somewhere useful (an alternative and/or the menu)?",
  },
  trialCount: 3,
});

orderingEval("anything-else before summary", {
  turns: ["pickup, one coca cola please", "that's all thanks"],
  expected: {
    replies: [
      { turn: 0, absent: ["order_summary"] },
      { turn: 1, present: ["order_summary"] },
    ],
    state: { itemCount: 1 },
  },
  trialCount: 3,
});

orderingEval("[persona] terse one-word customer", {
  turns: ["pickup", "coca cola", "done"],
  expected: {
    state: { itemsInclude: ["cola"] },
    rubric: "The customer is extremely terse. Did the assistant keep up, infer intent, and move the order forward without getting confused?",
  },
  trialCount: 3,
});

orderingEval("[persona] indecisive browser", {
  turns: ["hey what do you have? pickup", "hmm not sure, maybe something with falafel?", "ok what's in the falafel wrap"],
  expected: {
    rubric: "The customer is indecisive and browsing. Did the assistant stay patient and helpful, ground its answers in the catalog, and guide them toward a choice without being pushy?",
  },
  trialCount: 3,
});

orderingEval("delivery address read back labelled, then confirm", {
  turns: [
    "delivery please, can I get a coca cola",
    "that's everything",
    "deliver to 12 Oak Street, Springfield, 12345",
  ],
  expected: {
    state: { fulfillment: "delivery" },
    rubric:
      "After the customer gives their delivery address, did the assistant read it back with labelled fields (e.g. an Address line, City, Postcode) and ask the customer to confirm it's correct before moving on?",
  },
  trialCount: 3,
});

orderingEval("post-submit reply: awaiting approval + total, no order id", {
  turns: ["pickup, one coca cola", "that's all", "yes, confirm and place it"],
  expected: {
    submitted: true,
    rubric:
      "After the order is placed, did the assistant tell the customer it's been sent to the shop for approval and that they'll be notified once it's confirmed, include the order total, and avoid reading out any order id / reference number?",
  },
  trialCount: 3,
});

orderingEval("summary step: show, ask, wait — no premature 'placed'", {
  turns: [
    "pickup, one coca cola",
    "that's all",
    "actually add a sprite",
    "yep that's right, go ahead",
  ],
  expected: {
    replies: [
      { turn: 1, present: ["order_summary"] },
      { turn: 2, present: ["order_summary"], absent: ["menu"] },
    ],
    submitted: true,
    rubric:
      "At the summary step the assistant shows the order and clearly asks the customer to confirm, and does not use wording implying the order is already placed/done before the customer has confirmed. An edit ('add a sprite') updates the order and re-shows the summary. Only after the customer confirms is the order placed.",
  },
  trialCount: 3,
});

orderingEval("[known gap] finds 'tahini pie'", {
  turns: ["for pickup, can I get a tahini pie?"],
  expected: { replies: [{ turn: 0, present: ["product_list"], absent: ["menu"] }] },
  trialCount: 3,
});
