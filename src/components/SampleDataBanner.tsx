import { countSampleRecords } from "@/lib/opportunities";

// Renders nothing once the sample records are gone, so this needs no follow-up
// cleanup — `npm run db:demo -- wipe` removes both the data and this notice.

export default async function SampleDataBanner() {
  let count = 0;
  try {
    count = await countSampleRecords();
  } catch {
    return null; // never let a banner break a page
  }
  if (count === 0) return null;

  return (
    <div className="px-5 md:px-8 pt-4 max-w-[1600px] mx-auto">
      <div className="flex items-start gap-2.5 px-4 py-2.5 rounded-lg border"
        style={{ background: "#fdf6e9", borderColor: "#e7d3a6" }}>
        <span className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full text-[11px] font-bold border flex-shrink-0 mt-[1px]"
          style={{ color: "#92600a", borderColor: "#92600a" }}>i</span>
        <p className="text-[12.5px]" style={{ color: "#7a5309" }}>
          <span className="font-bold">{count} sample opportunit{count === 1 ? "y" : "ies"}</span>{" "}
          are loaded so the screens have something to show. Google, Goldman Sachs and the rest
          are made up &mdash; none of this is real EMRG pipeline. Anything you create yourself is
          real and will stay when the samples are cleared.
        </p>
      </div>
    </div>
  );
}
