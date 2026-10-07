import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// Mocked DOM integration checks placement behavior, not browser layout or audio.
test('admin selection is a persistent placement tool with toggle, deselect and safe errors',{skip:!process.env.BOMBERMAN_TEST_ROM},async()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),elements=new Map();
 const element=()=>({value:'',disabled:true,hidden:false,open:false,listeners:{},children:[],style:{},attributes:{},
  addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];this.textContent='';},
  focus(){document.activeElement=this;},click(){return this.listeners.click?.();},showModal(){this.open=true;},close(){this.open=false;},
  getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};}
 });
 for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,element());
 elements.get('game-canvas').width=684;elements.get('game-canvas').height=262;elements.get('color-select').value='original';elements.get('player-count-select').value='1';
 const originals=new Map();for(const key of ['document','window','requestAnimationFrame','indexedDB'])originals.set(key,globalThis[key]);
 let nextFrame,clock=performance.now();
 globalThis.document={getElementById:id=>elements.get(id),createElement:element,addEventListener(){},activeElement:null};
 globalThis.window={listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};globalThis.requestAnimationFrame=fn=>{nextFrame=fn;};globalThis.indexedDB=undefined;
 const {PCE}=await import('../dist/vendor/pce.js'),setCanvas=PCE.prototype.SetCanvas;let machine;
 PCE.prototype.SetCanvas=function(id){machine=this;return setCanvas.call(this,id);};
 try{
  await import('../dist/app.js');const bytes=fs.readFileSync(process.env.BOMBERMAN_TEST_ROM);
  await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});
  const tick=()=>{clock+=50;nextFrame(clock);},key=async code=>{window.listeners.keydown({code,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));};
  for(let n=0;n<110;n++)tick();assert.match(elements.get('menu-status').textContent,/1P - CAMPAIGN/);await key('Enter');assert.match(elements.get('menu-status').textContent,/1-0/);await key('Enter');await key('Space');window.listeners.keyup({code:'Space',preventDefault(){}});
  for(let n=0;n<400&&!/Game ready/.test(elements.get('load-status').textContent);n++)tick();assert.match(elements.get('load-status').textContent,/Game ready/);assert.equal(machine._newCampaign.enabled,false);
  await key('F2');assert.equal(elements.get('admin-dialog').open,true);assert.equal(elements.get('pause-btn').textContent,'Resume');
  const frameBefore=elements.get('frame-count').textContent;tick();assert.equal(elements.get('frame-count').textContent,frameBefore,'placement pauses emulation');
  const item=type=>elements.get('item-grid').children[type],flags=()=>[...machine.RAM.slice(0xf9b,0xfb4)],active=()=>flags().filter(v=>v&128).length;
  const coordinates=elements.get('admin-map').children.filter(tile=>!tile.disabled&&tile.className.includes('floor')&&!tile.textContent).slice(0,6).map(tile=>tile.title);
  assert.equal(coordinates.length,6,'the starting stage provides several empty placement tiles');
  const tile=index=>elements.get('admin-map').children.find(button=>button.title===coordinates[index]);
  const itemAt=index=>{const [,x,y]=coordinates[index].match(/Tile (\d+), (\d+)/);return flags().map((flag,slot)=>({flag,x:machine.RAM[0xfb4+slot],y:machine.RAM[0xfcd+slot]})).find(entry=>(entry.flag&128)&&entry.x===Number(x)&&entry.y===Number(y));};
  const untouched=[...machine.RAM],initial=active();await item(1).click();assert.deepEqual(machine.RAM,untouched,'choosing Bomb up selects the tool without spawning');assert.equal(item(1).attributes['aria-pressed'],'true');
  await tile(0).click();assert.equal(active(),initial+1);assert.equal(itemAt(0).flag&31,1);assert.equal(item(1).attributes['aria-pressed'],'true');
  await tile(1).click();assert.equal(active(),initial+2);assert.equal(itemAt(1).flag&31,1);assert.equal(item(1).attributes['aria-pressed'],'true','a placement keeps the chosen tool active');
  await item(1).click();assert.equal(item(1).attributes['aria-pressed'],'false');await tile(2).click();assert.equal(active(),initial+2);assert.equal(itemAt(2),undefined,'a tile click with no tool only selects the tile');
  await item(0).click();assert.equal(item(0).attributes['aria-pressed'],'true');await item(3).click();assert.equal(item(0).attributes['aria-pressed'],'false');assert.equal(item(3).attributes['aria-pressed'],'true');assert.equal(active(),initial+2,'switching tools does not spawn at the selected tile');
  await tile(2).click();assert.equal(itemAt(2).flag&31,3);assert.equal(active(),initial+3);
  const placed=flags();await tile(2).click();assert.deepEqual(flags(),placed,'an occupied tile cannot create a second pickup');assert.equal(item(3).attributes['aria-pressed'],'true','an occupied tile leaves the tool selected');
  await elements.get('spawn-deselect').click();assert.equal(item(3).attributes['aria-pressed'],'false');await tile(3).click();assert.deepEqual(flags(),placed,'the explicit Deselect button turns placement off');
  await item(1).click();const savedFlags=flags();for(let i=0;i<25;i++)machine.RAM[0xf9b+i]=128;await tile(4).click();assert.match(elements.get('admin-status').textContent,/item slots are full/i);assert.ok(flags().every(v=>v===128));assert.equal(item(1).attributes['aria-pressed'],'true','capacity errors preserve the selected tool');
  for(let i=0;i<25;i++)machine.RAM[0xf9b+i]=savedFlags[i];await tile(4).click();assert.equal(itemAt(4).flag&31,1,'the same tool works again after capacity is available');
  await elements.get('admin-close').click();assert.equal(elements.get('admin-dialog').open,false);assert.equal(elements.get('pause-btn').textContent,'Pause');assert.equal(item(1).attributes['aria-pressed'],'false','closing admin clears the placement tool');
  const resumed=Number(elements.get('frame-count').textContent);tick();assert.ok(Number(elements.get('frame-count').textContent)>resumed,'closing admin resumes the running game');
  await key('F2');assert.equal(elements.get('admin-dialog').open,true);assert.equal(item(1).attributes['aria-pressed'],'false');const reopened=flags();await tile(5).click();assert.deepEqual(flags(),reopened,'reopening the admin panel starts with no active tool');await elements.get('admin-close').click();
 }finally{PCE.prototype.SetCanvas=setCanvas;for(const [key,value]of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
