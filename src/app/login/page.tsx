import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import LoginForm from "./LoginForm";

// Server component: the roster is small and fixed, so showing names turns
// login into "tap yourself, type six digits" rather than typing an email.

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let team: Array<{ id: string; name: string }> = [];
  let configError = "";

  try {
    team = await getDb()
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(users.name);
  } catch {
    configError = "The database isn't reachable yet. Check DATABASE_URL, then reload.";
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--surface)" }}>
      <div style={{ height: 4, background: "var(--accent)" }} />
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-baseline gap-2 justify-center mb-8">
            <span className="text-2xl font-bold tracking-tight" style={{ color: "var(--ink)" }}>EMRG</span>
            <span className="text-2xl font-light tracking-[0.18em] text-ink3">MEDIA</span>
          </div>

          {configError ? (
            <div className="bg-raised border border-line rounded-lg p-7 text-center">
              <p className="text-[13px] text-ink2">{configError}</p>
            </div>
          ) : team.length === 0 ? (
            <div className="bg-raised border border-line rounded-lg p-7 text-center">
              <p className="text-[13px] text-ink2">
                No team members yet. Run <code className="font-mono text-[12px]">npm run db:seed</code> to create them.
              </p>
            </div>
          ) : (
            <LoginForm team={team} />
          )}

          <p className="text-[12px] text-ink3 text-center mt-4">EMRG Events Revenue System</p>
        </div>
      </div>
    </div>
  );
}
