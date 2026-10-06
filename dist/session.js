export const ROM_SHA256 = 'b9f98ce3d8b8baf1c6d02c2c0af72f8c0c554e533f13deb8f389853fe33bbf9e';
export async function verifyROM(bytes) {
  if (bytes.byteLength !== 262144) throw new Error('This build requires the 256 KiB Bomberman (USA) .pce file.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
  if (hex !== ROM_SHA256) throw new Error('This file does not match the verified Bomberman (USA) revision.');
  return hex;
}
export const COLORS = {original:[252,252,252],black:[56,56,64],blue:[0,108,252],green:[36,180,0],red:[252,0,0],violet:[198,72,252],orange:[252,144,0],yellow:[252,216,0]};
const SUIT_SHADES={2:.55,3:1,4:.78,5:1,8:.86,9:.71,10:.57,11:.86,13:.57,14:1,15:1};
export function colorizePlayer(rgb,index,color,fade=1) {
 if(color==='original'||!Object.hasOwn(SUIT_SHADES,index))return {...rgb};
 const base=color==='red'&&index===5?[0,180,36]:COLORS[color];
 return Object.fromEntries(['r','g','b'].map((channel,i)=>[channel,Math.round(base[i]*SUIT_SHADES[index]*fade)]));
}
// Palette 12 belongs to Bomberman throughout the intro and campaign, including
// rear-facing pattern 792. Preparing it before visibility avoids a white flash.
export function installColorSelector(pce) {
 let selected='original',battleColors=[];
 const convert=pce.ToPalettes.bind(pce);
 function colorFor(address){
  const palette=address>>4;
  if(palette===28)return selected;
  if(pce.RAM?.[0x84a]===8&&palette>=16&&palette<21)return battleColors[palette-16]??(palette===16?selected:null);
  return null;
 }
 pce.ToPalettes=()=>{
  convert();const address=pce.VCEAddress,color=colorFor(address);if(color===null)return;
  const index=address&15;
  const source=(address>>4)===28?0x1c0:0x100;
  const raw=pce.Palette[source+index],rgb={r:((raw>>3)&7)*36,g:((raw>>6)&7)*36,b:(raw&7)*36};
  const white=pce.Palette[source+15],fade=Math.max((white>>3)&7,(white>>6)&7,white&7)/7;
  const themed=colorizePlayer(rgb,index,color,fade);
  Object.assign(pce.PaletteData[address],themed);
  const mono=themed.r*.299+themed.g*.587+themed.b*.114;
  Object.assign(pce.MonoPaletteData[address],{r:mono,g:mono,b:mono});
 };
 function refresh(){const saved=pce.VCEAddress;for(const base of [0x1c0,...(pce.RAM?.[0x84a]===8?[0x100,0x110,0x120,0x130,0x140]:[])])for(let i=0;i<16;i++){pce.VCEAddress=base+i;pce.ToPalettes();}pce.VCEAddress=saved;}
 return {select(color){if(!Object.hasOwn(COLORS,color))throw new Error('Unknown Bomberman color.');selected=color;if(battleColors.length)battleColors[0]=color;refresh();},setBattleColors(values){if(values.some(c=>!Object.hasOwn(COLORS,c)))throw new Error('Unknown battle color.');battleColors=[...values];refresh();},refresh,get selected(){return selected;},get battleColors(){return [...battleColors];}};
}
export const KEY_BINDINGS = {
  ArrowUp:[0,'UP'], KeyW:[0,'UP'], ArrowDown:[0,'DOWN'], KeyS:[0,'DOWN'],
  ArrowLeft:[0,'LEFT'], KeyA:[0,'LEFT'], ArrowRight:[0,'RIGHT'], KeyD:[0,'RIGHT'],
  Space:[0,'SHOT1'], KeyX:[0,'SHOT2'], Enter:[0,'RUN'], ShiftLeft:[0,'SELECT'], ShiftRight:[0,'SELECT'],
  KeyI:[1,'UP'], KeyK:[1,'DOWN'], KeyJ:[1,'LEFT'], KeyL:[1,'RIGHT'],
  KeyO:[1,'SHOT1'], KeyP:[1,'SHOT2'], Digit2:[1,'RUN'], Digit1:[1,'SELECT']
};
export function traceWrites(pce, max = 20000) {
  const original = pce.Set, records = [];
  let dropped = 0;
  pce.Set = function(address,value) {
    const physical = this.MPR[address >> 13] | (address & 8191);
    if (physical >= 0x1f0000 && physical < 0x1f8000) {
      const offset = physical & 8191;
      if (offset >= 0x430 && offset < 0x480 && this.RAM[offset] !== value) {
        if (records.length < max) records.push({offset,before:this.RAM[offset],value,pc:this.PC,bank:this.MPR[this.PC >> 13] >> 13});
        else dropped++;
      }
    }
    return original.call(this,address,value);
  };
  return { finish() { pce.Set = original; return {records,dropped}; } };
}
