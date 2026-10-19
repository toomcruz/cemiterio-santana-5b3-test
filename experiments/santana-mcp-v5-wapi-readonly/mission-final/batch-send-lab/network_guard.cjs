// Loaded before tests. No HTTP/DNS/provider connections, including accidental ones.
const deny=()=>{throw Error('LAB_EXTERNAL_NETWORK_DENIED');};
globalThis.fetch=deny;
for(const name of ['http','https']){
 const module=require(name);module.request=deny;module.get=deny;
}
const net=require('net');net.Socket.prototype.connect=deny;
require('module').syncBuiltinESMExports();
