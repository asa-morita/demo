import {normalizeData,buildRoundRobin} from "./bracket.js";

const $=(id)=>document.getElementById(id);
const escapeHTML=(value)=>String(value??"").replace(/[&<>"']/g,
  char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let data=null;
let sportId="";

function showMessage(message,kind="info"){
  const element=$("message");
  element.textContent=message;
  element.className="message "+kind;
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
    [match.teamA,match.teamB].map(id=>
      '<option value="'+escapeHTML(id)+'"'+(id===selected?' selected':'')+'>'+
      escapeHTML(data.teams.find(t=>t.id===id)?.name||id)+'</option>'
    ).join("");
}
function renderMatches(){
  const league=buildRoundRobin(data,sportId);
  if(!league){$("matchList").replaceChildren();return}
  $("matchList").innerHTML=league.all.map(match=>{
    const row=data.matches.find(item=>item.sportId===sportId&&item.id===match.id);
    const status=row?.status||"未開始";
    const winner=status==="終了"?(row?.winnerId||""):"";
    const statusOptions=["未開始","試合中","終了"].map(value=>
      '<option value="'+value+'"'+(status===value?' selected':'')+'>'+value+'</option>'
    ).join("");
    return '<form class="match-editor" data-match-id="'+escapeHTML(match.id)+'">'+
      '<div class="match-heading"><span>'+escapeHTML(match.round.replace("R","第"))+
      '節 ・ '+escapeHTML(match.id)+'</span><span class="match-state'+
      (match.status==="要確認"?' problem':'')+'">'+escapeHTML(match.status)+'</span></div>'+
      '<strong class="match-opponents">'+escapeHTML(match.labelA)+' <span>対</span> '+
        escapeHTML(match.labelB)+'</strong>'+
      (match.issue?'<p class="problem-text">'+escapeHTML(match.issue)+'</p>':'')+
      '<div class="fields">'+
      '<label>試合状態<select name="status" required>'+statusOptions+'</select></label>'+
      '<label>勝者<select name="winnerId"'+(status!=="終了"?' disabled':'')+'>'+
        winnerOptions(match,winner)+'</select></label>'+
      '<label>コート<input name="court" maxlength="80" value="'+escapeHTML(row?.court||"")+'"></label>'+
      '<label>開始予定<input name="scheduledAt" maxlength="80" value="'+escapeHTML(row?.scheduledAt||"")+'" placeholder="例：13:30"></label>'+
      '</div><button class="primary save" type="submit">この試合を保存</button></form>';
  }).join("");
}
function render(){
  if(!data)return;
  if(!data.sports.some(s=>s.id===sportId))sportId=data.sports[0]?.id||"";
  $("sportSelect").innerHTML=data.sports.map(s=>
    '<option value="'+escapeHTML(s.id)+'"'+(s.id===sportId?' selected':'')+'>'+
    escapeHTML(s.name)+'</option>').join("");
  renderTeams();
  renderSport();
  renderMatches();
}
async function loadData(){
  const payload=await api("data");
  data=normalizeData(payload);
  if(data.teams.length!==4||!data.sports.length)throw new Error("大会データが不正です");
  $("editorPanel").hidden=false;
  $("loginPanel").hidden=true;
  render();
  showMessage("最新の大会情報を読み込みました。","success");
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
    await loadData();
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
$("sportSelect").addEventListener("change",event=>{
  sportId=event.target.value;
  renderSport();
  renderMatches();
});
$("refreshButton").addEventListener("click",async()=>{
  $("refreshButton").disabled=true;
  try{await loadData()}catch(err){showMessage(err.message,"error")}
  finally{$("refreshButton").disabled=false}
});
$("logoutButton").addEventListener("click",async()=>{
  try{
    await api("logout","POST",{});
    data=null;$("matchList").replaceChildren();
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
$("matchList").addEventListener("change",event=>{
  if(event.target.name!=="status")return;
  const winner=event.target.closest("form")?.elements.namedItem("winnerId");
  if(!winner)return;
  winner.disabled=event.target.value!=="終了";
  if(winner.disabled)winner.value="";
});
$("matchList").addEventListener("submit",async event=>{
  const form=event.target.closest("form[data-match-id]");
  if(!form)return;
  event.preventDefault();
  const row=data.matches.find(m=>m.sportId===sportId&&m.id===form.dataset.matchId);
  if(!row)return;
  const field=(name)=>form.elements.namedItem(name).value;
  const status=field("status");
  const winnerId=status==="終了"?field("winnerId"):"";
  if(status==="終了"&&!winnerId){
    showMessage("終了した試合の勝者を選択してください。","error");return;
  }
  await save(form,"match",{
    sportId,matchId:row.id,status,winnerId,
    court:field("court"),scheduledAt:field("scheduledAt"),
    expectedStatus:row.status,expectedWinnerId:row.winnerId,
    expectedCourt:row.court,expectedScheduledAt:row.scheduledAt
  },"試合結果を保存しました。公開画面に数秒以内に反映されます。");
});
init();
