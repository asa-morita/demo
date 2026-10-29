import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeData,buildRoundRobin,buildRoundRobinMatrix,computeOverall,FIXTURES,TUG_FIXTURES,buildTugOfWar,buildBorrowed,formatOverallPoints,formatMatchLabel} from "../public/bracket.js";

const sample=JSON.parse(readFileSync(new URL("../public/demo-data.json",import.meta.url),"utf8"));
const fresh=()=>normalizeData(structuredClone(sample));
const match=(d,sport,id)=>d.matches.find(m=>m.sportId===sport&&m.id===id);

test("four individual round-robin sports have six matches; borrowed race has four heats",()=>{
  const d=fresh();
  assert.deepEqual(d.teams.map(t=>t.id),["A","B","C","D"]);
  assert.equal(d.sports.length,6);
  assert.deepEqual(d.sports.map(x=>x.name),["バレーボール","バスケットボール","フットサル","ドッジボール","綱引き","借人競争"]);
  assert.equal(FIXTURES.length,6);
  for(const s of d.sports.filter(s=>s.id!=="borrowed"&&s.id!=="tugofwar")){
    const league=buildRoundRobin(d,s.id);
    assert.equal(league.rounds.length,3);
    assert.deepEqual(league.rounds.map(r=>r.matches.length),[2,2,2]);
    const pairs=league.all.map(m=>[m.teamA,m.teamB].sort().join("-"));
    assert.equal(new Set(pairs).size,6);
    for(const t of d.teams)assert.equal(league.all.filter(m=>m.teamA===t.id||m.teamB===t.id).length,3);
  }
  assert.equal(buildRoundRobin(d,"borrowed"),null);
  assert.equal(buildRoundRobin(d,"tugofwar"),null);
  assert.equal(buildBorrowed(d).all.length,4);
  assert.equal(d.heats.length,4);
});
test("tug-of-war pairs each team with every other team once across exactly three matches",()=>{
  const d=fresh(),tug=buildTugOfWar(d);
  assert.equal(TUG_FIXTURES.length,3);
  assert.deepEqual(tug.all.map(m=>[m.id,m.teamA,m.teamB]),[
    ["T1","A+B","C+D"],["T2","A+C","B+D"],["T3","A+D","B+C"]
  ]);
  for(const team of d.teams){
    assert.equal(tug.all.filter(m=>[...m.sideA,...m.sideB].includes(team.id)).length,3);
    assert.equal(tug.all.filter(m=>m.sideA.includes(team.id)).length+
      tug.all.filter(m=>m.sideB.includes(team.id)).length,3);
  }
  assert.equal(tug.completed,false);
  assert.equal(tug.ranks.length,0);
  assert.equal(tug.all[0].label,"第1試合");
});
test("tug-of-war awards each allied team one victory and shares tied ranks only after all matches",()=>{
  const d=fresh();
  const winners={T1:"A+B",T2:"A+C",T3:"A+D"};
  for(const [id,winnerId] of Object.entries(winners)){
    Object.assign(match(d,"tugofwar",id),{status:"終了",winnerId});
  }
  const tug=buildTugOfWar(d);
  assert.equal(tug.completed,true);
  assert.deepEqual(tug.standings.map(t=>[t.id,t.wins,t.rank]),[
    ["A",3,1],["B",1,2],["C",1,2],["D",1,2]
  ]);
  const overall=computeOverall(d);
  assert.equal(overall.completedSports,2); // volleyball is already finished in the demo.
  assert.deepEqual(Object.fromEntries(overall.rows.map(t=>[t.id,t.points])),{
    A:50,B:20,C:50,D:30
  });
  match(d,"tugofwar","T3").status="未開始";
  match(d,"tugofwar","T3").winnerId="";
  assert.equal(buildTugOfWar(d).completed,false);
  assert.equal(computeOverall(d).completedSports,1);
});
test("invalid tug results never count toward finished matches",()=>{
  const d=fresh();
  const m=match(d,"tugofwar","T1");
  m.status="終了";m.winnerId="A";
  assert.equal(buildTugOfWar(d).all[0].status,"要確認");
  m.winnerId="A+B";
  assert.equal(buildTugOfWar(d).all[0].winner,"A+B");
  m.teamA="B+A";
  assert.equal(buildTugOfWar(d).all[0].status,"要確認");
  m.teamA="A+B";
  d.matches.push({...m});
  assert.match(buildTugOfWar(d).all[0].issue,/重複/);
});
test("fixture order starts A vs B, allows rest, and keeps stored match IDs",()=>{
  const league=buildRoundRobin(fresh(),"futsal");
  assert.deepEqual(league.all.map(m=>[m.id,m.teamA,m.teamB]),[
    ["R3M1","A","B"],["R3M2","C","D"],
    ["R2M1","A","C"],["R2M2","D","B"],
    ["R1M1","A","D"],["R1M2","B","C"]
  ]);
  assert.deepEqual(league.all.map(formatMatchLabel),
    ["第1試合","第2試合","第3試合","第4試合","第5試合","第6試合"]);
  assert.equal(formatMatchLabel("R1M1"),"第5試合");
  // K4's six fixtures cannot have fewer than two shared-team adjacent pairs.
  const adjacent=league.all.slice(1).filter((m,i)=>{
    const prev=league.all[i];
    return m.teamA===prev.teamA||m.teamA===prev.teamB||
      m.teamB===prev.teamA||m.teamB===prev.teamB;
  });
  assert.equal(adjacent.length,2);
  assert.equal(league.all[0].teamA,"A");
  assert.equal(league.all[0].teamB,"B");
});
test("a completed round robin ranks teams by wins and awards podium points",()=>{
  const d=fresh(),league=buildRoundRobin(d,"volleyball");
  assert.equal(league.completed,true);
  assert.deepEqual(league.standings.map(r=>[r.id,r.wins,r.losses,r.rank]),[
    ["C",3,0,1],["A",2,1,2],["D",1,2,3],["B",0,3,4]
  ]);
  const overall=computeOverall(d);
  assert.equal(overall.completedSports,1);
  assert.deepEqual(Object.fromEntries(overall.rows.map(r=>[r.id,r.points])),{C:30,A:20,D:10,B:0});
});
test("a non-complete sport shows provisional wins but gives no overall points",()=>{
  const d=fresh();
  const last=match(d,"volleyball","R3M2");last.winnerId="";last.status="未開始";
  const b=buildRoundRobin(d,"volleyball");
  assert.equal(b.completed,false);
  assert.equal(b.ranks.length,0);
  assert.equal(b.standings.find(r=>r.id==="C").wins,2);
  assert.equal(computeOverall(d).completedSports,0);
});
test("two-team win ties are settled head-to-head",()=>{
  const d=fresh();
  const winners={R1M1:"A",R1M2:"B",R2M1:"A",R2M2:"D",R3M1:"B",R3M2:"C"};
  for(const [id,w] of Object.entries(winners))match(d,"volleyball",id).winnerId=w;
  const b=buildRoundRobin(d,"volleyball");
  assert.equal(b.completed,true);
  assert.deepEqual(b.standings.map(r=>[r.id,r.rank]),[["B",1],["A",2],["C",3],["D",4]]);
});
test("three-way cyclic tie shares rank and podium points",()=>{
  const d=fresh();
  const winners={R1M1:"A",R1M2:"B",R2M1:"C",R2M2:"B",R3M1:"A",R3M2:"C"};
  for(const [id,w] of Object.entries(winners))match(d,"volleyball",id).winnerId=w;
  const b=buildRoundRobin(d,"volleyball");
  assert.deepEqual(b.standings.map(r=>r.rank),[1,1,1,4]);
  const overall=computeOverall(d);
  assert.deepEqual(overall.rows.map(r=>r.points),[30,30,30,0]);
});
test("wrong opponents, winner, and duplicate IDs do not award points",()=>{
  const d=fresh();
  match(d,"volleyball","R1M1").teamB="B";
  let b=buildRoundRobin(d,"volleyball");
  assert.equal(b.all.find(m=>m.id==="R1M1").status,"要確認");
  assert.equal(b.completed,false);
  match(d,"volleyball","R1M1").teamB="D";
  match(d,"volleyball","R1M1").winnerId="Z";
  b=buildRoundRobin(d,"volleyball");
  assert.match(b.all.find(m=>m.id==="R1M1").issue,/勝者ID/);
  match(d,"volleyball","R1M1").winnerId="A";
  d.matches.push({...match(d,"volleyball","R1M1")});
  assert.match(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").issue,/重複/);
});
test("wins are accepted only for finished games",()=>{
  const d=fresh(),game=match(d,"volleyball","R1M1");
  game.status="試合中";
  assert.equal(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").status,"要確認");
  game.winnerId="";
  assert.equal(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").status,"試合中");
  assert.equal(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").winner,null);
});
test("score columns are optional and can infer a winner for legacy data",()=>{
  const d=fresh(),game=match(d,"volleyball","R1M1");
  game.winnerId="";
  game.scoreA=3;game.scoreB=1;
  assert.equal(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").winner,"A");
  game.scoreB=3;
  assert.match(buildRoundRobin(d,"volleyball").all.find(m=>m.id==="R1M1").issue,/引き分け不可/);
});
test("missing team or incomplete matches never produce an overall award",()=>{
  const d=fresh();
  d.teams.pop();
  assert.equal(buildRoundRobin(d,"volleyball").completed,false);
  const d2=fresh();
  d2.matches=d2.matches.filter(m=>!(m.sportId==="volleyball"&&m.id==="R1M1"));
  assert.equal(buildRoundRobin(d2,"volleyball").completed,false);
});
test("fixed 30/20/10 points override any spreadsheet-provided points",()=>{
  const d=fresh();
  d.points={1:999,2:999,3:999};
  const overall=computeOverall(d);
  assert.equal(overall.rows.find(r=>r.id==="C").points,30);
  assert.equal(overall.rows.find(r=>r.id==="D").points,10);
});
test("schedule fields are preserved with empty times",()=>{
  const raw=structuredClone(sample);
  raw.sports[0].startTime="12:30";raw.sports[0].endTime="13:20";raw.sports[0].venue="体育館";
  const d=normalizeData(raw);
  assert.deepEqual([d.sports[0].startTime,d.sports[0].endTime,d.sports[0].venue],["12:30","13:20","体育館"]);
  assert.equal(d.sports[1].startTime,"");
});
test("web pages retain the four-team round robin and three public tabs",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/buildRoundRobin/);
  assert.match(app,/4チーム総当たり/);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.deepEqual([...html.matchAll(/data-tab="([^"]+)"/g)].map(x=>x[1]),["schedule","standings","bracket"]);
  assert.deepEqual([...html.matchAll(/data-menu-tab="([^"]+)"/g)].map(x=>x[1]),["schedule","standings","bracket"]);
  assert.match(html,/総合順位/);
  assert.doesNotMatch(html,/data-tab="news"|data-tab="results"/);
  // The schedule shows only the event timetable; fixture details remain in the match table.
  assert.match(app,/section\("開催予定"/);
  assert.doesNotMatch(app,/2チーム対抗競技の総当たり組み合わせ|fixtureRows/);
  assert.match(app,/formatMatchLabel\(m\)/);
  assert.match(app,/renderTugOfWar\(data\)/);
  assert.match(app,/buildTugOfWar\(data\)/);
  assert.doesNotMatch(app,/第[123]節|\.rounds\.map/);
  assert.match(app,/const titles=\{schedule:\["予定"/);
  assert.doesNotMatch(app,/renderNews|renderResults/);
});

test("5-by-5 display has 4x4 symmetric match cells and diagonal self-matches",()=>{
  const d=fresh();
  const league=buildRoundRobin(d,"volleyball");
  const matrix=buildRoundRobinMatrix(league,d.teams);
  assert.equal(matrix.length,4);
  assert.deepEqual(matrix.map(row=>row.length),[4,4,4,4]);
  assert.equal(matrix.flat().filter(cell=>cell.kind==="diagonal").length,4);
  assert.equal(matrix.flat().filter(cell=>cell.kind!=="diagonal").length,12);
  assert.equal(matrix[0][0].kind,"diagonal");
  assert.equal(matrix[0][2].kind,"loss"); // A loses to C.
  assert.equal(matrix[2][0].kind,"win");  // C beats A.
  assert.equal(matrix[0][2].match.id,matrix[2][0].match.id);
  assert.equal(matrix[2][0].round,"R2");
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){
    if(i===j)continue;
    assert.equal(matrix[i][j].match,matrix[j][i].match);
  }
});
test("5-by-5 results matrix distinguishes live, pending and invalid matches",()=>{
  const d=fresh();
  const pending=buildRoundRobinMatrix(buildRoundRobin(d,"futsal"),d.teams);
  assert.equal(pending[0][3].text,"未開始");
  assert.equal(pending[3][0].kind,"pending");
  const live=match(d,"futsal","R1M1");
  live.status="試合中";
  const during=buildRoundRobinMatrix(buildRoundRobin(d,"futsal"),d.teams);
  assert.equal(during[0][3].text,"試合中");
  assert.equal(during[3][0].kind,"live");
  live.teamB="B";
  const invalid=buildRoundRobinMatrix(buildRoundRobin(d,"futsal"),d.teams);
  assert.equal(invalid[0][3].text,"要確認");
  assert.equal(invalid[3][0].kind,"invalid");
});
test("match view markup uses a real five-by-five results table without bracket cards",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.match(app,/buildRoundRobinMatrix\(league,data\.teams\)/);
  assert.match(app,/<table class="round-robin-table">/);
  assert.match(app,/scope="row"/);
  assert.match(app,/scope="col"/);
  assert.match(app,/matrix-diagonal/);
  assert.doesNotMatch(app,/bracket-desktop|bracket-mobile|matchCard\(/);
  assert.match(css,/\.round-robin-table/);
  assert.match(css,/linear-gradient\(135deg/);
});

test("borrowed race awards no podium points until all four 4-team heats complete",()=>{
  const d=fresh();
  const orders=[
    {A:1,B:2,C:3,D:4},
    {A:1,B:3,C:2,D:4},
    {A:2,B:1,C:4,D:3},
    {A:1,B:2,C:3,D:4}
  ];
  for(let index=0;index<4;index++){
    const heat=d.heats[index];heat.ranks=orders[index];heat.status="終了";
    const race=buildBorrowed(d);
    assert.equal(race.completedHeats,index+1);
    if(index<3){
      assert.equal(race.completed,false);
      assert.equal(computeOverall(d).completedSports,1); // Volleyball only.
    }
  }
  const race=buildBorrowed(d);
  assert.equal(race.completed,true);
  assert.deepEqual(race.standings.map(x=>[x.id,x.rankSum,x.rank]),[
    ["A",5,1],["B",8,2],["C",12,3],["D",15,4]
  ]);
  const overall=computeOverall(d);
  assert.equal(overall.completedSports,2);
  assert.deepEqual(Object.fromEntries(overall.rows.map(t=>[t.id,t.points])),{A:50,B:20,C:40,D:10});
});
test("borrowed race shares tied rank and rejects inconsistent finished heats",()=>{
  const d=fresh();
  const orders=[
    {A:1,B:2,C:3,D:4},
    {A:2,B:1,C:4,D:3},
    {A:1,B:2,C:3,D:4},
    {A:2,B:1,C:4,D:3}
  ];
  d.heats.forEach((h,i)=>{h.status="終了";h.ranks=orders[i]});
  const race=buildBorrowed(d);
  assert.deepEqual(race.standings.map(t=>[t.id,t.rank]),[["A",1],["B",1],["C",3],["D",3]]);
  d.heats[3].ranks.D=1;
  const invalid=buildBorrowed(d);
  assert.equal(invalid.completed,false);
  assert.equal(invalid.all[3].status,"要確認");
  assert.equal(computeOverall(d).completedSports,1);
});

test("total points are masked only in the public display while ranking stays intact",()=>{
  const d=fresh();
  assert.equal(normalizeData({...d,pointsVisible:false}).pointsVisible,false);
  assert.equal(normalizeData({...d,pointsVisible:true}).pointsVisible,true);
  const old=structuredClone(d);
  delete old.pointsVisible;
  assert.equal(normalizeData(old).pointsVisible,true);
  const before=computeOverall(d);
  const hidden=normalizeData({...d,pointsVisible:false});
  const after=computeOverall(hidden);
  assert.deepEqual(after,before);
  assert.equal(formatOverallPoints(50,true),"50");
  assert.equal(formatOverallPoints(0,true),"0");
  assert.equal(formatOverallPoints(50,false),"⁇?");
  assert.equal(formatOverallPoints(0,false),"⁇?");
});

