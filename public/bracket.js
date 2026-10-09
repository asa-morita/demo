// Pure bracket and ranking logic shared by the page and Node's test runner.
export const ROUNDS = [
  { id: "QF", label: "準々決勝" },
  { id: "SF", label: "準決勝" },
  { id: "FINAL", label: "決勝" }
];
const norm = (v) => String(v ?? "").trim();
const thirdChoice = (v) => { const s=norm(v).toLowerCase(); return ["true","1","yes","on","あり","有"].includes(s)?true:(["false","0","no","off","なし","無"].includes(s)?false:null); };
const numeric = (v) => v === null || v === undefined || norm(v) === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizeData(input) {
  const data = input && typeof input === "object" ? input : {};
  return {
    teams: (Array.isArray(data.teams) ? data.teams : []).map(t => ({ id: norm(t.id), name: norm(t.name) })).filter(t=>t.id),
    sports: (Array.isArray(data.sports) ? data.sports : []).map(s=>({
      id:norm(s.id), name:norm(s.name), thirdPlace: thirdChoice(s.thirdPlace ?? s.third_place),
      order: Number(s.order)||0
    })).filter(s=>s.id).sort((a,b)=>a.order-b.order),
    matches: (Array.isArray(data.matches)? data.matches:[]).map(m=>({
      sportId:norm(m.sportId ?? m.sport_id), id:norm(m.id).toUpperCase(),
      teamA:norm(m.teamA ?? m.team_a), teamB:norm(m.teamB ?? m.team_b),
      scoreA:numeric(m.scoreA ?? m.score_a), scoreB:numeric(m.scoreB ?? m.score_b),
      status:norm(m.status)||"未開始", winnerId:norm(m.winnerId ?? m.winner_id),
      court:norm(m.court), scheduledAt:norm(m.scheduledAt ?? m.scheduled_at)
    })),
    points: Object.fromEntries(Object.entries(data.points && typeof data.points==="object" ? data.points : {}).map(([k,v])=>[k,numeric(v)]).filter(([,v])=>v!==null)),
    source: norm(data.source)||"demo",
    updatedAt: norm(data.updatedAt) || null
  };
}

export function buildBracket(data, sportId) {
  const sport=data.sports.find(s=>s.id===sportId);
  if(!sport) return null;
  const source=new Map(data.matches.filter(m=>m.sportId===sportId).map(m=>[m.id,m]));
  const teamNames=new Map(data.teams.map(t=>[t.id,t.name]));
  function entry(id,a,b,labelA="対戦相手未定",labelB="対戦相手未定",derived=false) {
    const row=source.get(id)||{status:"未開始",scoreA:null,scoreB:null};
    const teamA=derived?a:(row.teamA||null);
    const teamB=derived?b:(row.teamB||null);
    let issue="";
    if(derived && ((row.teamA && teamA && row.teamA!==teamA)||(row.teamB && teamB && row.teamB!==teamB))) issue="前ラウンドと登録済みチームが一致しません";
    if(["終了","試合中"].includes(row.status)&&(!teamA||!teamB)) issue="対戦相手の確定を待っています";
    if(!teamA && row.teamA && derived) issue="前ラウンドの勝者確定を待っています";
    if(!teamB && row.teamB && derived) issue="前ラウンドの勝者確定を待っています";
    let winner=null;
    if(row.status==="終了"&&!issue) {
      if(row.winnerId) {
        if(row.winnerId===teamA||row.winnerId===teamB) winner=row.winnerId;
        else issue="勝者IDが対戦チームと一致しません";
      } else if(row.scoreA!==null && row.scoreB!==null && row.scoreA!==row.scoreB){
        winner=row.scoreA>row.scoreB?teamA:teamB;
      } else issue="勝者を確定できません（引き分けは勝者IDを入力）";
    }
    return {
      id,teamA,teamB,labelA:teamA?(teamNames.get(teamA)||teamA):labelA,
      labelB:teamB?(teamNames.get(teamB)||teamB):labelB,
      scoreA:row.scoreA??null,scoreB:row.scoreB??null,
      status:issue?"要確認":row.status||"未開始",issue,
      winner,loser:winner?(winner===teamA?teamB:teamA):null,
      court:row.court||"",scheduledAt:row.scheduledAt||""
    };
  }
  const qf=[1,2,3,4].map(n=>entry("QF"+n));
  const sf=[0,1].map(n=>entry("SF"+(n+1),qf[n*2].winner,qf[n*2+1].winner,"準々決勝"+(n*2+1)+"勝者","準々決勝"+(n*2+2)+"勝者",true));
  const final=entry("FINAL",sf[0].winner,sf[1].winner,"準決勝①勝者","準決勝②勝者",true);
  const third=sport.thirdPlace===true?entry("THIRD",sf[0].loser,sf[1].loser,"準決勝①敗者","準決勝②敗者",true):null;
  const main=[...qf,...sf,final];
  const completed=main.every(m=>!!m.winner)&&sport.thirdPlace!==null&&(sport.thirdPlace!==true||(third&&!!third.winner));
  const ranks=[];
  if(completed){
    ranks.push({teamId:final.winner,rank:1});
    ranks.push({teamId:final.loser,rank:2});
    if(third) {
      ranks.push({teamId:third.winner,rank:3},{teamId:third.loser,rank:4});
    } else {
      sf.forEach(m=>ranks.push({teamId:m.loser,rank:3}));
    }
    qf.forEach(m=>ranks.push({teamId:m.loser,rank:5}));
  }
  return {sport,qf,sf,final,third,all:third?[...main,third]:main,completed,ranks};
}

export function computeOverall(data){
  const table=new Map(data.teams.map(t=>[t.id,{id:t.id,name:t.name,points:0,first:0,second:0,third:0,participations:0}]));
  let completedSports=0;
  let missingPoints=false;
  const sportsSummary=[];
  for(const sport of data.sports) {
    const bracket=buildBracket(data,sport.id);
    sportsSummary.push({name:sport.name,completed:bracket.completed});
    if(!bracket.completed) continue;
    const absent=bracket.ranks.some(r=>data.points[r.rank]===undefined);
    if(absent){missingPoints=true;continue}
    completedSports++;
    for(const r of bracket.ranks){
      const item=table.get(r.teamId);
      if(!item)continue;
      item.points+=data.points[r.rank];
      item.participations++;
      if(r.rank===1)item.first++;
      if(r.rank===2)item.second++;
      if(r.rank===3)item.third++;
    }
  }
  const rows=[...table.values()].sort((a,b)=> b.points-a.points || b.first-a.first || b.second-a.second || b.third-a.third || a.name.localeCompare(b.name,"ja"));
  rows.forEach((r,i)=>{r.rank=i===0?1:(rows[i-1].points===r.points && rows[i-1].first===r.first && rows[i-1].second===r.second && rows[i-1].third===r.third ? rows[i-1].rank:i+1)});
  return {rows,completedSports,totalSports:data.sports.length,sportsSummary,missingPoints};
}
