import {normalizeData,buildRoundRobin,computeOverall} from "./bracket.js";
const $=(id)=>document.getElementById(id);
const state={tab:"schedule",sport:"",round:"R1",data:null,lastFetch:null,problem:""};
const esc=(value)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sportsName=(sport)=>esc(sport?.name||sport?.id||"競技");
const displayTime=(v)=>{if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d)};
const name=(data,id,fallback)=>esc(data.teams.find(t=>t.id===id)?.name||id||fallback||"未定");
const matchLabel=(m)=>{const parts=/^R([1-3])M([12])$/.exec(m.id);return parts?`第${parts[1]}節・第${parts[2]}試合`:m.id};
const pill=(key,label,active,attribute)=>`<button class="pill${active?" active":""}" type="button" ${attribute}="${esc(key)}" aria-pressed="${active}">${esc(label)}</button>`;

function matchCard(m,short=false){
  const status=m.status==="要確認"?"確認が必要":m.status;
  const css=m.status==="試合中"?"live":m.status==="終了"?"done":m.status==="要確認"?"invalid":"";
  const row=(id,label)=>`<div class="team-row ${m.winner===id&&id?"winner":""}">
    <span class="team-name ${id?"":"tbd"}">${esc(label)}</span>
    ${m.winner===id&&id?'<span class="win-mark">勝利</span>':""}</div>`;
  return `<article class="match-card" aria-label="${esc(matchLabel(m))}">
      <div class="match-head"><span class="match-index">${esc(matchLabel(m))}</span><span class="match-state ${css}">${esc(status)}</span></div>
      ${row(m.teamA,m.labelA)}${row(m.teamB,m.labelB)}
      ${m.issue?`<div class="match-foot warning">${esc(m.issue)}</div>`:
      (!short&&m.winner?`<div class="match-foot">勝者：${m.winner===m.teamA?esc(m.labelA):esc(m.labelB)}</div>`:
      (m.court||m.scheduledAt)?`<div class="match-foot">${esc([m.court,m.scheduledAt].filter(Boolean).join(" ／ "))}</div>`:"")}
    </article>`;
}
const section=(heading,subtitle,body)=>`<section class="content-card"><h2 class="card-heading">${heading}</h2>${subtitle?`<p class="card-subtitle">${subtitle}</p>`:""}${body}</section>`;
const validClock=(s)=>/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(s||"");
function renderSchedule(data) {
  const rows=data.sports.map((s,index)=>{
    const start=validClock(s.startTime)?s.startTime:"";
    const end=validClock(s.endTime)?s.endTime:"";
    const time=start&&end?`${start}〜${end}`:start?`${start}〜未定`:"時刻未定";
    return `<li class="schedule-item">
      <div class="schedule-item__time ${start?"":"pending"}">${esc(time)}</div>
      <div><div class="schedule-item__name"><span class="schedule-item__order">${index+1}</span>${sportsName(s)}</div>
      ${s.venue?`<div class="schedule-item__place">会場：${esc(s.venue)}</div>`:""}</div>
    </li>`;
  }).join("");
  const allTimed=data.sports.length>0&&data.sports.every(s=>validClock(s.startTime)&&validClock(s.endTime));
  const notice=allTimed?"時間は運営のスプレッドシートから取得しています。":"競技ごとの実施時刻・順序は調整中です。上記の並びは仮のもので、確定した時刻は運営のスプレッドシートから自動反映されます。";
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
function renderNews(data){
  const leagues=data.sports.map(s=>buildRoundRobin(data,s.id)).filter(Boolean);
  const all=leagues.flatMap(b=>b.all.map(m=>({m,sport:b.sport})));
  const live=all.filter(x=>x.m.status==="試合中");
  const finished=all.filter(x=>x.m.status==="終了");
  const count=leagues.reduce((n,b)=>n+b.all.length,0);
  const totalDone=finished.length;
  const summary=`<div class="summary-grid"><div class="summary-metric"><div class="metric-number">${data.sports.length}</div><div class="metric-label">競技数</div></div><div class="summary-metric"><div class="metric-number">${live.length}</div><div class="metric-label">試合中</div></div><div class="summary-metric"><div class="metric-number">${totalDone}/${count}</div><div class="metric-label">終了試合</div></div></div>`;
  const cards=(arr)=>arr.map(x=>`<div><div class="minor" style="margin-bottom:6px;font-weight:800">${sportsName(x.sport)}</div>${matchCard(x.m)}</div>`).join("");
  const now=live.length?`<div class="matches">${cards(live)}</div>`:`<div class="empty">現在、記録上「試合中」の対戦はありません。</div>`;
  const recent=finished.length?`<div class="matches">${cards(finished.slice(-6).reverse())}</div>`:`<div class="empty">終了した試合はまだありません。</div>`;
  return section("大会の進行状況","全競技の試合記録から自動集計しています。",summary)+section("試合中",null,now)+section("最新の試合結果",null,recent)+
  `<div class="content-card"><div class="section-row"><h2>総合順位を確認</h2><button type="button" class="pill active" data-open-tab="standings">順位を見る →</button></div></div>`;
}
function renderBracket(data){
  const league=buildRoundRobin(data,state.sport);
  if(!league)return section("対戦表",null,`<div class="empty">競技を選択してください。</div>`);
  const desktop=`<div class="bracket-desktop">${league.rounds.map(round=>`<div class="bracket-column"><h3>${round.label}</h3>${round.matches.map(m=>matchCard(m,true)).join("")}</div>`).join("")}</div>`;
  const active=league.rounds.find(r=>r.id===state.round)||league.rounds[0];
  const mobile=`<div class="bracket-mobile"><div class="round-switch">${league.rounds.map(r=>pill(r.id,r.label,r.id===active.id,"data-round")).join("")}</div><div class="matches">${active.matches.map(m=>matchCard(m)).join("")}</div></div>`;
  const rows=league.standings.map(r=>`<tr class="${r.rank===1&&league.completed?"leader":""}"><td><span class="rank-symbol">${r.rank}</span></td><td>${esc(r.name)}</td><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td></tr>`).join("");
  const standingTable=`<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>試合</th><th>勝</th><th>敗</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return section(sportsName(league.sport)+" の対戦表",
    `4チーム総当たり（各3試合、全6試合） ／ ${league.completed?"全試合確定":"進行中・未確定"}`,
    desktop+mobile)+section(sportsName(league.sport)+" の競技別順位",
    league.completed?"6試合の結果による確定順位です。":"現在の勝敗による暫定順位です。総合ポイントは全試合終了後に反映されます。",
    standingTable+`<p class="point-note">勝利数を優先し、2チームが同勝利数なら直接対決の勝者を上位にします。3チーム以上の同勝利数は、点数を記録しないため同順位とします。</p>`);
}
function renderStandings(data){
  const overall=computeOverall(data);
  const inProgress=overall.totalSports-overall.completedSports;
  const rows=overall.rows.map(r=>`<tr class="${r.rank===1&&r.points>0?"leader":""}">
     <td><span class="rank-symbol">${r.rank??"–"}</span></td><td>${esc(r.name)}</td><td class="num">${r.points}</td><td class="num">${r.first}</td><td class="num">${r.second}</td><td class="num">${r.third}</td>
  </tr>`).join("");
  const listing=`<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>合計pt</th><th>優勝</th><th>準優勝</th><th>3位</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const note=`<p class="point-note">全6試合の結果が確定した競技のみ加点します。各競技は勝利数順、2チーム同数なら直接対決、3チーム以上の同数は同順位（配点も同額）です。総合順位の同点は優勝・準優勝・3位の回数で比較し、なお同数なら同順位とします。配点は1位30点、2位20点、3位10点で固定です。</p>`;
  const points=Object.entries(data.points).sort((a,b)=>Number(a[0])-Number(b[0])).map(([rank,score])=>`${rank}位 ${score}pt`).join(" ／ ");
  return section("総合順位",`確定：${overall.completedSports}/${overall.totalSports}競技　／　未確定：${inProgress}競技`,
    listing+note)+section("ポイント配点","競技別の結果を総合得点に換算します。",
      `<div class="point-note">${esc(points||"配点がまだ設定されていません。")}</div>`+
      `<div class="results-group"><h3>競技別の確定状況</h3><div class="results-list">${overall.sportsSummary.map(s=>`<div class="result-row"><span class="versus">${esc(s.name)}</span><span class="status-tag ${s.completed?"":"live"}">${s.completed?"確定":"未確定"}</span></div>`).join("")}</div></div>`);
}
function renderResults(data){
  const sports=state.sport==="all"?data.sports:data.sports.filter(s=>s.id===state.sport);
  const contents=sports.map(s=>{
    const league=buildRoundRobin(data,s.id);
    return `<section class="content-card"><h2 class="card-heading">${sportsName(s)}</h2>${league.rounds.map(round=>
      `<div class="results-group"><h3>${round.label}</h3><div class="results-list">${round.matches.map(m=>
        `<div class="result-row"><span class="mini-competition">${esc(matchLabel(m))}</span><span class="versus">${esc(m.labelA)} vs ${esc(m.labelB)}</span><span class="status-tag ${m.status==="試合中"?"live":""}">${esc(m.status)}</span>${m.winner?`<span class="status-tag">勝者：${esc(m.winner===m.teamA?m.labelA:m.labelB)}</span>`:""}${m.issue?`<small style="color:#a04720;width:100%">${esc(m.issue)}</small>`:""}</div>`).join("")}</div></div>`).join("")}</section>`;
  }).join("");
  return contents||section("全試合結果",null,`<div class="empty">表示できる競技がありません。</div>`);
}

function render(){
  const titles={schedule:["スケジュール","12:30〜18:00の開催概要と各競技の予定です。"],news:["試合速報","現在の試合状況と最新結果を表示します。"],bracket:["総当たり対戦表","競技別に4チームの対戦予定と勝敗順位を確認できます。"],standings:["総合順位","確定した競技のポイントを集計します。"],results:["全試合結果","全競技の試合結果を一覧で表示します。"]};
  $("pageHeading").textContent=titles[state.tab][0];$("pageDescription").textContent=titles[state.tab][1];
  document.querySelectorAll("[data-tab]").forEach(b=>{const active=b.dataset.tab===state.tab;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  if(!state.data)return;
  const data=state.data;
  const select=state.tab==="bracket"||state.tab==="results";
  $("sportSelectorSection").hidden=!select;
  if(select){
    const choices=state.tab==="results"?[...data.sports,{id:"all",name:"すべて"}]:data.sports;
    $("sportButtons").innerHTML=choices.map(s=>pill(s.id,s.name,state.sport===s.id,"data-sport")).join("");
  }
  $("demoBanner").hidden=data.source!=="demo";
  $("view").innerHTML=state.tab==="schedule"?renderSchedule(data):state.tab==="news"?renderNews(data):state.tab==="bracket"?renderBracket(data):state.tab==="standings"?renderStandings(data):renderResults(data);
}
function setTab(tab){
  if(!["schedule","news","bracket","standings","results"].includes(tab))return;
  state.tab=tab;if(tab==="bracket"&&state.sport==="all")state.sport=state.data?.sports[0]?.id||"";
  render();closeMenu();window.scrollTo({top:0,behavior:"smooth"});
}
const closeMenu=()=>{$("appMenu").hidden=true;$("menuBackdrop").hidden=true;$("menuButton").setAttribute("aria-expanded","false")};
const openMenu=()=>{$("appMenu").hidden=false;$("menuBackdrop").hidden=false;$("menuButton").setAttribute("aria-expanded","true")};
$("menuButton").addEventListener("click",()=>$("appMenu").hidden?openMenu():closeMenu());
$("menuClose").addEventListener("click",closeMenu);$("menuBackdrop").addEventListener("click",closeMenu);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
document.addEventListener("click",e=>{
  const tab=e.target.closest("[data-tab],[data-menu-tab],[data-open-tab]");
  if(tab){setTab(tab.dataset.tab||tab.dataset.menuTab||tab.dataset.openTab);return}
  const sport=e.target.closest("[data-sport]");
  if(sport){state.sport=sport.dataset.sport;state.round="R1";render();return}
  const round=e.target.closest("[data-round]");
  if(round){state.round=round.dataset.round;render()}
});
async function refresh(){
  if(document.visibilityState==="hidden")return;
  try{
    const r=await fetch("/api/results",{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const payload=await r.json();
    if(payload.error)throw new Error(payload.error);
    const next=normalizeData(payload);
    if(!next.teams.length||!next.sports.length)throw new Error("データが不足しています");
    state.data=next;
    if(!next.sports.some(s=>s.id===state.sport)&&state.sport!=="all")state.sport=next.sports[0].id;
    state.lastFetch=new Date();state.problem="";
    $("alert").hidden=!payload.stale; if(payload.stale)$("alert").textContent="Googleから最新データを取得できず、前回の情報を表示しています。";
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
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
refresh();
setInterval(refresh,5000);
