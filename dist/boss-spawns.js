import {isCampaign,installCampaignTracker,stageID,spawnEnemyType} from './campaign.js';

const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const KEYS=['slot','type','behavior','hp','cooldown'];
export function validateBossSpawns(state){
 if(!state||Object.keys(state).some(key=>!['stage','actors'].includes(key))||(state.stage!==null&&(typeof state.stage!=='string'||!/^[0-7]:[0-7]$/.test(state.stage)))||!Array.isArray(state.actors)||state.actors.length>32||state.actors.some(a=>!a||Object.keys(a).some(key=>!KEYS.includes(key))||!integer(a.slot,0,31)||!integer(a.type,23,44)||a.behavior!==2||!integer(a.hp,0,3)||!integer(a.cooldown,0,90))||new Set(state.actors.map(a=>a.slot)).size!==state.actors.length)throw new Error('Invalid spawned boss state in save.');
 return state;
}

// Original boss routines assume one particular arena and share encounter RAM.
// Portable admin bosses instead use native ground-monster movement, contact
// damage, flame detection and defeat animation, with the chosen original ROM
// boss model and an independent three-hit health pool. No assets are stored.
export function createBossSpawns(p){
 if(p._bossSpawns)return p._bossSpawns;
 installCampaignTracker(p);
 const state={stage:null,actors:[]},get=p.Get,cpu=p.CPURun,set=p.Set,run=p.Run;
 const actorAt=slot=>state.actors.find(a=>a.slot===slot&&p.RAM[0xeb8+slot]===a.type);
 function reset(){state.stage=null;state.actors=[];}
 function spawn(type,x,y){
  if(!integer(type,23,44))throw new Error('Choose a boss model from the monsters menu.');
  if(state.stage!==null&&state.stage!==stageID(p))reset();
  // Reuse the bounded, native ordinary initializer and its placement checks.
  const behavior=2,slot=spawnEnemyType(p,behavior,x,y);
  state.stage=stageID(p);state.actors=state.actors.filter(a=>a.slot!==slot);
  p.RAM[0xeb8+slot]=type;
  state.actors.push({slot,type,behavior,hp:3,cooldown:0});
  p._enemySpawns?.register(slot,type);return slot;
 }
 p.Get=function(address){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  if(physical>=0x1f0000&&physical<0x1f8000&&offset>=0xeb8&&offset<0xed8){
   const actor=actorAt(offset-0xeb8),bank=this.MPR[this.PC>>13]>>13;
   // Living forms keep their model. Death uses the common native ground-
   // monster animation: several arena-only forms otherwise become stuck in
   // a boss phase after their defeat animation reaches frame six.
   const living=this.RAM[0xd98+offset-0xeb8]&128;
   if(actor&&!(living&&bank===9&&(this.PC===0x9f04||this.PC===0x9f5f)))return actor.behavior;
  }
  return get.call(this,address);
 };
 p.CPURun=function(){
  const bank=this.MPR[this.PC>>13]>>13;
  if(bank===8&&(this.PC===0x7ca2||this.PC===0x7cae))reset();
  if(bank===9&&this.PC===0x83b0&&state.stage!==null&&state.stage!==stageID(this))reset();
  if(bank===9&&this.PC===0x9cd6){
   const actor=actorAt(this.X);
   if(actor&&actor.hp>0){
    if(!actor.cooldown){actor.hp--;actor.cooldown=90;}
    // Return from the native floor/flame collision check before it enters
    // defeat state. The final hit follows the original defeat routine.
    if(actor.hp>0)this.PC=0x9c8e;
   }
  }
  return cpu.call(this);
 };
 p.Set=function(address,value){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  if(physical>=0x1f0000&&physical<0x1f8000&&offset>=0xd98&&offset<0xdb8&&value===0)state.actors=state.actors.filter(a=>a.slot!==offset-0xd98);
  return set.call(this,address,value);
 };
 p.Run=function(){
  state.actors=state.actors.filter(actor=>this.RAM[0xd98+actor.slot]!==0&&this.RAM[0xeb8+actor.slot]===actor.type);
  for(const actor of state.actors)if(actor.cooldown)actor.cooldown--;
  return run.call(this);
 };
 const controller={state,spawn,reset,restore(data){validateBossSpawns(data);Object.assign(state,structuredClone(data));}};
 p._bossSpawns=controller;return controller;
}
export function spawnBossType(p,type,x,y){
 if(!isCampaign(p))throw new Error('Open the admin menu during an active campaign stage.');
 return createBossSpawns(p).spawn(type,x,y);
}
