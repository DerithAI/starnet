'use strict';
const fs=require('node:fs'),http=require('node:http');const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,req,res,...rest){
 if(event==='request'){
  let c={};try{c=JSON.parse(fs.readFileSync(process.env.E09_FAULT_CONTROL,'utf8'))}catch{}
  const u=String(req.url||'');
  if(c.diagnosticsFail&&u.startsWith('/api/diagnostics')){req.socket.destroy();return true;}
  if(req.method==='GET'&&u.startsWith('/api/save?')&&['headers','body'].includes(c.mode)){
   if(c.mode==='body'){res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{"save":');}
   const deadline=setTimeout(()=>res.destroy(),15000);res.on('close',()=>clearTimeout(deadline));return true;
  }
 }
 return emit.call(this,event,req,res,...rest);
};
