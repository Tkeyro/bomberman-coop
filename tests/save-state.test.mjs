import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {captureState,restoreState,encodeSave,decodeSave} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
test('full save restores deterministic execution without embedding ROM',{skip:!rom},async()=>{
 const p=createMachine(fs.readFileSync(rom));frames(p,180);frames(p,8,[[0,'RUN']]);frames(p,120);frames(p,8,[[0,'RUN']]);frames(p,2520);
 const save=captureState(p,{frame:2836,color:'blue',extensions:{bots:[]}});
 assert.equal(save.state.Mapper,undefined);assert.equal(save.state.WebAudioCtx,undefined);
 frames(p,60,[[0,'RIGHT']]);const expectedRAM=[...p.RAM],expectedPixels=Uint8ClampedArray.from(p.ImageData.data),expectedPC=p.PC;
 const blob=await encodeSave(save),decoded=await decodeSave(blob);console.log('Compressed save bytes:',blob.size);
 assert.deepEqual(restoreState(p,decoded),save.session);
 frames(p,60,[[0,'RIGHT']]);assert.deepEqual(p.RAM,expectedRAM);assert.deepEqual(p.ImageData.data,expectedPixels);assert.equal(p.PC,expectedPC);
 const word=decoded.state.Palette[0];decoded.state.Palette[0]=65536;assert.throws(()=>restoreState(p,decoded),/memory/);decoded.state.Palette[0]=word;
 const before=[...p.RAM];decoded.state.VDC[0].DrawLineWidth=0;assert.throws(()=>restoreState(p,decoded),/video/);assert.deepEqual(p.RAM,before);
 decoded.rom='wrong';assert.throws(()=>restoreState(p,decoded),/incompatible/);
});
test('damaged saves are rejected',async()=>{await assert.rejects(decodeSave(new Blob(['not JSON'])),/damaged/);});
