import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getSettings, getRoutingSettings } from "@/lib/settings";
import SiteHeader from "@/components/SiteHeader";
import AdminPanel from "./AdminPanel";
import FollowupQueue from "@/components/FollowupQueue";
import RoutingPanel from "./RoutingPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAdmin();
  const [team, appSettings, routing] = await Promise.all([
    getDb().select().from(users).orderBy(users.name),
    getSettings(),
    getRoutingSettings(),
  ]);

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <SiteHeader active="admin" user={user} />
      <div className="px-5 md:px-8 pt-6 max-w-[1000px] mx-auto">
        <RoutingPanel
          settings={routing}
          team={team.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
        />
        <FollowupQueue />
      </div>
      <AdminPanel
        currentUserId={user.id}
        team={team.map((u) => ({
          id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
          locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
        }))}
        settings={appSettings}
      />
    </div>
  );
}
