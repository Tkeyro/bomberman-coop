import {bombs,isCampaign,installCampaignTracker,spawnBomb,stageID,tileKind} from './campaign.js';

const cellKey=({x,y})=>`${x},${y}`;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
export function validateAdminBombs(state){
 if(!state||Array.isArray(state)||Object.keys(state).some(key=>!['stage','pending'].includes(key))||(state.stage!==null&&(typeof state.stage!=='string'||!/^[0-7]:[0-7]$/.test(state.stage)))||!Array.isArray(state.pending)||(state.stage===null&&state.pending.length)||state.pending.some(cell=>!cell||Array.isArray(cell)||Object.keys(cell).some(key=>!['x','y'].includes(key))||!integer(cell.x,2,31)||!integer(cell.y,1,31))||new Set(state.pending.map(cellKey)).size!==state.pending.length)throw new Error('Invalid admin bomb queue in save.');
 return state;
}

// Keep the native ten-slot admin pool unchanged. Extra placements wait outside
// native RAM until a slot and their floor tile are free. Queued cells have no
// collision, drawing or fuse yet; ordinary game bombs retain their own logic.
export function createAdminBombs(p,{getReservedSlots=()=>[]}={}){
 if(p._adminBombs)return p._adminBombs;
 installCampaignTracker(p);
 const state={stage:null,pending:[]};
 const active=()=>isCampaign(p)&&!(p.RAM[0x43a]&7)&&!p.RAM[0x437];
 function reset(){state.stage=null;state.pending=[];}
 function update(){
  if(state.stage===null)return 0;
  // Death/retry and stage-clear transitions must never carry old placements
  // into a freshly built map, even when retry reloads the same stage number.
  if(state.stage!==stageID(p)||(p.RAM[0x43a]&7)||p.RAM[0x437]){reset();return 0;}
  if(!active()||!state.pending.length)return 0;
  const reserved=new Set(getReservedSlots()),slots=Array.from({length:10},(_,slot)=>slot).filter(slot=>!reserved.has(slot)),occupied=new Set(bombs(p).map(cellKey)),waiting=[];let promoted=0;
  for(const cell of state.pending){
   if(tileKind(p,cell.x,cell.y)!==10||occupied.has(cellKey(cell))||!slots.some(slot=>p.RAM[0x84f+slot]===0)){waiting.push(cell);continue;}
   spawnBomb(p,cell.x,cell.y,{slots});occupied.add(cellKey(cell));promoted++;
  }
  state.pending=waiting;return promoted;
 }
 function add(x,y){
  if(!active())throw new Error('Open the admin menu during an active campaign stage.');
  if(!integer(x,2,31)||!integer(y,1,31)||tileKind(p,x,y)!==10)throw new Error('Choose an empty floor tile.');
  const stage=stageID(p),cell={x,y};
  if(bombs(p).some(bomb=>bomb.x===x&&bomb.y===y))throw new Error('There is already a bomb on that tile.');
  if(state.stage===stage&&state.pending.some(pending=>pending.x===x&&pending.y===y))throw new Error('There is already a queued bomb on that tile.');
  // Validate the complete placement before touching either queue or RAM.
  if(state.stage!==stage)reset();
  state.stage=stage;state.pending.push(cell);update();
  const queued=state.pending.includes(cell),count=state.pending.length;
  return {queued,pending:count,notice:queued?`Bomb queued (${count} waiting). Resume to place it when a native bomb slot and its tile are free.`:`Bomb added.${count?` ${count} queued bomb${count===1?'':'s'} waiting for a free slot.`:''}`};
 }
 const controller={state,add,update,reset,restore(data){validateAdminBombs(data);Object.assign(state,structuredClone(data));}};
 p._adminBombs=controller;return controller;
}
