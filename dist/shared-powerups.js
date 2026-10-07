import {installCampaignTracker,isCampaign,playerPosition} from './campaign.js';

const MAX_COUNT=1000000;
const defaults=()=>({fireRange:1,bombCapacity:1,speedUp:false,remote:false,bombPass:false,wallPass:false,fireproof:0,extraLives:0});
const validType=type=>Number.isInteger(type)&&type>=0&&type<15&&type!==8;
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;

export function validateSharedPowerups(data){
 if(!data||Object.keys(data).some(k=>!['enabled','counts','powers','pending'].includes(k))||typeof data.enabled!=='boolean'||!Array.isArray(data.counts)||data.counts.length!==15||data.counts.some(n=>!integer(n,MAX_COUNT))||data.counts[8]!==0)throw new Error('Invalid shared power-ups in save.');
 const power=data.powers;
 if(!power||Object.keys(power).some(k=>!Object.hasOwn(defaults(),k))||!integer(power.fireRange,5)||power.fireRange<1||!integer(power.bombCapacity,5)||power.bombCapacity<1||!integer(power.fireproof,3600)||!integer(power.extraLives,255)||['speedUp','remote','bombPass','wallPass'].some(k=>typeof power[k]!=='boolean'))throw new Error('Invalid shared power-up effects in save.');
 if(data.pending!==null&&(!data.enabled||!data.pending||Object.keys(data.pending).some(k=>!['type','slot','stack','returnPC','bank'].includes(k))||!validType(data.pending.type)||!integer(data.pending.slot,24)||!integer(data.pending.stack,255)||!integer(data.pending.returnPC,65535)||!integer(data.pending.bank,255)))throw new Error('Invalid pending shared pickup in save.');
}

// The native item handler remains responsible for a primary human's pickup.
// Companion and remote actors apply their own local effect before calling
// collect, so the collector is never rewarded twice.
export function createSharedPowerups(p,{getActors=()=>[],getHuman=()=>playerPosition(p),onCollect=()=>{}}={}){
 installCampaignTracker(p);
 const state={enabled:false,counts:Array(15).fill(0),powers:defaults(),pending:null},set=p.Set,cpu=p.CPURun;
 const active=()=>state.enabled&&isCampaign(p)&&!p._newCampaign?.transition&&!p._spectator?.transition;
 const actors=()=>[...new Set(getActors())].filter(Boolean);
 function humanPowers(){
  return {fireRange:Math.max(1,Math.min(5,p.RAM[0x84d]&127)),bombCapacity:Math.max(1,Math.min(5,p.RAM[0x84c]&127)),speedUp:!!p.RAM[0x84e],remote:!!(p.RAM[0x43a]&16),bombPass:!!(p.RAM[0x43a]&32),wallPass:!!(p.RAM[0x43a]&64),fireproof:p.RAM[0x43a]&128?Math.min(3600,p.RAM[0x446]|p.RAM[0x447]<<8):0};
 }
 function writeHuman(type,value){
  if(!getHuman())return;
  if(type===0||type===1){const offset=type===0?0x84d:0x84c;p.RAM[offset]=128|value;}
  if(type===2)p.RAM[0x43a]|=16;
  if(type===3)p.RAM[0x84e]=1;
  if(type===4)p.RAM[0x43a]|=32;
  if(type===5)p.RAM[0x43a]|=64;
  if(type===6){p.RAM[0x43a]|=128;p.RAM[0x446]=value&255;p.RAM[0x447]=value>>8;}
  if(type===7)p.RAM[0x438]=Math.min(255,p.RAM[0x438]+1);
 }
 function collect(type,source=null){
  if(!active()||!validType(type))return false;
  const key=['fireRange','bombCapacity','remote','speedUp','bombPass','wallPass','fireproof','extraLives'][type];
  let value;
  if(type===0||type===1){
   // Old saves can contain independently upgraded actors. Reward everyone,
   // then converge on the highest level instead of reducing a stronger actor
   // to the collector's previous independent level.
   const levels=[state.powers[key]+1,source?source[key]:humanPowers()[key],...actors().filter(a=>a!==source).map(a=>(a[key]??1)+1),...(source&&getHuman()?[humanPowers()[key]+1]:[])];
   value=Math.min(5,Math.max(...levels));state.powers[key]=value;
   if(source)source[key]=value;else writeHuman(type,value);
  }
  else if(type>=2&&type<=5){value=true;state.powers[key]=true;}
  else if(type===6){value=3600;state.powers.fireproof=value;}
  else if(type===7)state.powers.extraLives=Math.min(255,state.powers.extraLives+1);
  for(const actor of actors())if(actor!==source){
   if(type<=6)actor[key]=value;
   if(type===7)actor.extraLives=Math.min(255,(actor.extraLives??0)+1);
   actor.pickupsCollected=Math.min(MAX_COUNT,(actor.pickupsCollected??0)+1);
  }
  if(source&&type<=7)writeHuman(type,value);
  if(source)source.pickupsCollected=Math.min(MAX_COUNT,source.pickupsCollected??0);
  state.counts[type]=Math.min(MAX_COUNT,state.counts[type]+1);
  onCollect(type,source);
  return true;
 }
 p.Set=function(address,value){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  if(physical>=0x1f0000&&physical<0x1f8000&&active()){
   if(offset>=0xf9b&&offset<0xfb4&&value===0&&this.PC===0x8750&&this.MPR[4]===9*8192){
    const flag=this.RAM[offset],slot=offset-0xf9b,human=getHuman();
    if((flag&128)&&validType(flag&31)&&human&&Math.floor(human.x/16)===this.RAM[0xfb4+slot]&&Math.floor(human.y/16)===this.RAM[0xfcd+slot]){
     const returnPC=((this.RAM[0x100+((this.S+1)&255)]|this.RAM[0x100+((this.S+2)&255)]<<8)+1)&65535;
     state.pending={type:flag&31,slot,stack:this.S,returnPC,bank:this.MPR[returnPC>>13]>>13};
    }
   }
   // A cooperative actor has five reserved slots. Keep the human's native
   // Bomb Up reward within that same capacity; original SOLO still caps at ten.
   if(state.pending?.type===1&&offset===0x84c)value=(value&128)|Math.min(5,value&127);
   if(state.pending?.type===7&&offset===0x438&&value===0&&this.RAM[offset]===255)value=255;
  }
  return set.call(this,address,value);
 };
 p.CPURun=function(){
  // Follow the actual native return address: Extra Life and bonus items take
  // different effect/sound paths. The stack guard avoids unrelated subroutine
  // returns or interrupts. A mid-handler save retains this pending reward.
  if(state.pending&&this.PC===state.pending.returnPC&&this.S===((state.pending.stack+2)&255)&&(this.MPR[this.PC>>13]>>13)===state.pending.bank){const pending=state.pending;state.pending=null;collect(pending.type);}
  return cpu.call(this);
 };
 function inherit(actor){
  if(!state.enabled)return actor;
  const known=[state.powers,...actors().filter(a=>a.alive!==false),...(active()&&getHuman()?[humanPowers()]:[])];
  for(const key of ['fireRange','bombCapacity'])state.powers[key]=Math.min(5,Math.max(...known.map(a=>a[key]??1)));
  for(const key of ['speedUp','remote','bombPass','wallPass'])state.powers[key]=known.some(a=>a[key]);
  state.powers.fireproof=Math.min(3600,Math.max(...known.map(a=>a.fireproof??0)));
  Object.assign(actor,state.powers);return actor;
 }
 const controller={state,collect,inherit,configure(enabled){state.enabled=!!enabled;state.counts.fill(0);state.powers=defaults();state.pending=null;},update(){
  // Capture spent lives even on the frame a clear/death transition begins;
  // those actors may be replaced before gameplay becomes active again.
  const team=state.enabled?actors():[];if(team.length)state.powers.extraLives=Math.min(state.powers.extraLives,...team.map(a=>a.extraLives??0));
  if(!active()||(p.RAM[0x43a]&7)||p.RAM[0x437])return;
  // The native SOLO actor loses some abilities when its own death routine
  // rebuilds the stage. A campaign teammate's collected level persists, so
  // restore the team's common upgrades only once gameplay is active again.
  if(getHuman()){
   const human=humanPowers();
   if(state.powers.bombCapacity===5&&(p.RAM[0x84c]&127)>5)writeHuman(1,5);
   for(const [type,key]of [[0,'fireRange'],[1,'bombCapacity']])if(human[key]<state.powers[key])writeHuman(type,state.powers[key]);
   for(const [type,key]of [[2,'remote'],[3,'speedUp'],[4,'bombPass'],[5,'wallPass']])if(state.powers[key]&&!human[key])writeHuman(type,true);
   if(state.powers.fireproof>human.fireproof)writeHuman(6,state.powers.fireproof);
  }
  if(state.powers.fireproof>0)state.powers.fireproof--;
 },restore(data){if(data===undefined){controller.configure(state.enabled);return;}validateSharedPowerups(data);Object.assign(state,structuredClone(data));}};
 p._sharedPowerups=controller;
 return controller;
}
