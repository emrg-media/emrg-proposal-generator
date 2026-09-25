import { previewFollowups } from "@/lib/followup";
import { fmtDateTime } from "@/lib/time";

// Shows precisely what the automation would send, without sending anything.
// Worth having permanently: before trusting software to email clients on your
// behalf, you should be able to read the actual words first.

export default async function FollowupQueue() {
  const enabled = process.env.FOLLOWUPS_ENABLED === "true";
  let messages: Awaited<ReturnType<typeof previewFollowups>> = [];
  let error = "";

  try {
    messages = await previewFollowups();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not read the follow-up queue.";
  }

  return (
    <section className="bg-raised border border-line rounded-lg p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--ink)" }}>
          Follow-up queue
        </p>
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase px-2 py-1 rounded"
          style={enabled
            ? { background: "var(--good-bg)", color: "var(--good-ink)" }
            : { background: "var(--sunken)", color: "var(--ink-2)" }}>
          {enabled ? "Sending is ON" : "Sending is OFF"}
        </span>
      </div>

      <p className="text-[12.5px] text-ink3 mb-4">
        {enabled
          ? "These go out on the next scheduled run, weekdays at 10am ET."
          : "Nothing is sent while this is off. Set FOLLOWUPS_ENABLED=true in the environment to turn it on."}
        {" "}A live conversation always pauses the sequence.
      </p>

      {error && (
        <p className="text-[13px]" style={{ color: "var(--accent)" }}>{error}</p>
      )}

      {!error && messages.length === 0 && (
        <p className="text-[13px] text-ink3">
          Nothing due. Follow-ups arm themselves when a proposal is sent.
        </p>
      )}

      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.code} className="border border-line rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 bg-sunken border-b border-line">
              <span className="text-[13.5px] font-semibold text-ink">{m.company || m.code}</span>
              <span className="text-[11.5px] text-ink3">
                Follow-up {m.step} · due {fmtDateTime(m.dueAt)}
              </span>
              <span className="text-[11.5px] text-ink3 ml-auto">
                {m.blocked
                  ? <span style={{ color: "var(--accent)" }}>Blocked: {m.blocked}</span>
                  : <>to {m.to}</>}
              </span>
            </div>
            <div className="px-4 py-3">
              <p className="text-[12px] font-semibold text-ink2 mb-1.5">{m.subject}</p>
              <pre className="text-[12.5px] text-ink2 whitespace-pre-wrap font-sans leading-relaxed">
                {m.text}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
