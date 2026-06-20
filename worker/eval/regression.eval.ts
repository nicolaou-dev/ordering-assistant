// Eval suite: the main order flows as realistic customer conversations. Gated by
// `pnpm worker eval` (evalite run --threshold). Three personas — a first-timer who
// browses, a delivery customer who knows the item, and a decisive customer who
// states everything up front — each walking from greeting to a placed order.
//
// Assertions are on outcomes only: the order is placed (submitted), the draft is
// cleared afterwards (empty), and no invented prices (the grounding scorer runs
// on every case automatically). We deliberately do NOT assert which reply type
// the model picks each turn — scripting the replies reintroduces the
// prescriptiveness this rework removed, and is brittle (the model may, say, send
// the menu a turn earlier and still be right). Behavioural/tone checks belong in
// the later depth-eval ticket as rubrics. This suite just confirms the main flows
// complete.

import { orderingEval } from "./harness";

// Pickup, first-timer: greets, browses ("what do you do?"), then clearly asks to
// add an item for pickup and places it.
orderingEval("pickup: browses, then orders for pickup", {
  turns: [
    "hey there!",
    "what kind of stuff do you do?",
    "a falafel sandwich sounds good, can you add one for pickup?",
    "that's everything, thanks",
    "yep, go ahead and place it",
  ],
  expected: {
    submitted: true,
    state: { empty: true },
  },
});

// Delivery: names the item up front, then gives and confirms a delivery address
// before placing. Exercises the address read-back/confirm leg of the flow.
orderingEval("delivery: names item, gives address, places", {
  turns: [
    "hi, can i get a falafel sandwich delivered?",
    "that's everything thanks",
    "sure — 12 Oak Street, Springfield, 12345",
    "yep that's right",
    "great, go ahead and place it",
  ],
  expected: {
    submitted: true,
    state: { empty: true },
  },
});

// Decisive customer who already knows what they want: states item, fulfillment
// and "that's all" in one message, then confirms.
orderingEval("decisive: knows the order, states it up front", {
  turns: [
    "hi, one falafel in a box for pickup please, that's all i need",
    "yep, place it",
  ],
  expected: {
    submitted: true,
    state: { empty: true },
  },
});
