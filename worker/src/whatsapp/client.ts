import { Settings } from "../settings";

export const createClient = (settings: Settings) => {
  return {
    send: async (to: string, body: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
          text: { body },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(`WhatsApp send failed: ${result.status} ${errorBody}`);
      }
    },
    sendImage: async (to: string, imageUrl: string, caption: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
          image: { link: imageUrl, caption },
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
      const apiUrl = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
            body: { text: body },
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
    // An interactive reply-buttons message: a short body plus up to three
    // tappable buttons. Each carries an id we get back as
    // interactive.button_reply.id when the customer taps it. A free session
    // message inside the 24h window.
    sendReplyButtons: async (
      to: string,
      body: string,
      buttons: { id: string; title: string }[],
    ) => {
      const apiUrl = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
            type: "button",
            body: { text: body },
            action: {
              buttons: buttons.map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title },
              })),
            },
          },
        }),
      });

      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(
          `WhatsApp sendReplyButtons failed: ${result.status} ${errorBody}`,
        );
      }
    },
    markReadTyping: async (messageId: string) => {
      const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
