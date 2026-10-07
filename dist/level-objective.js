import {isCampaign,installCampaignTracker,stageID,tileKind,walkable,playerPosition,enemies,bombs,pickups,spawnItem,dangerCells} from './campaign.js';
const PHASES=['waiting','barrier','revealing','item','collected'];
const key=(x,y)=>`${x},${y}`,neighbors=[[0,-1],[1,0],[0,1],[-1,0]];
const stageKey=p=>p._newCampaign?.enabled?`new:${p._newCampaign.seed}:${p._newCampaign.round}`:stageID(p);
export function validateLevelObjective(s){
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 if(!s||Object.keys(s).some(k=>!['enabled','stage','phase','x','y','type','slot','blockTiles','reload'].includes(k))||typeof s.enabled!=='boolean'||typeof s.reload!=='boolean'||!PHASES.includes(s.phase)||s.type!==1||(s.stage!==null&&(typeof s.stage!=='string'||!/^(?:[0-7]:[0-7]|new:[0-9]{1,10}:[0-9]{1,7})$/.test(s.stage))))throw new Error('Invalid required stage item in save.');
 if(s.stage?.startsWith('new:')){const [,seed,round]=s.stage.split(':').map(Number);if(!integer(seed,4294967295)||!integer(round,1000000)||!round)throw new Error('Invalid required item stage in save.');}
 if(s.phase==='waiting'?(s.x!==null||s.y!==null||s.slot!==null):(!integer(s.x,31)||s.x<2||!integer(s.y,31)||s.y<1))throw new Error('Invalid required item position in save.');
 if(s.slot!==null&&(!integer(s.slot,24)||!['item','collected'].includes(s.phase)))throw new Error('Invalid required item slot in save.');
 if(s.phase==='item'&&s.slot===null)throw new Error('Missing required item slot in save.');
 if(s.blockTiles!==null&&(!Array.isArray(s.blockTiles)||s.blockTiles.length!==4||!s.blockTiles.every(t=>integer(t,65535))))throw new Error('Invalid required barrier tiles in save.');
 return s;
}
export function createLevelObjective(p,{getActors=()=>[playerPosition(p)],getFocus=()=>playerPosition(p)}={}){
 const state={enabled:false,stage:null,phase:'waiting',x:null,y:null,type:1,slot:null,blockTiles:null,reload:false};
 const tracker=installCampaignTracker(p),run=p.Run,set=p.Set,cpu=p.CPURun,background=p.MakeBGLine;
 // A save made before this feature can already be inside a committed native
 // clear. Let that sequence finish; the following play frame gets a new goal.
 const canExit=()=>!state.enabled||state.phase==='collected'||p._newCampaign?.transition?.kind==='advance'||(state.stage===null&&p.RAM[0x437]===1);
 function reset(){Object.assign(state,{stage:null,phase:'waiting',x:null,y:null,slot:null,blockTiles:null,reload:false});}
 function begin(){reset();state.stage=stageKey(p);captureBlock();}
 function captureBlock(){
  if(state.blockTiles)return;
  const v=p.VDC[0];for(let y=1;y<p.RAM[0x435];y++)for(let x=2;x<p.RAM[0x434];x++)if([2,3,4].includes(tileKind(p,x,y))){state.blockTiles=Array.from({length:4},(_,i)=>v.VRAM[(y*2+(i>>1))*v.VScreenWidth+x*2+(i&1)]);return;}
  // Native redraw kind 2 uses metatile 0x308, palette 4. These references
  // remain loaded after all blocks are gone, including older imported saves.
  state.blockTiles=p._newCampaign?.tiles?.[2]?.slice()??[0x4308,0x4309,0x4318,0x4319];
 }
 function reachable(){
  const focus=getFocus(),starts=[focus,...getActors()].filter(a=>a&&Number.isFinite(a.x)&&Number.isFinite(a.y)).map(a=>({x:Math.floor(a.x/16),y:Math.floor(a.y/16)}));
  let start=starts.find(c=>walkable(p,c.x,c.y));
  if(!start)for(let y=1;y<p.RAM[0x435]&&!start;y++)for(let x=2;x<p.RAM[0x434];x++)if(walkable(p,x,y)){start={x,y};break;}
  if(!start)return [];
  const queue=[{...start,distance:0}],seen=new Set([key(start.x,start.y)]);
  for(let i=0;i<queue.length;i++)for(const [dx,dy]of neighbors){const x=queue[i].x+dx,y=queue[i].y+dy,k=key(x,y);if(!seen.has(k)&&walkable(p,x,y)){seen.add(k);queue.push({x,y,distance:queue[i].distance+1});}}
  return queue;
 }
 function activate(){
  captureBlock();if(!state.blockTiles)return;
  const floor=reachable(),occupied=new Set([...getActors().filter(Boolean).map(a=>key(Math.floor(a.x/16),Math.floor(a.y/16))),...bombs(p).map(b=>key(b.x,b.y))]);
  let cell;for(const n of floor){for(const [dx,dy]of neighbors)if(tileKind(p,n.x+dx,n.y+dy)===2){cell={x:n.x+dx,y:n.y+dy};break;}if(cell)break;}
  // If every block is gone, create a new barrier away from actors and the exit.
  if(!cell)cell=floor.find(n=>n.distance>=2&&tileKind(p,n.x,n.y)===10&&!occupied.has(key(n.x,n.y))&&neighbors.filter(([dx,dy])=>walkable(p,n.x+dx,n.y+dy)).length>=2)
   ??floor.find(n=>tileKind(p,n.x,n.y)===10&&!occupied.has(key(n.x,n.y)));
  if(!cell)return;
  state.x=cell.x;state.y=cell.y;state.phase='barrier';
  p.RAM[0x44a+cell.y*32+cell.x]=0xc2;
  const v=p.VDC[0];for(let i=0;i<4;i++)v.VRAM[(cell.y*2+(i>>1))*v.VScreenWidth+cell.x*2+(i&1)]=state.blockTiles[i];
 }
 function collect(x,y,slot=state.slot){if(state.enabled&&state.phase==='item'&&x===state.x&&y===state.y&&slot===state.slot){state.phase='collected';return true;}return false;}
 function update(){
  if(!state.enabled||!isCampaign(p)||state.reload||p._newCampaign?.transition?.phase==='loading'||p._spectator?.transition?.phase==='loading')return;
  if((p.RAM[0x43a]&7)||p.RAM[0x437])return;
  if(state.stage!==stageKey(p))begin();
  if(state.phase==='waiting'&&!enemies(p).length)activate();
  if(state.phase==='barrier'&&tileKind(p,state.x,state.y)!==2)state.phase='revealing';
  if(state.phase==='item'&&(!(p.RAM[0xf9b+state.slot]&128)||!pickups(p).some(i=>i.slot===state.slot&&i.x===state.x&&i.y===state.y&&i.type===state.type))){
   state.phase='revealing';state.slot=null;
  }
  // Wait for the native breaking/flame animation before exposing the power-up.
  // A required pickup hit by an external bomb is recreated after the flame.
  if(state.phase==='revealing'&&tileKind(p,state.x,state.y)===10&&!dangerCells(p).has(key(state.x,state.y))){
   try{state.slot=spawnItem(p,state.type,state.x,state.y);state.phase='item';}catch{}
  }
  if(!canExit()&&p.RAM[0x437]===1)p.RAM[0x437]=0;
 }
 p.Set=function(address,value){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  // Bank 9's ordinary human pickup handler clears the live item flag here.
  // Explosion/despawn writes use other PCs and must never satisfy the goal.
  if(state.enabled&&state.phase==='item'&&!this._spectator?.enabled&&physical>=0x1f0000&&physical<0x1f8000&&offset===0xf9b+state.slot&&value===0&&this.PC===0x8750&&this.MPR[4]===9*8192&&(this.RAM[offset]&128)&&(this.RAM[offset]&31)===state.type&&this.RAM[0xfb4+state.slot]===state.x&&this.RAM[0xfcd+state.slot]===state.y)collect(state.x,state.y);
  if(state.enabled&&isCampaign(this)&&physical>=0x1f0000&&physical<0x1f8000&&(physical&8191)===0x437&&value===1&&!canExit())value=0;
  return set.call(this,address,value);
 };
 p.Run=function(){update();if(state.enabled&&!canExit()&&isCampaign(this)&&this.RAM[0x437]===1)this.RAM[0x437]=0;const result=run.call(this);update();return result;};
 p.CPURun=function(){
  const bank=this.MPR[this.PC>>13]>>13,play=bank===9&&this.PC===0x83b0;
  if(state.enabled&&bank===8&&[0x7ca2,0x7cae].includes(this.PC))state.reload=true;
  const result=cpu.call(this);
  if(state.enabled&&play&&!(this.RAM[0x43a]&7)&&(state.reload||state.stage!==stageKey(this))&&!(state.stage===null&&this.RAM[0x437]===1)){tracker.last=tracker.frame;begin();}
  return result;
 };
 p.MakeBGLine=function(n){
  background.call(this,n);if(n!==0||!state.enabled||state.phase!=='barrier'||!isCampaign(this)||(this.RAM[0x43a]&7)||this.RAM[0x437])return;
  const v=this.VDC[0],y=v.DrawBGLine-state.y*16;if(y<0||y>=16)return;
  const left=((v.HDS+v.HSW)<<3)+v.DrawBGIndex,scroll=v.VDCRegister[7],pulse=.65+.25*Math.sin(tracker.frame/10),palette=592;
  for(let x=0;x<v.ScreenWidth;x++){
   const wx=((scroll+x)&(v.VScreenWidth*8-1))-state.x*16;if(wx<0||wx>=16||v.SPLine[x].data)continue;
   const pixel=v.BGLine[left+x],base=this.PaletteData[pixel],border=wx<2||wx>13||y<2||y>13,index=border?16:pixel&15;
   const color=border?{r:Math.round(180*pulse),g:Math.round(252*pulse),b:Math.round(252*pulse)}:{r:Math.round(base.r*.6),g:Math.round(base.g*.6+100*pulse),b:Math.round(base.b*.6+120*pulse)};
   this.PaletteData[palette+index]=color;const mono=color.r*.299+color.g*.587+color.b*.114;this.MonoPaletteData[palette+index]={r:mono,g:mono,b:mono};v.BGLine[left+x]=palette+index;
  }
 };
 const api={state,canExit,collect,update,configure(enabled){state.enabled=Boolean(enabled);reset();},restore(data){validateLevelObjective(data);Object.assign(state,structuredClone(data));}};
 p._levelObjective=api;return api;
}
