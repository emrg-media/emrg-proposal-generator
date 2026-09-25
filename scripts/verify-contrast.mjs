// Walks every screen in both themes and fails on any text under WCAG AA.
// Written as a script so a future change that dims the UI gets caught rather
// than shipped.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PIN = process.env.TEST_PIN || "379659";
const PAGES = ["/", "/?scope=all", "/pipeline", "/proposals", "/closed", "/data", "/exec", "/admin", "/new", "/proposal"];

const AUDIT = `(() => {
  const cv=document.createElement('canvas');cv.width=cv.height=1;
  const cx=cv.getContext('2d',{willReadFrequently:true});

  // Composite the real stack rather than guessing. A translucent panel has to be
  // painted over whatever is actually beneath it; flattening it onto white makes
  // light text on a dark translucent panel look like a failure when it is fine.
  const stackedBg = el => {
    const layers=[];
    let n=el;
    while(n && n!==document.documentElement){
      const b=getComputedStyle(n).backgroundColor;
      if(b && b!=='rgba(0, 0, 0, 0)' && b!=='transparent') layers.push(b);
      n=n.parentElement;
    }
    const root=getComputedStyle(document.body).backgroundColor;
    if(root && root!=='rgba(0, 0, 0, 0)') layers.push(root);
    cx.clearRect(0,0,1,1);
    cx.fillStyle='#ffffff'; cx.fillRect(0,0,1,1);
    for(let i=layers.length-1;i>=0;i--){ cx.fillStyle=layers[i]; cx.fillRect(0,0,1,1); }
    const d=cx.getImageData(0,0,1,1).data;
    return [d[0],d[1],d[2]];
  };

  const over = (color, bg) => {
    cx.clearRect(0,0,1,1);
    cx.fillStyle='rgb('+bg.join(',')+')'; cx.fillRect(0,0,1,1);
    cx.fillStyle=color; cx.fillRect(0,0,1,1);
    const d=cx.getImageData(0,0,1,1).data;
    return [d[0],d[1],d[2]];
  };

  const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};

  const out=[];
  document.querySelectorAll('*').forEach(el=>{
    const t=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');
    if(!t||el.offsetWidth===0||el.offsetHeight===0)return;
    const st=getComputedStyle(el);
    if(st.visibility==='hidden'||st.opacity==='0')return;
    const bg=stackedBg(el);
    const fg=over(st.color,bg);
    const L1=lum(fg),L2=lum(bg);
    const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const size=parseFloat(st.fontSize),bold=parseInt(st.fontWeight)>=700;
    const need=(size>=24||(size>=18.66&&bold))?3:4.5;
    if(ratio<need) out.push({text:t.slice(0,32),px:size,ratio:Math.round(ratio*100)/100,need,color:st.color,bg:'rgb('+bg.join(',')+')'});
  });
  return out;
})()`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Mario Stewart" }).click();
await page.locator('input[type="password"]').fill(PIN);
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });

let total = 0;
for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      void document.documentElement.offsetHeight;
    }, theme);
    // Wait for the switch to actually land. Measuring too early reads the old
    // palette and invents failures that are not there.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(500);
    const fails = await page.evaluate(AUDIT);
    total += fails.length;
    const mark = fails.length === 0 ? "ok " : "BAD";
    console.log(`  ${mark} ${path.padEnd(14)} ${theme.padEnd(5)} ${fails.length}`);
    for (const f of fails.slice(0, 4)) {
      console.log(`        ${f.ratio}:1 (needs ${f.need}) ${f.px}px  "${f.text}"`);
    }
  }
}

await browser.close();
console.log(total === 0 ? "\nEvery screen passes WCAG AA in both themes.\n" : `\n${total} contrast failure(s).\n`);
process.exit(total === 0 ? 0 : 1);
