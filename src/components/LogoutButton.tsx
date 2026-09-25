"use client";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logout: true }),
        }).catch(() => {});
        window.location.href = "/login";
      }}
      className="text-[11px] tracking-[0.12em] uppercase transition-opacity hover:opacity-100 whitespace-nowrap"
      style={{ color: "var(--header-muted)", opacity: 0.85 }}
    >
      Log out
    </button>
  );
}
