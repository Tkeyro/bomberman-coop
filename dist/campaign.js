import {COLORS} from './session.js';
export const ITEM_CATALOG = [
 ['fire','Fire up',0],['bomb','Bomb up',1],['remote','Remote control',2],['speed','Roller shoes',3],
 ['bomb-pass','Bomb pass',4],['wall-pass','Wall pass',5],['invincible','Fireproof vest',6],['life','Extra life',7],['skull','Skull / curse',8],
 ['bonus-9','PC Engine Shuttle',9],['bonus-10','CoreGrafx',10],['bonus-11','SuperGrafx',11],['bonus-12','Saxophone',12],['bonus-13','Dr. Mitsumori',13],['bonus-14','Lisa',14]
].map(([id,name,type])=>({id,name,type}));
const ENEMY_BASES=[0xd98,0xdb8,0xdd8,0xdf8,0xe18,0xe38,0xe58,0xe78,0xe98,0xeb8,0xed8,0xef8,0xf18,0xf38,0xf58,0xf78];
const NEIGHBORS=[[0,-1,'UP'],[1,0,'RIGHT'],[0,1,'DOWN'],[-1,0,'LEFT']];
const key=(x,y)=>`${x},${y}`;
export const stageID=p=>`${p.RAM[0x84a]}:${p.RAM[0x84b]}`;
export function isCampaign(p) {
 const s=p.VDC[0].SATB,pat=s[2];
 return (!p._campaignTracker||p._campaignTracker.frame-p._campaignTracker.last<=2)&&p.RAM[0x84a]<8&&(s[3]&15)===12&&pat>=640&&pat<704&&p.RAM[0x84b]<8&&p.RAM[0x44a+32+2]!==0;
}
export function tileKind(p,x,y){if(x<2||x>Math.min(31,(p.RAM[0x434]||15)-1)||y<1||y>Math.min(31,(p.RAM[0x435]||12)-1))return 1;return p.RAM[0x44a+y*32+x]&31;}
export function walkable(p,x,y){return [7,8,10].includes(tileKind(p,x,y));}
export function playerPosition(p){return {x:p.RAM[0x43d]|p.RAM[0x43e]<<8,y:p.RAM[0x43f]|p.RAM[0x440]<<8};}
export function bombs(p) {
 const result=[];
 for(let i=0;i<40;i++) if(p.RAM[0x84f+i]&0x80) result.push({slot:i,x:p.RAM[0x877+i],y:p.RAM[0x89f+i],fuse:p.RAM[0x8ef+i]});
 return result;
}
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
 for(const b of bombs(p)) for(const cell of blastCells(p,b.x,b.y)) danger.add(cell);
 for(let y=1;y<(p.RAM[0x435]||12);y++)for(let x=2;x<(p.RAM[0x434]||15);x++)if([6,11,12].includes(tileKind(p,x,y)))danger.add(key(x,y));
 return danger;
}
export function findPath(p,start,goal,{danger=new Set(),allowDanger=false,blocked=new Set(),maxSteps=1024}={}) {
 const queue=[{x:start.x,y:start.y,path:[]}],seen=new Set([key(start.x,start.y)]);
 for(let n=0;n<queue.length;n++){
  const node=queue[n];if(goal(node))return node.path;
  if(node.path.length>=maxSteps)continue;
  for(const [dx,dy,button] of NEIGHBORS){const x=node.x+dx,y=node.y+dy,k=key(x,y);
   if(seen.has(k)||!walkable(p,x,y)||blocked.has(k)||(!allowDanger&&danger.has(k)))continue;
   seen.add(k);queue.push({x,y,path:[...node.path,{x,y,button}]});
  }
 }
 return null;
}
function requireFloor(p,x,y){if(!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437])throw new Error('Open the admin menu during an active campaign stage.');if(!Number.isInteger(x)||!Number.isInteger(y)||!walkable(p,x,y)||tileKind(p,x,y)!==10)throw new Error('Choose an empty floor tile.');}
export function spawnBomb(p,x,y) {
 requireFloor(p,x,y);
 if(bombs(p).some(b=>b.x===x&&b.y===y))throw new Error('There is already a bomb on that tile.');
 const slot=Array.from({length:10},(_,i)=>i).find(i=>p.RAM[0x84f+i]===0);
 if(slot===undefined)throw new Error('The original campaign bomb slots are full.');
 p.RAM[0x84f+slot]=0x80;p.RAM[0x877+slot]=x;p.RAM[0x89f+slot]=y;
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
 const tile=findPath(p,start,n=>walkable(p,n.x,n.y)&&!blocked.has(key(n.x,n.y)),{blocked});
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
 [[[80,16,672,4236],[80,32,674,140]],[[80,16,680,4236],[80,32,678,140]],[[80,16,672,4236],[80,32,674,140]],[[80,7,688,4492]]],
 [[[80,0,652,2444],[96,16,656,2188]],[[80,16,664,6284],[80,1,654,2188]],[[80,0,652,2444],[96,16,656,2188]],[[80,17,666,6284],[80,1,654,2188]]],
 [[[80,8,640,396],[96,16,658,140]],[[80,8,644,396],[96,16,660,140]],[[80,8,640,396],[96,16,658,140]],[[80,8,648,396],[96,16,662,140]]],
 [[[80,16,652,396],[96,16,656,140]],[[80,15,664,4236],[80,30,654,140]],[[80,16,652,396],[96,16,656,140]],[[80,15,666,4236],[80,31,654,140]]]
];
export function createCompanions(p,{colorize}={}) {
 installCampaignTracker(p);
 const state={bots:[],stage:null,nextID:1,steps:0,events:[],active:false};
 const paletteCache=new Map();
 const originalSpriteLine=p.MakeSpriteLine;
 function add(x,y) {
  requireFloor(p,x,y);if(state.bots.filter(b=>b.alive).length>=4)throw new Error('Maximum four AI teammates.');
  const variants=Object.keys(COLORS),color=variants[Math.floor(Math.random()*variants.length)];
  const bot={id:state.nextID++,x:x*16+8,y:y*16+8,color,alive:true,target:null,route:[],cooldown:0,direction:2,animation:0,action:'Exploring',bombsPlaced:0};
  state.stage=stageID(p);state.bots=state.bots.filter(b=>b.alive);state.bots.push(bot);return bot;
 }
 function record(bot,text){state.events.push({frame:state.steps,bot:bot.id,text});if(state.events.length>40)state.events.shift();}
 function update() {
  if(!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437]){state.active=false;return;}
  const stage=stageID(p);if(state.stage!==null&&state.stage!==stage){const human=playerPosition(p),blocked=new Set([key(Math.floor(human.x/16),Math.floor(human.y/16))]);for(const b of state.bots){const cell=nearestFreeTile(p,{x:Math.floor(human.x/16),y:Math.floor(human.y/16)},blocked);b.x=cell.x*16+8;b.y=cell.y*16+8;b.target=null;b.route=[];blocked.add(key(cell.x,cell.y));}state.stage=stage;}
  state.active=true;
  state.steps++;
  const danger=dangerCells(p),foes=enemies(p),nowBombs=bombs(p);
  for(const bot of state.bots){
   if(!bot.alive)continue;
   const tx=Math.floor(bot.x/16),ty=Math.floor(bot.y/16),kind=tileKind(p,tx,ty);
   if([6,11,12].includes(kind)||foes.some(e=>Math.abs(e.x-bot.x)<10&&Math.abs(e.y-bot.y)<10)){
    bot.alive=false;bot.action='Defeated';record(bot,'Defeated by explosion or enemy');continue;
   }
   if(bot.cooldown>0)bot.cooldown--;
   if(bot.target){
    const dx=bot.target.x*16+8-bot.x,dy=bot.target.y*16+8-bot.y;
    if(!walkable(p,bot.target.x,bot.target.y)){bot.target=null;bot.route=[];continue;}
    const move=Math.min(.75,Math.abs(dx||dy));if(dx){bot.x+=Math.sign(dx)*move;bot.direction=dx>0?1:3;}else if(dy){bot.y+=Math.sign(dy)*move;bot.direction=dy>0?2:0;}
    bot.animation=(bot.animation+1)%32;
    if(Math.abs(dx)+Math.abs(dy)<=.75){bot.x=bot.target.x*16+8;bot.y=bot.target.y*16+8;bot.target=null;}
    continue;
   }
   const start={x:tx,y:ty};
   if(danger.has(key(tx,ty))){
    if(!bot.route.length)bot.route=findPath(p,start,n=>!danger.has(key(n.x,n.y)),{danger,allowDanger:true,maxSteps:7})??[];
    bot.target=bot.route.shift()??null;bot.action='Escaping';continue;
   }
   bot.route=[];
   const useful=NEIGHBORS.some(([dx,dy])=>[2,3,4].includes(tileKind(p,tx+dx,ty+dy)))||foes.some(e=>blastCells(p,tx,ty).has(key(Math.floor(e.x/16),Math.floor(e.y/16))));
   if(useful&&!bot.cooldown&&!nowBombs.some(b=>b.x===tx&&b.y===ty)) {
    const proposed=new Set([...danger,...blastCells(p,tx,ty)]);
    const escape=findPath(p,start,n=>!proposed.has(key(n.x,n.y)),{allowDanger:true,maxSteps:5});
    const person=playerPosition(p),humanTile=key(Math.floor(person.x/16),Math.floor(person.y/16));
    if(escape?.length&&!blastCells(p,tx,ty).has(humanTile)) {
     try{spawnBomb(p,tx,ty);bot.bombsPlaced++;bot.cooldown=180;bot.route=escape;bot.target=bot.route.shift();bot.action='Bombing and escaping';record(bot,'Placed original-engine bomb');continue;}catch{}
    }
   }
   const exit=findPath(p,start,n=>tileKind(p,n.x,n.y)===8,{danger});
   if(p.RAM[0xd96]&&exit){if(exit.length)bot.target=exit[0];else {p.RAM[0x437]=1;record(bot,'Reached the exit; shared stage clear requested');}bot.action='Finding the exit';continue;}
   
   const objective=findPath(p,start,n=>NEIGHBORS.some(([dx,dy])=>[2,3,4].includes(tileKind(p,n.x+dx,n.y+dy)))||foes.some(e=>blastCells(p,n.x,n.y).has(key(Math.floor(e.x/16),Math.floor(e.y/16)))),{danger});
   const route=objective?.length?objective:null;
   bot.target=route?.[0]??null;bot.action=bot.target?'Clearing the stage':'Waiting safely';
  }
 }
 // Extension actors use the ROM's loaded sprite patterns and the core's normal
 // sprite/background compositor. Their independent planning/life state is JS.
 p.MakeSpriteLine=function(vdcno){
  originalSpriteLine.call(this,vdcno);
  if(vdcno!==0||!isCampaign(this))return;
  const v=this.VDC[0],cameraX=this.RAM[0x25]|this.RAM[0x26]<<8,cameraY=this.RAM[0x27]|this.RAM[0x28]<<8,line=v.DrawBGYLine-(v.VDS+v.VSW)+64;
  const sourceKey=this.Palette.slice(0x1c0,0x1d0).join(',');
  for(const bot of state.bots){if(!bot.alive)continue;
   const palette=512+state.bots.indexOf(bot)*16;
   let cached=paletteCache.get(bot.color);
   if(!cached||cached.key!==sourceKey){cached={key:sourceKey,colors:[],mono:[]};for(let i=0;i<16;i++){
    const raw=this.Palette[0x1c0+i],rgb={r:((raw>>3)&7)*36,g:((raw>>6)&7)*36,b:(raw&7)*36};
    const white=this.Palette[0x1cf],fade=Math.max((white>>3)&7,(white>>6)&7,white&7)/7;
    const color=colorize?colorize(rgb,i,bot.color,fade):rgb;cached.colors[i]=color;
    const m=color.r*.299+color.g*.587+color.b*.114;cached.mono[i]={r:m,g:m,b:m};
   }paletteCache.set(bot.color,cached);}
   for(let i=0;i<16;i++){this.PaletteData[palette+i]=cached.colors[i];this.MonoPaletteData[palette+i]=cached.mono[i];}
   const pose=POSES[bot.direction][bot.target?Math.floor(bot.animation/8)%4:0];
   for(const [offsetY,offsetX,pattern,attribute] of pose){
    const width=((attribute&256)>>4)+16;
    let height=((attribute&0x3000)>>8)+16;height=height>32?64:height;
    const y=Math.round(bot.y-cameraY)+offsetY,originX=Math.round(bot.x-cameraX)+offsetX-32;
    if(line<y||line>=y+height)continue;
    let spy=line-y;if(attribute&0x8000)spy=height-1-spy;
    const index=((pattern&this.SPAddressMask[width][height])<<5)|((spy&48)<<3)|(spy&15);
    for(let j=0;j<width;j++){
     const x=originX+j;if(x<0||x>=v.ScreenWidth||v.SPLine[x].data)continue;
     const flip=!!(attribute&0x0800),bit=flip?(j%16):15-(j%16),bank=(flip&&width===32?(j<16?64:0):(j<16?0:64));
     let pixel=0;for(let plane=0;plane<4;plane++)pixel|=((v.VRAM[(index|bank)+plane*16]>>bit)&1)<<plane;
     if(pixel)Object.assign(v.SPLine[x],{data:pixel,palette,priority:128,no:64});
    }
   }
  }
 };
 return {state,add,update,restore(data){validateCompanionState(data);Object.assign(state,structuredClone(data));},reset(){state.bots=[];state.stage=null;state.steps=0;state.events=[];state.nextID=1;state.active=false;}};
}
export function validRoute(route){return Array.isArray(route)&&route.length<=1024&&route.every(validTile);}
export function validTile(t){return t&&Number.isInteger(t.x)&&t.x>=2&&t.x<=31&&Number.isInteger(t.y)&&t.y>=1&&t.y<=31&&(t.button===undefined||NEIGHBORS.some(n=>n[2]===t.button));}
export function validateCompanionState(data){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 if(!data||Object.keys(data).some(k=>!['bots','stage','nextID','steps','events','active'].includes(k))||!Array.isArray(data.bots)||data.bots.length>4||!integer(data.nextID)||!integer(data.steps)||typeof data.active!=='boolean'||(data.stage!==null&&!/^[0-7]:[0-7]$/.test(data.stage))||!Array.isArray(data.events)||data.events.length>40)throw new Error('Invalid teammate state in save.');
 for(const b of data.bots)if(!b||!Object.hasOwn(COLORS,b.color)||!integer(b.id)||!Number.isFinite(b.x)||!Number.isFinite(b.y)||b.x<32||b.x>520||b.y<16||b.y>520||typeof b.alive!=='boolean'||(b.target!==null&&!validTile(b.target))||!validRoute(b.route)||!integer(b.cooldown)||!integer(b.animation)||!integer(b.bombsPlaced)||!Number.isInteger(b.direction)||b.direction<0||b.direction>3||typeof b.action!=='string'||b.action.length>100)throw new Error('Invalid teammate state in save.');
 for(const e of data.events)if(!e||!integer(e.frame)||!integer(e.bot)||typeof e.text!=='string'||e.text.length>200)throw new Error('Invalid teammate event in save.');
 return data;
}
