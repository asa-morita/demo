import {normalizeData,buildBracket,computeOverall} from "./bracket.js";
const $=(id)=>document.getElementById(id);
const state={tab:"news",sport:"",round:"QF",data:null,lastFetch:null,problem:""};
const esc=(value)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sportsName=(sport)=>esc(sport?.name||sport?.id||"競技");
const displayTime=(v)=>{if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d)};
const name=(data,id,fallback)=>esc(data.teams.find(t=>t.id===id)?.name||id||fallback||"未定");
const matchLabel=(m)=>m.id.startsWith("QF")?"準々決勝 "+m.id.slice(2):m.id.startsWith("SF")?"準決勝 "+m.id.slice(2):m.id==="THIRD"?"3位決定戦":"決勝";
const pill=(key,label,active,attribute)=>`<button class="pill${active?" active":""}" type="button" ${attribute}="${esc(key)}" aria-pressed="${active}">${esc(label)}</button>`;

function matchCard(m,short=false){
  const status=m.status==="要確認"?"確認が必要":m.status;
  const css=m.status==="試合中"?"live":m.status==="終了"?"done":m.status==="要確認"?"invalid":"";
  const score=v=>v===null?"–":esc(v);
  const row=(id,label,scoreValue)=>`<div class="team-row ${m.winner===id&&id?"winner":""}">
    <span class="team-name ${id?"":"tbd"}">${esc(label)}</span><span class="score">${score(scoreValue)}</span></div>`;
  return `<article class="match-card" aria-label="${esc(matchLabel(m))}">
      <div class="match-head"><span class="match-index">${esc(matchLabel(m))}</span><span class="match-state ${css}">${esc(status)}</span></div>
      ${row(m.teamA,m.labelA,m.scoreA)}${row(m.teamB,m.labelB,m.scoreB)}
      ${m.issue?`<div class="match-foot warning">${esc(m.issue)}</div>`:
      (!short&&m.winner?`<div class="match-foot">勝者：${m.winner===m.teamA?esc(m.labelA):esc(m.labelB)}</div>`:
      (m.court||m.scheduledAt)?`<div class="match-foot">${esc([m.court,m.scheduledAt].filter(Boolean).join(" ／ "))}</div>`:"")}
    </article>`;
}
const section=(heading,subtitle,body)=>`<section class="content-card"><h2 class="card-heading">${heading}</h2>${subtitle?`<p class="card-subtitle">${subtitle}</p>`:""}${body}</section>`;
function renderNews(data){
  const brackets=data.sports.map(s=>buildBracket(data,s.id)).filter(Boolean);
  const all=brackets.flatMap(b=>b.all.map(m=>({m,sport:b.sport})));
  const live=all.filter(x=>x.m.status==="試合中");
  const finished=all.filter(x=>x.m.status==="終了");
  const count=brackets.reduce((n,b)=>n+b.all.length,0);
  const totalDone=finished.length;
  const summary=`<div class="summary-grid"><div class="summary-metric"><div class="metric-number">${data.sports.length}</div><div class="metric-label">競技数</div></div><div class="summary-metric"><div class="metric-number">${live.length}</div><div class="metric-label">試合中</div></div><div class="summary-metric"><div class="metric-number">${totalDone}/${count}</div><div class="metric-label">終了試合</div></div></div>`;
  const cards=(arr)=>arr.map(x=>`<div><div class="minor" style="margin-bottom:6px;font-weight:800">${sportsName(x.sport)}</div>${matchCard(x.m)}</div>`).join("");
  const now=live.length?`<div class="matches">${cards(live)}</div>`:`<div class="empty">現在、記録上「試合中」の対戦はありません。</div>`;
  const recent=finished.length?`<div class="matches">${cards(finished.slice(-6).reverse())}</div>`:`<div class="empty">終了した試合はまだありません。</div>`;
  return section("大会の進行状況","全競技の試合記録から自動集計しています。",summary)+section("試合中",null,now)+section("最新の試合結果",null,recent)+
  `<div class="content-card"><div class="section-row"><h2>総合順位を確認</h2><button type="button" class="pill active" data-open-tab="standings">順位を見る →</button></div></div>`;
}
function renderBracket(data){
  const bracket=buildBracket(data,state.sport);
  if(!bracket)return section("対戦表",null,`<div class="empty">競技を選択してください。</div>`);
  const {qf,sf,final,third}=bracket;
  const cols=[{name:"準々決勝",matches:qf},{name:"準決勝",matches:sf},{name:"決勝",matches:[final]}];
  const desktop=`<div class="bracket-desktop">${cols.map(c=>`<div class="bracket-column"><h3>${c.name}</h3>${c.matches.map(m=>matchCard(m,true)).join("")}</div>`).join("")}</div>`;
  const roundOptions=[{id:"QF",label:"準々決勝",matches:qf},{id:"SF",label:"準決勝",matches:sf},{id:"FINAL",label:"決勝",matches:[final]}];
  if(third)roundOptions.push({id:"THIRD",label:"3位決定戦",matches:[third]});
  const activeRound=roundOptions.find(r=>r.id===state.round)||roundOptions[0];
  const mobile=`<div class="bracket-mobile"><div class="round-switch">${roundOptions.map(r=>pill(r.id,r.label,r.id===activeRound.id,"data-round")).join("")}</div><div class="matches">${activeRound.matches.map(m=>matchCard(m)).join("")}</div></div>`;
  const thirdDesktop=third?`<div class="bracket-addendum bracket-desktop-third"><div class="section-row"><h3>3位決定戦</h3><span class="minor">準決勝の敗者同士が対戦</span></div><div style="max-width:350px;margin-top:12px">${matchCard(third)}</div></div>`:
    bracket.sport.thirdPlace===null?`<p class="point-note">3位決定戦は未定です。方針が決まるまで、この競技の総合ポイントは確定しません。</p>`:`<p class="point-note">この競技は3位決定戦なしの設定です。準決勝の敗者2チームを同率3位として扱います。</p>`;
  return section(sportsName(bracket.sport)+" のトーナメント",
    `8チーム・${bracket.sport.thirdPlace===null?"3位決定戦未定":bracket.third?"3位決定戦あり":"3位決定戦なし"} ／ ${bracket.completed?"全日程終了":"進行中・未確定"}`,
    desktop+mobile+thirdDesktop);
}
function renderStandings(data){
  const overall=computeOverall(data);
  const inProgress=overall.totalSports-overall.completedSports;
  const rows=overall.rows.map(r=>`<tr class="${r.rank===1&&r.points>0?"leader":""}">
     <td><span class="rank-symbol">${r.rank}</span></td><td>${esc(r.name)}</td><td class="num">${r.points}</td><td class="num">${r.first}</td><td class="num">${r.second}</td><td class="num">${r.third}</td>
  </tr>`).join("");
  const listing=`<div class="standings-wrap"><table><thead><tr><th>順位</th><th>チーム</th><th>合計pt</th><th>優勝</th><th>準優勝</th><th>3位</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const note=`<p class="point-note">終了した競技のみ加点します。順位が同点の場合は優勝回数、準優勝回数、3位回数で比較し、それらも同じ場合は同順位とします。<br>
  3位決定戦なし：準決勝敗者は同率3位。5〜8位決定戦なし：準々決勝敗者は同率5位。得点は「配点」シートから取得します。</p>`;
  const points=Object.entries(data.points).sort((a,b)=>Number(a[0])-Number(b[0])).map(([rank,score])=>`${rank}位 ${score}pt`).join(" ／ ");
  return section("総合順位",`確定：${overall.completedSports}/${overall.totalSports}競技　／　未確定：${inProgress}競技`,
    (overall.missingPoints?`<div class="alert" style="display:block">配点が不足している競技は集計していません。「配点」シートを確認してください。</div>`:"")+
    listing+note)+section("ポイント配点","競技別の結果を総合得点に換算します。",
      `<div class="point-note">${esc(points||"配点がまだ設定されていません。")}</div>`+
      `<div class="results-group"><h3>競技別の確定状況</h3><div class="results-list">${overall.sportsSummary.map(s=>`<div class="result-row"><span class="versus">${esc(s.name)}</span><span class="status-tag ${s.completed?"":"live"}">${s.completed?"確定":"未確定"}</span></div>`).join("")}</div></div>`);
}
function renderResults(data){
  const sports=state.sport==="all"?data.sports:data.sports.filter(s=>s.id===state.sport);
  const contents=sports.map(s=>{
    const b=buildBracket(data,s.id);
    const groups=[["準々決勝",b.qf],["準決勝",b.sf],["決勝",[b.final]],...(b.third?[["3位決定戦",[b.third]]]:[])];
    return `<section class="content-card"><h2 class="card-heading">${sportsName(s)}</h2>${groups.map(([title,ms])=>
      `<div class="results-group"><h3>${title}</h3><div class="results-list">${ms.map(m=>
        `<div class="result-row"><span class="mini-competition">${esc(matchLabel(m))}</span><span class="versus">${esc(m.labelA)} vs ${esc(m.labelB)}</span><span class="mini-score">${m.scoreA??"–"} : ${m.scoreB??"–"}</span><span class="status-tag ${m.status==="試合中"?"live":""}">${esc(m.status)}</span>${m.issue?`<small style="color:#a04720;width:100%">${esc(m.issue)}</small>`:""}</div>`).join("")}</div></div>`).join("")}</section>`;
  }).join("");
  return contents||section("全試合結果",null,`<div class="empty">表示できる競技がありません。</div>`);
}

function render(){
  const titles={news:["試合速報","現在の試合状況と最新結果を表示します。"],bracket:["トーナメント表","競技別に8チームの勝ち上がりを確認できます。"],standings:["総合順位","確定した競技のポイントを集計します。"],results:["全試合結果","全競技の試合結果を一覧で表示します。"]};
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
  $("view").innerHTML=state.tab==="news"?renderNews(data):state.tab==="bracket"?renderBracket(data):state.tab==="standings"?renderStandings(data):renderResults(data);
}
function setTab(tab){
  if(!["news","bracket","standings","results"].includes(tab))return;
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
  if(sport){state.sport=sport.dataset.sport;state.round="QF";render();return}
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
