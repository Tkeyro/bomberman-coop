import {enemies,isCampaign} from './campaign.js';

// Native animation pointers and sprite-stream records stay in the user's ROM.
// No bitmap, palette or ROM bytes are included in this module.
const NORMAL_ENEMY_COUNT=23;
const LIVING_MODEL_COUNT=45;
const ASSET_BY_TYPE=[1,1,2,2,3,3,4,4,5,5,2,2,3,3,4,4,5,5,1,1,1,1,1,6,6,6,6,7,7,9,9,8,8,8,10,10,10,10,10,10,10,10,10,10,10];
const assetCache=new WeakMap();
const readROM=(p,bank,address)=>p.Mapper.Read(bank*8192+(address&8191));
const wordROM=(p,bank,address)=>readROM(p,bank,address)|(readROM(p,bank,address+1)<<8);
const signed=byte=>byte<128?byte:byte-256;
const size=attribute=>({width:attribute&0x100?32:16,height:attribute&0x2000?64:attribute&0x1000?32:16});

export function nativeEnemyPose(p,type,direction=0,frame=0){
 if(!Number.isInteger(type)||type<0||type>=LIVING_MODEL_COUNT||!Number.isInteger(direction)||direction<0||direction>3||!Number.isInteger(frame)||frame<0||frame>3)throw new Error('Unknown native enemy pose.');
 const directions=wordROM(p,12,0x4de6+type*2),animation=wordROM(p,12,directions+direction*2),pointer=wordROM(p,12,animation+frame*2),count=readROM(p,12,pointer),bomberman=type===34||(type>=36&&type<=40),paletteBase=bomberman?({37:2,38:1,39:3,40:6}[type]??0):readROM(p,9,0x9f86+type);
 if(count<1||count>16)throw new Error('The native enemy model is not available.');
 const sprites=[];
 for(let i=0;i<count;i++){
  const offset=pointer+1+i*4,x=signed(readROM(p,12,offset)),y=signed(readROM(p,12,offset+1)),pattern=(bomberman?640:768)+readROM(p,12,offset+2)*2,flags=readROM(p,12,offset+3);
  // The native stream packs VDC size/flip bits into its fourth byte.
  const attribute=((paletteBase+(flags&7))&15)|0x80|((flags&0x80)<<8)|((flags&0x60)<<7)|((flags&0x10)<<7)|((flags&8)<<5);
  sprites.push({x,y,pattern,attribute});
 }
 return sprites;
}

// The ROM's graphics loader uses MSB-first LZSS with an overlapping 256-byte
// ring. Decode privately at runtime; never upload or persist the result.
export function decodeNativeAsset(p,bank,id,length){
 if(!Number.isInteger(length)||length<0||length>16384)throw new Error('Invalid native graphics length.');
 const pointer=wordROM(p,bank,id*2+0x4000),start=bank*8192+((pointer-0x4000)&65535),ring=new Uint8Array(256).fill(0x20),output=new Uint8Array(length);let bit=start*8,cursor=0xef,index=0;
 const take=count=>{let value=0;for(let i=0;i<count;i++,bit++)value=(value<<1)|((p.Mapper.Read(bit>>3)>>(7-(bit&7)))&1);return value;};
 const push=value=>{ring[cursor]=value;cursor=(cursor+1)&255;if(index<length)output[index++]=value;};
 while(index<length){if(take(1))push(take(8));else{const source=take(8),count=take(4)+2;for(let i=0;i<count;i++)push(ring[(source+i)&255]);}}
 return output;
}

export function nativeEnemyAtlas(p,type){
 if(!Number.isInteger(type)||type<0||type>=LIVING_MODEL_COUNT)throw new Error('Unknown native enemy model.');
 let cache=assetCache.get(p.Mapper);if(!cache){cache=new Map();assetCache.set(p.Mapper,cache);}
 const asset=ASSET_BY_TYPE[type];if(cache.has(asset))return cache.get(asset);
 const atlas={vram:new Uint16Array(65536),palette:new Uint16Array(512)};
 for(const record of asset===10?[0,1,10,11]:[0,1,asset]){
  const pointer=wordROM(p,0,0xf09d+record*2),metadata=Array.from({length:8},(_,i)=>readROM(p,0,pointer+i)),graphics=decodeNativeAsset(p,16,metadata[0],metadata[4]*128),colors=decodeNativeAsset(p,14,metadata[5],metadata[7]*32),destination=((metadata[1]*16+32)<<8)+metadata[2]+(metadata[3]<<8);
  for(let i=0;i<graphics.length;i+=2)atlas.vram[destination+(i>>1)]=graphics[i]|graphics[i+1]<<8;
  for(let i=0;i<colors.length;i+=2)atlas.palette[metadata[6]*16+(i>>1)]=colors[i]|colors[i+1]<<8;
 }
 cache.set(asset,atlas);return atlas;
}

export function decodeSpriteIcon(p,sprites,{vram=p.VDC[0].VRAM,palette=p.Palette}={}){
 if(!sprites.length)throw new Error('The native enemy model is not available.');
 const left=Math.min(...sprites.map(s=>s.x)),top=Math.min(...sprites.map(s=>s.y)),width=Math.max(...sprites.map(s=>s.x+size(s.attribute).width))-left,height=Math.max(...sprites.map(s=>s.y+size(s.attribute).height))-top;
 if(width<1||height<1||width>128||height>128)throw new Error('The native enemy model is too large.');
 const pixels=new Uint8ClampedArray(width*height*4);
 for(const sprite of sprites){
  const dimensions=size(sprite.attribute),mask=p.SPAddressMask[dimensions.width][dimensions.height],base=(sprite.pattern&mask)<<5;
  for(let y=0;y<dimensions.height;y++)for(let x=0;x<dimensions.width;x++){
   const sx=sprite.attribute&0x800?dimensions.width-1-x:x,sy=sprite.attribute&0x8000?dimensions.height-1-y:y,index=base|((sy&0x30)<<3)|(sy&15)|((sx&0x10)<<2),bit=15-(sx&15);
   const dot=((vram[index]>>bit)&1)|(((vram[index+16]>>bit)&1)<<1)|(((vram[index+32]>>bit)&1)<<2)|(((vram[index+48]>>bit)&1)<<3);
   if(!dot)continue;
   const address=((sprite.y-top+y)*width+sprite.x-left+x)*4;
   if(pixels[address+3])continue; // SATB priority: the first nonzero sprite wins.
   const color=palette[256+((sprite.attribute&15)<<4)+dot]&511;
   pixels[address]=((color>>3)&7)*36;pixels[address+1]=((color>>6)&7)*36;pixels[address+2]=(color&7)*36;pixels[address+3]=255;
  }
 }
 if(!pixels.some((value,index)=>index%4===3&&value))throw new Error('The native enemy graphics are not loaded.');
 return {width,height,pixels};
}

export function enemyCatalog(p){
 if(!isCampaign(p))return [];
 const templates=new Map();for(const enemy of enemies(p))if(enemy.type<NORMAL_ENEMY_COUNT&&!templates.has(enemy.type))templates.set(enemy.type,enemy.slot);
 return Array.from({length:LIVING_MODEL_COUNT},(_,type)=>{
  const templateSlot=templates.get(type),boss=type>=NORMAL_ENEMY_COUNT;let icon=null;try{icon=decodeSpriteIcon(p,nativeEnemyPose(p,type),templateSlot!==undefined?undefined:nativeEnemyAtlas(p,type));}catch{}
  const available=!boss&&templateSlot!==undefined&&icon!==null;
  return {type,name:type===2?'Ballom':boss?`Boss model ${type}`:`Monster type ${type}`,templateSlot,available,icon,notice:available?'Spawn in this stage':boss?'Boss / form preview only':icon?'No living template in this stage':'Native graphics are not loaded'};
 });
}

export function createEnemyCard(p,entry,{document=globalThis.document,onSpawn=()=>{}}={}){
 const button=document.createElement('button');button.className='enemy-card';button.type='button';button.disabled=!entry.available;button.setAttribute('aria-label',`${entry.name}. ${entry.notice}.`);
 const preview=document.createElement('span');preview.className='enemy-preview';
 if(entry.icon){
  const canvas=document.createElement('canvas');canvas.className='enemy-icon';canvas.width=entry.icon.width;canvas.height=entry.icon.height;canvas.setAttribute('aria-hidden','true');
  const context=canvas.getContext?.('2d');if(context){const data=context.createImageData(entry.icon.width,entry.icon.height);data.data.set(entry.icon.pixels);context.putImageData(data,0,0);}
  preview.append(canvas);
 }
 const name=document.createElement('strong');name.textContent=entry.name;const notice=document.createElement('span');notice.className='enemy-notice';notice.textContent=entry.notice;
 button.append(preview,name,notice);if(entry.available)button.addEventListener('click',onSpawn);return button;
}
