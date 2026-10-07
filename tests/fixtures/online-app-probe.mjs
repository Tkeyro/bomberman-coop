import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {createLobbyHandler} from '../../server/lobby.js';

const root=new URL('../../',import.meta.url),html=fs.readFileSync(new URL('dist/index.html',root),'utf8');
const bytes=fs.readFileSync(process.env.BOMBERMAN_TEST_ROM),flush=()=>new Promise(resolve=>setImmediate(resolve));
const scenario=process.env.BOMBERMAN_ONLINE_APP_SCENARIO??'';
assert.ok(['','audio-hang','pause-delay','ack-timeout','guest-lag','player-departure','online-gameover','host-stream'].includes(scenario),'known online app scenario');
const same=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
function colorButton(app,color,group='room-color-options'){
 const buttons=app.e.get(group).children;assert.equal(buttons.length,8,`${group} offers all eight colors`);
 const button=buttons.find(button=>button.dataset.color===color);assert.ok(button,`${group} offers ${color}`);return button;
}
function assertColorUI(app,color,{disabled=false}={}){
 assert.equal(app.e.get('color-select').value,color);
 for(const group of ['color-options','room-color-options'])for(const button of app.e.get(group).children){
  assert.equal(button.attributes['aria-pressed'],String(button.dataset.color===color),`${group} ${button.dataset.color} selected state`);
  assert.equal(button.disabled,disabled,`${group} ${button.dataset.color} availability`);
 }
}
async function bombColorPreference(app,enabled){
 const checkbox=app.e.get('bomb-colors-toggle');assert.ok(checkbox,'owner bomb colors have a visible preference');
 checkbox.checked=enabled;await checkbox.listeners.change({target:checkbox});
 assert.equal(checkbox.checked,enabled);assert.equal(app.preference('bomberman-bomb-colors'),String(enabled),'the checkbox stores its local preference');
 if(app.machine)assert.equal(app.machine._fixtureCompanions.bombColorsEnabled,enabled,'the preference reaches the actual campaign renderer');
}
async function presentationOnlyBombPreference(app,enabled){
 const p=app.machine,gameplay=()=>JSON.stringify({registers:[p.PC,p.A,p.X,p.Y,p.S,p.P,p.ProgressClock],ram:p.RAM,companions:p._fixtureCompanions.state,online:p._onlineCampaign.state,shared:p._sharedPowerups.state,goal:p._levelObjective.state});
 const before=gameplay();await bombColorPreference(app,enabled);assert.equal(gameplay(),before,'a live color preference changes no state included in the multiplayer checksum');
}
class D1SQLite{
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');const journal=JSON.parse(fs.readFileSync(new URL('drizzle/meta/_journal.json',root),'utf8'));for(const entry of journal.entries)this.sqlite.exec(fs.readFileSync(new URL(`drizzle/${entry.tag}.sql`,root),'utf8'));}
 withSession(){return this;}
 prepare(sql){const db=this;return {bind(...values){return {sql,values,async first(){return db.sqlite.prepare(sql).get(...values)??null;},async all(){return {results:db.sqlite.prepare(sql).all(...values)};},async run(){const r=db.sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>{const r=this.sqlite.prepare(s.sql).run(...s.values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};});this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const db=new D1SQLite(),handler=createLobbyHandler();const requests=[];
async function fetchLobby(path,options){requests.push({path,method:options.method,body:options.body});return handler(new Request(new URL(path,'https://game.test/'),options),{DB:db});}
const peers=new Map(),channels=[];let peerSerial=0,delayPauseRequest=false,droppedLoaded=0;
const pendingPauseRequests=[];
let trackSerial=0;
class MediaTrack extends EventTarget{
 constructor(kind){super();this.kind=kind;this.id=`${kind}-${++trackSerial}`;this.readyState='live';this.enabled=true;this.contentHint='';}
 stop(){this.readyState='ended';}
}
class MediaStream{
 constructor(tracks=[]){this.tracks=[...tracks];}
 getTracks(){return [...this.tracks];}
 getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}
 getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}
 addTrack(track){if(!this.tracks.includes(track))this.tracks.push(track);}
}
class Channel extends EventTarget{
 constructor(label){super();this.label=label;this.readyState='connecting';this.bufferedAmount=0;this.sent=[];channels.push(this);}
 send(data){assert.equal(this.readyState,'open');this.sent.push(data);this.bufferedAmount+=Buffer.byteLength(data);const packet=JSON.parse(data);if(scenario==='ack-timeout'&&packet.type==='loaded'){droppedLoaded++;this.bufferedAmount=0;return;}const deliver=()=>{if(this.remote.readyState==='open')this.remote.onmessage?.({data});this.bufferedAmount=0;this.dispatchEvent(new Event('bufferedamountlow'));};if(delayPauseRequest&&packet.type==='pause-request')pendingPauseRequests.push(deliver);else queueMicrotask(deliver);}
 close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();this.remote?.close();}
}
class Peer{
 constructor(){this.id='peer-'+(++peerSerial);this.connectionState='new';this.localDescription=null;this.remoteDescription=null;this.candidates=[];this.senders=[];this.receivers=[];this.statsFrame=0;peers.set(this.id,this);}
 addTrack(track,stream){const sender={track,stream,parameters:{encodings:[{}]},getParameters(){return structuredClone(this.parameters);},async setParameters(value){this.parameters=structuredClone(value);}};this.senders.push(sender);return sender;}
 getReceivers(){return [...this.receivers];}
 async getStats(){const frames=++this.statsFrame*60,reports=new Map([['transport',{id:'transport',type:'transport',selectedCandidatePairId:'pair'}],['pair',{id:'pair',type:'candidate-pair',currentRoundTripTime:.02}]]);for(const receiver of this.receivers){const video=receiver.track.kind==='video',id='inbound-'+receiver.track.kind;reports.set(id,{id,type:'inbound-rtp',kind:receiver.track.kind,timestamp:this.statsFrame*1000,jitterBufferDelay:frames*(video ? .012 : .008),jitterBufferEmittedCount:frames,framesDecoded:video?frames:undefined,totalDecodeTime:video?frames*.002:undefined,framesPerSecond:video?60:undefined});}for(const sender of this.senders)if(sender.track.kind==='video')reports.set('outbound-video',{id:'outbound-video',type:'outbound-rtp',kind:'video',timestamp:this.statsFrame*1000,framesEncoded:frames,totalEncodeTime:frames*.003,framesPerSecond:60,qualityLimitationReason:'bandwidth'});return reports;}
 createDataChannel(label,options){assert.equal(options.ordered,true);return this.channel=new Channel(label);}
 async createOffer(){return {type:'offer',sdp:this.id};}
 async createAnswer(){return {type:'answer',sdp:this.id};}
 async setLocalDescription(description){this.localDescription=description;queueMicrotask(()=>this.connectionState!=='closed'&&this.onicecandidate?.({candidate:{candidate:'ice:'+this.id,toJSON(){return {candidate:this.candidate};}}}));this.connect();}
 async setRemoteDescription(description){assert.ok(peers.has(description.sdp));this.remoteDescription=description;this.connect();}
 async addIceCandidate(candidate){this.candidates.push(candidate);this.connect();}
 connect(){const other=peers.get(this.remoteDescription?.sdp);if(!other||!this.localDescription||!other.localDescription||!this.candidates.length||!other.candidates.length)return;const host=this.channel?this:other,guest=host===this?other:this;if(host.channel.remote)return;const channel=new Channel(host.channel.label);host.channel.remote=channel;channel.remote=host.channel;guest.channel=channel;guest.ondatachannel?.({channel});for(const p of [host,guest])p.connectionState='connected';for(const sender of host.senders){const receiver={track:sender.track,jitterBufferTarget:50,playoutDelayHint:.05};guest.receivers.push(receiver);queueMicrotask(()=>guest.connectionState!=='closed'&&guest.ontrack?.({track:sender.track,streams:[sender.stream],receiver}));}for(const c of [host.channel,channel]){c.readyState='open';queueMicrotask(()=>c.onopen?.());}}
 close(){this.connectionState='closed';this.channel?.close();}
}
async function app(name,id,color,gameMode='campaign',players=2,{rom=true}={}){
 const elements=new Map(),timers=new Map(),modules=new Map();let timerID=0,nextFrame,clock=1000,machine,exported,draws=0;
 const document={getElementById:id=>elements.get(id),activeElement:null,hidden:false,addEventListener(){},createElement:element};
 function element(){return {value:'',textContent:'',disabled:false,hidden:false,open:false,listeners:{},children:[],style:{},attributes:{},dataset:{},width:684,height:262,srcObject:null,playCalls:0,pauseCalls:0,captures:[],addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];this.textContent='';},focus(){document.activeElement=this;},click(){return this.listeners.click?.();},showModal(){this.open=true;},close(){this.open=false;},async play(){this.playCalls++;},pause(){this.pauseCalls++;},captureStream(fps){const value=new MediaStream([new MediaTrack('video')]);this.captures.push({fps,stream:value});return value;},getContext(){return {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){draws++;}};}};}
 for(const [tag,id]of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const node=element();node.disabled=/\bdisabled(?:\s|=|>)/.test(tag);node.hidden=/\bhidden(?:\s|=|>)/.test(tag);node.checked=/\bchecked(?:\s|=|>)/.test(tag);elements.set(id,node);}
 elements.get('color-select').value=color;elements.get('player-count-select').value='2';elements.get('room-name').value=name;
 if(elements.has('room-transport'))elements.get('room-transport').value='sync';
 const window={listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
 class AudioContext{
  constructor(){this.sampleRate=name==='Guest'?48000:44100;this.state='suspended';this.destination={};this.suspendCalls=0;this.unsettledCalls=0;}
  createScriptProcessor(){return {connect(){},disconnect(){}};}
  createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
  createMediaStreamDestination(){return {stream:new MediaStream([new MediaTrack('audio')])};}
  suspend(){this.state='suspended';this.suspendCalls++;if((name==='Tkeyro'&&this.suspendCalls===3)||(name==='Guest'&&this.suspendCalls===2)){this.unsettledCalls++;return new Promise(()=>{});}return Promise.resolve();}
  resume(){this.state='running';return Promise.resolve();}
 }
 const audioEnabled=['audio-hang','host-stream'].includes(scenario);if(audioEnabled)window.AudioContext=AudioContext;
 class LocalURL extends URL{static createObjectURL(blob){exported=blob;return 'blob:test';}static revokeObjectURL(){}}
 const storage=new Map([['bomberman-player-id',id]]);
 const context=vm.createContext({console,document,window,...(audioEnabled?{AudioContext}:{}),MediaStream,Blob,Response,Request,Headers,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,structuredClone,crypto:webcrypto,fetch:fetchLobby,RTCPeerConnection:Peer,URL:LocalURL,location:{href:'https://game.test/'},navigator:{},Event,EventTarget,atob,btoa,queueMicrotask,indexedDB:undefined,performance:{now:()=>clock},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:fn=>{nextFrame=fn;},setTimeout:(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 async function module(url){const key=url.href;if(modules.has(key))return modules.get(key);let source=fs.readFileSync(url,'utf8');
  // Retain the real controllers for state and presentation assertions. This
  // fixture-only exposure changes no CPU, rendering, state or input behavior.
  if(key.endsWith('/dist/campaign.js')){const marker='return {state,add,update,respawnForStage,setBombColors';assert.ok(source.includes(marker));source=source.replace(marker,'return p._fixtureCompanions={state,add,update,respawnForStage,setBombColors');}
  if(key.endsWith('/dist/admin-levels.js')){const marker='return {state,jumpOriginal';assert.ok(source.includes(marker));source=source.replace(marker,'return p._fixtureAdminLevels={state,jumpOriginal');}
  const result=new vm.SourceTextModule(source,{context,identifier:key,initializeImportMeta:meta=>{meta.url=key;}});modules.set(key,result);return result;}
 async function load(path){const result=await module(new URL(path,root));if(result.status==='unlinked')await result.link((specifier,parent)=>module(new URL(specifier,parent.identifier)));if(result.status==='linked')await result.evaluate();return result.namespace;}
 const vendor=await load('dist/vendor/pce.js'),setCanvas=vendor.PCE.prototype.SetCanvas;vendor.PCE.prototype.SetCanvas=function(id){machine=this;return setCanvas.call(this,id);};
 await load('dist/app.js');
 const result={name,id,e:elements,window,load,timers,context,preference:key=>storage.get(key),get machine(){return machine;},get exported(){return exported;},get draws(){return draws;},
  async key(code,up=false){window.listeners[up?'keyup':'keydown']({code,preventDefault(){}});await flush();},
  tick(){clock+=50;nextFrame(clock);},
  costRuns(ms){const original=machine.Run;machine.Run=function(...args){const result=original.apply(this,args);clock+=ms;return result;};return ()=>{machine.Run=original;};},
  async poll(){const pending=[...timers].filter(([,t])=>t.ms===1000);for(const [id,t]of pending){timers.delete(id);await t.fn();}await flush();},
  async export(){await elements.get('export-save-btn').click();assert.match(elements.get('save-status').textContent,/exported/);return (await load('dist/save-state.js')).decodeSave(exported);},
 status(){return [elements.get('load-status').textContent,elements.get('room-status').textContent,elements.get('save-status').textContent].join(' | ');}
 };
 assert.equal(elements.get('bomb-colors-toggle').checked,true,'owner colors default on before loading a ROM');
 await bombColorPreference(result,false);await bombColorPreference(result,true);
 await bombColorPreference(result,name==='Guest'||name==='Battle guest');
 assert.equal(machine,undefined,'changing the preference before ROM loading does not construct an emulator');
 // Color choice works before ROM loading, and both visible groups agree.
 assert.equal(colorButton(result,'original','color-options').disabled,false);
 await colorButton(result,'original','color-options').click();assertColorUI(result,'original');
 await colorButton(result,color,'color-options').click();assertColorUI(result,color);
 if(!rom){assert.equal(machine,undefined,'a stream guest has not constructed an emulator');await elements.get('join-online-btn').click();assert.equal(elements.get('online-room-dialog').open,true,result.status());return result;}
 await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});assert.match(elements.get('load-status').textContent,/verified/,result.status());
 assert.equal(machine._fixtureCompanions.bombColorsEnabled,elements.get('bomb-colors-toggle').checked,'the stored preference applies when the ROM initializes');
 assertColorUI(result,color);
 for(let i=0;i<110;i++)result.tick();
 await result.key('ArrowDown');await result.key('ArrowDown');if(gameMode==='battle')await result.key('ArrowDown');if(players!==2){elements.get('player-count-select').value=String(players);elements.get('player-count-select').listeners.change({target:{value:String(players)}});}await result.key('Enter');await result.key('ArrowDown');await result.key('Enter');assert.equal(elements.get('online-room-dialog').open,true,result.status());
 return result;
}
const host=await app('Tkeyro','host-player-00001','black','campaign',scenario==='player-departure'?3:2),guest=await app('Guest','guest-player-0001','orange','campaign',2,{rom:scenario!=='host-stream'});let third;
if(scenario==='host-stream'){
 host.e.get('room-transport').value='stream';await host.e.get('room-transport').listeners.change?.({target:{value:'stream'}});
 const key=host.e.get('room-create-code');key.value='bad key';const before=requests.filter(request=>request.path==='/api/rooms'&&request.method==='POST').length;
 await host.e.get('create-room').click();assert.match(host.status(),/letters.*numbers/i,'an invalid key shows a useful format error');assert.equal(key.value,'bad key','a rejected key remains available for correction');assert.equal(key.disabled,false);assert.equal(host.e.get('game-canvas').captures.length,0,'invalid keys are rejected before creating media');assert.equal(requests.filter(request=>request.path==='/api/rooms'&&request.method==='POST').length,before,'invalid keys are rejected before sending creation');
 key.value=' tayLor7 ';
}
async function negotiate(){for(let i=0;i<12;i++){await host.poll();await guest.poll();if(third)await third.poll();if(!host.e.get('room-start').disabled)return;}assert.fail(host.status()+' / '+guest.status());}
async function join(){
 await host.e.get('create-room').click();const code=host.e.get('room-code').value;
 if(scenario==='host-stream'){
  assert.equal(code,'TAYLOR7','the server confirms a canonical custom key');
  const created=requests.filter(request=>request.path==='/api/rooms'&&request.method==='POST').at(-1);assert.ok(created);assert.equal(JSON.parse(created.body).code,'tayLor7','creation forwards the requested key after trimming outer spaces');
  assert.equal(host.e.get('room-create-code').disabled,true,'the creation key is fixed while in a room');
  await host.e.get('room-copy').click();assert.match(host.e.get('room-status').textContent,/Invite link: https:\/\/game\.test\/\?room=TAYLOR7/,'invite links use the confirmed custom key');
 }else {assert.match(code,/^[A-Z2-9]{10}$/);const created=requests.filter(request=>request.path==='/api/rooms'&&request.method==='POST').at(-1);assert.equal(Object.hasOwn(JSON.parse(created.body),'code'),false,'blank custom key preserves random creation');}
 guest.e.get('room-code').value=scenario==='host-stream'?' taylor7 ':code;await guest.e.get('join-room').click();assert.equal(guest.e.get('room-code').value,code,'joining accepts a typed key without case-sensitive matching');await guest.e.get('room-ready').click();await negotiate();assert.equal(host.e.get('room-list').children.length,2);assert.equal(guest.e.get('room-list').children.length,2);assert.match(host.e.get('room-list').children[1].children[0].title,/orange/);return code;
}
async function synchronize(){await host.e.get('room-start').click();for(let n=0;n<700;n++){host.tick();await flush();if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));if(guest.e.get('online-room-dialog').open===false&&guest.e.get('pause-btn').textContent==='Pause')return;}assert.fail(host.status()+' / '+guest.status()+JSON.stringify({frame:host.e.get('frame-count').textContent,campaign:host.machine._onlineCampaign.state,stage:host.machine.RAM.slice(0x84a,0x84c),packets:channels.map(c=>c.sent.slice(-3).map(s=>JSON.parse(s).type))}));}
async function advance(count){for(let i=0;i<count;i++){host.tick();await flush();guest.tick();await flush();if(third){third.tick();await flush();}assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|out of sync|frame order|different roster/);}}
async function humansMoveAfterTravel({stream=false}={}){
 const p=host.machine,campaign=await host.load('dist/campaign.js');
 for(const [index,app]of [host,guest].entries()){
  const actor=p._fixtureCompanions.state.bots.find(actor=>actor.id===p._onlineCampaign.state.roster[index].id);assert.ok(actor?.alive,'the arriving human can play');
  const x=Math.floor(actor.x/16),y=Math.floor(actor.y/16),direction=[[1,0,'ArrowRight'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[0,-1,'ArrowUp']].find(([dx,dy])=>campaign.tileKind(p,x+dx,y+dy)===10);assert.ok(direction,'the stage entrance gives the arriving human an open corridor');
  const before={x:actor.x,y:actor.y};app.e.get(stream&&index===1?'stream-video':'game-canvas').focus();await app.key(direction[2]);await advance(3);await app.key(direction[2],true);await advance(1);
  assert.ok(Math.abs(actor.x-before.x)+Math.abs(actor.y-before.y)>.5,`${index?'guest':'host'} keyboard input moves its own actor after native level loading`);
 }
 if(!stream){same(p.RAM,guest.machine.RAM);same(p._fixtureCompanions.state,guest.machine._fixtureCompanions.state);}
}
async function hostAdminEdits({stream=false}={}){
 const p=host.machine,campaign=await host.load('dist/campaign.js'),members=p._onlineCampaign.state.roster.map(r=>r.id),humans=()=>p._fixtureCompanions.state.bots.filter(actor=>members.includes(actor.id)).map(actor=>({id:actor.id,x:actor.x,y:actor.y,alive:actor.alive}));
 const before={room:host.e.get('room-code').value,stage:Array.from(p.RAM.slice(0x84a,0x84c)),lives:p.RAM[0x438],humans:humans()};
 assert.equal(guest.e.get('admin-btn').disabled,true,'only the multiplayer host owns the admin button');
 const guestTools=guest.e.get('spawn-tool').textContent;
 await guest.key('F2');await guest.e.get('admin-btn').click();await guest.e.get('item-grid').children[0].click();await guest.e.get('spawn-bot').click();await guest.e.get('spawn-bomb').click();guest.e.get('admin-world').value='4';guest.e.get('admin-area').value='3';await guest.e.get('admin-go-level').click();
 assert.equal(guest.e.get('admin-dialog').open,false,'guest hotkeys and programmatic buttons cannot open admin');assert.equal(guest.e.get('spawn-tool').textContent,guestTools,'guest programmatic tools cannot start placement');
 same(p.RAM.slice(0x84a,0x84c),before.stage);assert.equal(p._fixtureAdminLevels.state.pending,false,'a guest cannot queue a host level jump');
 if(!stream)assert.equal(guest.machine._fixtureAdminLevels.state.pending,false,'a guest cannot queue a local level jump');
 assert.equal(host.e.get('admin-btn').disabled,false);await guest.key('KeyD');await host.key('F2');assert.equal(host.e.get('admin-dialog').open,true,'host F2 opens the multiplayer inventory');
 await guest.key('KeyD',true);
 for(const app of [host,guest])assert.equal(app.e.get('pause-btn').textContent,'Resume','opening the host inventory pauses everyone');
 const frame=p._onlineCampaign.state.frame;await advance(2);assert.equal(p._onlineCampaign.state.frame,frame,'no gameplay advances while admin places objects');
 async function tile(x,y){const button=host.e.get('admin-map').children.find(button=>button.title===`Tile ${x}, ${y}`);assert.ok(button,`admin exposes tile ${x}, ${y}`);assert.equal(button.disabled,false);await button.click();}
 const items=campaign.pickups(p).length,enemies=campaign.enemies(p).length,bots=p._fixtureCompanions.state.bots.length;
 await host.e.get('item-grid').children[0].click();await tile(20,15);await tile(21,15);assert.equal(campaign.pickups(p).length,items+2,'one item selection places copies on multiple tiles');
 const monster=host.e.get('enemy-grid').children.find(button=>/^Monster type 0\./.test(button.attributes['aria-label']));assert.ok(monster);assert.equal(monster.disabled,false);await monster.click();await tile(22,15);assert.equal(campaign.enemies(p).length,enemies+1,'the host spawns an original enemy in the shared map');
 await host.e.get('spawn-bot').click();await tile(23,15);assert.equal(p._fixtureCompanions.state.bots.length,bots+1,'the host adds an AI teammate without changing the human roster');
 const spawned=p._fixtureCompanions.state.bots.at(-1).id;
 const boss=host.e.get('enemy-grid').children.find(button=>/^Boss model 23\./.test(button.attributes['aria-label']));assert.ok(boss);assert.equal(boss.disabled,false,'an original boss model is available on this regular map');await boss.click();await tile(25,15);
 const bossActor=p._bossSpawns.state.actors.find(actor=>actor.type===23);assert.ok(bossActor);assert.equal(bossActor.hp,3,'the admin boss starts with three hits');
 same(humans(),before.humans);same(p._onlineCampaign.state.roster.map(r=>r.id),members);
 await host.e.get('admin-close').click();await flush();
 for(let n=0;n<120&&![host,guest].every(app=>app.e.get('pause-btn').textContent==='Pause');n++){
  await advance(1);if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(host.e.get('admin-dialog').open,false);for(const app of [host,guest])assert.equal(app.e.get('pause-btn').textContent,'Pause','closing the host inventory resumes the existing room after synchronization');
 assert.equal(host.e.get('room-code').value,before.room);assert.equal(guest.e.get('room-code').value,before.room);same(p.RAM.slice(0x84a,0x84c),before.stage);assert.equal(p.RAM[0x438],before.lives);same(humans(),before.humans);
 await advance(1);same(humans(),before.humans);assert.equal(p._onlineCampaign.state.inputs[1],0,'releasing a guest key while admin is paused does not leave stale movement on Resume');
 assert.ok(p._fixtureCompanions.state.bots.some(actor=>actor.id===spawned));assert.equal(campaign.pickups(p).length,items+2);
 if(!stream){same(host.machine.RAM,guest.machine.RAM);same(p._fixtureCompanions.state,guest.machine._fixtureCompanions.state);same(p._bossSpawns.state,guest.machine._bossSpawns.state);assert.equal(host.machine.PC,guest.machine.PC,'admin snapshot keeps both native machines synchronized');assert.equal(guest.machine._fixtureCompanions.bombColorsEnabled,true,'admin snapshot preserves the guest display preference');}
 // Opening inventory while already paused must finish its edit handshake
 // without silently starting the round. Resume remains the host's choice.
 await host.e.get('pause-btn').click();await flush();await host.key('F2');assert.equal(host.e.get('admin-dialog').open,true);
 await host.e.get('item-grid').children[0].click();await tile(26,15);
 assert.equal(campaign.bombs(p).filter(bomb=>bomb.slot<10).length,0,'the separate native admin bank starts empty');
 await host.e.get('spawn-bomb').click();for(let x=8;x<22;x++)await tile(x,17);
 assert.equal(campaign.bombs(p).filter(bomb=>bomb.slot<10).length,10,'the first ten admin bombs use the original native slots');assert.equal(p._adminBombs.state.pending.length,4,'further placements wait without a numeric brush cap');
 assert.equal(host.e.get('spawn-bomb').attributes['aria-pressed'],'true','queued overflow keeps the Bomb brush selected');assert.match(host.e.get('admin-bomb-queue').textContent,/4 bomb placements queued/);
 for(const pending of p._adminBombs.state.pending){const button=host.e.get('admin-map').children.find(tile=>tile.title===`Tile ${pending.x}, ${pending.y}`);assert.ok(button.className.includes('queued'));assert.equal(button.disabled,true,'a queued tile rejects a duplicate placement');}
 const bombQueue=JSON.parse(JSON.stringify(p._adminBombs.state)),queuedSave=await host.export();same(queuedSave.session.adminBombs,bombQueue);assert.equal(queuedSave.session.adminLevels.pending,false,'an idle level controller is saved alongside the pending bombs');
 const pausedNative={ram:Array.from(p.RAM),pc:p.PC,humans:humans()};await host.e.get('admin-close').click();await flush();
 if(!stream)for(let n=0;n<120&&!/Admin changes synchronized/.test(host.status()+guest.status());n++){await advance(1);await new Promise(resolve=>setTimeout(resolve,5));}
 for(const app of [host,guest])assert.equal(app.e.get('pause-btn').textContent,'Resume','admin opened from Pause keeps the existing round paused');
 same(p.RAM,pausedNative.ram);assert.equal(p.PC,pausedNative.pc);same(humans(),pausedNative.humans);
 if(!stream){assert.match(host.status(),/Admin changes synchronized/);same(p.RAM,guest.machine.RAM);same(p._bossSpawns.state,guest.machine._bossSpawns.state);same(p._adminBombs.state,guest.machine._adminBombs.state);same(p._adminBombs.state,bombQueue);}
 await host.e.get('pause-btn').click();await flush();for(const app of [host,guest])assert.equal(app.e.get('pause-btn').textContent,'Pause','the host can resume after paused admin edits');
 return true;
}
async function hostAdminLevelJump({stream=false}={}){
 const p=host.machine,team=()=>p._fixtureCompanions.state.bots.map(actor=>Object.fromEntries(['id','color','bombBank','bombCapacity','fireRange','speedUp','remote','bombPass','wallPass','extraLives'].map(key=>[key,actor[key]])));
 const before={room:host.e.get('room-code').value,lives:p.RAM[0x438],team:team(),shared:JSON.parse(JSON.stringify(p._sharedPowerups.state)),roster:JSON.parse(JSON.stringify(p._onlineCampaign.state.roster))};
 await host.e.get('pause-btn').click();await flush();await host.key('F2');assert.equal(host.e.get('admin-dialog').open,true);
 host.e.get('admin-world').value='4';host.e.get('admin-area').value='3';await host.e.get('admin-go-level').click();await flush();
 assert.equal(host.e.get('admin-dialog').open,false,'Go to level accepts the selection and closes the paused admin console');
 assert.equal(p._fixtureAdminLevels.state.pending,true);same(p._fixtureAdminLevels.state.target,{kind:'original',world:4,area:3});assert.ok((p.RAM[0x43a]&7)||p.RAM[0x437],'level selection requests the original ROM stage loader');
 assert.equal(p._adminBombs.state.pending.length,0,'a requested level discards queued bombs from the old map');
 if(!stream)for(let n=0;n<120&&!/Admin changes synchronized/.test(host.status()+guest.status());n++){await advance(1);await new Promise(resolve=>setTimeout(resolve,5));}
 for(const app of [host,guest])assert.equal(app.e.get('pause-btn').textContent,'Resume','selecting a level from Pause keeps its native transition paused until Resume');
 if(!stream){same(p.RAM,guest.machine.RAM);same(p._fixtureAdminLevels.state,guest.machine._fixtureAdminLevels.state);same(p._adminBombs.state,guest.machine._adminBombs.state);}
 const pending=await host.export();same(pending.session.adminLevels,p._fixtureAdminLevels.state);assert.equal(pending.session.adminLevels.pending,true,'a save includes the unfinished native level jump');same(pending.session.adminBombs,p._adminBombs.state);
 await host.e.get('pause-btn').click();await flush();
 for(let n=0;n<700&&p._fixtureAdminLevels.state.pending;n++)await advance(1);
 assert.equal(p._fixtureAdminLevels.state.pending,false,'the native loader completes the requested world and area');assert.equal(p.RAM[0x84a],4);assert.equal(p.RAM[0x84b],3);assert.equal(p.RAM[0x43a]&7,0);assert.equal(p.RAM[0x437],0);
 assert.equal(p.RAM[0x438],before.lives,'admin travel costs no life');same(team(),before.team);same(p._sharedPowerups.state,before.shared);same(p._onlineCampaign.state.roster,before.roster);
 assert.ok(p._fixtureCompanions.state.bots.filter(actor=>actor.alive).every(actor=>actor.x<150&&actor.y<150),'living teammates arrive through the safe stage entrance');
 assert.equal(host.e.get('room-code').value,before.room);assert.equal(guest.e.get('room-code').value,before.room);
 if(stream){assert.equal(guest.machine,undefined,'a streamed level jump still runs only the host emulator');assert.equal(guest.e.get('stream-video').srcObject.getVideoTracks()[0].readyState,'live','level travel keeps the same live media connection');}
 else{same(p.RAM,guest.machine.RAM);same(p._fixtureCompanions.state,guest.machine._fixtureCompanions.state);same(p._fixtureAdminLevels.state,guest.machine._fixtureAdminLevels.state);assert.equal(p.PC,guest.machine.PC,'both computers arrive with the same native CPU state');}
 await humansMoveAfterTravel({stream});
 return pending;
}
await join();
if(scenario==='player-departure'){third=await app('Third','third-player-0001','blue');third.e.get('room-code').value=host.e.get('room-code').value;await third.e.get('join-room').click();await third.e.get('room-ready').click();await negotiate();assert.equal(host.e.get('room-list').children.length,3);}
// The picker is inside the modal. Changing a ready player's color updates the
// confirmed roster, clears readiness and keeps both UI groups synchronized.
const changingColor=colorButton(guest,'yellow').click();assertColorUI(guest,'orange',{disabled:true});
await changingColor;await flush();await host.poll();await guest.poll();
assertColorUI(guest,'yellow');assert.equal(guest.e.get('room-ready').textContent,'Ready');assert.equal(host.e.get('room-start').disabled,true);
for(const a of [host,guest]){assert.equal(a.e.get('room-list').children[1].children[0].title,'yellow');assert.equal(a.e.get('room-list').children[1].children[2].textContent,'Choosing');}
await colorButton(guest,'orange').click();await flush();await guest.e.get('room-ready').click();await negotiate();assertColorUI(guest,'orange');
if(scenario==='ack-timeout'){
 await host.e.get('room-start').click();for(let n=0;n<700&&guest.e.get('online-room-dialog').open;n++){host.tick();await flush();if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(guest.e.get('online-room-dialog').open,false,'guest received and applied the host snapshot');assert.equal(droppedLoaded,1,'guest acknowledgement is lost');
 const watchdog=[...host.timers].find(([,t])=>t.ms===45000);assert.ok(watchdog,'startup waiting has a bounded watchdog');host.timers.delete(watchdog[0]);await watchdog[1].fn();await flush();
 assert.match(host.status(),/Online startup timed out/);assert.match(guest.status(),/Online startup timed out/);
 const frames=[host,guest].map(a=>a.e.get('frame-count').textContent);
 await host.e.get('pause-btn').click();await guest.e.get('pause-btn').click();await flush();
 for(let n=0;n<3;n++){host.tick();guest.tick();await flush();}
 assert.deepEqual([host,guest].map(a=>a.e.get('frame-count').textContent),frames,'Resume cannot run a game whose startup handshake failed');
 assert.match(host.status(),/Online startup timed out/);assert.match(guest.status(),/Online startup timed out/);
 assert.equal(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='frames')),false,'no authority frames are emitted before everyone has loaded');
 await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,startupTimeout:true,blockedResume:true,droppedLoaded}));
}else{
await synchronize();await advance(5);assertColorUI(host,'black',{disabled:true});assertColorUI(guest,'orange',{disabled:true});
if(scenario==='host-stream'){
 const video=guest.e.get('stream-video'),canvas=host.e.get('game-canvas'),campaign=await host.load('dist/campaign.js');
 assert.equal(guest.machine,undefined,'a joined stream guest never constructs PCE or loads the ROM');assert.equal(guest.draws,0,'a guest does not draw emulated frames');
 assert.equal(video.hidden,false);assert.equal(guest.e.get('game-canvas').hidden,true);assert.ok(video.srcObject);assert.ok(video.playCalls>0,'received media is offered to video playback');
 assert.equal(video.srcObject.getVideoTracks().length,1);assert.equal(video.srcObject.getAudioTracks().length,1,'the emulator audio branch arrives with video');
 assert.equal(video.muted,true,'initial autoplay remains muted until the guest gestures');await video.click();await flush();assert.equal(video.muted,false,'clicking the video unlocks stream audio');
 await guest.e.get('mute-btn').click();assert.equal(video.muted,true);await guest.e.get('mute-btn').click();assert.equal(video.muted,false,'a guest can mute and unmute without a native machine');
 await guest.e.get('player-count-select').listeners.change({target:{value:'3'}});assert.equal(guest.machine,undefined,'the inactive native count picker is safe in a no-ROM guest');
 assert.ok(canvas.captures.some(c=>c.fps===60));assert.ok([...peers.values()].some(p=>p.senders.some(s=>s.track.kind==='video'&&s.parameters.encodings[0].maxBitrate===2500000)),'transport applies its optional video rate limit');
 assert.ok([...peers.values()].some(p=>p.senders.some(s=>s.track.kind==='video'&&s.parameters.degradationPreference==='maintain-framerate')),'the stream sender prefers timely frames when the encoder must adapt');
 const receivers=[...peers.values()].flatMap(p=>p.receivers);assert.equal(receivers.length,2);assert.ok(receivers.every(receiver=>receiver.jitterBufferTarget===0),'supported video and audio receivers request minimum additional buffering');
 for(const id of ['save-btn','export-save-btn','admin-btn'])assert.equal(guest.e.get(id).disabled,true,`${id} belongs to the emulator host`);
 assert.equal(guest.e.get('bomb-colors-toggle').disabled,true,'streamed guests watch the host color preference');assert.equal(host.e.get('bomb-colors-toggle').disabled,false);
 for(const a of [host,guest]){await a.e.get('join-online-btn').click();assert.equal(a.e.get('online-room-dialog').open,false,'Join cannot replace a playing session with the lobby phase');assert.equal(a.e.get('pause-btn').textContent,'Pause');}
 const actors=new Map(),control=host.machine._onlineCampaign.control;
 host.machine._onlineCampaign.control=function(actor){actors.set(actor.id,actor);return control(actor);};await advance(1);assert.equal(actors.size,2);
 host.machine.RAM.fill(0,0xd98,0xdb8);host.machine.RAM.fill(0,0xf9b,0xfb4);host.machine._levelObjective.state.enabled=false;host.machine.RAM[0x434]=31;host.machine.RAM[0x435]=21;
 for(let y=1;y<21;y++)for(let x=2;x<31;x++)host.machine.RAM[0x44a+y*32+x]=0xca;
 const before=actors.get(2).x;await guest.key('ArrowRight');
 for(let n=0;n<12;n++){host.tick();await flush();}
 await guest.key('ArrowRight',true);assert.ok(actors.get(2).x>before+15,'streamed guest controls move only the host actor');
 await guest.e.get('pause-btn').click();await flush();for(const a of [host,guest])assert.equal(a.e.get('pause-btn').textContent,'Resume','a streamed guest can pause the shared game');
 const pausedFrame=host.machine._onlineCampaign.state.frame;await advance(3);assert.equal(host.machine._onlineCampaign.state.frame,pausedFrame,'the host emulator remains paused');
 assert.equal(video.srcObject.getVideoTracks()[0].readyState,'live','Pause keeps the existing media connection');await guest.e.get('pause-btn').click();await flush();for(const a of [host,guest])assert.equal(a.e.get('pause-btn').textContent,'Pause','a streamed guest can request Resume');
 await advance(45);assert.ok(host.machine._onlineCampaign.state.frame>pausedFrame);assert.equal(guest.machine,undefined,'Pause and Resume do not create a guest emulator');
 assert.match(guest.e.get('online-health').textContent,/60 video FPS/);assert.match(guest.e.get('online-health').textContent,/20 ms round trip/);assert.match(guest.e.get('online-health').textContent,/Video buffer 12 ms/);assert.match(guest.e.get('online-health').textContent,/Decode 2 ms/);
 assert.match(host.e.get('online-health').textContent,/Encode 3 ms/);assert.match(host.e.get('online-health').textContent,/Encoder limited by bandwidth/);
 const remote=actors.get(2);remote.x=Math.floor(remote.x/16)*16+8;remote.y=Math.floor(remote.y/16)*16+8;
 campaign.spawnItem(host.machine,1,Math.floor(remote.x/16),Math.floor(remote.y/16));await advance(2);assert.equal(host.machine._sharedPowerups.state.counts[1],1,'streamed teams still share upgrades');
 // Exercise the real keyboard handlers and ordered peer input, rather than
 // calling online controls directly. A shared Remote Control pickup must let
 // each person release their own held bombs all the way through native flames.
 const local=actors.get(1);Object.assign(local,{x:56,y:56});Object.assign(remote,{x:184,y:56});
 campaign.spawnItem(host.machine,2,11,3);await advance(2);
 assert.equal(host.machine._sharedPowerups.state.counts[2],1);assert.equal(local.remote,true);assert.equal(remote.remote,true,'the guest pickup shares Remote Control with both players');
 async function placeFromKeyboard(app,actor,x,y){
  actor.x=x*16+8;actor.y=y*16+8;const placed=actor.bombsPlaced;
  await app.key('Space');await advance(1);await app.key('Space',true);
  assert.equal(actor.bombsPlaced,placed+1,'each streamed player places its own bomb from keyboard input');
  const bomb=campaign.bombs(host.machine).find(b=>b.x===x&&b.y===y&&campaign.companionBombSlots(actor).includes(b.slot));assert.ok(bomb,'the native bomb belongs to the actor who placed it');
  actor.y=120;return bomb;
 }
 const localBomb=await placeFromKeyboard(host,local,3,3),guestBomb=await placeFromKeyboard(guest,remote,11,3);
 assert.equal(host.machine._fixtureCompanions.state.bombColors[localBomb.slot],'black');assert.equal(host.machine._fixtureCompanions.state.bombColors[guestBomb.slot],'orange');
 await presentationOnlyBombPreference(host,true);await presentationOnlyBombPreference(host,false);
 await advance(65);
 for(const bomb of [localBomb,guestBomb]){assert.equal(host.machine.RAM[0x917+bomb.slot],255,'Remote Control holds bombs past the normal fuse');assert.ok(host.machine.RAM[0x8ef+bomb.slot]>100);}
 async function expectFlames(bomb){
  for(let n=0;n<12;n++){
   if([11,12].includes(campaign.tileKind(host.machine,bomb.x,bomb.y))&&[11,12].includes(campaign.tileKind(host.machine,bomb.x+1,bomb.y)))return;
   await advance(1);
  }
  assert.fail(`keyboard detonation did not create native center and neighboring flames for bomb ${bomb.slot}`);
 }
 await host.key('KeyB');await expectFlames(localBomb);
 assert.equal(host.machine.RAM[0x917+guestBomb.slot],255,'host B does not release the guest bomb');assert.ok(host.machine.RAM[0x8ef+guestBomb.slot]>100);
 await host.key('KeyB',true);await guest.key('KeyX');await expectFlames(guestBomb);await guest.key('KeyX',true);
 await advance(35);
 for(const bomb of [localBomb,guestBomb]){assert.equal(host.machine.RAM[0x84f+bomb.slot],0,'native flames finish and return the owner bomb slot');assert.equal(campaign.tileKind(host.machine,bomb.x,bomb.y),10);}
 const repeated=await placeFromKeyboard(guest,remote,11,3);await advance(3);
 assert.equal(host.machine.RAM[0x917+repeated.slot],255,'releasing X leaves a newly placed remote bomb held');
 await guest.key('KeyX');await expectFlames(repeated);await guest.key('KeyX',true);await advance(35);
 assert.equal(host.machine.RAM[0x84f+repeated.slot],0,'a second press of X detonates the next bomb');
 assert.ok(channels.some(c=>c.sent.some(data=>{const packet=JSON.parse(data);return packet.type==='input'&&packet.mask===32;})),'guest X crosses the data channel as Button II');
 await hostAdminEdits({stream:true});
 await hostAdminLevelJump({stream:true});
 const frame=host.machine._onlineCampaign.state.frame;
 for(let n=0;n<50;n++){host.tick();await flush();}
 assert.ok(host.machine._onlineCampaign.state.frame-frame>100,'host streaming advances without guest simulation acknowledgements or callbacks');
 assert.equal(guest.machine,undefined);assert.equal(guest.draws,0);
 const packets=channels.flatMap(c=>c.sent.map(s=>JSON.parse(s)));
 assert.ok(packets.some(p=>p.type==='stream-start'));assert.ok(packets.some(p=>p.type==='loaded'));
 assert.equal(packets.some(p=>['snapshot','frames','progress'].includes(p.type)||p.type.startsWith('transfer-')),false,'guests receive media and controls rather than ROM state or authority frames');
 // Streamed guests must stay in the same room across an intentional Continue,
 // and be released cleanly by Quit despite having no native ending to replay.
 host.machine.RAM[0x84a]=2;host.machine.RAM[0x84b]=5;await advance(1);
 async function defeatStreamTeam(){
  host.machine.RAM[0x438]=0;host.machine.RAM.fill(0,0xd98,0xdb8);host.machine.RAM.fill(0,0x84f,0x877);host.machine.RAM.fill(0,0xf9b,0xfb4);host.machine._levelObjective.state.enabled=false;
  for(const actor of actors.values())Object.assign(actor,{alive:false,deathFrame:0,extraLives:0,target:null,route:[],goal:null});
  for(let n=0;n<300&&![host,guest].every(a=>/Continue restarts/.test(a.e.get('online-health').textContent));n++)await advance(1);
  for(const a of [host,guest])assert.match(a.e.get('online-health').textContent,/Continue restarts/);
 }
 await defeatStreamTeam();assert.match(guest.e.get('menu-status').textContent,/Waiting for the host/);assert.match(host.status(),/3-0/);const code=host.e.get('room-code').value;
 await host.key('Enter');for(let n=0;n<700;n++){
  host.tick();await flush();guest.tick();await flush();
  if(host.e.get('pause-btn').textContent==='Pause'&&guest.e.get('pause-btn').textContent==='Pause'&&host.machine.RAM[0x84a]===2&&host.machine.RAM[0x84b]===0&&actors.get(1).alive&&actors.get(2).alive)break;
  if(n===699)assert.fail('Stream Continue did not restart world 3: '+host.status()+' / '+guest.status());
 }
 assert.equal(host.machine.RAM[0x438],2);assert.equal(host.e.get('room-code').value,code);assert.equal(guest.machine,undefined);assert.equal(video.srcObject.getVideoTracks()[0].readyState,'live');
 const continued=await host.export();assert.deepEqual(Array.from(continued.session.onlineRoom.players,p=>p.color),['black','orange']);assert.equal(continued.session.sharedPowerups.counts[1],0,'intentional Continue resets the defeated campaign upgrades');assert.ok(continued.session.companions.bots.every(b=>b.bombCapacity===1));
 await defeatStreamTeam();await host.key('ArrowDown');await host.key('Enter');await flush();for(let n=0;n<130&&host.e.get('start-btn').disabled;n++)await advance(1);
 assert.equal(host.e.get('start-btn').disabled,false);assert.match(host.e.get('menu-status').textContent,/1P - CAMPAIGN/);assert.equal(video.srcObject,null);assert.equal(video.hidden,true);assert.ok(channels.every(c=>c.readyState==='closed'));
 assert.equal(guest.machine,undefined);assert.equal(guest.e.get('join-online-btn').disabled,false);await guest.e.get('join-online-btn').click();assert.equal(guest.e.get('online-room-dialog').open,true,'a guest without a ROM can join another room after Quit');
 assert.equal(host.e.get('room-create-code').disabled,false,'the host may choose a key for the next room after Quit');
 db.sqlite.close();process.stdout.write(JSON.stringify({scenario,noGuestEmulator:true,videoAudio:true,remoteControls:true,remoteDetonation:true,bombColorPreferences:true,hostAdmin:true,noSimulationBackpressure:true,worldContinue:true,cleanQuit:true,streamPreferences:true,streamDiagnostics:true,pauseResume:true,customRoomKey:true}));
}else if(scenario==='player-departure'){
 // Losing a third player must invalidate the original three-person game even
 // if the two remaining peers are still connected and the server removes them.
 await third.e.get('room-leave').click();await flush();await host.poll();await guest.poll();
 assert.equal(host.e.get('room-list').children.length,2,'the disconnected member is removed from the lobby record');
 for(const a of [host,guest]){assert.equal(a.e.get('pause-btn').textContent,'Resume');assert.match(a.status(),/A player disconnected/);}
 const before=[host,guest].map(a=>a.machine._onlineCampaign.state.frame);
 await host.e.get('pause-btn').click();await guest.e.get('pause-btn').click();await flush();
 for(let n=0;n<5;n++){host.tick();guest.tick();await flush();}
 assert.deepEqual([host,guest].map(a=>a.machine._onlineCampaign.state.frame),before);
 for(const a of [host,guest]){assert.equal(a.e.get('pause-btn').textContent,'Resume','remaining peers cannot resume without the original roster');assert.match(a.status(),/A player disconnected/);assert.doesNotMatch(a.e.get('menu-status').textContent,/Waiting for the host|catch up/);}
 await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,blockedResume:true,remainingPlayers:2,fatalReason:true}));
}else if(scenario==='online-gameover'){
 const {DEATH_FRAMES}=await host.load('dist/campaign.js'),actors=new Map(),events=new Map();
 // Capture the actual extension actors passed to their normal controls. The
 // fixture may defeat them directly without exposing private app variables.
 for(const a of [host,guest]){
  const found=new Map(),control=a.machine._onlineCampaign.control;
  a.machine._onlineCampaign.control=function(actor){found.set(actor.id,actor);return control(actor);};
  actors.set(a,found);
 }
 await advance(1);
 // Finish a later stage in world 3, so Continue must rewind the world rather
 // than accidentally booting the title's default world or the defeated area.
 for(const a of [host,guest]){a.machine.RAM[0x84a]=2;a.machine.RAM[0x84b]=5;}
 await advance(1);
 for(const a of [host,guest]){
  assert.equal(actors.get(a).size,2);a.machine.RAM[0x438]=0;
  a.machine.RAM.fill(0,0xd98,0xdb8);a.machine.RAM.fill(0,0x84f,0x877);a.machine.RAM.fill(0,0xf9b,0xfb4);
  a.machine._levelObjective.state.enabled=false;a.machine.RAM[0x434]=31;a.machine.RAM[0x435]=21;
  for(let y=1;y<21;y++)for(let x=2;x<31;x++)a.machine.RAM[0x44a+y*32+x]=0xca;
  const event={music:[],banners:0,black:0,inventedLife:false,terminal:null},cpu=a.machine.CPURun,run=a.machine.Run;events.set(a,event);
  a.machine.CPURun=function(){
   if(this.PC===0xea57)event.music.push(this.A);
   if(this.MPR[4]===9*8192&&this.PC===0x802a)event.banners++;
   return cpu.call(this);
  };
  a.machine.Run=function(...args){
   const result=run.apply(this,args);
   if(this.Palette.every(value=>(value&0x1ff)===0))event.black++;
   if(this.RAM[0x438]>0&&this.RAM[0x438]!==255)event.inventedLife=true;
   if(this._spectator.enabled&&this._spectator.finished&&!this._spectator.transition&&this.VDC[0].SATB[2]===918&&!event.terminal){
    event.terminal={ram:[...this.RAM],pc:this.PC,registers:[this.A,this.X,this.Y,this.S,this.P,this.ProgressClock],mpr:[...this.MPR],vdc:this.VDC.map(v=>v.VDCStatus)};
   }
   return result;
  };
  const dead=actors.get(a).get(1);Object.assign(dead,{alive:false,deathFrame:0,extraLives:0,target:null,route:[],goal:null});
 }
 // The first defeated player cannot end an otherwise living team, even when
 // the shared native stock is already zero.
 const before=actors.get(host).get(2).x;await guest.key('ArrowRight');await advance(40);await guest.key('ArrowRight',true);await advance(2);
 assert.ok(actors.get(host).get(2).x>before+20,'the surviving guest remains playable');
 for(const a of [host,guest]){
  assert.equal(a.machine._spectator.transition,null,'one survivor does not start native defeat');assert.equal(a.machine.RAM[0x438],0);
  assert.equal(actors.get(a).get(1).deathFrame,DEATH_FRAMES);assert.equal(actors.get(a).get(2).alive,true);
  assert.equal(events.get(a).terminal,null);assert.equal(events.get(a).music.includes(0x2a),false);
  Object.assign(actors.get(a).get(2),{alive:false,deathFrame:0,extraLives:0,target:null,route:[],goal:null});
 }
 let elapsed=0,pausedEndingRecovery=false;
 for(;elapsed<300&&![host,guest].every(a=>/Continue restarts/.test(a.e.get('online-health').textContent));elapsed++){
  host.tick();await flush();
  if(events.get(host).terminal&&!events.get(guest).terminal&&!pausedEndingRecovery){
   // Pause after the host has stopped at the native ending, while its final
   // authority frames are still queued at the guest. Resume must release just
   // that unfinished guest to drain the ending and complete the handshake.
   assert.equal(guest.e.get('pause-btn').textContent,'Pause');await guest.e.get('pause-btn').click();await flush();
   assert.equal(guest.e.get('pause-btn').textContent,'Resume');const pausedFrame=guest.machine._onlineCampaign.state.frame;
   guest.tick();await flush();assert.equal(guest.machine._onlineCampaign.state.frame,pausedFrame,'a paused guest retains its queued ending frames');
   assert.equal(events.get(guest).terminal,null,'the guest has not reached the ending before Resume');
   await guest.e.get('pause-btn').click();await flush();assert.equal(guest.e.get('pause-btn').textContent,'Pause','Resume can finish an ending whose host has already stopped');
   assert.ok(channels.some(c=>c.sent.some(s=>{const p=JSON.parse(s);return p.type==='play'&&p.to===guest.id;})),'the host resumes only the unfinished guest');
   pausedEndingRecovery=true;
  }
  guest.tick();await flush();assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|states differ|frame order|desynchronization|disconnected/);
 }
 assert.equal(pausedEndingRecovery,true,'the guest paused and resumed across the terminal authority frame');
 assert.ok(elapsed>=40&&elapsed<300,'both apps wait for native death music and fade before displaying Continue');
 for(const a of [host,guest]){
  const event=events.get(a);assert.equal(event.inventedLife,false,'game over cannot manufacture a spare life');
  assert.ok(event.terminal,'the unchanged ROM reached its native title');assert.equal(event.terminal.ram[0x438],255);
  assert.ok(event.music.includes(0x2a),'native death music plays');assert.ok(event.music.includes(0x2b),'native title music follows');assert.ok(event.black>0,'the native fade reaches black');
  assert.equal(event.banners,0,'zero lives cannot restart with a stage card');
  for(const actor of actors.get(a).values()){assert.equal(actor.alive,false);assert.equal(actor.deathFrame,DEATH_FRAMES);assert.equal(actor.extraLives,0);}
  assert.equal(a.e.get('online-room-dialog').open,false);assert.equal(a.e.get('start-btn').disabled,true);
  assert.match(a.e.get('online-health').textContent,/The host chooses Continue or Quit/);assert.match(a.status(),/Game over|Continue/);
 }
 same(events.get(host).terminal,events.get(guest).terminal);
 assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='game-over-ready')),'guests acknowledge the terminal authority frame before Continue is offered');
 const code=host.e.get('room-code').value,ids=[host.id,guest.id];
 // The guest cannot choose for the host. Selecting Continue preserves the RTC
 // room and the identities/colors, while fresh boot restores ordinary lives.
 await guest.key('ArrowDown');await guest.key('Enter');await advance(1);
 assert.match(host.e.get('online-health').textContent,/Continue restarts/,'guest input cannot select Quit for the team');
 await host.key('Enter');
 for(let n=0;n<700;n++){
  host.tick();await flush();guest.tick();await flush();
  if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));
  if(host.e.get('pause-btn').textContent==='Pause'&&guest.e.get('pause-btn').textContent==='Pause'&&host.machine._onlineCampaign.state.enabled&&host.machine.RAM[0x84a]===2&&host.machine.RAM[0x84b]===0&&actors.get(host).get(1)?.alive&&actors.get(host).get(2)?.alive)break;
  if(n===699)assert.fail('Continue did not restart world 3: '+host.status()+' / '+guest.status());
 }
 await advance(3);same(host.machine.RAM,guest.machine.RAM);
 for(const a of [host,guest]){assert.equal(a.e.get('room-code').value,code);assert.equal(a.machine.RAM[0x84a],2);assert.equal(a.machine.RAM[0x84b],0);assert.equal(a.machine.RAM[0x438],2);assert.equal(a.e.get('pause-btn').disabled,false,'Continue re-enables Pause for both peers');}
 const continued=await host.export();assert.deepEqual(Array.from(continued.session.onlineRoom.players,p=>p.id),ids);assert.deepEqual(Array.from(continued.session.onlineRoom.players,p=>p.color),['black','orange']);
 assert.equal(channels.some(c=>c.readyState!=='open'),false,'Continue does not replace or close the direct connection');
 // The other requested example is 1-3 -> 1-0. A second zero-life defeat must
 // offer a choice again rather than manufacturing a life or looping forever.
 for(const a of [host,guest]){a.machine.RAM[0x84a]=0;a.machine.RAM[0x84b]=2;}
 await advance(1);
 for(const a of [host,guest]){
  a.machine.RAM[0x438]=0;a.machine.RAM.fill(0,0xd98,0xdb8);a.machine.RAM.fill(0,0x84f,0x877);a.machine.RAM.fill(0,0xf9b,0xfb4);a.machine._levelObjective.state.enabled=false;
  Object.assign(events.get(a),{music:[],banners:0,black:0,inventedLife:false,terminal:null});
  for(const actor of actors.get(a).values())Object.assign(actor,{alive:false,deathFrame:0,extraLives:0,target:null,route:[],goal:null});
 }
 for(let n=0;n<300&&![host,guest].every(a=>/Continue restarts/.test(a.e.get('online-health').textContent));n++)await advance(1);
 for(const a of [host,guest]){assert.match(a.e.get('online-health').textContent,/Continue restarts/);assert.equal(events.get(a).inventedLife,false);assert.ok(events.get(a).terminal);assert.match(a.status(),/1-0/);}
 await host.key('ArrowDown');await host.key('Enter');await flush();
 for(let n=0;n<130&&![host,guest].every(a=>a.e.get('start-btn').textContent==='Select'&&!a.e.get('start-btn').disabled);n++)await advance(1);
 for(const a of [host,guest]){assert.equal(a.e.get('start-btn').textContent,'Select');assert.equal(a.e.get('start-btn').disabled,false);assert.match(a.e.get('menu-status').textContent,/1P - CAMPAIGN/);}
 for(const a of [host,guest]){await a.key('ArrowDown');assert.match(a.e.get('menu-status').textContent,/1P - DLC/);}
 await advance(35);for(const a of [host,guest]){
  assert.equal(a.machine._onlineCampaign.state.enabled,false,'later title frames never resume the defeated team');
  assert.equal(a.e.get('room-leave').disabled,true,'the completed lobby is closed');
  assert.equal(a.e.get('create-room').disabled,false,'either player can create a fresh lobby after game over');
 }
 db.sqlite.close();process.stdout.write(JSON.stringify({scenario,survivorContinues:true,finiteLives:true,nativeSequence:true,synchronizedEnd:true,worldContinue:true,repeatedPrompt:true,usableMenus:true,pausedEndingRecovery}));
}else if(scenario==='guest-lag'){
 // Stall the guest's rendering/simulation while its reliable transport stays
 // connected. The host must bound its lead rather than fill a ten-second queue.
 const before=host.machine._onlineCampaign.state.frame;
 for(let n=0;n<250;n++){host.tick();await flush();}
 const lead=host.machine._onlineCampaign.state.frame-guest.machine._onlineCampaign.state.frame;
 assert.ok(lead<=18,'a stalled guest leaves at most 18 authoritative frames outstanding, got '+lead);
 assert.ok(host.machine._onlineCampaign.state.frame-before<=18,'the host waits rather than running away from its guest');
 assert.equal(host.e.get('pause-btn').textContent,'Pause','lag does not become a fatal pause');
 assert.match(host.e.get('menu-status').textContent,/catch up/,'the host explains its temporary wait');
 // A catch-up callback may simulate several authority frames, but redundant
 // pictures must not all reach the canvas. The next ordinary frame must still
 // draw, ensuring the presentation suppression cannot leak out of catch-up.
 const backlogFrame=guest.machine._onlineCampaign.state.frame,draws=guest.draws;
 guest.tick();await flush();
 const caught=guest.machine._onlineCampaign.state.frame-backlogFrame;
 assert.ok(caught>1,'a queued guest simulates multiple frames in one callback');
 assert.ok(guest.draws-draws<caught,'catch-up omits intermediate canvas uploads');
 // Restore service at half the host's callback cadence. Catch-up consumes
 // queued authority frames without dropping or predicting simulation frames.
 for(let n=0;n<100;n++){host.tick();await flush();if(n%2===0){guest.tick();await flush();}assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|states differ|frame order|desynchronization|too far behind/);assert.ok(host.machine._onlineCampaign.state.frame-guest.machine._onlineCampaign.state.frame<=18);}
 for(let n=0;n<20&&host.machine._onlineCampaign.state.frame!==guest.machine._onlineCampaign.state.frame;n++){guest.tick();await flush();}
 same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);
 // A slow emulated frame must yield back to the UI rather than triggering a
 // six-frame burst merely because authority frames remain queued.
 for(let n=0;n<7;n++){host.tick();await flush();}
 const restoreCost=guest.costRuns(20);
 for(let n=0;n<5;n++){const before=guest.machine._onlineCampaign.state.frame;guest.tick();await flush();assert.equal(guest.machine._onlineCampaign.state.frame-before,1,'a 20ms emulation step exhausts the catch-up time budget');}
 restoreCost();for(let n=0;n<20&&host.machine._onlineCampaign.state.frame!==guest.machine._onlineCampaign.state.frame;n++){guest.tick();await flush();}
 same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);
 const normalDraws=guest.draws;host.tick();await flush();guest.tick();await flush();assert.ok(guest.draws>normalDraws,'the next ordinary frame draws after catch-up');
 assert.ok(host.machine._onlineCampaign.state.frame>=120,'checksummed gameplay continues after the lag');
 assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='progress')),'guest reports processed frame progress');
 const frames=host.machine._onlineCampaign.state.frame;await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,frames,maxLead:lead,catchUp:true,timeBudget:true,coalescedRendering:true}));
}else if(scenario){
 let delayedFrames=0;
 if(scenario==='pause-delay'){
  delayPauseRequest=true;await guest.e.get('pause-btn').click();await flush();
  assert.equal(pendingPauseRequests.length,1,'guest pause request is delayed in transit');
  const before=host.machine._onlineCampaign.state.frame;
  for(let n=0;n<3;n++){host.tick();await flush();guest.tick();await flush();}
  delayedFrames=host.machine._onlineCampaign.state.frame-before;assert.ok(delayedFrames>=3,'host emits authoritative frames before receiving the pause request');
  delayPauseRequest=false;for(const deliver of pendingPauseRequests.splice(0))deliver();await flush();
  assert.equal(host.e.get('pause-btn').textContent,'Resume');assert.equal(guest.e.get('pause-btn').textContent,'Resume');
  await host.e.get('pause-btn').click();await flush();
 }
 // Survive the first periodic checksum after startup/resume. The guest may
 // consume buffered frames faster than the host to recover the delayed pause.
 for(let n=0;n<145;n++){host.tick();await flush();guest.tick();await flush();if(scenario==='pause-delay'){guest.tick();await flush();}assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|states differ|frame order|desynchronization/);}
 same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);
 if(scenario==='audio-hang')for(const a of [host,guest]){assert.equal(a.machine.WebAudioCtx.unsettledCalls,1,'an unresolved audio suspend request does not hold the gameplay handshake');assert.ok(a.machine.WebAudioCtx.suspendCalls>=2);}
 assert.ok(host.machine._onlineCampaign.state.frame>=120,'authoritative gameplay progresses past its first checksum');
 const frames=host.machine._onlineCampaign.state.frame;await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,frames,delayedFrames,unsettledAudio:scenario==='audio-hang'}));
}else{
assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='transfer-chunk')),'host serialized snapshot travels over chunked RTC');assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='loaded')),'guest acknowledges applied snapshot');
assert.equal(host.machine._onlineCampaign.state.enabled,true);assert.equal(guest.machine._onlineCampaign.state.enabled,true);same(host.machine.RAM,guest.machine.RAM);
const initial=await host.export();await flush();assert.equal(initial.session.mode,'online-campaign');assert.deepEqual(Array.from(initial.session.onlineRoom.players,p=>p.color),['black','orange']);assert.equal(initial.session.companions.bots.length,2);
// A controlled open arena removes random enemies from the movement assertion,
// while all movement, collection, sounds, CPU and rendering still run natively.
for(const a of [host,guest]){a.machine.RAM.fill(0,0xd98,0xdb8);a.machine.RAM.fill(0,0xf9b,0xfb4);a.machine._levelObjective.state.enabled=false;a.machine.RAM[0x434]=31;a.machine.RAM[0x435]=21;for(let y=1;y<21;y++)for(let x=2;x<31;x++)a.machine.RAM[0x44a+y*32+x]=0xca;}
const location=initial.session.companions.bots[1];for(const a of [host,guest]){const campaign=await a.load('dist/campaign.js');campaign.spawnItem(a.machine,1,Math.floor(location.x/16),Math.floor(location.y/16));}
await advance(3);assert.equal(host.machine._sharedPowerups.state.counts[1],1);same(host.machine._sharedPowerups.state,guest.machine._sharedPowerups.state);
assert.equal(host.machine._fixtureCompanions.bombColorsEnabled,false);assert.equal(guest.machine._fixtureCompanions.bombColorsEnabled,true,'separate-camera players keep independent presentation preferences');
for(const a of [host,guest])for(const [i,actor]of a.machine._fixtureCompanions.state.bots.entries()){actor.x=i?184:56;actor.y=56;}
await host.key('Space');await guest.key('Space');await advance(1);await host.key('Space',true);await guest.key('Space',true);
for(const a of [host,guest]){const owned=a.machine._fixtureCompanions.state.bombColors;assert.ok(owned.includes('black')&&owned.includes('orange'),'colored bomb ownership is synchronized even when local rendering is disabled');}
same(host.machine._fixtureCompanions.state,guest.machine._fixtureCompanions.state);
await presentationOnlyBombPreference(host,true);await presentationOnlyBombPreference(host,false);await presentationOnlyBombPreference(guest,false);await presentationOnlyBombPreference(guest,true);
await hostAdminEdits();
await host.key('ArrowDown');await guest.key('ArrowRight');await advance(20);assert.equal(host.machine._onlineCampaign.state.inputs[1],2,JSON.stringify({status:host.status()+' / '+guest.status(),inputs:channels.flatMap(c=>c.sent.map(s=>JSON.parse(s)).filter(p=>p.type==='input')),boot:initial.session.boot}));await host.key('ArrowDown',true);await advance(190);await guest.key('ArrowRight',true);await advance(2);
same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);assert.equal(host.machine.A,guest.machine.A);assert.equal(host.machine.X,guest.machine.X);assert.equal(host.machine.S,guest.machine.S);assert.notDeepEqual(host.machine.ImageData.data.slice(684*64*4),guest.machine.ImageData.data.slice(684*64*4),'local arena cameras follow separate players without diverging CPU or RAM');
const saved=await host.export();await flush();assert.ok(saved.session.companions.bots[0].y>initial.session.companions.bots[0].y+20,'host controls the first actor');assert.ok(saved.session.companions.bots[1].x>initial.session.companions.bots[1].x+200,'guest independently controls the second actor '+JSON.stringify({initial:initial.session.companions.bots.map(b=>({id:b.id,x:b.x,y:b.y})),later:saved.session.companions.bots.map(b=>({id:b.id,x:b.x,y:b.y,alive:b.alive,action:b.action})),inputs:host.machine._onlineCampaign.state.inputs}));assert.ok(saved.session.companions.bots.every(b=>b.bombCapacity===2),'a collected bomb upgrade reaches all humans');assert.equal(saved.session.sharedPowerups.counts[1],1);
await guest.key('ArrowRight');await advance(2);guest.e.get('game-canvas').listeners.blur();await flush();const before=host.machine._onlineCampaign.state.frame;await advance(2);assert.equal(host.machine._onlineCampaign.state.inputs[1],0,'blur releases remote input through the host');assert.ok(host.machine._onlineCampaign.state.frame>before);
await host.e.get('pause-btn').click();await flush();const paused=host.e.get('frame-count').textContent;await advance(3);assert.equal(host.e.get('frame-count').textContent,paused);assert.equal(guest.e.get('pause-btn').textContent,'Resume','host pause stops the guest');
await host.e.get('room-leave').click();await guest.e.get('room-leave').click();await flush();
// Import the exported checkpoint, retaining original player IDs/upgrades but
// requesting world4 stage4, then exercise the actual fresh-level boot path.
saved.state.RAM[0x84a]=3;saved.state.RAM[0x84b]=3;saved.session.onlineRoom.revision='0.4.7';delete saved.session.companions.bombColors;delete saved.session.bosses;delete saved.session.adminBombs;delete saved.session.adminLevels;const saveModule=await host.load('dist/save-state.js'),checkpoint=await saveModule.encodeSave(saved);
await host.e.get('save-input').listeners.change({target:{files:[checkpoint],value:'x'}});assert.match(host.e.get('save-status').textContent,/Online save selected/);assert.match(host.e.get('room-checkpoint').textContent,/level 4-4/);
assertColorUI(host,'black');
await guest.e.get('open-menu-btn').click();for(let i=0;i<110;i++)guest.tick();await guest.key('ArrowDown');await guest.key('ArrowDown');await guest.key('Enter');await guest.key('ArrowDown');await guest.key('Enter');await join();await synchronize();await advance(3);
assert.equal(host.machine.RAM[0x84a],3);assert.equal(host.machine.RAM[0x84b],3);same(host.machine.RAM,guest.machine.RAM);const resumed=await host.export();assert.deepEqual(resumed.session.onlineRoom.players.map(p=>p.id),saved.session.onlineRoom.players.map(p=>p.id));assert.ok(resumed.session.companions.bots.every(b=>b.bombCapacity===2));assert.ok(resumed.session.companions.bots.every(b=>b.x<100&&b.y<100),'saved remote positions restart from the level entrance');
assertColorUI(host,'black',{disabled:true});assertColorUI(guest,'orange',{disabled:true});
const pendingAdminSave=await hostAdminLevelJump();
await host.e.get('room-leave').click();await guest.e.get('room-leave').click();
// A save made before the selected level loads must restart that target when
// an online team recreates its lobby, rather than restarting the old RAM stage.
assert.equal(pendingAdminSave.session.adminLevels.pending,true);assert.equal(pendingAdminSave.state.RAM[0x84a],3,'the pending save still contains the old world in native RAM');
const pendingCheckpoint=await saveModule.encodeSave(pendingAdminSave);await host.e.get('save-input').listeners.change({target:{files:[pendingCheckpoint],value:'x'}});assert.match(host.e.get('save-status').textContent,/Online save selected/);assert.match(host.e.get('room-checkpoint').textContent,/level 5-4/,'the lobby checkpoint uses the requested world 5, area index 3');
await guest.e.get('open-menu-btn').click();for(let i=0;i<110;i++)guest.tick();await guest.key('ArrowDown');await guest.key('ArrowDown');await guest.key('Enter');await guest.key('ArrowDown');await guest.key('Enter');await join();await synchronize();await advance(3);
assert.equal(host.machine.RAM[0x84a],4);assert.equal(host.machine.RAM[0x84b],3);same(host.machine.RAM,guest.machine.RAM);const targetResume=await host.export();same(targetResume.session.onlineRoom.players,pendingAdminSave.session.onlineRoom.players);assert.equal(targetResume.session.sharedPowerups.counts[1],pendingAdminSave.session.sharedPowerups.counts[1]);assert.ok(targetResume.session.companions.bots.every(actor=>actor.bombCapacity===2),'a pending travel save restarts its target with saved team powers');assert.equal(targetResume.session.adminLevels.pending,false,'fresh online loading consumes the pending travel request');
await humansMoveAfterTravel();
await host.e.get('room-leave').click();await guest.e.get('room-leave').click();
// Original Battle must also use only synchronized native controller inputs.
// A guest's physical controller is assigned to their network slot, and cannot
// leak into native port0 or recolor the host in the guest's display.
const bh=await app('Battle host','battle-host-0001','black','battle'),bg=await app('Battle guest','battle-guest-001','orange','battle');
await bh.e.get('create-room').click();bg.e.get('room-code').value=bh.e.get('room-code').value;await bg.e.get('join-room').click();await bg.e.get('room-ready').click();
for(let n=0;n<12&&bh.e.get('room-start').disabled;n++){await bh.poll();await bg.poll();}assert.equal(bh.e.get('room-start').disabled,false,bh.status()+bg.status());
await bh.e.get('room-start').click();for(let n=0;n<700&&bg.e.get('online-room-dialog').open;n++){bh.tick();await flush();if(bh.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));}
assert.equal(bg.e.get('online-room-dialog').open,false,bh.status()+bg.status());
assertColorUI(bh,'black',{disabled:true});assertColorUI(bg,'orange',{disabled:true});
const pad={connected:true,id:'Fixture standard',mapping:'standard',index:0,axes:[-1,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};bg.context.navigator.getGamepads=()=>[pad];
await bh.key('Space');await bg.key('Space');for(let n=0;n<3;n++){bh.tick();await flush();bg.tick();await flush();}await bh.key('Space',true);await bg.key('Space',true);
for(const a of [bh,bg]){assert.ok(a.machine.RAM.slice(0x84f,0x877).some(flags=>flags&128),'online Battle places a synchronized native bomb');assert.deepEqual(Array.from(a.machine._fixtureCompanions.state.bombColors),Array(40).fill(null),'campaign owner metadata does not capture native Battle bombs');}
for(let n=0;n<130;n++){bh.tick();await flush();bg.tick();await flush();assert.doesNotMatch(bh.status()+bg.status(),/Emulation stopped|states differ|frame order/);}
for(const a of [bh,bg])assert.deepEqual(Array.from(a.machine._fixtureCompanions.state.bombColors),Array(40).fill(null),'Battle preferences cannot change owner metadata through a checksum interval');
same(bh.machine.RAM,bg.machine.RAM);assert.equal(bh.machine.PC,bg.machine.PC);const battleSave=await bh.export();await flush();const guestBattle=await bg.export();await flush();assert.equal(battleSave.session.mode,'online-battle');assert.deepEqual(Array.from(battleSave.session.battleColors),['black','orange']);assert.deepEqual(Array.from(guestBattle.session.battleColors),['black','orange']);
assert.ok(channels.some(c=>c.sent.some(s=>{const p=JSON.parse(s);return p.type==='input'&&p.mask===8;})),'physical guest controller is sent through the network mask');
await bh.e.get('room-leave').click();await bg.e.get('room-leave').click();db.sqlite.close();
process.stdout.write(JSON.stringify({players:2,sharedUpgrades:true,cameraViews:true,bombColorPreferences:true,hostAdmin:true,restartLevel:'4-4',remoteReleased:true,battleControllers:true,battleBombs:true,frames:saved.session.onlineCampaign.frame,httpRequests:requests.length}));
}
}
