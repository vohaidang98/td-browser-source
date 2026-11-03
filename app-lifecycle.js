'use strict';
function installManagerLifecycle({app,getWindow,createWindow,stopWork,isBusy,finishWork,describe=()=>({}),forceStop=()=>{},complete=()=>app.quit(),clock={setInterval,clearInterval,now:Date.now}}){
 let phase='idle',startedAt=0,timer=null,stopping=false,finishing=false,error=false;
 const status=()=>({phase,elapsedSeconds:startedAt?Math.floor((clock.now()-startedAt)/1000):0,error,...describe()});
 function send(win=getWindow()){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('app-shutdown-state',status());}
 function show(){if(!app.isReady())return;const win=getWindow()||createWindow();if(win.isMinimized())win.restore();win.show();win.focus();send(win);return win;}
 function attach(win){win.on('close',event=>{if(phase==='ready')return;event.preventDefault();app.quit();});win.webContents.on('did-finish-load',()=>send(win));}
 async function tick(){if(phase==='ready')return;send();if(stopping||finishing||error||isBusy())return;finishing=true;try{await finishWork();phase='ready';if(timer)clock.clearInterval(timer);timer=null;complete(false);}catch{error=true;phase='waiting';finishing=false;send();}}
 function request(){if(phase==='ready')return;if(stopping||finishing||(phase==='waiting'&&!error))return show();show();if(!startedAt)startedAt=clock.now();phase='stopping';error=false;stopping=true;send();if(!timer)timer=clock.setInterval(()=>{void tick();},500);void Promise.resolve().then(stopWork).then(()=>{if(phase==='ready')return;stopping=false;phase='waiting';void tick();},()=>{if(phase==='ready')return;stopping=false;error=true;phase='waiting';send();});}
 function force(){if(phase==='idle'||phase==='ready')return false;phase='ready';if(timer)clock.clearInterval(timer);timer=null;forceStop();complete(true);return true;}
 app.on('before-quit',event=>{if(phase==='ready')return;event.preventDefault();request();});
 app.on('second-instance',show);
 app.on('activate',show);
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
 return {attach,show,request,force,status,isClosing:()=>phase!=='idle',isReady:()=>phase==='ready'};
}
module.exports={installManagerLifecycle};
