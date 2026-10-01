import {readFileSync,existsSync} from 'node:fs';
import {createUsageStore} from './usage-store.mjs';
import worker from '../dist/server/index.js';

export function createRuntime(){
 const env={};if(existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 const store=createUsageStore('.data/usage.sqlite');
 return {store,async fetch(request,ip){
  const url=new URL(request.url);
  if(!['/api/status','/api/scan'].includes(url.pathname))return worker.fetch(request,env);
  const identity=store.identity(request.headers.get('cookie'),ip,url.protocol==='https:');
  const usage={status:()=>store.usage(identity),reserve:(...args)=>store.reserve(identity,...args),finish:(...args)=>store.finish(...args)};
  const response=await worker.fetch(request,{...env,USAGE:usage});
  const headers=new Headers(response.headers);if(identity.cookie)headers.append('Set-Cookie',identity.cookie);
  const body=await response.json();if(url.pathname==='/api/scan')body.trial=usage.status();
  return Response.json(body,{status:response.status,headers});
 }};
}
