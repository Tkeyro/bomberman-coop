import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {installNativeMenu,TITLE_SEQUENCE,MENU_OPTIONS} from '../dist/native-menu.js';
import {launchSequence,activeBattle} from '../dist/battle-ai.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function title(p){for(const a of TITLE_SEQUENCE)frames(p,a.frames,a.button?[[0,a.button]]:[]);}
test('DLC defaults to one player and retains explicitly selected counts and spectators',()=>{
 const p={MakeBGLine(){},MakeSpriteLine(){},CheckGamePad(){}},menu=installNativeMenu(p);
 menu.open(5);menu.input('DOWN');assert.equal(menu.count,1);menu.input('RIGHT');menu.input('RIGHT');assert.equal(menu.count,3);menu.input('UP');menu.input('DOWN');assert.equal(menu.count,3);
 menu.open(2);menu.setCount(5);menu.input('DOWN');assert.equal(menu.count,5,'an explicit player selection takes priority over the default');
 menu.open(-3);menu.input('DOWN');assert.equal(menu.count,-3,'watch selection remains available');
});
test('native five-row menu, world picker and AI/ONLINE pages preserve native game memory',{skip:!rom},()=>{
 const bytes=fs.readFileSync(rom),p=createMachine(bytes),reference=createMachine(bytes);let chosen;
 const menu=installNativeMenu(p,{onSelect:(mode,options)=>chosen={mode,options}});title(p);title(reference);menu.open(2);
 assert.deepEqual(MENU_OPTIONS.map(({label})=>label),['1P - CAMPAIGN','1P - DLC','2-5P - CAMPAIGN','2-5P - BATTLE','LOAD SAVE']);
 const render=()=>{frames(p,1);frames(reference,1);};
 // Observe final pixels and compare native CPU state with an unmodified title.
 render();assert.deepEqual(p.RAM,reference.RAM);assert.deepEqual(p.VDC[0].VRAM,reference.VDC[0].VRAM);assert.deepEqual(p.VDC[0].SATB,reference.VDC[0].SATB);assert.deepEqual(p.Palette,reference.Palette);
 const width=p.ImageData.data.length/4/262;
 for(let y=17;y<128;y++)assert.deepEqual(p.ImageData.data.slice(y*width*4,(y+1)*width*4),reference.ImageData.data.slice(y*width*4,(y+1)*width*4),'title artwork remains native');
 let copyrightPixels=0;
 for(let y=226;y<234;y++)for(let x=48;x<272;x++){
  const at=(y*width+x)*4;
  assert.deepEqual([...p.ImageData.data.slice(at,at+3)],[...reference.ImageData.data.slice(((y+8)*width+x)*4,((y+8)*width+x)*4+3)],'the vacated text band uses clean native water background');
  if([0,1,2].every(c=>reference.ImageData.data[at+c]===252)){
   copyrightPixels++;assert.ok([0,1,2].some(c=>p.ImageData.data[at+c]!==252),'old copyright ink is removed');
   const moved=((y+8)*width+x)*4;assert.deepEqual([...p.ImageData.data.slice(moved,moved+3)],[252,252,252],'original copyright pixels move down eight pixels');
  }
 }assert.ok(copyrightPixels>300);
 // Decode the expected string's loaded ROM glyphs and verify actual white ink pixels.
 function checkLabel(text,y,white=true){
  for(let i=0;i<text.length;i++)for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
   const tile=0x200+text.charCodeAt(i),a=p.VDC[0].VRAM[tile*16+dy],b=p.VDC[0].VRAM[tile*16+dy+8],bit=7-dx;
   const dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
   if(dot){const at=((y+dy)*width+64+i*8+dx)*4,rgb=p.ImageData.data.slice(at,at+3);assert.deepEqual([...rgb],white?[252,252,252]:[216,180,216],`${text}, glyph ${i}, ${dx}/${dy}`);}
  }
 }
 checkLabel('1P - CAMPAIGN',130);checkLabel('1P - DLC',144);checkLabel('2-5P - CAMPAIGN',158);checkLabel('2-5P - BATTLE',172);checkLabel('LOAD SAVE',186,false);
 menu.setSave(true);menu.input('UP');render();checkLabel('LOAD SAVE',186);menu.input('RUN');assert.deepEqual(chosen,{mode:'load',options:{count:2}});
 const redAt=y=>{let n=0;for(let yy=y;yy<y+16;yy++)for(let x=46;x<60;x++){const at=(yy*width+x)*4;if(p.ImageData.data[at]>200&&p.ImageData.data[at+1]<60&&p.ImageData.data[at+2]<60)n++;}return n;};
 assert.ok(redAt(186)>0,'fifth row has the original red cursor');assert.equal(redAt(130),0);
 menu.input('DOWN');chosen=null;menu.input('RUN');assert.equal(menu.state.page,'solo');assert.equal(chosen,null,'opening the controller submenu does not launch yet');render();checkLabel('HUMAN',130);checkLabel('AI',144);
 menu.input('RUN');assert.equal(menu.state.page,'worlds');assert.equal(chosen,null,'opening the picker does not launch yet');render();
 for(let world=0;world<8;world++)checkLabel(`${world+1}-0`,130+world*11);
 for(let n=0;n<7;n++)menu.input('DOWN');assert.equal(menu.state.world,7);menu.input('RUN');assert.deepEqual(chosen,{mode:'solo',options:{count:1,world:7}});
 menu.input('SHOT2');assert.equal(menu.state.page,'solo');assert.equal(menu.selected,0,'Button II restores the Human choice');
 menu.input('DOWN');assert.equal(menu.count,-1);menu.input('RUN');assert.equal(menu.state.page,'worlds');menu.input('DOWN');menu.input('RUN');assert.deepEqual(chosen,{mode:'solo',options:{count:-1,world:1}},'single-player AI watches one autonomous bot in the selected native world');
 menu.input('BACK');assert.equal(menu.state.page,'solo');assert.equal(menu.selected,1,'Back restores the AI choice');menu.input('BACK');assert.equal(menu.state.page,'main');assert.equal(menu.selected,0,'the nested submenu then returns to the main Campaign choice');
 menu.input('DOWN');menu.input('LEFT');assert.equal(menu.count,1);menu.input('RUN');assert.deepEqual(chosen,{mode:'new',options:{count:1}});
 for(let n=0;n<4;n++)menu.input('RIGHT');assert.equal(menu.count,5);
 for(const bots of [1,2,3,4]){menu.input('RIGHT');assert.equal(menu.count,-bots);}render();checkLabel('WATCH: 4 AI  LEFT/RIGHT',218,false);menu.input('RUN');assert.deepEqual(chosen,{mode:'new',options:{count:-4}});
 menu.input('DOWN');menu.input('RUN');assert.equal(menu.state.page,'campaign');render();checkLabel('AI',130);checkLabel('ONLINE',144);menu.input('RUN');assert.deepEqual(chosen,{mode:'campaign',options:{count:-4}});
 menu.input('DOWN');assert.equal(menu.count,2,'online rooms cannot inherit AI-only counts');menu.input('RUN');assert.deepEqual(chosen,{mode:'online-campaign',options:{count:2}});
 menu.setCount(-3);assert.equal(menu.count,2);for(let n=0;n<3;n++)menu.input('RIGHT');assert.equal(menu.count,5);menu.input('LEFT');assert.equal(menu.count,4);
 menu.input('BACK');assert.equal(menu.selected,2);menu.input('DOWN');menu.input('RUN');assert.equal(menu.state.page,'battle');menu.input('RUN');assert.deepEqual(chosen,{mode:'battle-ai',options:{count:4}});menu.input('DOWN');menu.input('RUN');assert.deepEqual(chosen,{mode:'online-battle',options:{count:4}});
 menu.input('BACK');menu.pointer(130);assert.equal(menu.state.page,'solo');menu.pointer(130);assert.equal(menu.state.page,'worlds');menu.pointer(130+3*11);assert.deepEqual(chosen,{mode:'solo',options:{count:1,world:3}});menu.input('BACK');menu.input('BACK');menu.pointer(186);assert.deepEqual(chosen,{mode:'load',options:{count:4}});
 menu.close();render();assert.deepEqual(p.RAM,reference.RAM);assert.deepEqual(p.ImageData.data,reference.ImageData.data,'closing restores the original title rendering');
});
test('idle main/controller/world menus never enter the native attract demo',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),reference=createMachine(fs.readFileSync(rom)),menu=installNativeMenu(p);title(p);title(reference);menu.open(2);
 // The original timer has 1075 frames left at this point. Wait through several
 // full native demo timeouts on each nested page; title artwork stays loaded.
 for(const page of ['main','solo','worlds']){
  if(page!=='main')menu.input('RUN');
  const artwork=p.VDC[0].VRAM.slice(0x4000,0x6000),models=p.VDC[0].VRAM.slice(0x7000,0x8000);
  frames(p,2401);assert.equal(menu.active,true);assert.equal(menu.state.page,page);assert.equal(p.VDC[0].SATB[2],918,'the native title cursor remains loaded');
  assert.deepEqual(p.VDC[0].VRAM.slice(0x4000,0x6000),artwork);assert.deepEqual(p.VDC[0].VRAM.slice(0x7000,0x8000),models,'demo suppression never replaces native models');
  assert.ok(p.RAM[0x13b8]|p.RAM[0x13b9]<<8,'the title countdown stays live');
 }
 frames(reference,1500);assert.notEqual(reference.VDC[0].SATB[2],918,'an unmodified ROM has entered its native demo');
 menu.close();frames(p,1500);assert.notEqual(p.VDC[0].SATB[2],918,'closing the custom menu restores native behavior');
});
test('the replacement menu covers every startup title frame before controls unlock',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),menu=installNativeMenu(p);menu.prepare(4);let menuLines=0,oldInk=0;const sprite=p.MakeSpriteLine;
 p.MakeSpriteLine=function(n){sprite.call(this,n);if(n===0&&this.VDC[0].SATB[2]===918){menuLines++;oldInk+=this.VDC[0].SPLine.filter(dot=>dot.data&&dot.no>=1&&dot.no<12).length;}};
 title(p);assert.equal(menu.active,false);assert.equal(menu.count,4);assert.ok(menuLines>100);assert.equal(oldInk,0,'C-Link/password/prompt sprites never render during startup');
 const width=p.ImageData.data.length/4/262;let bright=0;for(let y=130;y<138;y++)for(let x=64;x<140;x++){const at=(y*width+x)*4;if([0,1,2].every(c=>p.ImageData.data[at+c]===252))bright++;}assert.ok(bright>30,'new Campaign choice is already visible');
 menu.open(4);assert.equal(menu.active,true);menu.leave();frames(p,8,[[0,'RUN']]);assert.equal(menu.active,false);
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
 try{buttons[13]={pressed:true,value:1};frames(p,1);assert.equal(menu.selected,1);frames(p,5);assert.equal(menu.selected,1);buttons[13]={pressed:false,value:0};frames(p,1);buttons[9]={pressed:true,value:1};frames(p,1);assert.equal(selected,'new');assert.equal(p.VDC[0].SATB[0],195,'native menu selection stays on Solo until launch');}
 finally{Object.defineProperty(globalThis,'navigator',{configurable:true,value:original});}
});
