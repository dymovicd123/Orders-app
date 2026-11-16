// Encrypt production D1 SQL for public-repository GitHub Actions artifacts.
// No private key is included in source, workflow, logs or artifact.
import {constants,createCipheriv,createDecipheriv,createHash,publicEncrypt,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform,Writable} from 'node:stream';
const [source,outputDir]=process.argv.slice(2);
if(!source||!outputDir)throw Error('Expected SQL source and secure artifact output directory');
const pubkey=readFileSync('.github/ops/return-v2-main-backup-public.pem');
const key=randomBytes(32),nonce=randomBytes(12);
const cipher=createCipheriv('aes-256-gcm',key,nonce);
mkdirSync(outputDir,{recursive:true,mode:0o700});
const path=join(outputDir,'database.sql.aesgcm');
const hash=createHash('sha256');
const tee=new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk)}});
await pipeline(createReadStream(source),tee,cipher,createWriteStream(path,{mode:0o600}));
const sourceHash=hash.digest('hex');
const tag=cipher.getAuthTag();
const wrapped=publicEncrypt({key:pubkey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
writeFileSync(join(outputDir,'wrapped-key.bin'),wrapped,{mode:0o600});
writeFileSync(join(outputDir,'nonce.bin'),nonce,{mode:0o600});
writeFileSync(join(outputDir,'auth-tag.bin'),tag,{mode:0o600});
// Decrypt ciphertext with the in-memory secret and compare the entire SQL, not only its length.
const decipher=createDecipheriv('aes-256-gcm',key,nonce);
decipher.setAuthTag(tag);
const check=createHash('sha256');
await pipeline(createReadStream(path),decipher,new Writable({write(chunk,encoding,callback){check.update(chunk);callback()}}));
if(sourceHash!==check.digest('hex'))throw Error('Backup encryption round-trip failed');
const publicKeyHash=createHash('sha256').update(pubkey).digest('hex');
writeFileSync(join(outputDir,'manifest.json'),JSON.stringify({
 type:'Orders-app Main D1 before Return V2 schema installation',createdAt:new Date().toISOString(),
 algorithm:'AES-256-GCM + RSA-3072-OAEP-SHA256',publicKeySha256:publicKeyHash,\n exportCompatibility:'sqlite3_cli_only',importDirectlyToD1Supported:false,
 ciphertextBytes:statSync(path).size,plaintextBytes:statSync(source).size,
 sourceRef:process.env.GITHUB_SHA||'unknown'
},null,2)+'\n',{mode:0o600});
console.log('ENCRYPTED_MAIN_D1_BACKUP_VERIFIED: ciphertext authenticated, no plaintext in artifact');
