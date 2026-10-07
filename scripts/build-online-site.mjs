import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const manifest = JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.static != null || manifest.d1 !== 'DB') throw new Error('Online build requires a Worker manifest with d1: "DB" and no static declaration.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const assets = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (directory === dist && entry.name === 'server')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else {
      if (!entry.isFile() || !Object.hasOwn(mime, extname(entry.name))) throw new Error(`Unexpected deployable asset: ${relative(root, path)}`);
      const data = await readFile(path);
      assets[`/${relative(dist, path).split('\\').join('/')}`] = { type: mime[extname(entry.name)], data: data.toString('base64') };
    }
  }
}
await collect(dist);
if (!assets['/index.html']) throw new Error('Missing game index.html.');
const api = (await readFile(join(root, 'server/lobby.js'), 'utf8')).replace(/export (?=(?:function|const) )/g, '');
const worker = `${api}\nconst embeddedAssets = ${JSON.stringify(assets)};\nexport default {async fetch(request,env,ctx){\n  void ctx; const url=new URL(request.url);\n  if(url.pathname.startsWith('/api/'))return handleLobby(request,env);\n  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});\n  const asset=embeddedAssets[url.pathname==='/'?'/index.html':url.pathname];\n  if(!asset)return new Response('Not found',{status:404});\n  const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));\n  return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff'}});\n}};\n`;
await mkdir(join(dist, 'server'), { recursive: true });
await mkdir(join(dist, '.openai'), { recursive: true });
await writeFile(join(dist, 'server/index.js'), worker);
await writeFile(join(dist, '.openai/hosting.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(root, 'drizzle'), join(dist, '.openai/drizzle'), { recursive: true });
// Validate the actual generated single-module Worker, including embedded assets.
const module = await import(`${pathToFileURL(join(dist, 'server/index.js'))}?build=${Date.now()}`);
if (typeof module.default?.fetch !== 'function') throw new Error('Worker does not export default.fetch.');
const index = await module.default.fetch(new Request('https://build.test/'), {}, {});
if (!index.ok || !(await index.text()).includes('<!doctype html>')) throw new Error('Worker did not serve the game HTML.');
console.log(JSON.stringify({ assets: Object.keys(assets).length, workerBytes: Buffer.byteLength(worker), databaseBinding: manifest.d1 }));
