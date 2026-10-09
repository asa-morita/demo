// Cloudflare Worker + static assets. No Google credentials are sent to the browser.
const ranges=["チーム!A2:B","競技!A2:D","試合!A2:J","配点!A2:B"];
let tokenCache={token:"",expires:0};
let inFlight=null;
let lastGood=null;

const asText=(v)=>String(v??"").trim();
const thirdChoice=(v)=>{const s=asText(v).toLowerCase();return ["1","true","yes","on","あり","有"].includes(s)?true:(["0","false","no","off","なし","無"].includes(s)?false:null)};
const asNum=(v)=>asText(v)===""?null:(Number.isFinite(Number(v))?Number(v):null);
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function encodeJSON(value){return base64url(new TextEncoder().encode(JSON.stringify(value)))}
async function getGoogleToken(env) {
  if(tokenCache.token&&tokenCache.expires>Date.now()+120000)return tokenCache.token;
  const email=env.SHEETS_CLIENT_EMAIL,secret=env.SHEETS_PRIVATE_KEY;
  if(!email||!secret)throw new Error("Googleサービスアカウントの設定が不足しています");
  const now=Math.floor(Date.now()/1000);
  const header=encodeJSON({alg:"RS256",typ:"JWT"});
  const claims=encodeJSON({iss:email,scope:"https://www.googleapis.com/auth/spreadsheets.readonly",
    aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
  const text=header+"."+claims;
  const clean=secret.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const der=Uint8Array.from(atob(clean),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(text)));
  const assertion=text+"."+base64url(sig);
  const body=new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion});
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Google認証に失敗しました ("+response.status+")");
  const result=await response.json();
  tokenCache={token:result.access_token,expires:Date.now()+(result.expires_in||3600)*1000};
  return result.access_token;
}
async function fetchSheet(env){
  const id=asText(env.SHEETS_SPREADSHEET_ID);
  if(!id)throw new Error("SHEETS_SPREADSHEET_IDが設定されていません");
  const query=new URLSearchParams();
  ranges.forEach(r=>query.append("ranges",r)); query.set("valueRenderOption","FORMATTED_VALUE");
  const options={signal:AbortSignal.timeout(10000),headers:{}};
  if(env.SHEETS_API_KEY){query.set("key",env.SHEETS_API_KEY)}
  else options.headers.Authorization="Bearer "+await getGoogleToken(env);
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+"/values:batchGet?"+query;
  const response=await fetch(url,options);
  if(!response.ok){
    if(response.status===429)throw new Error("Google Sheets APIの読み取り制限に達しました");
    throw new Error("Google Sheets APIの読み取りに失敗しました ("+response.status+")");
  }
  const body=await response.json();
  const entries=(body.valueRanges||[]).map(x=>x.values||[]);
  const [teamRows=[],sportRows=[],matchRows=[],pointRows=[]]=entries;
  const teams=teamRows.filter(r=>asText(r[0])).map(r=>({id:asText(r[0]),name:asText(r[1])||asText(r[0])}));
  const sports=sportRows.filter(r=>asText(r[0])).map(r=>({id:asText(r[0]),name:asText(r[1])||asText(r[0]),thirdPlace:thirdChoice(r[2]),order:asNum(r[3])||0}));
  const matches=matchRows.filter(r=>asText(r[0])&&asText(r[1])).map(r=>({
    sportId:asText(r[0]),id:asText(r[1]),teamA:asText(r[2]),teamB:asText(r[3]),
    scoreA:asNum(r[4]),scoreB:asNum(r[5]),status:asText(r[6])||"未開始",
    winnerId:asText(r[7]),court:asText(r[8]),scheduledAt:asText(r[9])
  }));
  const points=Object.fromEntries(pointRows.filter(r=>asText(r[0])&&asNum(r[1])!==null).map(r=>[asText(r[0]),asNum(r[1])]));
  if(teams.length!==8||!sports.length)throw new Error("シート内容を確認してください（チームは8件、競技は1件以上必要）");
  return {teams,sports,matches,points,source:"sheet",updatedAt:new Date().toISOString()};
}
function json(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
}
async function getResult(request,env,ctx) {
  if(!env.SHEETS_SPREADSHEET_ID){
    const res=await env.ASSETS.fetch(new Request(new URL("/demo-data.json",request.url)));
    if(!res.ok)return json({error:"デモデータの読み込みに失敗しました"},500);
    const data=await res.json();
    return json({...data,source:"demo",updatedAt:new Date().toISOString()});
  }
  // Cache API is unavailable in some preview environments. Do not fail the whole API.
  const cache=typeof caches!=="undefined"?caches.default:null;
  const cacheKey=new Request(new URL("/__result_cache_2026",request.url));
  if(cache){
    try{const hit=await cache.match(cacheKey);if(hit)return json(await hit.json())}
    catch(error){console.warn("Cache read unavailable:",String(error))}
  }
  if(!inFlight){
    inFlight=fetchSheet(env).then(async result=>{
      lastGood=result;
      try{
        const stored=new Response(JSON.stringify(result),{headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=5"}});
        if(cache)ctx.waitUntil(cache.put(cacheKey,stored).catch(error=>console.warn("Cache write unavailable:",String(error))));
      }catch(_){}
      return result;
    }).finally(()=>{inFlight=null});
  }
  try{return json(await inFlight)}
  catch(e){
    console.error("Tournament API error:",String(e.message||e));
    // Only a previously successful sheet response may be used as stale data.
    if(lastGood)return json({...lastGood,stale:true});
    return json({error:"試合データを取得できません。管理者に連絡してください。"},502);
  }
}
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/results"){
      if(request.method!=="GET")return json({error:"Method not allowed"},405);
      return getResult(request,env,ctx);
    }
    return env.ASSETS.fetch(request);
  }
};
