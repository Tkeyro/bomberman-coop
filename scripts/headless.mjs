import fs from 'node:fs';
import { PCE } from '../dist/vendor/pce.js';

export function createMachine(bytes) {
  const pce = new PCE();
  pce.CountryType = pce.CountryTypeTG16;
  pce.MultiTap = true;
  pce.MainCanvas = { width: 684, height: 262 };
  pce.Ctx = { putImageData() {} };
  pce.ImageData = { data: new Uint8ClampedArray(684 * 262 * 4) };
  for (let i = 3; i < pce.ImageData.data.length; i += 4) pce.ImageData.data[i] = 255;
  pce.SetROM(Array.from(bytes));
  return pce;
}

export function frames(pce, count, actions = []) {
  for (const [port, button] of actions) pce['SetButton' + button](port);
  for (let i = 0; i < count; i++) pce.Run();
  for (const [port, button] of actions) pce['UnsetButton' + button](port);
}

export function dump(pce, path) {
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(path + '/rgba.bin', pce.ImageData.data);
  fs.writeFileSync(path + '/ram.bin', Uint8Array.from(pce.RAM.slice(0, 8192)));
  fs.writeFileSync(path + '/state.json', JSON.stringify({
    PC: pce.PC, MPR: pce.MPR, SATB: pce.VDC[0].SATB,
    Palette: pce.Palette, ScreenWidth: pce.VDC[0].ScreenWidth,
    ScreenSize: pce.VDC[0].ScreenSize,
    VDCRegister: pce.VDC[0].VDCRegister
  }, null, 2));
}

if (process.argv[1]?.endsWith('/headless.mjs')) {
  const [rom, output] = process.argv.slice(2);
  if (!rom || !output) throw new Error('Usage: node scripts/headless.mjs ROM OUTPUT_DIRECTORY');
  const pce = createMachine(fs.readFileSync(rom));
  frames(pce, 180);
  dump(pce, output + '/title');
  frames(pce, 8, [[0, 'RUN']]);
  frames(pce, 100);
  dump(pce, output + '/menu');
  frames(pce, 8, [[0, 'RUN']]);
  frames(pce, 180);
  dump(pce, output + '/stage');
  frames(pce, 20, [[0, 'RIGHT']]);
  dump(pce, output + '/right');
  console.log(JSON.stringify({ output, finalPC: pce.PC, elapsedFrames: 482 }));
}
