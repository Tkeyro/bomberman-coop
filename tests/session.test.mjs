import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyROM, installColorSelector, traceWrites, ROM_SHA256, COLORS } from '../dist/session.js';
import { createMachine, frames } from '../scripts/headless.mjs';
import {captureState,restoreState} from '../dist/save-state.js';

test('rejects incompatible ROM size and revision', async () => {
  await assert.rejects(verifyROM(new Uint8Array(5)), /256 KiB/);
  await assert.rejects(verifyROM(new Uint8Array(262144)), /does not match/);
});
test('color conversion preserves palette RAM, address, unrelated colors and restore', () => {
  const p = createMachine(new Uint8Array(262144));
  p.VDC[0].SATB[2] = 640; p.VDC[0].SATB[3] = 12;
  p.Palette[0x1cf] = 0x1ff; p.Palette[0x1ce] = 0x1ff; p.Palette[0x1c7] = 312; p.Palette[0x132] = 0x1ff;
  p.VCEAddress = 0x132; p.ToPalettes();
  const other = {...p.PaletteData[0x132]}, palette = [...p.Palette];
  const selector = installColorSelector(p); selector.select('blue');
  assert.deepEqual(p.PaletteData[0x1cf], {r:0,g:108,b:252});assert.deepEqual(p.PaletteData[0x1ce], {r:252,g:144,b:0});
  assert.deepEqual(p.PaletteData[0x132], other);
  assert.deepEqual(p.Palette, palette); assert.equal(p.VCEAddress,0x132);
  selector.select('original'); assert.deepEqual(p.PaletteData[0x1ce], {r:252,g:252,b:252});
  assert.throws(() => selector.select('unknown'), /Unknown/);
});
test('trace records actual player-region writes and restores the setter', () => {
  const p = createMachine(new Uint8Array(262144)), setter = p.Set;
  p.MPR[1] = 0x1f0000;
  const trace = traceWrites(p,1);
  p.Set(0x243d,41); p.Set(0x243d,42); p.Set(0x2010,7);
  const result = trace.finish();
  assert.equal(result.records.length,1); assert.equal(result.records[0].offset,0x43d);
  assert.equal(result.dropped,1); assert.equal(p.Set,setter); assert.equal(p.RAM[0x43d],42);
});
test('red hands and feet use native green and fade while other ends and palette memory stay unchanged',()=>{
 const p=createMachine(new Uint8Array(262144));p.Palette[0x1c5]=61;p.Palette[0x1cf]=511;p.Palette[0x1c7]=312;p.VCEAddress=0x132;
 const selector=installColorSelector(p),palette=[...p.Palette];selector.select('red');assert.deepEqual(p.PaletteData[0x1c5],{r:0,g:180,b:36});assert.deepEqual(p.PaletteData[0x1ce],{r:252,g:144,b:0});assert.deepEqual(p.Palette,palette);assert.equal(p.VCEAddress,0x132);
 for(const color of ['black','blue','green','violet','orange','yellow','original']){selector.select(color);assert.deepEqual(p.PaletteData[0x1c5],{r:252,g:0,b:180});}
 p.Palette[0x1cf]=219;selector.select('red');assert.deepEqual(p.PaletteData[0x1c5],{r:0,g:77,b:15});p.Palette[0x1cf]=0;selector.refresh();assert.deepEqual(p.PaletteData[0x1c5],{r:0,g:0,b:0});
});
const file = process.env.BOMBERMAN_TEST_ROM;
test('lives icon follows every selected helmet color while its face, HUD text and game memory stay native',{skip:!file},()=>{
 const p=createMachine(fs.readFileSync(file)),selector=installColorSelector(p);
 frames(p,180);frames(p,8,[[0,'RUN']]);frames(p,120);frames(p,8,[[0,'RUN']]);frames(p,2520);
 const baseline=captureState(p),ram=[...p.RAM],vram=[...p.VDC[0].VRAM],palette=[...p.Palette];
 selector.select('original');frames(p,1);const original=Uint8ClampedArray.from(p.ImageData.data);
 // Decode the actual native glyphs: the remaining white helmet strips use
 // index 15, not index 2. The HUD frame and orange face use other entries.
 const used=new Map();for(const tile of [0x268,0x269,0x278,0x279,0x288,0x289])for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const a=tile*16+y,bit=7-x,lo=p.VDC[0].VRAM[a],hi=p.VDC[0].VRAM[a+8];
  const index=(lo>>bit&1)|((lo>>(bit+8)&1)<<1)|((hi>>bit&1)<<2)|((hi>>(bit+8)&1)<<3);used.set(index,(used.get(index)??0)+1);
 }
 assert.equal(used.get(15),12,'native helmet has twelve white highlight/side pixels');assert.equal(used.get(6),24);assert.equal(used.get(7),2);
 const helmetPixels=[];for(let y=18;y<42;y++)for(let x=168;x<184;x++){
  const offset=(y*684+x)*4;if(original[offset]===252&&original[offset+1]===252&&original[offset+2]===252)helmetPixels.push(offset);
 }
 assert.equal(helmetPixels.length,12,'all native white highlights must appear in the rendered lives icon');
 for(const color of ['black','blue','green','red','violet','orange','yellow','original']){
  restoreState(p,baseline);selector.select(color);assert.deepEqual(p.RAM,ram);assert.deepEqual(p.VDC[0].VRAM,vram);assert.deepEqual(p.Palette,palette);frames(p,1);
  let changed=0;for(let y=0;y<42;y++)for(let x=0;x<320;x++){const i=(y*684+x)*4;if([0,1,2].some(c=>p.ImageData.data[i+c]!==original[i+c])){assert.ok(x>=168&&x<184&&y>=18&&y<42,`HUD change outside head: ${x},${y}`);changed++;}}
  assert.ok(color==='original'?changed===0:changed>20);for(const index of [1,3,8,9]){const raw=p.Palette[0xb0+index];assert.deepEqual(p.PaletteData[576+index],{r:((raw>>3)&7)*36,g:((raw>>6)&7)*36,b:(raw&7)*36});}
  if(color!=='original'){
   for(const [index,shade] of [[6,6/7],[7,4/7],[15,1]])assert.deepEqual(p.PaletteData[576+index],Object.fromEntries(['r','g','b'].map((channel,i)=>[channel,Math.round(COLORS[color][i]*shade)])));
   for(const offset of helmetPixels)assert.deepEqual([...p.ImageData.data.slice(offset,offset+3)],COLORS[color],`all native white helmet highlights follow ${color}`);
  }
  if(color==='black')for(let y=23;y<36;y++)for(let x=171;x<182;x++){
   const offset=(y*684+x)*4;assert.notDeepEqual([...p.ImageData.data.slice(offset,offset+3)],[252,252,252],'black helmet retains no white highlights');
  }
 }
});
test('original campaign boots, second port is inactive, suit tint affects only player pixels', {skip:!file}, async () => {
  const bytes = fs.readFileSync(file); assert.equal(await verifyROM(bytes),ROM_SHA256);
  const a = createMachine(bytes), b = createMachine(bytes);
  for (const p of [a,b]) {
    frames(p,180); frames(p,8,[[0,'RUN']]); frames(p,120); frames(p,8,[[0,'RUN']]); frames(p,2520);
    assert.equal(p.RAM[0x43d],40); assert.equal(p.RAM[0x43f],24);
  }
  frames(a,20); frames(b,20,[[1,'RIGHT'],[1,'SHOT1']]);
  assert.deepEqual(a.ImageData.data,b.ImageData.data,'port 2 must not masquerade as campaign co-op');
  const color = installColorSelector(a), beforeRAM = [...a.RAM], beforePalette = [...a.Palette];
  const enemy = a.PaletteData.slice(0x130,0x140).map(v => ({...v}));
  color.select('blue');
  assert.deepEqual(a.RAM,beforeRAM); assert.deepEqual(a.Palette,beforePalette);
  assert.deepEqual(a.PaletteData.slice(0x130,0x140),enemy);
  frames(a,1); frames(b,1);
  let changed = 0;
  const bounds = [Infinity,Infinity,0,0];
  for (let i=0;i<a.ImageData.data.length;i+=4) {
    if ([0,1,2].some(c => a.ImageData.data[i+c] !== b.ImageData.data[i+c])) {
      const x = (i/4)%684,y = Math.floor(i/4/684);
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);changed++;
    }
  }
  assert.ok(changed > 20 && changed < 1000); assert.ok(bounds[2] < 184 && bounds[3] < 100);
  console.log(JSON.stringify({changedPixels:changed,bounds,playerPalette:12}));
  frames(b,20,[[0,'RIGHT']]); assert.ok(b.RAM[0x43d] > 40);
});
