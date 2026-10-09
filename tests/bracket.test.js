import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeData,buildBracket,computeOverall} from "../public/bracket.js";

const sample=JSON.parse(readFileSync(new URL("../public/demo-data.json",import.meta.url),"utf8"));
const fresh=()=>normalizeData(structuredClone(sample));
const match=(d,sport,id)=>d.matches.find(m=>m.sportId===sport&&m.id===id);

test("normalizeData reads the 8 teams and multiple sports",()=>{
  const d=fresh();
  assert.equal(d.teams.length,8);
  assert.equal(d.sports.length,6);
  assert.deepEqual(d.sports.map(x=>x.name),["フットサル","バレーボール","バスケットボール","ドッチボール","綱引き","借人競争"]);
  assert.equal(d.sports.find(s=>s.id==="dodgeball").thirdPlace,true);
  assert.equal(d.sports.find(s=>s.id==="volleyball").thirdPlace,false);
});
test("a completed 7-game bracket advances winners and assigns tied 3rd and 5th",()=>{
  const b=buildBracket(fresh(),"volleyball");
  assert.equal(b.qf[0].winner,"A");
  assert.equal(b.sf[0].teamA,"A");assert.equal(b.sf[0].teamB,"G");
  assert.equal(b.final.teamA,"A");assert.equal(b.final.teamB,"E");
  assert.equal(b.final.winner,"E");
  assert.equal(b.completed,true);
  assert.equal(b.ranks.length,8);
  assert.deepEqual(b.ranks.filter(r=>r.rank===3).map(r=>r.teamId).sort(),["C","G"]);
  assert.equal(b.ranks.filter(r=>r.rank===5).length,4);
});
test("standings count only completed sports using spreadsheet points",()=>{
  const o=computeOverall(fresh());
  assert.equal(o.completedSports,1);
  assert.equal(o.rows[0].id,"E");
  assert.equal(o.rows[0].points,30);
  assert.equal(o.rows.find(r=>r.id==="A").points,20);
  assert.equal(o.rows.find(r=>r.id==="C").points,10);
  assert.equal(o.rows.find(r=>r.id==="D").points,0);
});
test("third-place undecided prevents final ranking even if final match finished",()=>{
  const d=fresh();d.sports.find(s=>s.id==="volleyball").thirdPlace=null;
  const b=buildBracket(d,"volleyball");
  assert.equal(b.final.winner,"E");
  assert.equal(b.completed,false);
  assert.equal(computeOverall(d).completedSports,0);
});
test("changing a quarterfinal winner invalidates stale semifinal and final",()=>{
  const d=fresh(),qf=match(d,"volleyball","QF1");
  qf.winnerId="H";
  const b=buildBracket(d,"volleyball");
  assert.equal(b.qf[0].winner,"H");
  assert.equal(b.sf[0].status,"要確認");
  assert.match(b.sf[0].issue,/一致しません/);
  assert.equal(b.final.winner,null);
  assert.equal(b.completed,false);
});
test("an explicit winner is necessary when the score is tied",()=>{
  const d=fresh(),qf=match(d,"volleyball","QF1");
  qf.scoreA=21;qf.scoreB=21;qf.winnerId="";
  assert.equal(buildBracket(d,"volleyball").qf[0].status,"要確認");
  qf.winnerId="A";
  assert.equal(buildBracket(d,"volleyball").qf[0].winner,"A");
});
test("live score alone does not advance a team",()=>{
  const d=fresh(),qf=match(d,"volleyball","QF1");
  qf.status="試合中";
  const b=buildBracket(d,"volleyball");
  assert.equal(b.qf[0].winner,null);
  assert.equal(b.sf[0].winner,null);
});
test("third-place match result finalizes distinct 3rd and 4th rankings",()=>{
  const d=fresh(),s=d.sports.find(s=>s.id==="volleyball");s.thirdPlace=true;
  d.matches.push({sportId:"volleyball",id:"THIRD",teamA:"G",teamB:"C",scoreA:null,scoreB:null,status:"終了",winnerId:"G",court:"",scheduledAt:""});
  const b=buildBracket(d,"volleyball");
  assert.equal(b.completed,true);
  assert.equal(b.third.winner,"G");
  assert.equal(b.ranks.find(r=>r.teamId==="G").rank,3);
  assert.equal(b.ranks.find(r=>r.teamId==="C").rank,4);
});
test("no completed sport displays no assigned overall rank",()=>{
  const d=fresh();d.sports.forEach(s=>{s.thirdPlace=null});
  const overall=computeOverall(d);
  assert.equal(overall.completedSports,0);
  assert.equal(overall.rows[0].rank,null);
});
test("only podium finishers receive 30, 20, or 10 points",()=>{
  const d=fresh();
  d.points={"1":1,"2":2,"3":3,"5":99};
  const o=computeOverall(d);
  assert.equal(o.completedSports,1);
  assert.equal(o.rows.find(r=>r.id==="E").points,30);
  assert.equal(o.rows.find(r=>r.id==="A").points,20);
  assert.equal(o.rows.find(r=>r.id==="G").points,10);
  assert.equal(o.rows.find(r=>r.id==="D").points,0);
});
test("schedule information is preserved and empty times remain unscheduled",()=>{
  const raw=structuredClone(sample);
  raw.sports[0].startTime="12:30";
  raw.sports[0].endTime="13:20";
  raw.sports[0].venue="体育館";
  const d=normalizeData(raw);
  assert.equal(d.sports[0].name,"フットサル");
  assert.equal(d.sports[0].startTime,"12:30");
  assert.equal(d.sports[0].endTime,"13:20");
  assert.equal(d.sports[0].venue,"体育館");
  assert.equal(d.sports[1].startTime,"");
});
test("match score input is unnecessary when winner_id is explicitly set",()=>{
  const d=fresh();
  const qf=match(d,"volleyball","QF1");
  assert.equal(qf.scoreA,null);
  assert.equal(qf.scoreB,null);
  assert.equal(qf.winnerId,"A");
  assert.equal(buildBracket(d,"volleyball").qf[0].winner,"A");
});
test("scoreboards are absent from viewer markup",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.doesNotMatch(app,/m\\.scoreA\\s*\\?\\?/);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/data-tab="schedule"/);
});
