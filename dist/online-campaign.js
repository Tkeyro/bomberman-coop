import {COLORS} from './session.js';
import {isCampaign,canOccupy,tileKind,pickups,restoreFloor,enemies,companionBombSlots,spawnBomb,playerPosition} from './campaign.js';

export const ONLINE_INPUT=Object.freeze({UP:1,RIGHT:2,DOWN:4,LEFT:8,BOMB:16,REMOTE:32});
const MASK=63,key=(x,y)=>`${x},${y}`;
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
function sound(p,id){
 const read=n=>p.Mapper.Read(4*8192+n),priority=n=>read(0xdc8+n),pointer=read(0xde8+id*2)|(read(0xde9+id*2)<<8),mask=read(pointer&8191)&63,pending=p.RAM[0x1487];
 if(!(pending&128)&&priority(id)<priority(pending))return;
 for(let c=0;c<6;c++)if((mask&(1<<c))&&p.RAM[0x14f8+c]&&priority(id)<priority(p.RAM[0x1480+c]))return;
 p.RAM[0x1487]=id;for(let c=0;c<6;c++)if(mask&(1<<c))p.RAM[0x1480+c]=id;
}
function blockedOverlap(p,actor,point){
 let area=0;for(let y=Math.floor((point.y-5)/16);y<=Math.floor((point.y+5)/16);y++)for(let x=Math.floor((point.x-5)/16);x<=Math.floor((point.x+5)/16);x++){const kind=tileKind(p,x,y),solid=[1,2,3,4,5].includes(kind)&&!(actor.wallPass&&[2,3,4].includes(kind));if(solid||(kind===0&&!actor.bombPass))area+=Math.max(0,Math.min(point.x+5,(x+1)*16)-Math.max(point.x-5,x*16))*Math.max(0,Math.min(point.y+5,(y+1)*16)-Math.max(point.y-5,y*16));}return area;
}
function upgrade(actor,type){
 if(type===0)actor.fireRange=Math.min(5,actor.fireRange+1);if(type===1)actor.bombCapacity=Math.min(5,actor.bombCapacity+1);
 if(type===2)actor.remote=true;if(type===3)actor.speedUp=true;if(type===4)actor.bombPass=true;if(type===5)actor.wallPass=true;
 if(type===6)actor.fireproof=3600;if(type===7)actor.extraLives=Math.min(255,actor.extraLives+1);
}
export function validateOnlineCampaign(s){
 if(!s||Object.keys(s).some(k=>!['enabled','roster','frame','inputs','previous','released'].includes(k))||typeof s.enabled!=='boolean'||!Array.isArray(s.roster)||s.roster.length>5||(s.enabled&&s.roster.length<2)||!Number.isSafeInteger(s.frame)||s.frame< -1||s.frame>1000000000)throw new Error('Invalid online campaign save.');
 if(new Set(s.roster.map(r=>r?.id)).size!==s.roster.length||s.roster.some(r=>!r||Object.keys(r).some(k=>!['id','color','name'].includes(k))||!integer(r.id,1000000)||r.id<1||!Object.hasOwn(COLORS,r.color)||(r.name!==undefined&&(typeof r.name!=='string'||r.name.length>60))))throw new Error('Invalid online campaign roster.');
 for(const k of ['inputs','previous'])if(!Array.isArray(s[k])||s[k].length!==s.roster.length||s[k].some(n=>!integer(n,MASK)))throw new Error('Invalid online campaign inputs.');
 if(!Array.isArray(s.released)||s.released.length!==40||s.released.some(n=>typeof n!=='boolean'))throw new Error('Invalid online bomb controls.');
 return s;
}

// All remote humans use the same extension actors as campaign companions. The
// ordered input frame is the entire gameplay authority; local camera selection
// is deliberately excluded from saved state and native CPU writes.
export function createOnlineCampaign(p,{getActors=()=>[],getLocalID=()=>null}={}){
 const state={enabled:false,roster:[],frame:-1,inputs:[],previous:[],released:Array(40).fill(false)};
 let localRendering=true;
 const sprites=p.MakeSpriteLine,background=p.MakeBGLine;
 p._onlineCampaign={state,control};
 function members(){const actors=getActors();return state.roster.map(r=>actors.find(a=>a.id===r.id)).filter(Boolean);}
 function focus(){const actors=members(),id=getLocalID();return actors.find(a=>a.id===id&&a.alive)??actors.find(a=>a.alive)??actors.find(a=>a.id===id)??actors[0]??playerPosition(p);}
 function canonical(){const actors=members();return actors.find(a=>a.alive)??actors[0]??playerPosition(p);}
 function camera(actor){const width=p.RAM[0x434]*16,height=p.RAM[0x435]*16;return {x:Math.floor(Math.max(8,Math.min(Math.max(8,width-256),actor.x-120))),y:Math.floor(Math.max(0,Math.min(Math.max(0,height-208),actor.y-104)))};}
 function setInputs(frame,inputs){
  if(!Number.isSafeInteger(frame)||frame<0||frame>1000000000||!Array.isArray(inputs)||inputs.length!==state.roster.length||inputs.some(n=>!integer(n,MASK)))throw new Error('Invalid online input frame.');
  if(frame<state.frame)throw new Error('Online input frames must be ordered.');
  if(frame===state.frame){if(inputs.some((n,i)=>n!==state.inputs[i]))throw new Error('An online input frame cannot change.');return;}
  state.previous=[...state.inputs];state.inputs=[...inputs];state.frame=frame;
 }
 function collect(actor){
  const tx=Math.floor(actor.x/16),ty=Math.floor(actor.y/16),item=pickups(p).find(i=>i.x===tx&&i.y===ty);
  if(!item||Math.abs(actor.x-(tx*16+8))>1||Math.abs(actor.y-(ty*16+8))>1)return;
  // Curse art is collectible by a human, but never a shared beneficial upgrade.
  const metadata=p._newCampaign?.enabled&&p._newCampaign.ready?0xc0:p.RAM[0x44a+ty*32+tx]&224;
  if(!restoreFloor(p,tx,ty,metadata))return;
  p.RAM[0xf9b+item.slot]=0;p._levelObjective?.collect(tx,ty,item.slot);upgrade(actor,item.type);
  actor.pickupsCollected++;if(item.type!==8)p._sharedPowerups?.collect(item.type,actor);
  actor.action='Collected a power-up';
 }
 function control(actor){
  if(!state.enabled)return false;
  const i=state.roster.findIndex(r=>r.id===actor.id);if(i<0)return false;
  actor.goal=null;actor.route=[];actor.yieldFrames=0;actor.target=null;
  if(!actor.alive||!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437])return true;
  const input=state.inputs[i]??0,pressed=input&~(state.previous[i]??0),slots=companionBombSlots(actor);
  for(const slot of slots){
   if(!(p.RAM[0x84f+slot]&128)||p.RAM[0x917+slot]!==255){state.released[slot]=false;continue;}
   // The native fuse reaches zero one frame before its explosion starts.
   // Leave zero intact so holding or releasing the remote button cannot
   // restart that fuse and keep the bomb stuck in its idle animation.
   if(actor.remote&&p.RAM[0x8ef+slot]!==0){if(pressed&ONLINE_INPUT.REMOTE)state.released[slot]=true;p.RAM[0x8ef+slot]=state.released[slot]?1:150;}
  }
  const tx=Math.floor(actor.x/16),ty=Math.floor(actor.y/16);
  if(pressed&ONLINE_INPUT.BOMB){
   try{if(slots.filter(s=>p.RAM[0x84f+s]).length>=actor.bombCapacity)throw new Error('Own bombs are active.');
    const slot=spawnBomb(p,tx,ty,{slots});p._companionBombRanges[slot]=actor.fireRange;state.released[slot]=false;actor.remoteTimers[slots.indexOf(slot)]=0;actor.bombsPlaced++;
   }catch{}
  }
  let dx=0,dy=0,direction=actor.direction;
  if(input&ONLINE_INPUT.UP){dy=-1;direction=0;}else if(input&ONLINE_INPUT.RIGHT){dx=1;direction=1;}else if(input&ONLINE_INPUT.DOWN){dy=1;direction=2;}else if(input&ONLINE_INPUT.LEFT){dx=-1;direction=3;}
  const speed=actor.speedUp?1:.75;
  // Complete the current corridor's alignment before making a right-angle
  // turn, matching native grid movement without clipping a corner.
  const centerX=tx*16+8,centerY=ty*16+8;
  if(dx&&Math.abs(actor.y-centerY)>.01){dx=0;dy=Math.sign(centerY-actor.y);direction=dy>0?2:0;}
  else if(dy&&Math.abs(actor.x-centerX)>.01){dy=0;dx=Math.sign(centerX-actor.x);direction=dx>0?1:3;}
  let amount=speed;
  if(dx&&Math.abs(actor.x-centerX)>.01&&Math.sign(centerX-actor.x)===dx)amount=Math.min(amount,Math.abs(centerX-actor.x));
  if(dy&&Math.abs(actor.y-centerY)>.01&&Math.sign(centerY-actor.y)===dy)amount=Math.min(amount,Math.abs(centerY-actor.y));
  const next={x:actor.x+dx*amount,y:actor.y+dy*amount},leaving=tileKind(p,tx,ty)===0?{...actor,leaveBomb:key(tx,ty)}:actor;
  // Bombermen may share floor and pass through one another. Terrain and bombs
  // still control movement, including stepping fully off a newly placed bomb.
  const clear=canOccupy(p,next.x,next.y,leaving)||blockedOverlap(p,actor,next)<blockedOverlap(p,actor,actor);
  if((dx||dy)&&clear){actor.x=next.x;actor.y=next.y;actor.direction=direction;actor.animation=(actor.animation+1)%32;
   actor.target={x:Math.floor(actor.x/16),y:Math.floor(actor.y/16)};actor.action='Playing online';
   if(actor.animation%16===8)sound(p,p.RAM[0x84a]===2?0x12:1);
  }else actor.action='Waiting for input';
  collect(actor);
  const x=Math.floor(actor.x/16),y=Math.floor(actor.y/16);
  if(tileKind(p,x,y)===8&&Math.abs(actor.x-(x*16+8))<4&&Math.abs(actor.y-(y*16+8))<4&&!enemies(p).length&&p.RAM[0xd96]&&p._levelObjective?.canExit()!==false){
   p.RAM[0x43d]=actor.x&255;p.RAM[0x43e]=actor.x>>8;p.RAM[0x43f]=actor.y&255;p.RAM[0x440]=actor.y>>8;p.RAM[0x437]=1;
  }
  return true;
 }
 function update(){
  if(!state.enabled)return;
  const lead=canonical();if(p._spectator&&lead.id)p._spectator.followID=lead.id;
 }
 // Compute native sprite collision/overflow flags at the canonical camera,
 // then render a second view with temporary coordinates. Hardware flags and
 // all RAM/SATB coordinates are restored before CPU execution continues.
 p.MakeSpriteLine=function(n){
  sprites.call(this,n);
  if(n!==0||!state.enabled||!isCampaign(this)||!localRendering)return;
  const local=camera(focus()),canonicalX=this.RAM[0x25]|this.RAM[0x26]<<8,canonicalY=this.RAM[0x27]|this.RAM[0x28]<<8,dx=local.x-canonicalX,dy=local.y-canonicalY;
  if(!dx&&!dy)return;
  const v=this.VDC[0],status=v.VDCStatus,coords=this.RAM.slice(0x25,0x29),satb=[...v.SATB];
  for(let s=0;s<256;s+=4){v.SATB[s]=(satb[s]-dy)&1023;v.SATB[s+1]=(satb[s+1]-dx)&1023;}
  this.RAM[0x25]=local.x&255;this.RAM[0x26]=local.x>>8;this.RAM[0x27]=local.y&255;this.RAM[0x28]=local.y>>8;
  try{sprites.call(this,n);}finally{for(let j=0;j<4;j++)this.RAM[0x25+j]=coords[j];for(let j=0;j<256;j++)v.SATB[j]=satb[j];v.VDCStatus=status;}
 };
 p.MakeBGLine=function(n){
  if(n!==0||!state.enabled||!isCampaign(this)||!localRendering)return background.call(this,n);
  const v=this.VDC[0],line=v.DrawBGYLine-(v.VDS+v.VSW);if(line<32)return background.call(this,n);
  const local=camera(focus()),dx=local.x-(this.RAM[0x25]|this.RAM[0x26]<<8),dy=local.y-(this.RAM[0x27]|this.RAM[0x28]<<8),bx=v.VDCRegister[7],by=v.DrawBGLine,coords=this.RAM.slice(0x25,0x29);
  v.VDCRegister[7]=bx+dx;v.DrawBGLine=(by+dy)&v.VScreenHeightMask;
  this.RAM[0x25]=local.x&255;this.RAM[0x26]=local.x>>8;this.RAM[0x27]=local.y&255;this.RAM[0x28]=local.y>>8;
  try{return background.call(this,n);}finally{v.VDCRegister[7]=bx;v.DrawBGLine=by;for(let j=0;j<4;j++)this.RAM[0x25+j]=coords[j];}
 };
 // Catch-up frames still run the canonical compositor and its native collision
 // flags. Only the extra local-camera pass is optional; this presentation flag
 // is deliberately absent from saved gameplay state and checksums.
 return {state,control,setInputs,update,focus,canonical,setLocalRendering(enabled){localRendering=Boolean(enabled);},configure(enabled,roster=[]){
  localRendering=true;
  const next={enabled,roster:structuredClone(roster),frame:-1,inputs:roster.map(()=>0),previous:roster.map(()=>0),released:Array(40).fill(false)};validateOnlineCampaign(next);Object.assign(state,next);update();
 },restore(s){validateOnlineCampaign(s);localRendering=true;Object.assign(state,structuredClone(s));update();},reset(){localRendering=true;Object.assign(state,{enabled:false,roster:[],frame:-1,inputs:[],previous:[],released:Array(40).fill(false)});}};
}
