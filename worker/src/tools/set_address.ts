import { tool } from "ai";
import z from "zod";
import type { Address } from "../order";

/** Save a parsed delivery address. Delegates to the agent's shared setAddress. */
export function setAddressTool({
  setAddress,
}: {
  setAddress: (fields: Partial<Address>) => Address | { error: string };
}) {
  return tool({
    description:
      "Save the customer's delivery address, parsed into parts from what they typed. line1 (street and number), city and postcode are required; line2 and notes (delivery instructions) are optional. Returns the saved address to read back for confirmation, or an error naming what's missing so you can ask the customer for it. Only for delivery orders.",
    inputSchema: z.object({
      line1: z.string().optional().describe("Street address and number."),
      line2: z.string().optional().describe("Flat, unit or second line."),
      city: z.string().optional().describe("City or town."),
      postcode: z.string().optional().describe("Postal / ZIP code."),
      notes: z.string().optional().describe("Delivery instructions."),
    }),
    execute: (fields) => setAddress(fields),
  });
}
