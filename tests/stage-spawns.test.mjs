import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,campaignSpawnCells,canOccupy,dangerCells,enemies,findPath,isCampaign,playerPosition,stageID,tileKind} from '../dist/campaign.js';
import {createSpectator} from '../dist/spectator.js';
import {createNewCampaign} from '../dist/new-campaign.js';
import {createIntroSkip} from '../dist/intro.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';

const rom=process.env.BOMBERMAN_TEST_ROM;
function setup(watching=false){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>watching?null:playerPosition(p)}),watch=createSpectator(p,{getBots:()=>crew.state.bots}),intro=createIntroSkip(p);
 for(const action of launchSequence('solo').slice(0,3))frames(p,action.frames,action.button?[[0,action.button]]:[]);
 intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 assert.equal(isCampaign(p),true);watch.configure(watching);
 const step=()=>{watch.update();crew.update();p.Run();};return {p,crew,watch,step};
}
function clear(p){for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;p.RAM[0x437]=1;}
const identity=bot=>({id:bot.id,color:bot.color,bombBank:bot.bombBank,bombCapacity:bot.bombCapacity,fireRange:bot.fireRange,speedUp:bot.speedUp,remote:bot.remote,bombPass:bot.bombPass,wallPass:bot.wallPass,extraLives:bot.extraLives,pickupsCollected:bot.pickupsCollected,bombsPlaced:bot.bombsPlaced});

test('start cells stay in the connected opening area, allow shared floor when cramped, and exclude live hazards',{skip:!rom},()=>{
 const {p}=setup();for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM.fill(1,0x44a,0x44a+1024);
 for(const x of [2,3,4,7])p.RAM[0x44a+32+x]=10;
 assert.deepEqual(campaignSpawnCells(p,4,{blocked:new Set(['2,1'])}),[{x:3,y:1},{x:4,y:1},{x:3,y:1},{x:4,y:1}],'occupied starts do not block access through teammates or send later bots to the isolated tile');
 for(let y=1;y<=3;y++)for(let x=2;x<=10;x++)p.RAM[0x44a+y*32+x]=10;
 p.RAM[0x44a+2*32+3]=11;p.RAM[0x84f]=128;p.RAM[0x877]=5;p.RAM[0x89f]=2;p.RAM[0x84d]=1;
 p.RAM[0xd98]=128;p.RAM[0xdd8]=8*16+8;p.RAM[0xdb8]=0;p.RAM[0xe18]=3*16+8;p.RAM[0xdf8]=0;
 const cells=campaignSpawnCells(p,4),hazards=dangerCells(p),foes=enemies(p);
 assert.equal(cells.length,4);assert.equal(new Set(cells.map(c=>`${c.x},${c.y}`)).size,4);
 for(const cell of cells){assert.equal(tileKind(p,cell.x,cell.y),10);assert.equal(hazards.has(`${cell.x},${cell.y}`),false);assert.ok(foes.every(e=>Math.max(Math.abs(e.x-(cell.x*16+8)),Math.abs(e.y-(cell.y*16+8)))>=24));}
});

test('admin teammates migrate at the next native play frame near the actual start, with exact loading-save replay',{skip:!rom},()=>{
 const {p,crew,watch,step}=setup(true);
 const cells=campaignSpawnCells(p,4);for(const [i,cell]of cells.entries()){const bot=crew.add(cell.x,cell.y);bot.color=['black','orange','red','yellow'][i];bot.fireRange=3;bot.bombCapacity=2;bot.remote=true;bot.speedUp=true;bot.extraLives=1;bot.pickupsCollected=7;bot.bombsPlaced=11;bot.cooldown=1000;}
 // These admin-created actors ended their old round far from its opening.
 for(const [i,bot]of crew.state.bots.entries()){bot.x=168+i*16;bot.y=152;bot.target=null;bot.route=[];}
 const identities=crew.state.bots.map(identity),positions=crew.state.bots.map(b=>[b.x,b.y]);clear(p);
 let elapsed=0;for(;elapsed<300&&stageID(p)==='0:0';elapsed++)step();assert.equal(stageID(p),'0:1');assert.equal(isCampaign(p),false);assert.equal(crew.state.stage,'0:0');assert.deepEqual(crew.state.bots.map(b=>[b.x,b.y]),positions,'the old actors are not relocated while the new map is loading');
 const saved={core:captureState(p),crew:structuredClone(crew.state),watch:structuredClone(watch.state),tracker:{...p._campaignTracker}};
 for(let i=0;i<80;i++)step();const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),crew:structuredClone(crew.state),watch:structuredClone(watch.state)};
 restoreState(p,saved.core);crew.restore(saved.crew);watch.restore(saved.watch);Object.assign(p._campaignTracker,saved.tracker);for(let i=0;i<80;i++)step();
 assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.crew);assert.deepEqual(watch.state,expected.watch);
 for(;elapsed<700&&crew.state.stage!=='0:1';elapsed++)step();assert.equal(crew.state.stage,'0:1');assert.equal(crew.state.bots.length,4);assert.deepEqual(crew.state.bots.map(identity),identities);
 for(const bot of crew.state.bots){assert.equal(bot.alive,true);assert.ok(canOccupy(p,bot.x,bot.y,bot));assert.ok(Math.abs(bot.x-40)+Math.abs(bot.y-24)<80);assert.ok(findPath(p,{x:2,y:1},n=>n.x===Math.floor(bot.x/16)&&n.y===Math.floor(bot.y/16)));assert.ok(enemies(p).every(e=>Math.max(Math.abs(e.x-bot.x),Math.abs(e.y-bot.y))>=24));}
});

test('clearing and stale campaign frames defer stage migration; online actors revive with their assigned identities',{skip:!rom},()=>{
 const {p,crew}=setup(true),a=crew.add(3,1),b=crew.add(2,2);a.color='black';b.color='orange';a.x=168;a.y=88;b.alive=false;b.deathFrame=104;p._onlineCampaign={state:{enabled:true},control:()=>true};
 p.RAM[0x84b]=1;p.RAM[0x437]=1;crew.update();assert.equal(crew.state.stage,'0:0');assert.equal(a.x,168);assert.equal(b.alive,false);
 p.RAM[0x437]=0;p._campaignTracker.frame++;crew.update();assert.equal(crew.state.stage,'0:0','a recent old draw marker is not sufficient to choose new stage terrain');
 p._campaignTracker.last=p._campaignTracker.frame;crew.update();assert.equal(crew.state.stage,'0:1');assert.deepEqual(crew.state.bots.map(b=>b.color),['black','orange']);assert.ok(crew.state.bots.every(b=>b.alive));assert.ok(crew.state.bots.every(b=>canOccupy(p,b.x,b.y,b)));
});

test('generated campaign advance repositions existing admin teammates and keeps their colors, upgrades and count',{skip:!rom},()=>{
 const {p,crew,watch}=setup(true);let rounds=0;
 const generated=createNewCampaign(p,{getFocus:()=>watch.focus(),onRound:()=>{rounds++;if(crew.state.bots.some(b=>b.alive))crew.respawnForStage();else crew.reset();watch.configure(true);}});
 generated.configure(true,1,12345);generated.update();for(const cell of campaignSpawnCells(p,3)){const bot=crew.add(cell.x,cell.y);bot.color=['black','orange','red'][bot.id-1];bot.fireRange=4;bot.bombCapacity=3;bot.remote=true;bot.extraLives=2;bot.pickupsCollected=8;bot.bombsPlaced=12;bot.cooldown=1000;bot.x=328;bot.y=280;}
 const identities=crew.state.bots.map(identity),step=()=>{generated.update();watch.update();crew.update();p.Run();};clear(p);step();assert.equal(generated.state.transition.kind,'advance');
 let elapsed=0;for(;elapsed<700&&generated.state.transition;elapsed++)step();assert.equal(generated.state.transition,null);assert.equal(generated.state.round,2);assert.equal(rounds,2);assert.equal(crew.state.bots.length,3,'the initial one-player setting does not remove admin teammates');assert.deepEqual(crew.state.bots.map(identity),identities);
 for(const bot of crew.state.bots){assert.equal(bot.alive,true);assert.ok(canOccupy(p,bot.x,bot.y,bot));assert.ok(Math.abs(bot.x-40)+Math.abs(bot.y-24)<80);assert.ok(enemies(p).every(e=>Math.max(Math.abs(e.x-bot.x),Math.abs(e.y-bot.y))>=24));}
});
