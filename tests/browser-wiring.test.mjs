import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// Mocked DOM integration; does not verify a browser's audio, fullscreen or layout.
test('ROM loader, native keyboard menu, paused inventory and save import/export work together',{skip:!process.env.BOMBERMAN_TEST_ROM},async()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),elements=new Map();
 const element=()=>({value:'',disabled:true,hidden:false,open:false,listeners:{},children:[],style:{},attributes:{},
  addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];this.textContent='';},
  focus(){document.activeElement=this;},click(){return this.listeners.click?.();},showModal(){this.open=true;},close(){this.open=false;},
  getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};}
 });
 for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,element());
 elements.get('game-canvas').width=684;elements.get('game-canvas').height=262;elements.get('color-select').value='orange';elements.get('player-count-select').value='2';
 const originals=new Map();for(const key of ['document','window','requestAnimationFrame','indexedDB'])originals.set(key,globalThis[key]);
 let nextFrame,clock=performance.now();
 globalThis.document={getElementById:id=>elements.get(id),createElement:element,addEventListener(){},activeElement:null};
 globalThis.window={listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};globalThis.requestAnimationFrame=fn=>{nextFrame=fn;};
 // Storage intentionally unavailable: app must retain export/import fallback.
 globalThis.indexedDB=undefined;
 const {PCE}=await import('../dist/vendor/pce.js'),setCanvas=PCE.prototype.SetCanvas;let machine;
 PCE.prototype.SetCanvas=function(id){machine=this;return setCanvas.call(this,id);};
 try{
  await import('../dist/app.js');const bytes=fs.readFileSync(process.env.BOMBERMAN_TEST_ROM);
  await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});
  assert.match(elements.get('load-status').textContent,/verified/);assert.equal(elements.has('menu-panel'),false);assert.equal(elements.get('color-select').disabled,false);
  for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}
  const key=async code=>{window.listeners.keydown({code,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));};
  assert.match(elements.get('menu-status').textContent,/1P - CAMPAIGN/);
  await key('Enter');assert.match(elements.get('menu-status').textContent,/1-0/);await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/2-0/);await key('Escape');
  await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/1P - DLC/);assert.equal(elements.get('player-count-select').value,'1','DLC starts as a solo campaign');
  await key('ArrowDown');await key('Enter');assert.match(elements.get('menu-status').textContent,/AI/);await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/ONLINE/);await key('Escape');
  await key('ArrowDown');await key('Enter');assert.match(elements.get('menu-status').textContent,/AI/);await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/ONLINE/);await key('KeyB');
  await key('ArrowDown');await key('Enter');assert.match(elements.get('load-status').textContent,/No browser save/);
  await key('ArrowUp');await key('ArrowUp');await key('Enter');await key('Enter');assert.equal(document.activeElement,elements.get('game-canvas'));assert.equal(elements.get('start-btn').disabled,true);
  await key('Space');assert.match(elements.get('load-status').textContent,/Skipping/);
  for(let n=0;n<400&&!/Game ready/.test(elements.get('load-status').textContent);n++){clock+=50;nextFrame(clock);window.listeners.keydown({code:'Space',repeat:true,preventDefault(){}});}
  assert.match(elements.get('load-status').textContent,/Game ready/);assert.equal(machine.RAM.slice(0x84f,0x859).some(v=>v&128),false,'holding intro-skip Space must not place a human bomb');assert.ok(machine.Keybord[0][0]&1);
  window.listeners.keyup({code:'Space',preventDefault(){}});
  await key('KeyB');await key('KeyX');assert.equal(machine.Keybord[0][0]&2,0);
  window.listeners.keyup({code:'KeyB',preventDefault(){}});assert.equal(machine.Keybord[0][0]&2,0,'X keeps Button II held after B is released');
  window.listeners.keyup({code:'KeyX',preventDefault(){}});assert.equal(machine.Keybord[0][0]&2,2);
  assert.equal(elements.get('menu-status').textContent,'');assert.equal(elements.get('player-count').textContent,'2P');
  let prevented=false;window.listeners.keydown({code:'ArrowRight',preventDefault(){prevented=true;}});assert.equal(prevented,true);elements.get('game-canvas').listeners.blur();
  await elements.get('admin-btn').click();assert.equal(elements.get('admin-dialog').open,true);assert.equal(elements.get('pause-btn').textContent,'Resume');assert.equal(elements.get('item-grid').children.length,15);assert.equal(elements.get('enemy-grid').children.length,45);assert.ok(elements.get('enemy-grid').children.slice(0,23).every(card=>!card.disabled),'every ordinary species can spawn in this stage');assert.ok(elements.get('enemy-grid').children.slice(23).every(card=>card.disabled),'boss encounter models remain previews');assert.ok(elements.get('admin-map').children.length>100);
  for(const card of elements.get('enemy-grid').children)assert.ok(card.children[0].children.length,'every enemy card includes a native icon');
  const before=elements.get('frame-count').textContent;clock+=50;nextFrame(clock);assert.equal(elements.get('frame-count').textContent,before,'inventory must pause emulation');
  // Remove every native actor and set the native cleared flag before selecting
  // a species that does not live in world1. The selected brush remains active.
  machine.RAM.fill(0,0xd98,0xdb8);machine.RAM[0xd96]=1;
  await elements.get('enemy-grid').children[4].click();assert.ok(elements.get('enemy-grid').children.slice(0,23).every(card=>!card.disabled));
  const emptyEnemyTiles=elements.get('admin-map').children.filter(tile=>!tile.disabled&&tile.textContent!=='P'&&tile.textContent!=='AI');
  const nativeHuman={x:((machine.RAM[0x43e]<<8)|machine.RAM[0x43d])>>4,y:((machine.RAM[0x440]<<8)|machine.RAM[0x43f])>>4};
  emptyEnemyTiles.sort((a,b)=>{const distance=tile=>{const [,x,y]=/Tile (\d+), (\d+)/.exec(tile.title);return Math.abs(Number(x)-nativeHuman.x)+Math.abs(Number(y)-nativeHuman.y);};return distance(b)-distance(a);});
  assert.ok(emptyEnemyTiles.length>=2);const enemyTiles=emptyEnemyTiles.slice(0,2).map(tile=>tile.title);
  await elements.get('admin-map').children.find(tile=>tile.title===enemyTiles[0]).click();await elements.get('admin-map').children.find(tile=>tile.title===enemyTiles[1]).click();
  assert.deepEqual(machine._enemySpawns.state.actors,[{slot:0,type:4},{slot:1,type:4}]);assert.equal(machine.RAM[0xeb8],4);assert.equal(machine.RAM[0xeb9],4);assert.equal(machine.RAM[0xd96],0,'spawning restores the native active-stage flag');assert.equal(elements.get('enemy-grid').children[4].attributes['aria-pressed'],'true','the monster brush places multiple copies');
  await elements.get('enemy-grid').children[4].click();assert.equal(elements.get('spawn-deselect').disabled,true,'clicking the selected monster deselects it');
  await elements.get('item-grid').children[3].click();const humanTile=`Tile ${((machine.RAM[0x43e]<<8)|machine.RAM[0x43d])>>4}, ${((machine.RAM[0x440]<<8)|machine.RAM[0x43f])>>4}`;await elements.get('admin-map').children.find(tile=>tile.title===humanTile).click();await elements.get('admin-close').click();assert.equal(elements.get('pause-btn').textContent,'Pause');
  clock+=50;nextFrame(clock);assert.equal(elements.get('powerup-panel').hidden,false);assert.ok(elements.get('powerup-inventory').children.some(badge=>badge.children[1].textContent==='Roller shoes ×1'),'the native human pickup appears as an icon and count');
  await elements.get('save-btn').click();assert.match(elements.get('save-status').textContent,/Export/);assert.equal(elements.get('pause-btn').textContent,'Pause');
  const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let exported;
  URL.createObjectURL=blob=>{exported=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
  try{await elements.get('export-save-btn').click();assert.ok(exported instanceof Blob);assert.match(elements.get('save-status').textContent,/exported/);
   const {decodeSave:readSaved}=await import('../dist/save-state.js');const complete=await readSaved(exported);assert.equal(complete.session.powerupHUD.counts[3],1);assert.equal(complete.session.levelObjective.enabled,true);assert.deepEqual(complete.session.enemySpawns.actors,[{slot:0,type:4},{slot:1,type:4}]);
   await elements.get('reset-btn').click();assert.equal(elements.get('frame-count').textContent,'0');
   await elements.get('save-input').listeners.change({target:{files:[exported],value:'x'}});assert.match(elements.get('save-status').textContent,/Save loaded/);assert.equal(elements.get('pause-btn').textContent,'Resume');assert.equal(elements.get('color-select').value,'orange');assert.equal(elements.get('player-count').textContent,'2P');assert.deepEqual(machine._enemySpawns.state,complete.session.enemySpawns,'save import restores the custom sprite registrations');
   const restored=elements.get('frame-count').textContent;
   await elements.get('save-input').listeners.change({target:{files:[new Blob(['broken'])],value:'x'}});assert.match(elements.get('save-status').textContent,/damaged/);assert.equal(elements.get('frame-count').textContent,restored);
   const {decodeSave,encodeSave}=await import('../dist/save-state.js'),legacy=await decodeSave(exported);delete legacy.session.openingIntro;delete legacy.session.levelObjective;delete legacy.session.powerupHUD;delete legacy.session.enemySpawns;
   await elements.get('save-input').listeners.change({target:{files:[await encodeSave(legacy)],value:'x'}});assert.match(elements.get('save-status').textContent,/Save loaded/);assert.equal(machine._enemySpawns.state.actors.length,0,'older saves reset optional spawned-enemy state');
   await elements.get('pause-btn').click();await key('Space');assert.equal(machine.Keybord[0][0]&1,0,'an older gameplay save must retain Space bomb placement');window.listeners.keyup({code:'Space',preventDefault(){}});await elements.get('pause-btn').click();
  }finally{URL.createObjectURL=oldCreate;setTimeout(()=>{URL.revokeObjectURL=oldRevoke;},1100);}
  const savedFrame=elements.get('frame-count').textContent;
  await elements.get('open-menu-btn').click();assert.match(elements.get('menu-status').textContent,/Opening/);assert.equal(elements.get('pause-btn').textContent,'Continue game');
  for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}
  assert.match(elements.get('menu-status').textContent,/1P - CAMPAIGN/);await key('ArrowDown');await key('ArrowRight');assert.equal(elements.get('player-count-select').value,'2');
  await elements.get('pause-btn').click();assert.equal(elements.get('frame-count').textContent,savedFrame);assert.equal(elements.get('player-count').textContent,'2P');assert.equal(elements.get('pause-btn').textContent,'Pause');assert.equal(elements.get('menu-status').textContent,'');
  let stored;
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={objectStore:()=>({put(blob){stored=blob;queueMicrotask(()=>tx.oncomplete());}})};return tx;}};request.onsuccess();});return request;}};
  await elements.get('save-btn').click();assert.ok(stored instanceof Blob);assert.match(elements.get('save-status').textContent,/Progress saved/);
  const quickFrame=elements.get('frame-count').textContent;
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}
  await key('ArrowUp');assert.match(elements.get('menu-status').textContent,/LOAD SAVE/);await key('Enter');
  for(let n=0;n<200&&!elements.get('save-status').textContent.startsWith('Save loaded');n++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(elements.get('save-status').textContent,/Save loaded/);assert.equal(elements.get('frame-count').textContent,quickFrame);assert.equal(elements.get('pause-btn').textContent,'Resume');
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');await key('ArrowLeft');assert.equal(elements.get('player-count-select').value,'1');await key('Enter');
  for(let n=0;n<970&&!/DLC.*STAGE 1/.test(elements.get('mode-label').textContent);n++){clock+=50;nextFrame(clock);}assert.match(elements.get('mode-label').textContent,/DLC.*STAGE 1/);assert.equal(elements.get('player-count').textContent,'1P');await elements.get('admin-btn').click();assert.ok(elements.get('admin-map').children.length>400);await elements.get('admin-close').click();
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');for(let n=0;n<4;n++)await key('ArrowRight');await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!=='5P';n++){clock+=50;nextFrame(clock);}assert.equal(elements.get('player-count-select').value,'5');assert.equal(elements.get('player-count').textContent,'5P','all four teammates spawn despite the guaranteed starting pickup');
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');elements.get('player-count-select').value='-4';elements.get('player-count-select').listeners.change({target:elements.get('player-count-select')});assert.match(elements.get('menu-status').textContent,/AI only/);await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!=='4 AI';n++){clock+=50;nextFrame(clock);}assert.match(elements.get('mode-label').textContent,/WATCH/);assert.equal(elements.get('player-count').textContent,'4 AI');assert.match(elements.get('game-canvas').attributes['aria-label'],/spectator/);await key('ArrowRight');await key('Space');for(let n=0;n<60;n++){clock+=50;nextFrame(clock);}
  URL.createObjectURL=blob=>{exported=blob;return 'blob:watch';};URL.revokeObjectURL=()=>{};
  try{await elements.get('export-save-btn').click();const {decodeSave}=await import('../dist/save-state.js');const watchSave=await decodeSave(exported);assert.equal(watchSave.session.count,-4);assert.equal(watchSave.session.spectator.enabled,true);assert.equal(watchSave.session.newCampaign.players,4);assert.equal(watchSave.state.RAM[0x43d],0);await elements.get('save-input').listeners.change({target:{files:[exported],value:'x'}});assert.match(elements.get('save-status').textContent,/Save loaded/);assert.match(elements.get('mode-label').textContent,/WATCH/);assert.equal(elements.get('player-count-select').value,'-4');}finally{URL.createObjectURL=oldCreate;setTimeout(()=>{URL.revokeObjectURL=oldRevoke;},1100);}
  // A save restored during the final death sequence must retry the same NEW
  // round after the animation, recreating the selected crew without pausing.
  const {decodeSave,encodeSave}=await import('../dist/save-state.js'),defeat=await decodeSave(exported);
  for(const b of defeat.session.companions.bots){b.alive=false;b.deathFrame=0;b.extraLives=0;b.target=null;b.route=[];}defeat.session.spectator.finished=false;
  await elements.get('save-input').listeners.change({target:{files:[await encodeSave(defeat)],value:'x'}});await elements.get('pause-btn').click();
  clock+=50;nextFrame(clock);assert.equal(machine._newCampaign.transition.phase,'dying');assert.match(elements.get('load-status').textContent,/Retrying NEW stage 1 with 4 bots/);assert.equal(elements.get('pause-btn').textContent,'Pause');
  for(let n=0;n<240&&machine._newCampaign.transition;n++){clock+=50;nextFrame(clock);}assert.equal(machine._newCampaign.transition,null);assert.equal(elements.get('player-count').textContent,'4 AI');assert.match(elements.get('mode-label').textContent,/DLC.*STAGE 1/);assert.equal(elements.get('player-count-select').value,'-4');
  async function defeatAndRetry(bots,generated){
   await elements.get('save-btn').click();const save=await decodeSave(stored),stage=save.state.RAM.slice(0x84a,0x84c),round=save.session.newCampaign.round;
   for(const b of save.session.companions.bots){b.alive=false;b.deathFrame=0;b.extraLives=0;b.target=null;b.route=[];}save.session.spectator.finished=false;
   await elements.get('save-input').listeners.change({target:{files:[await encodeSave(save)],value:'x'}});await elements.get('pause-btn').click();clock+=50;nextFrame(clock);
   const lifecycle=generated?machine._newCampaign:machine._spectator;assert.equal(lifecycle.transition.phase,'dying');assert.equal(elements.get('pause-btn').textContent,'Pause');
   for(let n=0;n<260&&lifecycle.transition;n++){clock+=50;nextFrame(clock);}assert.equal(lifecycle.transition,null);assert.equal(elements.get('pause-btn').textContent,'Pause','watching must keep running after defeat');assert.equal(elements.get('player-count').textContent,`${bots} AI`);assert.equal(elements.get('player-count-select').value,String(-bots));assert.deepEqual(machine.RAM.slice(0x84a,0x84c),stage);if(generated)assert.equal(machine._newCampaign.round,round);
   const before=Number(elements.get('frame-count').textContent);clock+=50;nextFrame(clock);assert.ok(Number(elements.get('frame-count').textContent)>before,'the restarted round continues to tick');
  }
  for(const bots of [1,2,3]){await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');elements.get('player-count-select').value=String(-bots);elements.get('player-count-select').listeners.change({target:elements.get('player-count-select')});await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!==`${bots} AI`;n++){clock+=50;nextFrame(clock);}assert.equal(elements.get('player-count').textContent,`${bots} AI`);assert.equal(elements.get('player-count-select').value,String(-bots));if(bots===1)await defeatAndRetry(1,true);}
  // Original campaign spectator rounds keep running after the whole AI crew dies.
  for(const [choice,bots]of [[2,1],[2,4]]){
   await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}for(let n=0;n<choice;n++)await key('ArrowDown');elements.get('player-count-select').value=String(-bots);elements.get('player-count-select').listeners.change({target:elements.get('player-count-select')});await key('Enter');await key('Enter');await key('Space');window.listeners.keyup({code:'Space',preventDefault(){}});
   for(let n=0;n<970&&elements.get('player-count').textContent!==`${bots} AI`;n++){clock+=50;nextFrame(clock);}assert.equal(elements.get('player-count').textContent,`${bots} AI`);assert.equal(machine._newCampaign.enabled,false);await defeatAndRetry(bots,false);
  }
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('Enter');await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/2-0/);await key('Enter');await key('Space');window.listeners.keyup({code:'Space',preventDefault(){}});
  const {isCampaign}=await import('../dist/campaign.js');for(let n=0;n<970&&(!isCampaign(machine)||machine.RAM[0x84a]!==1||machine.RAM[0x84b]!==0);n++){clock+=50;nextFrame(clock);}
  assert.equal(isCampaign(machine),true);assert.deepEqual([...machine.RAM.slice(0x84a,0x84c)],[1,0],'the selected 2-0 entry loads world2 at its first regular stage');assert.equal(elements.get('player-count').textContent,'1P');assert.equal(machine._newCampaign.enabled,false);
 }finally{PCE.prototype.SetCanvas=setCanvas;for(const [key,value]of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
