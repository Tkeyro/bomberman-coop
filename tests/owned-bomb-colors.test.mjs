import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,companionBombSlots,spawnBomb,validateCompanionState,playerPosition,tileKind} from '../dist/campaign.js';
import {COLORS,colorizePlayer} from '../dist/session.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {launchSequence} from '../dist/battle-ai.js';

const rom=process.env.BOMBERMAN_TEST_ROM,body=new Set([6,7,8,10,15]);
const rgba=(p,index)=>p.PaletteData[index];
test('saved bomb ownership accepts previous saves and rejects invalid colors',()=>{
 const p=createMachine(new Uint8Array(262144)),crew=createCompanions(p),saved=structuredClone(crew.state);
 validateCompanionState(saved);const legacy=structuredClone(saved);delete legacy.bombColors;crew.restore(legacy);assert.deepEqual(crew.state.bombColors,Array(40).fill(null));
 for(const colors of [Array(39).fill(null),Array(41).fill(null),[1,...Array(39).fill(null)],['purple',...Array(39).fill(null)]])assert.throws(()=>validateCompanionState({...saved,bombColors:colors}),/bomb colors/);
});

test('owned native bomb bodies match every color, retain native fuse and floor, and replay saves',{skip:!rom},()=>{
 let human=true,humanColor='original';const bytes=fs.readFileSync(rom),p=createMachine(bytes),nativeBackground=p.MakeBGLine,crew=createCompanions(p,{colorize:colorizePlayer,getHuman:()=>human?playerPosition(p):null,getHumanColor:()=>humanColor});
 for(const step of launchSequence('solo'))frames(p,step.frames,step.button?[[0,step.button]]:[]);frames(p,2520);
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 const v=p.VDC[0],black=crew.add(4,1),orange=crew.add(6,1);black.color='black';orange.color='orange';
 const slots=[spawnBomb(p,3,3,{slots:[0]}),spawnBomb(p,5,3,{slots:companionBombSlots(black)}),spawnBomb(p,7,3,{slots:companionBombSlots(orange)}),spawnBomb(p,9,3,{slots:[10],automatic:true})];
 frames(p,4);assert.deepEqual(slots.map(slot=>crew.state.bombColors[slot]),['original','black','orange',null]);
 const immutable=()=>({ram:[...p.RAM],vram:[...v.VRAM],satb:[...v.SATB],palette:[...p.Palette],pc:p.PC,status:v.VDCStatus,state:structuredClone(crew.state),sprites:structuredClone(v.SPLine)});
 const render=(method,y,scroll=8)=>{
  v.DrawBGLine=y;v.VDCRegister[7]=scroll;v.DrawBGIndex=0;for(const dot of v.SPLine)Object.assign(dot,{data:0,no:255,priority:0,palette:0});
  method.call(p,0);const left=(v.HDS+v.HSW)<<3;return [...v.BGLine.slice(left,left+v.ScreenWidth)];
 };
 let changed=0,fuse=0,floor=0;const expectedColors=['original','black','orange'];
 for(let y=48;y<64;y++){
  const original=render(nativeBackground,y),before=immutable(),colored=render(p.MakeBGLine,y);assert.deepEqual(immutable(),before,'coloring changes only compositor output');
  for(let x=0;x<colored.length;x++){
   const cell=Math.floor((x+8)/16),owner=[3,5,7].indexOf(cell),index=original[x];
   if(owner>=0&&index>=128&&index<144&&body.has(index&15)){
    assert.equal(Math.floor(colored[x]/16)*16,3200+Object.keys(COLORS).indexOf(expectedColors[owner])*16);changed++;
   }else{assert.equal(colored[x],index,'native unowned bombs, fuse, outlines and floor retain their pixels');if(index===133)fuse++;if([139,141].includes(index))floor++;}
  }
 }
 assert.ok(changed>100);assert.ok(fuse>0);assert.ok(floor>0);
 const remembered=structuredClone(crew.state),tinted=render(p.MakeBGLine,57);crew.setBombColors(false);assert.equal(crew.bombColorsEnabled,false);assert.deepEqual(render(p.MakeBGLine,57),render(nativeBackground,57),'disabled owner colors show the exact original bomb pixels');assert.deepEqual(crew.state,remembered,'the display toggle changes no gameplay or saved ownership');crew.setBombColors(true);assert.equal(crew.bombColorsEnabled,true);assert.deepEqual(render(p.MakeBGLine,57),tinted,'reenabling colors immediately restores already placed bombs');
 const row=57,normal=render(p.MakeBGLine,row),shifted=render(p.MakeBGLine,row,24);assert.deepEqual(shifted.slice(0,-16),normal.slice(16),'colored bombs follow background camera scrolling');
 // Player sprites over the bomb are already composited, and remain untouched.
 v.SPLine[44]={data:15,palette:448,priority:128,no:0};v.DrawBGLine=57;v.VDCRegister[7]=8;p.MakeBGLine(0);assert.equal(v.BGLine[((v.HDS+v.HSW)<<3)+44],463);
 black.color='red';crew.state.bots=crew.state.bots.filter(bot=>bot!==black);assert.equal(crew.state.bombColors[slots[1]],'black','a bomb keeps its placed color after its actor leaves');
 const save=captureState(p),savedCrew=structuredClone(crew.state),tracker={...p._campaignTracker},fresh=createMachine(bytes),freshCrew=createCompanions(fresh,{colorize:colorizePlayer,getHuman:()=>human?playerPosition(fresh):null,getHumanColor:()=>humanColor});
 restoreState(fresh,save);freshCrew.restore(savedCrew);Object.assign(fresh._campaignTracker,tracker);assert.equal(freshCrew.state.bombColors[slots[1]],'black');
 const advance=machine=>{for(let i=0;i<6;i++)machine.Run();};advance(p);advance(fresh);assert.deepEqual(fresh.ImageData.data,p.ImageData.data,'a fresh-machine save restores colored pending bomb pixels');assert.deepEqual(fresh.RAM,p.RAM);assert.equal(fresh.PC,p.PC);
 // Every human-selected variant colors the next placed native-bank bomb.
 for(const color of Object.keys(COLORS)){
  for(let slot=0;slot<40;slot++)p.RAM[0x84f+slot]=0;p.RAM[0x44a+3*32+3]=0xca;humanColor=color;
  spawnBomb(p,3,3,{slots:[0]});frames(p,2);const line=render(p.MakeBGLine,57);assert.equal(crew.state.bombColors[0],color);const coloredIndex=line.find(index=>index>=3200&&index<3328);assert.ok(coloredIndex!==undefined);assert.equal(Math.floor(coloredIndex/16)*16,3200+Object.keys(COLORS).indexOf(color)*16);
 }
 const white=p.Palette[0x8f],index=3200+Object.keys(COLORS).indexOf('yellow')*16;
 for(const level of [3,0,7]){p.Palette[0x8f]=(level<<6)|(level<<3)|level;render(p.MakeBGLine,57);assert.deepEqual(rgba(p,index+15),Object.fromEntries(['r','g','b'].map((channel,j)=>[channel,Math.round(COLORS.yellow[j]*level/7)])),'owner tint follows native fades');}
 p.Palette[0x8f]=white;
 // The fifth online human owns native slots 0..4, even if the native human getter exists.
 p.RAM[0x84f]=0;p.RAM[0x44a+3*32+3]=0xca;const fifth={...structuredClone(orange),id:99,bombBank:4,color:'violet'};crew.state.bots.push(fifth);spawnBomb(p,3,3,{slots:companionBombSlots(fifth)});assert.equal(crew.state.bombColors[0],'violet');
 // Native flag writes retire and assign ownership without any render calls.
 p.MPR[1]=0x1f0000;p.Set(0x284f,0);assert.equal(crew.state.bombColors[0],null);crew.state.bots=crew.state.bots.filter(bot=>bot!==fifth);humanColor='blue';p.Set(0x284f,128);assert.equal(crew.state.bombColors[0],'blue');
 crew.setBombColors(false);p.Set(0x284f,0);humanColor='green';p.Set(0x284f,128);assert.equal(crew.state.bombColors[0],'green','ownership is tracked while the display preference is disabled');crew.setBombColors(true);humanColor='blue';p.Set(0x284f,0);p.Set(0x284f,128);
 const legacy=structuredClone(crew.state);delete legacy.bombColors;human=false;crew.restore(legacy);assert.equal(crew.state.bombColors[0],null);human=true;crew.update();assert.equal(crew.state.bombColors[0],'blue','old held native bombs recover ownership once human/spectator mode has restored');
 // Flame tiles and the native animation after ignition never use the bomb tint.
 p.RAM[0x8ef]=1;let flames=0;
 for(let i=0;i<70;i++){
  frames(p,1);if([6,11,12].includes(tileKind(p,3,3))){flames++;for(let y=48;y<64;y++){const original=render(nativeBackground,y),colored=render(p.MakeBGLine,y);assert.deepEqual(colored,original,'native explosions remain uncolored');}}
 }
 assert.ok(flames>0);assert.equal(p.RAM[0x84f],0);assert.equal(crew.state.bombColors[0],null,'native cleanup retires saved owner color');
 const before=structuredClone(crew.state);p.RAM[0x84a]=8;
 for(const color of ['black','orange']){humanColor=color;p.Set(0x284f,0);p.Set(0x284f,128);assert.equal(crew.state.bombColors[0],null,'Battle bomb flags ignore the local selected campaign color');assert.deepEqual(crew.state,before,'Battle ownership state is independent of local selected colors');}
});
