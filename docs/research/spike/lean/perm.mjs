const DEPS = process.argv[2];
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init();
const v = k.getVolume(k.fuse(k.makeBox(10,10,10), k.translate(k.makeCylinder(3,20),5,5,-5)));
let w="?"; try { (await import("node:fs")).writeFileSync("/tmp/x-perm-test","x"); w="WRITE ALLOWED"; } catch(e){ w=e.code; }
let c="?"; try { (await import("node:child_process")).execSync("true"); c="SPAWN ALLOWED"; } catch(e){ c=e.code; }
console.log(JSON.stringify({volume:v, fsWrite:w, spawn:c, perm: process.permission?.has("fs.write")}));
