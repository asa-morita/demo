import {normalizeData,buildRoundRobin,buildRoundRobinMatrix,buildBorrowed,buildTugOfWar,computeOverall,formatOverallPoints,formatMatchLabel,nextPendingMatch} from "./bracket.js";
const $=(id)=>document.getElementById(id);
const state={tab:"schedule",sport:"",data:null,lastFetch:null,problem:""};
const esc=(value)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sportsName=(sport)=>esc(sport?.name||sport?.id||"競技");
const displayTime=(v)=>{if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d)};
const pill=(key,label,active,attribute)=>`<button class="pill${active?" active":""}" type="button" ${attribute}="${esc(key)}" aria-pressed="${active}">${esc(label)}</button>`;

const section=(heading,subtitle,body)=>`<section class="content-card"><h2 class="card-heading">${heading}</h2>${subtitle?`<p class="card-subtitle">${subtitle}</p>`:""}${body}</section>`;
const hasScores=m=>m&&Number.isInteger(m.scoreA)&&Number.isInteger(m.scoreB)&&m.scoreA>=0&&m.scoreB>=0;
const scoreText=(m,teamId)=>hasScores(m)?(teamId===m.teamB?`${m.scoreB}–${m.scoreA}`:`${m.scoreA}–${m.scoreB}`):"";
const validClock=(s)=>/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(s||"");
const hasAwardedPoints=items=>items.some(item=>item.status==="終了"&&!item.issue&&Object.values(item.awardedPoints||{}).some(value=>value!==null));
function awardedPointsDisplay(record,data){
  if(record.status!=="終了"||record.issue)return "";
  const values=data.teams.filter(team=>record.awardedPoints?.[team.id]!==null&&record.awardedPoints?.[team.id]!==undefined)
    .map(team=>esc(team.name)+" "+esc(formatOverallPoints(record.awardedPoints[team.id],data.pointsVisible))+"pt");
  return values.length?'<p class="awarded-points-display">総合ポイント：'+values.join(" ／ ")+'</p>':"";
}
function renderSchedule(data) {
  const rows=data.sports.map((s,index)=>{
    const start=validClock(s.startTime)?s.startTime:"";
    const end=validClock(s.endTime)?s.endTime:"";
    const time=start&&end?`${start}〜${end}`:start?`${start}〜未定`:"時刻未定";
    const league=s.id==="borrowed"?buildBorrowed(data):s.id==="tugofwar"?buildTugOfWar(data):buildRoundRobin(data,s.id);
    const done=s.id==="borrowed"?league.completedHeats:league.all.filter(m=>m.status==="終了").length;
    const description=s.id==="borrowed"?"4チームで計4回（終了"+done+"/4回）":
      s.id==="tugofwar"?"2チーム合同対抗・全3試合（終了"+done+"/3試合）":
      "4チーム・総当たり6試合（終了"+done+"/6試合）";
    return `<li class="schedule-item">
      <div class="schedule-item__time ${start?"":"pending"}">${esc(time)}</div>
      <div><div class="schedule-item__name"><span class="schedule-item__order">${index+1}</span>${sportsName(s)}</div>
      <div class="schedule-item__place">${s.venue?`会場：${esc(s.venue)} ／ `:""}${esc(description)}</div></div>
    </li>`;
  }).join("");
  const allTimed=data.sports.length>0&&data.sports.every(s=>validClock(s.startTime)&&validClock(s.endTime));
  const notice=allTimed?"時間は運営が管理画面から登録した内容です。":"競技ごとの実施時刻・順序は調整中です。上記の並びは仮のもので、確定した時刻は運営の管理画面から登録されます。";
  return section("開催予定","体育祭の全体開催時間です。",
    `<div class="schedule-range">
      <div><div class="schedule-range__time">12:30</div><div class="schedule-range__caption">開始</div></div>
      <span class="schedule-range__dash">→</span>
      <div><div class="schedule-range__time">18:00</div><div class="schedule-range__caption">終了</div></div>
    </div>
    <div class="section-row"><h2>実施競技</h2><span class="minor">全${data.sports.length}競技</span></div>
    <ol class="schedule-list" style="margin-top:14px">${rows}</ol>
    <p class="schedule-caveat">${esc(notice)}</p>`);
}
function renderBorrowed(data){
  const race=buildBorrowed(data);
  if(!race)return section("借人競争",null,'<div class="empty">競技情報がありません。</div>');
  const next=nextPendingMatch(race.all);
  const heats=race.all.map(heat=>{
    const cells=data.teams.map(team=>{
      const rank=heat.finished?heat.ranks[team.id]:null;
      return '<div class="borrowed-place"><strong>'+esc(team.name)+'</strong>'+
        '<span>'+(rank?rank+'位':'–')+'</span></div>';
    }).join("");
    const upcoming=heat.id===next?.id;
    return '<div class="borrowed-heat'+(upcoming?' next-match':'')+'"><div class="match-heading"><strong>'+esc(heat.label)+'</strong>'+
      (upcoming?'<span class="next-match-label">次の回</span>':'')+
      '<span class="match-state">'+esc(heat.status)+'</span></div>'+
      (heat.scheduledAt?'<p class="muted">開始予定：'+esc(heat.scheduledAt)+'</p>':'')+
      (heat.issue?'<p class="problem-text">'+esc(heat.issue)+'</p>':'')+
      '<div class="borrowed-places">'+cells+'</div>'+awardedPointsDisplay(heat,data)+'</div>';
  }).join("");
  const rows=race.standings.map(t=>'<tr class="'+(race.completed&&t.rank===1?'leader':'')+'">'+
    '<td><span class="rank-symbol">'+(t.rank??'–')+'</span></td><td>'+esc(t.name)+'</td>'+
    '<td class="num">'+(t.played?t.rankSum:'–')+'</td><td class="num">'+t.played+'/4</td></tr>').join("");
  const summary='<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>順位合計</th><th>実施</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  return section("借人競争 ・ 4回戦",
    '4チームが毎回参加。終了 '+race.completedHeats+'/4回',
    '<div class="borrowed-heats">'+heats+'</div>')+
    section("借人競争の総合結果",
      race.completed?'全4回の順位が確定しました。':'実施済みの回だけを集計した暫定順位です。',
      summary+'<p class="point-note">各回の順位（1〜4位）を合計し、数字が小さいチームを上位とします。合計が同じなら同順位です。総合ポイントの任意入力がある場合は入力値の合計を随時反映します。全回が空欄なら、4回すべて終了後に競技別順位で自動加点します。</p>');
}
function renderTugOfWar(data){
  const league=buildTugOfWar(data);
  if(!league)return section("綱引き",null,'<div class="empty">競技情報がありません。</div>');
  const next=nextPendingMatch(league.all);
  const fixtures=league.all.map(m=>{
    const winner=m.winner?(m.winner===m.teamA?m.labelA:m.labelB):"";
    const upcoming=m.id===next?.id;
    return `<div class="result-row tug-fixture${upcoming?" next-match":""}">
      <span class="mini-competition">${esc(m.label)}${upcoming?' ・ 次の試合':""}</span>
      <div class="versus">${esc(m.labelA)} <span class="tug-versus">vs</span> ${esc(m.labelB)}</div>
      ${hasScores(m)?`<span class="match-score" aria-label="${esc(m.labelA)} ${m.scoreA}点、${esc(m.labelB)} ${m.scoreB}点">${scoreText(m)}</span>`:""}
      <span class="status-tag ${m.status==="試合中"?"live":""}">${esc(m.status)}</span>
      ${m.draw?`<span class="tug-winner">引き分け</span>`:winner?`<span class="tug-winner">勝利：${esc(winner)}</span>`:""}
      ${awardedPointsDisplay(m,data)}
      ${m.issue?`<p class="problem-text">${esc(m.issue)}</p>`:""}
      ${m.scheduledAt?`<p class="muted">開始予定：${esc(m.scheduledAt)}</p>`:""}
    </div>`;
  }).join("");
  const rows=league.standings.map(t=>`<tr class="${t.rank===1&&league.completed?"leader":""}">
    <td><span class="rank-symbol">${t.rank}</span></td><td>${esc(t.name)}</td>
    <td class="num">${t.wins}</td><td class="num">${t.losses}</td><td class="num">${t.draws}</td></tr>`).join("");
  return section("綱引き ・ 2チーム合同戦",
    `第1試合〜第3試合（各チーム3戦） ／ ${league.completed?"全試合確定":"進行中・未確定"}`,
    `<div class="results-list">${fixtures}</div>`)+
    section("綱引きの競技別順位",
      league.completed?"全3試合の結果による確定順位です。":"現在の勝利数による暫定順位です。"+(hasAwardedPoints(league.all)?"入力済みの総合ポイントを反映中です。":"総合ポイントは全3試合終了後に反映されます。"),
      `<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>勝</th><th>敗</th><th>引分</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="point-note">各試合では勝利した2チームの両方に1勝を加算します。引き分けは4チームすべてに1引分を加算し、勝敗は加算しません。勝利数が同じ場合は同順位です。任意の総合ポイントがある場合は入力値の合計を随時反映します。全試合が空欄なら、全3試合終了後に順位で自動加点します。</p>`);
}
function renderBracket(data){
  if(state.sport==="borrowed")return renderBorrowed(data);
  if(state.sport==="tugofwar")return renderTugOfWar(data);
  const league=buildRoundRobin(data,state.sport);
  if(!league)return section("対戦表",null,`<div class="empty">競技を選択してください。</div>`);
  const cells=buildRoundRobinMatrix(league,data.teams);
  const next=nextPendingMatch(league.all);
  const headings=data.teams.map(t=>
    `<th scope="col" class="matrix-team-heading" title="${esc(t.name)}">${esc(t.name)}</th>`).join("");
  const body=cells.map((row,i)=>{
    const team=data.teams[i];
    const columns=row.map((cell,j)=>{
      if(cell.kind==="diagonal")
        return `<td class="matrix-diagonal" aria-label="${esc(team.name)}同士は対戦なし"><span class="matrix-visually-hidden">対戦なし</span></td>`;
      const opponent=data.teams[j];
      const m=cell.match;
      const detail=[m?formatMatchLabel(m):"対戦情報なし",m?.court,m?.scheduledAt,cell.kind==="invalid"?m?.issue:""].filter(Boolean).join(" ／ ");
      const upcoming=m?.id===next?.id;
      const score=scoreText(m,team.id);
      const label=`${team.name} 対 ${opponent.name}：${upcoming?"次の試合・":""}${cell.text}${score?" 得点 "+score:""}（${detail}）`;
      return `<td class="matrix-result matrix-${cell.kind}${upcoming?" matrix-next":""}" aria-label="${esc(label)}" title="${esc(detail)}">
        <span class="matrix-result__main">${esc(upcoming?"次の試合":cell.text)}</span>${score?`<span class="matrix-result__score">${score}</span>`:""}<span class="matrix-result__round">${esc(m?formatMatchLabel(m):"—")}</span></td>`;
    }).join("");
    return `<tr><th scope="row" class="matrix-team-heading" title="${esc(team.name)}">${esc(team.name)}</th>${columns}</tr>`;
  }).join("");
  const matrix=`<div class="round-robin-frame" role="group" aria-label="${sportsName(league.sport)}の4チーム総当たり対戦表">
    <table class="round-robin-table">
      <thead><tr><th class="matrix-corner matrix-diagonal" scope="col" aria-label="縦軸は自チーム、横軸は対戦相手"><span class="matrix-visually-hidden">縦：自チーム、横：対戦相手</span></th>${headings}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="matrix-help">縦のチームから見た対戦結果を表示します。得点は「自チーム–相手」の順です。水色は次の試合、斜線は同じチーム同士の対戦なしを表します。</p>
    <div class="matrix-legend" aria-label="対戦結果の凡例">
      <span class="matrix-legend__item"><i class="matrix-win"></i>勝</span>
      <span class="matrix-legend__item"><i class="matrix-loss"></i>敗</span>
      <span class="matrix-legend__item"><i class="matrix-draw"></i>引分</span>
      <span class="matrix-legend__item"><i class="matrix-pending"></i>未開始</span>
      <span class="matrix-legend__item"><i class="matrix-next"></i>次の試合</span>
      <span class="matrix-legend__item"><i class="matrix-live"></i>試合中</span>
      <span class="matrix-legend__item"><i class="matrix-invalid"></i>要確認</span>
    </div>`;
  const rows=league.standings.map(r=>`<tr class="${r.rank===1&&league.completed?"leader":""}"><td><span class="rank-symbol">${r.rank}</span></td><td>${esc(r.name)}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.draws}</td></tr>`).join("");
  const standingTable=`<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>勝</th><th>敗</th><th>引分</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return section(sportsName(league.sport)+" の対戦表",
    `4チーム総当たり（各3試合、全6試合） ／ ${league.completed?"全試合確定":"進行中・未確定"}`,
    matrix)+section(sportsName(league.sport)+" の競技別順位",
    league.completed?"6試合の結果による確定順位です。":"現在の勝敗による暫定順位です。総合ポイントは全試合終了後に反映されます。",
    standingTable+`<p class="point-note">引き分けは両チームに1引分を加算し、勝敗は加算しません。勝利数を優先し、2チームが同勝利数なら直接対決の勝者を上位にします。直接対決が引き分けの場合は同順位です。3チーム以上の同勝利数は同順位とします。得点は記録・表示用で、得失点差は順位に使用しません。</p>`);
}
function renderStandings(data){
  const overall=computeOverall(data);
  const inProgress=overall.totalSports-overall.completedSports;
  const rows=overall.rows.map(r=>`<tr class="${r.rank===1&&r.points>0?"leader":""}">
     <td><span class="rank-symbol">${r.rank??"–"}</span></td><td>${esc(r.name)}</td><td class="num">${esc(formatOverallPoints(r.points,data.pointsVisible))}</td><td class="num">${r.first}</td><td class="num">${r.second}</td><td class="num">${r.third}</td>
  </tr>`).join("");
  const listing=`<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>合計pt</th><th>優勝</th><th>準優勝</th><th>3位</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const note=`<p class="point-note">通常は各競技の全試合・全回終了後に、順位に応じて1位30点、2位20点、3位10点を自動加算します。同順位は同額です。綱引き・借人競争で総合ポイントを任意入力した競技は、終了済みの各試合・各回の入力値を合計して随時反映し、順位による自動加点は行いません。総合順位の同点は優勝・準優勝・3位の回数で比較し、なお同数なら同順位とします。</p>`;
  const points=Object.entries(data.points).sort((a,b)=>Number(a[0])-Number(b[0])).map(([rank,score])=>`${rank}位 ${score}pt`).join(" ／ ");
  return section("総合順位",`確定：${overall.completedSports}/${overall.totalSports}競技　／　未確定：${inProgress}競技`,
    listing+note)+section("ポイント配点","通常は競技別順位で自動配点します。綱引き・借人競争の任意入力ポイントを優先します。",
      `<div class="point-note">${esc(points||"配点がまだ設定されていません。")}</div>`+
      `<div class="results-group"><h3>競技別の確定状況</h3><div class="results-list">${overall.sportsSummary.map(s=>`<div class="result-row"><span class="versus">${esc(s.name)}</span><span class="status-tag ${s.completed?"":"live"}">${s.manualPoints?(s.completed?"入力ポイント確定":"入力ポイント反映中"):s.completed?"確定":"未確定"}</span></div>`).join("")}</div></div>`);
}

function render(){
  const titles={schedule:["予定","12:30〜18:00の開催予定と競技ごとの予定です。"],standings:["総合順位","4チームの競技別ポイントを集計します。"],bracket:["対戦表","対抗競技・綱引きの勝敗と借人競争4回の順位を確認できます。"]};
  $("pageHeading").textContent=titles[state.tab][0];$("pageDescription").textContent=titles[state.tab][1];
  document.querySelectorAll("[data-tab]").forEach(b=>{const active=b.dataset.tab===state.tab;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  if(!state.data)return;
  const data=state.data;
  const select=state.tab==="bracket";
  $("sportSelectorSection").hidden=!select;
  if(select)$("sportButtons").innerHTML=data.sports.map(s=>pill(s.id,s.name,state.sport===s.id,"data-sport")).join("");
  $("demoBanner").hidden=data.source!=="demo";
  $("view").innerHTML=state.tab==="schedule"?renderSchedule(data):state.tab==="standings"?renderStandings(data):renderBracket(data);
}
function setTab(tab){
  if(!["schedule","standings","bracket"].includes(tab))return;
  state.tab=tab;
  render();closeMenu();window.scrollTo({top:0,behavior:"smooth"});
}
const closeMenu=()=>{$("appMenu").hidden=true;$("menuBackdrop").hidden=true;$("menuButton").setAttribute("aria-expanded","false")};
const openMenu=()=>{$("appMenu").hidden=false;$("menuBackdrop").hidden=false;$("menuButton").setAttribute("aria-expanded","true")};
$("menuButton").addEventListener("click",()=>$("appMenu").hidden?openMenu():closeMenu());
$("menuClose").addEventListener("click",closeMenu);$("menuBackdrop").addEventListener("click",closeMenu);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
document.addEventListener("click",e=>{
  const tab=e.target.closest("[data-tab],[data-menu-tab]");
  if(tab){setTab(tab.dataset.tab||tab.dataset.menuTab);return}
  const sport=e.target.closest("[data-sport]");
  if(sport){state.sport=sport.dataset.sport;render();return}
});
async function refresh(){
  if(document.visibilityState==="hidden")return;
  try{
    const r=await fetch("/api/results",{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const payload=await r.json();
    if(payload.error)throw new Error(payload.error);
    const next=normalizeData(payload);
    if(next.teams.length!==4||new Set(next.teams.map(t=>t.id)).size!==4||!next.sports.length)throw new Error("4チームのデータが不足しています");
    state.data=next;
    if(!next.sports.some(s=>s.id===state.sport))state.sport=next.sports[0].id;
    state.lastFetch=new Date();state.problem="";
    $("alert").hidden=!payload.stale; if(payload.stale)$("alert").textContent="最新データを取得できず、前回の情報を表示しています。";
    $("connection").dataset.state=payload.stale?"error":"ok";$("connectionLabel").textContent=payload.stale?"前回取得したデータを表示中":"最新データを取得しました";
    $("updatedAt").textContent=(payload.stale?"最終正常取得 ":"取得 ")+displayTime(payload.stale?(payload.updatedAt||state.lastFetch.toISOString()):state.lastFetch.toISOString());
    $("topLive").classList.toggle("offline",!!payload.stale);$("topLive").textContent=payload.stale?"STALE":"LIVE";
    render();
  }catch(e){
    state.problem=String(e.message||e);
    $("connection").dataset.state="error";
    $("connectionLabel").textContent=state.data?"通信エラー：前回のデータを表示中":"データを取得できません";
    $("topLive").classList.add("offline");$("topLive").textContent="OFFLINE";
    $("alert").hidden=false;$("alert").textContent=state.data?
      "データの更新に失敗しました。画面は前回取得した情報です。":"試合情報を取得できません。しばらくして再読み込みしてください。";
    if(!state.data)$("view").innerHTML=section("接続エラー",null,`<p class="muted">${esc(state.problem)}</p>`);
  }
}
let screenVersion=null;
let reloadStarted=false;
async function checkScreenVersion(){
  try{
    const response=await fetch("/api/version",{cache:"no-store"});
    if(!response.ok)return;
    const payload=await response.json();
    const latestPrLink=$("latestPrLink");
    if(Number.isSafeInteger(payload.latestPr)&&payload.latestPr>0&&latestPrLink){
      latestPrLink.href="https://github.com/asa-morita/demo/pull/"+payload.latestPr;
      latestPrLink.textContent="最新PR #"+payload.latestPr;
    }
    if(typeof payload.version!=="string"||!payload.version)return;
    if(screenVersion===null){screenVersion=payload.version;return;}
    if(payload.version!==screenVersion&&!reloadStarted){
      reloadStarted=true;
      window.location.reload();
    }
  }catch{}
}
let versionPollCount=0;
refresh();
checkScreenVersion();
setInterval(async()=>{
  await refresh();
  versionPollCount++;
  if(versionPollCount%6===0)await checkScreenVersion();
},5000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){refresh();checkScreenVersion()}});


