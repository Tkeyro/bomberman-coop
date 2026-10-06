import {PCE} from './vendor/pce.js';
import {verifyROM,installColorSelector,colorizePlayer,COLORS,KEY_BINDINGS,traceWrites} from './session.js';
import {captureState,validateState,restoreState,encodeSave,decodeSave,storeQuickSave,readQuickSave} from './save-state.js';
import {createCompanions,validateCompanionState,ITEM_CATALOG,isCampaign,tileKind,playerPosition,enemies,spawnItem,spawnBomb,spawnEnemy,nearestFreeTile} from './campaign.js';
import {createBattleAI,validateBattleState,launchSequence} from './battle-ai.js';
const $=id=>document.getElementById(id),canvas=$('game-canvas'),FRAME_MS=1000/59.8261;
let machine,rom,colors,companions,battleAI,running=false,muted=false,frame=0,mode='solo',count=2;
let lastTime=0,accumulator=0,pendingTrace,loadGeneration=0,boot=[],initialBots=0,started=false;
let quickSave=null,busy=false,adminWasRunning=false,selectedTile=null;
const held=new Set();
function message(text){$('load-status').textContent=text;}
function releaseKeys(){if(machine)for(let port=0;port<5;port++)for(const button of ['UP','RIGHT','DOWN','LEFT','SHOT1','SHOT2','RUN','SELECT'])machine['UnsetButton'+button](port);held.clear();}
function download(data,name,type='application/octet-stream'){
 const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function finishTrace(){if(!pendingTrace)return;const result=pendingTrace.hook.finish();download(JSON.stringify({rom:'Bomberman (USA)',startFrame:pendingTrace.start,endFrame:frame,...result},null,2),'campaign-trace.json','application/json');$('debug-output').textContent=`Captured ${result.records.length} writes (${result.dropped} dropped).`;pendingTrace=undefined;$('trace-btn').disabled=false;}
async function pause(){running=false;accumulator=0;releaseKeys();$('pause-btn').textContent='Resume';try{await machine?.WebAudioCtx?.suspend();}catch{}}
async function resume(){if(!machine||busy||$('admin-dialog').open)return;try{await machine.WebAudioCtx?.resume();}catch{message('Audio is unavailable. The game can still run.');}running=true;lastTime=performance.now();accumulator=0;$('pause-btn').textContent='Pause';$('start-btn').disabled=true;canvas.focus({preventScroll:true});}
function updateMenu(){for(const id of ['solo-mode','campaign-mode','battle-mode'])$(id).disabled=!rom||busy;$('load-mode').disabled=!rom||!quickSave||busy;}
function setModeLabels(){const names={solo:'SOLO',campaign:'CAMPAIGN + AI','battle-ai':'BATTLE + AI'};$('mode-label').textContent=names[mode];$('player-count').textContent=mode==='battle-ai'?`${count}P`: `${1+companions.state.bots.filter(b=>b.alive).length}P`;$('coop-status').textContent=mode==='battle-ai'?'Computer opponents use the original multiplayer controllers. Press Enter at results to retry.':`Local AI teammates: ${companions.state.bots.filter(b=>b.alive).length}. They can be defeated. Remote multiplayer is still pending.`;}
function initialize(bytes){
 if(!machine){machine=new PCE();machine.CountryType=machine.CountryTypeTG16;machine.MultiTap=true;if(!machine.SetCanvas('game-canvas'))throw new Error('Your browser could not create the game screen.');colors=installColorSelector(machine);companions=createCompanions(machine,{colorize:colorizePlayer});battleAI=createBattleAI(machine);}
 machine.SetROM(Array.from(bytes));machine.WaveVolume=muted?0:.6;companions.reset();battleAI.configure(2,false);machine._campaignTracker.frame=0;machine._campaignTracker.last=-100;colors.setBattleColors([]);colors.select($('color-select').value);
 frame=0;boot=[];initialBots=0;started=false;mode='solo';$('frame-count').textContent='0';$('start-btn').disabled=false;$('pause-btn').textContent='Resume';
 for(const id of ['pause-btn','reset-btn','mute-btn','fullscreen-btn','color-select','dump-btn','trace-btn','save-btn','export-save-btn','save-input','open-menu-btn','admin-btn'])$(id).disabled=false;
 $('menu-panel').hidden=false;$('menu-help').textContent='Choose a mode and your Bomberman color. Starting a new game replaces the current session; save first to keep it.';
 $('debug-output').textContent='Verified USA ROM loaded. Research downloads stay on your computer.';setModeLabels();
}
async function launch(nextMode){
 if(!rom||busy)return;await pause();finishTrace();initialize(rom);mode=nextMode;count=Number($('player-count-select').value)||2;
 initialBots=mode==='campaign'?count-1:0;battleAI.configure(count,mode==='battle-ai');
 if(mode==='battle-ai'){const variants=Object.keys(COLORS);colors.setBattleColors([colors.selected,...Array.from({length:count-1},()=>variants[Math.floor(Math.random()*variants.length)])]);}
 boot=launchSequence(mode,count).map(action=>({...action}));started=true;$('menu-panel').hidden=false;$('menu-help').textContent='Starting the original game…';setModeLabels();message('Starting '+(mode==='battle-ai'?'Battle with AI opponents.':'the original campaign.'));await resume();
}
async function openMenu(){if(!machine)return;await pause();$('menu-panel').hidden=false;$('menu-help').textContent='Choose a new game, load your browser save, or press Resume to continue. Save before starting a new game.';$('start-btn').disabled=false;updateMenu();}
$('rom-input').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;const generation=++loadGeneration;await pause();finishTrace();message('Checking game revision…');
 try{if(file.size!==262144)throw new Error('Choose the 256 KiB Bomberman (USA) .pce file.');const bytes=new Uint8Array(await file.arrayBuffer());await verifyROM(bytes);if(generation!==loadGeneration)return;initialize(bytes);rom=bytes;updateMenu();message('Bomberman (USA) verified. Choose your color and a game mode.');}catch(error){if(generation===loadGeneration)message(error.message+(rom?' Your previous game is paused.':''));}
});
$('solo-mode').addEventListener('click',()=>launch('solo'));$('campaign-mode').addEventListener('click',()=>launch('campaign'));$('battle-mode').addEventListener('click',()=>launch('battle-ai'));
$('start-btn').addEventListener('click',async()=>{if(started){$('menu-panel').hidden=!boot.length;await resume();}else await launch('solo');});
$('pause-btn').addEventListener('click',async()=>{if(running)await pause();else if(started){$('menu-panel').hidden=!boot.length;await resume();}else await launch('solo');});
$('reset-btn').addEventListener('click',async()=>{await pause();finishTrace();initialize(rom);updateMenu();message('Game reset. Choose a game mode.');});
$('open-menu-btn').addEventListener('click',openMenu);
$('color-select').addEventListener('change',event=>colors.select(event.target.value));
$('mute-btn').addEventListener('click',()=>{muted=!muted;machine.WaveVolume=muted?0:.6;if(machine.WebAudioGainNode)machine.WebAudioGainNode.gain.value=machine.WaveVolume;$('mute-btn').textContent=muted?'Unmute':'Mute';$('mute-btn').setAttribute('aria-pressed',String(muted));});
$('fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('game-canvas').requestFullscreen();}catch{message('Fullscreen is unavailable in this browser.');}});
function sessionData(){return {frame,color:colors.selected,battleColors:colors.battleColors,mode,count,started,boot:structuredClone(boot),initialBots,companions:structuredClone(companions.state),battleAI:structuredClone(battleAI.state),tracker:{...machine._campaignTracker}};}
function validateSession(save){
 validateState(machine,save);const s=save.session;
 if(!Object.hasOwn(COLORS,s.color)||!Number.isSafeInteger(s.frame)||s.frame<0||!['solo','campaign','battle-ai'].includes(s.mode)||!Number.isInteger(s.count)||s.count<2||s.count>5||typeof s.started!=='boolean'||!Array.isArray(s.battleColors)||s.battleColors.length>5||s.battleColors.some(c=>!Object.hasOwn(COLORS,c))||!Array.isArray(s.boot)||s.boot.length>30||s.boot.some(a=>!a||!Number.isInteger(a.frames)||a.frames<1||a.frames>240||(a.button!==undefined&&!['RUN','DOWN'].includes(a.button)))||!Number.isInteger(s.initialBots)||s.initialBots<0||s.initialBots>4||!s.tracker||!Number.isSafeInteger(s.tracker.frame)||s.tracker.frame<0||!Number.isSafeInteger(s.tracker.last)||s.tracker.last>s.tracker.frame||s.tracker.last< -100)throw new Error('Invalid session data in save.');
 validateCompanionState(s.companions);validateBattleState(s.battleAI);return s;
}
async function saveProgress(exportFile=false){
 if(!machine||busy)return;if(!started){$('save-status').textContent='Start a game before saving.';return;}const wasRunning=running;await pause();finishTrace();busy=true;updateMenu();
 try{const blob=await encodeSave(captureState(machine,sessionData()));if(exportFile){download(blob,'bomberman-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bmsave');$('save-status').textContent='Save exported. Keep this file to continue on another computer.';}else{await storeQuickSave(blob);quickSave=blob;$('save-status').textContent='Progress saved in this browser. Export a backup before clearing browser data.';}}
 catch(error){$('save-status').textContent=error.message;}finally{busy=false;updateMenu();if(wasRunning)await resume();}
}
async function loadProgress(blob){
 if(!rom||busy||!blob)return;await pause();finishTrace();busy=true;updateMenu();
 try{const save=await decodeSave(blob),s=validateSession(save);restoreState(machine,save);colors.setBattleColors(s.battleColors);colors.select(s.color);$('color-select').value=s.color;companions.restore(s.companions);battleAI.restore(s.battleAI);Object.assign(machine._campaignTracker,s.tracker);frame=s.frame;mode=s.mode;count=s.count;started=s.started;boot=structuredClone(s.boot);initialBots=s.initialBots;$('player-count-select').value=String(count);releaseKeys();$('frame-count').textContent=String(frame);$('menu-panel').hidden=true;$('start-btn').disabled=false;setModeLabels();$('save-status').textContent='Save loaded. Press Resume to continue.';message('Your game is restored and paused.');}
 catch(error){$('save-status').textContent=error.message+' Your previous game remains paused.';}finally{busy=false;updateMenu();}
}
$('save-btn').addEventListener('click',()=>saveProgress());$('export-save-btn').addEventListener('click',()=>saveProgress(true));$('load-mode').addEventListener('click',()=>loadProgress(quickSave));
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
 $('team-list').textContent=companions.state.bots.map(b=>`${b.color==='original'?'White':b.color} #${b.id}: ${b.action} · ${b.bombsPlaced} bombs`).join('\n')||'No AI teammates yet.';
 const grid=$('enemy-grid');grid.replaceChildren();const seen=new Set();
 for(const enemy of enemies(machine)){if(enemy.type>=23||seen.has(enemy.type))continue;seen.add(enemy.type);const button=document.createElement('button');button.textContent=enemy.type===2?'Ballom':`Monster type ${enemy.type}`;button.addEventListener('click',()=>adminSpawn(()=>spawnEnemy(machine,enemy.slot,selectedTile.x,selectedTile.y)));grid.append(button);}
 if(!seen.size)grid.textContent='No living monster templates in this stage.';
}
function adminSpawn(action){try{if(!selectedTile)throw new Error('Select an empty floor tile.');const result=action();$('admin-status').textContent=result?.color?`AI Bomberman added (${result.color==='original'?'white':result.color}). Resume to let it play.`:'Spawned. Resume to see the original engine update.';if(tileKind(machine,selectedTile.x,selectedTile.y)!==10)selectedTile=null;refreshAdmin();setModeLabels();}catch(error){$('admin-status').textContent=error.message;}}
for(const item of ITEM_CATALOG){const button=document.createElement('button');button.textContent=item.name;button.addEventListener('click',()=>adminSpawn(()=>spawnItem(machine,item.type,selectedTile.x,selectedTile.y)));$('item-grid').append(button);}
$('spawn-bot').addEventListener('click',()=>adminSpawn(()=>companions.add(selectedTile.x,selectedTile.y)));$('spawn-bomb').addEventListener('click',()=>adminSpawn(()=>spawnBomb(machine,selectedTile.x,selectedTile.y)));
async function openAdmin(){
 if(!machine||busy)return;if(!isCampaign(machine)||(machine.RAM[0x43a]&7)||machine.RAM[0x437]){message('The admin inventory opens during an active campaign stage.');return;}
 adminWasRunning=running;await pause();const person=playerPosition(machine);try{selectedTile=nearestFreeTile(machine,{x:Math.floor(person.x/16),y:Math.floor(person.y/16)});}catch{selectedTile=null;}$('admin-status').textContent='Game paused. Select an empty floor tile and choose what to spawn.';refreshAdmin();$('admin-dialog').showModal();
}
async function closeAdmin(){if(!$('admin-dialog').open)return;$('admin-dialog').close();if(adminWasRunning)await resume();}
$('admin-btn').addEventListener('click',openAdmin);$('admin-close').addEventListener('click',closeAdmin);$('admin-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAdmin();});
window.addEventListener('keydown',event=>{
 if(event.code==='F2'&&machine){event.preventDefault();if($('admin-dialog').open)closeAdmin();else openAdmin();return;}
 const binding=KEY_BINDINGS[event.code];if(!running||boot.length||!binding||document.activeElement!==canvas||binding[0]!==0)return;event.preventDefault();held.add(event.code);machine['SetButton'+binding[1]](binding[0]);
});
window.addEventListener('keyup',event=>{if(!held.delete(event.code))return;const [port,button]=KEY_BINDINGS[event.code];if(![...held].some(code=>KEY_BINDINGS[code][0]===port&&KEY_BINDINGS[code][1]===button))machine['UnsetButton'+button](port);});
canvas.addEventListener('blur',releaseKeys);window.addEventListener('blur',()=>{if(running)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
function step(){
 if(boot.length){releaseKeys();if(boot[0].button)machine['SetButton'+boot[0].button](0);}else{companions.update();battleAI.update();}
 colors.refresh();machine.Run();frame++;
 if(boot.length&&--boot[0].frames===0){boot.shift();releaseKeys();if(!boot.length){$('menu-panel').hidden=true;message('Game ready. Click the game screen to focus controls.');}}
 if(initialBots&&isCampaign(machine)&&!(machine.RAM[0x43a]&7)&&!machine.RAM[0x437]){
  const person=playerPosition(machine),blocked=new Set([`${Math.floor(person.x/16)},${Math.floor(person.y/16)}`]);for(let n=0;n<initialBots;n++){try{const tile=nearestFreeTile(machine,{x:Math.floor(person.x/16),y:Math.floor(person.y/16)},blocked);companions.add(tile.x,tile.y);blocked.add(`${tile.x},${tile.y}`);}catch(error){message(error.message);break;}}initialBots=0;setModeLabels();
 }
 if(pendingTrace&&frame>=pendingTrace.start+120)finishTrace();if(frame%60===0)setModeLabels();
}
function tick(now){if(running){accumulator+=Math.min(now-lastTime,FRAME_MS*3);try{let steps=0;while(accumulator>=FRAME_MS&&steps++<3){step();accumulator-=FRAME_MS;}$('frame-count').textContent=String(frame);}catch(error){pause();message('Emulation stopped: '+error.message);}}lastTime=now;requestAnimationFrame(tick);}
requestAnimationFrame(tick);
$('debug-toggle').addEventListener('click',()=>{const panel=$('debug-panel');panel.hidden=!panel.hidden;$('debug-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
$('dump-btn').addEventListener('click',()=>download(Uint8Array.from(machine.RAM.slice(0,8192)),'campaign-ram.bin'));
$('trace-btn').addEventListener('click',()=>{pendingTrace={hook:traceWrites(machine),start:frame};$('trace-btn').disabled=true;$('debug-output').textContent='Recording the next 120 emulated frames. Resume and move or place a bomb.';});
