import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSession,verifySession,validateMatchUpdate,handleAdminApi} from "../src/admin.js";
import worker from "../src/worker.js";

const sample=JSON.parse(readFileSync(new URL("../public/demo-data.json",import.meta.url),"utf8"));
const env={
  ADMIN_PASSWORD:"replace-with-strong-secret",
  ADMIN_SESSION_SECRET:"0123456789abcdef0123456789abcdef",
  SHEETS_SPREADSHEET_ID:"test-id",
  SHEETS_CLIENT_EMAIL:"service@example.com",
  SHEETS_PRIVATE_KEY:"mocked-private-key"
};
const base="http://localhost:8787";
const request=(path,method="GET",body,origin=base,cookie="")=>new Request(base+path,{
  method,headers:{
    ...(method==="POST"?{"Origin":origin,"Content-Type":"application/json"}:{}),
    ...(cookie?{Cookie:cookie}:{})
  },...(body!==undefined?{body:JSON.stringify(body)}:{})
});
const pairs=(d,sportId)=>d.matches.filter(m=>m.sportId===sportId)
  .map(m=>[m.sportId,m.id,m.teamA,m.teamB,"","",m.status,m.winnerId,"",""]);
const fakeHandlers={
  getData:async()=>sample,
  saveMatch:async(_env,input)=>{
    let result;
    try{result=validateMatchUpdate(input,sample,pairs(sample,input.sportId))}
    catch(e){if(!e.conflict)e.validation=true;throw e}
    return {sportId:input.sportId,matchId:input.matchId,status:result.status};
  }
};
test("admin sessions are signed, expire, and fail when tampered with",async()=>{
  const start=1700000000;
  const token=await createSession(env.ADMIN_SESSION_SECRET,start);
  assert.equal(await verifySession(token,env.ADMIN_SESSION_SECRET,start+1),true);
  assert.equal(await verifySession(token,env.ADMIN_SESSION_SECRET,start+8*60*60),false);
  assert.equal(await verifySession(token+"x",env.ADMIN_SESSION_SECRET,start+1),false);
  assert.equal(await verifySession(token,"different-secret",start+1),false);
});
test("protected admin data and updates reject anonymous requests",async()=>{
  const get=await handleAdminApi(request("/api/admin/data"),env,fakeHandlers);
  assert.equal(get.status,401);
  const post=await handleAdminApi(request("/api/admin/match","POST",{sportId:"futsal"}),env,fakeHandlers);
  assert.equal(post.status,401);
});
test("login sets HttpOnly SameSite cookie; session and data work",async()=>{
  const login=await handleAdminApi(request("/api/admin/login","POST",{password:env.ADMIN_PASSWORD}),env,fakeHandlers);
  assert.equal(login.status,200);
  const setCookie=login.headers.get("set-cookie");
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/SameSite=Strict/);
  const cookie=setCookie.split(";")[0];
  const session=await handleAdminApi(request("/api/admin/session","GET",undefined,base,cookie),env,fakeHandlers);
  assert.equal((await session.json()).authenticated,true);
  const data=await handleAdminApi(request("/api/admin/data","GET",undefined,base,cookie),env,fakeHandlers);
  assert.equal((await data.json()).teams.length,4);
  const update=await handleAdminApi(request("/api/admin/match","POST",{
    sportId:"futsal",matchId:"R1M1",status:"終了",winnerId:"A",
    expectedStatus:"未開始",expectedWinnerId:""
  },base,cookie),env,fakeHandlers);
  assert.equal(update.status,200);
  assert.equal((await update.json()).ok,true);
  const out=await handleAdminApi(request("/api/admin/logout","POST",{},base,cookie),env,fakeHandlers);
  assert.match(out.headers.get("set-cookie"),/Max-Age=0/);
});
test("login blocks incorrect password and cross-origin POSTs",async()=>{
  const bad=await handleAdminApi(request("/api/admin/login","POST",{password:"wrong"}),env,fakeHandlers);
  assert.equal(bad.status,401);
  const cross=await handleAdminApi(request("/api/admin/login","POST",{password:env.ADMIN_PASSWORD},"https://evil.example"),env,fakeHandlers);
  assert.equal(cross.status,403);
});
test("result update validates pairing, final winner and stale sheet state",()=>{
  const rows=pairs(sample,"futsal");
  const valid={sportId:"futsal",matchId:"R1M1",status:"終了",winnerId:"A",expectedStatus:"未開始",expectedWinnerId:""};
  assert.deepEqual(validateMatchUpdate(valid,sample,rows),{rowIndex:2,status:"終了",winnerId:"A",teamA:"A",teamB:"D"});
  assert.throws(()=>validateMatchUpdate({...valid,winnerId:"B"},sample,rows),/勝者/);
  assert.throws(()=>validateMatchUpdate({...valid,status:"試合中"},sample,rows),/勝者は空欄/);
  assert.throws(()=>validateMatchUpdate({...valid,expectedWinnerId:"D"},sample,rows),e=>e.conflict===true);
  rows[0][3]="B";
  assert.throws(()=>validateMatchUpdate(valid,sample,rows),/組み合わせ/);
});
test("duplicate fixture or absent match row is rejected",()=>{
  const rows=pairs(sample,"futsal");
  const payload={sportId:"futsal",matchId:"R1M1",status:"終了",winnerId:"A",expectedStatus:"未開始",expectedWinnerId:""};
  assert.throws(()=>validateMatchUpdate(payload,sample,[...rows,rows[0]]),/重複/);
  assert.throws(()=>validateMatchUpdate(payload,sample,rows.slice(1)),/存在しない/);
});
test("unconfigured admin cannot log in or save",async()=>{
  const status=await handleAdminApi(request("/api/admin/session"),{},fakeHandlers);
  assert.equal((await status.json()).configured,false);
  const login=await handleAdminApi(request("/api/admin/login","POST",{password:"hello"}),{},fakeHandlers);
  assert.equal(login.status,503);
});
test("worker serves admin page at /admin without exposing data",async()=>{
  const mock={ASSETS:{fetch:async(req)=>new Response("<h1>admin</h1>",{headers:{"Content-Type":"text/html"}})}};
  const response=await worker.fetch(request("/admin"),mock,{});
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.match(response.headers.get("Content-Security-Policy"),/frame-ancestors 'none'/);
});
test("public matrix is explicitly fluid and does not force phone scrolling",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.match(app,/round-robin-frame/);
  assert.doesNotMatch(app,/横方向にスクロールできます/);
  assert.match(css,/\.round-robin-table\{width:100%;min-width:0;max-width:100%/);
  assert.doesNotMatch(css,/\.round-robin-table\{min-width:410px\}/);
  assert.doesNotMatch(css,/\.round-robin-scroll/);
});
