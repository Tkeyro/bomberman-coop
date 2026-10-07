import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createWorldStart,validateWorldStart} from '../dist/world-start.js';import {createIntroSkip} from '../dist/intro.js';import {launchSequence} from '../dist/battle-ai.js';import {isCampaign,enemies} from '../dist/campaign.js';import {nativeEnemyAtlas,nativeEnemyPose} from '../dist/enemy-icons.js';import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;let bytes,title,titleTracker;
function setup(world,area=0){
 bytes??=fs.readFileSync(rom);const p=createMachine(bytes),start=createWorldStart(p),intro=createIntroSkip(p);
 if(!title){for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);title=captureState(p);titleTracker={...p._campaignTracker};}else{restoreState(p,title);Object.assign(p._campaignTracker,titleTracker);}
 const cards=[],get=p.Get;p.Get=function(address){const value=get.call(this,address);if(this.MPR[4]===9*8192&&this.PC===0x816c&&(address===0x284a||address===0x284b))cards.push([address,value]);return value;};
 start.configure(world,area);intro.configure(true);intro.request();
 const step=()=>{intro.update();p.Run();},launch=()=>frames(p,8,[[0,'RUN']]);
 return {p,start,intro,cards,step,launch};
}
function arrive(game,limit=1400){let frame=0;for(;frame<limit&&(game.start.state.pending||game.intro.state.pending);frame++)game.step();assert.ok(frame<limit,'the native loading sequence reaches play');assert.equal(game.start.state.pending,false);assert.equal(game.start.state.loading,false);assert.equal(game.intro.state.pending,false);assert.equal(isCampaign(game.p),true);return frame;}
function checkEnemyArt(p){
 for(const type of new Set(enemies(p).map(enemy=>enemy.type))){const atlas=nativeEnemyAtlas(p,type);for(const sprite of nativeEnemyPose(p,type)){const width=sprite.attribute&256?32:16,height=sprite.attribute&8192?64:sprite.attribute&4096?32:16,base=(sprite.pattern&p.SPAddressMask[width][height])<<5;for(let y=0;y<height;y++)for(let x=0;x<width;x+=16)for(let plane=0;plane<4;plane++){const index=(base|((y&48)<<3)|(y&15)|((x&16)<<2))+plane*16;assert.equal(p.VDC[0].VRAM[index],atlas.vram[index],`world ${p.RAM[0x84a]+1} loads native graphics for enemy ${type}`);}}}
}
function replay(game,save,start,intro,tracker,framesToRun){for(let i=0;i<framesToRun;i++)game.step();const expected={ram:[...game.p.RAM],pixels:Uint8ClampedArray.from(game.p.ImageData.data),start:structuredClone(game.start.state),intro:structuredClone(game.intro.state)};restoreState(game.p,save);game.start.restore(start);game.intro.restore(intro);Object.assign(game.p._campaignTracker,tracker);for(let i=0;i<framesToRun;i++)game.step();assert.deepEqual(game.p.RAM,expected.ram);assert.deepEqual(game.p.ImageData.data,expected.pixels);assert.deepEqual(game.start.state,expected.start);assert.deepEqual(game.intro.state,expected.intro);}
test('all eight starting worlds load native terrain, enemies and cards, then advance normally once',{skip:!rom},()=>{
 const families=[[2,2,2],[11,11,3,3,1],[18,12,4,1,1,0,0],[18,5,5,1,1,0,0],[14,14,14,6,6,6,1,0,0],[15,15,7,7,7,1,1,0,0,0],[19,16,16,8,8,1,1,1,0,0,0],[19,19,18,18,17,17,17,9,9,1,1,0,0,0,0]],sizes=[[15,12],[15,12],[15,31],[15,31],[31,12],[31,12],[31,12],[31,12]],floors=[0x3304,0x5322,0x0302,0x3304,0x1302,0x4320,0x3306,0x1302];
 for(let world=0;world<8;world++){
  const game=setup(world);game.launch();arrive(game);const {p,start,cards}=game,v=p.VDC[0];assert.deepEqual(p.RAM.slice(0x84a,0x84c),[world,0],'a world-0 menu choice starts the first regular stage');assert.deepEqual(enemies(p).map(enemy=>enemy.type),families[world]);assert.deepEqual(p.RAM.slice(0x434,0x436),sizes[world]);assert.equal(v.VRAM[2*v.VScreenWidth+4],floors[world]);checkEnemyArt(p);
  assert.ok(cards.some(([address,value])=>address===0x284a&&value===world));assert.ok(cards.some(([address,value])=>address===0x284b&&value===0));cards.length=0;
  for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=0;p.RAM[0xd96]=1;p.RAM[0x437]=1;let loading=false,frame=0;
  for(;frame<750;frame++){game.step();if(!isCampaign(p))loading=true;if(loading&&isCampaign(p)&&p.RAM[0x84a]===world&&p.RAM[0x84b]===1)break;}
  assert.ok(frame<750,'a normal native clear reaches the second area');assert.ok(frame>400,'native music, fades and announcement run');assert.deepEqual(p.RAM.slice(0x84a,0x84c),[world,1]);assert.equal(start.state.pending,false,'the selected start does not overwrite subsequent progression');assert.ok(enemies(p).length>0);checkEnemyArt(p);assert.ok(cards.some(([address,value])=>address===0x284a&&value===world));assert.ok(cards.some(([address,value])=>address===0x284b&&value===1));
 }
});
test('a nonzero checkpoint loads its world assets and replays saves before and during loading',{skip:!rom},()=>{
 const game=setup(5,3);game.launch();const {p,start,intro}=game;
 const pending=captureState(p),planned=structuredClone(start.state),opening=structuredClone(intro.state),tracker={...p._campaignTracker};assert.equal(planned.pending,true);assert.equal(planned.loading,false);replay(game,pending,planned,opening,tracker,250);assert.equal(start.state.loading,true);
 const loading=captureState(p),loaded=structuredClone(start.state),story=structuredClone(intro.state),tracking={...p._campaignTracker};replay(game,loading,loaded,story,tracking,650);arrive(game);assert.deepEqual(p.RAM.slice(0x84a,0x84c),[5,3]);assert.ok(enemies(p).length>0);checkEnemyArt(p);
 // Old controller saves lacking the added loading flag still arm a fresh boot.
 restoreState(p,pending);const legacy=structuredClone(planned);delete legacy.loading;start.restore(legacy);intro.restore(opening);Object.assign(p._campaignTracker,tracker);arrive(game);assert.deepEqual(p.RAM.slice(0x84a,0x84c),[5,3]);checkEnemyArt(p);
});
test('configuring an active game waits for its native death loader before restarting a checkpoint',{skip:!rom},()=>{
 const game=setup(1);game.launch();arrive(game);const {p,start}=game;start.configure(6,2);game.step();assert.equal(start.state.pending,true,'an ordinary play frame does not consume a pending checkpoint');assert.equal(start.state.loading,false);assert.deepEqual(p.RAM.slice(0x84a,0x84c),[1,0]);
 p.RAM[0x438]=2;p.RAM[0x43a]|=1;p.RAM[0x43c]=0;arrive(game);assert.deepEqual(p.RAM.slice(0x84a,0x84c),[6,2]);assert.ok(enemies(p).length>0);checkEnemyArt(p);assert.equal(p.RAM[0x438],1,'the native retry retains its ordinary life deduction');
});
test('starting-stage configuration and restore validate before changing state',{skip:!rom},()=>{
 const {start}=setup(0);const original=structuredClone(start.state);
 for(const world of [-1,8,1.5,'1'])assert.throws(()=>start.configure(world),/starting stage/);for(const area of [-1,8,1.5])assert.throws(()=>start.configure(0,area),/starting stage/);assert.deepEqual(start.state,original);
 assert.throws(()=>start.restore({pending:false,world:0,area:0,loading:true}),/starting stage/);assert.throws(()=>validateWorldStart({pending:true,world:0,area:0,unexpected:1}),/starting stage/);assert.deepEqual(start.state,original);
 start.restore({pending:false,world:7,area:6});assert.deepEqual(start.state,{pending:false,world:7,area:6,loading:false});
});
