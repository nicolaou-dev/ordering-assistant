import { useEffect, useState } from "react";
import { getToken } from "../lib/cart";

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
