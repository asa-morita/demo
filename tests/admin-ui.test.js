import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {normalizeData,buildRoundRobin,buildBorrowed} from "../public/bracket.js";
import {TournamentStore} from "../src/store.js";
import worker from "../src/worker.js";

const base="http://localhost:8787";
const html=readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/admin.js",import.meta.url),"utf8")
  .replace(/^import \{[^}]+\} from "\.\/bracket\.js";/m,
    "const {normalizeData,buildRoundRobin,buildBorrowed}=window.__bracket;");
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
async function settle(){for(let i=0;i<4;i++)await tick()}
async function waitFor(check,label="状態の更新"){
  for(let i=0;i<180;i++){
    if(check())return;
    await tick();
  }
  throw new Error(label+"が完了しませんでした");
}

async function setup(){
  let stored;
  const storage={
    get:async()=>stored?structuredClone(stored):undefined,
    transaction:async fn=>fn({
      get:async()=>stored?structuredClone(stored):undefined,
      put:async(_key,value)=>{stored=structuredClone(value)}
    })
  };
  const store=new TournamentStore({storage});
  const env={
    ADMIN_PASSWORD:"test-browser-password",
    ADMIN_SESSION_SECRET:"0123456789abcdef0123456789abcdef",
    TOURNAMENT_STORE:{idFromName:name=>name,get:()=>({fetch:req=>store.fetch(req)})},
    ASSETS:{fetch:async()=>new Response(html,{headers:{"Content-Type":"text/html"}})}
  };
  const dom=new JSDOM(html,{url:base+"/admin",runScripts:"outside-only",pretendToBeVisual:true});
  const {window}=dom;
  window.scrollTo=()=>{window.__scrollCount=(window.__scrollCount||0)+1};
  window.confirm=()=>true;
  window.__bracket={normalizeData,buildRoundRobin,buildBorrowed};
  let cookie="";
  window.fetch=async(url,options={})=>{
    const method=options.method||"GET";
    const headers={...(options.headers||{}),...(cookie?{Cookie:cookie}:{})};
    if(method==="POST")headers.Origin=base;
    const req=new Request(new URL(url,base),{method,headers,...(options.body?{body:options.body}:{})});
    const response=await worker.fetch(req,env);
    const session=response.headers.get("Set-Cookie");
    if(session)cookie=session.split(";")[0];
    return response;
  };
  window.eval(script);
  await waitFor(()=>window.document.querySelector("#loginPanel").hidden===false,"ログイン画面の表示");
  const field=window.document.querySelector("#password");
  field.value="test-browser-password";
  window.document.querySelector("#loginForm").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
  await waitFor(()=>window.document.querySelector("#editorPanel").hidden===false,"管理画面の表示: "+window.document.querySelector("#message").textContent);
  return {dom,document:window.document,window,getData:()=>stored?structuredClone(stored):null,close:()=>window.close()};
}
function change(window,element,value){
  element.value=value;
  element.dispatchEvent(new window.Event("change",{bubbles:true}));
}
function submit(window,form){
  form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
}

test("bottom footer switches all four working editor panels without hiding them",async t=>{
  const ctx=await setup();t.after(ctx.close);
  const {document,window}=ctx;
  const nav=document.querySelector(".admin-bottom-nav");
  assert.ok(nav);
  assert.equal(nav.getAttribute("role"),"tablist");
  assert.equal(nav.querySelectorAll("[data-admin-tab]").length,4);
  assert.equal(nav.hidden,false);
  for(const tab of ["borrowed","sports","overview","matches"]){
    document.querySelector('[data-admin-tab="'+tab+'"]').click();
    assert.equal(document.querySelector("#panel-"+tab).hidden,false,tab);
    assert.equal(document.querySelector("#tab-"+tab).getAttribute("aria-selected"),"true");
    assert.equal([...document.querySelectorAll("section.tab-panel:not([hidden])")].length,1);
    assert.ok(window.__scrollCount>=1);
  }
});

test("borrowed race edits all four-team placements and persists from dedicated footer tab",async t=>{
  const ctx=await setup();t.after(ctx.close);
  const {document,window}=ctx;
  document.querySelector('[data-admin-tab="borrowed"]').click();
  assert.equal(document.querySelector("#heatList form[data-heat-id=H1]")!==null,true);
  assert.equal(document.querySelectorAll("#heatList form[data-heat-id]").length,4);
  assert.equal(document.querySelectorAll("#matchList form[data-match-id]").length,6);
  const form=document.querySelector("#heatList form[data-heat-id=H1]");
  change(window,form.elements.namedItem("status"),"終了");
  for(const [id,rank] of Object.entries({A:"1",B:"2",C:"3",D:"4"})){
    const input=form.elements.namedItem("rank-"+id);
    assert.equal(input.disabled,false);
    change(window,input,rank);
  }
  submit(window,form);
  await waitFor(()=>ctx.getData()?.heats[0].status==="終了","借人競争の保存");
  assert.equal(ctx.getData()?.heats[0].ranks.A,1);
  assert.match(document.querySelector("#heatProgress").textContent,/1\s*\/\s*4/);
  assert.match(document.querySelector("#borrowedStandings").textContent,/Aチーム/);
});

test("tug-of-war fixtures, team names, timetable and points toggle remain editable",async t=>{
  const ctx=await setup();t.after(ctx.close);
  const {document,window}=ctx;
  change(window,document.querySelector("#matchSportSelect"),"tugofwar");
  assert.equal(document.querySelectorAll("#matchList form[data-match-id]").length,6);
  let form=document.querySelector("#matchList form[data-match-id=R1M1]");
  assert.match(form.textContent,/Aチーム/);
  assert.match(form.textContent,/Dチーム/);
  change(window,form.elements.namedItem("status"),"終了");
  change(window,form.elements.namedItem("winnerId"),"A");
  submit(window,form);
  await waitFor(()=>ctx.getData()?.matches.find(m=>m.sportId==="tugofwar"&&m.id==="R1M1")?.winnerId==="A","綱引きの結果保存");
  document.querySelector('[data-admin-tab="sports"]').click();
  change(window,document.querySelector("#sportSelect"),"tugofwar");
  form=document.querySelector("#sportForm");
  change(window,form.elements.namedItem("venue"),"サブアリーナ");
  submit(window,form);
  await waitFor(()=>ctx.getData()?.sports.find(s=>s.id==="tugofwar")?.venue==="サブアリーナ","競技会場の保存");
  document.querySelector('[data-admin-tab="overview"]').click();
  form=document.querySelector("#teamList form[data-team-id=A]");
  change(window,form.elements.namedItem("name"),"赤組");
  submit(window,form);
  await waitFor(()=>ctx.getData()?.teams[0].name==="赤組","チーム名の保存");
  document.querySelector("#togglePointsVisibility").click();
  await waitFor(()=>ctx.getData()?.pointsVisible===false,"ポイントの非表示");
  assert.match(document.querySelector("#pointsVisibilityStatus").textContent,/⁇\?/);
});

test("footer navigation can cancel unsaved changes and restore server values after confirmed discard",async t=>{
  const ctx=await setup();t.after(ctx.close);
  const {document,window}=ctx;
  document.querySelector('[data-admin-tab="overview"]').click();
  let form=document.querySelector("#teamList form[data-team-id=A]");
  change(window,form.elements.namedItem("name"),"未保存チーム");
  window.confirm=()=>false;
  document.querySelector('[data-admin-tab="matches"]').click();
  assert.equal(document.querySelector("#panel-overview").hidden,false);
  window.confirm=()=>true;
  document.querySelector('[data-admin-tab="matches"]').click();
  assert.equal(document.querySelector("#panel-matches").hidden,false);
  document.querySelector('[data-admin-tab="overview"]').click();
  form=document.querySelector("#teamList form[data-team-id=A]");
  assert.equal(form.elements.namedItem("name").value,"Aチーム");
});
