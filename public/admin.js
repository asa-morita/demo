import {normalizeData,buildRoundRobin,buildBorrowed,buildTugOfWar,formatMatchLabel} from "./bracket.js";

const $=(id)=>document.getElementById(id);
const escapeHTML=(value)=>String(value??"").replace(/[&<>"']/g,
  char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let data=null;
let sportId="";
let matchSportId="";
let currentTab="matches";
const dirtyForms=new Set();
let toastTimer=null;

function formKey(form){
  if(form.id==="sportForm")return "sport:"+sportId;
  if(form.dataset.teamId)return "team:"+form.dataset.teamId;
  if(form.dataset.matchId)return "match:"+matchSportId+":"+form.dataset.matchId;
  if(form.dataset.heatId)return "heat:"+form.dataset.heatId;
  return "";
}
function captureDrafts(excludeForm=null){
  return [...dirtyForms].filter(form=>form.isConnected&&form!==excludeForm).map(form=>({
    key:formKey(form),
    controls:[...form.querySelectorAll("input[name],select[name]")].map(el=>({
      name:el.name,value:el.value,disabled:el.disabled
    }))
  })).filter(item=>item.key);
}
function restoreDrafts(drafts){
  dirtyForms.clear();
  const forms=[...$("editorPanel").querySelectorAll("form")];
  for(const draft of drafts){
    const form=forms.find(candidate=>formKey(candidate)===draft.key);
    if(!form)continue;
    for(const control of draft.controls){
      const el=form.elements.namedItem(control.name);
      if(!el)continue;
      el.value=control.value;
      el.disabled=control.disabled;
    }
    dirtyForms.add(form);
    form.classList.add("is-dirty");
  }
}
function canDiscardEdits(){
  return dirtyForms.size===0||window.confirm("未保存の入力があります。変更を破棄して移動しますか？");
}
function markDirty(event){
  const form=event.target.closest("form");
  if(!form||form.id==="loginForm"||!form.closest("#editorPanel"))return;
  dirtyForms.add(form);
  form.classList.add("is-dirty");
}
function selectTab(tab,checkDirty=true){
  if(!["overview","sports","matches","borrowed"].includes(tab))return;
  const previousTab=currentTab;
  if(tab!==currentTab&&checkDirty&&!canDiscardEdits())return false;
  if(tab!==currentTab){
    const hadUnsavedChanges=dirtyForms.size>0;
    dirtyForms.clear();
    currentTab=tab;
    // A confirmed discard must also reset the hidden form fields.
    if(hadUnsavedChanges)render();
  }else{
    currentTab=tab;
  }
  document.querySelectorAll("[data-admin-tab]").forEach(button=>{
    const selected=button.dataset.adminTab===tab;
    button.setAttribute("aria-selected",String(selected));
    button.tabIndex=selected?0:-1;
  });
  document.querySelectorAll("[role=tabpanel][id^='panel-']").forEach(panel=>{
    panel.hidden=panel.id!=="panel-"+tab;
  });
  // Switching from the bottom bar must reveal the new panel from its beginning,
  // even after editing a long list of matches or heats.
  if(checkDirty&&tab!==previousTab)window.scrollTo(0,0);
  return true;
}

function showMessage(message,kind="info"){
  const element=$("message");
  element.textContent=message;
  element.className="message "+kind;
  const toast=$("toast");
  if(toastTimer)clearTimeout(toastTimer);
  if(kind==="success"||kind==="error"){
    toast.textContent=message;
    toast.className="toast "+kind;
    toast.hidden=false;
    toastTimer=setTimeout(()=>{toast.hidden=true;toastTimer=null},kind==="error"?7000:3800);
  }else{
    toast.hidden=true;
  }
}
async function api(path,method="GET",body=null){
  const options={method,credentials:"same-origin",cache:"no-store",headers:{}};
  if(body!==null){
    options.headers["Content-Type"]="application/json";
    options.body=JSON.stringify(body);
  }
  const response=await fetch("/api/admin/"+path,options);
  let payload;
  try{payload=await response.json()}catch{throw new Error("サーバーの応答を読み取れません")}
  if(!response.ok){
    const err=new Error(payload.error||"通信に失敗しました");
    err.status=response.status;
    throw err;
  }
  return payload;
}

function renderTeams(){
  $("teamList").innerHTML=data.teams.map(team=>
    '<form class="team-editor" data-team-id="'+escapeHTML(team.id)+'">'+
    '<label>チーム '+escapeHTML(team.id)+
    '<input name="name" maxlength="40" required value="'+escapeHTML(team.name)+'"></label>'+
    '<button type="submit">名前を保存</button></form>'
  ).join("");
}
function renderSport(){
  const sport=data.sports.find(s=>s.id===sportId);
  if(!sport)return;
  const form=$("sportForm");
  for(const field of ["name","order","startTime","endTime","venue"])
    form.elements.namedItem(field).value=sport[field]??"";
}
function winnerOptions(match,selected){
  return '<option value="">未選択</option>'+
    [match.teamA,match.teamB].map((id,index)=>
      '<option value="'+escapeHTML(id)+'"'+(id===selected?' selected':'')+'>'+
      escapeHTML(matchSportId==="tugofwar"?(index===0?match.labelA:match.labelB):
        data.teams.find(t=>t.id===id)?.name||id)+'</option>'
    ).join("")+'<option value="draw"'+(selected==="draw"?' selected':'')+'>引き分け</option>';
}

function renderHeats(){
  const heats=data.heats.filter(h=>h.sportId==="borrowed");
  $("heatList").innerHTML=["H1","H2","H3","H4"].map((id,index)=>{
    const heat=heats.find(h=>h.id===id);
    if(!heat)return '<p class="problem-text">第'+(index+1)+'回の記録を取得できません。</p>';
    const statusOptions=["未開始","試合中","終了"].map(value=>
      '<option value="'+value+'"'+(heat.status===value?' selected':'')+'>'+value+'</option>').join("");
    const rankOptions=team=>'<option value="0">未入力</option>'+[1,2,3,4].map(rank=>
      '<option value="'+rank+'"'+(heat.ranks?.[team.id]===rank?' selected':'')+'>'+rank+'位</option>'
    ).join("");
    const ranks=data.teams.map(team=>
      '<label>'+escapeHTML(team.name)+' の順位'+
      '<select name="rank-'+escapeHTML(team.id)+'"'+(heat.status!=="終了"?' disabled':'')+'>'+
      rankOptions(team)+'</select></label>').join("");
    return '<form class="match-editor heat-editor" data-heat-id="'+escapeHTML(id)+'">'+
      '<div class="match-heading"><span>第'+(index+1)+'回 ・ 4チーム同時</span>'+
      '<span class="match-state">'+escapeHTML(heat.status)+'</span></div>'+
      '<div class="fields"><label>実施状態<select name="status">'+statusOptions+'</select></label>'+
      '<label>開始予定<input name="scheduledAt" maxlength="80" value="'+escapeHTML(heat.scheduledAt||"")+'"></label>'+
      ranks+'</div><button class="primary save" type="submit">第'+(index+1)+'回の順位を保存</button></form>';
  }).join("");
}
function renderMatches(){
  const league=matchSportId==="tugofwar"?buildTugOfWar(data):buildRoundRobin(data,matchSportId);
  if(!league){$("matchList").replaceChildren();return}
  const completed=league.all.filter(match=>match.status==="終了").length;
  $("matchProgress").textContent="終了 "+completed+" / "+league.all.length+" 試合";
  const matches=$("onlyUnfinished").checked
    ?league.all.filter(match=>match.status!=="終了")
    :league.all;
  $("matchList").innerHTML=matches.map(match=>{
    const row=data.matches.find(item=>item.sportId===matchSportId&&item.id===match.id);
    const status=row?.status||"未開始";
    const winner=status==="終了"?(row?.winnerId||""):"";
    const statusOptions=["未開始","試合中","終了"].map(value=>
      '<option value="'+value+'"'+(status===value?' selected':'')+'>'+value+'</option>'
    ).join("");
    return '<form class="match-editor" data-match-id="'+escapeHTML(match.id)+'">'+
      '<div class="match-heading"><span>'+escapeHTML(matchSportId==="tugofwar"?match.label:formatMatchLabel(match))+
      '</span><span class="match-state'+
      (match.status==="要確認"?' problem':'')+'">'+escapeHTML(match.status)+'</span></div>'+
      '<strong class="match-opponents">'+escapeHTML(match.labelA)+' <span>対</span> '+
        escapeHTML(match.labelB)+'</strong>'+
      (match.issue?'<p class="problem-text">'+escapeHTML(match.issue)+'</p>':'')+
      '<div class="fields">'+
      '<label>試合状態<select name="status" required>'+statusOptions+'</select></label>'+
      '<label>試合結果<select name="winnerId"'+(status!=="終了"?' disabled':'')+'>'+
        winnerOptions(match,winner)+'</select></label>'+
      '<label>'+escapeHTML(match.labelA)+'の得点<input name="scoreA" type="number" min="0" max="9999" step="1" inputmode="numeric" value="'+escapeHTML(row?.scoreA??"")+'" placeholder="任意"></label>'+
      '<label>'+escapeHTML(match.labelB)+'の得点<input name="scoreB" type="number" min="0" max="9999" step="1" inputmode="numeric" value="'+escapeHTML(row?.scoreB??"")+'" placeholder="任意"></label>'+
      '</div><button class="primary save" type="submit">この試合を保存</button></form>';
  }).join("")||'<div class="panel empty-state">該当する試合はありません。全試合が終了している場合は、絞り込みを解除してください。</div>';
}
function renderBorrowedStandings(){
  const race=buildBorrowed(data);
  if(!race)return;
  $("heatProgress").textContent="終了 "+race.completedHeats+" / 4回"+(race.completed?" ・ 確定":"");
  $("borrowedStandings").innerHTML='<table><thead><tr><th>暫定順位</th><th>チーム</th><th>順位合計</th></tr></thead><tbody>'+
    race.standings.map(team=>
      '<tr><td>'+(team.rank??"–")+'</td><td>'+escapeHTML(team.name)+'</td>'+
      '<td>'+(team.played?team.rankSum:"–")+'</td></tr>'
    ).join("")+'</tbody></table>';
}
function renderPointVisibility(){
  const visible=data.pointsVisible;
  $("pointsVisibilityStatus").textContent=visible
    ?"現在：表示（合計ptを公開中）"
    :"現在：非表示（合計ptは「⁇?」と表示）";
  $("togglePointsVisibility").textContent=visible
    ?"ポイントを非表示にする"
    :"ポイントを表示する";
}
function render(){
  if(!data)return;
  renderPointVisibility();
  const headToHead=data.sports.filter(s=>s.id!=="borrowed");
  if(!data.sports.some(s=>s.id===sportId))sportId=data.sports[0]?.id||"";
  if(!headToHead.some(s=>s.id===matchSportId))matchSportId=headToHead[0]?.id||"";
  $("sportSelect").innerHTML=data.sports.map(s=>
    '<option value="'+escapeHTML(s.id)+'"'+(s.id===sportId?' selected':'')+'>'+
    escapeHTML(s.name)+'</option>').join("");
  $("matchSportSelect").innerHTML=headToHead.map(s=>
    '<option value="'+escapeHTML(s.id)+'"'+(s.id===matchSportId?' selected':'')+'>'+
    escapeHTML(s.name)+'</option>').join("");
  $("savedAt").textContent=data.updatedAt
    ?"最終更新："+new Date(data.updatedAt).toLocaleString("ja-JP")
    :"まだ編集された記録はありません";
  renderTeams();
  renderSport();
  renderMatches();
  renderHeats();
  renderBorrowedStandings();
  selectTab(currentTab,false);
}
async function loadData({preserveDrafts=false,excludeForm=null}={}){
  const drafts=preserveDrafts?captureDrafts(excludeForm):[];
  const payload=await api("data");
  data=normalizeData(payload);
  if(data.teams.length!==4||!data.sports.length)throw new Error("大会データが不正です");
  $("editorPanel").hidden=false;
  $("loginPanel").hidden=true;
  render();
  restoreDrafts(drafts);
  if(!preserveDrafts)showMessage("最新の大会情報を読み込みました。","success");
}
async function init(){
  try{
    const session=await api("session");
    if(!session.configured){
      $("loginPanel").hidden=true;
      showMessage("管理者認証が未設定です。ADMIN_PASSWORD と ADMIN_SESSION_SECRET を設定してください。","error");
      return;
    }
    if(!session.storageReady){
      $("loginPanel").hidden=true;
      showMessage("大会ストレージが未設定です。WorkerのDurable Object設定を確認してください。","error");
      return;
    }
    if(!session.authenticated){
      $("loginPanel").hidden=false;
      showMessage("編集には管理者ログインが必要です。");
      return;
    }
    await loadData();
  }catch(err){showMessage(err.message,"error")}
}
async function save(form,path,body,message){
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;
  try{
    await api(path,"POST",body);
    await loadData({preserveDrafts:true,excludeForm:form});
    showMessage(message,"success");
  }catch(err){
    showMessage(err.message+(err.status===409?" 最新情報を再読込してください。":""),"error");
  }finally{button.disabled=false}
}

$("loginForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");
  button.disabled=true;
  try{
    await api("login","POST",{password:$("password").value});
    $("password").value="";
    await loadData();
  }catch(err){showMessage(err.message,"error")}
  finally{button.disabled=false}
});
$("editorPanel").addEventListener("input",markDirty);
$("editorPanel").addEventListener("change",markDirty);
document.querySelectorAll("[data-admin-tab]").forEach(button=>{
  button.addEventListener("click",()=>{
    if(selectTab(button.dataset.adminTab))button.focus({preventScroll:true});
  });
  button.addEventListener("keydown",event=>{
    const keys=["ArrowLeft","ArrowRight","Home","End"];
    if(!keys.includes(event.key))return;
    event.preventDefault();
    const tabs=[...document.querySelectorAll("[data-admin-tab]")];
    const index=tabs.indexOf(button);
    const destination=event.key==="Home"?tabs[0]:event.key==="End"?tabs[tabs.length-1]:
      tabs[(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length];
    if(selectTab(destination.dataset.adminTab))destination.focus({preventScroll:true});
  });
});
$("sportSelect").addEventListener("change",event=>{
  if(!canDiscardEdits()){event.target.value=sportId;return}
  dirtyForms.clear();
  sportId=event.target.value;
  renderSport();
});
$("matchSportSelect").addEventListener("change",event=>{
  if(!canDiscardEdits()){event.target.value=matchSportId;return}
  dirtyForms.clear();
  matchSportId=event.target.value;
  renderMatches();
});
$("onlyUnfinished").addEventListener("change",event=>{
  if(!canDiscardEdits()){event.target.checked=!event.target.checked;return}
  dirtyForms.clear();
  renderMatches();
});
$("togglePointsVisibility").addEventListener("click",async()=>{
  if(!data)return;
  const button=$("togglePointsVisibility");
  const next=!data.pointsVisible;
  button.disabled=true;
  try{
    await api("settings","POST",{
      pointsVisible:next,
      expectedPointsVisible:data.pointsVisible
    });
    await loadData({preserveDrafts:true});
    showMessage(next
      ?"総合順位のポイントを公開しました。"
      :"総合順位のポイントを非表示にしました。公開画面では「⁇?」と表示されます。","success");
  }catch(err){
    showMessage(err.message+(err.status===409?" 最新情報を再読込してください。":""),"error");
  }finally{
    button.disabled=false;
  }
});
$("refreshButton").addEventListener("click",async()=>{
  if(!canDiscardEdits())return;
  dirtyForms.clear();
  $("refreshButton").disabled=true;
  try{await loadData()}catch(err){showMessage(err.message,"error")}
  finally{$("refreshButton").disabled=false}
});
$("logoutButton").addEventListener("click",async()=>{
  if(!canDiscardEdits())return;
  try{
    await api("logout","POST",{});
    data=null;dirtyForms.clear();$("matchList").replaceChildren();$("heatList").replaceChildren();
    $("editorPanel").hidden=true;$("loginPanel").hidden=false;
    showMessage("ログアウトしました。");
  }catch(err){showMessage(err.message,"error")}
});
$("teamList").addEventListener("submit",async event=>{
  const form=event.target.closest("form[data-team-id]");
  if(!form)return;
  event.preventDefault();
  const team=data.teams.find(t=>t.id===form.dataset.teamId);
  if(!team)return;
  await save(form,"team",{
    id:team.id,name:form.elements.namedItem("name").value,expectedName:team.name
  },"チーム名を保存しました。");
});
$("sportForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const sport=data.sports.find(s=>s.id===sportId);
  if(!sport)return;
  const field=(name)=>form.elements.namedItem(name).value;
  const order=Number(field("order"));
  await save(form,"sport",{
    id:sport.id,name:field("name"),order,
    startTime:field("startTime"),endTime:field("endTime"),venue:field("venue"),
    expectedName:sport.name,expectedOrder:sport.order,
    expectedStartTime:sport.startTime,expectedEndTime:sport.endTime,
    expectedVenue:sport.venue
  },"競技情報を保存しました。");
});
$("heatList").addEventListener("change",event=>{
  if(event.target.name!=="status")return;
  const heatForm=event.target.closest("form[data-heat-id]");
  if(!heatForm)return;
  heatForm.querySelectorAll('select[name^="rank-"]').forEach(select=>{
    select.disabled=event.target.value!=="終了";
    if(select.disabled)select.value="0";
  });
});
$("matchList").addEventListener("change",event=>{
  if(event.target.name!=="status")return;
  const winner=event.target.closest("form")?.elements.namedItem("winnerId");
  if(!winner)return;
  winner.disabled=event.target.value!=="終了";
  if(winner.disabled)winner.value="";
});
$("heatList").addEventListener("submit",async event=>{
  const heatForm=event.target.closest("form[data-heat-id]");
  if(heatForm){
    event.preventDefault();
    const heat=data.heats.find(h=>h.sportId==="borrowed"&&h.id===heatForm.dataset.heatId);
    if(!heat)return;
    const status=heatForm.elements.namedItem("status").value;
    const ranks=Object.fromEntries(data.teams.map(team=>[
      team.id,status==="終了"?Number(heatForm.elements.namedItem("rank-"+team.id).value):0
    ]));
    if(status==="終了"&&new Set(Object.values(ranks)).size!==4){
      showMessage("4チームの順位を重複なく1〜4位で入力してください。","error");return;
    }
    await save(heatForm,"heat",{
      heatId:heat.id,status,ranks,
      scheduledAt:heatForm.elements.namedItem("scheduledAt").value,
      expectedStatus:heat.status,expectedRanks:heat.ranks,
      expectedScheduledAt:heat.scheduledAt
    },"第"+heat.id.slice(1)+"回の順位を保存しました。");
  }
});
$("matchList").addEventListener("submit",async event=>{
  const form=event.target.closest("form[data-match-id]");
  if(!form)return;
  event.preventDefault();
  const row=data.matches.find(m=>m.sportId===matchSportId&&m.id===form.dataset.matchId);
  if(!row)return;
  const field=(name)=>form.elements.namedItem(name).value;
  const status=field("status");
  const winnerId=status==="終了"?field("winnerId"):"";
  if(status==="終了"&&!winnerId){
    showMessage("終了した試合の勝者または引き分けを選択してください。","error");return;
  }
  await save(form,"match",{
    sportId:matchSportId,matchId:row.id,status,winnerId,
    court:row.court||"",scheduledAt:row.scheduledAt||"",
    scoreA:field("scoreA")===""?null:Number(field("scoreA")),
    scoreB:field("scoreB")===""?null:Number(field("scoreB")),
    expectedScoreA:row.scoreA??null,expectedScoreB:row.scoreB??null,
    expectedStatus:row.status,expectedWinnerId:row.winnerId,
    expectedCourt:row.court,expectedScheduledAt:row.scheduledAt
  },"試合結果を保存しました。公開画面に数秒以内に反映されます。");
});
window.addEventListener("beforeunload",event=>{
  if(!dirtyForms.size)return;
  event.preventDefault();
  event.returnValue="";
});
init();


