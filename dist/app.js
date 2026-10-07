import {PCE} from './vendor/pce.js';
import {verifyROM,installColorSelector,colorizePlayer,COLORS,KEY_BINDINGS,traceWrites} from './session.js';
import {captureState,validateState,restoreState,encodeSave,decodeSave,storeQuickSave,readQuickSave} from './save-state.js';
import {createCompanions,validateCompanionState,ITEM_CATALOG,isCampaign,tileKind,playerPosition,spawnItem,spawnBomb,spawnEnemyType,nearestFreeTile,campaignSpawnCells,companionBombSlots} from './campaign.js';
import {createBattleAI,validateBattleState,launchSequence,activeBattle} from './battle-ai.js';
import {installNativeMenu,TITLE_SEQUENCE,watchBots} from './native-menu.js';
import {createNewCampaign,validateNewCampaign} from './new-campaign.js';
import {createSpectator,validateSpectatorState} from './spectator.js';
import {createIntroSkip,validateIntroSkip} from './intro.js';
import {createLevelObjective,validateLevelObjective} from './level-objective.js';
import {enemyCatalog,createEnemyCard} from './enemy-icons.js';
import {createPowerupHUD,validatePowerupHUD,createPowerupBadge} from './powerup-hud.js';
import {createEnemySpawns,validateEnemySpawns} from './enemy-spawns.js';
import {createSharedPowerups,validateSharedPowerups} from './shared-powerups.js';
import {createWorldStart,validateWorldStart} from './world-start.js';
import {createOnlineCampaign,validateOnlineCampaign} from './online-campaign.js';
import {createOnlineRoom,ONLINE_REVISION} from './online-room.js';
const $=id=>document.getElementById(id),canvas=$('game-canvas'),FRAME_MS=1000/59.8261;
let machine,rom,colors,companions,battleAI,nativeMenu,newCampaign,spectator,introSkip,levelObjective,powerupHUD,enemySpawns,running=false,muted=false,frame=0,mode='solo',count=2;
let lastTime=0,accumulator=0,pendingTrace,loadGeneration=0,boot=[],initialBots=0,started=false;
let quickSave=null,busy=false,adminWasRunning=false,selectedTile=null,returnSave=null;
let powerupSignature='';
let sharedPowerups,worldStart,onlineCampaign,onlineRoom,onlinePhase=null,onlineMode='campaign',pendingCheckpoint=null,networkRoster=[],onlineSequence=0,onlineFrames=[],onlineMasks=[],onlineAcks=new Set(),onlineSending=false,lastInput=-1,roomBusy=false;
let onlineStartTimer=null,onlineStartGeneration=0,onlineSessionReady=false,onlineFailure='',onlineWaiting=false,onlineProgress=new Map();
const ONLINE_MAX_LEAD=18,ONLINE_CATCH_UP_STEPS=6;
function resetOnlineFlow(){onlineFailure='';onlineWaiting=false;onlineProgress=new Map();}
function waitForOnlinePeer(waiting){if(waiting===onlineWaiting)return;onlineWaiting=waiting;$('menu-status').textContent=waiting?'Waiting for a player to catch up…':'';}
function hostCanAdvance(){return networkRoster.filter(p=>p.id!==onlineRoom.playerId).every(p=>onlineSequence-(onlineProgress.get(p.id)??0)<ONLINE_MAX_LEAD)&&onlineRoom.writable();}
const onlineGame=()=>mode.startsWith('online-');
const localActorID=()=>networkRoster.findIndex(p=>p.id===onlineRoom?.playerId)+1;
function stopOnlineStartWatch(){onlineStartGeneration++;clearTimeout(onlineStartTimer);onlineStartTimer=null;}
function watchOnlineStart(){
 stopOnlineStartWatch();const generation=onlineStartGeneration;
 onlineStartTimer=setTimeout(()=>{if(generation===onlineStartGeneration&&onlineRoom?.room&&['boot','sync'].includes(onlinePhase))roomError(new Error('Online startup timed out. Return to Main menu, recreate the lobby and try again.'));},45000);
}
const COLOR_CHOICES={original:['White','#fff'],black:['Black','#222'],orange:['Orange','#ed951b'],yellow:['Yellow','#f2da32'],blue:['Blue','#327cdc'],green:['Green','#4bb54e'],red:['Red','#db4141'],violet:['Violet','#9962dc']};
const colorButtons=[];
const colorLocked=()=>onlineRoom?.room?.status==='playing'||onlineGame()&&started&&onlinePhase!=='lobby';
function renderColorPickers(){
 const selected=colors?.selected??$('color-select').value,locked=colorLocked();$('color-select').value=selected;
 for(const {button,color}of colorButtons){button.setAttribute('aria-pressed',String(color===selected));button.disabled=roomBusy||locked;}
 $('color-select').disabled=roomBusy||locked;
 const label=COLOR_CHOICES[selected]?.[0]??'White';
 for(const id of ['color-current','room-color-current'])if($(id).textContent!==label+' selected')$(id).textContent=label+' selected';
 $('color-notice').textContent=locked?'Online colors are fixed for this game. Choose a different color in your next lobby.':roomBusy?'Updating your lobby…':'Click a named color. Your selection also applies to the opening cutscene.';
 $('room-color-notice').textContent=locked?'Colors are fixed once the game starts.':roomBusy?'Updating your lobby…':'Click a color, then mark Ready. Changing color clears your Ready status.';
}
function setSelectedColor(color){
 if(!Object.hasOwn(COLOR_CHOICES,color))return;
 if(colors&&colors.selected!==color)colors.select(color);
 $('color-select').value=color;renderColorPickers();
}
async function chooseColor(color){
 if(!Object.hasOwn(COLOR_CHOICES,color)||roomBusy||colorLocked()){renderColorPickers();return;}
 if(onlineRoom?.room?.status==='lobby')await roomAction(async()=>{await onlineRoom.update({color,ready:false});setSelectedColor(color);});
 else setSelectedColor(color);
}
function installColorPickers(){
 for(const id of ['color-options','room-color-options'])for(const [color,[label,hex]]of Object.entries(COLOR_CHOICES)){
  const button=document.createElement('button'),swatch=document.createElement('span'),name=document.createElement('span');
  button.type='button';button.className='color-option';button.setAttribute('data-color',color);if(button.dataset)button.dataset.color=color;button.setAttribute('aria-label','Choose '+label+' Bomberman');swatch.className='color-swatch';swatch.style.background=hex;swatch.setAttribute('aria-hidden','true');name.textContent=label;button.append(swatch,name);button.addEventListener('click',()=>chooseColor(color));$(id).append(button);colorButtons.push({button,color,group:id});
 }
 if(!Object.hasOwn(COLOR_CHOICES,$('color-select').value))$('color-select').value='original';renderColorPickers();
}
let selectedSpawn=null,pendingSoloGameOver=false;
const spawnButtons=new Map();
const held=new Set();
const consumed=new Set();
function message(text){$('load-status').textContent=text;}
function releaseKeys(){if(machine)for(let port=0;port<5;port++)for(const button of ['UP','RIGHT','DOWN','LEFT','SHOT1','SHOT2','RUN','SELECT'])machine['UnsetButton'+button](port);held.clear();if(onlineGame())updateOnlineInput(true);}
function download(data,name,type='application/octet-stream'){
 const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function finishTrace(){if(!pendingTrace)return;const result=pendingTrace.hook.finish();download(JSON.stringify({rom:'Bomberman (USA)',startFrame:pendingTrace.start,endFrame:frame,...result},null,2),'campaign-trace.json','application/json');$('debug-output').textContent=`Captured ${result.records.length} writes (${result.dropped} dropped).`;pendingTrace=undefined;$('trace-btn').disabled=false;}
async function pause(reason='The game is paused.'){
 if(onlinePhase==='play'&&onlineRoom?.room){onlinePhase='paused';if(onlineRoom.host)onlineRoom.broadcast({type:'pause',reason});else onlineRoom.toHost({type:'pause-request',reason});}
 running=false;accumulator=0;releaseKeys();$('pause-btn').textContent=returnSave?'Continue game':'Resume';
 if(onlinePhase==='paused'&&onlineRoom?.room)$('menu-status').textContent=reason+' Press Resume to continue.';
 // Browser audio suspension can remain pending under autoplay restrictions.
 // Simulation and snapshot synchronization must never wait for an audio promise.
 try{machine?.WebAudioCtx?.suspend()?.catch(()=>{});}catch{}
}
function unlockAudio(){try{machine.WebAudioCtx?.resume()?.catch(()=>message('Audio is unavailable. The game can still run.'));}catch{message('Audio is unavailable. The game can still run.');}}
async function resume(){if(!machine||busy||$('admin-dialog').open)return;if(onlineGame()&&onlinePhase==='paused'){if(!onlineSessionReady){message(onlineFailure||'Online startup or synchronization did not complete. Return to Main menu and recreate the lobby.');return;}if(!onlineRoom?.room||!onlineRoom.connected()){message('A player is disconnected. Return to Main menu and recreate the lobby.');return;}if(onlineRoom.host){onlinePhase='play';onlineRoom.broadcast({type:'play'});}else{onlineRoom.toHost({type:'resume-request'});$('menu-status').textContent='Waiting for the host to resume…';return;}}if(onlineGame()&&onlinePhase==='sync')return;if(onlineGame()&&onlinePhase==='play'){onlineWaiting=false;$('menu-status').textContent='';stopOnlineStartWatch();}unlockAudio();running=true;lastTime=performance.now();accumulator=0;$('pause-btn').textContent=returnSave?'Continue game':'Pause';$('start-btn').disabled=!nativeMenu.active;canvas.focus({preventScroll:true});}
function updateMenu(){nativeMenu?.setSave(quickSave);$('start-btn').disabled=!rom||busy||(!nativeMenu?.active&&running);}
function menuChanged(s){const players=s.page==='worlds'?'Choose a starting world':watchBots(s.count)?`AI only — watch ${watchBots(s.count)} bots`:`${s.count} players`;$('player-count-select').value=String(s.count);canvas.setAttribute('aria-label',`Bomberman main menu. Selected ${s.label}. ${players}. Up and Down select, Enter chooses, Escape returns.`);$('menu-status').textContent=s.mode==='load'&&!s.hasSave?'LOAD SAVE: no browser save yet. Import an exported save below.':`${s.label} · ${players}. Up/Down to choose, Enter to select.`;}
async function chooseMode(nextMode,options){
 if(busy||!nativeMenu.active)return;
 const players=options.count;
 if(nextMode.startsWith('online-')){count=players;$('player-count-select').value=String(players);onlineMode=nextMode==='online-battle'?'battle':'campaign';if(pendingCheckpoint&&pendingCheckpoint.mode!==onlineMode)pendingCheckpoint=null;await openLobby();return;}
 if(nextMode==='battle-ai'&&watchBots(players)===1){message('Original Battle requires at least two opponents. Choose 2–4 bots, or watch one bot in Solo, Campaign or NEW.');return;}
 if(nextMode==='load'){if(quickSave)await loadProgress(quickSave);else message('No browser save yet. Import a .bmsave file or start a game and save progress.');return;}
 count=players;$('player-count-select').value=String(players);await launch(nextMode,options);
}
function validateOnlineSave(s){
 const online=s.mode.startsWith('online-'),r=s.onlineRoom;
 if(!online){if(s.companions.bots.length>4||s.companions.bots.some(b=>b.bombBank===4)||s.onlineCampaign?.enabled)throw new Error('Online actors require an online session.');return;}
 if(!r||![ONLINE_REVISION,'0.4.0'].includes(r.revision)||r.mode!==(s.mode==='online-campaign'?'campaign':'battle')||!Array.isArray(r.players)||r.players.length!==s.count||r.players.length<2||r.players.length>5||new Set(r.players.map(p=>p?.id)).size!==r.players.length||r.players.some(p=>!p||!Object.hasOwn(COLORS,p.color)||typeof p.name!=='string'||p.name.length>32||!/^[A-Za-z0-9_-]{16,64}$/.test(p.id)))throw new Error('Invalid online roster in save.');
 if(s.mode==='online-campaign'&&(!s.onlineCampaign?.enabled||!s.sharedPowerups?.enabled||s.onlineCampaign.roster.length!==r.players.length))throw new Error('Missing online campaign state in save.');
}
function checkpointFromSave(save){
 if(save.session.mode!=='online-campaign'||save.state.RAM[0x84a]>=8)throw new Error('Choose an online campaign save to restart its level with the same players.');
 return {world:save.state.RAM[0x84a],area:save.state.RAM[0x84b],players:structuredClone(save.session.onlineRoom.players),savedAt:Date.parse(save.createdAt),revision:ONLINE_REVISION,mode:'campaign',sharedPowerups:structuredClone(save.session.sharedPowerups)};
}
function checkpointHeader(c){if(!c)return null;const {world,area,players,savedAt,revision,mode}=c;return {world,area,players,savedAt,revision,mode};}
function renderRoom(room,info={}){
 const list=$('room-list');list.replaceChildren();
 for(const player of room?.players??[]){const own=player.id===onlineRoom?.playerId,row=document.createElement('div'),swatch=document.createElement(own?'button':'span'),name=document.createElement('strong'),state=document.createElement('span');row.className='room-player';swatch.className='room-color';swatch.style.background=COLOR_CHOICES[player.color]?.[1];swatch.title=player.color==='original'?'White':player.color;if(own){swatch.type='button';swatch.setAttribute('aria-label','Change your Bomberman color');swatch.addEventListener('click',()=>{const option=colorButtons.find(b=>b.color===player.color&&b.group==='room-color-options');$('room-color-options').scrollIntoView?.({block:'nearest'});(option?.button??$('room-color-options')).focus();});}name.textContent=player.name+(player.id===room.hostId?' · host':'');state.textContent=player.connected===false?'Disconnected':player.ready?'Ready':'Choosing';row.append(swatch,name,state);list.append(row);}
 const mine=room?.players.find(p=>p.id===onlineRoom?.playerId),host=Boolean(info.isHost);
 if(mine)setSelectedColor(mine.color);else renderColorPickers();
 $('room-ready').disabled=!room||room.status!=='lobby';$('room-ready').textContent=mine?.ready?'Not ready':'Ready';$('room-copy').disabled=!room;$('room-leave').disabled=!room;$('create-room').disabled=Boolean(room);$('join-room').disabled=Boolean(room);$('room-save-input').disabled=!room||!host||room.mode!=='campaign'||room.status!=='lobby';
 $('room-start').disabled=!room||!host||room.status!=='lobby'||!info.connected||room.players.some(p=>!p.ready||p.connected===false)||room.players.length<2;
 if(room){$('room-code').value=room.code;$('online-status').textContent=`Room ${room.code} · ${room.players.length}/${room.slots} players`;$('room-status').textContent=info.connected?'Everyone is connected. Mark ready, then the host can start.':'Connecting players… Mark ready after choosing your color.';}
 const saved=pendingCheckpoint??room?.checkpoint;
 $('room-checkpoint').textContent=saved?`Continue level ${saved.world+1}-${saved.area+1} · ${saved.players.map(p=>p.name+' ('+(p.color==='original'?'white':p.color)+')').join(', ')}. The level starts fresh with saved upgrades.`:'New campaign. Every player has their own bombs; campaign power-ups are shared.';
}
function roomError(error){stopOnlineStartWatch();onlineSessionReady=false;onlineFailure=error.message;if(onlineGame()&&['play','sync','boot','paused'].includes(onlinePhase)){pause(error.message);onlinePhase='paused';$('menu-status').textContent='Online play paused: '+error.message;if(onlineRoom?.room){if(onlineRoom.host)onlineRoom.broadcast({type:'pause',reason:error.message,fatal:true});else onlineRoom.toHost({type:'desync',reason:error.message});}message('Online play paused: '+error.message);} $('room-status').textContent=error.message;$('online-status').textContent=error.message;}
function roomConnection(){
 if(!onlineRoom)onlineRoom=createOnlineRoom({onRoom:renderRoom,onData:onlinePacket,onDisconnected:()=>{if(onlineGame()&&onlineRoom?.room){const reason='A player disconnected. Return to the lobby and recreate the room, or load a saved campaign.';if(onlineSessionReady||onlineFailure!==reason)roomError(new Error(reason));}},onStatus:text=>{if(text)$('online-status').textContent=text;else if(onlineRoom?.room)$('online-status').textContent=`Room ${onlineRoom.room.code} · ${onlineRoom.room.players.length}/${onlineRoom.room.slots} players`;},onError:roomError});
 return onlineRoom;
}
async function openLobby(){
 await pause();roomConnection();onlinePhase='lobby';$('online-room-dialog').showModal();$('room-title').textContent=onlineMode==='battle'?'Online battle lobby':'Online campaign lobby';renderRoom(onlineRoom.room,{isHost:onlineRoom.host,connected:onlineRoom.connected()});
 if(!onlineRoom.room){try{const code=new URL(globalThis.location?.href??'https://local.test/').searchParams.get('room');if(code)$('room-code').value=code;}catch{}}
}
async function roomAction(action){if(roomBusy)return;roomBusy=true;renderColorPickers();$('create-room').disabled=true;$('join-room').disabled=true;try{await action();}catch(error){roomError(error);}finally{roomBusy=false;renderColorPickers();$('create-room').disabled=Boolean(onlineRoom?.room);$('join-room').disabled=Boolean(onlineRoom?.room);}}
const roomIdentity=()=>({name:$('room-name').value.trim()||'Player',color:colors.selected});
$('create-room').addEventListener('click',()=>roomAction(async()=>{const c=pendingCheckpoint,room=await roomConnection().create({...roomIdentity(),mode:onlineMode,world:c?.world??0,slots:c?.players.length??Math.max(2,Math.min(5,count)),...(c?{checkpoint:checkpointHeader(c)}:{})});if(room)await onlineRoom.update({ready:true});}));
$('join-room').addEventListener('click',()=>roomAction(async()=>{const room=await roomConnection().join($('room-code').value,roomIdentity());if(room){onlineMode=room.mode;pendingCheckpoint=null;}}));
$('room-ready').addEventListener('click',()=>roomAction(()=>onlineRoom.update({...roomIdentity(),ready:!onlineRoom.room.players.find(p=>p.id===onlineRoom.playerId)?.ready})));
$('room-copy').addEventListener('click',()=>roomAction(async()=>{const url=new URL(globalThis.location?.href??'https://local.test/');url.searchParams.set('room',onlineRoom.room.code);if(globalThis.navigator?.clipboard?.writeText){await navigator.clipboard.writeText(url.href);$('room-status').textContent='Invite link copied.';}else $('room-status').textContent='Invite link: '+url.href;}));
$('room-leave').addEventListener('click',()=>roomAction(async()=>{stopOnlineStartWatch();await onlineRoom.leave();onlinePhase=null;pendingCheckpoint=null;renderRoom(null);}));
$('room-close').addEventListener('click',async()=>{$('online-room-dialog').close();if(nativeMenu.active)await resume();});
$('online-room-dialog').addEventListener('cancel',event=>{event.preventDefault();$('room-close').click();});
$('room-save-input').addEventListener('change',event=>roomAction(async()=>{const file=event.target.files[0];if(!file)return;const save=await decodeSave(file);validateSession(save);pendingCheckpoint=checkpointFromSave(save);await onlineRoom.checkpoint(checkpointHeader(pendingCheckpoint));event.target.value='';}));
$('room-start').addEventListener('click',()=>roomAction(async()=>{const room=await onlineRoom.start();if(room)await startOnlineHost(room);}));
async function startOnlineHost(room){
 await pause();initialize(rom);mode='online-'+room.mode;onlineMode=room.mode;networkRoster=(pendingCheckpoint?.players??room.players).map(p=>{const current=room.players.find(q=>q.id===p.id);return {id:p.id,name:current.name,color:current.color};});count=networkRoster.length;$('player-count-select').value=String(count);nativeMenu.leave();
 onlinePhase='boot';onlineSessionReady=false;resetOnlineFlow();watchOnlineStart();onlineSequence=0;onlineMasks=networkRoster.map(()=>0);onlineFrames=[];onlineAcks=new Set();lastInput=-1;started=true;returnSave=null;message('Starting online game. Loading the level for the whole team…');$('menu-status').textContent='Online startup: loading the level…';
 spectator.configure(room.mode==='campaign');battleAI.configure(count,false);newCampaign.configure(false);levelObjective.configure(room.mode==='campaign');powerupHUD.configure(room.mode==='campaign');sharedPowerups.configure(room.mode==='campaign');
 if(pendingCheckpoint?.sharedPowerups)sharedPowerups.restore(pendingCheckpoint.sharedPowerups);
 if(room.mode==='campaign'){worldStart.configure(pendingCheckpoint?.world??room.world,pendingCheckpoint?.area??0);onlineCampaign.configure(true,networkRoster.map((p,i)=>({id:i+1,name:p.name,color:p.color})));initialBots=count;}
 else{onlineCampaign.reset();colors.setBattleColors(networkRoster.map(p=>p.color));initialBots=0;}
 boot=launchSequence(room.mode==='battle'?'battle-ai':'solo',count).map(a=>({...a}));introSkip.configure(room.mode==='campaign');if(room.mode==='campaign')introSkip.request();$('online-room-dialog').close();setModeLabels();await resume();
}
const inputBits={UP:1,RIGHT:2,DOWN:4,LEFT:8,SHOT1:16,SHOT2:32,RUN:64,SELECT:128};
function inputMask(){let mask=0;for(const code of held){const binding=KEY_BINDINGS[code];if(binding)mask|=inputBits[binding[1]]??0;}if(running&&document.activeElement===canvas){const pad=globalThis.navigator?.getGamepads?.()?.find?.(p=>p?.connected);if(pad){const down=n=>pad.buttons[n]?.pressed;if((pad.axes[1]??0)<-.35||down(12))mask|=1;if((pad.axes[0]??0)>.35||down(15))mask|=2;if((pad.axes[1]??0)>.35||down(13))mask|=4;if((pad.axes[0]??0)<-.35||down(14))mask|=8;if(down(0))mask|=16;if(down(1))mask|=32;if(down(9))mask|=64;if(down(8))mask|=128;}}return mask&(mode==='online-battle'?255:63);}
function simulationHash(){let hash=2166136261;const add=n=>{hash=Math.imul(hash^(n>>>0),16777619)>>>0;};for(const n of [machine.PC,machine.A,machine.X,machine.Y,machine.S,machine.P,machine.ProgressClock,...machine.MPR,...machine.RAM])add(n);for(const c of JSON.stringify({bots:companions.state,bombs:onlineCampaign.state,shared:sharedPowerups.state,goal:levelObjective.state}))add(c.charCodeAt(0));return hash;}
function updateOnlineInput(forceZero=false){if(!onlineGame()||!onlineRoom?.room)return;const mask=forceZero?0:inputMask();if(mask===lastInput)return;lastInput=mask;const index=networkRoster.findIndex(p=>p.id===onlineRoom.playerId);if(onlineRoom.host)onlineMasks[index]=mask;else onlineRoom.toHost({type:'input',mask});}
function applyOnlineFrame(packet){
 if(packet.start!==onlineSequence||!Array.isArray(packet.inputs)||packet.inputs.length!==count||packet.inputs.some(n=>!Number.isInteger(n)||n<0||n>(mode==='online-battle'?255:63)))throw new Error('Multiplayer frames are out of sync. Recreate the lobby and load a saved campaign.');
 if(packet.hash!==undefined&&packet.hash!==simulationHash())throw new Error('Multiplayer game states differ. Recreate the lobby and load a saved campaign.');
 if(mode==='online-campaign'){onlineCampaign.setInputs(onlineSequence,packet.inputs);onlineCampaign.update();}
 else for(let port=0;port<count;port++)for(const [button,bit]of Object.entries(inputBits))machine[(packet.inputs[port]&bit?'SetButton':'UnsetButton')+button](port);
 onlineSequence++;step();
}
async function onlinePacket(packet,from){
 if(!onlineRoom?.room||!packet||typeof packet!=='object')return;
 const host=onlineRoom.room.hostId;
 if(packet.type==='input'&&onlineRoom.host){const index=networkRoster.findIndex(p=>p.id===from);if(index>=0&&Number.isInteger(packet.mask)&&packet.mask>=0&&packet.mask<=(mode==='online-battle'?255:63))onlineMasks[index]=packet.mask;}
 else if(packet.type==='snapshot'&&from===host&&!onlineRoom.host){await pause();const save=await decodeSave(packet.blob),session=validateSession(save);if(session.onlineRoom.players.some(p=>!onlineRoom.room.players.some(q=>q.id===p.id)))throw new Error('The game snapshot has a different roster.');applySession(save,session);const mine=onlineRoom.room.players.find(p=>p.id===onlineRoom.playerId);colors.select(mine.color);if(session.mode==='online-battle')colors.setBattleColors(networkRoster.map(p=>p.color));setSelectedColor(mine.color);onlineMode=session.onlineRoom.mode;onlineSequence=0;onlineFrames=[];resetOnlineFlow();lastInput=-1;onlinePhase='sync';renderColorPickers();$('online-room-dialog').close();onlineRoom.toHost({type:'loaded',revision:ONLINE_REVISION});}
 else if(packet.type==='loaded'&&onlineRoom.host&&onlinePhase==='sync'&&packet.revision===ONLINE_REVISION){onlineAcks.add(from);if(networkRoster.filter(p=>p.id!==onlineRoom.playerId).every(p=>onlineAcks.has(p.id))){onlinePhase='play';onlineSessionReady=true;onlineRoom.broadcast({type:'play'});await resume();}}
 else if(packet.type==='play'&&from===host&&!onlineRoom.host){onlinePhase='play';onlineSessionReady=true;await resume();updateOnlineInput();}
 else if(packet.type==='progress'&&onlineRoom.host&&networkRoster.some(p=>p.id===from)&&Number.isInteger(packet.sequence)&&packet.sequence>=0&&packet.sequence<=onlineSequence){onlineProgress.set(from,Math.max(onlineProgress.get(from)??0,packet.sequence));}
 else if(packet.type==='frames'&&from===host&&!onlineRoom.host&&['play','paused'].includes(onlinePhase)){if(onlineFrames.length>=600)throw new Error('This browser fell too far behind the multiplayer game.');const expected=onlineSequence+onlineFrames.length;if(packet.start!==expected)throw new Error('Multiplayer frame order changed.');onlineFrames.push(packet);}
 else if(packet.type==='pause'&&from===host){if(packet.fatal){onlineSessionReady=false;onlineFailure=packet.reason??'The multiplayer game could not synchronize. Recreate the lobby.';}onlinePhase='paused';await pause(packet.reason??'The host paused the game.');message(packet.reason??'The host paused the game.');}
 else if(packet.type==='pause-request'&&onlineRoom.host){await pause(typeof packet.reason==='string'?packet.reason.slice(0,160):'A player paused the game.');}
 else if(packet.type==='resume-request'&&onlineRoom.host&&onlinePhase==='paused'){await resume();}
 else if(packet.type==='desync'&&onlineRoom.host){onlineSessionReady=false;onlineFailure=typeof packet.reason==='string'?`A player could not synchronize: ${packet.reason.slice(0,240)}`:'A player could not synchronize. Recreate the lobby and load a saved campaign.';await pause();onlinePhase='paused';onlineRoom.broadcast({type:'pause',reason:onlineFailure,fatal:true});message(onlineFailure);}
}
async function synchronizeOnlineStart(){
 if(onlineSending)return;onlineSending=true;onlinePhase='sync';watchOnlineStart();await pause();$('menu-status').textContent='Online startup: sharing the level and waiting for every player…';message('Sharing the starting level with your team…');try{await onlineRoom.sendSnapshot(await encodeSave(captureState(machine,sessionData())));if(onlinePhase==='sync')message('Waiting for every player to load the shared game.');}catch(error){roomError(error);}finally{onlineSending=false;}
}
function setModeLabels(){
 renderColorPickers();
 const watch=watchBots(count),alive=companions.state.bots.filter(b=>b.alive).length,transition=newCampaign?.state.transition,watchRetry=spectator?.state.transition;
 const names={solo:'CAMPAIGN',new:newCampaign?.state.ready||transition?`DLC · STAGE ${transition?.targetRound??newCampaign.state.round}${transition?transition.kind==='retry'?' · RESTARTING':' · NEXT ROUND':''}`:'DLC · PREPARING',campaign:'CAMPAIGN + AI','battle-ai':'BATTLE + AI','online-campaign':'CAMPAIGN · ONLINE','online-battle':'BATTLE · ONLINE'};
 $('mode-label').textContent=(watch?'WATCH · ':'')+names[mode];$('player-count').textContent=onlineGame()?`${count}P`:mode==='battle-ai'?watch?`${watch} AI`:`${count}P`:watch?`${alive} AI`:`${1+alive}P`;
 const reviving=!alive&&companions.state.bots.some(b=>!b.alive&&b.extraLives);
 const progress=watchRetry?.phase==='gameover'?'Game over. The final death sequence is finishing.':watchRetry||(mode==='new'&&transition?.kind==='retry')?'Restarting this round after the death music, fades and stage card.':mode==='new'&&transition?'Round complete. The next round starts after the clear music, fades and stage card.':reviving?'Waiting for a safe tile to use an extra life.':'Bots fight monsters, break the glowing wall and collect its item before using the exit.';
 $('coop-status').textContent=onlineGame()?(mode==='online-campaign'?`Online campaign: ${alive}/${count} alive. Power-ups improve the whole team. The round restarts after everyone is defeated.`:'Online Battle uses the original multiplayer engine. Press Enter to advance results.'):watch?(mode==='battle-ai'?`Watching ${watch} AI opponents. The camera follows a living bot.`:`Watching ${alive} AI Bombermen. The camera follows a living bot. ${progress}`):mode==='battle-ai'?'Computer opponents use the original multiplayer controllers. Press Enter at results to retry.':`Clear all monsters, then break the glowing wall and collect its item before using the blue exit. Local AI teammates: ${alive}. Campaign team power-ups are shared.`;
 refreshPowerups();
}
function refreshPowerups(){
 const visible=Boolean(powerupHUD?.state.enabled&&started&&!returnSave&&!watchBots(count)&&mode!=='battle-ai'&&mode!=='online-battle'&&isCampaign(machine)&&!(machine.RAM[0x43a]&7)&&!machine.RAM[0x437]&&!newCampaign.state.transition);
 $('powerup-panel').hidden=!visible;if(!visible){powerupSignature='';return;}
 const signature=powerupHUD.state.counts.join(',')+':'+machine.RAM[0x84a];if(signature===powerupSignature)return;powerupSignature=signature;
 const grid=$('powerup-inventory');grid.replaceChildren();
 for(const [type,total]of powerupHUD.state.counts.entries())if(total)grid.append(createPowerupBadge(machine,type,total,{document}));
 if(!grid.children.length)grid.textContent='Collect a power-up to add its icon and total here.';
}
function initialize(bytes){
 pendingSoloGameOver=false;
 stopOnlineStartWatch();onlineSessionReady=false;
 if(!machine){machine=new PCE();machine.CountryType=machine.CountryTypeTG16;machine.MultiTap=true;if(!machine.SetCanvas('game-canvas'))throw new Error('Your browser could not create the game screen.');colors=installColorSelector(machine);enemySpawns=createEnemySpawns(machine);companions=createCompanions(machine,{colorize:colorizePlayer,getHuman:()=>spectator?.state.enabled?null:playerPosition(machine)});battleAI=createBattleAI(machine);newCampaign=createNewCampaign(machine,{getFocus:()=>spectator?.state.enabled?spectator.focus():playerPosition(machine),onRound:()=>{if(companions.state.bots.some(b=>b.alive)){companions.respawnForStage();initialBots=0;}else{companions.reset();initialBots=watchBots(count)||count-1;}if(spectator?.state.enabled)spectator.configure(true);setModeLabels();}});spectator=createSpectator(machine,{getBots:()=>companions.state.bots,finiteLives:()=>mode==='solo'&&watchBots(count)>0,onGameOver:()=>{pendingSoloGameOver=true;},onRetry:()=>{companions.reset();initialBots=onlineGame()?networkRoster.length:watchBots(count);setModeLabels();}});levelObjective=createLevelObjective(machine,{getActors:()=>[...(spectator?.state.enabled?[]:[playerPosition(machine)]),...companions.state.bots.filter(b=>b.alive)],getFocus:()=>spectator?.state.enabled?spectator.focus():playerPosition(machine)});powerupHUD=createPowerupHUD(machine,{getHuman:()=>onlineCampaign?.state.enabled?onlineCampaign.focus():spectator?.state.enabled?null:playerPosition(machine)});sharedPowerups=createSharedPowerups(machine,{getActors:()=>companions.state.bots,getHuman:()=>spectator?.state.enabled?null:playerPosition(machine),onCollect:(type,source)=>{if(source&&(!spectator?.state.enabled||onlineCampaign?.state.enabled))powerupHUD.state.counts[type]=Math.min(1000000,powerupHUD.state.counts[type]+1);}});worldStart=createWorldStart(machine);onlineCampaign=createOnlineCampaign(machine,{getActors:()=>companions.state.bots,getLocalID:localActorID});nativeMenu=installNativeMenu(machine,{onSelect:chooseMode,onChange:menuChanged,blockPads:()=>boot.length>0});const pads=machine.CheckGamePad;machine.CheckGamePad=function(){pads.call(this);if(onlineGame())for(let port=0;port<5;port++)this.GamePad[port]=[0xbf,0xbf,0xbf,0xb0];};}
 introSkip??=createIntroSkip(machine);introSkip.configure(false);consumed.clear();nativeMenu.close();
 spectator.configure(false);newCampaign.configure(false);levelObjective.configure(false);powerupHUD.configure(false);sharedPowerups.configure(false);onlineCampaign.reset();worldStart.restore({pending:false,world:0,area:0,loading:false});enemySpawns.reset();powerupSignature="";machine.SetROM(Array.from(bytes));machine.WaveVolume=muted?0:.6;companions.reset();battleAI.configure(2,false);machine._campaignTracker.frame=0;machine._campaignTracker.last=-100;colors.setBattleColors([]);colors.select($('color-select').value);
 frame=0;boot=TITLE_SEQUENCE.map(a=>({...a}));initialBots=0;started=false;mode='solo';$('frame-count').textContent='0';$('start-btn').disabled=true;$('start-btn').textContent='Select';$('pause-btn').textContent='Resume';
 nativeMenu.prepare(Number($('player-count-select').value));nativeMenu.setSave(quickSave);
 for(const id of ['pause-btn','reset-btn','mute-btn','fullscreen-btn','color-select','dump-btn','trace-btn','save-btn','export-save-btn','save-input','open-menu-btn','admin-btn'])$(id).disabled=false;
 $('menu-status').textContent='Opening the original title screen…';
 $('debug-output').textContent='Verified USA ROM loaded. Research downloads stay on your computer.';setModeLabels();
}
async function launch(nextMode,options={}){
 if(!rom||busy)return;await pause();if(onlineRoom?.room)await onlineRoom.leave();onlinePhase=null;pendingCheckpoint=null;finishTrace();nativeMenu.leave();returnSave=null;companions.reset();enemySpawns.reset();battleAI.configure(2,false);mode=nextMode;count=Number($('player-count-select').value);
 if(count>0)count=Math.max(['new','solo'].includes(mode)?1:2,count);sharedPowerups.configure(mode==='campaign'||(mode==='new'&&(count!==1)));onlineCampaign.reset();if(mode==='solo')worldStart.configure(options.world??0);else worldStart.restore({pending:false,world:0,area:0,loading:false});const players=watchBots(count)||count;initialBots=mode==='battle-ai'?0:watchBots(count)||((mode==='campaign'||mode==='new')?count-1:0);battleAI.configure(Math.max(2,players),mode==='battle-ai',Boolean(watchBots(count)));spectator.configure(Boolean(watchBots(count)));newCampaign.configure(mode==='new',players);levelObjective.configure(mode!=='battle-ai');powerupHUD.configure(mode!=='battle-ai');powerupSignature='';
 if(mode==='battle-ai'){const variants=Object.keys(COLORS);colors.setBattleColors([colors.selected,...Array.from({length:players-1},()=>variants[Math.floor(Math.random()*variants.length)])]);}
 boot=launchSequence(mode,players).slice(3).map(action=>({...action}));introSkip.configure(mode!=='battle-ai');started=true;$('start-btn').textContent='Resume';canvas.setAttribute('aria-label',watchBots(count)?`Bomberman AI spectator screen. ${watchBots(count)} bots play automatically. Space skips the opening cutscene.`:'Bomberman game screen. Arrows or WASD move, Space skips the opening cutscene or places bombs. B or X detonates remote bombs after collecting Remote Control.');$('menu-status').textContent='';setModeLabels();message('Starting '+(watchBots(count)?'AI only — watch.':mode==='battle-ai'?'Battle with AI opponents.':mode==='new'?'a new generated campaign.':'the original campaign.'));await resume();
}
async function openMenu(){if(!machine||busy||(!started&&!returnSave))return;await pause();finishTrace();if(onlineGame()){pendingCheckpoint=mode==='online-campaign'?checkpointFromSave(captureState(machine,sessionData())):null;await onlineRoom?.leave();onlinePhase=null;onlineFrames=[];returnSave=null;initialize(rom);updateMenu();message('Online session closed. Recreate the lobby to restart this level with the team upgrades, or load an exported save.');await resume();return;}if(started)returnSave=captureState(machine,sessionData());initialize(rom);updateMenu();message('Opening the main menu. Continue game returns to your current session; choosing a new game replaces it.');await resume();}
$('rom-input').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;const generation=++loadGeneration;await pause();finishTrace();message('Checking game revision…');
 try{if(file.size!==262144)throw new Error('Choose the 256 KiB Bomberman (USA) .pce file.');const bytes=new Uint8Array(await file.arrayBuffer());await verifyROM(bytes);if(generation!==loadGeneration)return;if(onlineRoom?.room)await onlineRoom.leave();onlinePhase=null;pendingCheckpoint=null;returnSave=null;initialize(bytes);rom=bytes;updateMenu();message('Bomberman (USA) verified. Choose your color, then use the game menu.');await resume();}catch(error){if(generation===loadGeneration)message(error.message+(rom?' Your previous game is paused.':''));}
});
$('start-btn').addEventListener('click',async()=>{if(nativeMenu.active){if(!running)await resume();nativeMenu.choose();}else await resume();});
$('pause-btn').addEventListener('click',async()=>{if(returnSave){await pause();const save=returnSave;applySession(save,validateSession(save));await resume();}else if(running)await pause();else await resume();});
$('reset-btn').addEventListener('click',async()=>{await pause();if(onlineRoom?.room)await onlineRoom.leave();onlinePhase=null;pendingCheckpoint=null;finishTrace();returnSave=null;initialize(rom);updateMenu();message('Game reset. Opening the original main menu.');await resume();});
$('open-menu-btn').addEventListener('click',openMenu);
$('player-count-select').addEventListener('change',event=>nativeMenu.setCount(Number(event.target.value)));
$('color-select').addEventListener('change',event=>chooseColor(event.target.value));
installColorPickers();
$('mute-btn').addEventListener('click',()=>{muted=!muted;machine.WaveVolume=muted?0:.6;if(machine.WebAudioGainNode)machine.WebAudioGainNode.gain.value=machine.WaveVolume;$('mute-btn').textContent=muted?'Unmute':'Mute';$('mute-btn').setAttribute('aria-pressed',String(muted));});
$('fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('game-canvas').requestFullscreen();}catch{message('Fullscreen is unavailable in this browser.');}});
function sessionData(){return {frame,color:colors.selected,battleColors:colors.battleColors,mode,count,started,boot:structuredClone(boot),initialBots,openingIntro:{...introSkip.state},companions:structuredClone(companions.state),battleAI:structuredClone(battleAI.state),newCampaign:structuredClone(newCampaign.state),spectator:structuredClone(spectator.state),levelObjective:structuredClone(levelObjective.state),powerupHUD:structuredClone(powerupHUD.state),sharedPowerups:structuredClone(sharedPowerups.state),worldStart:structuredClone(worldStart.state),onlineCampaign:structuredClone(onlineCampaign.state),onlineRoom:onlineGame()?{revision:ONLINE_REVISION,mode:onlineMode,players:structuredClone(networkRoster)}:null,enemySpawns:structuredClone(enemySpawns.state),tracker:{...machine._campaignTracker}};}
function validateSession(save){
 validateState(machine,save);const s=save.session;
 if(!Object.hasOwn(COLORS,s.color)||!Number.isSafeInteger(s.frame)||s.frame<0||!['solo','new','campaign','battle-ai','online-campaign','online-battle'].includes(s.mode)||!Number.isInteger(s.count)||(s.count>0&&s.count<(['solo','new'].includes(s.mode)?1:2))||s.count< -4||s.count>5||typeof s.started!=='boolean'||!Array.isArray(s.battleColors)||s.battleColors.length>5||s.battleColors.some(c=>!Object.hasOwn(COLORS,c))||!Array.isArray(s.boot)||s.boot.length>30||s.boot.some(a=>!a||!Number.isInteger(a.frames)||a.frames<1||a.frames>240||(a.button!==undefined&&!['RUN','DOWN'].includes(a.button)))||!Number.isInteger(s.initialBots)||s.initialBots<0||s.initialBots>(s.mode==='online-campaign'?5:4)||!s.tracker||!Number.isSafeInteger(s.tracker.frame)||s.tracker.frame<0||!Number.isSafeInteger(s.tracker.last)||s.tracker.last>s.tracker.frame||s.tracker.last< -100)throw new Error('Invalid session data in save.');
 if(s.openingIntro!==undefined){validateIntroSkip(s.openingIntro);if(s.openingIntro.pending&&(!s.started||s.mode==='battle-ai'))throw new Error('Inconsistent opening intro state in save.');}
 if(s.newCampaign!==undefined)validateNewCampaign(s.newCampaign);else if(s.mode==='new')throw new Error('Missing NEW campaign state in save.');
 if(s.spectator!==undefined)validateSpectatorState(s.spectator);if(watchBots(s.count)&&(!s.spectator?.enabled||s.battleAI?.spectator!==true))throw new Error('Missing AI spectator state in save.');if(s.spectator&&s.spectator.enabled!==Boolean(watchBots(s.count)||s.mode==='online-campaign'))throw new Error('Inconsistent spectator state in save.');
 if(s.levelObjective!==undefined)validateLevelObjective(s.levelObjective);if(s.powerupHUD!==undefined)validatePowerupHUD(s.powerupHUD);if(s.enemySpawns!==undefined)validateEnemySpawns(s.enemySpawns);if(s.sharedPowerups!==undefined)validateSharedPowerups(s.sharedPowerups);if(s.worldStart!==undefined)validateWorldStart(s.worldStart);if(s.onlineCampaign!==undefined)validateOnlineCampaign(s.onlineCampaign);validateOnlineSave(s);
 validateCompanionState(s.companions);validateBattleState(s.battleAI);return s;
}
async function saveProgress(exportFile=false){
 if(!machine||busy)return;if(!started&&!returnSave){$('save-status').textContent='Start a game before saving.';return;}const wasRunning=running;await pause();finishTrace();busy=true;updateMenu();
 try{const blob=await encodeSave(returnSave??captureState(machine,sessionData()));if(exportFile){download(blob,'bomberman-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bmsave');$('save-status').textContent='Save exported. Keep this file to continue on another computer.';}else{await storeQuickSave(blob);quickSave=blob;$('save-status').textContent='Progress saved in this browser. Export a backup before clearing browser data.';}}
 catch(error){$('save-status').textContent=error.message;}finally{busy=false;updateMenu();if(wasRunning)await resume();}
}
function applySession(save,s){nativeMenu.close();returnSave=null;restoreState(machine,save);colors.setBattleColors(s.battleColors);colors.select(s.color);$('color-select').value=s.color;companions.restore(s.companions);battleAI.restore(s.battleAI);if(s.newCampaign)newCampaign.restore(s.newCampaign);else newCampaign.configure(false);if(s.spectator)spectator.restore(s.spectator);else spectator.configure(false);if(s.levelObjective)levelObjective.restore(s.levelObjective);else levelObjective.configure(s.started&&s.mode!=='battle-ai');if(s.powerupHUD)powerupHUD.restore(s.powerupHUD);else powerupHUD.configure(s.started&&s.mode!=='battle-ai');if(s.enemySpawns)enemySpawns.restore(s.enemySpawns);else enemySpawns.reset();if(s.sharedPowerups)sharedPowerups.restore(s.sharedPowerups);else sharedPowerups.configure(s.mode==='campaign'||s.mode==='new'&&s.count!==1);if(s.worldStart)worldStart.restore(s.worldStart);else worldStart.restore({pending:false,world:0,area:0,loading:false});if(s.onlineCampaign)onlineCampaign.restore(s.onlineCampaign);else onlineCampaign.reset();if(s.onlineRoom)networkRoster=structuredClone(s.onlineRoom.players);powerupSignature='';Object.assign(machine._campaignTracker,s.tracker);frame=s.frame;mode=s.mode;count=s.count===0?-4:s.count;started=s.started;boot=structuredClone(s.boot);initialBots=s.initialBots;if(s.openingIntro)introSkip.restore(s.openingIntro);else introSkip.configure(started&&mode!=='battle-ai'&&s.tracker.last<0);consumed.clear();$('player-count-select').value=String(count);releaseKeys();$('frame-count').textContent=String(frame);$('menu-status').textContent='';$('start-btn').textContent='Resume';$('pause-btn').textContent='Resume';$('start-btn').disabled=false;canvas.setAttribute('aria-label',watchBots(count)?`Bomberman AI spectator screen. ${watchBots(count)} bots play automatically. Space skips the opening cutscene.`:'Bomberman game screen. Arrows or WASD move, Space skips the opening cutscene or places bombs. B or X detonates remote bombs after collecting Remote Control.');setModeLabels();}
async function loadProgress(blob){
 if(!rom||busy||!blob)return;await pause();finishTrace();busy=true;updateMenu();
 try{const save=await decodeSave(blob),s=validateSession(save);if(onlineRoom?.room){await onlineRoom.leave();onlinePhase=null;}if(s.mode==='online-battle'){onlineMode='battle';pendingCheckpoint=null;await openLobby();$('save-status').textContent='Online Battle opens a new lobby. Campaign saves resume their saved level.';return;}if(s.mode==='online-campaign'){pendingCheckpoint=checkpointFromSave(save);onlineMode='campaign';await openLobby();$('save-status').textContent='Online save selected. Recreate the saved roster and start to restart its level.';return;}applySession(save,s);$('save-status').textContent='Save loaded. Press Resume to continue.';message('Your game is restored and paused.');}
 catch(error){$('save-status').textContent=error.message+' Your previous game remains paused.';}finally{busy=false;updateMenu();}
}
$('save-btn').addEventListener('click',()=>saveProgress());$('export-save-btn').addEventListener('click',()=>saveProgress(true));
$('save-input').addEventListener('change',async event=>{const file=event.target.files[0];if(file)await loadProgress(file);event.target.value='';});
readQuickSave().then(blob=>{quickSave=blob;updateMenu();if(blob)$('save-status').textContent='A browser save is available. Load your ROM, then choose LOAD SAVE.';}).catch(()=>{$('save-status').textContent='Browser save storage is unavailable. Use Export / Import save.';});
function refreshAdmin(){
 const map=$('admin-map');map.replaceChildren();const width=Math.min(31,(machine.RAM[0x434]||15)-1),height=Math.min(31,(machine.RAM[0x435]||12)-1);map.style.gridTemplateColumns=`repeat(${width-1}, minmax(0,1fr))`;
 const person=playerPosition(machine),px=Math.floor(person.x/16),py=Math.floor(person.y/16);
 for(let y=1;y<=height;y++)for(let x=2;x<=width;x++){
  const tile=document.createElement('button'),kind=tileKind(machine,x,y);tile.type='button';tile.disabled=kind!==10;tile.className='map-tile '+(kind===1?'wall':[2,3,4,5].includes(kind)?'block':kind===10?'floor':'occupied');
  const bot=companions.state.bots.find(b=>b.alive&&Math.floor(b.x/16)===x&&Math.floor(b.y/16)===y);tile.textContent=x===px&&y===py?'P':bot?'AI':kind===8?'E':kind===7?'＋':'';tile.title=`Tile ${x}, ${y}`;tile.setAttribute('aria-label',`Tile ${x}, ${y}, ${kind===10?'floor':'occupied'}`);tile.setAttribute('aria-pressed',String(selectedTile?.x===x&&selectedTile?.y===y));tile.addEventListener('click',()=>{selectedTile={x,y};if(selectedSpawn)adminSpawn(()=>selectedSpawn.place({x,y}));else refreshAdmin();});map.append(tile);
 }
 $('spawn-coordinate').textContent=selectedTile?`Selected tile: ${selectedTile.x}, ${selectedTile.y}`:'No empty floor is available.';
 $('team-list').textContent=companions.state.bots.map(b=>`${b.color==='original'?'White':b.color} #${b.id}: ${b.action} · ${companionBombSlots(b).filter(i=>machine.RAM[0x84f+i]&128).length}/${b.bombCapacity} bombs in use · ${b.bombsPlaced} placed · fire ${b.fireRange} · ${b.pickupsCollected} pickups${b.fireproof?` · vest ${Math.ceil(b.fireproof/60)}s`:""}${b.extraLives?` · ${b.extraLives} extra lives`:""}`).join('\n')||'No AI teammates yet.';
 const grid=$('enemy-grid');grid.replaceChildren();
 for(const key of [...spawnButtons.keys()])if(key.startsWith('enemy:'))spawnButtons.delete(key);
 for(const entry of enemyCatalog(machine)){
  const key=`enemy:${entry.type}`,button=createEnemyCard(machine,entry,{document,onSpawn:()=>selectSpawn(key,entry.name,tile=>spawnEnemyType(machine,entry.type,tile.x,tile.y))});spawnButtons.set(key,button);grid.append(button);
 }
 updateSpawnSelection();
}
function updateSpawnSelection(){
 for(const [key,button]of spawnButtons)button.setAttribute('aria-pressed',String(selectedSpawn?.key===key));
 $('spawn-deselect').disabled=!selectedSpawn;
 $('spawn-tool').textContent=selectedSpawn?`${selectedSpawn.label} selected. Click empty tiles to place copies. Click the selected tool again or Deselect to stop.`:'Select an item, monster or teammate, then click empty tiles to place it.';
}
function selectSpawn(key,label,place){selectedSpawn=selectedSpawn?.key===key?null:{key,label,place};refreshAdmin();$('admin-status').textContent=selectedSpawn?`${label} selected. Click any empty tile to place it; selection stays active.`:'Placement tool deselected.';}
function clearSpawn(){selectedSpawn=null;updateSpawnSelection();}
function adminSpawn(action){try{if(!selectedTile)throw new Error('Select an empty floor tile.');const result=action();$('admin-status').textContent=result?.notice??(result?.color?`AI Bomberman added (${result.color==='original'?'white':result.color}). Resume to let it play.`:'Spawned. Resume to see the original engine update.');if(tileKind(machine,selectedTile.x,selectedTile.y)!==10)selectedTile=null;refreshAdmin();setModeLabels();}catch(error){$('admin-status').textContent=error.message;}}
for(const item of ITEM_CATALOG){const key=`item:${item.type}`,button=document.createElement('button');button.textContent=item.name;button.type='button';button.setAttribute('aria-pressed','false');spawnButtons.set(key,button);if(item.type===6){const detail=document.createElement('span');detail.textContent='Bomb blasts only · ~60s';button.append(detail);button.title='Collect to gain temporary bomb-blast protection. Enemies can still hurt you.';}button.addEventListener('click',()=>selectSpawn(key,item.name,tile=>{spawnItem(machine,item.type,tile.x,tile.y);return {notice:item.type===6?'Vest placed. Click more empty tiles to place copies. Resume and collect it for about 60 seconds of bomb-blast protection. Enemies can still hurt you.':'Item placed. Click more empty tiles to place copies, or deselect the item to stop.'};}));$('item-grid').append(button);}
spawnButtons.set('bot',$('spawn-bot'));spawnButtons.set('bomb',$('spawn-bomb'));
$('spawn-bot').addEventListener('click',()=>selectSpawn('bot','AI Bomberman',tile=>{if(!sharedPowerups.state.enabled)sharedPowerups.configure(true);return companions.add(tile.x,tile.y);}));$('spawn-bomb').addEventListener('click',()=>selectSpawn('bomb','Bomb',tile=>spawnBomb(machine,tile.x,tile.y)));
$('spawn-deselect').addEventListener('click',()=>{clearSpawn();$('admin-status').textContent='Placement tool deselected.';});
async function openAdmin(){
 if(!machine||busy)return;if(!isCampaign(machine)||(machine.RAM[0x43a]&7)||machine.RAM[0x437]){message('The admin inventory opens during an active campaign stage.');return;}
 if(onlineGame()){message('Admin spawning is available in local games.');return;}
 adminWasRunning=running;await pause();selectedSpawn=null;const person=playerPosition(machine);try{selectedTile=nearestFreeTile(machine,{x:Math.floor(person.x/16),y:Math.floor(person.y/16)});}catch{selectedTile=null;}$('admin-status').textContent='Game paused. Select a placement tool, then click empty tiles to place copies.';refreshAdmin();$('admin-dialog').showModal();
}
async function closeAdmin(){if(!$('admin-dialog').open)return;$('admin-dialog').close();clearSpawn();if(adminWasRunning)await resume();}
$('admin-btn').addEventListener('click',openAdmin);$('admin-close').addEventListener('click',closeAdmin);$('admin-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAdmin();});
window.addEventListener('keydown',event=>{
 if(event.code==='F2'&&machine){event.preventDefault();if($('admin-dialog').open)closeAdmin();else openAdmin();return;}
 if(!running||document.activeElement!==canvas)return;
 if(event.code==='Escape'&&nativeMenu.active){event.preventDefault();nativeMenu.input('BACK');return;}
 if(consumed.has(event.code)){event.preventDefault();return;}
 if(event.code==='Space'&&!nativeMenu.active&&introSkip.state.pending){event.preventDefault();consumed.add(event.code);if(!event.repeat){introSkip.request();unlockAudio();message('Skipping the opening cutscene…');}return;}
 const binding=KEY_BINDINGS[event.code];if(boot.length||!binding||binding[0]!==0)return;event.preventDefault();
 if(nativeMenu.active){unlockAudio();if(!event.repeat)nativeMenu.input(binding[1]);return;}
 if(onlineGame()){held.add(event.code);updateOnlineInput();return;}
 if(watchBots(count)&&!(mode==='battle-ai'&&binding[1]==='RUN'))return;
 held.add(event.code);machine['SetButton'+binding[1]](binding[0]);
});
window.addEventListener('keyup',event=>{if(consumed.delete(event.code)){event.preventDefault();return;}if(!held.delete(event.code))return;if(onlineGame()){updateOnlineInput();return;}const [port,button]=KEY_BINDINGS[event.code];if(![...held].some(code=>KEY_BINDINGS[code][0]===port&&KEY_BINDINGS[code][1]===button))machine['UnsetButton'+button](port);});
canvas.addEventListener('click',()=>{canvas.focus({preventScroll:true});if(machine)unlockAudio();});
canvas.addEventListener('blur',()=>{releaseKeys();consumed.clear();});window.addEventListener('blur',()=>{releaseKeys();consumed.clear();if(running)pause('A player switched away from the game.');});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){consumed.clear();pause('A player hid the game tab.');}});
function finishSoloAI(){
 pendingSoloGameOver=false;started=false;initialBots=0;boot=[];returnSave=null;mode='solo';count=-1;
 spectator.configure(false);companions.reset();battleAI.configure(2,false);newCampaign.configure(false);levelObjective.configure(false);powerupHUD.configure(false);sharedPowerups.configure(false);onlineCampaign.reset();worldStart.restore({pending:false,world:0,area:0,loading:false});powerupSignature='';
 releaseKeys();$('player-count-select').value='-1';$('start-btn').textContent='Select';nativeMenu.open(-1);updateMenu();setModeLabels();message('Game over. The solo AI ran out of lives. Choose a new game from the main menu.');
}
function step(){
 if(boot.length){releaseKeys();if(boot[0].button)machine['SetButton'+boot[0].button](0);}else if(nativeMenu.active)releaseKeys();else{powerupHUD.update();sharedPowerups.update();levelObjective.update();newCampaign.update();onlineCampaign.update();spectator.update();companions.update();battleAI.update();}
 if(mode==='online-campaign')spectator.retry();
 if(watchBots(count)&&mode!=='battle-ai'&&companions.state.bots.length&&companions.state.bots.every(b=>!b.alive&&!b.extraLives)&&(mode==='new'?newCampaign.retry():spectator.retry())){
  const stage=mode==='new'?`NEW stage ${newCampaign.state.round}`:`stage ${machine.RAM[0x84a]+1}-${machine.RAM[0x84b]+1}`;
  setModeLabels();message(mode==='solo'&&machine.RAM[0x438]===0?'The solo AI has no lives left. Finishing the original game-over sequence…':`The AI team was defeated. Retrying ${stage} with ${watchBots(count)} bots.`);
 }
 const opening=introSkip.state.pending;if(!boot.length&&!nativeMenu.active)introSkip.update();
 colors.refresh();machine.Run();frame++;refreshPowerups();
 if(pendingSoloGameOver){finishSoloAI();return;}
 if(opening&&!introSkip.state.pending)message('Game ready. Space places bombs; B or X detonates them after collecting Remote Control.');
 if(boot.length&&--boot[0].frames===0){boot.shift();releaseKeys();if(!boot.length){if(!started){nativeMenu.open(Number($('player-count-select').value));updateMenu();message('Main menu ready. Up/Down select, Left/Right change players, Enter starts.');}else message(introSkip.state.pending?introSkip.state.requested?'Skipping the opening cutscene…':'Opening cutscene. Press Space to skip.':'Game ready. Click the game screen to focus controls.');}}
 if(initialBots&&isCampaign(machine)&&!(machine.RAM[0x43a]&7)&&!machine.RAM[0x437]){
  const hidden=watchBots(count)||mode==='online-campaign',person=hidden?{x:40,y:24}:playerPosition(machine),blocked=hidden?new Set():new Set([`${Math.floor(person.x/16)},${Math.floor(person.y/16)}`]),tiles=campaignSpawnCells(machine,initialBots,{start:{x:Math.floor(person.x/16),y:Math.floor(person.y/16)},blocked});if(tiles.length){for(const [n,tile]of tiles.entries()){try{const actor=companions.add(tile.x,tile.y);if(mode==='online-campaign')actor.color=networkRoster[n].color;}catch(error){message(error.message);break;}}initialBots=0;setModeLabels();}
 }
 if(onlinePhase==='boot'&&onlineRoom?.host&&!boot.length&&(mode==='online-battle'?activeBattle(machine):!introSkip.state.pending&&!initialBots&&isCampaign(machine)))synchronizeOnlineStart().catch(roomError);
 if(pendingTrace&&frame>=pendingTrace.start+120)finishTrace();if(frame%60===0)setModeLabels();
}
function tick(now){
 if(running){
  accumulator+=Math.min(now-lastTime,FRAME_MS*3);
  try{
   const guestPlay=onlineGame()&&onlinePhase==='play'&&!onlineRoom.host,maxSteps=guestPlay?ONLINE_CATCH_UP_STEPS:3,sliceStart=performance.now();let steps=0;
   updateOnlineInput();
   while(running&&steps<maxSteps&&(!guestPlay||!steps||performance.now()-sliceStart<12)&&(accumulator>=FRAME_MS||guestPlay&&onlineFrames.length>2)){
    if(onlineGame()&&onlinePhase==='play'){
     if(onlineRoom.host){
      if(!onlineRoom.connected())throw new Error('A player disconnected.');
      // A slow guest or network must slow the shared simulation, rather than
      // creating an ever-growing input delay and eventually a fatal backlog.
      if(!hostCanAdvance()){accumulator=0;waitForOnlinePeer(true);break;}
      waitForOnlinePeer(false);
      const packet={type:'frames',start:onlineSequence,inputs:[...onlineMasks],...(onlineSequence%120===0?{hash:simulationHash()}: {})};
      if(!onlineRoom.broadcast(packet))throw new Error('A player disconnected.');applyOnlineFrame(packet);
     }else{
      const packet=onlineFrames.shift();if(!packet){accumulator=0;break;}applyOnlineFrame(packet);
     }
    }else if(!onlineGame()||onlinePhase==='boot')step();else break;
    steps++;accumulator=Math.max(0,accumulator-FRAME_MS);
   }
   if(guestPlay&&steps&&!onlineRoom.toHost({type:'progress',sequence:onlineSequence}))throw new Error('The host disconnected.');
   $('frame-count').textContent=String(frame);
  }catch(error){onlineSessionReady=false;onlineFailure=error.message;pause(error.message);if(onlineRoom?.room){if(onlineRoom.host)onlineRoom.broadcast({type:'pause',reason:error.message,fatal:true});else onlineRoom.toHost({type:'desync',reason:error.message});}message('Emulation stopped: '+error.message);}
 }
 lastTime=now;requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('debug-toggle').addEventListener('click',()=>{const panel=$('debug-panel');panel.hidden=!panel.hidden;$('debug-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
$('dump-btn').addEventListener('click',()=>download(Uint8Array.from(machine.RAM.slice(0,8192)),'campaign-ram.bin'));
$('trace-btn').addEventListener('click',()=>{pendingTrace={hook:traceWrites(machine),start:frame};$('trace-btn').disabled=true;$('debug-output').textContent='Recording the next 120 emulated frames. Resume and move or place a bomb.';});
