import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,spawnItem,spawnEnemy,spawnBomb,enemies,bombs,blastCells,tileKind,validateCompanionState} from '../dist/campaign.js';
import {createIntroSkip} from '../dist/intro.js';import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;let baseline,tracking,bytes,template;
const BASES=[0xd98,0xdb8,0xdd8,0xdf8,0xe18,0xe38,0xe58,0xe78,0xe98,0xeb8,0xed8,0xef8,0xf18,0xf38,0xf58,0xf78];
const tile=a=>`${Math.floor(a.x/16)},${Math.floor(a.y/16)}`,goal=g=>`${g.kind}:${g.x},${g.y}`;
function setup({human=null,solid=false}={}){
 bytes??=fs.readFileSync(rom);const p=createMachine(bytes),crew=createCompanions(p,{getHuman:()=>human});
 if(!baseline){const intro=createIntroSkip(p);for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}baseline=captureState(p);tracking={...p._campaignTracker};const first=enemies(p)[0];template=BASES.map(base=>p.RAM[base+first.slot]);}
 else {restoreState(p,baseline);Object.assign(p._campaignTracker,tracking);}
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;for(let i=0;i<25;i++)p.RAM[0xf9b+i]=0;for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=solid?1:0xca;
 p.RAM[0x43d]=p.RAM[0x43e]=p.RAM[0x43f]=p.RAM[0x440]=0;p.RAM[0x43a]=p.RAM[0x437]=p.RAM[0xd96]=0;
 const step=()=>{crew.update();p.Run();};return {p,crew,step};
}
function monster(p,x,y){for(let i=0;i<BASES.length;i++)p.RAM[BASES[i]+31]=template[i];const slot=spawnEnemy(p,31,x,y);p.RAM[0xd98+31]=0;return slot;}
function separate(bots){for(let i=0;i<bots.length;i++)for(let j=i+1;j<bots.length;j++)assert.ok(Math.abs(bots[i].x-bots[j].x)>=10||Math.abs(bots[i].y-bots[j].y)>=10,`teammates ${bots[i].id}/${bots[j].id} overlap: ${bots[i].x},${bots[i].y}; ${bots[j].x},${bots[j].y}`);}
function overlap(bots){let area=0;for(let i=0;i<bots.length;i++)for(let j=i+1;j<bots.length;j++)area+=Math.max(0,10-Math.abs(bots[i].x-bots[j].x))*Math.max(0,10-Math.abs(bots[i].y-bots[j].y));return area;}
test('four teammates split pickups, keep distinct routes and replay team claims exactly',{skip:!rom},()=>{
 const {p,crew,step}=setup(),team=[3,5,7,9].map(y=>crew.add(3,y));for(const y of [3,5,7,9])spawnItem(p,1,10,y);for(const b of team)b.cooldown=1000;
 crew.update();assert.ok(team.every(b=>b.goal?.kind==='item'));assert.equal(new Set(team.map(b=>goal(b.goal))).size,4,'each pickup has one claimant');assert.equal(new Set(team.map(b=>`${b.target.x},${b.target.y}`)).size,4);separate(team);
 for(let i=0;i<20;i++){step();separate(crew.state.bots);}
 const save=captureState(p),state=structuredClone(crew.state),tracker={...p._campaignTracker};for(let i=0;i<100;i++){step();separate(crew.state.bots);}
 const expected={ram:[...p.RAM],state:structuredClone(crew.state),pixels:Uint8ClampedArray.from(p.ImageData.data)};
 restoreState(p,save);crew.restore(state);Object.assign(p._campaignTracker,tracker);for(let i=0;i<100;i++){step();separate(crew.state.bots);}assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(crew.state,expected.state);assert.deepEqual(p.ImageData.data,expected.pixels);
 for(let i=0;i<100&&crew.state.bots.reduce((n,b)=>n+b.pickupsCollected,0)<4;i++){step();separate(crew.state.bots);}assert.equal(crew.state.bots.reduce((n,b)=>n+b.pickupsCollected,0),4);assert.ok(crew.state.bots.every(b=>b.pickupsCollected===1),'the four bots each retrieve an upgrade');
});
test('four teammates choose separate block resources and two hunters use separate firing positions',{skip:!rom},()=>{
 const {p,crew}=setup(),team=[3,5,7,9].map(y=>crew.add(3,y));for(const y of [3,5,7,9])p.RAM[0x44a+y*32+10]=0xc2;for(const b of team)b.cooldown=1000;
 crew.update();assert.ok(team.every(b=>b.goal?.kind==='block'));assert.equal(new Set(team.map(b=>goal(b.goal))).size,4,'block work is spread among four resources');
 const hunter=setup();monster(hunter.p,11,3);monster(hunter.p,11,9);const pair=[hunter.crew.add(3,3),hunter.crew.add(3,9)];for(const b of pair){b.fireRange=3;b.cooldown=1000;}hunter.crew.update();
 assert.ok(pair.every(b=>b.goal?.kind==='enemy'));assert.equal(new Set(pair.map(b=>goal(b.goal))).size,2,'hunters claim separate useful bombing cells');separate(pair);
});
test('bomb placement protects teammates current and intended next tiles, then resumes after spreading',{skip:!rom},()=>{
 for(const next of [false,true]){
  const {p,crew,step}=setup(),bomber=crew.add(5,5),friend=crew.add(next?8:6,5);bomber.fireRange=2;friend.cooldown=1000;friend.target={x:next?7:8,y:5};p.RAM[0x44a+6*32+5]=0xc2;
  crew.update();assert.equal(bomber.bombsPlaced,0,next?'do not bomb the next tile a teammate intends to enter':'do not bomb a teammate current tile');assert.equal(bombs(p).length,0);separate(crew.state.bots);
  friend.cooldown=0;
  for(let i=0;i<420&&tileKind(p,5,6)!==10;i++){
   const before=crew.state.bots.filter(b=>b.alive).map(b=>({id:b.id,x:b.x,y:b.y,target:b.target&&{...b.target},placed:b.bombsPlaced}));crew.update();
   for(const b of crew.state.bots){const old=before.find(a=>a.id===b.id);if(b.bombsPlaced===old.placed)continue;const own=bombs(p).filter(n=>n.slot>=20+b.bombBank*5&&n.slot<25+b.bombBank*5).at(-1),area=blastCells(p,own.x,own.y,b.fireRange);
    for(const a of before)if(a.id!==b.id){assert.equal(area.has(tile(a)),false,'a new bomb protects the other actor current cell');if(a.target)assert.equal(area.has(`${a.target.x},${a.target.y}`),false,'a new bomb protects the other actor reserved next cell');}
   }
   separate(crew.state.bots);p.Run();
  }
  assert.ok(crew.state.bots.some(b=>b.bombsPlaced),JSON.stringify({reason:'team yields and eventually permits a useful bomb',next,bots:crew.state.bots}));assert.equal(tileKind(p,5,6),10,'friendly fire prevention does not permanently stall block clearing');assert.ok(crew.state.bots.every(b=>b.alive));
 }
});
test('head-on teammates pass, yield or exchange work and finish both jobs in a corridor with a side bay',{skip:!rom},()=>{
 const {p,crew}=setup({solid:true});for(let x=2;x<=12;x++)p.RAM[0x44a+5*32+x]=0xca;for(const y of [3,4])p.RAM[0x44a+y*32+7]=0xca;
 const a=crew.add(4,5),b=crew.add(10,5);spawnItem(p,1,12,5);spawnItem(p,1,2,5);a.goal={kind:'item',x:12,y:5};b.goal={kind:'item',x:2,y:5};a.cooldown=b.cooldown=1000;let side=false,yielded=false,exchanged=false;
 let passed=false;for(let i=0;i<360;i++){crew.update();if(overlap(crew.state.bots)>0)passed=true;if(a.y<83||b.y<83)side=true;if(crew.state.bots.some(actor=>actor.yieldFrames||actor.action.includes('teammate')))yielded=true;if(a.goal?.kind==='item'&&a.goal.x===2||b.goal?.kind==='item'&&b.goal.x===12)exchanged=true;}
 assert.ok(side||yielded||exchanged||passed,'the team resolves opposing routes through passing, yielding or a task exchange');assert.equal(a.pickupsCollected+b.pickupsCollected,2,'both endpoints are serviced without a corridor stall');assert.ok(a.pickupsCollected&&b.pickupsCollected,'each teammate completes work');assert.ok(Math.abs(a.x-b.x)>=16||Math.abs(a.y-b.y)>=16);
});
test('old overlapping teams separate without increasing overlap and optional cooperation fields validate',{skip:!rom},()=>{
 const {crew}=setup(),team=[[4,4],[6,4],[4,6],[6,6]].map(([x,y])=>crew.add(x,y)),targets=[{x:6,y:5},{x:4,y:5},{x:5,y:4},{x:5,y:6}];
 for(const [i,b]of team.entries()){b.x=88;b.y=88;b.target=targets[i];b.cooldown=1000;}
 const legacy=structuredClone(crew.state);for(const b of legacy.bots){delete b.goal;delete b.yieldFrames;}crew.restore(legacy);assert.ok(crew.state.bots.every(b=>b.goal===null&&b.yieldFrames===0));let previous=overlap(crew.state.bots);
 for(let i=0;i<120&&previous;i++){crew.update();const area=overlap(crew.state.bots);assert.ok(area<=previous,'legacy separation never makes overlap worse');previous=area;}assert.equal(previous,0);separate(crew.state.bots);
 const bad=structuredClone(crew.state);bad.bots[0].yieldFrames=91;assert.throws(()=>validateCompanionState(bad),/cooperat|goal|yield|teammate/i);bad.bots[0].yieldFrames=0;bad.bots[0].goal={kind:'unknown',x:3,y:3};assert.throws(()=>validateCompanionState(bad),/cooperat|goal|teammate/i);
});
test('a teammate passes a human blocking the only corridor and resumes separate work',{skip:!rom},()=>{
 const human={x:88,y:88},{p,crew}=setup({human,solid:true});for(let x=2;x<=12;x++)p.RAM[0x44a+5*32+x]=0xca;
 const bot=crew.add(4,5);spawnItem(p,1,12,5);bot.target={x:5,y:5};bot.goal={kind:'item',x:12,y:5};bot.cooldown=1000;let passed=false;
 for(let i=0;i<300;i++){crew.update();if(overlap([bot,human])>0)passed=true;}
 assert.ok(passed,'human occupancy is a path preference rather than a wall');assert.equal(bot.pickupsCollected,1,'the bot finishes work beyond the stationary human');separate([bot,human]);assert.ok(bot.x>human.x+16,'the bot does not remain piled on the human');
});
test('a bomber may escape into the human-occupied refuge while preserving human blast safety',{skip:!rom},()=>{
 const human={x:40,y:40},{p,crew,step}=setup({human,solid:true});for(const [x,y]of [[2,1],[3,1],[2,2]])p.RAM[0x44a+y*32+x]=0xca;p.RAM[0x44a+1*32+4]=0xc2;
 const bot=crew.add(3,1);bot.goal={kind:'block',x:4,y:1};let shared=false;
 for(let i=0;i<250;i++){step();if(overlap([bot,human])>0)shared=true;}
 assert.ok(shared,'the only safe refuge remains usable when a human stands there');assert.ok(bot.bombsPlaced>0,'human occupancy cannot veto a terrain-safe escape route');assert.equal(tileKind(p,4,1),10);assert.equal(bot.alive,true,'the shared shelter protects the bomber');assert.ok(![6,11,12].includes(tileKind(p,2,2)),'the refuge stays outside the placed bomb blast');
});
test('an off-center teammate can finish centering in its own reserved tile and both actors recover',{skip:!rom},()=>{
 const {p,crew}=setup({solid:true});for(let x=2;x<=12;x++)p.RAM[0x44a+5*32+x]=0xca;for(const y of [3,4])p.RAM[0x44a+y*32+7]=0xca;
 const a=crew.add(8,5),b=crew.add(9,5);b.x=152.25;a.target=b.target={x:9,y:5};a.goal={kind:'item',x:12,y:5};b.goal={kind:'item',x:2,y:5};a.cooldown=b.cooldown=1000;spawnItem(p,1,12,5);spawnItem(p,1,2,5);let centered=false,movedA=false,movedB=false;
 for(let i=0;i<360;i++){crew.update();if(b.x===152&&b.y===88)centered=true;if(Math.abs(a.x-136)+Math.abs(a.y-88)>=16)movedA=true;if(Math.abs(b.x-152.25)+Math.abs(b.y-88)>=16)movedB=true;}
 assert.ok(centered,'the actor may safely center in the tile it already occupies');assert.ok(movedA&&movedB,'both actors recover from the initial conflicting reservation');assert.equal(a.pickupsCollected+b.pickupsCollected,2,'the autonomous planner continues servicing goals after centering');
});
test('teammates can pass through each other in a one-tile lane with no side bay and then spread out',{skip:!rom},()=>{
 const {p,crew}=setup({solid:true});for(let x=2;x<=12;x++)p.RAM[0x44a+5*32+x]=0xca;
 const a=crew.add(4,5),b=crew.add(10,5);spawnItem(p,1,12,5);spawnItem(p,1,2,5);a.goal={kind:'item',x:12,y:5};b.goal={kind:'item',x:2,y:5};a.cooldown=b.cooldown=1000;let passed=false;
 for(let i=0;i<300;i++){crew.update();if(overlap(crew.state.bots)>0)passed=true;}
 assert.ok(passed,'temporary overlap permits both committed routes through the narrow lane');assert.equal(a.pickupsCollected,1);assert.equal(b.pickupsCollected,1);separate(crew.state.bots);assert.ok(Math.abs(a.x-b.x)>100,'teammates resume distinct work instead of remaining piled up');
});
test('a later teammate requests shelter before bombing the blocked top corridor and replays the request exactly',{skip:!rom},()=>{
 const {p,crew,step}=setup({solid:true});for(const [x,y]of [[2,1],[3,1],[2,2],[5,1],[5,2]])p.RAM[0x44a+y*32+x]=0xca;for(const [x,y]of [[4,1],[2,3]])p.RAM[0x44a+y*32+x]=0xc2;
 const friend=crew.add(2,1),bomber=crew.add(3,1);friend.cooldown=1000;
 crew.update();assert.equal(bomber.bombsPlaced,0,'the stationary teammate is in the planned blast');assert.match(bomber.action,/Waiting for teammates/);
 for(let i=0;i<8;i++)step();assert.match(friend.action,/Making room/,'the earlier actor sees the later actor request on the following tick');assert.ok(friend.y>24,'the earlier actor actively evacuates down the side lane');
 const save=captureState(p),state=structuredClone(crew.state),tracker={...p._campaignTracker};
 for(let i=0;i<240;i++)step();const expected={ram:[...p.RAM],state:structuredClone(crew.state),pixels:Uint8ClampedArray.from(p.ImageData.data)};
 assert.ok(bomber.bombsPlaced>0,'the peer reservation does not veto the bomber escape route');assert.equal(tileKind(p,4,1),10,'the blocking wall is cleared');assert.ok(crew.state.bots.every(b=>b.alive),'the evacuation keeps both teammates alive');
 restoreState(p,save);crew.restore(state);Object.assign(p._campaignTracker,tracker);for(let i=0;i<240;i++)step();assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(crew.state,expected.state);assert.deepEqual(p.ImageData.data,expected.pixels);
});
test('a teammate may share the only safe refuge so a three-bot corridor can be opened',{skip:!rom},()=>{
 const {p,crew,step}=setup({solid:true});for(const [x,y]of [[2,1],[3,1],[2,2],[5,1],[5,2]])p.RAM[0x44a+y*32+x]=0xca;p.RAM[0x44a+1*32+4]=0xc2;
 const friend=crew.add(2,1),refuge=crew.add(2,2),bomber=crew.add(3,1);friend.cooldown=refuge.cooldown=1000;bomber.goal={kind:'block',x:4,y:1};let shared=false;
 for(let i=0;i<250;i++){step();if(overlap([friend,refuge])>0)shared=true;}
 assert.ok(shared,'a refuge occupied by an AI is still available when no free refuge exists');assert.ok(bomber.bombsPlaced>0);assert.equal(tileKind(p,4,1),10);assert.ok(crew.state.bots.every(b=>b.alive),'sharing the refuge does not relax the placement blast guard');
});
test('planned-bomb evacuation crosses teammates while avoiding an unrelated live bomb blast',{skip:!rom},()=>{
 const {p,crew}=setup({solid:true});for(const [x,y]of [[2,1],[3,1],[2,2],[2,3],[2,4],[3,2],[3,3]])p.RAM[0x44a+y*32+x]=0xca;p.RAM[0x44a+1*32+4]=0xc2;
 const friend=crew.add(2,1),bomber=crew.add(3,1);friend.cooldown=1000;bomber.goal={kind:'block',x:4,y:1};const active=spawnBomb(p,2,4,{slots:[0]});crew.state.bombRanges[active]=2;
 crew.update();assert.match(friend.action,/Making room/);assert.deepEqual({x:friend.target.x,y:friend.target.y},{x:3,y:1},'evacuation takes the peer-occupied route instead of entering the live blast at 2,2');assert.equal(bomber.bombsPlaced,0,'the bombing actor waits while the evacuation crosses its position');
 for(let i=0;i<80;i++){crew.update();assert.ok(!['2,2','2,3','2,4'].includes(tile(friend)),'a request does not permit crossing unrelated bomb danger');}
 assert.ok(bomber.bombsPlaced>0,'the safe evacuation still permits useful block clearing');
});
