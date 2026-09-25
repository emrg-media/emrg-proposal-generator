import { requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/opportunities";
import SiteHeader from "@/components/SiteHeader";
import NewOpportunityForm from "./NewOpportunityForm";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const user = await requireUser();
  const team = await listUsers();

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <SiteHeader active="pipeline" user={user} />
      <NewOpportunityForm
        team={team.map((u) => ({ id: u.id, name: u.name }))}
        currentUserId={user.id}
      />
    </div>
  );
}
