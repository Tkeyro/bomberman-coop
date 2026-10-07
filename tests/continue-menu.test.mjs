import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {TITLE_SEQUENCE} from '../dist/native-menu.js';
import {createContinueMenu} from '../dist/continue-menu.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function blank(){return createMachine(new Uint8Array(262144));}
test('Continue is one host decision; guests wait and world restarts are displayed from zero',()=>{
 const p=blank(),choices=[],menu=createContinueMenu(p,{onSelect:choice=>choices.push(choice)});
 menu.open({worldIndex:2});assert.equal(menu.state.worldIndex,2);assert.equal(menu.state.choice,'continue');
 menu.input('DOWN');assert.equal(menu.state.choice,'quit');menu.input('UP');menu.input('RUN');menu.input('RUN');menu.input('DOWN');assert.deepEqual(choices,['continue']);assert.equal(menu.state.waiting,true);
 menu.close();assert.equal(menu.active,false);assert.equal(menu.input('RUN'),false);
 menu.open({worldIndex:0,hostInteractive:false});menu.input('DOWN');menu.input('RUN');assert.equal(menu.state.choice,'continue');assert.deepEqual(choices,['continue'],'a guest cannot restart or quit the shared session');
 menu.open({worldIndex:7});menu.input('DOWN');menu.input('SHOT1');assert.deepEqual(choices,['continue','quit']);
 menu.reset();assert.equal(menu.active,false);assert.throws(()=>menu.open({worldIndex:8}),/Unknown campaign world/);
});
test('a gamepad held through death must release before confirming the Continue page',()=>{
 const p=blank(),choices=[];let button='RUN';p.CheckGamePad=function(){for(const pad of this.GamePad){pad[0]=pad[1]=pad[2]=0xbf;pad[3]=0xb0;}if(button==='RUN')this.GamePad[0][0]&=~8;if(button==='DOWN')this.GamePad[0][1]&=~4;};
 const menu=createContinueMenu(p,{onSelect:choice=>choices.push(choice)});menu.open();menu.poll();menu.poll();assert.deepEqual(choices,[]);button='';menu.poll();button='DOWN';menu.poll();assert.equal(menu.state.choice,'quit');assert.equal(p.GamePad[0][1],0xbf,'the menu consumes pad movement');button='';menu.poll();button='RUN';menu.poll();assert.deepEqual(choices,['quit']);
});
test('the paused Continue page uses native glyphs and cursor without advancing or changing game state',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom));for(const a of TITLE_SEQUENCE)frames(p,a.frames,a.button?[[0,a.button]]:[]);
 const expected={ram:[...p.RAM],vram:[...p.VDC[0].VRAM],satb:[...p.VDC[0].SATB],palette:[...p.Palette],pc:p.PC,pixels:Uint8ClampedArray.from(p.ImageData.data)};
 let presentations=0;p.Ctx.putImageData=()=>presentations++;const menu=createContinueMenu(p);menu.open({worldIndex:2});assert.equal(presentations,1);
 const stride=p.ScreenWidthMAX,width=p.MainCanvas.width;
 function label(text,y){const left=Math.floor((width-text.length*8)/2);let ink=0;for(let i=0;i<text.length;i++)for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
  const at=(0x200+text.charCodeAt(i))*16+dy,bit=7-dx,a=p.VDC[0].VRAM[at],b=p.VDC[0].VRAM[at+8],dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
  if(dot){ink++;const color=p.PaletteData[0xc0+dot],pixel=((y+dy)*stride+left+i*8+dx)*4;assert.deepEqual([...p.ImageData.data.slice(pixel,pixel+4)],[color.r,color.g,color.b,255],text);}
 }assert.ok(ink>20,text+' is visible');}
 label('GAME OVER',82);label('RESTART WORLD 3-0',108);label('CONTINUE',134);
 const redInRow=row=>{let red=0;for(let y=130+row*22;y<146+row*22;y++)for(let x=104;x<120;x++){const i=(y*stride+x)*4;if(p.ImageData.data[i]>200&&p.ImageData.data[i+1]<60&&p.ImageData.data[i+2]<60)red++;}return red;};
 assert.equal(redInRow(0),12,'the original red menu cursor is visible');assert.equal(redInRow(1),0);menu.input('DOWN');assert.equal(redInRow(0),0);assert.equal(redInRow(1),12);
 menu.open({worldIndex:0,hostInteractive:false});label('RESTART WORLD 1-0',108);assert.equal(menu.state.hostInteractive,false);
 assert.equal(p.PC,expected.pc);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.VDC[0].VRAM,expected.vram);assert.deepEqual(p.VDC[0].SATB,expected.satb);assert.deepEqual(p.Palette,expected.palette);
 assert.ok(p.ImageData.data.every((value,index)=>index%4!==3||value===255),'the page stays opaque');menu.close();assert.deepEqual(p.ImageData.data,expected.pixels,'closing restores the unchanged native frame');
});
