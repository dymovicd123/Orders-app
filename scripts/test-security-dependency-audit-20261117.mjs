import assert from 'node:assert/strict'
import { validateUnpatchedBuildOnlyAudit } from './security-dependency-audit-20261117.mjs'

const names=['picomatch','fdir','tinyglobby','vite','@vitejs/plugin-react']
const advisory={url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',severity:'high'}
const via={
  picomatch:[advisory],
  fdir:['picomatch'],
  tinyglobby:['picomatch','fdir'],
  vite:['picomatch','tinyglobby'],
  '@vitejs/plugin-react':['vite'],
}
const lock={packages:Object.fromEntries(names.map(name=>['node_modules/'+name,{dev:true,version:name==='picomatch'?'4.0.7':'1.0.0'}]))}
const report={metadata:{vulnerabilities:{critical:0,high:5,moderate:0,low:0,info:0}},vulnerabilities:
  Object.fromEntries(names.map(name=>[name,{severity:'high',isDirect:name==='vite',via:via[name]}]))}
assert.equal(validateUnpatchedBuildOnlyAudit(report,lock).exception,true)
assert.equal(validateUnpatchedBuildOnlyAudit({metadata:{vulnerabilities:{high:0,critical:0}},vulnerabilities:{}},lock).exception,false)
for(const bad of [
  {...report,metadata:{vulnerabilities:{critical:1,high:5}}},
  {...report,vulnerabilities:{...report.vulnerabilities,other:{severity:'high',via:[advisory]}}},
  {...report,vulnerabilities:{...report.vulnerabilities,picomatch:{severity:'high',isDirect:false,via:[{...advisory,url:'https://github.com/advisories/OTHER'}]}}},
  {...report,vulnerabilities:{...report.vulnerabilities,vite:{severity:'high',via:['OTHER']}}},
]) assert.throws(()=>validateUnpatchedBuildOnlyAudit(bad,lock))
assert.throws(()=>validateUnpatchedBuildOnlyAudit(report,{packages:{...lock.packages,'node_modules/vite':{dev:false}}}))
assert.throws(()=>validateUnpatchedBuildOnlyAudit(report,{packages:{...lock.packages,'node_modules/picomatch':{dev:true,version:'4.0.8'}}}))
console.log('SCOPED_SECURITY_AUDIT_PASS: only one specific unpatched dev-only GHSA can pass; new advisories, prod and changed versions fail')
