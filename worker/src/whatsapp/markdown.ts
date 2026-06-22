// Normalize model-authored Markdown to WhatsApp's formatting syntax at the send
// boundary. The model writes standard Markdown (**bold**, # headings), but
// WhatsApp bold is a single *asterisk* and it has no headings — so without this
// customers see literal `**` and stray `#`. Applied to every outbound text in
// client.ts, so no reply path is missed and the model can't forget mid-chat.
//
// Idempotent: strings the harness already builds with single * (order summary,
// product caption) pass through unchanged — the bold rule only rewrites the
// double-marker forms.
export function toWhatsApp(text: string): string {
  return (
    text
      // Headings (# .. ######) -> a bold line; WhatsApp has no headings.
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, "*$1*")
      // Bold: **x** / __x__ -> *x* (single * is WhatsApp bold).
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/__(.+?)__/g, "*$1*")
      // Strikethrough: ~~x~~ -> ~x~.
      .replace(/~~(.+?)~~/g, "~$1~")
  );
}
