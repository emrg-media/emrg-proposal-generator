import { buildBrief, briefRecipients } from "@/lib/briefService";

// Shows the brief exactly as it will arrive. Same reasoning as the follow-up
// queue: before trusting software to email on a schedule, you should be able to
// read what it is going to say.

export default async function BriefPreview() {
  let brief: Awaited<ReturnType<typeof buildBrief>> | null = null;
  let recipients: string[] = [];
  let error = "";

  try {
    [brief, recipients] = await Promise.all([buildBrief(), briefRecipients()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not build the brief.";
  }

  return (
    <section className="bg-raised border border-line rounded-lg p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--ink)" }}>
          Your daily brief
        </p>
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase px-2 py-1 rounded"
          style={{ background: "var(--sunken)", color: "var(--ink-2)" }}>
          Weekdays, 7am ET
        </span>
      </div>

      <p className="text-[12.5px] text-ink3 mb-4">
        {recipients.length > 0
          ? <>Goes only to {recipients.join(", ")}. Not copied to the shared inbox.</>
          : <>Nobody is set to receive it yet.</>}
        {" "}This is exactly what tomorrow&apos;s will look like with today&apos;s numbers.
      </p>

      {error && <p className="text-[13px]" style={{ color: "var(--accent)" }}>{error}</p>}

      {brief && (
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-sunken border-b border-line">
            <p className="text-[12.5px] font-semibold text-ink">{brief.subject}</p>
          </div>
          <pre className="px-4 py-3 text-[12.5px] leading-relaxed text-ink2 whitespace-pre-wrap font-mono overflow-x-auto">
            {brief.text}
          </pre>
        </div>
      )}
    </section>
  );
}
