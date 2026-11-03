'use strict';
// Run in a Node.js project with playwright-core installed.
const {chromium}=require('playwright-core');
const token=process.env.TD_BROWSER_TOKEN;
const profileId=process.env.TD_PROFILE_ID;
const port=Number(process.env.TD_BROWSER_PORT||36925);
async function api(route,method='GET',body){
  const response=await fetch(`http://127.0.0.1:${port}/v1${route}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(310000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'TD API error');return data;
}
async function main(){
  if(!token||!profileId)throw Error('Set TD_BROWSER_TOKEN and TD_PROFILE_ID.');
  const connection=await api('/profiles/'+encodeURIComponent(profileId)+'/start','POST',{});
  let browser;
  try{
    browser=await chromium.connectOverCDP(connection.cdpUrl,{noDefaults:true});
    const context=browser.contexts()[0]; // Reuse the profile. Do not use browser.newContext().
    const page=context.pages()[0]||await context.newPage();
    await page.goto('https://example.com',{waitUntil:'domcontentloaded'});
    console.log(await page.locator('h1').innerText());
  }finally{
    if(browser)await browser.close(); // Disconnect the CDP client only.
    if(connection.startedNow)await api('/profiles/'+encodeURIComponent(profileId)+'/stop','POST',{});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
