// Isolated local preview of the deployed client and the real shared service.
import http from 'node:http';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import {createService} from './service.mjs';
import {openDatabase} from './sqlite.mjs';
globalThis.crypto ||= webcrypto;
await import('../public/room-engine.js');
const port = Number(process.argv[2] || 5196);
const duration = Number(process.argv[3] || 300);
const db = await openDatabase(process.argv[4] || ':memory:');
const origin = 'http://127.0.0.1:' + port;
const app = createService(JSON.parse(readFileSync(new URL('../public/history.json',import.meta.url))),{duration});
const root = resolve(new URL('../dist/',import.meta.url).pathname);
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,origin);
    if (url.pathname.startsWith('/api/')) {
      const buffers=[]; for await (const b of req) buffers.push(b);
      const response = await app.fetch(new Request(url,{method:req.method,headers:req.headers,
        body:['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(buffers)}),{DB:db});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = resolve(root,'.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root+'/')) {res.writeHead(403);res.end();return;}
    let data = readFileSync(file);
    if (file.endsWith('/shared-room.js')) data = Buffer.from(data.toString().replace(
      'https://bitcoin-replay-shared-room.grassylens.chatgpt.site',origin));
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  } catch(error) {res.writeHead(500);res.end(error.message);}
});
server.listen(port,'127.0.0.1',()=>console.log('Shared classroom preview: '+origin));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{db.close();server.close(()=>process.exit(0));});
