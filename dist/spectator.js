import {isCampaign,playerPosition,DEATH_FRAMES} from './campaign.js';
export function validateSpectatorState(s){
 if(!s||Object.keys(s).some(k=>!['enabled','followID','finished'].includes(k))||typeof s.enabled!=='boolean'||typeof s.finished!=='boolean'||(s.followID!==null&&(!Number.isSafeInteger(s.followID)||s.followID<1)))throw new Error('Invalid spectator save.');
 return s;
}
export function createSpectator(p,{getBots=()=>[]}={}){
 const state={enabled:false,followID:null,finished:false},set=p.Set,run=p.Run,sprites=p.MakeSpriteLine,pads=p.CheckGamePad;
 p._spectator=state;
 const inArena=()=>isCampaign(p)&&p._newCampaign?.transition?.phase!=='loading';
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
  const fading=['clearing','dying'].includes(p._newCampaign?.transition?.phase);
  if(n!==0||!state.enabled||!(inArena()||fading))return sprites.call(this,n);
  const satb=this.VDC[0].SATB,y0=satb[0],y1=satb[4];satb[0]=satb[4]=0;
  try{return sprites.call(this,n);}finally{satb[0]=y0;satb[4]=y1;}
 };
 function update(){
  if(!state.enabled||!inArena())return;
  // Keep the unused native controller outside the arena. Only AI actors play.
  if(!p._newCampaign?.transition&&!p.RAM[0x437]&&!(p.RAM[0x43a]&7))p.RAM[0x43d]=p.RAM[0x43e]=p.RAM[0x43f]=p.RAM[0x440]=0;
  const bots=getBots();state.finished=bots.length>0&&bots.every(b=>!b.alive&&!b.extraLives&&b.deathFrame>=DEATH_FRAMES);
  const coords=camera();for(let i=0;i<4;i++)p.RAM[0x25+i]=coords[i];
 }
 p.Run=function(){update();return run.call(this);};
 return {state,focus,update,configure(enabled){Object.assign(state,{enabled,followID:null,finished:false});},restore(s){validateSpectatorState(s);Object.assign(state,structuredClone(s));}};
}
