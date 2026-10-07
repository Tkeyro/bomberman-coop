import {ITEM_CATALOG,installCampaignTracker,isCampaign,playerPosition} from './campaign.js';

const MAX_COUNT=1000000,PAGE_FRAMES=240,TICK_LIMIT=PAGE_FRAMES*15;
const ITEM_PALETTES=[12,12,13,12,12,13,13,12,12,12,12,12,13,12,12];
const typeValid=type=>Number.isInteger(type)&&type>=0&&type<15;

// Decode only the patterns currently loaded by the player's ROM. No icon or
// font bitmap is packaged with the extension.
function pixel(v,tile,x,y){
 const address=(tile<<4)+(y&7),bit=7-(x&7),a=v.VRAM[address],b=v.VRAM[address+8];
 return ((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
}
function iconIndex(v,type,x,y){
 const tile=0x400+(type>>3)*32+(type&7)*2+(x>>3)+(y>>3)*16;
 return ITEM_PALETTES[type]*16+pixel(v,tile,x,y);
}
export function powerupIcon(p,type){
 if(!typeValid(type))throw new Error('Unknown power-up icon.');
 const data=new Uint8ClampedArray(16*16*4),v=p.VDC[0];
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const index=(y*16+x)*4,rgb=p.PaletteData[iconIndex(v,type,x,y)];
  data[index]=rgb.r;data[index+1]=rgb.g;data[index+2]=rgb.b;data[index+3]=255;
 }
 return {width:16,height:16,data};
}
export function createPowerupBadge(p,type,count,{document=globalThis.document}={}){
 if(!typeValid(type)||!Number.isSafeInteger(count)||count<1||count>MAX_COUNT)throw new Error('Invalid power-up badge.');
 const badge=document.createElement('span'),canvas=document.createElement('canvas'),label=document.createElement('span');
 badge.className='powerup-badge';canvas.width=canvas.height=16;canvas.setAttribute('aria-hidden','true');
 const context=canvas.getContext('2d'),decoded=powerupIcon(p,type),image=context.createImageData(16,16);image.data.set(decoded.data);context.putImageData(image,0,0);
 label.textContent=`${ITEM_CATALOG[type].name} ×${count}`;badge.append(canvas,label);return badge;
}
export function validatePowerupHUD(data){
 if(!data||Object.keys(data).some(key=>!['enabled','counts','tick'].includes(key))||typeof data.enabled!=='boolean'||!Array.isArray(data.counts)||data.counts.length!==15||data.counts.some(count=>!Number.isSafeInteger(count)||count<0||count>MAX_COUNT)||!Number.isInteger(data.tick)||data.tick<0||data.tick>=TICK_LIMIT)throw new Error('Invalid power-up HUD state in save.');
}
export function createPowerupHUD(p,{getHuman=()=>playerPosition(p)}={}){
 installCampaignTracker(p);
 const state={enabled:false,counts:Array(15).fill(0),tick:0},set=p.Set,bg=p.MakeBGLine;
 const active=()=>state.enabled&&getHuman()!==null&&isCampaign(p)&&!p._spectator?.enabled&&!p._newCampaign?.transition&&!p._spectator?.transition;
 p.Set=function(address,value){
  const physical=this.MPR[address>>13]|(address&8191),offset=physical&8191;
  // This bank-9 instruction clears an item only after the primary character's
  // native pickup check succeeds. Fire destruction and bot pickups use other
  // paths, so neither can inflate the primary player's totals.
  if(physical>=0x1f0000&&physical<0x1f8000&&offset>=0xf9b&&offset<0xfb4&&value===0&&this.PC===0x8750&&this.MPR[4]===9*8192&&active()){
   const flag=this.RAM[offset],slot=offset-0xf9b,type=flag&31,human=getHuman();
   if((flag&128)&&typeValid(type)&&human&&Math.floor(human.x/16)===this.RAM[0xfb4+slot]&&Math.floor(human.y/16)===this.RAM[0xfcd+slot])state.counts[type]=Math.min(MAX_COUNT,state.counts[type]+1);
  }
  return set.call(this,address,value);
 };
 function pages(){
  const result=[];let page=[],row=0,width=0;
  for(let type=0;type<15;type++)if(state.counts[type]){
   const count=String(state.counts[type]),cell=12+count.length*4;
   if(width+cell>136){width=0;if(++row===2){result.push(page);page=[];row=0;}}
   page.push({type,count,x:112+width,y:10+row*11});width+=cell;
  }
  if(page.length)result.push(page);return result;
 }
 p.MakeBGLine=function(n){
  bg.call(this,n);if(n!==0||!active())return;
  const v=this.VDC[0],y=v.DrawBGYLine-(v.VDS+v.VSW);
  if(y<9||y>=31)return;
  const left=((v.HDS+v.HSW)<<3)+v.DrawBGIndex,original=v.BGLine.slice();
  function nativeLine(sourceY){
   const line=v.DrawBGLine,screenY=v.DrawBGYLine,destination=v.BGLine.slice();
   try{v.DrawBGLine=sourceY;v.DrawBGYLine=sourceY+v.VDS+v.VSW;bg.call(this,n);return v.BGLine.slice();}
   finally{v.DrawBGLine=line;v.DrawBGYLine=screenY;for(let x=0;x<destination.length;x++)v.BGLine[x]=destination[x];}
  }
  // Keep SC and all four outer border edges. Rearrange only the header's
  // interior, leaving every arena pixel and loaded pattern unchanged.
  for(let x=16;x<248;x++)v.BGLine[left+x]=0x100;
  // Copy the inherited compositor's head, including the isolated selected-
  // color palette, rather than reconstructing its colors or modifying VRAM.
  for(let x=0;x<24;x++)v.BGLine[left+80+x]=original[left+136+x];
  const base=2*v.VScreenWidth+((v.VDCRegister[7]>>3)&(v.VScreenWidth-1));
  const numberTile=ref=>(ref&4095)>=0x291&&(ref&4095)<=0x29a;
  const score=v.VRAM.slice(base+2,base+11).filter(numberTile);if(!score.length)score.push(0xb291);
  if(y>=10&&y<18){
   const width=Math.min(8,Math.floor(56/score.length));
   for(let letter=0;letter<score.length;letter++)for(let x=0;x<width;x++)v.BGLine[left+20+letter*width+x]=((score[letter]&0xf000)>>8)|pixel(v,score[letter]&4095,Math.floor(x*8/width),y-10);
  }
  function digits(value,x,top,width=4){
   if(y<top||y>=top+8)return;
   for(let letter=0;letter<value.length;letter++)for(let dx=0;dx<width;dx++)if(pixel(v,0x291+Number(value[letter]),Math.floor(dx*8/width),y-top)===2)v.BGLine[left+x+letter*width+dx]=0xb2;
  }
  if(y>=18&&y<30){
   const clock=nativeLine.call(this,8+(y-18)*2);
   for(let x=0;x<8;x++)v.BGLine[left+20+x]=clock[left+88+x*2];
  }
  if(y>=21&&y<29){
   const time=nativeLine.call(this,16+y-21);
   for(let x=0;x<32;x++)v.BGLine[left+32+x]=time[left+104+x];
  }
  const choices=pages(),page=choices[Math.floor(state.tick/PAGE_FRAMES)%choices.length]??[];
  for(const entry of page)if(y>=entry.y&&y<entry.y+8){
   // Only HUD samples shrink. Full-size world items and badge art retain the
   // exact native 16x16 pixels exported by powerupIcon.
   for(let x=0;x<8;x++)v.BGLine[left+entry.x+x]=iconIndex(v,entry.type,x*2,(y-entry.y)*2);
   digits(entry.count,entry.x+9,entry.y,4);
   }
 };
 return {
  state,
  configure(enabled){state.enabled=Boolean(enabled);state.counts.fill(0);state.tick=0;},
  update(){if(active())state.tick=(state.tick+1)%TICK_LIMIT;},
  restore(data){if(data===undefined){state.counts.fill(0);state.tick=0;return;}validatePowerupHUD(data);Object.assign(state,structuredClone(data));}
 };
}
