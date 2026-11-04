import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const m = new WebAssembly.Module(buf);
const imps = WebAssembly.Module.imports(m);
const exps = WebAssembly.Module.exports(m);
console.log('imports kinds', imps.filter(i=>i.kind==='memory'), 'export memories', exps.filter(e=>e.kind==='memory'));
// check memory section flags: parse custom? simple: look for 'shared' via validate with threads
// Parse memory section manually
let off = 8;
function leb(){let r=0,s=0,b;do{b=buf[off++];r|=(b&0x7f)<<s;s+=7}while(b&0x80);return r>>>0}
while(off<buf.length){const id=buf[off++];const size=leb();const start=off;
 if(id===5){const n=leb();for(let i=0;i<n;i++){const flags=leb();console.log('memory flags',flags,'shared?',!!(flags&2),'mem64?',!!(flags&4));}}
 if(id===2){ /* imports may include memory */ }
 off=start+size;}
console.log('has pthread strings in js:', /pthread|SharedArrayBuffer/.test(fs.readFileSync(process.argv[3],'utf8')));
