import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PCE} from '../dist/vendor/pce.js';
import {createMachine,frames} from '../scripts/headless.mjs';
import {launchSequence} from '../dist/battle-ai.js';
import {createCompanions,spawnEnemyType} from '../dist/campaign.js';
import {colorizePlayer} from '../dist/session.js';
import {nativeEnemyAtlas,decodeSpriteIcon,enemyCatalog} from '../dist/enemy-icons.js';
import {createEnemySpawns,validateEnemySpawns,ENEMY_PALETTE_BASE,ENEMY_PALETTE_MAX} from '../dist/enemy-spawns.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM,bytes=()=>fs.readFileSync(rom);
const rgba=(p,dot)=>dot.data?p.PaletteData[dot.palette+dot.data]:null;

test('private atlas compositor retains pinned core clipping, flips, sprite priority, collisions, overflow and fades',{skip:!rom},()=>{
 const p=createMachine(bytes()),spawns=createEnemySpawns(p),v=p.VDC[0],atlas=nativeEnemyAtlas(p,34),source=[...atlas.palette];v.VRAM=[...atlas.vram];
 spawns.state.owners[0]={slot:0,type:34};v.VDCRegister[5]=67;
 const render=fn=>{v.VDCStatus=0;fn.call(p,0);return{status:v.VDCStatus,dots:v.SPLine.slice(0,v.ScreenWidth).map(dot=>({data:dot.data,no:dot.no,priority:dot.priority,color:rgba(p,dot)}))};};
 for(let fade=0;fade<8;fade++){
  for(let i=0;i<512;i++){const color=source[i],r=Math.max(0,((color>>3)&7)-fade),g=Math.max(0,((color>>6)&7)-fade),b=Math.max(0,(color&7)-fade);p.Palette[i]=(g<<6)|(r<<3)|b;p.VCEAddress=i;p.ToPalettes();}
  for(const dimensions of [0,0x100,0x1000,0x1100,0x2000,0x2100])for(const flip of [0,0x800,0x8000,0x8800])for(const limit of [false,true]){
   v.SATB.fill(0);v.SpriteLimit=limit;
   for(let i=0;i<32;i++){v.SATB[i*4]=64;v.SATB[i*4+1]=i===0?24:24+(i%12)*24;v.SATB[i*4+2]=768;v.SATB[i*4+3]=0x83|dimensions|flip;}
   v.DrawBGYLine=v.VDS+v.VSW+13;
   assert.deepEqual(render(p.MakeSpriteLine),render(PCE.prototype.MakeSpriteLine),`fade ${fade} size ${dimensions} flip ${flip} limit ${limit}`);
  }
 }
 assert.equal(ENEMY_PALETTE_MAX,ENEMY_PALETTE_BASE+9*256+15*16);
});

test('mixed-stage native enemies draw from their own ROM models and replay fresh-machine mid-frame saves',{skip:!rom},()=>{
 const p=createMachine(bytes()),spawns=createEnemySpawns(p),crew=createCompanions(p,{colorize:colorizePlayer});for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);frames(p,2520);
 for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 const bot=crew.add(4,1);bot.color='orange';const vram=[...p.VDC[0].VRAM],palette=[...p.Palette],slots=[];
 for(const [type,x,y]of [[4,6,3],[8,10,3],[21,6,7]])slots.push(spawnEnemyType(p,type,x,y));
 assert.equal(enemyCatalog(p).filter(entry=>entry.available&&entry.type<23).length,23,'every ordinary species can spawn without a living template');
 assert.deepEqual(p.VDC[0].VRAM,vram);assert.deepEqual(p.Palette,palette,'registration never uploads or replaces native artwork/palettes');frames(p,6);
 for(const type of [4,8,21])assert.ok(spawns.state.owners.some(owner=>owner?.type===type),`native SATB DMA retained type ${type} ownership`);
 let checked=0;const originalLine=p.VDC[0].DrawBGYLine,originalRegister=p.VDC[0].VDCRegister[5];p.VDC[0].VDCRegister[5]|=64;
 for(const [index,owner]of spawns.state.owners.entries()){
  if(!owner)continue;const words=p.VDC[0].SATB.slice(index*4,index*4+4),icon=decodeSpriteIcon(p,[{x:0,y:0,pattern:words[2],attribute:words[3]}],nativeEnemyAtlas(p,owner.type)),left=(words[1]&1023)-32,top=(words[0]&1023)-64;
  for(let y=0;y<icon.height;y++){p.VDC[0].DrawBGYLine=p.VDC[0].VDS+p.VDC[0].VSW+top+y;p.MakeSpriteLine(0);for(let x=0;x<icon.width;x++){const address=(y*icon.width+x)*4;if(!icon.pixels[address+3])continue;const dot=p.VDC[0].SPLine[left+x];assert.equal(dot.no,index,`type ${owner.type} index ${index} at ${x},${y} words ${words.join(',')} line ${p.VDC[0].DrawBGYLine} reg ${p.VDC[0].VDCRegister[5]} pixel ${dot.data} palette ${dot.palette}`);assert.deepEqual(rgba(p,dot),{r:icon.pixels[address],g:icon.pixels[address+1],b:icon.pixels[address+2]});checked++;}}
 }
 p.VDC[0].DrawBGYLine=originalLine;p.VDC[0].VDCRegister[5]=originalRegister;assert.ok(checked>150,'all visible model families render their ROM pixels');
 const humanPalette=p.PaletteData.slice(0x1c0,0x1d0).map(color=>({...color}));p.MakeSpriteLine(0);assert.deepEqual(p.PaletteData.slice(0x1c0,0x1d0),humanPalette,'human colors remain native');
 const tick=()=>{p.CPURun();p.VDCRun();p.TimerRun();p.PSGRun();};
 const replay=()=>{
  const state=structuredClone(spawns.state),botState=structuredClone(crew.state),tracker={...p._campaignTracker},save=captureState(p);frames(p,5);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),cpu:p.PC,state:structuredClone(spawns.state)};
  const fresh=createMachine(bytes()),freshSpawns=createEnemySpawns(fresh),freshCrew=createCompanions(fresh,{colorize:colorizePlayer});restoreState(fresh,save);freshCrew.restore(botState);freshSpawns.restore(state);Object.assign(fresh._campaignTracker,tracker);frames(fresh,5);
  assert.deepEqual(fresh.RAM,expected.ram);assert.deepEqual(fresh.ImageData.data,expected.pixels);assert.equal(fresh.PC,expected.cpu);assert.deepEqual(freshSpawns.state,expected.state);
  restoreState(p,save);crew.restore(botState);spawns.restore(state);Object.assign(p._campaignTracker,tracker);
 };
 let found=false;for(let instruction=0;instruction<200000;instruction++){if(p.PC===0xe8de&&p.MPR[7]===0&&spawns.state.drawOwner){found=true;break;}tick();}assert.ok(found,'save inside the native multi-instruction sprite emission');replay();
 found=false;for(let instruction=0;instruction<200000;instruction++){if(p.VDC[0].SPLine.some(dot=>dot.data&&dot.palette>=ENEMY_PALETTE_BASE)){found=true;break;}tick();}assert.ok(found,'save includes private palette references in a drawn scanline');replay();
 const corrupted=structuredClone(spawns.state);corrupted.owners[0]={slot:32,type:4};const before=structuredClone(spawns.state);assert.throws(()=>spawns.restore(corrupted),/ownership/);assert.deepEqual(spawns.state,before);
 // A native removal retires the slot, while the last latched display keeps
 // its old type until the next DMA. Reusing that slot gets the new family.
 p.Set(0x2d98+slots[0],0);assert.equal(spawns.state.actors.some(actor=>actor.slot===slots[0]),false);const replacement=spawnEnemyType(p,7,8,5);assert.equal(replacement,slots[0]);frames(p,4);assert.ok(spawns.state.owners.some(owner=>owner?.slot===replacement&&owner.type===7));
 p.RAM[0x438]=5;p.RAM[0x43a]|=1;for(let frame=0;frame<500&&spawns.state.actors.length;frame++)frames(p,1);assert.equal(spawns.state.actors.length,0,'native defeat reload clears custom registrations');assert.equal(spawns.state.owners.some(Boolean),false);validateEnemySpawns(spawns.state);
});
