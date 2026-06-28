import { Settings } from "../settings";
import { toWhatsApp } from "./markdown";

// `phoneNumberId` is the sender: the shop's own WhatsApp phone_number_id (its
// shop_id), so a reply goes out from the number the message arrived on. The
// caller passes it from the conversation it's handling — the webhook's inbound
// metadata, an order's shop_id — never a global. The access token stays global:
// one app owns all the numbers today, and a Tech Provider's per-shop token is a
// later change (see 01KV3H2ZKC11SWVP0SRZPYBJ3K).
export const createClient = (settings: Settings, phoneNumberId: string) => {
  return {
    send: async (to: string, body: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
      const result = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: toWhatsApp(body) },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(`WhatsApp send failed: ${result.status} ${errorBody}`);
      }
    },
    sendImage: async (to: string, imageUrl: string, caption: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
      const result = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "image",
          image: { link: imageUrl, caption: toWhatsApp(caption) },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(
          `WhatsApp sendImage failed: ${result.status} ${errorBody}`,
        );
      }
    },
    // An interactive "Call To Action URL" message: a short body plus a single
    // tappable button that opens `url`. WhatsApp renders the button instead of a
    // bare link, so the URL never shows as raw text. A free session message — no
    // template needed inside the 24h window.
    sendCtaUrl: async (
      to: string,
      body: string,
      buttonText: string,
      url: string,
    ) => {
      const apiUrl = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
      const result = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "cta_url",
            body: { text: toWhatsApp(body) },
            action: {
              name: "cta_url",
              parameters: { display_text: buttonText, url },
            },
          },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(
          `WhatsApp sendCtaUrl failed: ${result.status} ${errorBody}`,
        );
      }
    },
    markReadTyping: async (messageId: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
      const result = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(
          `WhatsApp markReadTyping failed: ${result.status} ${errorBody}`,
        );
      }
    },
  };
};
