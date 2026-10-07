import {isCampaign,playerPosition,stageID,DEATH_FRAMES} from './campaign.js';
export function validateSpectatorState(s){
 if(!s||Object.keys(s).some(k=>!['enabled','followID','finished','transition'].includes(k))||typeof s.enabled!=='boolean'||typeof s.finished!=='boolean'||(s.followID!==null&&(!Number.isSafeInteger(s.followID)||s.followID<1)))throw new Error('Invalid spectator save.');
 const t=s.transition;if(t!==undefined&&t!==null&&(!s.enabled||!t||Object.keys(t).some(k=>!['phase','stage'].includes(k))||!['dying','loading'].includes(t.phase)||typeof t.stage!=='string'||!/^[0-7]:[0-7]$/.test(t.stage)))throw new Error('Invalid spectator retry in save.');
 return s;
}
export function createSpectator(p,{getBots=()=>[],onRetry=()=>{}}={}){
 const state={enabled:false,followID:null,finished:false,transition:null},set=p.Set,run=p.Run,sprites=p.MakeSpriteLine,pads=p.CheckGamePad,cpu=p.CPURun;
 p._spectator=state;
 const inArena=()=>isCampaign(p)&&p._newCampaign?.transition?.phase!=='loading'&&state.transition?.phase!=='loading';
 function beginRetry(){
  state.finished=false;state.transition={phase:'dying',stage:stageID(p)};
  p.RAM[0x438]=Math.max(1,p.RAM[0x438]);p.RAM[0x43a]|=1;p.RAM[0x43c]=0;
 }
 function retry(){
  const bots=getBots();
  if(!state.enabled||p._newCampaign?.enabled||state.transition||!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437]||!bots.length||bots.some(b=>b.alive||b.extraLives))return false;
  beginRetry();return true;
 }
 p.CPURun=function(){
  if(state.enabled&&state.transition){
   const bank=this.MPR[this.PC>>13]>>13;
   if(bank===8&&this.PC===0x7cae)state.transition.phase='loading';
   if(bank===9&&this.PC===0x83b0&&state.transition.phase==='loading'&&!(this.RAM[0x43a]&7)){
    state.transition=null;state.finished=false;state.followID=null;onRetry();
   }
  }
  return cpu.call(this);
 };
 function focus(){
  const bots=getBots(),lead=bots.find(b=>b.id===state.followID&&b.alive)??bots.find(b=>b.alive)??bots.find(b=>b.id===state.followID)??bots[0];
  if(lead){state.followID=lead.id;return {x:lead.x,y:lead.y};}return playerPosition(p);
 }
 function camera(){const pos=focus(),x=Math.floor(Math.max(8,Math.min(Math.max(8,p.RAM[0x434]*16-256),pos.x-120))),y=Math.floor(Math.max(0,Math.min(Math.max(0,p.RAM[0x435]*16-208),pos.y-104)));return [x&255,x>>8,y&255,y>>8];}
 p.Set=function(address,value){
  if(state.enabled&&inArena()){
   const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
   if(physical>=0x1f0000&&physical<0x1f8000&&offset>=0x25&&offset<=0x28)value=camera()[offset-0x25];
  }
  return set.call(this,address,value);
 };
 p.CheckGamePad=function(){pads.call(this);if(state.enabled&&isCampaign(this)){this.GamePad[0]=[0xbf,0xbf,0xbf,0xb0];this.Keybord[0]=[0xbf,0xbf,0xbf,0xb0];}};
 p.MakeSpriteLine=function(n){
  const fading=state.transition?.phase==='dying'||['clearing','dying'].includes(p._newCampaign?.transition?.phase);
  if(n!==0||!state.enabled||!(inArena()||fading))return sprites.call(this,n);
  const satb=this.VDC[0].SATB,y0=satb[0],y1=satb[4];satb[0]=satb[4]=0;
  try{return sprites.call(this,n);}finally{satb[0]=y0;satb[4]=y1;}
 };
 function update(){
  if(!state.enabled||!inArena())return;
  // Keep the unused native controller outside the arena. Only AI actors play.
  // Also adopt an independently triggered native defeat (for example timeout).
  if(!p._newCampaign?.enabled&&!state.transition&&(p.RAM[0x43a]&1))beginRetry();
  if(!state.transition&&!p._newCampaign?.transition&&!p.RAM[0x437]&&!(p.RAM[0x43a]&7))p.RAM[0x43d]=p.RAM[0x43e]=p.RAM[0x43f]=p.RAM[0x440]=0;
  const bots=getBots();state.finished=!state.transition&&bots.length>0&&bots.every(b=>!b.alive&&!b.extraLives&&b.deathFrame>=DEATH_FRAMES);
  const coords=camera();for(let i=0;i<4;i++)p.RAM[0x25+i]=coords[i];
 }
 p.Run=function(){update();return run.call(this);};
 return {state,focus,update,retry,configure(enabled){Object.assign(state,{enabled,followID:null,finished:false,transition:null});},restore(s){validateSpectatorState(s);Object.assign(state,{transition:null},structuredClone(s));}};
}
