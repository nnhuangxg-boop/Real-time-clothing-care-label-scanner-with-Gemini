import {readFileSync} from 'node:fs';
import {createPostgresStore} from './postgres-store.mjs';
const store=createPostgresStore(process.env.DATABASE_URL,process.env.IDENTITY_SECRET);
try{await store.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));console.log('Database schema ready');}
finally{await store.close();}
