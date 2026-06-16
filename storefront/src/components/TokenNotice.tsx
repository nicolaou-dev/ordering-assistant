import { useEffect, useState } from "react";
import { getToken } from "../lib/cart";

// Shown at the top when the customer arrives without a cart token (i.e. not from
// their WhatsApp chat): the page is browse-only until they open it from there.
// Renders nothing during SSR/with a token, so token users never see a flash.
export default function TokenNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(!getToken()), []);

  if (!show) return null;
  return (
    <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Open WhatsApp to start an order.
    </p>
  );
}
