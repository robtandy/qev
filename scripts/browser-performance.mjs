// Invoked only by the harness that verifies --mute-audio before loading qev.
// Controlled stalls and mocked 1.8-second replies are NOT Pixel measurements.
export async function checkPerformance({ evaluate, check, until, captureGame }) {
  await evaluate(`qev.pause();window.perfTest={getModel:qev.agent.getModel,speed:qev.engine.diagnostics().speed,
    speedValue:document.querySelector('#speed').value,respawns:qev.respawner.enabled};qev.respawner.enabled=false;
    window.scrollTo(0,0);`);
  let imageBefore;
  try {
    await evaluate("qev.agent.invalidate();qev.engine.loadMap('qev_encounter',0)");
    await until(() => evaluate("qev.engine.snapshot().ready && qev.engine.snapshot().paused"));
    if (captureGame) imageBefore = await captureGame();
    await check("catch-up callbacks retain every simulation/visible frame but present only the final framebuffer", `
      qev.engine.speed(1);const before=qev.engine.snapshot(),p=qev.engine.diagnostics(),session=qev.engine.startAuto();
      if(!qev.engine.applyLive({epoch:before.epoch,tick:before.tick,ref:0,forward:0,side:0,up:0,yawRate:90,pitchRate:0,
        fire:false,jump:false,weapon:0,ticks:45},session))throw new Error('Fixture input rejected');
      // Deliberately stall this test's main thread to create a catch-up callback.
      const deadline=performance.now()+100;while(performance.now()<deadline){}
      await qev.engine.waitFor(s=>s.tick>=before.tick+3);qev.pause();
      const after=qev.engine.snapshot(),end=qev.engine.diagnostics(),ticks=after.tick-before.tick;
      perfTest.presentation={syntheticStall:true,before,after,start:p,end};
      if(!(ticks>=3 && end.deferred-p.deferred>=3 && end.presents-p.presents<end.hostFrames-p.hostFrames))
        throw new Error('No presentation coalescing: '+JSON.stringify(perfTest.presentation));
      return after.paused && after.screen.frame-before.screen.frame===ticks && end.hostFrames-p.hostFrames===ticks &&
        end.presents>p.presents && end.maxBatchFrames>=3 && end.invalidTimes===0 &&
        !('hostFrames' in after) && !('presentation' in after);
    `);
    if (captureGame && imageBefore === await captureGame()) throw new Error("The final changed game framebuffer was not presented");
    await check("paused diagnostic reads add no frames and a frozen frame step still presents exactly once", `
      const before=qev.engine.snapshot(),p=qev.engine.diagnostics();
      for(let i=0;i<50;i++){qev.engine.diagnostics();qev.diagnostics();}
      await new Promise(r=>setTimeout(r,100));
      if(qev.engine.snapshot().tick!==before.tick || qev.engine.diagnostics().hostFrames!==p.hostFrames) return false;
      await qev.engine.frame();const after=qev.engine.snapshot(),end=qev.engine.diagnostics();
      return after.paused && after.tick===before.tick+1 && after.screen.frame===before.screen.frame+1 &&
        end.hostFrames===p.hostFrames+1 && end.presents===p.presents+1;
    `);
    await evaluate(`(async()=>{
      qev.agent.invalidate();await qev.engine.loadMap('qev_encounter',0);
      // Slow pacing keeps this lifecycle fixture out of combat; it does NOT
      // relax the independent wall deadline. Ordinary game physics remains.
      qev.engine.speed(0.1);document.querySelector('#speed').value='0.1';
      const f=perfTest;f.calls=0;f.firstId=qev.agent.sequence+1;f.beforeSlow=qev.engine.snapshot();
      f.model={info:{arch:'fixture',backend:'mock',synthetic:true},async decideMany(requests){
        const r=qev.agent.current,index=r.eligible.findIndex(c=>c.id==='wait');f.calls++;
        await new Promise(resolve=>setTimeout(resolve,1800));
        return testReplies(requests,index);
      }};qev.agent.getModel=()=>f.model;
    })()`);
    await until(() => evaluate("!document.querySelector('#auto').disabled"));
    await evaluate("document.querySelector('#auto').click()");
    await until(() => evaluate("perfTest.calls>0 && qev.agent.busy"));
    await check("a pending response reports elapsed time, not fabricated completed inference time", `
      const r=qev.diagnostics().latest.at(-1);
      return r.status==='scoring' && r.ms===null && r.elapsedSoFarMs>=0 && r.modelTiming.totalMs===null && r.nativeDuringInference.pending;
    `);
    await until(() => evaluate("perfTest.calls===3 && !qev.agent.busy && qev.playMode==='inspection'"), 20000);
    await check("three late replies stop Auto instead of retrying forever, without sampling or executing stale input", `
      const records=qev.agent.history.filter(r=>r.id>=perfTest.firstId),s=qev.engine.snapshot();
      perfTest.expired=records;
      return records.length===3 && records.every(r=>r.status==='discarded' && r.validation.phase==='reply' &&
        r.validation.reasons.includes('wall-age') && r.validation.ageTicks<60 && !r.sampling && !r.appliedAt && r.responses.length===1) &&
        s.paused && s.actionSerial===perfTest.beforeSlow.actionSerial && s.actionTicks===perfTest.beforeSlow.actionTicks &&
        document.querySelector('#error').textContent.includes('3 consecutive decisions missed') &&
        document.querySelector('#status').textContent.includes('missed the live deadline');
    `);
    await check("Copy diagnostics produces a small timing/guard report without changing history, playback or original replies", `
      const original=navigator.clipboard.writeText,raw=JSON.stringify(perfTest.expired.map(r=>({requests:r.requests,responses:r.responses}))),before=qev.engine.snapshot();
      let text;
      navigator.clipboard.writeText=async value=>{text=value;};
      try {
        document.querySelector('#diagnostics').click();await new Promise(r=>setTimeout(r,150));
        const d=JSON.parse(text);perfTest.summary=d;
        document.querySelector('#error').hidden=true;
        return text.length<12000 && d.version===1 && d.limits.maxGameTicks===60 && d.limits.maxWallMs===1500 &&
          d.latest.slice(-3).every(r=>r.validation.reasons.includes('wall-age')&&r.ms>=1500&&r.modelTiming.forwardMs===null) &&
          d.world.actionSerial===perfTest.beforeSlow.actionSerial && d.native.physicsHz===60 &&
          JSON.stringify(perfTest.expired.map(r=>({requests:r.requests,responses:r.responses})))===raw &&
          qev.engine.snapshot().paused && qev.engine.snapshot().tick===before.tick &&
          document.querySelector('#diagnostics-status').textContent==='Diagnostic summary copied.' &&
          document.querySelector('#status').textContent.includes('missed the live deadline');
      } finally {navigator.clipboard.writeText=original;}
    `);
    await check("blocked clipboard access downloads the same compact report instead", `
      const write=navigator.clipboard.writeText,click=HTMLAnchorElement.prototype.click;let link;
      navigator.clipboard.writeText=async()=>{throw new Error('Fixture: permission denied')};
      HTMLAnchorElement.prototype.click=function(){if(this.download==='qev-diagnostics.json')link=this;else click.call(this);};
      try {
        document.querySelector('#diagnostics').click();await new Promise(r=>setTimeout(r,100));
        const d=await (await fetch(link.href)).json();
        return d.version===1 && d.latest.slice(-3).every(r=>r.status==='discarded') && qev.engine.snapshot().paused &&
          document.querySelector('#diagnostics-status').textContent.includes('downloaded');
      } finally {navigator.clipboard.writeText=write;HTMLAnchorElement.prototype.click=click;}
    `);
    await evaluate("qev.engine.speed(1);document.querySelector('#speed').value='1';document.querySelector('#step').click()");
    await until(() => evaluate("!qev.agent.busy && qev.agent.current?.status==='executed'"), 15000);
    await check("the same slow model can execute a fresh frozen Step without extending live deadlines", `
      const r=qev.agent.current;perfTest.step=r;
      return r.mode==='inspection' && r.ms>=1500 && r.after.tick-r.before.tick===12 && r.sampling.complete &&
        Object.keys(r.sampling.heads).join(',')==='action' && r.selected.id==='wait' && qev.engine.snapshot().paused &&
        !document.querySelector('#status').textContent.includes('missed the live deadline');
    `);
    return await evaluate("({synthetic:true,purpose:'Native presentation and deliberately slow mocked inference; not a Pixel benchmark',presentation:perfTest.presentation,summary:perfTest.summary,expired:perfTest.expired,step:perfTest.step})");
  } finally {
    await evaluate("qev.pause();qev.agent.invalidate();qev.agent.getModel=perfTest.getModel;qev.engine.speed(perfTest.speed);document.querySelector('#speed').value=perfTest.speedValue;qev.respawner.enabled=perfTest.respawns");
    await until(() => evaluate("!qev.agent.busy"));
    await evaluate("delete window.perfTest");
  }
}
