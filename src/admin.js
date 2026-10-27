const SESSION_COOKIE="festival_admin_session";
const SESSION_SECONDS=8*60*60;
const text=(v)=>String(v??"").trim();
const encoder=new TextEncoder();
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",...headers}
});
const bytesEqual=(a,b)=>{
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
};
const b64=(bytes)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64=(s)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const authConfigured=(env)=>Boolean(env.ADMIN_PASSWORD&&env.ADMIN_SESSION_SECRET);
const storageConfigured=(env)=>Boolean(env.TOURNAMENT_STORE);

async function hmac(data,secret){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(data)));
}
export async function createSession(secret,now=Math.floor(Date.now()/1000)){
  const expires=now+SESSION_SECONDS;
  const nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
  const payload=`v1.${expires}.${nonce}`;
  return `${payload}.${b64(await hmac(payload,secret))}`;
}
export async function verifySession(token,secret,now=Math.floor(Date.now()/1000)){
  if(!secret||typeof token!=="string"||token.length>256)return false;
  const parts=token.split(".");
  if(parts.length!==4||parts[0]!=="v1"||!/^\d{10,11}$/.test(parts[1])||! /^[A-Za-z0-9_-]{22}$/.test(parts[2]))return false;
  const exp=Number(parts[1]);
  if(exp<=now||exp>now+SESSION_SECONDS)return false;
  try{
    const actual=unb64(parts[3]);
    const signed=await hmac(parts.slice(0,3).join("."),secret);
    return bytesEqual(actual,signed);
  }catch{return false}
}
async function comparePasswords(given,expected){
  const digest=async s=>new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(s)));
  return bytesEqual(await digest(given),await digest(expected));
}
const cookieValue=(request)=>request.headers.get("Cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(SESSION_COOKIE+"="))?.slice(SESSION_COOKIE.length+1)||"";
const authorized=(request,env)=>authConfigured(env)&&verifySession(cookieValue(request),env.ADMIN_SESSION_SECRET);
function setCookie(value,request,maxAge=SESSION_SECONDS){
  const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`;
}
function sameOrigin(request){
  const origin=request.headers.get("Origin");
  return origin!==null&&origin===new URL(request.url).origin;
}
async function readJson(request){
  if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    throw new Error("Content-Typeはapplication/jsonにしてください");
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>4096)throw new Error("送信データが大きすぎます");
  const raw=await request.text();
  if(raw.length>4096)throw new Error("送信データが大きすぎます");
  try{return JSON.parse(raw)}catch{throw new Error("JSON形式が不正です")}
}
const failures=new Map();
function failureKey(request){return request.headers.get("CF-Connecting-IP")||"unknown"}
function blocked(request){
  const key=failureKey(request),entry=failures.get(key);
  if(!entry)return false;
  if(Date.now()-entry.start>15*60*1000){failures.delete(key);return false}
  return entry.count>=7;
}
function recordFailure(request){
  const key=failureKey(request),now=Date.now();
  const old=failures.get(key);
  if(!old||now-old.start>15*60*1000)failures.set(key,{count:1,start:now});
  else old.count++;
  if(failures.size>500)failures.delete(failures.keys().next().value);
}

export async function handleAdminApi(request,env,handlers){
  const pathname=new URL(request.url).pathname;
  const method=request.method;
  if(pathname==="/api/admin/session"&&method==="GET"){
    return json({authenticated:await authorized(request,env),configured:authConfigured(env),storageReady:storageConfigured(env)});
  }
  if(!pathname.startsWith("/api/admin/"))return json({error:"Not found"},404);
  if(!["GET","POST"].includes(method))return json({error:"Method not allowed"},405);
  if(method==="POST"&&!sameOrigin(request))return json({error:"不正な送信元です"},403);
  if(pathname==="/api/admin/login"&&method==="POST"){
    if(!authConfigured(env))return json({error:"管理者認証の環境変数が未設定です"},503);
    if(blocked(request))return json({error:"ログイン試行回数の上限です。15分後に試してください"},429);
    let input;try{input=await readJson(request)}catch(e){return json({error:e.message},400)}
    if(typeof input?.password!=="string"||input.password.length>256||
       !(await comparePasswords(input.password,env.ADMIN_PASSWORD))){
      recordFailure(request);
      return json({error:"パスワードが正しくありません"},401);
    }
    failures.delete(failureKey(request));
    return json({authenticated:true},200,{"Set-Cookie":setCookie(await createSession(env.ADMIN_SESSION_SECRET),request)});
  }
  if(pathname==="/api/admin/logout"&&method==="POST"){
    return json({authenticated:false},200,{"Set-Cookie":setCookie("",request,0)});
  }
  if(!await authorized(request,env))return json({error:"管理者ログインが必要です"},401);
  if(!storageConfigured(env))return json({error:"Cloudflare Durable Objectの設定が不足しています"},503);
  if(pathname==="/api/admin/data"&&method==="GET"){
    try{return json(await handlers.getData(env))}catch(e){
      console.error("Admin data error:",String(e));
      return json({error:"保存データの読込に失敗しました"},503)
    }
  }
  if(["/api/admin/match","/api/admin/team","/api/admin/sport"].includes(pathname)&&method==="POST"){
    let input;try{input=await readJson(request)}catch(e){return json({error:e.message},400)}
    try{
      const handler={"/api/admin/match":handlers.saveMatch,"/api/admin/team":handlers.saveTeam,"/api/admin/sport":handlers.saveSport}[pathname];
      const result=await handler(env,input);
      return json({ok:true,...result});
    }catch(e){
      if(e.conflict)return json({error:e.message},409);
      if(e.validation)return json({error:e.message},400);
      console.error("Admin save error:",String(e));
      return json({error:"保存できませんでした。ストレージの接続を確認してください"},503);
    }
  }
  return json({error:"Not found"},404);
}
