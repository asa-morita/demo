import {FIXTURES,TUG_FIXTURES,createTugMatches,PODIUM_POINTS,BORROWED_HEAT_IDS,createBorrowedHeats} from "../public/bracket.js";

const clean=(value)=>String(value??"").trim();
const error=(message,conflict=false)=>{
  const e=new Error(message);
  e[conflict?"conflict":"validation"]=true;
  return e;
};
// Increment on one-time published event order changes, never to override later admin edits.
const SPORTS_ORDER_VERSION=1;
const TUG_FORMAT_VERSION=1;
const FIRST_FOUR_SPORTS=["volleyball","basketball","futsal","dodgeball"];
const sportsSeed=[
  ["volleyball","バレーボール"],
  ["basketball","バスケットボール"],
  ["futsal","フットサル"],
  ["dodgeball","ドッジボール"],
  ["tugofwar","綱引き"],
  ["borrowed","借人競争"]
];

export function createDefaultData(){
  const teams=["A","B","C","D"].map(id=>({id,name:id+"チーム"}));
  const sports=sportsSeed.map(([id,name],index)=>({
    id,name,order:index+1,startTime:"",endTime:"",venue:""
  }));
  const matches=sports.filter(sport=>sport.id!=="borrowed"&&sport.id!=="tugofwar").flatMap(sport=>FIXTURES.map(fixture=>({
    sportId:sport.id,id:fixture.id,
    teamA:teams[fixture.a].id,teamB:teams[fixture.b].id,
    scoreA:null,scoreB:null,status:"未開始",winnerId:"",court:"",scheduledAt:""
  }))).concat(createTugMatches(teams));
  return {teams,sports,matches,heats:createBorrowedHeats(teams),points:{...PODIUM_POINTS},pointsVisible:true,sportsOrderVersion:SPORTS_ORDER_VERSION,tugFormatVersion:TUG_FORMAT_VERSION,source:"admin",updatedAt:""};
}

// Upgrade existing Durable Object records without resetting winners, scheduled times or teams.
// The sports order migration runs once, so the admin can freely edit order afterward.
export function ensureHeats(data){
  const migrateSportsOrder=(data.sportsOrderVersion??0)<SPORTS_ORDER_VERSION;
  const migrateTug=(data.tugFormatVersion??0)<TUG_FORMAT_VERSION;
  if(!migrateSportsOrder&&!migrateTug&&Array.isArray(data.heats)&&typeof data.pointsVisible==="boolean")return data;
  const sports=migrateSportsOrder?data.sports.map(sport=>{
    const index=FIRST_FOUR_SPORTS.indexOf(sport.id);
    if(index<0)return sport;
    return {...sport,order:index+1,
      ...(sport.id==="dodgeball"&&sport.name==="ドッチボール"?{name:"ドッジボール"}:{})};
  }):data.sports;
  const previousTug=migrateTug?(data.matches||[]).filter(m=>m.sportId==="tugofwar"):[];
  return {...data,
    sports,sportsOrderVersion:SPORTS_ORDER_VERSION,tugFormatVersion:TUG_FORMAT_VERSION,
    // Old 1v1 tug results are incompatible with 2v2 results; archive them once.
    ...(migrateTug&&previousTug.length?{legacyTugMatches:previousTug}:{}),
    matches:migrateTug?[
      ...(data.matches||[]).filter(m=>m.sportId!=="tugofwar"),
      ...createTugMatches(data.teams)
    ]:data.matches,
    heats:Array.isArray(data.heats)?data.heats:createBorrowedHeats(data.teams),
    pointsVisible:typeof data.pointsVisible==="boolean"?data.pointsVisible:true
  };
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
function optionalScore(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||value>9999)
    throw error("得点は0〜9999の整数で入力してください");
  return value;
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
  if(sportId==="borrowed")throw error("借人競争は4回制の順位入力画面を使用してください");
  const isTug=sportId==="tugofwar";
  const fixture=(isTug?TUG_FIXTURES:FIXTURES).find(f=>f.id===matchId);
  if(!fixture||data.teams.length!==4)throw error("対戦カードが不正です");
  const matches=data.matches.filter(m=>m.sportId===sportId&&m.id===matchId);
  if(matches.length!==1)throw error("試合情報が存在しない、または重複しています");
  const match=matches[0];
  const teamA=isTug?fixture.sideA.map(i=>data.teams[i].id).join("+"):data.teams[fixture.a].id;
  const teamB=isTug?fixture.sideB.map(i=>data.teams[i].id).join("+"):data.teams[fixture.b].id;
  if(match.teamA!==teamA||match.teamB!==teamB)throw error("対戦カードのチームが一致しません");
  const status=clean(input.status),winnerId=clean(input.winnerId);
  if(!["未開始","試合中","終了"].includes(status))throw error("試合状態が不正です");
  if(status==="終了"&&![teamA,teamB,"draw"].includes(winnerId))
    throw error("終了した試合の勝者または引き分けを選択してください");
  if(status!=="終了"&&winnerId)throw error("未開始・試合中の勝者は空欄にしてください");
  const court=optionalString(input.court??"","コート",80);
  const scheduledAt=optionalString(input.scheduledAt??"","開始予定",80);
  const editsScores=Object.hasOwn(input,"scoreA")||Object.hasOwn(input,"scoreB");
  const scoreA=editsScores?optionalScore(input.scoreA):(match.scoreA??null);
  const scoreB=editsScores?optionalScore(input.scoreB):(match.scoreB??null);
  if(editsScores){
    if((scoreA===null)!==(scoreB===null))throw error("両チームの得点を入力するか、両方を空欄にしてください");
    assertExpected(match.scoreA??null,input.expectedScoreA);
    assertExpected(match.scoreB??null,input.expectedScoreB);
  }
  assertExpected(match.status,clean(input.expectedStatus));
  assertExpected(match.winnerId,clean(input.expectedWinnerId));
  assertExpected(match.court,clean(input.expectedCourt));
  assertExpected(match.scheduledAt,clean(input.expectedScheduledAt));
  return {match,status,winnerId,court,scheduledAt,scoreA,scoreB,sportId,matchId};
}

export function validateHeatUpdate(input,data){
  if(!input||typeof input!=="object")throw error("回別順位の入力が不正です");
  const heatId=clean(input.heatId);
  if(!BORROWED_HEAT_IDS.includes(heatId))throw error("回の番号が不正です");
  const heats=ensureHeats(data).heats.filter(h=>h.id===heatId&&h.sportId==="borrowed");
  if(heats.length!==1)throw error("回別順位の記録が存在しない、または重複しています");
  const heat=heats[0],status=clean(input.status);
  if(!["未開始","試合中","終了"].includes(status))throw error("試合状態が不正です");
  if(data.teams.length!==4||new Set(data.teams.map(t=>t.id)).size!==4)
    throw error("4チームのデータが不正です");
  if(!input.ranks||typeof input.ranks!=="object"||Array.isArray(input.ranks))
    throw error("順位データが不正です");
  const ids=data.teams.map(t=>t.id);
  if(Object.keys(input.ranks).length!==4||ids.some(id=>!Object.hasOwn(input.ranks,id)))
    throw error("4チーム全員の順位を入力してください");
  const ranks=Object.fromEntries(ids.map(id=>[id,input.ranks[id]]));
  const values=Object.values(ranks);
  if(status==="終了"){
    if(!values.every(n=>Number.isInteger(n)&&n>=1&&n<=4)||new Set(values).size!==4)
      throw error("終了した回は4チームの順位を1〜4位で重複なく登録してください");
  }else if(!values.every(n=>n===0)){
    throw error("未開始・試合中では順位を空欄にしてください");
  }
  const scheduledAt=optionalString(input.scheduledAt??"","開始予定",80);
  assertExpected(heat.status,clean(input.expectedStatus));
  assertExpected(heat.scheduledAt,clean(input.expectedScheduledAt));
  if(!input.expectedRanks||typeof input.expectedRanks!=="object")throw error("変更前の順位が不正です");
  for(const id of ids)assertExpected(heat.ranks?.[id]??0,input.expectedRanks[id]);
  return {heat,status,ranks,scheduledAt,heatId};
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
  if(kind==="settings"){
    if(!input||typeof input!=="object"||
       typeof input.pointsVisible!=="boolean"||typeof input.expectedPointsVisible!=="boolean")
      throw error("ポイントの表示設定が不正です");
    assertExpected(data.pointsVisible!==false,input.expectedPointsVisible);
    data.pointsVisible=input.pointsVisible;
    return {pointsVisible:data.pointsVisible};
  }
  if(kind==="heat"){
    const u=validateHeatUpdate(input,data);
    Object.assign(u.heat,{status:u.status,ranks:u.ranks,scheduledAt:u.scheduledAt});
    return {heatId:u.heatId,status:u.status,ranks:u.ranks};
  }
  if(kind==="match"){
    const u=validateMatchUpdate(input,data);
    Object.assign(u.match,{status:u.status,winnerId:u.winnerId,court:u.court,scheduledAt:u.scheduledAt,scoreA:u.scoreA,scoreB:u.scoreB});
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
      try{return respond(ensureHeats(await this.ctx.storage.get("tournament")||createDefaultData()))}
      catch(e){console.error("Tournament read error",e);return respond({error:"保存データを取得できません"},503)}
    }
    if(request.method==="POST"&&["/match","/team","/sport","/heat","/settings"].includes(path)){
      try{
        const input=await request.json();
        const result=await this.ctx.storage.transaction(async tx=>{
          const data=ensureHeats(await tx.get("tournament")||createDefaultData());
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


