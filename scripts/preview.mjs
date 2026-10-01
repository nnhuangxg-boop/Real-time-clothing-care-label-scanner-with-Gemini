import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createRuntime} from './runtime.mjs';
const runtime=createRuntime();
http.createServer(async(req,res)=>{
 const requestController=new AbortController();
 res.once('close',()=>{if(!res.writableFinished)requestController.abort();});
 try{
  if(!['127.0.0.1:4317','localhost:4317'].includes(req.headers.host)){res.writeHead(403);res.end();return;}
  if(req.method==='GET'&&['/admin','/admin/usage','/admin.js'].includes(req.url)){
   const json=req.url==='/admin/usage';const js=req.url==='/admin.js';
   res.writeHead(200,{'Cache-Control':'no-store','Content-Type':json?'application/json':js?'text/javascript; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"});
   res.end(json?JSON.stringify(runtime.store.summary()):readFileSync(js?'scripts/admin.js':'scripts/admin.html'));return;
  }
  const body=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1800000){res.writeHead(413);res.end();return;}body.push(chunk);}
  const request=new Request(`http://127.0.0.1:4317${req.url}`,{method:req.method,signal:requestController.signal,headers:req.headers,...(body.length?{body:Buffer.concat(body)}:{})});
  const response=await runtime.fetch(request,req.socket.remoteAddress||'local');
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'额度服务暂时不可用，请稍后重试。'}));}
}).listen(4317,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4317 · Statistics: http://127.0.0.1:4317/admin'));
