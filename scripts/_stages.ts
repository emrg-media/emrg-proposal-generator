import { getDb } from "../src/db";
import { opportunities } from "../src/db/schema";
const EXPECTED: Record<string,string> = {
  "Google":"new_lead","Goldman Sachs":"proposal_review","Acme Corp":"client_reviewing",
  "ABC Corp":"proposal_sent","Northwind Traders":"proposal_sent","Harbour Foundation":"new_lead",
  "Vertex Labs":"contacted","Sterling Financial":"won","Brightpath Health":"lost",
};
async function main(){
  const rows = await getDb().select().from(opportunities).orderBy(opportunities.company);
  let bad=0;
  for (const o of rows) {
    const want = EXPECTED[o.company];
    const ok = want === o.stage;
    if(!ok) bad++;
    console.log(`  ${ok?"ok ":"BAD"} ${o.company.padEnd(22)} got=${o.stage.padEnd(17)} want=${want}`);
  }
  console.log(bad===0 ? "\n  seed matches the script" : `\n  ${bad} record(s) differ immediately after seeding`);
}
main().then(()=>process.exit(0));
