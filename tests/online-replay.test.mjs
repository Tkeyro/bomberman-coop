import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,playerPosition} from '../dist/campaign.js';import {createNewCampaign} from '../dist/new-campaign.js';import {createSpectator} from '../dist/spectator.js';import {createOnlineCampaign,ONLINE_INPUT as I} from '../dist/online-campaign.js';import {launchSequence} from '../dist/battle-ai.js';import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function install(p,localID){
 const crew=createCompanions(p,{getHuman:()=>null}),stats={reloads:0};let watch;const mode=createNewCampaign(p,{getFocus:()=>watch?.state.enabled?watch.focus():playerPosition(p),onRound:revive});watch=createSpectator(p,{getBots:()=>crew.state.bots,onRetry:revive});const online=createOnlineCampaign(p,{getActors:()=>crew.state.bots,getLocalID:()=>localID});
 function revive(){stats.reloads++;for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;for(const [i,a]of crew.state.bots.entries()){a.alive=true;a.deathFrame=null;a.extraLives=0;a.x=(i?23:3)*16+8;a.y=(i?17:3)*16+8;a.target=null;a.route=[];p.RAM[0x44a+Math.floor(a.y/16)*32+Math.floor(a.x/16)]=0xca;}}
 return {p,crew,mode,watch,online,revive,stats};
}
test('10,000 ordered frames keep two native simulations equal while local cameras differ',{skip:!rom},()=>{
 const bytes=fs.readFileSync(rom),one=install(createMachine(bytes),1);for(const a of launchSequence('solo'))frames(one.p,a.frames,a.button?[[0,a.button]]:[]);frames(one.p,2520);one.mode.configure(true,2,456);one.mode.update();one.watch.configure(true);for(const [x,y]of [[3,3],[23,17]]){one.p.RAM[0x44a+y*32+x]=0xca;one.crew.add(x,y);}one.crew.state.bots[0].color='black';one.crew.state.bots[1].color='orange';one.revive();
 const roster=one.crew.state.bots.map(b=>({id:b.id,color:b.color}));one.online.configure(true,roster);const core=captureState(one.p),extensions={crew:structuredClone(one.crew.state),mode:structuredClone(one.mode.state),watch:structuredClone(one.watch.state),online:structuredClone(one.online.state),tracker:{...one.p._campaignTracker}};
 const two=install(createMachine(bytes),2);restoreState(two.p,core);two.crew.restore(extensions.crew);two.mode.restore(extensions.mode);two.watch.restore(extensions.watch);two.online.restore(extensions.online);Object.assign(two.p._campaignTracker,extensions.tracker);
 let differentViews=0;let random=123456789;const directions=[I.UP,I.RIGHT,I.DOWN,I.LEFT,0];
 for(let frame=0;frame<10000;frame++){
  random=(Math.imul(random,1664525)+1013904223)>>>0;const masks=[directions[Math.floor(frame/45)%5]|(frame%131===0?I.BOMB:0),directions[(Math.floor(frame/63)+2)%5]|(random%173===0?I.BOMB:0)];
  for(const game of [one,two]){if(frame===1200)for(const actor of game.crew.state.bots)if(actor.alive)game.p.RAM[0x44a+Math.floor(actor.y/16)*32+Math.floor(actor.x/16)]=11;game.online.setInputs(frame,masks);game.online.update();game.mode.update();game.watch.update();game.crew.update();if(game.crew.state.bots.length&&game.crew.state.bots.every(actor=>!actor.alive&&!actor.extraLives))game.mode.retry();game.p.Run();}
  if(frame%100===0){assert.deepEqual(two.p.RAM,one.p.RAM,'RAM at ordered frame '+frame);for(const k of ['A','X','Y','PC','S','P','ProgressClock','TimerCounter','TimerPrescaler','INTTIQ'])assert.equal(two.p[k],one.p[k],k+' at frame '+frame);assert.deepEqual(two.crew.state,one.crew.state);assert.equal(two.p.VDC[0].VDCStatus,one.p.VDC[0].VDCStatus);assert.deepEqual(two.p.VDC[0].SATB,one.p.VDC[0].SATB);if(!Buffer.from(two.p.ImageData.data).equals(Buffer.from(one.p.ImageData.data)))differentViews++;}
 }
 assert.ok(two.stats.reloads>=1,'all-dead defeat completes a native reload and revives both humans');assert.ok(differentViews>5,'local camera follows each own actor without changing gameplay authority');assert.deepEqual(two.p.RAM,one.p.RAM);assert.deepEqual(two.online.state,one.online.state);
 // A mid-session save also retains input edges and remote detonation latches.
 const saved=captureState(one.p),actorState=structuredClone(one.crew.state),onlineState=structuredClone(one.online.state);restoreState(two.p,saved);two.crew.restore(actorState);two.online.restore(onlineState);assert.deepEqual(two.online.state,one.online.state);
});
