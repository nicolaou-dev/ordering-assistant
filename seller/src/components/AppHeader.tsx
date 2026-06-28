import { useState, type ReactNode } from "react";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { authClient } from "../lib/auth";

// Top nav shared by the seller's top-level pages (Orders, Media). Each is its
// own route, so these are real links with the current one highlighted, plus the
// account menu on the right. Settings stays a sub-page reached from that menu.
export function AppHeader({ current }: { current: "orders" | "media" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <nav className="flex min-w-0 gap-1">
        <NavLink href="/" active={current === "orders"}>
          Orders
        </NavLink>
        <NavLink href="/media" active={current === "media"}>
          Media
        </NavLink>
      </nav>
      <AccountMenu />
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? "bg-muted" : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </a>
  );
}

// The signed-in user's menu. Neon Auth's UserButton renders a Radix dropdown
// that doesn't open on iOS (an upstream Radix/WebKit bug, no modal/prop fix), so
// we use a plain button toggle — native onClick fires reliably on iOS, the same
// way the sign-in form's button does. Still Neon Auth underneath: useSession for
// the user, signOut to end the session (which flips back to <SignedOut>).
function AccountMenu() {
  const [open, setOpen] = useState(false);
  const { data } = authClient.useSession();
  const user = data?.user;
  if (!user) return null;
  const initials = (user.name || user.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const avatar = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {initials}
    </span>
  );
  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
      >
        {avatar}
        <span className="min-w-0 text-left leading-tight">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown className="ml-1 size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          {/* tap-away backdrop */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              {avatar}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
            <div className="my-1 h-px bg-border" />
            <a
              role="menuitem"
              href="/settings"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Settings className="size-4 text-muted-foreground" />
              Settings
            </a>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void authClient.signOut();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <LogOut className="size-4 text-muted-foreground" />
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
