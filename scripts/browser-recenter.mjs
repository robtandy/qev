// Invoked only inside browser-smoke's verified --mute-audio session. Explicit
// native fixtures, NOT model gameplay: normal renderer/input/physics, no probes.
export async function checkRecenter({ evaluate, check, until, onView = async () => {} }) {
  await evaluate(`window.recenterTest={respawns:qev.respawner.enabled, evidence:[]};qev.respawner.enabled=false;
    recenterTest.command=(fields={})=>{const s=qev.engine.snapshot();return {epoch:s.epoch,tick:s.tick,ref:0,forward:0,side:0,up:0,
      yawRate:0,pitchRate:0,fire:false,jump:false,weapon:0,ticks:12,...fields};};
    recenterTest.reset=async()=>{qev.pause();await qev.engine.loadMap('lq_e0m6',2);qev.engine.speed(1);
      document.querySelector('#map').value='lq_e0m6';document.querySelector('#difficulty').value='2';
      // Explicit QA staging: turn 12 degrees right, then walk off the spawn
      // ledge toward the raised enemies. Only current upper-screen evidence is
      // inspected; this is not a model policy or a position/probe API.
      await qev.engine.act(recenterTest.command({yawRate:-60}));
      recenterTest.staging=[];let s,enemy;
      for(let i=0;i<=24;i++) {
        s=qev.engine.snapshot();
        enemy=s.enemies.filter(e=>!['death','dead'].includes(e.pose)&&e.screen.bounds[3]<0.4).sort((a,b)=>a.screen.bounds[1]-b.screen.bounds[1])[0];
        if(enemy || !s.alive || i===24)break;
        await qev.engine.act(recenterTest.command({forward:1}));recenterTest.staging.push(qev.engine.snapshot());
      }
      if(!enemy || !s.alive || !s.viewRecovery.level)throw new Error('Need a rendered elevated enemy and a level view '+JSON.stringify({s,staging:recenterTest.staging}));
      recenterTest.before=s;recenterTest.target=enemy;return enemy.ref;};`);
  try {
    await evaluate("recenterTest.reset()");
    await check("pixel aiming at a genuinely elevated enemy changes the rendered view without a world-angle observation", `
      const ref=recenterTest.target.ref;
      await qev.engine.act(recenterTest.command({ref}));const aimed=qev.engine.snapshot();
      const enemy=aimed.enemies.find(e=>e.ref===ref);
      recenterTest.aimed=aimed;
      if(!enemy || aimed.viewRecovery.level || enemy.screen.bounds[3]<0.47)
        throw new Error('Rendered elevated aim failed '+JSON.stringify({before:recenterTest.before,aimed}));
      return aimed.actionTicks===12 && aimed.tick-recenterTest.before.tick===12 && !aimed.viewRecovery.active;
    `);
    await until(() => evaluate("document.querySelector('#status').textContent.startsWith('Stopped')"));
    await onView("aimed-up");
    await check("a frozen target Step never runs hidden cleanup frames; subsequent ordinary Steps restore level", `
      const stopped=qev.engine.snapshot();await new Promise(r=>setTimeout(r,200));
      if(qev.engine.snapshot().tick!==stopped.tick || qev.engine.snapshot().viewRecovery.level)throw new Error('Stopped view changed');
      const samples=[];
      for(let i=0;i<3&&!qev.engine.snapshot().viewRecovery.level;i++) {
        const before=qev.engine.snapshot();await qev.engine.act(recenterTest.command());const after=qev.engine.snapshot();samples.push(after);
        if(after.tick-before.tick!==12 || after.actionTicks!==12 || after.player.shells!==before.player.shells || after.meleeApproachTicks!==0)
          throw new Error('Cleanup changed Step/action semantics '+JSON.stringify({before,after}));
      }
      const level=qev.engine.snapshot();recenterTest.evidence.push({kind:'frozen',staging:recenterTest.staging,before:recenterTest.before,aimed:recenterTest.aimed,samples,level});
      return level.viewRecovery.level && !level.viewRecovery.active && level.viewRecovery.ticks>0 && level.paused;
    `);
    await until(() => evaluate("document.querySelector('#status').textContent.startsWith('Stopped')"));
    await onView("level");
    await evaluate("recenterTest.reset()");
    await check("live target expiry restores level with no retained movement, attack, switch or extension of the target lease", `
      const session=qev.engine.startAuto();
      if(!qev.engine.applyLive(recenterTest.command({ref:recenterTest.target.ref}),session))throw new Error('Live aim rejected');
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const expired=qev.engine.snapshot();
      await qev.engine.waitFor(s=>s.viewRecovery.level&&!s.viewRecovery.active);const level=qev.engine.snapshot();qev.pause();
      recenterTest.evidence.push({kind:'live-expiry',staging:recenterTest.staging,before:recenterTest.before,expired,level});
      return expired.actionTicks===12 && level.actionTicks===12 && !level.actionTicksLeft && level.viewRecovery.ticks>0 &&
        level.viewRecovery.ticks<=30 && level.actionSerial===expired.actionSerial && level.weaponPresses===0 &&
        level.meleeApproachTicks===0 && level.player.shells===recenterTest.before.player.shells;
    `);
    await evaluate("recenterTest.reset()");
    await check("explicit look-up preempts active recovery while held, then returns to level after its lease ends", `
      const session=qev.engine.startAuto();qev.engine.applyLive(recenterTest.command({ref:recenterTest.target.ref}),session);
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const before=qev.engine.snapshot();
      if(!before.viewRecovery.active)throw new Error('Fixture missed active recovery');
      if(!qev.engine.applyLive(recenterTest.command({pitchRate:-60}),session))throw new Error('Explicit look rejected');
      await qev.engine.waitFor(s=>s.actionTicks>=3);const holding=qev.engine.snapshot();
      await qev.engine.waitFor(s=>!s.actionTicksLeft&&s.viewRecovery.level&&!s.viewRecovery.active);
      const after=qev.engine.snapshot();qev.pause();recenterTest.evidence.push({kind:'explicit-look',staging:recenterTest.staging,before,holding,after});
      return holding.actionTicksLeft>0 && !holding.viewRecovery.active && holding.viewRecovery.ticks===before.viewRecovery.ticks &&
        after.viewRecovery.level && !after.viewRecovery.active && after.viewRecovery.ticks>holding.viewRecovery.ticks && after.actionTicks===12;
    `);
    await evaluate("recenterTest.reset()");
    await check("Stop suspends view recovery immediately, and a new target preempts it rather than dipping toward the horizon", `
      const session=qev.engine.startAuto();qev.engine.applyLive(recenterTest.command({ref:recenterTest.target.ref}),session);
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const before=qev.engine.snapshot();
      if(!before.viewRecovery.active)throw new Error('Fixture missed active recovery');
      if(!qev.engine.applyLive(recenterTest.command({ref:recenterTest.target.ref}),session))throw new Error('New target rejected');
      await qev.engine.waitFor(s=>s.actionTicks>=2);qev.pause();const stopped=qev.engine.snapshot();
      await new Promise(r=>setTimeout(r,200));const later=qev.engine.snapshot();
      recenterTest.evidence.push({kind:'new-target-stop',staging:recenterTest.staging,before,stopped,later});
      return !stopped.viewRecovery.active && !stopped.viewRecovery.level && stopped.viewRecovery.ticks===before.viewRecovery.ticks &&
        later.tick===stopped.tick && JSON.stringify(later.viewRecovery)===JSON.stringify(stopped.viewRecovery);
    `);
    return await evaluate(`({fixture:true,purpose:'Actual rendered elevated enemy, normal input and physics; no model inference or skill claim',cases:recenterTest.evidence})`);
  } finally {
    await evaluate("qev.pause();qev.respawner.enabled=recenterTest.respawns;delete window.recenterTest;document.querySelector('#map').value='qev_encounter';document.querySelector('#difficulty').value='0';qev.engine.loadMap('qev_encounter',0)");
    await until(() => evaluate("qev.engine.snapshot().paused && !qev.agent.busy"));
  }
}
