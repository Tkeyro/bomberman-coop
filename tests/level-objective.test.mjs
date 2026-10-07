import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,enemies,tileKind,spawnBomb,pickups,isCampaign,stageID} from '../dist/campaign.js';
import {createNewCampaign} from '../dist/new-campaign.js';import {createSpectator} from '../dist/spectator.js';
import {createIntroSkip} from '../dist/intro.js';import {launchSequence} from '../dist/battle-ai.js';
import {createLevelObjective,validateLevelObjective} from '../dist/level-objective.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function setup(generated=false){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null}),mode=createNewCampaign(p),watch=createSpectator(p,{getBots:()=>crew.state.bots});
 const objective=createLevelObjective(p,{getActors:()=>crew.state.bots.filter(b=>b.alive),getFocus:()=>({x:40,y:24})}),intro=createIntroSkip(p);
 for(const action of launchSequence('solo').slice(0,3))frames(p,action.frames,action.button?[[0,action.button]]:[]);
 intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 mode.configure(generated,1,12345);mode.update();watch.configure(true);objective.configure(true);objective.update();
 const step=()=>{objective.update();mode.update();watch.update();crew.update();p.Run();};
 return {p,crew,mode,watch,objective,step};
}
function clear(p){for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;}
function breakBarrier(p,objective){
 const {x,y}=objective.state,near=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].find(([cx,cy])=>tileKind(p,cx,cy)===10);assert.ok(near,'barrier has an accessible native bombing cell');
 const bomb=spawnBomb(p,...near);p.RAM[0x8ef+bomb]=1;frames(p,220);assert.equal(objective.state.phase,'item');assert.equal(tileKind(p,x,y),7);assert.equal(pickups(p).filter(i=>i.slot===objective.state.slot).length,1);
}
for(const generated of [false,true])test(`${generated?'NEW':'original'} requires a glowing bombable final item, preserves saves and resets on retry`,{skip:!rom},()=>{
 const {p,crew,mode,watch,objective,step}=setup(generated);assert.ok(enemies(p).length);assert.equal(objective.state.phase,'waiting');assert.equal(objective.canExit(),false);
 clear(p);objective.update();assert.equal(objective.state.phase,'barrier');const cell={x:objective.state.x,y:objective.state.y};assert.equal(tileKind(p,cell.x,cell.y),2);
 p.RAM[0x437]=1;step();assert.equal(p.RAM[0x437],0,'direct and native exits stay locked before the required pickup');assert.equal(mode.state.transition,null);
 let glowing=0;const draw=p.MakeBGLine;p.MakeBGLine=function(n){draw.call(this,n);if(n===0)glowing+=this.VDC[0].BGLine.filter(value=>value>=592&&value<=608).length;};frames(p,2);assert.ok(glowing>0,'the native wall receives visible glowing pixels');
 const save=captureState(p),goal=structuredClone(objective.state),tracker={...p._campaignTracker};frames(p,35);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),goal:structuredClone(objective.state)};
 restoreState(p,save);objective.restore(goal);Object.assign(p._campaignTracker,tracker);frames(p,35);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(objective.state,expected.goal);
 breakBarrier(p,objective);const slot=objective.state.slot;
 // An external bomb cannot permanently remove the required power-up.
 const adjacent=[[cell.x-1,cell.y],[cell.x+1,cell.y],[cell.x,cell.y-1],[cell.x,cell.y+1]].find(([x,y])=>tileKind(p,x,y)===10);const blast=spawnBomb(p,...adjacent);p.RAM[0x8ef+blast]=1;frames(p,240);assert.equal(objective.state.phase,'item');assert.ok(p.RAM[0xf9b+objective.state.slot]&128);assert.equal(objective.canExit(),false);
 // A teammate applies the real item upgrade and unlocks the shared portal.
 const bot=crew.add(...adjacent);bot.x=cell.x*16+8;bot.y=cell.y*16+8;bot.target=null;bot.cooldown=1000;crew.update();assert.equal(objective.state.phase,'collected');assert.equal(objective.canExit(),true);assert.equal(bot.bombCapacity,2);
 validateLevelObjective(objective.state);const bad=structuredClone(objective.state);bad.slot=25;assert.throws(()=>validateLevelObjective(bad),/slot/);
 // A native same-stage death reload creates a fresh mandatory objective.
 bot.alive=false;bot.deathFrame=104;bot.extraLives=0;assert.equal(generated?mode.retry():watch.retry(),true);
 for(let i=0;i<700&&(mode.state.transition||watch.state.transition);i++)step();assert.equal(mode.state.transition,null);assert.equal(watch.state.transition,null);assert.equal(objective.state.phase,'waiting');assert.equal(objective.canExit(),false);assert.ok(enemies(p).length);
});
test('native human pickup satisfies the final requirement without changing its effect',{skip:!rom},()=>{
 const {p,watch,objective}=setup();clear(p);objective.update();watch.configure(false);
 p.RAM[0x44a+32+10]=8;p.RAM[0x43d]=168;p.RAM[0x43e]=0;p.RAM[0x43f]=24;p.RAM[0x440]=0;frames(p,3);assert.equal(p.RAM[0x437],0,'the native human portal handler is gated until the required item is collected');assert.equal(objective.state.phase,'barrier');
 watch.configure(true);breakBarrier(p,objective);watch.configure(false);const {x,y,slot}=objective.state,capacity=p.RAM[0x84c]&127;
 p.RAM[0x43d]=x*16+8;p.RAM[0x43e]=0;p.RAM[0x43f]=y*16+8;p.RAM[0x440]=0;frames(p,3);assert.equal(p.RAM[0xf9b+slot],0);assert.equal(p.RAM[0x84c]&127,capacity+1);assert.equal(objective.state.phase,'collected');assert.equal(objective.canExit(),true);
});
test('a watched bot opens and collects the required barrier before requesting the portal',{skip:!rom},()=>{
 const {p,crew,objective,step}=setup();clear(p);for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 p.RAM[0x44a+32+5]=0xc2;p.RAM[0x44a+32+10]=8;const bot=crew.add(2,1);objective.update();assert.equal(objective.state.phase,'barrier');
 let premature=false;for(let i=0;i<2200&&!p.RAM[0x437];i++){step();if(p.RAM[0x437]&&objective.state.phase!=='collected')premature=true;}
 assert.equal(premature,false);assert.equal(objective.state.phase,'collected',JSON.stringify({goal:objective.state,bot,events:crew.state.events}));assert.ok(bot.pickupsCollected);assert.ok(bot.bombsPlaced);assert.equal(p.RAM[0x437],1,'the bot reaches the exit after collecting its required upgrade');
});
test('a legacy all-floor stage still creates a reachable barrier without trapping its actor',{skip:!rom},()=>{
 const {p,crew,objective}=setup();clear(p);for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 const bot=crew.add(2,1);objective.configure(true);objective.update();const {x,y}=objective.state;
 assert.equal(objective.state.phase,'barrier');assert.notDeepEqual({x,y},{x:Math.floor(bot.x/16),y:Math.floor(bot.y/16)});assert.equal(tileKind(p,x,y),2);assert.deepEqual(objective.state.blockTiles,[0x4308,0x4309,0x4318,0x4319]);breakBarrier(p,objective);
});
test('legacy saves already requesting a native clear finish and acquire the new requirement next stage',{skip:!rom},()=>{
 for(const generated of [false,true]){
  const {p,mode,objective,step}=setup(generated);clear(p);objective.configure(true);p.RAM[0x437]=1;step();
  for(let i=0;i<700&&(!isCampaign(p)||(generated?mode.state.round===1:stageID(p)==='0:0'));i++)step();
  assert.equal(generated?mode.state.round:stageID(p),generated?2:'0:1');assert.equal(isCampaign(p),true);assert.equal(objective.state.phase,'waiting');assert.equal(objective.canExit(),false);assert.ok(enemies(p).length);
 }
});
