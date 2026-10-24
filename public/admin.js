import {normalizeData,buildRoundRobin} from "./bracket.js";
const $=(id)=>document.getElementById(id);
const escapeHTML=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let data=null;
let sportId="";
const showMessage=(message,kind="info")=>{
  const box=$("message");
  box.textContent=message;
  box.className="message "+kind;
};
async function api(path,method="GET",body=null){
  const options={method,credentials:"same-origin",cache:"no-store",headers:{}};
  if(body!==null){options.headers["Content-Type"]="application/json";options.body=JSON.stringify(body)}
  const response=await fetch("/api/admin/"+path,options);
  let payload;
  try{payload=await response.json()}catch{throw new Error("サーバーの応答を読み取れません")}
  if(!response.ok) {
    const err=new Error(payload.error||"通信に失敗しました");
    err.status=response.status;
    throw err;
  }
  return payload;
}
function render(){
  if(!data)return;
  const sports=data.sports;
  if(!sports.some(s=>s.id===sportId))sportId=sports[0]?.id||"";
  $("sportSelect").innerHTML=sports.map(s=>
    `<option value="${escapeHTML(s.id)}" ${s.id===sportId?"selected":""}>${escapeHTML(s.name)}</option>`).join("");
  const league=buildRoundRobin(data,sportId);
  const winnerOptions=(m,winner)=>
    '<option value="">未選択</option>'+
    [m.teamA,m.teamB].map(id=>`<option value="${escapeHTML(id)}" ${winner===id?"selected":""}>${escapeHTML(data.teams.find(t=>t.id===id)?.name||id)}</option>`).join("");
  const rows=league.all.map(m=>{
    const original=data.matches.find(item=>item.sportId===sportId&&item.id===m.id);
    const status=original?.status||"未開始";
    const winner=status==="終了"?original?.winnerId||"":"";
    const statusOptions=["未開始","試合中","終了"].map(value=>
      `<option value="${value}" ${status===value?"selected":""}>${value}</option>`).join("");
    return `<form class="match-editor" data-match-id="${escapeHTML(m.id)}" data-original-status="${escapeHTML(status)}" data-original-winner="${escapeHTML(original?.winnerId||"")}">
      <div class="match-heading"><span>${escapeHTML(m.round.replace("R","第"))}節 ・ ${escapeHTML(m.id)}</span>
        <span class="match-state ${m.status==="要確認"?"problem":""}">${escapeHTML(m.status)}</span>
      </div>
      <strong class="match-opponents">${escapeHTML(m.labelA)} <span>対</span> ${escapeHTML(m.labelB)}</strong>
      ${m.issue?`<p class="problem-text">${escapeHTML(m.issue)}</p>`:""}
      <div class="fields">
        <label>試合状態
          <select name="status" required>${statusOptions}</select>
        </label>
        <label>勝者
          <select name="winnerId" ${status!=="終了"?"disabled":""}>${winnerOptions(m,winner)}</select>
        </label>
      </div>
      <button class="primary save" type="submit">この試合を保存</button>
    </form>`;
  }).join("");
  $("matchList").innerHTML=rows||'<p>表示できる試合がありません。</p>';
}
async function loadData(){
  const payload=await api("data");
  data=normalizeData(payload);
  if(data.teams.length!==4)throw new Error("チーム数が4件ではありません");
  $("editorPanel").hidden=false;
  $("loginPanel").hidden=true;
  render();
  showMessage("最新の試合情報を読み込みました。","success");
}
async function init(){
  try{
    const status=await api("session");
    if(!status.configured){
      $("loginPanel").hidden=true;
      showMessage("管理者認証が未設定です。Cloudflare Secrets に ADMIN_PASSWORD と ADMIN_SESSION_SECRET を登録してください。","error");
      return;
    }
    if(!status.authenticated){
      $("loginPanel").hidden=false;
      showMessage("編集には管理者ログインが必要です。");
      return;
    }
    await loadData();
  }catch(e){showMessage(e.message,"error")}
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const button=e.currentTarget.querySelector("button");
  button.disabled=true;
  try{
    await api("login","POST",{password:$("password").value});
    $("password").value="";
    await loadData();
  }catch(err){showMessage(err.message,"error")}
  finally{button.disabled=false}
});
$("sportSelect").addEventListener("change",e=>{sportId=e.target.value;render()});
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
$("matchList").addEventListener("change",e=>{
  if(e.target.name!=="status")return;
  const winner=e.target.closest("form")?.elements.namedItem("winnerId");
  if(!winner)return;
  winner.disabled=e.target.value!=="終了";
  if(winner.disabled)winner.value="";
});
$("matchList").addEventListener("submit",async e=>{
  const form=e.target.closest("form[data-match-id]");
  if(!form)return;
  e.preventDefault();
  const status=form.elements.namedItem("status").value;
  const winnerId=status==="終了"?form.elements.namedItem("winnerId").value:"";
  if(status==="終了"&&!winnerId){showMessage("終了した試合の勝者を選択してください。","error");return}
  const button=form.querySelector("button.save");
  button.disabled=true;
  try{
    await api("match","POST",{
      sportId,matchId:form.dataset.matchId,status,winnerId,
      expectedStatus:form.dataset.originalStatus,
      expectedWinnerId:form.dataset.originalWinner
    });
    await loadData();
    showMessage("試合結果をGoogleスプレッドシートに保存しました。公開画面には数秒以内に反映されます。","success");
  }catch(err){
    showMessage(err.message+(err.status===409?" 再読込ボタンから最新情報を取得してください。":""),"error");
    button.disabled=false;
  }
});
init();
