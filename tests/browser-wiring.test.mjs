import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Lightweight DOM wiring check, not a real browser or audio/fullscreen test.
test('loader, controls, focus release, pause and reset are wired to the emulator',{skip:!process.env.BOMBERMAN_TEST_ROM},async () => {
  const file = process.env.BOMBERMAN_TEST_ROM;
  const html = fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const elements = new Map();
  for (const [,id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id,{
    value:id==='color-select'?'original':'',disabled:true,hidden:true,listeners:{},
    addEventListener(event,callback){this.listeners[event]=callback;},setAttribute(){},
    focus(){document.activeElement=this;},
    getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};}
  });
  const original = new Map();
  for (const key of ['document','window','requestAnimationFrame']) original.set(key,globalThis[key]);
  let nextFrame;
  globalThis.document={getElementById:id=>elements.get(id),addEventListener(){},activeElement:null};
  globalThis.window={listeners:{},addEventListener(event,cb){this.listeners[event]=cb;}};
  globalThis.requestAnimationFrame=fn=>{nextFrame=fn;};
  try {
    await import('../dist/app.js');
    const bytes=fs.readFileSync(file);
    await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});
    assert.match(elements.get('load-status').textContent,/verified/);
    assert.equal(elements.get('color-select').disabled,false);
    elements.get('color-select').value='red';elements.get('color-select').listeners.change({target:{value:'red'}});
    await elements.get('start-btn').listeners.click();
    assert.equal(document.activeElement,elements.get('game-canvas'));
    assert.equal(elements.get('start-btn').disabled,true);
    nextFrame(performance.now()+40);
    assert.ok(Number(elements.get('frame-count').textContent)>0);
    let prevented=false;
    window.listeners.keydown({code:'ArrowRight',preventDefault(){prevented=true;}});assert.ok(prevented);
    elements.get('game-canvas').listeners.blur();
    await elements.get('pause-btn').listeners.click();assert.equal(elements.get('pause-btn').textContent,'Resume');
    await elements.get('reset-btn').listeners.click();assert.equal(elements.get('frame-count').textContent,'0');
    assert.equal(elements.get('start-btn').disabled,false);
  } finally {
    for(const [key,value] of original) { if(value===undefined) delete globalThis[key];else globalThis[key]=value; }
  }
});
