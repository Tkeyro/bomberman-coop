import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// Mocked DOM integration; does not verify a browser's audio, fullscreen or layout.
test('ROM loader, custom menu, paused inventory and save import/export work together',{skip:!process.env.BOMBERMAN_TEST_ROM},async()=>{
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
  assert.match(elements.get('load-status').textContent,/verified/);assert.equal(elements.get('solo-mode').disabled,false);assert.equal(elements.get('online-mode').disabled,true);assert.equal(elements.get('color-select').disabled,false);
  await elements.get('campaign-mode').click();assert.equal(document.activeElement,elements.get('game-canvas'));assert.equal(elements.get('start-btn').disabled,true);
  for(let n=0;n<970;n++){clock+=50;nextFrame(clock);} // original intro + first active stage
  assert.equal(elements.get('menu-panel').hidden,true);assert.equal(elements.get('player-count').textContent,'2P');
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
  await elements.get('open-menu-btn').click();assert.equal(elements.get('menu-panel').hidden,false);assert.equal(elements.get('pause-btn').textContent,'Resume');
 }finally{for(const [key,value]of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
