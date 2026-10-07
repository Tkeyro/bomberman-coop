import {isCampaign,tileKind,enemies,spawnEnemy,spawnItem,playerPosition} from './campaign.js';
const ENEMY_BASES=[0xd98,0xdb8,0xdd8,0xdf8,0xe18,0xe38,0xe58,0xe78,0xe98,0xeb8,0xed8,0xef8,0xf18,0xf38,0xf58,0xf78];
function random(seed){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
function shuffle(values,rng){for(let i=values.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[values[i],values[j]]=[values[j],values[i]];}return values;}
export function generateChallengeMap(seed,round,players=1){
 const rng=random((seed+Math.imul(round,2654435761))>>>0),width=Math.min(31,27+2*Math.floor((round-1)/3)),height=Math.min(29,21+2*Math.floor((round-1)/2)),cells=Array(1024).fill(1),floor=[],available=[];
 for(let y=1;y<height;y++)for(let x=2;x<width;x++){
  if(x%2===1&&y%2===0)continue;
  const safe=x<=6&&y<=3,kind=safe||rng()>Math.min(.68,.46+round*.015)?10:2;cells[y*32+x]=kind;
  if(!safe)available.push({x,y});if(kind===10&&!safe)floor.push({x,y});
 }
 const exit={x:width-1,y:height-1};if(exit.x%2===1&&exit.y%2===0)exit.x--;cells[exit.y*32+exit.x]=4;
 const spawnCells=shuffle(available.filter(c=>c.x!==exit.x||c.y!==exit.y),rng),monsters=spawnCells.slice(0,Math.min(28,12+round*2+(players-1)*2));for(const c of monsters)cells[c.y*32+c.x]=10;
 const occupied=new Set(monsters.map(c=>c.y*32+c.x)),items=[{type:0,x:3,y:1}],types=[1,3,0,1,6,7,0,3];
 for(const c of shuffle(floor.filter(c=>!occupied.has(c.y*32+c.x)&&(c.x!==exit.x||c.y!==exit.y)),rng).slice(0,types.length))items.push({...c,type:types[items.length-1]});
 return {width,height,cells,exit,monsters,items};
}
export function createNewCampaign(p,{onRound=()=>{}}={}){
 const state={enabled:false,seed:1,round:1,players:1,ready:false,pending:false,width:0,height:0,tiles:null,enemyTemplate:null};
 const set=p.Set,run=p.Run;
 function camera(){const pos=playerPosition(p),x=Math.max(8,Math.min(state.width*16-256,pos.x-120)),y=Math.max(0,Math.min(state.height*16-208,pos.y-104));return [Math.floor(x)&255,Math.floor(x)>>8,Math.floor(y)&255,Math.floor(y)>>8];}
 p.Set=function(address,value){
  if(state.enabled&&state.ready&&isCampaign(this)){
   const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
   if(physical>=0x1f0000&&physical<0x1f8000){
    if(offset>=0x25&&offset<=0x28)value=camera()[offset-0x25];
    if(offset===0x437&&value===1){if(!(this.RAM[0x43a]&7)&&this.RAM[0xd96]&&enemies(this).length===0)state.pending=true;value=0;}
   }
  }
  return set.call(this,address,value);
 };
 p.Run=function(){if(state.enabled&&state.ready&&this.RAM[0x437]===1){if(!(this.RAM[0x43a]&7)&&this.RAM[0xd96]&&enemies(this).length===0)state.pending=true;this.RAM[0x437]=0;}return run.call(this);};
 function captureTemplates(){
  const v=p.VDC[0],tiles={};for(let y=1;y<p.RAM[0x435];y++)for(let x=2;x<p.RAM[0x434];x++){
   const kind=tileKind(p,x,y);if([1,2,10].includes(kind)&&!tiles[kind])tiles[kind]=[v.VRAM[y*2*v.VScreenWidth+x*2],v.VRAM[y*2*v.VScreenWidth+x*2+1],v.VRAM[(y*2+1)*v.VScreenWidth+x*2],v.VRAM[(y*2+1)*v.VScreenWidth+x*2+1]];
  }
  const template=enemies(p).find(e=>e.type<23);if(!template||![1,2,10].every(k=>tiles[k]))throw new Error('The original campaign assets are not ready.');
  state.tiles=tiles;state.enemyTemplate=ENEMY_BASES.map(base=>p.RAM[base+template.slot]);
 }
 function build(){
  if(!state.tiles)captureTemplates();const map=generateChallengeMap(state.seed,state.round,state.players),v=p.VDC[0];state.width=map.width;state.height=map.height;
  p.RAM[0x434]=map.width;p.RAM[0x435]=map.height;p.RAM[0x437]=0;p.RAM[0x43d]=40;p.RAM[0x43e]=0;p.RAM[0x43f]=24;p.RAM[0x440]=0;p.RAM[0x43b]=2;p.RAM[0x43c]=0;p.RAM[0x76]=p.RAM[0x77]=0;
  p.RAM[0xd8d]=6;p.RAM[0xd8e]=59;p.RAM[0xd8f]=59;p.RAM[0xd90]=0;
  for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;for(let i=0;i<25;i++)p.RAM[0xf9b+i]=0;for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
   const kind=map.cells[y*32+x],tiles=state.tiles[kind===4?2:kind];p.RAM[0x44a+y*32+x]=kind===4?0x24:kind;
   for(let i=0;i<4;i++)v.VRAM[(y*2+(i>>1))*v.VScreenWidth+x*2+(i&1)]=tiles[i];
  }
  // A temporary live template reuses only monster art already loaded by the ROM.
  for(let i=0;i<ENEMY_BASES.length;i++)p.RAM[ENEMY_BASES[i]+31]=state.enemyTemplate[i];
  p.RAM[0xd98+31]=128;
  for(const cell of map.monsters)spawnEnemy(p,31,cell.x,cell.y);p.RAM[0xd98+31]=0;p.RAM[0xd96]=0;
  for(const item of map.items)spawnItem(p,item.type,item.x,item.y);
  state.ready=true;state.pending=false;const coords=camera();for(let i=0;i<4;i++)p.RAM[0x25+i]=coords[i];onRound(state.round);
 }
 function update(){
  if(!state.enabled||!isCampaign(p)||(p.RAM[0x43a]&7))return;
  if(state.pending){state.round++;build();}
  else if(!state.ready||p.RAM[0x434]!==state.width||p.RAM[0x435]!==state.height)build();
  const coords=camera();for(let i=0;i<4;i++)p.RAM[0x25+i]=coords[i];
 }
 return {state,update,configure(enabled,players=1,seed=crypto.getRandomValues(new Uint32Array(1))[0]){Object.assign(state,{enabled,seed,round:1,players,ready:false,pending:false,width:0,height:0,tiles:null,enemyTemplate:null});},restore(data){validateNewCampaign(data);Object.assign(state,structuredClone(data));}};
}
export function validateNewCampaign(s){
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 if(!s||Object.keys(s).some(k=>!['enabled','seed','round','players','ready','pending','width','height','tiles','enemyTemplate'].includes(k))||typeof s.enabled!=='boolean'||typeof s.ready!=='boolean'||typeof s.pending!=='boolean'||!integer(s.seed,4294967295)||!integer(s.round,1000000)||s.round<1||!integer(s.players,5)||s.players<1||!integer(s.width,31)||!integer(s.height,29))throw new Error('Invalid NEW campaign save.');
 if(s.ready&&(!s.tiles||!s.enemyTemplate||s.width<27||s.height<21))throw new Error('Incomplete NEW campaign save.');
 if(s.tiles!==null&&(!s.tiles||![1,2,10].every(k=>Array.isArray(s.tiles[k])&&s.tiles[k].length===4&&s.tiles[k].every(t=>integer(t,65535)))))throw new Error('Invalid NEW map tile references.');
 if(s.enemyTemplate!==null&&(!Array.isArray(s.enemyTemplate)||s.enemyTemplate.length!==16||!s.enemyTemplate.every(t=>integer(t,255))||s.enemyTemplate[9]>=23))throw new Error('Invalid NEW monster template.');
 return s;
}
