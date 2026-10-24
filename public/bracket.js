// Four-team, single round-robin format. Each team plays three games per sport.
export const ROUNDS = Object.freeze([
  {id:"R1", label:"第1節"},
  {id:"R2", label:"第2節"},
  {id:"R3", label:"第3節"}
]);
// Indices refer to the ordering of the four teams in the チーム sheet.
export const FIXTURES = Object.freeze([
  {id:"R1M1", round:"R1", a:0, b:3},
  {id:"R1M2", round:"R1", a:1, b:2},
  {id:"R2M1", round:"R2", a:0, b:2},
  {id:"R2M2", round:"R2", a:3, b:1},
  {id:"R3M1", round:"R3", a:0, b:1},
  {id:"R3M2", round:"R3", a:2, b:3}
]);
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
    points:{...PODIUM_POINTS},source:norm(data.source)||"demo",updatedAt:norm(data.updatedAt)||null
  };
}

export function buildRoundRobin(data,sportId) {
  const sport=data.sports.find(s=>s.id===sportId);
  if(!sport)return null;
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
    if(row.status==="終了"&&!issue) {
      if(row.winnerId) {
        if(row.winnerId===teamA||row.winnerId===teamB)winner=row.winnerId;
        else issue="勝者IDが対戦チームと一致しません";
      } else if(row.scoreA!==null&&row.scoreA!==undefined&&row.scoreB!==null&&row.scoreB!==undefined&&row.scoreA!==row.scoreB)
        winner=row.scoreA>row.scoreB?teamA:teamB;
      else issue="勝者が未登録です（引き分け不可）";
    }
    return {
      id:f.id,round:f.round,teamA,teamB,
      labelA:names.get(teamA)||"対戦相手未定",labelB:names.get(teamB)||"対戦相手未定",
      status:issue?"要確認":row.status||"未開始",issue,winner,
      loser:winner?(winner===teamA?teamB:teamA):null,
      court:row.court||"",scheduledAt:row.scheduledAt||""
    };
  });
  const rounds=ROUNDS.map(r=>({...r,matches:all.filter(m=>m.round===r.id)}));
  const standings=teams.map(t=>({id:t.id,name:t.name||t.id,wins:0,losses:0,played:0,rank:null}));
  const stats=new Map(standings.map(r=>[r.id,r]));
  for(const game of all) {
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
  const completed=teams.length===4&&new Set(teams.map(t=>t.id)).size===4&&all.every(m=>m.winner&&!m.issue);
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
    if(match.winner)
      return {kind:match.winner===row.id?"win":"loss",text:match.winner===row.id?"勝":"敗",round:match.round,match};
    if(match.status==="試合中")
      return {kind:"live",text:"試合中",round:match.round,match};
    return {kind:"pending",text:"未開始",round:match.round,match};
  }));
}

export function computeOverall(data) {
  const table=new Map(data.teams.map(t=>[t.id,{id:t.id,name:t.name,points:0,first:0,second:0,third:0,participations:0}]));
  let completedSports=0;
  const sportsSummary=[];
  for(const sport of data.sports){
    const league=buildRoundRobin(data,sport.id);
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
