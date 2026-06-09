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
  };
};
