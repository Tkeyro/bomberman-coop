export const ROM_SHA256 = 'b9f98ce3d8b8baf1c6d02c2c0af72f8c0c554e533f13deb8f389853fe33bbf9e';
export async function verifyROM(bytes) {
  if (bytes.byteLength !== 262144) throw new Error('This build requires the 256 KiB Bomberman (USA) .pce file.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
  if (hex !== ROM_SHA256) throw new Error('This file does not match the verified Bomberman (USA) revision.');
  return hex;
}
export const COLORS = { original: [252,252,252], blue: [54,126,252], green: [72,216,108], red: [252,72,72], violet: [198,108,252] };
const SUIT_INDICES = [8,9,10,11,13,14,15];
// Verified campaign sprites use palette 12. Change the rendering cache only;
// ROM and numeric VCE palette RAM are never modified.
export function installColorSelector(pce) {
  let selected = 'original';
  const convert = pce.ToPalettes.bind(pce);
  const active = () => {
    const s = pce.VDC[0].SATB;
    return (s[3] & 15) === 12 && s[2] >= 640 && s[2] < 704;
  };
  pce.ToPalettes = () => {
    convert();
    const address = pce.VCEAddress;
    if (selected === 'original' || !active() || (address >> 4) !== 28 || !SUIT_INDICES.includes(address & 15)) return;
    const color = pce.Palette[address];
    const r = (color >> 3) & 7, g = (color >> 6) & 7, b = color & 7;
    if (r !== g || r !== b) return;
    const rgb = pce.PaletteData[address];
    [rgb.r,rgb.g,rgb.b] = COLORS[selected].map(component => Math.round(component * r / 7));
    const mono = rgb.r * .299 + rgb.g * .587 + rgb.b * .114;
    Object.assign(pce.MonoPaletteData[address], {r:mono,g:mono,b:mono});
  };
  function refresh() {
    const saved = pce.VCEAddress;
    for (const index of SUIT_INDICES) { pce.VCEAddress = 0x1c0 + index; pce.ToPalettes(); }
    pce.VCEAddress = saved;
  }
  return { select(color) {
    if (!Object.hasOwn(COLORS,color)) throw new Error('Unknown Bomberman color.');
    selected = color; refresh();
  }, refresh, get selected() { return selected; } };
}
export const KEY_BINDINGS = {
  ArrowUp:[0,'UP'], KeyW:[0,'UP'], ArrowDown:[0,'DOWN'], KeyS:[0,'DOWN'],
  ArrowLeft:[0,'LEFT'], KeyA:[0,'LEFT'], ArrowRight:[0,'RIGHT'], KeyD:[0,'RIGHT'],
  Space:[0,'SHOT1'], KeyX:[0,'SHOT2'], Enter:[0,'RUN'], ShiftLeft:[0,'SELECT'], ShiftRight:[0,'SELECT'],
  KeyI:[1,'UP'], KeyK:[1,'DOWN'], KeyJ:[1,'LEFT'], KeyL:[1,'RIGHT'],
  KeyO:[1,'SHOT1'], KeyP:[1,'SHOT2'], Digit2:[1,'RUN'], Digit1:[1,'SELECT']
};
export function traceWrites(pce, max = 20000) {
  const original = pce.Set, records = [];
  let dropped = 0;
  pce.Set = function(address,value) {
    const physical = this.MPR[address >> 13] | (address & 8191);
    if (physical >= 0x1f0000 && physical < 0x1f8000) {
      const offset = physical & 8191;
      if (offset >= 0x430 && offset < 0x480 && this.RAM[offset] !== value) {
        if (records.length < max) records.push({offset,before:this.RAM[offset],value,pc:this.PC,bank:this.MPR[this.PC >> 13] >> 13});
        else dropped++;
      }
    }
    return original.call(this,address,value);
  };
  return { finish() { pce.Set = original; return {records,dropped}; } };
}
