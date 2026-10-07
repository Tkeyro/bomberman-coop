import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// Mocked DOM integration; does not verify a browser's audio, fullscreen or layout.
test('ROM loader, native keyboard menu, paused inventory and save import/export work together',{skip:!process.env.BOMBERMAN_TEST_ROM},async()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),elements=new Map();
 const element=()=>({value:'',disabled:true,hidden:false,open:false,listeners:{},children:[],style:{},attributes:{},
  addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},append(child){this.children.push(child);},replaceChildren(){this.children=[];},
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
 try{
  await import('../dist/app.js');const bytes=fs.readFileSync(process.env.BOMBERMAN_TEST_ROM);
  await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});
  assert.match(elements.get('load-status').textContent,/verified/);assert.equal(elements.has('menu-panel'),false);assert.equal(elements.get('color-select').disabled,false);
  for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}
  const key=async code=>{window.listeners.keydown({code,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));};
  assert.match(elements.get('menu-status').textContent,/1P - SOLO/);
  await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/1-5P - NEW/);await key('ArrowDown');assert.match(elements.get('menu-status').textContent,/CAMPAIGN/);
  await key('ArrowDown');await key('Enter');assert.match(elements.get('load-status').textContent,/not connected/);assert.equal(elements.get('mode-label').textContent,'SOLO');
  await key('ArrowDown');await key('ArrowDown');await key('Enter');assert.match(elements.get('load-status').textContent,/No browser save/);
  await key('ArrowDown');await key('ArrowDown');await key('ArrowDown');await key('Enter');assert.equal(document.activeElement,elements.get('game-canvas'));assert.equal(elements.get('start-btn').disabled,true);
  for(let n=0;n<970;n++){clock+=50;nextFrame(clock);} // original intro + first active stage
  assert.equal(elements.get('menu-status').textContent,'');assert.equal(elements.get('player-count').textContent,'2P');
  let prevented=false;window.listeners.keydown({code:'ArrowRight',preventDefault(){prevented=true;}});assert.equal(prevented,true);elements.get('game-canvas').listeners.blur();
  await elements.get('admin-btn').click();assert.equal(elements.get('admin-dialog').open,true);assert.equal(elements.get('pause-btn').textContent,'Resume');assert.equal(elements.get('item-grid').children.length,15);assert.ok(elements.get('enemy-grid').children.length>0);assert.ok(elements.get('admin-map').children.length>100);
  const before=elements.get('frame-count').textContent;clock+=50;nextFrame(clock);assert.equal(elements.get('frame-count').textContent,before,'inventory must pause emulation');
  await elements.get('admin-close').click();assert.equal(elements.get('pause-btn').textContent,'Pause');
  await elements.get('save-btn').click();assert.match(elements.get('save-status').textContent,/Export/);assert.equal(elements.get('pause-btn').textContent,'Pause');
  const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let exported;
  URL.createObjectURL=blob=>{exported=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
  try{await elements.get('export-save-btn').click();assert.ok(exported instanceof Blob);assert.match(elements.get('save-status').textContent,/exported/);
   await elements.get('reset-btn').click();assert.equal(elements.get('frame-count').textContent,'0');
   await elements.get('save-input').listeners.change({target:{files:[exported],value:'x'}});assert.match(elements.get('save-status').textContent,/Save loaded/);assert.equal(elements.get('pause-btn').textContent,'Resume');assert.equal(elements.get('color-select').value,'orange');assert.equal(elements.get('player-count').textContent,'2P');
   const restored=elements.get('frame-count').textContent;
   await elements.get('save-input').listeners.change({target:{files:[new Blob(['broken'])],value:'x'}});assert.match(elements.get('save-status').textContent,/damaged/);assert.equal(elements.get('frame-count').textContent,restored);
  }finally{URL.createObjectURL=oldCreate;setTimeout(()=>{URL.revokeObjectURL=oldRevoke;},1100);}
  const savedFrame=elements.get('frame-count').textContent;
  await elements.get('open-menu-btn').click();assert.match(elements.get('menu-status').textContent,/Opening/);assert.equal(elements.get('pause-btn').textContent,'Continue game');
  for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}
  assert.match(elements.get('menu-status').textContent,/1P - SOLO/);await key('ArrowRight');assert.equal(elements.get('player-count-select').value,'3');
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
  for(let n=0;n<970&&!/NEW.*STAGE 1/.test(elements.get('mode-label').textContent);n++){clock+=50;nextFrame(clock);}assert.match(elements.get('mode-label').textContent,/NEW.*STAGE 1/);assert.equal(elements.get('player-count').textContent,'1P');await elements.get('admin-btn').click();assert.ok(elements.get('admin-map').children.length>400);await elements.get('admin-close').click();
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');await key('ArrowRight');await key('ArrowRight');await key('ArrowRight');await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!=='5P';n++){clock+=50;nextFrame(clock);}assert.equal(elements.get('player-count-select').value,'5');assert.equal(elements.get('player-count').textContent,'5P','all four teammates spawn despite the guaranteed starting pickup');
  await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');elements.get('player-count-select').value='-4';elements.get('player-count-select').listeners.change({target:elements.get('player-count-select')});assert.match(elements.get('menu-status').textContent,/AI only/);await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!=='4 AI';n++){clock+=50;nextFrame(clock);}assert.match(elements.get('mode-label').textContent,/WATCH/);assert.equal(elements.get('player-count').textContent,'4 AI');assert.match(elements.get('game-canvas').attributes['aria-label'],/spectator/);await key('ArrowRight');await key('Space');for(let n=0;n<60;n++){clock+=50;nextFrame(clock);}
  URL.createObjectURL=blob=>{exported=blob;return 'blob:watch';};URL.revokeObjectURL=()=>{};
  try{await elements.get('export-save-btn').click();const {decodeSave}=await import('../dist/save-state.js');const watchSave=await decodeSave(exported);assert.equal(watchSave.session.count,-4);assert.equal(watchSave.session.spectator.enabled,true);assert.equal(watchSave.session.newCampaign.players,4);assert.equal(watchSave.state.RAM[0x43d],0);await elements.get('save-input').listeners.change({target:{files:[exported],value:'x'}});assert.match(elements.get('save-status').textContent,/Save loaded/);assert.match(elements.get('mode-label').textContent,/WATCH/);assert.equal(elements.get('player-count-select').value,'-4');}finally{URL.createObjectURL=oldCreate;setTimeout(()=>{URL.revokeObjectURL=oldRevoke;},1100);}
  // A save restored during the final death sequence must retry the same NEW
  // round after the animation, recreating the selected crew without pausing.
  const {decodeSave,encodeSave}=await import('../dist/save-state.js'),defeat=await decodeSave(exported);
  for(const b of defeat.session.companions.bots){b.alive=false;b.deathFrame=0;b.extraLives=0;b.target=null;b.route=[];}defeat.session.spectator.finished=false;
  await elements.get('save-input').listeners.change({target:{files:[await encodeSave(defeat)],value:'x'}});await elements.get('pause-btn').click();
  for(let n=0;n<40;n++){clock+=50;nextFrame(clock);}assert.match(elements.get('load-status').textContent,/Retrying NEW stage 1 with 4 bots/);assert.equal(elements.get('pause-btn').textContent,'Pause');assert.equal(elements.get('player-count').textContent,'4 AI');assert.match(elements.get('mode-label').textContent,/NEW.*STAGE 1/);assert.equal(elements.get('player-count-select').value,'-4');
  for(const bots of [1,2,3]){await elements.get('open-menu-btn').click();for(let n=0;n<110;n++){clock+=50;nextFrame(clock);}await key('ArrowDown');elements.get('player-count-select').value=String(-bots);elements.get('player-count-select').listeners.change({target:elements.get('player-count-select')});await key('Enter');for(let n=0;n<970&&elements.get('player-count').textContent!==`${bots} AI`;n++){clock+=50;nextFrame(clock);}assert.equal(elements.get('player-count').textContent,`${bots} AI`);assert.equal(elements.get('player-count-select').value,String(-bots));}
 }finally{for(const [key,value]of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
