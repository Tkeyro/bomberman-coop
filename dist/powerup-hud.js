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
  const result=[];let row=[],width=0;
  for(let type=0;type<15;type++)if(state.counts[type]){
   const count=String(state.counts[type]),cell=Math.max(16,count.length*8)+6;
   if(row.length&&width+cell>88){result.push(row);row=[];width=0;}
   row.push({type,count,x:160+width,width:cell-6});width+=cell;
  }
  if(row.length)result.push(row);return result;
 }
 p.MakeBGLine=function(n){
  bg.call(this,n);if(n!==0||!active())return;
  const v=this.VDC[0],y=v.DrawBGYLine-(v.VDS+v.VSW);
  if(y<8||y>=32)return;
  const left=((v.HDS+v.HSW)<<3)+v.DrawBGIndex;
  // Restrict composition to the old HI label/number. Score, clock, lives,
  // borders outside this rectangle and every arena pixel remain native.
  for(let x=160;x<248;x++)v.BGLine[left+x]=0x100;
  const choices=pages(),row=choices[Math.floor(state.tick/PAGE_FRAMES)%choices.length]??[];
  for(const entry of row){
   if(y<24){
    const origin=entry.x+Math.floor((entry.width-16)/2);
    for(let x=0;x<16;x++)v.BGLine[left+origin+x]=iconIndex(v,entry.type,x,y-8);
   }else{
    const origin=entry.x+Math.floor((entry.width-entry.count.length*8)/2);
    for(let letter=0;letter<entry.count.length;letter++)for(let x=0;x<8;x++)if(pixel(v,0x200+entry.count.charCodeAt(letter),x,y-24))v.BGLine[left+origin+letter*8+x]=0xb2;
   }
  }
 };
 return {
  state,
  configure(enabled){state.enabled=Boolean(enabled);state.counts.fill(0);state.tick=0;},
  update(){if(active())state.tick=(state.tick+1)%TICK_LIMIT;},
  restore(data){if(data===undefined){state.counts.fill(0);state.tick=0;return;}validatePowerupHUD(data);Object.assign(state,structuredClone(data));}
 };
}
