import http from 'node:http';
import {createRuntime} from './runtime.mjs';
const runtime=createRuntime();
http.createServer(async(req,res)=>{
 const requestController=new AbortController();
 res.once('close',()=>{if(!res.writableFinished)requestController.abort();});
 res.setHeader('Cache-Control','no-store');
 try{
  const host=req.headers.host||'';
  if(!/^[a-z0-9-]+\.trycloudflare\.com$/.test(host)&&host!=='127.0.0.1:4318'){res.writeHead(400);res.end('Invalid host');return;}
  const publicTunnel=host!=='127.0.0.1:4318';const base=(publicTunnel?'https://':'http://')+host;
  if(req.url?.startsWith('/admin')){res.writeHead(404);res.end();return;}
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1800000){res.writeHead(413);res.end('Image too large');return;}chunks.push(c);}
  const headers={...req.headers};delete headers.authorization;
  const request=new Request(base+req.url,{method:req.method,signal:requestController.signal,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  // Loopback-only origin. Cloudflare supplies the public visitor IP; local requests use the socket.
  const ip=publicTunnel?(req.headers['cf-connecting-ip']||'unknown-tunnel'):req.socket.remoteAddress||'local';
  const response=await runtime.fetch(request,ip);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'额度服务暂时不可用，请稍后重试。'}));}
}).listen(4318,'127.0.0.1',()=>console.log('Anonymous trial tunnel ready: http://127.0.0.1:4318'));
