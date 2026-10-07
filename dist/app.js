import {PCE} from './vendor/pce.js';
import {verifyROM,installColorSelector,colorizePlayer,COLORS,KEY_BINDINGS,traceWrites} from './session.js';
import {captureState,validateState,restoreState,encodeSave,decodeSave,storeQuickSave,readQuickSave} from './save-state.js';
import {createCompanions,validateCompanionState,ITEM_CATALOG,isCampaign,tileKind,playerPosition,enemies,spawnItem,spawnBomb,spawnEnemy,nearestFreeTile,companionBombSlots} from './campaign.js';
import {createBattleAI,validateBattleState,launchSequence} from './battle-ai.js';
import {installNativeMenu,TITLE_SEQUENCE} from './native-menu.js';
import {createNewCampaign,validateNewCampaign} from './new-campaign.js';
import {createSpectator,validateSpectatorState} from './spectator.js';
const $=id=>document.getElementById(id),canvas=$('game-canvas'),FRAME_MS=1000/59.8261;
let machine,rom,colors,companions,battleAI,nativeMenu,newCampaign,spectator,running=false,muted=false,frame=0,mode='solo',count=2;
let lastTime=0,accumulator=0,pendingTrace,loadGeneration=0,boot=[],initialBots=0,started=false;
let quickSave=null,busy=false,adminWasRunning=false,selectedTile=null,returnSave=null;
const held=new Set();
function message(text){$('load-status').textContent=text;}
function releaseKeys(){if(machine)for(let port=0;port<5;port++)for(const button of ['UP','RIGHT','DOWN','LEFT','SHOT1','SHOT2','RUN','SELECT'])machine['UnsetButton'+button](port);held.clear();}
function download(data,name,type='application/octet-stream'){
 const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function finishTrace(){if(!pendingTrace)return;const result=pendingTrace.hook.finish();download(JSON.stringify({rom:'Bomberman (USA)',startFrame:pendingTrace.start,endFrame:frame,...result},null,2),'campaign-trace.json','application/json');$('debug-output').textContent=`Captured ${result.records.length} writes (${result.dropped} dropped).`;pendingTrace=undefined;$('trace-btn').disabled=false;}
async function pause(){running=false;accumulator=0;releaseKeys();$('pause-btn').textContent=returnSave?'Continue game':'Resume';try{await machine?.WebAudioCtx?.suspend();}catch{}}
function unlockAudio(){try{machine.WebAudioCtx?.resume()?.catch(()=>message('Audio is unavailable. The game can still run.'));}catch{message('Audio is unavailable. The game can still run.');}}
async function resume(){if(!machine||busy||$('admin-dialog').open)return;unlockAudio();running=true;lastTime=performance.now();accumulator=0;$('pause-btn').textContent=returnSave?'Continue game':'Pause';$('start-btn').disabled=!nativeMenu.active;canvas.focus({preventScroll:true});}
function updateMenu(){nativeMenu?.setSave(quickSave);$('start-btn').disabled=!rom||busy||(!nativeMenu?.active&&running);}
function menuChanged(s){const players=s.count===0?'AI only — watch four bots':`${s.count} players`;$('player-count-select').value=String(s.count);canvas.setAttribute('aria-label',`Bomberman main menu. Selected ${s.label}. ${players}. Up and Down select, Left and Right change players, Enter starts.`);$('menu-status').textContent=s.mode==='online'?'Battle (Online): online rooms are not connected yet.':s.mode==='load'&&!s.hasSave?'LOAD SAVE: no browser save yet. Import an exported save below.':`${s.label} · ${players}. Up/Down to choose, Enter to select.`;}
async function chooseMode(nextMode,players){
 if(busy||!nativeMenu.active)return;
 if(nextMode==='online'){message('Online Battle is not connected yet. Choose Solo, Campaign or Battle (A.I).');return;}
 if(nextMode==='load'){if(quickSave)await loadProgress(quickSave);else message('No browser save yet. Import a .bmsave file or start a game and save progress.');return;}
 count=players;await launch(nextMode);
}
function setModeLabels(){const watch=count===0,alive=companions.state.bots.filter(b=>b.alive).length,names={solo:'SOLO',new:newCampaign?.state.ready?`NEW · STAGE ${newCampaign.state.round}`:'NEW · PREPARING',campaign:'CAMPAIGN + AI','battle-ai':'BATTLE + AI'};$('mode-label').textContent=(watch?'WATCH · ':'')+names[mode];$('player-count').textContent=mode==='battle-ai'?watch?'4 AI':`${count}P`:watch?`${alive} AI`:`${1+alive}P`;$('coop-status').textContent=watch?(mode==='battle-ai'?'Watching four AI opponents. Press Enter at results to retry.':`Watching ${alive} AI Bombermen. The camera follows a living bot. ${spectator.state.finished?'The team was defeated; choose a new game from Main menu.':'Bots fight monsters, clear blocks and seek the exit.'}`):mode==='battle-ai'?'Computer opponents use the original multiplayer controllers. Press Enter at results to retry.':`${mode==='new'?'Clear all monsters, collect power-ups and uncover the blue exit. ':''}Local AI teammates: ${alive}. They can be defeated. Remote multiplayer is still pending.`;}
function initialize(bytes){
 if(!machine){machine=new PCE();machine.CountryType=machine.CountryTypeTG16;machine.MultiTap=true;if(!machine.SetCanvas('game-canvas'))throw new Error('Your browser could not create the game screen.');colors=installColorSelector(machine);companions=createCompanions(machine,{colorize:colorizePlayer,getHuman:()=>spectator?.state.enabled?null:playerPosition(machine)});battleAI=createBattleAI(machine);newCampaign=createNewCampaign(machine,{getFocus:()=>spectator?.state.enabled?spectator.focus():playerPosition(machine),onRound:()=>{companions.reset();initialBots=count===0?4:count-1;setModeLabels();}});spectator=createSpectator(machine,{getBots:()=>companions.state.bots});nativeMenu=installNativeMenu(machine,{onSelect:chooseMode,onChange:menuChanged,blockPads:()=>boot.length>0});}
 nativeMenu.close();
 spectator.configure(false);newCampaign.configure(false);machine.SetROM(Array.from(bytes));machine.WaveVolume=muted?0:.6;companions.reset();battleAI.configure(2,false);machine._campaignTracker.frame=0;machine._campaignTracker.last=-100;colors.setBattleColors([]);colors.select($('color-select').value);
 frame=0;boot=TITLE_SEQUENCE.map(a=>({...a}));initialBots=0;started=false;mode='solo';$('frame-count').textContent='0';$('start-btn').disabled=true;$('start-btn').textContent='Select';$('pause-btn').textContent='Resume';
 nativeMenu.prepare(Number($('player-count-select').value));nativeMenu.setSave(quickSave);
 for(const id of ['pause-btn','reset-btn','mute-btn','fullscreen-btn','color-select','dump-btn','trace-btn','save-btn','export-save-btn','save-input','open-menu-btn','admin-btn'])$(id).disabled=false;
 $('menu-status').textContent='Opening the original title screen…';
 $('debug-output').textContent='Verified USA ROM loaded. Research downloads stay on your computer.';setModeLabels();
}
async function launch(nextMode){
 if(!rom||busy)return;await pause();finishTrace();nativeMenu.leave();returnSave=null;companions.reset();battleAI.configure(2,false);mode=nextMode;count=Number($('player-count-select').value);
 if(count!==0)count=Math.max(mode==='new'?1:2,count);const players=count===0?4:count;initialBots=mode==='battle-ai'?0:count===0?4:mode==='campaign'||mode==='new'?count-1:0;battleAI.configure(Math.max(2,players),mode==='battle-ai',count===0);spectator.configure(count===0);newCampaign.configure(mode==='new',players);
 if(mode==='battle-ai'){const variants=Object.keys(COLORS);colors.setBattleColors([colors.selected,...Array.from({length:players-1},()=>variants[Math.floor(Math.random()*variants.length)])]);}
 boot=launchSequence(mode,players).slice(3).map(action=>({...action}));started=true;$('start-btn').textContent='Resume';canvas.setAttribute('aria-label',count===0?'Bomberman AI spectator screen. Four bots play automatically.':'Bomberman game screen. Arrows or WASD move, Space places bombs.');$('menu-status').textContent='';setModeLabels();message('Starting '+(count===0?'AI only — watch.':mode==='battle-ai'?'Battle with AI opponents.':mode==='new'?'a new generated campaign.':'the original campaign.'));await resume();
}
async function openMenu(){if(!machine||busy||(!started&&!returnSave))return;await pause();finishTrace();if(started)returnSave=captureState(machine,sessionData());initialize(rom);updateMenu();message('Opening the main menu. Continue game returns to your current session; choosing a new game replaces it.');await resume();}
$('rom-input').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;const generation=++loadGeneration;await pause();finishTrace();message('Checking game revision…');
 try{if(file.size!==262144)throw new Error('Choose the 256 KiB Bomberman (USA) .pce file.');const bytes=new Uint8Array(await file.arrayBuffer());await verifyROM(bytes);if(generation!==loadGeneration)return;returnSave=null;initialize(bytes);rom=bytes;updateMenu();message('Bomberman (USA) verified. Choose your color, then use the game menu.');await resume();}catch(error){if(generation===loadGeneration)message(error.message+(rom?' Your previous game is paused.':''));}
});
$('start-btn').addEventListener('click',async()=>{if(nativeMenu.active){if(!running)await resume();nativeMenu.choose();}else await resume();});
$('pause-btn').addEventListener('click',async()=>{if(returnSave){await pause();const save=returnSave;applySession(save,validateSession(save));await resume();}else if(running)await pause();else await resume();});
$('reset-btn').addEventListener('click',async()=>{await pause();finishTrace();returnSave=null;initialize(rom);updateMenu();message('Game reset. Opening the original main menu.');await resume();});
$('open-menu-btn').addEventListener('click',openMenu);
$('player-count-select').addEventListener('change',event=>nativeMenu.setCount(Number(event.target.value)));
$('color-select').addEventListener('change',event=>colors.select(event.target.value));
$('mute-btn').addEventListener('click',()=>{muted=!muted;machine.WaveVolume=muted?0:.6;if(machine.WebAudioGainNode)machine.WebAudioGainNode.gain.value=machine.WaveVolume;$('mute-btn').textContent=muted?'Unmute':'Mute';$('mute-btn').setAttribute('aria-pressed',String(muted));});
$('fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('game-canvas').requestFullscreen();}catch{message('Fullscreen is unavailable in this browser.');}});
function sessionData(){return {frame,color:colors.selected,battleColors:colors.battleColors,mode,count,started,boot:structuredClone(boot),initialBots,companions:structuredClone(companions.state),battleAI:structuredClone(battleAI.state),newCampaign:structuredClone(newCampaign.state),spectator:structuredClone(spectator.state),tracker:{...machine._campaignTracker}};}
function validateSession(save){
 validateState(machine,save);const s=save.session;
 if(!Object.hasOwn(COLORS,s.color)||!Number.isSafeInteger(s.frame)||s.frame<0||!['solo','new','campaign','battle-ai'].includes(s.mode)||!Number.isInteger(s.count)||(s.count!==0&&s.count<(s.mode==='new'?1:2))||s.count<0||s.count>5||typeof s.started!=='boolean'||!Array.isArray(s.battleColors)||s.battleColors.length>5||s.battleColors.some(c=>!Object.hasOwn(COLORS,c))||!Array.isArray(s.boot)||s.boot.length>30||s.boot.some(a=>!a||!Number.isInteger(a.frames)||a.frames<1||a.frames>240||(a.button!==undefined&&!['RUN','DOWN'].includes(a.button)))||!Number.isInteger(s.initialBots)||s.initialBots<0||s.initialBots>4||!s.tracker||!Number.isSafeInteger(s.tracker.frame)||s.tracker.frame<0||!Number.isSafeInteger(s.tracker.last)||s.tracker.last>s.tracker.frame||s.tracker.last< -100)throw new Error('Invalid session data in save.');
 if(s.newCampaign!==undefined)validateNewCampaign(s.newCampaign);else if(s.mode==='new')throw new Error('Missing NEW campaign state in save.');
 if(s.spectator!==undefined)validateSpectatorState(s.spectator);if(s.count===0&&(!s.spectator?.enabled||s.battleAI.spectator!==true))throw new Error('Missing AI spectator state in save.');if(s.spectator&&s.spectator.enabled!==(s.count===0))throw new Error('Inconsistent spectator state in save.');
 validateCompanionState(s.companions);validateBattleState(s.battleAI);return s;
}
async function saveProgress(exportFile=false){
 if(!machine||busy)return;if(!started&&!returnSave){$('save-status').textContent='Start a game before saving.';return;}const wasRunning=running;await pause();finishTrace();busy=true;updateMenu();
 try{const blob=await encodeSave(returnSave??captureState(machine,sessionData()));if(exportFile){download(blob,'bomberman-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bmsave');$('save-status').textContent='Save exported. Keep this file to continue on another computer.';}else{await storeQuickSave(blob);quickSave=blob;$('save-status').textContent='Progress saved in this browser. Export a backup before clearing browser data.';}}
 catch(error){$('save-status').textContent=error.message;}finally{busy=false;updateMenu();if(wasRunning)await resume();}
}
function applySession(save,s){nativeMenu.close();returnSave=null;restoreState(machine,save);colors.setBattleColors(s.battleColors);colors.select(s.color);$('color-select').value=s.color;companions.restore(s.companions);battleAI.restore(s.battleAI);if(s.newCampaign)newCampaign.restore(s.newCampaign);else newCampaign.configure(false);if(s.spectator)spectator.restore(s.spectator);else spectator.configure(false);Object.assign(machine._campaignTracker,s.tracker);frame=s.frame;mode=s.mode;count=s.count;started=s.started;boot=structuredClone(s.boot);initialBots=s.initialBots;$('player-count-select').value=String(count);releaseKeys();$('frame-count').textContent=String(frame);$('menu-status').textContent='';$('start-btn').textContent='Resume';$('pause-btn').textContent='Resume';$('start-btn').disabled=false;canvas.setAttribute('aria-label',count===0?'Bomberman AI spectator screen. Four bots play automatically.':'Bomberman game screen. Arrows or WASD move, Space places bombs.');setModeLabels();}
async function loadProgress(blob){
 if(!rom||busy||!blob)return;await pause();finishTrace();busy=true;updateMenu();
 try{const save=await decodeSave(blob),s=validateSession(save);applySession(save,s);$('save-status').textContent='Save loaded. Press Resume to continue.';message('Your game is restored and paused.');}
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
  const bot=companions.state.bots.find(b=>b.alive&&Math.floor(b.x/16)===x&&Math.floor(b.y/16)===y);tile.textContent=x===px&&y===py?'P':bot?'AI':kind===8?'E':kind===7?'＋':'';tile.title=`Tile ${x}, ${y}`;tile.setAttribute('aria-label',`Tile ${x}, ${y}, ${kind===10?'floor':'occupied'}`);tile.setAttribute('aria-pressed',String(selectedTile?.x===x&&selectedTile?.y===y));tile.addEventListener('click',()=>{selectedTile={x,y};refreshAdmin();});map.append(tile);
 }
 $('spawn-coordinate').textContent=selectedTile?`Selected tile: ${selectedTile.x}, ${selectedTile.y}`:'No empty floor is available.';
 $('team-list').textContent=companions.state.bots.map(b=>`${b.color==='original'?'White':b.color} #${b.id}: ${b.action} · ${companionBombSlots(b).filter(i=>machine.RAM[0x84f+i]&128).length}/${b.bombCapacity} bombs in use · ${b.bombsPlaced} placed`).join('\n')||'No AI teammates yet.';
 const grid=$('enemy-grid');grid.replaceChildren();const seen=new Set();
 for(const enemy of enemies(machine)){if(enemy.type>=23||seen.has(enemy.type))continue;seen.add(enemy.type);const button=document.createElement('button');button.textContent=enemy.type===2?'Ballom':`Monster type ${enemy.type}`;button.addEventListener('click',()=>adminSpawn(()=>spawnEnemy(machine,enemy.slot,selectedTile.x,selectedTile.y)));grid.append(button);}
 if(!seen.size)grid.textContent='No living monster templates in this stage.';
}
function adminSpawn(action){try{if(!selectedTile)throw new Error('Select an empty floor tile.');const result=action();$('admin-status').textContent=result?.notice??(result?.color?`AI Bomberman added (${result.color==='original'?'white':result.color}). Resume to let it play.`:'Spawned. Resume to see the original engine update.');if(tileKind(machine,selectedTile.x,selectedTile.y)!==10)selectedTile=null;refreshAdmin();setModeLabels();}catch(error){$('admin-status').textContent=error.message;}}
for(const item of ITEM_CATALOG){const button=document.createElement('button');button.textContent=item.name;if(item.type===6){const detail=document.createElement('span');detail.textContent='Bomb blasts only · ~60s';button.append(detail);button.title='Collect to gain temporary bomb-blast protection. Enemies can still hurt you.';}button.addEventListener('click',()=>adminSpawn(()=>{spawnItem(machine,item.type,selectedTile.x,selectedTile.y);return {notice:item.type===6?'Vest placed. Resume and collect it for about 60 seconds of bomb-blast protection. Enemies can still hurt you.':'Item placed. Resume and walk over it to collect its power.'};}));$('item-grid').append(button);}
$('spawn-bot').addEventListener('click',()=>adminSpawn(()=>companions.add(selectedTile.x,selectedTile.y)));$('spawn-bomb').addEventListener('click',()=>adminSpawn(()=>spawnBomb(machine,selectedTile.x,selectedTile.y)));
async function openAdmin(){
 if(!machine||busy)return;if(!isCampaign(machine)||(machine.RAM[0x43a]&7)||machine.RAM[0x437]){message('The admin inventory opens during an active campaign stage.');return;}
 adminWasRunning=running;await pause();const person=playerPosition(machine);try{selectedTile=nearestFreeTile(machine,{x:Math.floor(person.x/16),y:Math.floor(person.y/16)});}catch{selectedTile=null;}$('admin-status').textContent='Game paused. Select an empty floor tile and choose what to spawn.';refreshAdmin();$('admin-dialog').showModal();
}
async function closeAdmin(){if(!$('admin-dialog').open)return;$('admin-dialog').close();if(adminWasRunning)await resume();}
$('admin-btn').addEventListener('click',openAdmin);$('admin-close').addEventListener('click',closeAdmin);$('admin-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAdmin();});
window.addEventListener('keydown',event=>{
 if(event.code==='F2'&&machine){event.preventDefault();if($('admin-dialog').open)closeAdmin();else openAdmin();return;}
 const binding=KEY_BINDINGS[event.code];if(!running||boot.length||!binding||document.activeElement!==canvas||binding[0]!==0)return;event.preventDefault();
 if(nativeMenu.active){unlockAudio();if(!event.repeat)nativeMenu.input(binding[1]);return;}
 if(count===0&&!(mode==='battle-ai'&&binding[1]==='RUN'))return;
 held.add(event.code);machine['SetButton'+binding[1]](binding[0]);
});
window.addEventListener('keyup',event=>{if(!held.delete(event.code))return;const [port,button]=KEY_BINDINGS[event.code];if(![...held].some(code=>KEY_BINDINGS[code][0]===port&&KEY_BINDINGS[code][1]===button))machine['UnsetButton'+button](port);});
canvas.addEventListener('click',async event=>{if(!nativeMenu?.active||boot.length||busy)return;unlockAudio();if(!running)await resume();canvas.focus({preventScroll:true});const rect=canvas.getBoundingClientRect();nativeMenu.pointer((event.clientY-rect.top)*canvas.height/rect.height);});
canvas.addEventListener('blur',releaseKeys);window.addEventListener('blur',()=>{if(running)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
function step(){
 if(boot.length){releaseKeys();if(boot[0].button)machine['SetButton'+boot[0].button](0);}else if(nativeMenu.active)releaseKeys();else{newCampaign.update();spectator.update();companions.update();battleAI.update();}
 colors.refresh();machine.Run();frame++;
 if(boot.length&&--boot[0].frames===0){boot.shift();releaseKeys();if(!boot.length){if(!started){nativeMenu.open(Number($('player-count-select').value));updateMenu();message('Main menu ready. Up/Down select, Left/Right change players, Enter starts.');}else message('Game ready. Click the game screen to focus controls.');}}
 if(initialBots&&isCampaign(machine)&&!(machine.RAM[0x43a]&7)&&!machine.RAM[0x437]){
  const person=count===0?{x:40,y:24}:playerPosition(machine),blocked=count===0?new Set():new Set([`${Math.floor(person.x/16)},${Math.floor(person.y/16)}`]);for(let n=0;n<initialBots;n++){try{const tile=nearestFreeTile(machine,{x:Math.floor(person.x/16),y:Math.floor(person.y/16)},blocked);companions.add(tile.x,tile.y);blocked.add(`${tile.x},${tile.y}`);}catch(error){message(error.message);break;}}initialBots=0;setModeLabels();
 }
 if(count===0&&spectator.state.finished&&running){pause();setModeLabels();message('The AI team was defeated. Choose a new game from Main menu.');}
 if(pendingTrace&&frame>=pendingTrace.start+120)finishTrace();if(frame%60===0)setModeLabels();
}
function tick(now){if(running){accumulator+=Math.min(now-lastTime,FRAME_MS*3);try{let steps=0;while(accumulator>=FRAME_MS&&steps++<3){step();accumulator-=FRAME_MS;}$('frame-count').textContent=String(frame);}catch(error){pause();message('Emulation stopped: '+error.message);}}lastTime=now;requestAnimationFrame(tick);}
requestAnimationFrame(tick);
$('debug-toggle').addEventListener('click',()=>{const panel=$('debug-panel');panel.hidden=!panel.hidden;$('debug-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
$('dump-btn').addEventListener('click',()=>download(Uint8Array.from(machine.RAM.slice(0,8192)),'campaign-ram.bin'));
$('trace-btn').addEventListener('click',()=>{pendingTrace={hook:traceWrites(machine),start:frame};$('trace-btn').disabled=true;$('debug-output').textContent='Recording the next 120 emulated frames. Resume and move or place a bomb.';});
