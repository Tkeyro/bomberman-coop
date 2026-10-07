import {COLORS} from './session.js';
export const companionBombSlots=bot=>Array.from({length:5},(_,i)=>20+bot.bombBank*5+i);
export const ITEM_CATALOG = [
 ['fire','Fire up',0],['bomb','Bomb up',1],['remote','Remote control',2],['speed','Roller shoes',3],
 ['bomb-pass','Bomb pass',4],['wall-pass','Wall pass',5],['fireproof','Fireproof vest',6],['life','Extra life',7],['skull','Skull / curse',8],
 ['bonus-9','PC Engine Shuttle',9],['bonus-10','CoreGrafx',10],['bonus-11','SuperGrafx',11],['bonus-12','Saxophone',12],['bonus-13','Dr. Mitsumori',13],['bonus-14','Lisa',14]
].map(([id,name,type])=>({id,name,type}));
const ENEMY_BASES=[0xd98,0xdb8,0xdd8,0xdf8,0xe18,0xe38,0xe58,0xe78,0xe98,0xeb8,0xed8,0xef8,0xf18,0xf38,0xf58,0xf78];
const NEIGHBORS=[[0,-1,'UP'],[1,0,'RIGHT'],[0,1,'DOWN'],[-1,0,'LEFT']];
const key=(x,y)=>`${x},${y}`;
export const stageID=p=>`${p.RAM[0x84a]}:${p.RAM[0x84b]}`;
export function isCampaign(p) {
 const s=p.VDC[0].SATB,pat=s[2];
 const active=p._campaignTracker?p._campaignTracker.last>=0&&p._campaignTracker.frame-p._campaignTracker.last<=2:(s[3]&15)===12&&pat>=640&&pat<704;
 return active&&p.RAM[0x84a]<8&&p.RAM[0x84b]<8&&p.RAM[0x44a+32+2]!==0;
}
export function tileKind(p,x,y){if(x<2||x>Math.min(31,(p.RAM[0x434]||15)-1)||y<1||y>Math.min(31,(p.RAM[0x435]||12)-1))return 1;return p.RAM[0x44a+y*32+x]&31;}
export function walkable(p,x,y){return [7,8,10].includes(tileKind(p,x,y));}
export function canOccupy(p,x,y,bot){
 for(const cx of [Math.floor((x-5)/16),Math.floor((x+5)/16)])for(const cy of [Math.floor((y-5)/16),Math.floor((y+5)/16)])if(solidFor(tileKind(p,cx,cy),bot)||(!bot?.bombPass&&tileKind(p,cx,cy)===0&&bot?.leaveBomb!==key(cx,cy)))return false;
 return true;
}
function blockedOverlap(p,x,y,bot){let area=0;for(let cy=Math.floor((y-5)/16);cy<=Math.floor((y+5)/16);cy++)for(let cx=Math.floor((x-5)/16);cx<=Math.floor((x+5)/16);cx++)if(solidFor(tileKind(p,cx,cy),bot)||(!bot?.bombPass&&tileKind(p,cx,cy)===0))area+=Math.max(0,Math.min(x+5,(cx+1)*16)-Math.max(x-5,cx*16))*Math.max(0,Math.min(y+5,(cy+1)*16)-Math.max(y-5,cy*16));return area;}
const canStep=(p,x,y,nx,ny,bot)=>canOccupy(p,nx,ny,tileKind(p,Math.floor(x/16),Math.floor(y/16))===0?{...bot,leaveBomb:key(Math.floor(x/16),Math.floor(y/16))}:bot)||blockedOverlap(p,nx,ny,bot)<blockedOverlap(p,x,y,bot);
export function playerPosition(p){return {x:p.RAM[0x43d]|p.RAM[0x43e]<<8,y:p.RAM[0x43f]|p.RAM[0x440]<<8};}
export function bombs(p) {
 const result=[];
 for(let i=0;i<40;i++) if(p.RAM[0x84f+i]&0x80) result.push({slot:i,x:p.RAM[0x877+i],y:p.RAM[0x89f+i],fuse:p.RAM[0x8ef+i],range:p.RAM[0x84a]<8?(p._companionBombRanges?.[i]||p.RAM[0x84d]&127):undefined});
 return result;
}
export function pickups(p){const result=[];for(let slot=0;slot<25;slot++)if(p.RAM[0xf9b+slot]&128){const x=p.RAM[0xfb4+slot],y=p.RAM[0xfcd+slot];if(tileKind(p,x,y)===7)result.push({slot,type:p.RAM[0xf9b+slot]&31,x,y});}return result;}
export const beneficialPickup=item=>item.type<=14&&item.type!==8;
// Use the native sound queue and the ROM's priorities/channel masks.
// Native steps use effect 1 (0x12 in world 2); death uses effect 4.
function requestSound(p,id){
 const read=offset=>p.Mapper.Read(4*8192+offset),priority=sound=>read(0xdc8+sound),pointer=read(0xde8+id*2)|(read(0xde9+id*2)<<8),mask=read(pointer&8191)&63,pending=p.RAM[0x1487];
 if(!(pending&128)&&priority(id)<priority(pending))return;
 for(let channel=0;channel<6;channel++)if((mask&(1<<channel))&&p.RAM[0x14f8+channel]&&priority(id)<priority(p.RAM[0x1480+channel]))return;
 p.RAM[0x1487]=id;for(let channel=0;channel<6;channel++)if(mask&(1<<channel))p.RAM[0x1480+channel]=id;
}
export function restoreFloor(p,x,y,metadata=p.RAM[0x44a+y*32+x]&224){
 const i=p.RAM[0x77],next=(i+1)&127;if(next===p.RAM[0x76])return false;
 p.RAM[0x44a+y*32+x]=metadata|10;p.RAM[0xfe6+i]=x;p.RAM[0x1066+i]=y;p.RAM[0x10e6+i]=1;p.RAM[0x1166+i]=3;p.RAM[0x77]=next;return true;
}
const botWalkable=(p,x,y,bot)=>walkable(p,x,y)&&!(p._botSkullCells??new Set(pickups(p).filter(i=>i.type===8).map(i=>key(i.x,i.y)))).has(key(x,y))||(bot?.wallPass&&[2,3,4].includes(tileKind(p,x,y)))||(bot?.bombPass&&tileKind(p,x,y)===0);
const solidFor=(kind,bot)=>[1,2,3,4,5].includes(kind)&&!(bot?.wallPass&&[2,3,4].includes(kind));
export function enemies(p) {
 const result=[];
 for(let i=0;i<32;i++) if(p.RAM[0xd98+i]&0x80) result.push({slot:i,type:p.RAM[0xeb8+i],x:p.RAM[0xdd8+i]|p.RAM[0xdb8+i]<<8,y:p.RAM[0xe18+i]|p.RAM[0xdf8+i]<<8});
 return result;
}
export function blastCells(p,x,y,range=p.RAM[0x84d]&127) {
 const cells=new Set([key(x,y)]);
 for(const [dx,dy] of NEIGHBORS) for(let i=1;i<=Math.min(Math.max(range,1),15);i++) {
  const cx=x+dx*i,cy=y+dy*i,kind=tileKind(p,cx,cy);
  if(kind===1)break;cells.add(key(cx,cy));if([2,3,4,5,6].includes(kind))break;
 }
 return cells;
}
export function dangerCells(p) {
 const danger=new Set();
 for(const b of bombs(p)) for(const cell of blastCells(p,b.x,b.y,b.range)) danger.add(cell);
 for(let y=1;y<(p.RAM[0x435]||12);y++)for(let x=2;x<(p.RAM[0x434]||15);x++)if([6,11,12].includes(tileKind(p,x,y)))danger.add(key(x,y));
 return danger;
}
const monsterClearance=(foes,x,y)=>Math.min(Infinity,...foes.map(e=>Math.max(Math.abs(e.x-x),Math.abs(e.y-y))));
function monsterCells(p,foes,radius=24){
 const cells=new Set();
 for(const e of foes)for(let y=Math.floor((e.y-radius)/16);y<=Math.floor((e.y+radius)/16);y++)for(let x=Math.floor((e.x-radius)/16);x<=Math.floor((e.x+radius)/16);x++)if(walkable(p,x,y)&&Math.abs(x*16+8-e.x)<radius&&Math.abs(y*16+8-e.y)<radius)cells.add(key(x,y));
 return cells;
}
function foreseeMonsters(p,foes,state){
 const previous=new Map(state.foeMotion.map(e=>[e.slot,e]));
 state.foeMotion=foes.map(e=>{const old=previous.get(e.slot),dx=old?e.x-old.x:0,dy=old?e.y-old.y:0,continuous=old&&old.type===e.type&&Math.abs(dx)<=2&&Math.abs(dy)<=2;return {...e,vx:continuous?old.vx*.6+dx*.4:0,vy:continuous?old.vy*.6+dy*.4:0,speedX:continuous?(old.speedX??Math.abs(old.vx))*.9+Math.abs(dx)*.1:0,speedY:continuous?(old.speedY??Math.abs(old.vy))*.9+Math.abs(dy)*.1:0};});
 const predicted=[...foes];for(const e of state.foeMotion){if(Math.abs(e.vx)+Math.abs(e.vy)<.05)continue;let x=e.x,y=e.y;for(let t=8;t<=24;t+=8){const nx=x+e.vx*8,ny=y+e.vy*8;if(!walkable(p,Math.floor(nx/16),Math.floor(ny/16)))break;x=nx;y=ny;predicted.push({...e,x,y});}}
 return predicted;
}
export function monsterBombingCells(p,foes,range,motion=[]){
 const targets=new Map(),observations=new Map(motion.map(e=>[e.slot,e]));
 for(const foe of foes){
  const x=Math.floor(foe.x/16),y=Math.floor(foe.y/16);targets.set(key(x,y),{x,y});
  const observed=observations.get(foe.slot),vx=observed?.vx??0,vy=observed?.vy??0;
  if(Math.max(Math.abs(vx),Math.abs(vy))<.05)continue;
  // A pacing monster can reverse before the fuse expires. Intercept its
  // observed straight corridor, stopping at terrain instead of cutting corners.
  const dx=Math.abs(vx)>Math.abs(vy)?1:0,dy=dx?0:1,reach=Math.min(5,Math.ceil(Math.max(Math.abs(vx),Math.abs(vy))*150/16));
  for(const sign of [-1,1])for(let i=1;i<=reach;i++){
   const cx=x+dx*i*sign,cy=y+dy*i*sign;if(!walkable(p,cx,cy))break;targets.set(key(cx,cy),{x:cx,y:cy});
  }
 }
 const cells=new Set();
 for(const target of targets.values()){
  if(tileKind(p,target.x,target.y)===10)cells.add(key(target.x,target.y));
  for(const [dx,dy]of NEIGHBORS)for(let i=1;i<=Math.min(Math.max(range,1),15);i++){
   const x=target.x+dx*i,y=target.y+dy*i,kind=tileKind(p,x,y);if([1,2,3,4,5,6].includes(kind))break;
   if(kind===10)cells.add(key(x,y));
  }
 }
 return cells;
}
function detonationTargets(p,foes,motion){
 const observations=new Map(motion.map(e=>[e.slot,e])),cells=new Set();
 for(const foe of foes){
  const observed=observations.get(foe.slot),vx=observed?.vx??0,vy=observed?.vy??0;
  if(Math.max(Math.abs(vx),Math.abs(vy))<.05){cells.add(key(Math.floor(foe.x/16),Math.floor(foe.y/16)));continue;}
  const horizontal=Math.abs(vx)>Math.abs(vy),dx=horizontal?1:0,dy=horizontal?0:1,tx=Math.floor(foe.x/16),ty=Math.floor(foe.y/16);
  let low=0,high=0;while(walkable(p,tx-dx*(low+1),ty-dy*(low+1)))low++;while(walkable(p,tx+dx*(high+1),ty+dy*(high+1)))high++;
  const min=(horizontal?tx-low:ty-low)*16+8,max=(horizontal?tx+high:ty+high)*16+8;
  let position=Math.max(min,Math.min(max,horizontal?foe.x:foe.y)),velocity=Math.sign(horizontal?vx:vy)*(horizontal?(observed.speedX??Math.abs(vx)):(observed.speedY??Math.abs(vy)));
  // Normal fuses last 150 frames. Allow a short window for flame animation,
  // velocity rounding and a monster bouncing at either corridor end.
  for(let frame=1;frame<=170;frame++){
   let next=position+velocity;if(next<min||next>max){velocity=-velocity;next=position+velocity;}position=Math.max(min,Math.min(max,next));
   if(frame>=150)cells.add(key(Math.floor(horizontal?position/16:foe.x/16),Math.floor(horizontal?foe.y/16:position/16)));
  }
 }
 return cells;
}
// Reconsider an interrupted step without cutting a corner through a block.
function retreatRoute(p,bot,foes,danger,monsterDanger,predicted=foes){
 const start={x:Math.floor(bot.x/16),y:Math.floor(bot.y/16)},clearance=monsterClearance(foes,bot.x,bot.y),futureClearance=monsterClearance(predicted,bot.x,bot.y),unsafe=new Set([...danger,...monsterDanger]),blocked=monsterCells(p,foes,12);
 const escapingBomb=danger.has(key(start.x,start.y));
 if(!escapingBomb)for(const cell of danger)blocked.add(cell);
 for(let y=1;y<(p.RAM[0x435]||12);y++)for(let x=2;x<(p.RAM[0x434]||15);x++)if([6,11,12].includes(tileKind(p,x,y)))blocked.add(key(x,y));
 let best=null,fallback=null;
 for(const cell of [start,...NEIGHBORS.map(([dx,dy])=>({x:start.x+dx,y:start.y+dy}))]){
  if(!botWalkable(p,cell.x,cell.y,bot)||blocked.has(key(cell.x,cell.y)))continue;
  const dx=cell.x*16+8-bot.x,dy=cell.y*16+8-bot.y,distance=Math.abs(dx)+Math.abs(dy);
  if(Math.abs(dx)>.01&&Math.abs(dy)>.01)continue;
  let safe=true;
  for(let step=1;step<=Math.ceil(distance/.75);step++){
   const fraction=Math.min(1,step*.75/distance),x=bot.x+dx*fraction,y=bot.y+dy*fraction,nextClearance=monsterClearance(foes,x,y),kind=tileKind(p,Math.floor(x/16),Math.floor(y/16));
   const previous=Math.max(0,(step-1)*.75/distance);
   if(!canStep(p,bot.x+dx*previous,bot.y+dy*previous,x,y,bot)||[6,11,12].includes(kind)||nextClearance<10||(clearance<32&&nextClearance<clearance-.01)){safe=false;break;}
  }
  if(!safe)continue;
  const tail=findPath(p,cell,n=>!unsafe.has(key(n.x,n.y)),{allowDanger:true,blocked,maxSteps:7,actor:bot}),prefix=distance>.01?[cell]:[];
  const separation=monsterClearance(foes,cell.x*16+8,cell.y*16+8);
  if(tail&&(prefix.length||tail.length||futureClearance>=32)){const route=[...prefix,...tail],score=distance/16+tail.length;if(!best||score<best.score||(score===best.score&&separation>best.separation))best={route,score,separation};}
  if(prefix.length&&separation>clearance&&(!fallback||separation>fallback.separation))fallback={route:prefix,separation};
 }
 return best?.route??fallback?.route??[];
}
export function findPath(p,start,goal,{danger=new Set(),allowDanger=false,blocked=new Set(),maxSteps=1024,actor}={}) {
 const queue=[{x:start.x,y:start.y,path:[]}],seen=new Set([key(start.x,start.y)]);
 for(let n=0;n<queue.length;n++){
  const node=queue[n];if(goal(node))return node.path;
  if(node.path.length>=maxSteps)continue;
  for(const [dx,dy,button] of NEIGHBORS){const x=node.x+dx,y=node.y+dy,k=key(x,y);
   if(seen.has(k)||!(actor?botWalkable(p,x,y,actor):walkable(p,x,y))||blocked.has(k)||(!allowDanger&&danger.has(k)))continue;
   seen.add(k);queue.push({x,y,path:[...node.path,{x,y,button}]});
  }
 }
 return null;
}
function requireFloor(p,x,y){if(!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437])throw new Error('Open the admin menu during an active campaign stage.');if(!Number.isInteger(x)||!Number.isInteger(y)||!walkable(p,x,y)||tileKind(p,x,y)!==10)throw new Error('Choose an empty floor tile.');}
export function spawnBomb(p,x,y,{slots=Array.from({length:10},(_,i)=>i),automatic=false}={}) {
 requireFloor(p,x,y);
 if(bombs(p).some(b=>b.x===x&&b.y===y))throw new Error('There is already a bomb on that tile.');
 const slot=slots.find(i=>p.RAM[0x84f+i]===0);
 if(slot===undefined)throw new Error('The original campaign bomb slots are full.');
 // Bit 6 means a directional enemy bomb as well as an automatic fuse. AI
 // Bombermen use ordinary bombs; their timer hook is independent of the human.
 p.RAM[0x84f+slot]=automatic&&slot<20?0xc0:0x80;p.RAM[0x877+slot]=x;p.RAM[0x89f+slot]=y;
 p.RAM[0x8c7+slot]=0;p.RAM[0x8ef+slot]=150;p.RAM[0x917+slot]=255;
 return slot;
}
export function spawnItem(p,type,x,y) {
 requireFloor(p,x,y);
 if(!Number.isInteger(type)||type<0||type>14)throw new Error('Unknown item type.');
 if(tileKind(p,x,y)!==10)throw new Error('Place items on empty floor, away from existing pickups.');
 const slot=Array.from({length:25},(_,i)=>i).find(i=>p.RAM[0xf9b+i]===0);
 if(slot===undefined)throw new Error('The original item slots are full.');
 const i=p.RAM[0x77],next=(i+1)&127;if(next===p.RAM[0x76])throw new Error('The game redraw queue is full. Resume briefly and try again.');
 const flags=[0,0,1,0,0,1,1,0,0,0,0,0,1,0,0];
 p.RAM[0xf9b+slot]=0x80|type;p.RAM[0xfb4+slot]=x;p.RAM[0xfcd+slot]=y;
 const cell=0x44a+y*32+x;p.RAM[cell]=(p.RAM[cell]&224)|7;
 p.RAM[0xfe6+i]=x;p.RAM[0x1066+i]=y;p.RAM[0x10e6+i]=0x80+type;p.RAM[0x1166+i]=12+flags[type];p.RAM[0x77]=next;
 return slot;
}
export function spawnEnemy(p,templateSlot,x,y) {
 requireFloor(p,x,y);
 const template=enemies(p).find(e=>e.slot===templateSlot&&e.type<23);if(!template)throw new Error('That enemy template is no longer available in this stage.');
 const slot=Array.from({length:32},(_,i)=>i).find(i=>p.RAM[0xd98+i]===0);
 if(slot===undefined)throw new Error('The original enemy slots are full.');
 for(const base of ENEMY_BASES)p.RAM[base+slot]=p.RAM[base+templateSlot];
 p.RAM[0xdd8+slot]=(x*16+8)&255;p.RAM[0xdb8+slot]=(x*16+8)>>8;
 p.RAM[0xe18+slot]=(y*16+8)&255;p.RAM[0xdf8+slot]=(y*16+8)>>8;
 for(const base of [0xed8,0xe38,0xe98,0xf18,0xf38,0xef8,0x11e6,0x1206,0x1353])p.RAM[base+slot]=0;
 p.RAM[0xd98+slot]=128;p.RAM[0xe58+slot]=8;p.RAM[0x1333+slot]=255;p.RAM[0xd96]=0;
 return slot;
}
export function nearestFreeTile(p,start,blocked=new Set()) {
 const tile=findPath(p,start,n=>tileKind(p,n.x,n.y)===10&&!blocked.has(key(n.x,n.y)),{blocked});
 if(tile?.length)return tile.at(-1);
 if(tile&&tileKind(p,start.x,start.y)===10&&!blocked.has(key(start.x,start.y)))return start;
 for(let y=1;y<(p.RAM[0x435]||12);y++)for(let x=2;x<(p.RAM[0x434]||15);x++)if(walkable(p,x,y)&&tileKind(p,x,y)===10&&!blocked.has(key(x,y)))return {x,y};
 throw new Error('No free floor tile is available.');
}
export function installCampaignTracker(p) {
 if(p._campaignTracker)return p._campaignTracker;
 const tracker={frame:0,last:-100},cpu=p.CPURun,run=p.Run;
 p._campaignTracker=tracker;
 p.CPURun=function(){if(this.PC===0x83b0&&this.MPR[4]===9*8192)tracker.last=tracker.frame;return cpu.call(this);};
 p.Run=function(){tracker.frame++;return run.call(this);};
 return tracker;
}
const POSES=[
 [[[81,16,672,4236],[81,32,674,140]],[[81,16,680,4236],[81,32,678,140]],[[81,16,672,4236],[81,32,674,140]],[[81,7,688,4492]]],
 [[[80,0,652,2444],[96,16,656,2188]],[[80,17,664,6284],[80,2,654,2188]],[[80,0,652,2444],[96,16,656,2188]],[[80,17,666,6284],[80,1,654,2188]]],
 [[[80,8,640,396],[96,16,658,140]],[[80,8,644,396],[96,16,660,140]],[[80,8,640,396],[96,16,658,140]],[[80,8,648,396],[96,16,662,140]]],
 [[[80,16,652,396],[96,16,656,140]],[[80,15,664,4236],[80,30,654,140]],[[80,16,652,396],[96,16,656,140]],[[80,15,666,4236],[80,31,654,140]]]
];
// The original collapse/explosion sequence holds each pose for eight frames.
export const DEATH_FRAMES=104;
const DEATH_POSES=[
 [[80,8,696,4492]],[[80,8,704,4492]],[[80,8,696,4492]],
 [[80,8,704,4492]],[[80,8,696,4492]],[[80,8,704,4492]],
 [[80,24,682,4236],[80,9,682,6284]],
 [[80,24,712,4236],[80,9,712,6284]],
 [[80,9,714,6284],[80,24,714,4236]],
 [[80,9,720,6284],[80,24,720,4236]],
 [[80,9,722,6284],[80,24,722,4236]],
 [[80,9,728,6284],[80,24,728,4236]],
 [[80,24,730,4236],[80,9,730,6284]]
];
const visibleBot=b=>b.alive||(Number.isInteger(b.deathFrame)&&b.deathFrame<DEATH_FRAMES);
export function createCompanions(p,{colorize,getHuman=()=>playerPosition(p)}={}) {
 installCampaignTracker(p);
 const state={bots:[],stage:null,nextID:1,steps:0,events:[],active:false,bombRanges:Array(40).fill(0),foeMotion:[]};
 p._companionBombRanges=state.bombRanges;
 const paletteCache=new Map();
 const originalSpriteLine=p.MakeSpriteLine;
 const cpu=p.CPURun;
 const get=p.Get;
 p.Get=function(address){
  if(this.MPR[4]===9*8192&&this.RAM[0x84a]<8&&this.X>=20&&this.X<40){
   if(address===0x284d&&this.PC===0x9112&&state.bombRanges[this.X])return state.bombRanges[this.X];
   if(address===0x243a&&this.PC===0x90a0)return get.call(this,address)&~16;
   // Old saves retain bit 6. Read those bombs as ordinary Bomberman blasts,
   // including group allocation and propagation across fading flame centers.
   if(address===0x284f+this.X&&[0x905a,0x9193,0x93d7].includes(this.PC))return get.call(this,address)&~64;
  }
  return get.call(this,address);
 };
 // Campaign normally ticks ten human bomb slots; native drawing supports forty.
 p.CPURun=function(){const campaign=this.MPR[4]===9*8192&&this.RAM[0x84a]<8,extended=campaign&&this.PC===0x9080,skipEnemySlots=campaign&&this.PC===0x90aa&&this.X===20;const result=cpu.call(this);if(extended)this.X=39;else if(skipEnemySlots)this.X=9;return result;};
 function add(x,y) {
  requireFloor(p,x,y);if(state.bots.filter(visibleBot).length>=4)throw new Error('Maximum four AI teammates on screen. Wait for a death animation to finish.');
  const variants=Object.keys(COLORS),color=variants[Math.floor(Math.random()*variants.length)];
  const bombBank=[0,1,2,3].find(bank=>!state.bots.some(b=>visibleBot(b)&&b.bombBank===bank)&&companionBombSlots({bombBank:bank}).every(i=>p.RAM[0x84f+i]===0));if(bombBank===undefined)throw new Error('Wait for the previous teammate bombs to finish.');
  const bot={id:state.nextID++,x:x*16+8,y:y*16+8,color,alive:true,deathFrame:null,bombBank,bombCapacity:1,fireRange:1,speedUp:false,remote:false,bombPass:false,wallPass:false,fireproof:0,extraLives:0,pickupsCollected:0,remoteTimers:Array(5).fill(0),target:null,route:[],cooldown:0,direction:2,animation:0,action:'Exploring',bombsPlaced:0};
  state.stage=stageID(p);state.bots=state.bots.filter(visibleBot);state.bots.push(bot);return bot;
 }
 function record(bot,text){state.events.push({frame:state.steps,bot:bot.id,text});if(state.events.length>40)state.events.shift();}
 function collect(bot,item){
  if(!(p.RAM[0xf9b+item.slot]&128)||tileKind(p,item.x,item.y)!==7)return false;
  const metadata=p._newCampaign?.enabled&&p._newCampaign.ready?0xc0:p.RAM[0x44a+item.y*32+item.x]&224;
  if(!restoreFloor(p,item.x,item.y,metadata))return false;p.RAM[0xf9b+item.slot]=0;
  if(item.type===0)bot.fireRange=Math.min(5,bot.fireRange+1);if(item.type===1)bot.bombCapacity=Math.min(5,bot.bombCapacity+1);
  if(item.type===2)bot.remote=true;if(item.type===3)bot.speedUp=true;if(item.type===4)bot.bombPass=true;if(item.type===5)bot.wallPass=true;if(item.type===6)bot.fireproof=3600;if(item.type===7)bot.extraLives=Math.min(255,bot.extraLives+1);
  bot.pickupsCollected++;bot.target=null;bot.route=[];bot.action='Collected '+ITEM_CATALOG[item.type].name;record(bot,bot.action);return true;
 }
 function update() {
  if(!isCampaign(p)){state.active=false;return;}
  p._botSkullCells=new Set(pickups(p).filter(i=>i.type===8).map(i=>key(i.x,i.y)));
  const stage=stageID(p);if(state.stage!==null&&state.stage!==stage){state.foeMotion=[];state.bots=state.bots.filter(b=>b.alive);const human=playerPosition(p),blocked=new Set([key(Math.floor(human.x/16),Math.floor(human.y/16))]);for(const b of state.bots){const cell=nearestFreeTile(p,{x:Math.floor(human.x/16),y:Math.floor(human.y/16)},blocked);b.x=cell.x*16+8;b.y=cell.y*16+8;b.target=null;b.route=[];blocked.add(key(cell.x,cell.y));}state.stage=stage;}
  for(const b of state.bots)if(!b.alive&&Number.isInteger(b.deathFrame)&&b.deathFrame<DEATH_FRAMES)b.deathFrame++;
  if((p.RAM[0x43a]&7)||p.RAM[0x437]){state.active=false;return;}
  state.active=true;
  state.steps++;
  const danger=dangerCells(p),foes=enemies(p),predicted=foreseeMonsters(p,foes,state),monsterDanger=monsterCells(p,predicted),allDanger=new Set([...danger,...monsterDanger]),attackZones=new Map(),timedTargets=detonationTargets(p,foes,state.foeMotion),nowBombs=bombs(p);
  for(const bot of state.bots){
   if(!bot.alive&&bot.extraLives&&bot.deathFrame>=DEATH_FRAMES){const spot=findPath(p,{x:Math.floor(bot.x/16),y:Math.floor(bot.y/16)},n=>tileKind(p,n.x,n.y)===10&&!allDanger.has(key(n.x,n.y))&&!state.bots.some(b=>b.alive&&Math.floor(b.x/16)===n.x&&Math.floor(b.y/16)===n.y),{allowDanger:true,maxSteps:32});const cell=spot?.at(-1)??(spot?{x:Math.floor(bot.x/16),y:Math.floor(bot.y/16)}:null);if(cell){bot.x=cell.x*16+8;bot.y=cell.y*16+8;bot.extraLives--;bot.alive=true;bot.deathFrame=null;bot.target=null;bot.route=[];bot.fireproof=180;record(bot,'Used an extra life');}}
   if(!bot.alive)continue;
   if(bot.fireproof>0)bot.fireproof--;
   const tx=Math.floor(bot.x/16),ty=Math.floor(bot.y/16),kind=tileKind(p,tx,ty);
   if(([6,11,12].includes(kind)&&!bot.fireproof)||foes.some(e=>Math.abs(e.x-bot.x)<10&&Math.abs(e.y-bot.y)<10)){
    bot.alive=false;bot.deathFrame=0;bot.target=null;bot.route=[];bot.action='Defeated';requestSound(p,4);record(bot,'Defeated by explosion or enemy');continue;
   }
   if(bot.cooldown>0)bot.cooldown--;
   const start={x:tx,y:ty},centered=Math.abs(bot.x-(tx*16+8))<.01&&Math.abs(bot.y-(ty*16+8))<.01;
   const available=pickups(p).filter(beneficialPickup),item=available.find(i=>i.x===tx&&i.y===ty);
   if(centered&&item&&!allDanger.has(key(tx,ty))&&collect(bot,item))continue;
   if(bot.remote)for(const [index,slot]of companionBombSlots(bot).entries())if(p.RAM[0x84f+slot]&128&&p.RAM[0x917+slot]===255&&p.RAM[0x8ef+slot]!==0){bot.remoteTimers[index]=Math.min(1000000,bot.remoteTimers[index]+1);const area=blastCells(p,p.RAM[0x877+slot],p.RAM[0x89f+slot],state.bombRanges[slot]||bot.fireRange),person=getHuman(),friends=[...state.bots.filter(b=>b.alive),...(person?[person]:[])];p.RAM[0x8ef+slot]=bot.remoteTimers[index]>=12&&friends.every(b=>!area.has(key(Math.floor(b.x/16),Math.floor(b.y/16))))&&!pickups(p).some(i=>area.has(key(i.x,i.y)))?1:150;}
   const pickupCells=new Set(available.map(i=>key(i.x,i.y))),pickupRoute=centered&&!allDanger.has(key(tx,ty))?findPath(p,start,n=>pickupCells.has(key(n.x,n.y)),{danger:allDanger,actor:bot}):null;
   if(pickupRoute?.length){bot.route=pickupRoute;bot.target=bot.route.shift();bot.action='Collecting power-ups';}
   if(!attackZones.has(bot.fireRange))attackZones.set(bot.fireRange,monsterBombingCells(p,foes,bot.fireRange,state.foeMotion));
   const attackZone=attackZones.get(bot.fireRange),blast=blastCells(p,tx,ty,bot.fireRange),enemyApproach=attackZone.has(key(tx,ty))&&(bot.remote||[...timedTargets].some(cell=>blast.has(cell))),protectsPickup=pickups(p).some(i=>blast.has(key(i.x,i.y)));
   const clearing=NEIGHBORS.some(([dx,dy])=>[2,3,4].includes(tileKind(p,tx+dx,ty+dy))),useful=clearing||enemyApproach;
   if(centered&&!pickupRoute?.length&&!protectsPickup&&useful&&!bot.cooldown&&!danger.has(key(tx,ty))&&monsterClearance(foes,bot.x,bot.y)>=16&&!nowBombs.some(b=>b.x===tx&&b.y===ty)){
    const proposed=new Set([...allDanger,...blast]),escape=findPath(p,start,n=>!proposed.has(key(n.x,n.y)),{allowDanger:true,blocked:allDanger,maxSteps:Math.max(5,bot.fireRange+1),actor:bot}),person=getHuman();
    if(escape?.length&&(!person||!blast.has(key(Math.floor(person.x/16),Math.floor(person.y/16))))){
     const slots=companionBombSlots(bot);
     try{if(slots.filter(i=>p.RAM[0x84f+i]).length>=bot.bombCapacity)throw new Error('Own bombs are still active');const slot=spawnBomb(p,tx,ty,{slots,automatic:true});state.bombRanges[slot]=bot.fireRange;bot.remoteTimers[slot-slots[0]]=0;bot.bombsPlaced++;bot.cooldown=60;bot.route=escape;bot.target=bot.route.shift();bot.action='Bombing and escaping';record(bot,'Placed original-engine bomb');continue;}catch{}
    }
   }
   if(danger.has(key(tx,ty))||monsterClearance(predicted,bot.x,bot.y)<32||(bot.target&&monsterDanger.has(key(bot.target.x,bot.target.y)))){
    bot.route=retreatRoute(p,bot,foes,danger,monsterDanger,predicted);bot.target=bot.route.shift()??null;bot.action=danger.has(key(tx,ty))?'Escaping':'Avoiding monsters';
    if(!bot.target)continue;
   }
   if(bot.target){
    const dx=bot.target.x*16+8-bot.x,dy=bot.target.y*16+8-bot.y;
    if(!botWalkable(p,bot.target.x,bot.target.y,bot)){bot.target=null;bot.route=[];continue;}
    const speed=bot.speedUp?1.5:.75,move=Math.min(speed,Math.abs(dx||dy)),nextX=bot.x+(dx?Math.sign(dx)*move:0),nextY=bot.y+(!dx&&dy?Math.sign(dy)*move:0);
    if(!canStep(p,bot.x,bot.y,nextX,nextY,bot)){bot.target=null;bot.route=[];bot.action='Blocked';continue;}
    bot.x=nextX;bot.y=nextY;if(dx)bot.direction=dx>0?1:3;else if(dy)bot.direction=dy>0?2:0;
    if(move>0){bot.animation=(bot.animation+1)%32;if(bot.animation%16===8)requestSound(p,p.RAM[0x84a]===2?0x12:1);}
    if(Math.abs(dx)+Math.abs(dy)<=speed){bot.x=bot.target.x*16+8;bot.y=bot.target.y*16+8;bot.target=null;}
    continue;
   }
   if(botWalkable(p,tx,ty,bot)&&(Math.abs(bot.x-(tx*16+8))>.01||Math.abs(bot.y-(ty*16+8))>.01)){bot.target={x:tx,y:ty};bot.route=[];continue;}
   bot.route=[];
   const exit=findPath(p,start,n=>tileKind(p,n.x,n.y)===8,{danger:allDanger,actor:bot});
   if(foes.length===0&&p.RAM[0xd96]&&exit){if(exit.length)bot.target=exit[0];else {
    if(p._spectator?.enabled){p.RAM[0x43d]=bot.x&255;p.RAM[0x43e]=bot.x>>8;p.RAM[0x43f]=bot.y&255;p.RAM[0x440]=bot.y>>8;}
    p.RAM[0x437]=1;record(bot,'Reached the exit; shared stage clear requested');
   }bot.action='Finding the exit';continue;}
   if(attackZone.has(key(tx,ty))&&!enemyApproach&&!clearing){bot.action='Waiting for an intercept';continue;}
   
   const hunting=findPath(p,start,n=>(n.x!==tx||n.y!==ty)&&attackZone.has(key(n.x,n.y)),{danger:allDanger,actor:bot});
   const objective=hunting??findPath(p,start,n=>(n.x!==tx||n.y!==ty)&&NEIGHBORS.some(([dx,dy])=>[2,3,4].includes(tileKind(p,n.x+dx,n.y+dy))),{danger:allDanger,actor:bot});
   const route=objective?.length?objective:null;
   bot.target=route?.[0]??null;bot.action=bot.target?(hunting?'Hunting monsters':'Clearing the stage'):'Waiting safely';
  }
 }
 // Extension actors use the ROM's loaded sprite patterns and the core's normal
 // sprite/background compositor. Their independent planning/life state is JS.
 p.MakeSpriteLine=function(vdcno){
  originalSpriteLine.call(this,vdcno);
  if(vdcno!==0||!isCampaign(this))return;
  const v=this.VDC[0],cameraX=this.RAM[0x25]|this.RAM[0x26]<<8,cameraY=this.RAM[0x27]|this.RAM[0x28]<<8,line=v.DrawBGYLine-(v.VDS+v.VSW)+64;
  const sourceKey=this.Palette.slice(0x1c0,0x1d0).join(',');
  for(const bot of state.bots){if(!visibleBot(bot))continue;
   const palette=512+state.bots.indexOf(bot)*16;
   let cached=paletteCache.get(bot.color);
   if(!cached||cached.key!==sourceKey){cached={key:sourceKey,colors:[],mono:[]};for(let i=0;i<16;i++){
    const raw=this.Palette[0x1c0+i],rgb={r:((raw>>3)&7)*36,g:((raw>>6)&7)*36,b:(raw&7)*36};
    const white=this.Palette[0x1cf],fade=Math.max((white>>3)&7,(white>>6)&7,white&7)/7;
    const face=this.Palette[0x1c7],skin={r:((face>>3)&7)*36,g:((face>>6)&7)*36,b:(face&7)*36};
    const color=colorize?colorize(rgb,i,bot.color,fade,skin):rgb;cached.colors[i]=color;
    const m=color.r*.299+color.g*.587+color.b*.114;cached.mono[i]={r:m,g:m,b:m};
   }paletteCache.set(bot.color,cached);}
   for(let i=0;i<16;i++){this.PaletteData[palette+i]=cached.colors[i];this.MonoPaletteData[palette+i]=cached.mono[i];}
   const pose=bot.alive?POSES[bot.direction][bot.target?Math.floor(bot.animation/8)%4:0]:DEATH_POSES[Math.floor(bot.deathFrame/8)];
   for(const [offsetY,offsetX,pattern,attribute] of pose){
    const width=((attribute&256)>>4)+16;
    let height=((attribute&0x3000)>>8)+16;height=height>32?64:height;
    // Pose offsets were recorded with the original eight-pixel camera origin.
    const y=Math.round(bot.y-cameraY)+offsetY,originX=Math.round(bot.x-cameraX)+offsetX+8-32;
    if(line<y||line>=y+height)continue;
    let spy=line-y;if(attribute&0x8000)spy=height-1-spy;
    const index=((pattern&this.SPAddressMask[width][height])<<5)|((spy&48)<<3)|(spy&15);
    for(let j=0;j<width;j++){
     const x=originX+j;if(x<0||x>=v.ScreenWidth||(v.SPLine[x].data&&(bot.alive||v.SPLine[x].no<2||v.SPLine[x].no>=64)))continue;
     const flip=!!(attribute&0x0800),bit=flip?(j%16):15-(j%16),bank=(flip&&width===32?(j<16?64:0):(j<16?0:64));
     let pixel=0;for(let plane=0;plane<4;plane++)pixel|=((v.VRAM[(index|bank)+plane*16]>>bit)&1)<<plane;
     if(pixel)Object.assign(v.SPLine[x],{data:pixel,palette,priority:128,no:64});
    }
   }
  }
 };
 return {state,add,update,restore(data){validateCompanionState(data);Object.assign(state,{bombRanges:Array(40).fill(0),foeMotion:[]},structuredClone(data));p._companionBombRanges=state.bombRanges;p._botSkullCells=undefined;for(const [i,b]of state.bots.entries()){if(b.deathFrame===undefined)b.deathFrame=b.alive?null:DEATH_FRAMES;if(b.bombBank===undefined)b.bombBank=i;if(b.bombCapacity===undefined)b.bombCapacity=1;const defaults={fireRange:Math.max(1,Math.min(5,p.RAM[0x84d]&127)),speedUp:false,remote:false,bombPass:false,wallPass:false,fireproof:0,extraLives:0,pickupsCollected:0,remoteTimers:Array(5).fill(0)};for(const [k,v]of Object.entries(defaults))if(b[k]===undefined)b[k]=v;}},reset(){state.bots=[];state.stage=null;state.steps=0;state.events=[];state.nextID=1;state.active=false;state.bombRanges.fill(0);state.foeMotion=[];p._botSkullCells=undefined;}};
}
export function validRoute(route){return Array.isArray(route)&&route.length<=1024&&route.every(validTile);}
export function validTile(t){return t&&Number.isInteger(t.x)&&t.x>=2&&t.x<=31&&Number.isInteger(t.y)&&t.y>=1&&t.y<=31&&(t.button===undefined||NEIGHBORS.some(n=>n[2]===t.button));}
export function validateCompanionState(data){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 if(!data||Object.keys(data).some(k=>!['bots','stage','nextID','steps','events','active','bombRanges','foeMotion'].includes(k))||!Array.isArray(data.bots)||data.bots.length>4||!integer(data.nextID)||!integer(data.steps)||typeof data.active!=='boolean'||(data.stage!==null&&!/^[0-7]:[0-7]$/.test(data.stage))||!Array.isArray(data.events)||data.events.length>40)throw new Error('Invalid teammate state in save.');
 if(data.foeMotion!==undefined&&(!Array.isArray(data.foeMotion)||data.foeMotion.length>32||new Set(data.foeMotion.map(e=>e?.slot)).size!==data.foeMotion.length||data.foeMotion.some(e=>!e||!integer(e.slot)||e.slot>31||!integer(e.type)||e.type>255||![e.x,e.y].every(n=>Number.isFinite(n)&&n>=0&&n<=65535)||![e.vx,e.vy].every(n=>Number.isFinite(n)&&Math.abs(n)<=2)||['speedX','speedY'].some(k=>e[k]!==undefined&&(!Number.isFinite(e[k])||e[k]<0||e[k]>2)))))throw new Error('Invalid monster motion in save.');
 if(data.bombRanges!==undefined&&(!Array.isArray(data.bombRanges)||data.bombRanges.length!==40||data.bombRanges.some(n=>!integer(n)||n>5)))throw new Error('Invalid saved bomb ranges.');
 for(const b of data.bots)if(!b||!Object.hasOwn(COLORS,b.color)||!integer(b.id)||!Number.isFinite(b.x)||!Number.isFinite(b.y)||b.x<32||b.x>520||b.y<16||b.y>520||typeof b.alive!=='boolean'||(b.target!==null&&!validTile(b.target))||!validRoute(b.route)||!integer(b.cooldown)||!integer(b.animation)||!integer(b.bombsPlaced)||!Number.isInteger(b.direction)||b.direction<0||b.direction>3||typeof b.action!=='string'||b.action.length>100)throw new Error('Invalid teammate state in save.');
 for(const b of data.bots)if(b.deathFrame!==undefined&&(b.alive?b.deathFrame!==null:!integer(b.deathFrame)||b.deathFrame>DEATH_FRAMES))throw new Error('Invalid teammate death animation in save.');
 for(const b of data.bots)if((b.bombBank!==undefined&&(!integer(b.bombBank)||b.bombBank>3))||(b.bombCapacity!==undefined&&(!integer(b.bombCapacity)||b.bombCapacity<1||b.bombCapacity>5)))throw new Error('Invalid teammate bomb inventory in save.');
 for(const b of data.bots){for(const k of ['speedUp','remote','bombPass','wallPass'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw new Error('Invalid teammate power-up in save.');for(const [k,max]of [['fireRange',5],['fireproof',3600],['extraLives',255],['pickupsCollected',1000000]])if(b[k]!==undefined&&(!integer(b[k])||b[k]>max||(k==='fireRange'&&b[k]<1)))throw new Error('Invalid teammate power-up in save.');if(b.remoteTimers!==undefined&&(!Array.isArray(b.remoteTimers)||b.remoteTimers.length!==5||b.remoteTimers.some(n=>!integer(n)||n>1000000)))throw new Error('Invalid remote bomb timers in save.');}
 const banks=data.bots.filter(visibleBot).map(b=>b.bombBank).filter(v=>v!==undefined);if(new Set(banks).size!==banks.length)throw new Error('Overlapping teammate bomb inventories in save.');
 for(const e of data.events)if(!e||!integer(e.frame)||!integer(e.bot)||typeof e.text!=='string'||e.text.length>200)throw new Error('Invalid teammate event in save.');
 return data;
}
