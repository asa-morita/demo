import {FIXTURES,PODIUM_POINTS} from "../public/bracket.js";

const clean=(value)=>String(value??"").trim();
const error=(message,conflict=false)=>{
  const e=new Error(message);
  e[conflict?"conflict":"validation"]=true;
  return e;
};
const sportsSeed=[
  ["futsal","フットサル"],
  ["volleyball","バレーボール"],
  ["basketball","バスケットボール"],
  ["dodgeball","ドッチボール"],
  ["tugofwar","綱引き"],
  ["borrowed","借人競争"]
];

export function createDefaultData(){
  const teams=["A","B","C","D"].map(id=>({id,name:id+"チーム"}));
  const sports=sportsSeed.map(([id,name],index)=>({
    id,name,order:index+1,startTime:"",endTime:"",venue:""
  }));
  const matches=sports.flatMap(sport=>FIXTURES.map(fixture=>({
    sportId:sport.id,id:fixture.id,
    teamA:teams[fixture.a].id,teamB:teams[fixture.b].id,
    scoreA:null,scoreB:null,status:"未開始",winnerId:"",court:"",scheduledAt:""
  })));
  return {teams,sports,matches,points:{...PODIUM_POINTS},source:"admin",updatedAt:""};
}

function requiredString(value,label,max){
  if(typeof value!=="string"||!value.trim()||value.trim().length>max)
    throw error(label+"は1〜"+max+"文字で入力してください");
  return value.trim();
}
function optionalString(value,label,max){
  if(typeof value!=="string"||value.trim().length>max)
    throw error(label+"は"+max+"文字以内で入力してください");
  return value.trim();
}
function assertExpected(current,expected){
  if(current!==expected)throw error("別の管理者が変更しています。最新情報を再読込してください",true);
}
function findSport(data,id){
  const sport=data.sports.find(s=>s.id===id);
  if(!sport)throw error("競技が見つかりません");
  return sport;
}
export function validateMatchUpdate(input,data){
  if(!input||typeof input!=="object")throw error("試合データが不正です");
  const sportId=clean(input.sportId),matchId=clean(input.matchId);
  findSport(data,sportId);
  const fixture=FIXTURES.find(f=>f.id===matchId);
  if(!fixture||data.teams.length!==4)throw error("対戦カードが不正です");
  const matches=data.matches.filter(m=>m.sportId===sportId&&m.id===matchId);
  if(matches.length!==1)throw error("試合情報が存在しない、または重複しています");
  const match=matches[0];
  const teamA=data.teams[fixture.a].id,teamB=data.teams[fixture.b].id;
  if(match.teamA!==teamA||match.teamB!==teamB)throw error("対戦カードのチームが一致しません");
  const status=clean(input.status),winnerId=clean(input.winnerId);
  if(!["未開始","試合中","終了"].includes(status))throw error("試合状態が不正です");
  if(status==="終了"&&![teamA,teamB].includes(winnerId))
    throw error("終了した試合の勝者を選択してください");
  if(status!=="終了"&&winnerId)throw error("未開始・試合中の勝者は空欄にしてください");
  const court=optionalString(input.court??"","コート",80);
  const scheduledAt=optionalString(input.scheduledAt??"","開始予定",80);
  assertExpected(match.status,clean(input.expectedStatus));
  assertExpected(match.winnerId,clean(input.expectedWinnerId));
  assertExpected(match.court,clean(input.expectedCourt));
  assertExpected(match.scheduledAt,clean(input.expectedScheduledAt));
  return {match,status,winnerId,court,scheduledAt,sportId,matchId};
}
export function validateTeamUpdate(input,data){
  if(!input||typeof input!=="object")throw error("チームデータが不正です");
  const team=data.teams.find(t=>t.id===clean(input.id));
  if(!team)throw error("チームが見つかりません");
  const name=requiredString(input.name,"チーム名",40);
  assertExpected(team.name,clean(input.expectedName));
  return {team,name};
}
export function validateSportUpdate(input,data){
  if(!input||typeof input!=="object")throw error("競技データが不正です");
  const sport=findSport(data,clean(input.id));
  const name=requiredString(input.name,"競技名",40);
  if(!Number.isInteger(input.order)||input.order<1||input.order>999)
    throw error("表示順は1〜999の整数にしてください");
  const startTime=optionalString(input.startTime??"","開始時刻",5);
  const endTime=optionalString(input.endTime??"","終了時刻",5);
  const clock=/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
  if((startTime&&!clock.test(startTime))||(endTime&&!clock.test(endTime)))
    throw error("時刻はHH:MM形式で指定してください");
  if(startTime&&endTime&&startTime>endTime)
    throw error("終了時刻は開始時刻以降にしてください");
  const venue=optionalString(input.venue??"","会場",80);
  for(const field of ["name","order","startTime","endTime","venue"]){
    const current=sport[field],expected=input["expected"+field[0].toUpperCase()+field.slice(1)];
    assertExpected(current,field==="order"?expected:clean(expected));
  }
  return {sport,name,order:input.order,startTime,endTime,venue};
}
export function applyUpdate(data,kind,input){
  if(kind==="match"){
    const u=validateMatchUpdate(input,data);
    Object.assign(u.match,{status:u.status,winnerId:u.winnerId,court:u.court,scheduledAt:u.scheduledAt});
    return {sportId:u.sportId,matchId:u.matchId,status:u.status,winnerId:u.winnerId};
  }
  if(kind==="team"){
    const u=validateTeamUpdate(input,data);u.team.name=u.name;
    return {id:u.team.id,name:u.name};
  }
  if(kind==="sport"){
    const u=validateSportUpdate(input,data);
    Object.assign(u.sport,{name:u.name,order:u.order,startTime:u.startTime,endTime:u.endTime,venue:u.venue});
    return {id:u.sport.id,name:u.name};
  }
  throw error("編集対象が不正です");
}

// One Durable Object owns all edits; storage transactions keep parallel saves safe.
export class TournamentStore {
  constructor(ctx){this.ctx=ctx}
  async fetch(request){
    const path=new URL(request.url).pathname;
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{
      status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
    });
    if(request.method==="GET"&&path==="/data"){
      try{return respond(await this.ctx.storage.get("tournament")||createDefaultData())}
      catch(e){console.error("Tournament read error",e);return respond({error:"保存データを取得できません"},503)}
    }
    if(request.method==="POST"&&["/match","/team","/sport"].includes(path)){
      try{
        const input=await request.json();
        const result=await this.ctx.storage.transaction(async tx=>{
          const data=await tx.get("tournament")||createDefaultData();
          const updated=applyUpdate(data,path.slice(1),input);
          data.updatedAt=new Date().toISOString();
          await tx.put("tournament",data);
          return updated;
        });
        return respond({ok:true,...result});
      }catch(e){
        if(e.conflict)return respond({error:e.message},409);
        if(e.validation||e instanceof SyntaxError)return respond({error:e.message},400);
        console.error("Tournament save error",e);
        return respond({error:"保存できませんでした"},503);
      }
    }
    return respond({error:"Not found"},404);
  }
}
