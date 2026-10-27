import {handleAdminApi} from "./admin.js";
export {TournamentStore} from "./store.js";

function json(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
}

// Storage is private to this Worker; browsers can only reach the authenticated admin API.
async function storeCall(env,path,input){
  if(!env.TOURNAMENT_STORE)throw new Error("TOURNAMENT_STORE binding is missing");
  const id=env.TOURNAMENT_STORE.idFromName("festival-main");
  const store=env.TOURNAMENT_STORE.get(id);
  const response=await store.fetch(new Request("https://tournament.internal/"+path,{
    method:input===undefined?"GET":"POST",
    headers:input===undefined?{}:{"Content-Type":"application/json"},
    ...(input===undefined?{}:{body:JSON.stringify(input)})
  }));
  const payload=await response.json();
  if(!response.ok){
    const error=new Error(payload.error||"保存データにアクセスできません");
    error.validation=response.status===400;
    error.conflict=response.status===409;
    throw error;
  }
  return payload;
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/api/results"){
      if(request.method!=="GET")return json({error:"Method not allowed"},405);
      try{return json(await storeCall(env,"data"))}
      catch(error){
        console.error("Public tournament read failed:",String(error));
        return json({error:"大会データを取得できません。管理者に連絡してください。"},503);
      }
    }
    if(url.pathname==="/admin"||url.pathname==="/admin/"){
      if(request.method!=="GET")return json({error:"Method not allowed"},405);
      const page=await env.ASSETS.fetch(new Request(new URL("/admin.html",request.url)));
      const headers=new Headers(page.headers);
      headers.set("Cache-Control","no-store");
      headers.set("X-Frame-Options","DENY");
      headers.set("Content-Security-Policy","default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
      return new Response(page.body,{status:page.status,headers});
    }
    if(url.pathname.startsWith("/api/admin/")){
      return handleAdminApi(request,env,{
        getData:()=>storeCall(env,"data"),
        saveMatch:(_env,input)=>storeCall(env,"match",input),
        saveTeam:(_env,input)=>storeCall(env,"team",input),
        saveSport:(_env,input)=>storeCall(env,"sport",input)
      });
    }
    return env.ASSETS.fetch(request);
  }
};
