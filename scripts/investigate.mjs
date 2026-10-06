import fs from 'node:fs';
import { createMachine, frames, dump } from './headless.mjs';

const [rom, output] = process.argv.slice(2);
if (!rom || !output) throw new Error('Usage: node scripts/investigate.mjs ROM OUTPUT_DIRECTORY');
const pce = createMachine(fs.readFileSync(rom));
frames(pce, 180);
frames(pce, 8, [[0, 'RUN']]);
frames(pce, 120);
frames(pce, 8, [[0, 'RUN']]);
frames(pce, 2520);
dump(pce, output + '/idle');
const writes = [];
const original = pce.Set.bind(pce);
let tag = 'idle';
pce.Set = function (address, value) {
  const physical = this.MPR[address >> 13] | (address & 8191);
  if (physical >= 0x1f0000 && physical < 0x1f8000) {
    const ram = physical & this.RAMMask;
    if (ram >= 0x400 && ram < 0x600 && this.RAM[ram] !== value) {
      writes.push({ tag, ram, before: this.RAM[ram], value, pc: this.PC,
        bank: this.MPR[this.PC >> 13] >> 13, x: this.X, y: this.Y });
    }
  }
  return original(address, value);
};
tag = 'idle'; frames(pce, 10); dump(pce, output + '/idle2');
tag = 'right'; frames(pce, 20, [[0, 'RIGHT']]); dump(pce, output + '/right');
tag = 'down'; frames(pce, 20, [[0, 'DOWN']]); dump(pce, output + '/down');
tag = 'bomb'; frames(pce, 8, [[0, 'SHOT1']]); dump(pce, output + '/bomb');
frames(pce, 30);
fs.writeFileSync(output + '/writes.json', JSON.stringify(writes, null, 2));
const summary = new Map();
for (const w of writes) {
  const key = `${w.tag}:${w.ram.toString(16)}:${w.pc.toString(16)}:${w.bank.toString(16)}`;
  const s = summary.get(key) ?? { n: 0, samples: [] };
  s.n++;
  if (s.samples.length < 3) s.samples.push([w.before, w.value, w.x, w.y]);
  summary.set(key, s);
}
console.log(JSON.stringify(Object.fromEntries(summary), null, 2));
