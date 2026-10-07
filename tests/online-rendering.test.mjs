import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions} from '../dist/campaign.js';
import {createSpectator} from '../dist/spectator.js';
import {createOnlineCampaign,ONLINE_INPUT as I} from '../dist/online-campaign.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';

test('intermediate rendering preserves canonical hardware flags without saving a presentation preference',()=>{
 const actors=[{id:1,x:40,y:24,alive:true},{id:2,x:376,y:280,alive:true}],ram=Array(8192).fill(0),satb=Array(256).fill(0),views=[];
 ram[0x25]=8;ram[0x434]=31;ram[0x435]=25;ram[0x44a+34]=10;satb[2]=640;
 const v={SATB:satb,VDCStatus:0,VDCRegister:Array(32).fill(0),DrawBGYLine:120,VDS:0,VSW:0,DrawBGLine:120,VScreenHeightMask:511};v.VDCRegister[7]=8;
 const p={RAM:ram,VDC:[v],_campaignTracker:{frame:0,last:0},MakeSpriteLine(){v.VDCStatus=1+(ram[0x25]|ram[0x26]<<8);views.push(['sprite',ram.slice(0x25,0x29)]);},MakeBGLine(){views.push(['background',ram.slice(0x25,0x29)]);}};
 const online=createOnlineCampaign(p,{getActors:()=>actors,getLocalID:()=>2});online.configure(true,[{id:1,color:'black'},{id:2,color:'orange'}]);const saved=structuredClone(online.state),before={ram:[...ram],satb:[...satb]};
 online.setLocalRendering(false);p.MakeSpriteLine(0);p.MakeBGLine(0);
 assert.deepEqual(views,[['sprite',[8,0,0,0]],['background',[8,0,0,0]]]);assert.equal(v.VDCStatus,9);assert.deepEqual(online.state,saved);assert.deepEqual(ram,before.ram);assert.deepEqual(satb,before.satb);
 views.length=0;online.restore(saved);p.MakeSpriteLine(0);p.MakeBGLine(0);
 assert.equal(views.length,3,'restoring gameplay also restores full local rendering');assert.notDeepEqual(views[1][1],views[0][1]);assert.deepEqual(views[2][1],views[1][1]);assert.equal(v.VDCStatus,9);assert.deepEqual(ram,before.ram);assert.deepEqual(satb,before.satb);
});

const rom=process.env.BOMBERMAN_TEST_ROM;
test('native catch-up keeps exact gameplay and restores every final local-camera pixel',{skip:!rom},()=>{
 const bytes=fs.readFileSync(rom);
 function install(p){const crew=createCompanions(p,{getHuman:()=>null}),watch=createSpectator(p,{getBots:()=>crew.state.bots}),online=createOnlineCampaign(p,{getActors:()=>crew.state.bots,getLocalID:()=>2});return {p,crew,watch,online};}
 const one=install(createMachine(bytes));for(const a of launchSequence('solo'))frames(one.p,a.frames,a.button?[[0,a.button]]:[]);frames(one.p,2520);
 one.p.RAM[0x434]=31;one.p.RAM[0x435]=25;
 for(let y=1;y<25;y++)for(let x=2;x<31;x++)one.p.RAM[0x44a+y*32+x]=0xca;
 for(let i=0;i<32;i++)one.p.RAM[0xd98+i]=0;
 one.watch.configure(true);const a=one.crew.add(3,3),b=one.crew.add(23,17);a.color='black';b.color='orange';a.fireproof=b.fireproof=3600;
 one.online.configure(true,one.crew.state.bots.map(a=>({id:a.id,color:a.color})));
 const two=install(createMachine(bytes));restoreState(two.p,captureState(one.p));two.crew.restore(one.crew.state);two.watch.restore(one.watch.state);two.online.restore(one.online.state);Object.assign(two.p._campaignTracker,one.p._campaignTracker);
 const directions=[I.RIGHT,I.DOWN,I.LEFT,I.UP],cpu=['A','X','Y','PC','S','P','ProgressClock','TimerCounter','TimerPrescaler','INTTIQ'];let rendered=0;
 for(let frame=0;frame<600;frame++){
  const inputs=[directions[Math.floor(frame/45)%4],directions[Math.floor(frame/63)%4]];if(frame===120||frame===360){inputs[0]|=I.BOMB;inputs[1]|=I.BOMB;}
  const final=frame%6===5;two.online.setLocalRendering(final);
  for(const game of [one,two]){game.online.setInputs(frame,inputs);game.online.update();game.watch.update();game.crew.update();game.p.Run();}
  if(frame%20===0){assert.deepEqual(two.p.RAM,one.p.RAM,'RAM at '+frame);assert.deepEqual(two.crew.state,one.crew.state,'actors at '+frame);assert.deepEqual(two.online.state,one.online.state,'inputs at '+frame);assert.deepEqual(two.p.VDC[0].SATB,one.p.VDC[0].SATB,'SATB at '+frame);assert.equal(two.p.VDC[0].VDCStatus,one.p.VDC[0].VDCStatus,'hardware flags at '+frame);for(const k of cpu)assert.equal(two.p[k],one.p[k],k+' at '+frame);}
  if(final){assert.deepEqual(two.p.ImageData.data,one.p.ImageData.data,'final local pixels at '+frame);rendered++;}
 }
 assert.equal(rendered,100);assert.ok(one.crew.state.bots.some(a=>a.bombsPlaced),'bomb animation is exercised');assert.ok(one.crew.state.bots.every(a=>a.alive),'both independent cameras remain active throughout');
});
