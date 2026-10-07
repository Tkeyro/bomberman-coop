import {isCampaign,installCampaignTracker,stageID} from './campaign.js';
import {nativeEnemyAtlas,enemyAssetID} from './enemy-icons.js';
export const ENEMY_PALETTE_BASE=640;
export const ENEMY_PALETTE_MAX=3184;
const emptyOwners=()=>Array(64).fill(null),firstType=[0,2,4,6,8,23,27,31,29,34];
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const ownerValid=owner=>owner===null||owner&&Object.keys(owner).every(key=>['slot','type'].includes(key))&&integer(owner.slot,31)&&integer(owner.type,44);
export function validateEnemySpawns(s){
 if(!s||Object.keys(s).some(key=>!['stage','actors','pendingOwners','owners','drawOwner'].includes(key))||(s.stage!==null&&(typeof s.stage!=='string'||!/^[0-7]:[0-7]$/.test(s.stage)))||!Array.isArray(s.actors)||s.actors.length>32||s.actors.some(a=>!a||!ownerValid(a))||new Set(s.actors.map(a=>a.slot)).size!==s.actors.length)throw new Error('Invalid spawned enemy state in save.');
 for(const owners of [s.pendingOwners,s.owners])if(!Array.isArray(owners)||owners.length!==64||owners.some(owner=>!ownerValid(owner)))throw new Error('Invalid spawned enemy sprite ownership in save.');
 const draw=s.drawOwner;if(draw!==null&&(!draw||Object.keys(draw).some(key=>!['slot','type','stack','returnPC','bank'].includes(key))||!integer(draw.slot,31)||!integer(draw.type,44)||!integer(draw.stack,255)||!integer(draw.returnPC,65535)||!integer(draw.bank,255)))throw new Error('Invalid spawned enemy drawing state in save.');
 return s;
}

// This is the pinned JSPCE sprite compositor, with each registered native
// enemy's pattern/palette reads directed to its private runtime ROM atlas.
// SATB, VRAM, VCE words, clipping, priority and collision/overflow rules stay
// native. Existing bot and hidden-player wrappers run outside this function.
function drawSpriteLine(p,vdcno,owners){
 const v=p.VDC[vdcno],sp=v.SPLine,satb=v.SATB,reverse=p.ReverseBit16;
 for(let x=0;x<v.ScreenWidth;x++)Object.assign(sp[x],{data:0,palette:0,no:255,priority:0});
 if(!(v.VDCRegister[5]&64))return;
 const line=v.DrawBGYLine-v.VDS-v.VSW+64;let dots=0;
 for(let i=0;i<64;i++){
  const s=i*4,y=satb[s]&1023,attribute=satb[s+3],height=attribute&0x2000?64:attribute&0x1000?32:16;
  if(line<y||line>=y+height)continue;
  let x=(satb[s+1]&1023)-32;const width=((attribute&256)>>4)+16;if(x+width<=0)continue;
  let sy=line-y;if(attribute&0x8000)sy=height-1-sy;
  const index=((satb[s+2]&p.SPAddressMask[width][height])<<5)|((sy&48)<<3)|(sy&15),owner=owners[i],atlas=owner?nativeEnemyAtlas(p,owner.type):null,vram=atlas?.vram??v.VRAM;
  const data=[];
  for(let plane=0;plane<4;plane++){
   const at=index+plane*16;
   data[plane]=attribute&0x800?vram[at]:reverse[vram[at]];
   if(width===32)data[plane]=attribute&0x800?(data[plane]<<16)|vram[(index|64)+plane*16]:data[plane]|reverse[vram[(index|64)+plane*16]]<<16;
  }
  const palette=owner?ENEMY_PALETTE_BASE+(enemyAssetID(owner.type)-1)*256+((attribute&15)<<4):256|((attribute&15)<<4),priority=attribute&128;
  let j=0;if(x<0){j=-x;x=0;}
  for(;j<width&&x<v.ScreenWidth;j++,x++){
   const dot=sp[x];if(!dot.data){const pixel=((data[0]>>>j)&1)|(((data[1]>>>j)&1)<<1)|(((data[2]>>>j)&1)<<2)|(((data[3]>>>j)&1)<<3);if(pixel){dot.data=pixel;dot.palette=palette;dot.priority=priority;}}
   if(dot.no===255)dot.no=i;
   if(i&&dot.no===0)v.VDCStatus|=v.VDCRegister[5]&1;
   if(++dots===256){v.VDCStatus|=v.VDCRegister[5]&2;if(v.SpriteLimit)return;}
  }
 }
}

export function createEnemySpawns(p){
 installCampaignTracker(p);
 const state={stage:null,actors:[],pendingOwners:emptyOwners(),owners:emptyOwners(),drawOwner:null},cpu=p.CPURun,set=p.Set,vdc=p.VDCProcess,sprites=p.MakeSpriteLine,paletteCache=new Map();
 function reset(){Object.assign(state,{stage:null,actors:[],pendingOwners:emptyOwners(),owners:emptyOwners(),drawOwner:null});paletteCache.clear();}
 function palette(asset){
  const raw=p.Palette[0x1cf]&511,fade=7-Math.max((raw>>3)&7,(raw>>6)&7,raw&7),base=ENEMY_PALETTE_BASE+(asset-1)*256;
  if(paletteCache.get(asset)===fade&&p.PaletteData[base])return;
  const source=nativeEnemyAtlas(p,firstType[asset-1]).palette;
  for(let index=0;index<256;index++){
   const value=source[256+index]&511,r=Math.max(0,((value>>3)&7)-fade)*36,g=Math.max(0,((value>>6)&7)-fade)*36,b=Math.max(0,(value&7)-fade)*36,m=r*.299+g*.587+b*.114;
   p.PaletteData[base+index]={r,g,b};p.MonoPaletteData[base+index]={r:m,g:m,b:m};
  }
  paletteCache.set(asset,fade);
 }
 function refreshPalettes(){for(let asset=1;asset<=10;asset++)palette(asset);}
 function register(slot,type){
  if(!isCampaign(p)||!integer(slot,31)||!integer(type,44)||!(p.RAM[0xd98+slot]&128)||p.RAM[0xeb8+slot]!==type)throw new Error('The native enemy is not ready to draw.');
  if(state.stage!==stageID(p))reset();state.stage=stageID(p);state.actors=state.actors.filter(actor=>actor.slot!==slot);state.actors.push({slot,type});palette(enemyAssetID(type));
 }
 p.Set=function(address,value){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  if(physical>=0x1f0000&&physical<0x1f8000){
   if(offset===0x2ae&&value===0)state.pendingOwners=emptyOwners();
   if(offset>=0xd98&&offset<0xdb8&&(value===0||((value&128)&&!this.RAM[offset])))state.actors=state.actors.filter(actor=>actor.slot!==offset-0xd98);
  }
  return set.call(this,address,value);
 };
 p.CPURun=function(){
  const bank=this.MPR[this.PC>>13]>>13,draw=state.drawOwner;
  if(draw&&this.PC===draw.returnPC&&this.S===((draw.stack+2)&255)&&bank===draw.bank)state.drawOwner=null;
  if(bank===8&&[0x7ca2,0x7cae].includes(this.PC))reset();
  if(bank===9&&this.PC===0x83b0&&state.stage!==null&&state.stage!==stageID(this))reset();
  if(bank===9&&this.PC===0x9f04){
   const actor=state.actors.find(actor=>actor.slot===this.X);
   if(actor){const returnPC=((this.RAM[0x100+((this.S+1)&255)]|this.RAM[0x100+((this.S+2)&255)]<<8)+1)&65535,type=this.RAM[0xeb8+actor.slot];state.drawOwner={slot:actor.slot,type:type<45?type:actor.type,stack:this.S,returnPC,bank:this.MPR[returnPC>>13]>>13};}else state.drawOwner=null;
  }
  if(bank===0&&this.PC===0xe8de&&this.RAM[0x2ae]<64){const owner=state.drawOwner;state.pendingOwners[this.RAM[0x2ae]]=owner?{slot:owner.slot,type:owner.type}:null;}
  return cpu.call(this);
 };
 p.VDCProcess=function(n){const before=this.VDC[n].VRAMtoSATBCount,result=vdc.call(this,n);if(n===0&&this.VDC[n].VRAMtoSATBCount>before)state.owners=state.pendingOwners.map(owner=>owner&&{...owner});return result;};
 p.MakeSpriteLine=function(n){
  if(n!==0||!state.owners.some(Boolean))return sprites.call(this,n);
  for(const asset of new Set(state.owners.filter(Boolean).map(owner=>enemyAssetID(owner.type))))palette(asset);
  return drawSpriteLine(this,n,state.owners);
 };
 const controller={state,register,reset,restore(data){validateEnemySpawns(data);Object.assign(state,structuredClone(data));paletteCache.clear();refreshPalettes();}};
 p._enemySpawns=controller;return controller;
}
