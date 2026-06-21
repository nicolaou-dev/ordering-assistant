import { tool } from "ai";
import z from "zod";
import { setNote, type OrderState } from "../order";

/** Record an order-level note. Reads and writes the agent's state. */
export function setNoteTool({
  getState,
  setState,
}: {
  getState: () => OrderState;
  setState: (state: OrderState) => void;
}) {
  return tool({
    description:
      "Save a note for the whole order — a special instruction the customer gives, like 'no nuts', 'leave at the door', or 'call on arrival'. Record exactly what they asked for; The note rides with the order to the shop. Returns the saved note so you can read it back to confirm. Call again to update it, or call with no note to clear it.",
    inputSchema: z.object({
      note: z
        .string()
        .optional()
        .describe(
          "The customer's instruction, in their words. Omit to clear the note.",
        ),
    }),
    execute: async ({ note }) => {
      const next = setNote(getState(), note ?? "");
      setState(next);
      return { note: next.note };
    },
  });
}
