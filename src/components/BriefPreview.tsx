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
    <section className="bg-white border border-stone-200 rounded-lg p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "#111111" }}>
          Your daily brief
        </p>
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase px-2 py-1 rounded"
          style={{ background: "#f5f5f4", color: "#57534e" }}>
          Weekdays, 7am ET
        </span>
      </div>

      <p className="text-[12.5px] text-stone-500 mb-4">
        {recipients.length > 0
          ? <>Goes only to {recipients.join(", ")}. Not copied to the shared inbox.</>
          : <>Nobody is set to receive it yet.</>}
        {" "}This is exactly what tomorrow&apos;s will look like with today&apos;s numbers.
      </p>

      {error && <p className="text-[13px]" style={{ color: "var(--emrg-red)" }}>{error}</p>}

      {brief && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100">
            <p className="text-[12.5px] font-semibold text-stone-800">{brief.subject}</p>
          </div>
          <pre className="px-4 py-3 text-[12.5px] leading-relaxed text-stone-700 whitespace-pre-wrap font-mono overflow-x-auto">
            {brief.text}
          </pre>
        </div>
      )}
    </section>
  );
}
