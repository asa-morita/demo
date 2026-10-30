// Four-team individual head-to-head games: each team plays three matches.
// Legacy round IDs remain stable for saved results; the chronological display order is below.
// Borrowed-person race is different: four heats with all four teams competing each time.
export const ROUNDS = Object.freeze([
  {id:"R1", label:"第1節"},
  {id:"R2", label:"第2節"},
  {id:"R3", label:"第3節"}
]);
// Indices refer to the fixed ordering of the four teams.
// Chronological order: A-B starts, C-D rests A/B; only two adjacent matches share a team.
// IDs are intentionally NOT renumbered, so stored winners and scheduled times stay attached.
export const FIXTURES = Object.freeze([
  {id:"R3M1", round:"R3", a:0, b:1}, // 第1試合: A vs B
  {id:"R3M2", round:"R3", a:2, b:3}, // 第2試合: C vs D
  {id:"R2M1", round:"R2", a:0, b:2}, // 第3試合: A vs C
  {id:"R2M2", round:"R2", a:3, b:1}, // 第4試合: D vs B
  {id:"R1M1", round:"R1", a:0, b:3}, // 第5試合: A vs D
  {id:"R1M2", round:"R1", a:1, b:2}  // 第6試合: B vs C
]);
// The next event is the first unstarted fixture in the configured order.
// Ignore completed, live and invalid records; none is highlighted when no match remains.
export function nextPendingMatch(items){
  return (items||[]).find(item=>item.status==="未開始")||null;
}
export function formatMatchLabel(match) {
  const id=typeof match==="string"?match:match?.id;
  const index=FIXTURES.findIndex(f=>f.id===id);
  return index<0?String(id??""):`第${index+1}試合`;
}
export const PODIUM_POINTS = Object.freeze({1:30,2:20,3:10});
const norm=(v)=>String(v??"").trim();
const numeric=(v)=>v===null||v===undefined||norm(v)===""?null:(Number.isFinite(Number(v))?Number(v):null);

export function normalizeData(input) {
  const data=input&&typeof input==="object"?input:{};
  return {
    teams:(Array.isArray(data.teams)?data.teams:[]).map(t=>({id:norm(t.id),name:norm(t.name)})).filter(t=>t.id),
    sports:(Array.isArray(data.sports)?data.sports:[]).map(s=>({
      id:norm(s.id),name:norm(s.name),order:Number(s.order)||0,
      startTime:norm(s.startTime??s.start_time),endTime:norm(s.endTime??s.end_time),venue:norm(s.venue)
    })).filter(s=>s.id).sort((a,b)=>a.order-b.order),
    matches:(Array.isArray(data.matches)?data.matches:[]).map(m=>({
      sportId:norm(m.sportId??m.sport_id),id:norm(m.id??m.match_id).toUpperCase(),
      teamA:norm(m.teamA??m.team_a),teamB:norm(m.teamB??m.team_b),
      scoreA:numeric(m.scoreA??m.score_a),scoreB:numeric(m.scoreB??m.score_b),
      status:norm(m.status)||"未開始",winnerId:norm(m.winnerId??m.winner_id),
      court:norm(m.court),scheduledAt:norm(m.scheduledAt??m.scheduled_at)
    })),
    heats:(Array.isArray(data.heats)?data.heats:[]).map(h=>({
      id:norm(h.id),sportId:norm(h.sportId||"borrowed"),status:norm(h.status)||"未開始",
      ranks:Object.fromEntries(Object.entries(h.ranks||{}).map(([id,rank])=>[id,Number(rank)||0])),
      scheduledAt:norm(h.scheduledAt)
    })),
    points:{...PODIUM_POINTS},pointsVisible:data.pointsVisible!==false,
    source:norm(data.source)||"demo",updatedAt:norm(data.updatedAt)||null
  };
}

export function buildRoundRobin(data,sportId) {
  const sport=data.sports.find(s=>s.id===sportId);
  if(!sport||sport.id==="borrowed"||sport.id==="tugofwar")return null;
  const teams=data.teams;
  const names=new Map(teams.map(t=>[t.id,t.name||t.id]));
  const rows=data.matches.filter(m=>m.sportId===sportId);
  const byId=new Map();
  for(const row of rows) {
    const matching=byId.get(row.id)||[];
    matching.push(row);
    byId.set(row.id,matching);
  }
  const all=FIXTURES.map(f=>{
    const registered=byId.get(f.id)||[];
    const row=registered[0]||{};
    const teamA=teams[f.a]?.id||null,teamB=teams[f.b]?.id||null;
    let issue="";
    if(registered.length>1)issue="同じ試合IDが重複しています";
    else if(!teamA||!teamB)issue="参加チームは4件必要です";
    else if((row.teamA&&row.teamA!==teamA)||(row.teamB&&row.teamB!==teamB))
      issue="登録チームが対戦予定と一致しません";
    else if(row.status&&!["未開始","試合中","終了"].includes(row.status))
      issue="試合状態が不正です";
    else if(row.status!=="終了"&&row.winnerId)
      issue="試合終了前に勝者IDが登録されています";
    let winner=null;
    const draw=row.status==="終了"&&row.winnerId==="draw"&&!issue;
    if(row.status==="終了"&&!issue&&!draw) {
      if(row.winnerId) {
        if(row.winnerId===teamA||row.winnerId===teamB)winner=row.winnerId;
        else issue="勝者IDが対戦チームと一致しません";
      } else if(row.scoreA!==null&&row.scoreA!==undefined&&row.scoreB!==null&&row.scoreB!==undefined&&row.scoreA!==row.scoreB)
        winner=row.scoreA>row.scoreB?teamA:teamB;
      else issue="勝者または引き分けを選択してください";
    }
    return {
      id:f.id,round:f.round,teamA,teamB,
      labelA:names.get(teamA)||"対戦相手未定",labelB:names.get(teamB)||"対戦相手未定",
      status:issue?"要確認":row.status||"未開始",issue,winner,draw,
      loser:winner?(winner===teamA?teamB:teamA):null,
      scoreA:row.scoreA??null,scoreB:row.scoreB??null,
      court:row.court||"",scheduledAt:row.scheduledAt||""
    };
  });
  const rounds=ROUNDS.map(r=>({...r,matches:all.filter(m=>m.round===r.id)}));
  const standings=teams.map(t=>({id:t.id,name:t.name||t.id,wins:0,losses:0,draws:0,played:0,rank:null}));
  const stats=new Map(standings.map(r=>[r.id,r]));
  for(const game of all) {
    if(game.draw){
      for(const id of [game.teamA,game.teamB]){
        const team=stats.get(id);
        if(team){team.draws++;team.played++;}
      }
      continue;
    }
    if(!game.winner)continue;
    const winner=stats.get(game.winner),loser=stats.get(game.loser);
    if(!winner||!loser)continue;
    winner.wins++;winner.played++;
    loser.losses++;loser.played++;
  }
  // Without match scores, two-way ties are settled by their head-to-head game.
  // Unresolved multi-team circular ties receive the same rank and podium points.
  standings.sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name,"ja"));
  for(let start=0;start<standings.length;) {
    let end=start+1;
    while(end<standings.length&&standings[end].wins===standings[start].wins)end++;
    if(end-start===2) {
      const x=standings[start],y=standings[start+1];
      const direct=all.find(m=>m.winner&&((m.teamA===x.id&&m.teamB===y.id)||(m.teamA===y.id&&m.teamB===x.id)));
      if(direct) {
        if(direct.winner===y.id){standings[start]=y;standings[start+1]=x}
        standings[start].rank=start+1;
        standings[start+1].rank=start+2;
      } else {standings[start].rank=start+1;standings[start+1].rank=start+1}
    } else for(let i=start;i<end;i++)standings[i].rank=start+1;
    start=end;
  }
  const completed=teams.length===4&&new Set(teams.map(t=>t.id)).size===4&&all.every(m=>(m.winner||m.draw)&&!m.issue);
  const ranks=completed?standings.map(t=>({teamId:t.id,rank:t.rank})):[];
  return {sport,rounds,all,standings,completed,ranks};
}


/**
 * Build the 4x4 body of a 5x5 round-robin results table.
 * The row is the team whose result is being shown; the column is the opponent.
 * Diagonal entries represent impossible self-matches.
 */
export function buildRoundRobinMatrix(league,teams) {
  const pairs=new Map(league.all.map(m=>[[m.teamA,m.teamB].sort().join("::"),m]));
  return teams.map(row=>teams.map(opponent=>{
    if(row.id===opponent.id)return {kind:"diagonal",text:"",round:"",match:null};
    const match=pairs.get([row.id,opponent.id].sort().join("::"));
    if(!match||match.status==="要確認")
      return {kind:"invalid",text:"要確認",round:match?.round||"",match:match||null};
    if(match.draw)
      return {kind:"draw",text:"引分",round:match.round,match};
    if(match.winner)
      return {kind:match.winner===row.id?"win":"loss",text:match.winner===row.id?"勝":"敗",round:match.round,match};
    if(match.status==="試合中")
      return {kind:"live",text:"試合中",round:match.round,match};
    return {kind:"pending",text:"未開始",round:match.round,match};
  }));
}



// Tug-of-war is three matches between two temporary two-team alliances.
// IDs T1-T3 deliberately differ from legacy individual head-to-head match IDs.
export const TUG_FIXTURES=Object.freeze([
  {id:"T1",sideA:[0,1],sideB:[2,3]}, // AB vs CD
  {id:"T2",sideA:[0,2],sideB:[1,3]}, // AC vs BD
  {id:"T3",sideA:[0,3],sideB:[1,2]}  // AD vs BC
]);
export function createTugMatches(teams){
  return TUG_FIXTURES.map(f=>({
    sportId:"tugofwar",id:f.id,
    teamA:f.sideA.map(i=>teams[i]?.id||"").join("+"),
    teamB:f.sideB.map(i=>teams[i]?.id||"").join("+"),
    scoreA:null,scoreB:null,status:"未開始",winnerId:"",court:"",scheduledAt:""
  }));
}
export function buildTugOfWar(data){
  const sport=data.sports.find(s=>s.id==="tugofwar");
  if(!sport)return null;
  const teams=data.teams,unique=teams.length===4&&new Set(teams.map(t=>t.id)).size===4;
  const existing=(data.matches||[]).filter(m=>m.sportId==="tugofwar");
  const all=TUG_FIXTURES.map((fixture,index)=>{
    const entries=existing.filter(m=>m.id===fixture.id);
    const row=entries[0]||{};
    const sideA=fixture.sideA.map(i=>teams[i]?.id).filter(Boolean);
    const sideB=fixture.sideB.map(i=>teams[i]?.id).filter(Boolean);
    const teamA=sideA.join("+"),teamB=sideB.join("+");
    const teamName=id=>teams.find(t=>t.id===id)?.name||id;
    let issue="";
    if(!unique)issue="参加チームは4件必要です";
    else if(entries.length!==1)issue=entries.length>1?"試合IDが重複しています":"試合情報がありません";
    else if(row.teamA!==teamA||row.teamB!==teamB)issue="登録チームが対戦予定と一致しません";
    else if(!["未開始","試合中","終了"].includes(row.status))issue="試合状態が不正です";
    else if(row.status!=="終了"&&row.winnerId)issue="試合終了前に勝者IDが登録されています";
    else if(row.status==="終了"&&![teamA,teamB,"draw"].includes(row.winnerId))issue="勝者の組または引き分けを選択してください";
    return {
      id:fixture.id,label:"第"+(index+1)+"試合",sideA,sideB,teamA,teamB,
      labelA:sideA.map(teamName).join("＋"),labelB:sideB.map(teamName).join("＋"),
      status:issue?"要確認":row.status||"未開始",issue,
      winner:issue?null:(row.status==="終了"&&row.winnerId!=="draw"?row.winnerId:null),
      draw:!issue&&row.status==="終了"&&row.winnerId==="draw",
      scoreA:row.scoreA??null,scoreB:row.scoreB??null,
      court:row.court||"",scheduledAt:row.scheduledAt||""
    };
  });
  const standings=teams.map(team=>{
    const completedGames=all.filter(m=>(m.winner||m.draw)&&([ ...m.sideA,...m.sideB].includes(team.id)));
    return {id:team.id,name:team.name||team.id,played:completedGames.length,
      wins:completedGames.filter(m=>m.winner&&(m.winner===m.teamA?m.sideA:m.sideB).includes(team.id)).length,
      losses:completedGames.filter(m=>m.winner&&(m.winner===m.teamA?m.sideB:m.sideA).includes(team.id)).length,
      draws:completedGames.filter(m=>m.draw).length,
      rank:null};
  }).sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name,"ja"));
  // Shared alliances mean there is no individual direct head-to-head tiebreak.
  standings.forEach((r,i)=>{r.rank=i&&r.wins===standings[i-1].wins?standings[i-1].rank:i+1});
  const completed=unique&&all.every(m=>(m.winner||m.draw)&&!m.issue);
  return {sport,all,standings,completed,ranks:completed?standings.map(r=>({teamId:r.id,rank:r.rank})):[]};
}

// Four four-team heats; sum of placing positions (lower is better).
// No podium points are given to the sport until all four heats are valid and finished.
export const BORROWED_HEAT_IDS=Object.freeze(["H1","H2","H3","H4"]);
export function createBorrowedHeats(teams){
  return BORROWED_HEAT_IDS.map(id=>({
    id,sportId:"borrowed",status:"未開始",
    ranks:Object.fromEntries(teams.map(t=>[t.id,0])),scheduledAt:""
  }));
}
export function buildBorrowed(data){
  const sport=data.sports.find(s=>s.id==="borrowed");
  if(!sport)return null;
  const teams=data.teams;
  const records=Array.isArray(data.heats)?data.heats.filter(h=>h.sportId==="borrowed"):[];
  const fallback=createBorrowedHeats(teams);
  const all=BORROWED_HEAT_IDS.map((id,index)=>{
    const found=records.filter(h=>h.id===id),record=found[0]||fallback[index];
    const ranks=Object.fromEntries(teams.map(t=>[t.id,Number(record.ranks?.[t.id])||0]));
    const values=Object.values(ranks);
    const finalValid=values.length===4&&values.every(n=>Number.isInteger(n)&&n>=1&&n<=4)&&new Set(values).size===4;
    const unranked=values.every(n=>n===0);
    let issue="";
    if(found.length>1)issue="同じ回の記録が重複しています";
    else if(!["未開始","試合中","終了"].includes(record.status))issue="状態が不正です";
    else if(record.status==="終了"&&!finalValid)issue="終了した回には4チームの異なる順位が必要です";
    else if(record.status!=="終了"&&!unranked)issue="未終了の回には順位を付けられません";
    return {id,label:"第"+(index+1)+"回",status:issue?"要確認":record.status,
      ranks,scheduledAt:record.scheduledAt||"",issue,finished:!issue&&record.status==="終了"};
  });
  const completedHeats=all.filter(h=>h.finished).length;
  const standings=teams.map(team=>{
    const total=all.reduce((sum,h)=>sum+(h.finished?h.ranks[team.id]:0),0);
    return {id:team.id,name:team.name||team.id,rankSum:total,played:completedHeats,rank:null};
  }).sort((a,b)=>a.rankSum-b.rankSum||a.name.localeCompare(b.name,"ja"));
  if(completedHeats){
    standings.forEach((team,index)=>{
      team.rank=index>0&&standings[index-1].rankSum===team.rankSum?standings[index-1].rank:index+1;
    });
  }
  const completed=teams.length===4&&new Set(teams.map(t=>t.id)).size===4&&completedHeats===4;
  return {sport,all,standings,completed,completedHeats,
    ranks:completed?standings.map(t=>({teamId:t.id,rank:t.rank})):[]};
}

// This masks only the spectator display; rankings still use actual totals.
export function formatOverallPoints(points,visible=true){
  return visible?String(points):"⁇?";
}

export function computeOverall(data) {
  const table=new Map(data.teams.map(t=>[t.id,{id:t.id,name:t.name,points:0,first:0,second:0,third:0,participations:0}]));
  let completedSports=0;
  const sportsSummary=[];
  for(const sport of data.sports){
    const league=sport.id==="borrowed"?buildBorrowed(data):sport.id==="tugofwar"?buildTugOfWar(data):buildRoundRobin(data,sport.id);
    sportsSummary.push({name:sport.name,completed:league.completed});
    if(!league.completed)continue;
    completedSports++;
    for(const r of league.ranks){
      const item=table.get(r.teamId);
      if(!item)continue;
      item.points+=PODIUM_POINTS[r.rank]??0;
      item.participations++;
      if(r.rank===1)item.first++;
      if(r.rank===2)item.second++;
      if(r.rank===3)item.third++;
    }
  }
  const rows=[...table.values()].sort((a,b)=>b.points-a.points||b.first-a.first||b.second-a.second||b.third-a.third||a.name.localeCompare(b.name,"ja"));
  rows.forEach((r,i)=>{r.rank=completedSports===0?null:(i===0?1:(rows[i-1].points===r.points&&rows[i-1].first===r.first&&rows[i-1].second===r.second&&rows[i-1].third===r.third?rows[i-1].rank:i+1))});
  return {rows,completedSports,totalSports:data.sports.length,sportsSummary};
}


