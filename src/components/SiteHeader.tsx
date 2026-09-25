import Link from "next/link";
import type { User } from "@/db/schema";
import LogoutButton from "./LogoutButton";
import ThemeToggle from "./ThemeToggle";

// The team's four working screens come first, exactly as the brief lays them
// out. Data and Exec are reporting surfaces; Exec is admin-only and simply
// isn't rendered for anyone else.
//
// New Proposal is deliberately NOT in this list. It is the primary action, not
// a destination, so it lives once as the red button on the right. Having it in
// both places made the same thing look like two different features.

export type NavKey = "newproposal" | "attention" | "pipeline" | "proposals" | "closed" | "data" | "exec" | "invoice" | "admin";

const PRIMARY: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "attention", href: "/", label: "Needs Attention" },
  { key: "pipeline", href: "/pipeline", label: "Pipeline" },
  { key: "proposals", href: "/proposals", label: "Proposals" },
  { key: "closed", href: "/closed", label: "Won / Lost" },
  { key: "data", href: "/data", label: "Data" },
];

export default function SiteHeader({ active, user }: { active: NavKey; user: User }) {
  const items = [...PRIMARY];
  if (user.role === "admin") items.push({ key: "exec", href: "/exec", label: "Exec" });
  items.push({ key: "invoice", href: "/invoice", label: "Invoice" });

  return (
    <>
      <div style={{ height: 4, background: "var(--accent)" }} />
      <header style={{ background: "var(--header-bg)" }} className="text-white px-5 md:px-8 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center gap-5">
          <Link href="/" className="flex items-baseline gap-2 flex-shrink-0">
            <span className="text-lg font-bold tracking-tight">EMRG</span>
            <span className="text-lg font-light tracking-[0.18em] hidden sm:inline"
              style={{ color: "var(--header-muted)" }}>MEDIA</span>
          </Link>

          <nav className="flex items-center gap-5 lg:gap-7 overflow-x-auto flex-1 min-w-0 no-scrollbar">
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="text-[11px] tracking-[0.18em] uppercase pb-0.5 whitespace-nowrap transition-colors"
                style={active === item.key
                  ? { color: "var(--header-ink)", borderBottom: "1px solid var(--accent)" }
                  : { color: "rgba(255,255,255,0.45)" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              href="/proposal"
              className="text-[11px] font-bold tracking-[0.16em] uppercase px-3 py-1.5 rounded whitespace-nowrap"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              + Proposal
            </Link>
            <Link
              href="/admin"
              className="text-[11px] tracking-[0.12em] uppercase transition-opacity hidden md:inline"
              style={{ color: "var(--header-muted)" }}
              title={`Signed in as ${user.name}`}
            >
              {user.name.split(" ")[0]}
            </Link>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
    </>
  );
}
