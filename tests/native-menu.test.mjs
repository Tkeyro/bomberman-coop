import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {installNativeMenu,TITLE_SEQUENCE} from '../dist/native-menu.js';
import {launchSequence,activeBattle} from '../dist/battle-ai.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function title(p){for(const a of TITLE_SEQUENCE)frames(p,a.frames,a.button?[[0,a.button]]:[]);}
test('native title font and five-row cursor replace old labels without changing game memory',{skip:!rom},()=>{
 const bytes=fs.readFileSync(rom),p=createMachine(bytes),reference=createMachine(bytes);let chosen;
 const menu=installNativeMenu(p,{onSelect:(mode,count)=>chosen={mode,count}});title(p);title(reference);menu.open(2);
 // Observe final pixels and compare native CPU state with an unmodified title.
 frames(p,1);frames(reference,1);assert.deepEqual(p.RAM,reference.RAM);assert.deepEqual(p.VDC[0].VRAM,reference.VDC[0].VRAM);assert.deepEqual(p.VDC[0].SATB,reference.VDC[0].SATB);assert.deepEqual(p.Palette,reference.Palette);
 const width=p.ImageData.data.length/4/262;
 for(let y=17;y<128;y++)assert.deepEqual(p.ImageData.data.slice(y*width*4,(y+1)*width*4),reference.ImageData.data.slice(y*width*4,(y+1)*width*4),'title artwork remains native');
 // Decode the expected string's loaded ROM glyphs and verify actual white ink pixels.
 function checkLabel(text,y,white=true){
  for(let i=0;i<text.length;i++)for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
   const tile=0x200+text.charCodeAt(i),a=p.VDC[0].VRAM[tile*16+dy],b=p.VDC[0].VRAM[tile*16+dy+8],bit=7-dx;
   const dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
   if(dot){const at=((y+dy)*width+64+i*8+dx)*4,rgb=p.ImageData.data.slice(at,at+3);assert.deepEqual([...rgb],white?[252,252,252]:[216,180,216],`${text}, glyph ${i}, ${dx}/${dy}`);}
  }
 }
 checkLabel('1P - SOLO',138);checkLabel('2-5P - CAMPAIGN',154);checkLabel('2-5P - BATTLE (ONLINE)',170,false);checkLabel('2-5P - BATTLE (A.I)',186);checkLabel('LOAD SAVE',202,false);
 menu.setSave(true);menu.input('UP');frames(p,1);checkLabel('LOAD SAVE',202);menu.input('RUN');assert.deepEqual(chosen,{mode:'load',count:2});
 const redAt=y=>{let n=0;for(let yy=y;yy<y+16;yy++)for(let x=46;x<60;x++){const at=(yy*width+x)*4;if(p.ImageData.data[at]>200&&p.ImageData.data[at+1]<60&&p.ImageData.data[at+2]<60)n++;}return n;};
 assert.ok(redAt(202)>0,'fifth row has the original red cursor');assert.equal(redAt(138),0);
 menu.input('DOWN');menu.input('DOWN');menu.input('RIGHT');menu.input('RIGHT');menu.input('RIGHT');menu.input('RIGHT');assert.equal(menu.count,5);menu.input('RUN');assert.deepEqual(chosen,{mode:'campaign',count:5});
 menu.close();frames(p,1);frames(reference,2);assert.deepEqual(p.RAM,reference.RAM);assert.deepEqual(p.ImageData.data,reference.ImageData.data,'closing restores the original title rendering');
});
test('native-menu selection launches the original Solo intro and 2/5-player Battle',{skip:!rom},()=>{
 for(const [mode,count]of [['solo',2],['battle-ai',2],['battle-ai',5]]){
  const p=createMachine(fs.readFileSync(rom)),menu=installNativeMenu(p);title(p);menu.open(count);frames(p,1);menu.close();
  for(const a of launchSequence(mode,count).slice(3))frames(p,a.frames,a.button?[[0,a.button]]:[]);
  if(mode==='solo'){frames(p,720);assert.equal(p.VDC[0].SATB[2],792,'original rear-facing introduction remains');}
  else{assert.equal(activeBattle(p),true);assert.equal(p.RAM[0x4a],count);}
 }
});
test('gamepad menu input is consumed before native C-Link/password selection',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom));let selected;const menu=installNativeMenu(p,{onSelect:mode=>selected=mode});title(p);menu.open();
 const original=globalThis.navigator;let buttons=Array.from({length:17},()=>({pressed:false,value:0}));
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[{mapping:'standard',buttons,axes:[0,0]}]}});
 try{buttons[13]={pressed:true,value:1};frames(p,1);assert.equal(menu.selected,1);frames(p,5);assert.equal(menu.selected,1);buttons[13]={pressed:false,value:0};frames(p,1);buttons[9]={pressed:true,value:1};frames(p,1);assert.equal(selected,'campaign');assert.equal(p.VDC[0].SATB[0],195,'native menu selection stays on Solo until launch');}
 finally{Object.defineProperty(globalThis,'navigator',{configurable:true,value:original});}
});
