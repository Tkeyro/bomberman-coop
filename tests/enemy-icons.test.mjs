import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PCE} from '../dist/vendor/pce.js';
import {createMachine,frames} from '../scripts/headless.mjs';
import {launchSequence} from '../dist/battle-ai.js';
import {installCampaignTracker,enemies} from '../dist/campaign.js';
import {nativeEnemyPose,nativeEnemyAtlas,decodeSpriteIcon,enemyCatalog,createEnemyCard} from '../dist/enemy-icons.js';

function nativePixels(p,sprites,atlas){
 const oldVRAM=p.VDC[0].VRAM,oldPalette=p.Palette;if(atlas){p.VDC[0].VRAM=atlas.vram;p.Palette=atlas.palette;}
 const icon=decodeSpriteIcon(p,sprites),v=p.VDC[0],left=Math.min(...sprites.map(s=>s.x)),top=Math.min(...sprites.map(s=>s.y)),oldSATB=v.SATB,oldLine=v.DrawBGYLine,oldRegister=v.VDCRegister[5],pixels=new Uint8ClampedArray(icon.pixels.length);
 v.SATB=Array(256).fill(0);v.VDCRegister[5]|=64;
 for(const [index,sprite]of sprites.entries()){const start=index*4;v.SATB[start]=64+sprite.y-top;v.SATB[start+1]=32+sprite.x-left;v.SATB[start+2]=sprite.pattern;v.SATB[start+3]=sprite.attribute;}
 for(let y=0;y<icon.height;y++){
  v.DrawBGYLine=v.VDS+v.VSW+y;p.MakeSpriteLine(0);
  for(let x=0;x<icon.width;x++){const dot=v.SPLine[x];if(!dot.data)continue;const color=p.Palette[dot.palette+dot.data]&511,index=(y*icon.width+x)*4;pixels[index]=((color>>3)&7)*36;pixels[index+1]=((color>>6)&7)*36;pixels[index+2]=(color&7)*36;pixels[index+3]=255;}
 }
 v.SATB=oldSATB;v.DrawBGYLine=oldLine;v.VDCRegister[5]=oldRegister;v.VRAM=oldVRAM;p.Palette=oldPalette;return pixels;
}

test('sprite icons match the pinned compositor for flips, sizes, transparency and overlapping layers',()=>{
 const p=new PCE();p.MainCanvas={width:684,height:262};p.Init();const v=p.VDC[0];
 for(let i=0;i<512;i++)p.Palette[i]=(i*73)&511;
 // Asymmetric planes exercise both flips and every 16-pixel tile quadrant.
 for(let address=0;address<1024;address++)v.VRAM[address]=((address*397)^0x8451)&65535;
 for(const dimensions of [0,0x100,0x1000,0x1100,0x2000,0x2100])for(const flip of [0,0x800,0x8000,0x8800]){
  const sprites=[{x:-8,y:-12,pattern:0,attribute:0x83|dimensions|flip},{x:0,y:-7,pattern:16,attribute:0x84|flip}];
  assert.deepEqual(decodeSpriteIcon(p,sprites).pixels,nativePixels(p,sprites),`size ${dimensions.toString(16)} flip ${flip.toString(16)}`);
 }
 assert.throws(()=>decodeSpriteIcon(p,[]),/not available/);
});

test('enemy cards keep exact native artwork, names and unavailable templates accessible',()=>{
 const make=tag=>({tag,children:[],attributes:{},append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,fn){this[key]=fn;},getContext(){return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(data){this.data=data;}};}}),document={createElement:make},icon={width:16,height:16,pixels:new Uint8ClampedArray(16*16*4)};let clicked=0;
 const active=createEnemyCard(null,{name:'Ballom',type:2,available:true,notice:'Spawn in this stage',icon},{document,onSpawn:()=>clicked++});
 assert.equal(active.disabled,false);assert.equal(active.children[0].children[0].tag,'canvas');assert.equal(active.children[0].children[0].width,16);assert.match(active.attributes['aria-label'],/Ballom/);active.click();assert.equal(clicked,1);
 const unavailable=createEnemyCard(null,{name:'Monster type 4',type:4,available:false,notice:'No living template in this stage',icon},{document,onSpawn:()=>clicked++});
 assert.equal(unavailable.disabled,true);assert.equal(unavailable.click,undefined);assert.equal(unavailable.children[0].children[0].tag,'canvas');assert.match(unavailable.children[2].textContent,/No living template/);
});

test('all 45 living enemy/form icons use private runtime ROM assets and regular poses match native rendering',{skip:!process.env.BOMBERMAN_TEST_ROM},()=>{
 const p=createMachine(fs.readFileSync(process.env.BOMBERMAN_TEST_ROM));installCampaignTracker(p);for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);frames(p,2520);
 const before={ram:[...p.RAM],vram:[...p.VDC[0].VRAM],palette:[...p.Palette],pc:p.PC},catalog=enemyCatalog(p);
 assert.equal(catalog.length,45);assert.deepEqual({ram:p.RAM,vram:p.VDC[0].VRAM,palette:p.Palette,pc:p.PC},before,'opening the catalog never advances or edits the emulator');
 assert.equal(catalog.filter(entry=>entry.available).length,23);assert.equal(catalog[2].available,true);assert.ok(Number.isInteger(catalog[2].templateSlot));
 for(const entry of catalog){assert.ok(entry.icon,`native model ${entry.type}`);assert.ok(entry.icon.pixels.some((value,index)=>index%4===3&&value===255));assert.deepEqual(entry.icon.pixels,nativePixels(p,nativeEnemyPose(p,entry.type),nativeEnemyAtlas(p,entry.type)),`native sprite model ${entry.type}`);if(entry.type>=23)assert.equal(entry.available,false,'boss phases and multi-part forms cannot use a normal template clone');}
 // Direct ROM decompression agrees with assets really uploaded by the native
 // loader. Other world/boss families use the same bounded asset format.
 const first=nativeEnemyAtlas(p,2),common=nativeEnemyAtlas(p,0);
 assert.deepEqual([...first.vram.slice(0x6000,0x67c0)],p.VDC[0].VRAM.slice(0x6000,0x67c0));assert.deepEqual([...common.vram.slice(0x7000,0x7fc0)],p.VDC[0].VRAM.slice(0x7000,0x7fc0));
 assert.deepEqual([...first.palette.slice(256,368)].map(value=>value&511),p.Palette.slice(256,368).map(value=>value&511));assert.deepEqual([...common.palette.slice(384,448)].map(value=>value&511),p.Palette.slice(384,448).map(value=>value&511));
 const template=enemies(p)[0],cpu=p.CPURun;let type=0;
 p.CPURun=function(){if(this.MPR[this.PC>>13]===9*8192&&this.PC===0x9f04&&this.X===template.slot){this.RAM[0xeb8+template.slot]=type;this.RAM[0xe98+template.slot]=0;this.RAM[0xe38+template.slot]=0;this.RAM[0x11e6+template.slot]=0;}return cpu.call(this);};
 for(type=0;type<23;type++){
  frames(p,2);const pose=nativeEnemyPose(p,type)[0],satb=p.VDC[0].SATB;
  assert.equal(satb[10],pose.pattern,`native model ${type} pattern`);assert.equal(satb[11],pose.attribute,`native model ${type} palette/size/flip`);
 }
 assert.throws(()=>nativeEnemyPose(p,45),/Unknown/);
});
