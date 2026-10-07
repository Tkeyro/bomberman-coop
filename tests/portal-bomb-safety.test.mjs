import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,blastThreatensExit,spawnBomb,bombs,enemies,tileKind,companionBombSlots} from '../dist/campaign.js';
import {launchSequence} from '../dist/battle-ai.js';import {createIntroSkip} from '../dist/intro.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;let baseline,tracking,bytes;
const at=(p,x,y,kind)=>p.RAM[0x44a+y*32+x]=kind;
function grid(){const p={RAM:Array(8192).fill(0)};p.RAM[0x434]=15;p.RAM[0x435]=12;p.RAM[0x84d]=1;for(let y=1;y<12;y++)for(let x=2;x<15;x++)at(p,x,y,0xca);return p;}
function setup(){
 bytes??=fs.readFileSync(rom);const p=createMachine(bytes),crew=createCompanions(p,{getHuman:()=>null});
 if(!baseline){const intro=createIntroSkip(p);for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}baseline=captureState(p);tracking={...p._campaignTracker};}
 else {restoreState(p,baseline);Object.assign(p._campaignTracker,tracking);}
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;for(let i=0;i<25;i++)p.RAM[0xf9b+i]=0;for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)at(p,x,y,0xca);
 p.RAM[0x43d]=40;p.RAM[0x43e]=0;p.RAM[0x43f]=24;p.RAM[0x440]=0;p.RAM[0x43a]=p.RAM[0x437]=p.RAM[0xd96]=0;
 return {p,crew};
}
test('portal protection uses the actual range and terrain while allowing a covered exit to be revealed',()=>{
 const p=grid();at(p,8,5,0x28);
 assert.equal(blastThreatensExit(p,5,5,2),false,'being near a portal is safe when it is outside the blast');
 assert.equal(blastThreatensExit(p,5,5,3),true,'the last flame cell reaches the exposed portal');
 assert.equal(blastThreatensExit(p,8,5,1),true,'a bomb on a legacy exposed-portal tile is unsafe');
 assert.equal(blastThreatensExit(p,5,4,5),false,'diagonal proximity alone is safe');
 for(const kind of [1,2,3,4,5,6]){at(p,7,5,kind);assert.equal(blastThreatensExit(p,5,5,5),false,`native stopping terrain ${kind} shields the exit`);}
 at(p,7,5,0xca);at(p,8,5,0x24);assert.equal(blastThreatensExit(p,5,5,3),false,'hidden-exit walls must remain available to destroy');
});
test('portal protection follows bent bomb chains with each captured range and native wall stops',()=>{
 const p=grid();at(p,9,8,8);
 const active=[{slot:20,x:7,y:5,range:2},{slot:0,x:9,y:5,range:3},{slot:25,x:7,y:7,range:1}];
 assert.equal(blastThreatensExit(p,5,5,2,active),true,'a two-hop corner chain reaches a portal outside the original blast');
 active[1].range=2;assert.equal(blastThreatensExit(p,5,5,2,active),false,'each chained bomb keeps its own range');
 active[1].range=3;at(p,8,5,2);assert.equal(blastThreatensExit(p,5,5,2,active),false,'a wall before the second bomb prevents the chain');
 at(p,8,5,0xca);at(p,9,7,1);assert.equal(blastThreatensExit(p,5,5,2,active),false,'a pillar also blocks the final chained ray');
});
test('AI refuses a portal-hitting bomb, chooses a safe work cell and still opens its required wall',{skip:!rom},()=>{
 const {p,crew}=setup(),bot=crew.add(5,5);bot.fireRange=2;at(p,7,5,0x28);at(p,5,6,0xc2);
 p._levelObjective={state:{phase:'barrier',x:5,y:6},canExit:()=>false};
 crew.update();assert.equal(bot.bombsPlaced,0);assert.ok(bot.target,'the planner finds another bombing position');assert.equal(bot.goal.kind,'barrier');
 assert.equal(blastThreatensExit(p,bot.goal.x,bot.goal.y,bot.fireRange),false,'the selected barrier position protects the portal');
 for(let i=0;i<330&&tileKind(p,5,6)!==10;i++){
  const placed=bot.bombsPlaced;crew.update();
  if(bot.bombsPlaced>placed){const own=bombs(p).filter(b=>companionBombSlots(bot).includes(b.slot)).at(-1);assert.equal(blastThreatensExit(p,own.x,own.y,own.range),false,'every autonomous placement keeps the portal safe');}
  p.Run();
 }
 assert.ok(bot.bombsPlaced);assert.equal(tileKind(p,5,6),10,'portal protection still permits required barrier destruction');assert.equal(enemies(p).length,0,'safe native blasts do not summon extra monsters');
});
test('ordinary block clearing and enemy hunting choose firing cells that protect the revealed portal',{skip:!rom},()=>{
 const clearing=setup(),worker=clearing.crew.add(5,5);worker.fireRange=2;at(clearing.p,7,5,0x28);at(clearing.p,5,6,0xc2);clearing.crew.update();
 assert.equal(worker.bombsPlaced,0);assert.equal(worker.goal.kind,'block');assert.ok(worker.target);
 for(let i=0;i<160&&!worker.bombsPlaced;i++)clearing.crew.update();assert.equal(worker.bombsPlaced,1,'ordinary block work changes approach rather than stalling beside the exit');
 const placed=bombs(clearing.p).find(b=>companionBombSlots(worker).includes(b.slot));assert.equal(blastThreatensExit(clearing.p,placed.x,placed.y,placed.range),false,'passing through a dangerous firing cell does not cause a bomb there');
 const hunting=setup(),hunter=hunting.crew.add(5,5);hunter.fireRange=4;at(hunting.p,7,5,0x28);
 hunting.p.RAM[0xd98]=128;hunting.p.RAM[0xdd8]=152;hunting.p.RAM[0xdb8]=0;hunting.p.RAM[0xe18]=88;hunting.p.RAM[0xdf8]=0;hunting.crew.update();
 assert.equal(hunter.bombsPlaced,0);assert.equal(hunter.goal.kind,'enemy');assert.ok(hunter.target);assert.equal(blastThreatensExit(hunting.p,hunter.goal.x,hunter.goal.y,hunter.fireRange),false,'the hunter chooses a safe intercept rather than camping on an unsafe firing cell');
});
test('AI can reveal a covered native exit, while human/admin bombs retain native monster-spawn behavior',{skip:!rom},()=>{
 const {p,crew}=setup(),bot=crew.add(5,5);at(p,6,5,0x24);crew.update();assert.equal(bot.bombsPlaced,1,'an unrevealed exit remains a useful destructible block');
 frames(p,190);assert.equal(tileKind(p,6,5),8);assert.equal(enemies(p).length,0,'uncovering the hidden exit does not summon more monsters');
 const {p:human}=setup();at(human,6,5,0x28);const slot=spawnBomb(human,5,5);human.RAM[0x8ef+slot]=1;frames(human,190);
 assert.ok(enemies(human).length>0,'human/admin bombs still use the original portal punishment');
});
test('AI remote detonations protect revealed portals, captured ranges and bomb chains without changing other owners',{skip:!rom},()=>{
 const {p,crew}=setup(),bot=crew.add(3,3);bot.remote=true;bot.cooldown=1000;
 const own=spawnBomb(p,5,5,{slots:companionBombSlots(bot),automatic:true});crew.state.bombRanges[own]=3;bot.remoteTimers[0]=12;at(p,8,5,0x28);
 crew.update();assert.equal(p.RAM[0x8ef+own],150,'range captured at placement, rather than current power, protects the portal');
 at(p,7,5,0xc2);crew.update();assert.equal(p.RAM[0x8ef+own],1,'a blocking wall permits the safe detonation');
 at(p,7,5,0xca);at(p,8,5,0xca);at(p,7,9,0x28);crew.state.bombRanges[own]=2;p.RAM[0x8ef+own]=150;
 const enemy=spawnBomb(p,7,5,{slots:[10],automatic:true}),human=spawnBomb(p,12,2,{slots:[0]});p.RAM[0x84d]=4;p.RAM[0x8ef+enemy]=92;p.RAM[0x8ef+human]=91;
 crew.update();assert.equal(p.RAM[0x8ef+own],150,'the indirect blast through an enemy bomb also protects the portal');assert.equal(p.RAM[0x8ef+enemy],92,'AI does not rewrite enemy bomb fuses');assert.equal(p.RAM[0x8ef+human],91,'AI does not rewrite human bomb fuses');assert.equal(p.RAM[0x84f+enemy],0xc0,'native enemy bomb flags remain intact');
 p.RAM[0x84f+enemy]=0;crew.update();assert.equal(p.RAM[0x8ef+own],1,'remote bombing resumes once the unsafe chain is gone');
});
