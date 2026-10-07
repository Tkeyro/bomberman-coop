import {findPath,tileKind,walkable,blastCells,dangerCells,bombs,enemies,validTile,validRoute} from './campaign.js';
const key=(x,y)=>`${x},${y}`;
const buttons=['UP','RIGHT','DOWN','LEFT','SHOT1','SHOT2','RUN','SELECT'];
export function battlePosition(p,port){return {x:p.RAM[0x3cc+port]|p.RAM[0x3d1+port]<<8,y:p.RAM[0x3d6+port]|p.RAM[0x3db+port]<<8};}
export function activeBattle(p){return p.RAM[0x84a]===8&&p.RAM[0x4b]>=2&&p.RAM[0x4b]<=5&&p.RAM[0x4a]===p.RAM[0x4b];}
export function createBattleAI(p) {
 const state={enabled:false,count:2,spectator:false,plans:{},steps:0,bombsPlaced:0};
 const check=p.CheckGamePad;
 p.CheckGamePad=function(){check.call(this);if(state.enabled&&activeBattle(this))for(let i=state.spectator?0:1;i<state.count;i++)this.GamePad[i]=[0xbf,0xbf,0xbf,0xb0];};
 function release(preserveRun=false){for(let port=state.spectator?0:1;port<5;port++)for(const button of buttons)if(!(preserveRun&&port===0&&button==='RUN'))p['UnsetButton'+button](port);}
 function update(){
  if(!state.enabled)return;
  release(true);if(!activeBattle(p)){state.plans={};return;}
  state.steps++;const danger=dangerCells(p),foes=enemies(p);
  for(let port=state.spectator?0:1;port<state.count;port++){
   if(p.RAM[0x3bd+port]!==0)continue;
   const position=battlePosition(p,port),tx=Math.floor(position.x/16),ty=Math.floor(position.y/16),start={x:tx,y:ty};
   const plan=state.plans[port]??={target:null,route:[],cooldown:0};if(plan.cooldown)plan.cooldown--;
   if(plan.target&&!walkable(p,plan.target.x,plan.target.y)){plan.target=null;plan.route=[];}
   if(!plan.target){
    if(danger.has(key(tx,ty))){plan.route=findPath(p,start,n=>!danger.has(key(n.x,n.y)),{allowDanger:true,maxSteps:7})??[];}
    else {
     const range=p.RAM[0x3ef+port]||2,blast=blastCells(p,tx,ty,range);
     const opponents=Array.from({length:state.count},(_,other)=>other).filter(other=>other!==port&&p.RAM[0x3bd+other]===0).map(other=>battlePosition(p,other));
     const useful=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>[2,3,4].includes(tileKind(p,tx+dx,ty+dy)))||[...foes,...opponents].some(e=>blast.has(key(Math.floor(e.x/16),Math.floor(e.y/16))));
     const centered=Math.abs(position.x-(tx*16+8))<2&&Math.abs(position.y-(ty*16+8))<2;
     if(centered&&useful&&!plan.cooldown&&!bombs(p).some(b=>b.x===tx&&b.y===ty)){
      const future=new Set([...danger,...blast]);
      const escape=findPath(p,start,n=>!future.has(key(n.x,n.y)),{allowDanger:true,maxSteps:5});
      if(escape?.length){p.SetButtonSHOT1(port);state.bombsPlaced++;plan.cooldown=180;plan.route=escape;}
     }
     if(!plan.route.length)plan.route=findPath(p,start,n=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>[2,3,4].includes(tileKind(p,n.x+dx,n.y+dy)))||[...foes,...opponents].some(e=>blastCells(p,n.x,n.y,range).has(key(Math.floor(e.x/16),Math.floor(e.y/16)))),{danger})??[];
    }
    plan.target=plan.route.shift()??null;
   }
   if(plan.target){
    const dx=plan.target.x*16+8-position.x,dy=plan.target.y*16+8-position.y;
    if(Math.abs(dx)+Math.abs(dy)<=1){plan.target=null;continue;}
    p['SetButton'+(dx>0?'RIGHT':dx<0?'LEFT':dy>0?'DOWN':'UP')](port);
   }
  }
 }
 return {state,update,configure(count,enabled,spectator=false){release();state.enabled=enabled;state.count=count;state.spectator=spectator;state.plans={};state.steps=0;state.bombsPlaced=0;},restore(data){validateBattleState(data);Object.assign(state,{spectator:false},structuredClone(data));},release};
}
export function validateBattleState(data){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 if(!data||Object.keys(data).some(k=>!['enabled','count','spectator','plans','steps','bombsPlaced'].includes(k))||typeof data.enabled!=='boolean'||(data.spectator!==undefined&&typeof data.spectator!=='boolean')||!Number.isInteger(data.count)||data.count<2||data.count>5||!data.plans||Array.isArray(data.plans)||Object.keys(data.plans).length>(data.spectator?5:4)||!integer(data.steps)||!integer(data.bombsPlaced))throw new Error('Invalid battle AI save.');
 for(const [port,plan] of Object.entries(data.plans))if(!(data.spectator?/^[0-4]$/:/^[1-4]$/).test(port)||!plan||(plan.target!==null&&!validTile(plan.target))||!validRoute(plan.route)||!integer(plan.cooldown))throw new Error('Invalid battle AI plan in save.');
 return data;
}
export function launchSequence(mode,count=2) {
 const idle=frames=>({frames}),press=button=>({frames:8,button});
 const campaign=[idle(180),press('RUN'),idle(120),press('RUN')];
 if(mode!=='battle-ai')return campaign;
 const sequence=[idle(180),press('RUN'),idle(120),press('DOWN'),idle(30),press('RUN'),idle(120),press('RUN'),idle(180),press('RUN'),idle(240)];
 for(let i=2;i<count;i++)sequence.push(press('DOWN'),idle(30));
 for(let i=0;i<4;i++)sequence.push(press('RUN'),idle(240));
 return sequence;
}
