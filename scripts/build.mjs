import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const files={'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
const assets=Object.fromEntries(Object.entries(files).map(([route,[file,type]])=>[route,{body:readFileSync(`public/${file}`,'utf8'),type}]));
const logic=readFileSync('worker/logic.mjs','utf8').replaceAll('export ','');
const source=readFileSync('worker/index.mjs','utf8').replace("import { expandCompact, compactSchema, compactPrompt } from './logic.mjs';",logic).replace('// ASSET_BUNDLE',`const assets=${JSON.stringify(assets)};`);
mkdirSync('dist/server',{recursive:true});writeFileSync('dist/server/index.js',source);
writeFileSync('dist/server/wrangler.json',JSON.stringify({name:'care-scan',main:'index.js',compatibility_date:'2026-09-01'}));
console.log('Built care scanner (no external dependencies).');
