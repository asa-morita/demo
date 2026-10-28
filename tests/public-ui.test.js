import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import * as bracket from "../public/bracket.js";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8")
  .replace(/^import \{[^}]+\} from "\.\/bracket\.js";/m,"const {normalizeData,buildRoundRobin,buildRoundRobinMatrix,buildBorrowed,buildTugOfWar,computeOverall,formatOverallPoints,formatMatchLabel,nextPendingMatch}=window.__bracket;");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const sample=JSON.parse(readFileSync(new URL("../public/demo-data.json",import.meta.url),"utf8"));
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
async function waitFor(check){
  for(let i=0;i<100;i++){
    if(check())return;
    await tick();
  }
  throw new Error("Public bracket did not render");
}
async function setup(){
  let payload=structuredClone(sample);
  const dom=new JSDOM(html,{url:"http://localhost:8787",runScripts:"outside-only",pretendToBeVisual:true});
  const {window}=dom;
  window.__bracket=bracket;
  window.scrollTo=()=>{};
  window.setInterval=fn=>{window.__refresh=fn;return 1};
  window.fetch=async()=>({ok:true,json:async()=>structuredClone(payload)});
  window.eval(script);
  await waitFor(()=>window.document.querySelector("#connectionLabel")?.textContent==="最新データを取得しました");
  const doc=window.document;
  doc.querySelector('[data-tab="bracket"]').click();
  const selectSport=id=>doc.querySelector('[data-sport="'+id+'"]').click();
  return {
    document:doc,selectSport,
    update:async change=>{change(payload);await window.__refresh()},
    close:()=>window.close()
  };
}

test("next head-to-head match highlights two mirrored light-blue cells and advances after a result",async t=>{
  const page=await setup();t.after(page.close);
  page.selectSport("basketball");
  const cells=()=>[...page.document.querySelectorAll("#view td.matrix-next")];
  assert.equal(cells().length,2);
  assert.equal(cells().every(cell=>cell.getAttribute("title").includes("第1試合")),true);
  assert.equal(cells().every(cell=>cell.getAttribute("aria-label").includes("次の試合")),true);
  assert.match(page.document.querySelector(".matrix-help").textContent,/水色/);
  assert.match(page.document.querySelector(".matrix-legend").textContent,/次の試合/);
  await page.update(data=>{
    const first=data.matches.find(m=>m.sportId==="basketball"&&m.id==="R3M1");
    first.status="終了";first.winnerId="A";
  });
  assert.equal(cells().length,2);
  assert.equal(cells().every(cell=>cell.title.includes("第2試合")),true);
  await page.update(data=>{
    for(const m of data.matches.filter(m=>m.sportId==="basketball")){
      m.status="終了";m.winnerId=m.teamA;
    }
  });
  assert.equal(cells().length,0);
});

test("tug-of-war highlights only the next 2v2 match, then moves to the second card",async t=>{
  const page=await setup();t.after(page.close);
  page.selectSport("tugofwar");
  const highlighted=()=>[...page.document.querySelectorAll("#view .tug-fixture.next-match")];
  assert.equal(highlighted().length,1);
  assert.match(highlighted()[0].textContent,/第1試合.*次の試合/);
  assert.match(highlighted()[0].textContent,/Aチーム/);
  assert.match(highlighted()[0].textContent,/Dチーム/);
  await page.update(data=>{
    const first=data.matches.find(m=>m.sportId==="tugofwar"&&m.id==="T1");
    first.status="終了";first.winnerId="A+B";
  });
  assert.equal(highlighted().length,1);
  assert.match(highlighted()[0].textContent,/第2試合.*次の試合/);
});

test("borrowed-person heats show the next unstarted round in light blue",async t=>{
  const page=await setup();t.after(page.close);
  page.selectSport("borrowed");
  const highlighted=()=>[...page.document.querySelectorAll("#view .borrowed-heat.next-match")];
  assert.equal(highlighted().length,1);
  assert.match(highlighted()[0].textContent,/第1回/);
  assert.match(highlighted()[0].textContent,/次の回/);
  await page.update(data=>{
    data.heats[0].status="終了";
    data.heats[0].ranks={A:1,B:2,C:3,D:4};
  });
  assert.equal(highlighted().length,1);
  assert.match(highlighted()[0].textContent,/第2回/);
});

test("light blue is explicitly applied to the matrix and next event cards",()=>{
  assert.match(css,/td\.matrix-next\{background:#c9efff/);
  assert.match(css,/\.result-row\.next-match,\.borrowed-heat\.next-match\{background:#c9efff/);
});
