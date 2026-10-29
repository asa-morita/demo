import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createSession,verifySession,handleAdminApi} from "../src/admin.js";
import {createDefaultData,ensureHeats,applyUpdate,TournamentStore} from "../src/store.js";
import worker from "../src/worker.js";

const base="http://localhost:8787";
const password="replace-with-strong-secret";
const sessionSecret="0123456789abcdef0123456789abcdef";
const request=(path,method="GET",body,origin=base,cookie="")=>new Request(base+path,{
  method,headers:{
    ...(method==="POST"?{"Origin":origin,"Content-Type":"application/json"}:{}),
    ...(cookie?{Cookie:cookie}:{})
  },
  ...(body===undefined?{}:{body:JSON.stringify(body)})
});
function setup(){
  let persisted;
  const storage={
    async get(){return persisted?structuredClone(persisted):undefined},
    async transaction(callback){
      const transaction={
        get:async()=>persisted?structuredClone(persisted):undefined,
        put:async(_key,data)=>{persisted=structuredClone(data)}
      };
      return callback(transaction);
    }
  };
  const store=new TournamentStore({storage});
  const env={
    ADMIN_PASSWORD:password,
    ADMIN_SESSION_SECRET:sessionSecret,
    TOURNAMENT_STORE:{
      idFromName:name=>name,
      get:()=>({fetch:request=>store.fetch(request)})
    },
    ASSETS:{fetch:async()=>new Response("<h1>admin</h1>",{headers:{"Content-Type":"text/html"}})}
  };
  return {env,store,getSaved:()=>persisted};
}
async function login(env){
  const response=await worker.fetch(request("/api/admin/login","POST",{password}),env);
  assert.equal(response.status,200);
  return response.headers.get("set-cookie").split(";")[0];
}
const savedMatch=(data,id="R1M1",sportId="futsal")=>data.matches.find(m=>m.sportId===sportId&&m.id===id);
const initialMatch={
  sportId:"futsal",matchId:"R1M1",status:"終了",winnerId:"A",
  court:"Aコート",scheduledAt:"13:00",
  expectedStatus:"未開始",expectedWinnerId:"",
  expectedCourt:"",expectedScheduledAt:""
};

test("score validation rejects invalid pairs and stale scores, and old clients preserve scores",()=>{
  const data=createDefaultData();
  const payload={...initialMatch,scoreA:0,scoreB:12,expectedScoreA:null,expectedScoreB:null};
  for(const value of [-1,1.5,10000,"12",true,Infinity]){
    assert.throws(()=>applyUpdate(data,"match",{...payload,scoreA:value}),/得点/);
  }
  assert.throws(()=>applyUpdate(data,"match",{...payload,scoreA:null}),/両チーム/);
  applyUpdate(data,"match",payload);
  assert.equal(savedMatch(data).scoreA,0);
  assert.equal(savedMatch(data).scoreB,12);
  const current={...payload,expectedStatus:"終了",expectedWinnerId:"A",expectedCourt:"Aコート",expectedScheduledAt:"13:00"};
  assert.throws(()=>applyUpdate(data,"match",{...current,scoreA:1}),e=>e.conflict===true);
  const {scoreA,scoreB,expectedScoreA,expectedScoreB,...oldClient}=current;
  applyUpdate(data,"match",oldClient);
  assert.equal(savedMatch(data).scoreB,12);
  applyUpdate(data,"match",{...current,scoreA:null,scoreB:null,expectedScoreA:0,expectedScoreB:12});
  assert.equal(savedMatch(data).scoreA,null);
  assert.equal(savedMatch(data).scoreB,null);
});

test("signed admin session expires and rejects modified signatures",async()=>{
  const token=await createSession(sessionSecret,1700000000);
  assert.equal(await verifySession(token,sessionSecret,1700000001),true);
  assert.equal(await verifySession(token,sessionSecret,1700028800),false);
  assert.equal(await verifySession(token+"x",sessionSecret,1700000001),false);
  assert.equal(await verifySession(token,"incorrect-secret",1700000001),false);
});
test("default store creates 4 teams, 6 sports, and unplayed fixtures",()=>{
  const data=createDefaultData();
  assert.equal(data.teams.length,4);
  assert.equal(data.sports.length,6);
  assert.deepEqual(data.sports.map(s=>s.id),["volleyball","basketball","futsal","dodgeball","tugofwar","borrowed"]);
  assert.deepEqual(data.sports.map(s=>s.order),[1,2,3,4,5,6]);
  assert.equal(data.matches.length,27);
  assert.equal(data.matches.filter(m=>m.sportId==="tugofwar").length,3);
  assert.deepEqual(data.matches.filter(m=>m.sportId==="tugofwar").map(m=>[m.id,m.teamA,m.teamB]),[
    ["T1","A+B","C+D"],["T2","A+C","B+D"],["T3","A+D","B+C"]
  ]);
  assert.equal(data.heats.length,4);
  assert.equal(data.matches.some(m=>m.sportId==="borrowed"),false);
  assert.equal(data.matches.every(m=>m.status==="未開始"&&m.winnerId===""),true);
  assert.equal(data.source,"admin");
});
test("legacy tournament schedules migrate once without resetting sports details or results",()=>{
  const old=createDefaultData();
  const byId=id=>old.sports.find(s=>s.id===id);
  delete old.sportsOrderVersion;
  byId("futsal").order=1;
  byId("volleyball").order=2;
  byId("basketball").order=3;
  byId("dodgeball").name="ドッチボール";
  byId("futsal").startTime="14:30";
  byId("futsal").venue="アリーナ";
  const match=savedMatch(old);
  match.status="終了";match.winnerId="A";
  const next=ensureHeats(old);
  assert.deepEqual(next.sports.map(s=>[s.id,s.order]),[
    ["volleyball",1],["basketball",2],["futsal",3],
    ["dodgeball",4],["tugofwar",5],["borrowed",6]
  ]);
  assert.equal(next.sports.find(s=>s.id==="dodgeball").name,"ドッジボール");
  assert.equal(next.sports.find(s=>s.id==="futsal").startTime,"14:30");
  assert.equal(next.sports.find(s=>s.id==="futsal").venue,"アリーナ");
  assert.equal(savedMatch(next).winnerId,"A");
  assert.equal(next.sportsOrderVersion,1);
  const manuallyChanged=structuredClone(next);
  manuallyChanged.sports.find(s=>s.id==="basketball").order=9;
  assert.equal(ensureHeats(manuallyChanged).sports.find(s=>s.id==="basketball").order,9);
});

test("legacy tug-of-war records migrate to three new alliance fixtures without altering other sports",()=>{
  const old=createDefaultData();
  delete old.tugFormatVersion;
  const futsal=savedMatch(old);
  futsal.status="終了";futsal.winnerId="A";
  const ancient=[
    {sportId:"tugofwar",id:"R1M1",teamA:"A",teamB:"D",status:"終了",winnerId:"A",court:"",scheduledAt:"13:00"},
    {sportId:"tugofwar",id:"R1M2",teamA:"B",teamB:"C",status:"未開始",winnerId:"",court:"",scheduledAt:""}
  ];
  old.matches=old.matches.filter(m=>m.sportId!=="tugofwar").concat(ancient);
  const next=ensureHeats(old);
  assert.equal(next.tugFormatVersion,1);
  assert.deepEqual(next.legacyTugMatches,ancient);
  assert.deepEqual(next.matches.filter(m=>m.sportId==="tugofwar").map(m=>m.id),["T1","T2","T3"]);
  assert.equal(savedMatch(next).winnerId,"A");
  next.matches.find(m=>m.id==="T1"&&m.sportId==="tugofwar").winnerId="A+B";
  const upgraded=ensureHeats(next);
  assert.equal(upgraded.matches.find(m=>m.id==="T1"&&m.sportId==="tugofwar").winnerId,"A+B");
  assert.equal(upgraded.legacyTugMatches.length,2);
});

test("tug-of-war update only accepts winning two-team alliances",()=>{
  const data=createDefaultData();
  const payload={
    sportId:"tugofwar",matchId:"T1",status:"終了",winnerId:"A+B",
    court:"北側",scheduledAt:"16:00",expectedStatus:"未開始",
    expectedWinnerId:"",expectedCourt:"",expectedScheduledAt:""
  };
  assert.throws(()=>applyUpdate(data,"match",{...payload,winnerId:"A"}),/勝者/);
  assert.throws(()=>applyUpdate(data,"match",{...payload,winnerId:"A+C"}),/勝者/);
  assert.throws(()=>applyUpdate(data,"match",{...payload,matchId:"R3M1"}),/対戦カード/);
  assert.deepEqual(applyUpdate(data,"match",payload),{
    sportId:"tugofwar",matchId:"T1",status:"終了",winnerId:"A+B"
  });
  assert.equal(savedMatch(data,"T1","tugofwar").court,"北側");
  assert.throws(()=>applyUpdate(data,"match",payload),e=>e.conflict===true);
});

test("authenticated worker saves tug results and uses the new three-match schema",async()=>{
  const {env}=setup();const cookie=await login(env);
  const payload={sportId:"tugofwar",matchId:"T2",status:"終了",winnerId:"B+D",court:"",
    scheduledAt:"",expectedStatus:"未開始",expectedWinnerId:"",expectedCourt:"",expectedScheduledAt:""};
  const saved=await worker.fetch(request("/api/admin/match","POST",payload,base,cookie),env);
  assert.equal(saved.status,200);
  const results=await (await worker.fetch(request("/api/results"),env)).json();
  assert.equal(results.matches.filter(m=>m.sportId==="tugofwar").length,3);
  assert.equal(savedMatch(results,"T2","tugofwar").winnerId,"B+D");
  assert.equal((await worker.fetch(request("/api/admin/match","POST",payload,base,cookie),env)).status,409);
});

test("match update checks winner, current version, and fixture",()=>{
  const data=createDefaultData();
  assert.throws(()=>applyUpdate(data,"match",{...initialMatch,winnerId:"B"}),/勝者/);
  assert.throws(()=>applyUpdate(data,"match",{...initialMatch,status:"試合中"}),/勝者は空欄/);
  assert.throws(()=>applyUpdate(data,"match",{...initialMatch,expectedStatus:"試合中"}),e=>e.conflict===true);
  assert.deepEqual(applyUpdate(data,"match",initialMatch),{
    sportId:"futsal",matchId:"R1M1",status:"終了",winnerId:"A"
  });
  assert.equal(savedMatch(data).court,"Aコート");
  assert.throws(()=>applyUpdate(data,"match",initialMatch),e=>e.conflict===true);
  const unmatched=createDefaultData();savedMatch(unmatched).teamB="B";
  assert.throws(()=>applyUpdate(unmatched,"match",initialMatch),/一致しません/);
});
test("team and sport updates check constraints and stale versions",()=>{
  const data=createDefaultData();
  assert.deepEqual(applyUpdate(data,"team",{id:"A",name:"青組",expectedName:"Aチーム"}),{id:"A",name:"青組"});
  assert.equal(data.teams[0].name,"青組");
  assert.throws(()=>applyUpdate(data,"team",{id:"A",name:"赤組",expectedName:"Aチーム"}),e=>e.conflict);
  const sport={
    id:"futsal",name:"フットサル男子",order:8,startTime:"13:00",endTime:"14:30",venue:"主体育館",
    expectedName:"フットサル",expectedOrder:3,expectedStartTime:"",expectedEndTime:"",expectedVenue:""
  };
  applyUpdate(data,"sport",sport);
  assert.equal(data.sports.find(s=>s.id==="futsal").venue,"主体育館");
  assert.equal(data.sports.find(s=>s.id==="futsal").order,8);
  assert.throws(()=>applyUpdate(data,"sport",sport),e=>e.conflict);
  const bad=createDefaultData();
  assert.throws(()=>applyUpdate(bad,"sport",{...sport,endTime:"12:30"}),/終了時刻/);
});
test("anonymous and cross-origin requests cannot edit",async()=>{
  const {env}=setup();
  assert.equal((await worker.fetch(request("/api/admin/data"),env)).status,401);
  assert.equal((await worker.fetch(request("/api/admin/match","POST",initialMatch),env)).status,401);
  const cross=await worker.fetch(request("/api/admin/login","POST",{password},"https://evil.example"),env);
  assert.equal(cross.status,403);
  const wrong=await worker.fetch(request("/api/admin/login","POST",{password:"wrong"}),env);
  assert.equal(wrong.status,401);
});
test("worker stores team, sport and match edits and serves them publicly",async()=>{
  const {env,getSaved}=setup();
  const before=await worker.fetch(request("/api/results"),env);
  assert.equal(before.status,200);
  const first=await before.json();
  assert.equal(first.source,"admin");
  assert.equal(first.matches[0].status,"未開始");
  const cookie=await login(env);
  const session=await worker.fetch(request("/api/admin/session","GET",undefined,base,cookie),env);
  assert.equal((await session.json()).authenticated,true);
  const team=await worker.fetch(request("/api/admin/team","POST",{
    id:"A",name:"青組",expectedName:"Aチーム"
  },base,cookie),env);
  assert.equal(team.status,200);
  const sport=await worker.fetch(request("/api/admin/sport","POST",{
    id:"futsal",name:"ミニサッカー",order:1,startTime:"12:45",endTime:"14:00",venue:"屋内",
    expectedName:"フットサル",expectedOrder:3,expectedStartTime:"",expectedEndTime:"",expectedVenue:""
  },base,cookie),env);
  assert.equal(sport.status,200);
  const match=await worker.fetch(request("/api/admin/match","POST",initialMatch,base,cookie),env);
  assert.equal(match.status,200);
  const conflict=await worker.fetch(request("/api/admin/match","POST",initialMatch,base,cookie),env);
  assert.equal(conflict.status,409);
  const after=await (await worker.fetch(request("/api/results"),env)).json();
  assert.equal(after.teams[0].name,"青組");
  assert.equal(after.sports.find(s=>s.id==="futsal").name,"ミニサッカー");
  assert.equal(savedMatch(after).status,"終了");
  assert.equal(savedMatch(after).winnerId,"A");
  assert.ok(after.updatedAt);
  assert.equal(savedMatch(getSaved()).winnerId,"A");
  const logout=await worker.fetch(request("/api/admin/logout","POST",{},base,cookie),env);
  assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
});
test("without storage binding, public and admin data fail closed",async()=>{
  const {env}=setup();
  delete env.TOURNAMENT_STORE;
  const publicResult=await worker.fetch(request("/api/results"),env);
  assert.equal(publicResult.status,503);
  const status=await handleAdminApi(request("/api/admin/session"),env,{});
  assert.equal((await status.json()).storageReady,false);
});
test("worker serves a no-store admin HTML shell",async()=>{
  const {env}=setup();
  const response=await worker.fetch(request("/admin"),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.match(response.headers.get("Content-Security-Policy"),/frame-ancestors 'none'/);
});
test("public matrix remains phone-sized without horizontal scrolling",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.match(app,/round-robin-frame/);
  assert.match(css,/\.round-robin-table\{width:100%;min-width:0;max-width:100%/);
  assert.doesNotMatch(css,/\.round-robin-scroll/);
});
test("Google APIs and secrets are not used in worker code",()=>{
  const source=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
  const admin=readFileSync(new URL("../src/admin.js",import.meta.url),"utf8");
  assert.doesNotMatch(source+admin,/SHEETS_|sheets.googleapis.com|oauth2.googleapis.com/);
});

test("borrowed-race heat edits require distinct 1-4 places and reject stale edits",()=>{
  const data=createDefaultData();
  const input={
    heatId:"H1",status:"終了",ranks:{A:1,B:2,C:3,D:4},
    scheduledAt:"15:00",expectedStatus:"未開始",
    expectedRanks:{A:0,B:0,C:0,D:0},expectedScheduledAt:""
  };
  assert.throws(()=>applyUpdate(data,"heat",{...input,ranks:{A:1,B:1,C:3,D:4}}),/重複/);
  assert.throws(()=>applyUpdate(data,"heat",{...input,ranks:{A:1,B:2,C:3,D:0}}),/重複/);
  assert.throws(()=>applyUpdate(data,"heat",{...input,status:"試合中"}),/空欄/);
  assert.deepEqual(applyUpdate(data,"heat",input),{
    heatId:"H1",status:"終了",ranks:{A:1,B:2,C:3,D:4}
  });
  assert.throws(()=>applyUpdate(data,"heat",input),e=>e.conflict);
  assert.equal(data.heats[0].scheduledAt,"15:00");
  assert.throws(()=>applyUpdate(data,"match",{...initialMatch,sportId:"borrowed"}),/4回制/);
});
test("legacy tournament storage adds empty heat entries without modifying old results",()=>{
  const data=createDefaultData();
  delete data.heats;
  const before=JSON.stringify(data.matches);
  const migrated=ensureHeats(data);
  assert.equal(migrated.heats.length,4);
  assert.equal(JSON.stringify(migrated.matches),before);
  assert.equal(migrated.heats[0].status,"未開始");
});
test("authenticated heat saves persist across reads and reject anonymous access",async()=>{
  const {env}=setup();
  const input={heatId:"H2",status:"終了",ranks:{A:2,B:3,C:1,D:4},
    scheduledAt:"14:30",expectedStatus:"未開始",
    expectedRanks:{A:0,B:0,C:0,D:0},expectedScheduledAt:""};
  assert.equal((await worker.fetch(request("/api/admin/heat","POST",input),env)).status,401);
  const cookie=await login(env);
  const saved=await worker.fetch(request("/api/admin/heat","POST",input,base,cookie),env);
  assert.equal(saved.status,200);
  const data=await (await worker.fetch(request("/api/results"),env)).json();
  assert.deepEqual(data.heats[1].ranks,input.ranks);
  assert.equal(data.heats[1].scheduledAt,"14:30");
  assert.equal((await worker.fetch(request("/api/admin/heat","POST",input,base,cookie),env)).status,409);
});

test("overall point visibility defaults to shown, persists, and handles old records",()=>{
  const current=createDefaultData();
  assert.equal(current.pointsVisible,true);
  const old=structuredClone(current);
  delete old.pointsVisible;
  assert.equal(ensureHeats(old).pointsVisible,true);
  const saved=applyUpdate(current,"settings",{pointsVisible:false,expectedPointsVisible:true});
  assert.deepEqual(saved,{pointsVisible:false});
  assert.equal(current.pointsVisible,false);
  assert.equal(ensureHeats(current).pointsVisible,false);
  assert.throws(()=>applyUpdate(current,"settings",{pointsVisible:true,expectedPointsVisible:true}),e=>e.conflict===true);
  assert.throws(()=>applyUpdate(current,"settings",{pointsVisible:"false",expectedPointsVisible:false}),/不正/);
  assert.throws(()=>applyUpdate(current,"settings",{pointsVisible:true}),/不正/);
  assert.equal(current.teams.length,4);
  assert.equal(current.matches.length,27);
});
test("admin can hide and restore overall points without modifying results",async()=>{
  const {env,getSaved}=setup();
  const publicBefore=await (await worker.fetch(request("/api/results"),env)).json();
  assert.equal(publicBefore.pointsVisible,true);
  const beforeMatches=JSON.stringify(publicBefore.matches);
  const cookie=await login(env);
  const hide={pointsVisible:false,expectedPointsVisible:true};
  assert.equal((await worker.fetch(request("/api/admin/settings","POST",hide),env)).status,401);
  assert.equal((await worker.fetch(request("/api/admin/settings","POST",hide,"https://evil.example",cookie),env)).status,403);
  const hidden=await worker.fetch(request("/api/admin/settings","POST",hide,base,cookie),env);
  assert.equal(hidden.status,200);
  assert.equal((await hidden.json()).pointsVisible,false);
  assert.equal(getSaved().pointsVisible,false);
  assert.equal((await worker.fetch(request("/api/admin/settings","POST",hide,base,cookie),env)).status,409);
  const invalid=await worker.fetch(request("/api/admin/settings","POST",{
    pointsVisible:"false",expectedPointsVisible:false
  },base,cookie),env);
  assert.equal(invalid.status,400);
  const publicHidden=await (await worker.fetch(request("/api/results"),env)).json();
  assert.equal(publicHidden.pointsVisible,false);
  assert.equal(JSON.stringify(publicHidden.matches),beforeMatches);
  assert.ok(publicHidden.updatedAt);
  const shown=await worker.fetch(request("/api/admin/settings","POST",{
    pointsVisible:true,expectedPointsVisible:false
  },base,cookie),env);
  assert.equal(shown.status,200);
  const publicRestored=await (await worker.fetch(request("/api/results"),env)).json();
  assert.equal(publicRestored.pointsVisible,true);
});
test("admin page includes visibility control and public script masks total-point cells",()=>{
  const admin=readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
  const adminJs=readFileSync(new URL("../public/admin.js",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(admin,/id="togglePointsVisibility"/);
  assert.match(admin,/id="pointsVisibilityStatus"/);
  assert.match(adminJs,/api\("settings","POST"/);
  assert.match(app,/formatOverallPoints\(r\.points,data\.pointsVisible\)/);
});

test("admin frontend JavaScript passes Node module syntax checking",()=>{
  execFileSync(process.execPath,["--check",new URL("../public/admin.js",import.meta.url).pathname]);
});
test("admin panel has four accessible tabs with separately controlled sections",()=>{
  const html=readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
  const tabs=[...html.matchAll(/data-admin-tab="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(tabs,["overview","sports","matches","borrowed"]);
  assert.match(html,/role="tablist"/);
  for(const name of tabs){
    assert.match(html,new RegExp('id="tab-'+name+'".*aria-controls="panel-'+name+'"'));
    assert.match(html,new RegExp('id="panel-'+name+'"[^>]*role="tabpanel"'));
    assert.match(html,new RegExp('aria-labelledby="tab-'+name+'"'));
  }
  assert.match(html,/id="matchSportSelect"/);
  assert.match(html,/id="sportSelect"/);
  assert.match(html,/id="heatList"/);
  assert.match(html,/id="borrowedStandings"/);
  assert.match(html,/id="matchProgress"/);
  assert.match(html,/id="onlyUnfinished"/);
  assert.match(html,/id="togglePointsVisibility"/);
});
test("admin uses independent 2-team match and 4-heat editors with progress",()=>{
  const source=readFileSync(new URL("../public/admin.js",import.meta.url),"utf8");
  assert.match(source,/buildRoundRobin\(data,matchSportId\)/);
  assert.match(source,/data\.sports\.filter\(s=>s\.id!=="borrowed"\)/);
  assert.match(source,/buildBorrowed\(data\)/);
  assert.match(source,/\$\("heatList"\)\.addEventListener\("submit"/);
  assert.match(source,/\$\("matchList"\)\.addEventListener\("submit"/);
  assert.match(source,/\$\("matchSportSelect"\)\.addEventListener\("change"/);
  assert.match(source,/\$\("onlyUnfinished"\)\.addEventListener\("change"/);
  assert.match(source,/sportId:matchSportId,matchId:row\.id/);
  assert.match(source,/api\("settings","POST"/);
});
test("navigation warns about unsaved edits and preserves drafts when saving another form",()=>{
  const source=readFileSync(new URL("../public/admin.js",import.meta.url),"utf8");
  assert.match(source,/function canDiscardEdits\(/);
  assert.match(source,/function captureDrafts\(/);
  assert.match(source,/function restoreDrafts\(/);
  assert.match(source,/await loadData\(\{preserveDrafts:true,excludeForm:form\}\)/);
  assert.match(source,/window\.addEventListener\("beforeunload"/);
  const css=readFileSync(new URL("../public/admin.css",import.meta.url),"utf8");
  assert.ok(css.includes(".admin-bottom-nav{position:fixed"));
  assert.ok(css.includes("padding-bottom:env(safe-area-inset-bottom"));
  assert.ok(!css.includes(".admin-tabs{display:grid"));
  assert.match(css,/\.is-dirty/);
});

test("tab navigation is in footer after editor panels and keeps all four button IDs",()=>{
  const html=readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
  const content=html.indexOf('id="panel-borrowed"');
  const nav=html.indexOf('class="admin-bottom-nav"');
  assert.ok(nav>content);
  assert.match(html,/class="admin-bottom-nav-inner"/);
  assert.equal((html.match(/data-admin-tab=/g)||[]).length,4);
  assert.doesNotMatch(html,/class="admin-tabs"/);
});

