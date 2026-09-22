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
      className="text-[11px] tracking-[0.12em] uppercase text-white/40 hover:text-white/80 transition-colors whitespace-nowrap"
    >
      Log out
    </button>
  );
}
