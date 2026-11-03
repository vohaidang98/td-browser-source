#!/usr/bin/env node
'use strict';
// Optional bridge for MCP clients that only support stdio. Requires Node >= 18.
const readline=require('readline');
const port=Number(process.env.TD_BROWSER_PORT||36925);
const token=process.env.TD_BROWSER_TOKEN;
if(!token||!Number.isInteger(port)||port<1024||port>65535){process.stderr.write('Set TD_BROWSER_TOKEN and optionally TD_BROWSER_PORT. Enable API in TD Browser first.\n');process.exitCode=1;}
else{
  let protocol='2025-06-18',inFlight=0,ended=false;
  const lineReader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
  lineReader.on('line',async line=>{
    if(!line.trim())return;
    let message;
    try{
      if(line.length>1024*1024)throw Error('Request too large.');
      message=JSON.parse(line);if(!message||message.jsonrpc!=='2.0')throw Error('Invalid JSON-RPC.');
      if(inFlight>=16)throw Error('Too many concurrent requests.');
      inFlight++;
      try{
        const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':'Bearer '+token,'MCP-Protocol-Version':protocol},body:JSON.stringify(message),signal:AbortSignal.timeout(60000)});
        if(response.status===202||response.status===204)return;
        const result=await response.json();
        if(!response.ok)throw Error(result.error?.message||result.error||'TD Browser request failed.');
        if(message.method==='initialize'&&result.result?.protocolVersion)protocol=result.result.protocolVersion;
        if(Object.hasOwn(message,'id'))send(result);
      }finally{inFlight--;if(ended&&!inFlight)process.stdin.destroy();}
    }catch(error){
      if(message&&Object.hasOwn(message,'id'))send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:String(error.message).slice(0,300)}});
      else if(!message)send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON-RPC input.'}});
    }
  });
  lineReader.on('close',()=>{ended=true;if(!inFlight)process.stdin.destroy();});
}
