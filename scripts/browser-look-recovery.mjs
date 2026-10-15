// Native camera fixtures, not model gameplay. Caller must first verify Chrome
// --mute-audio. Only ordinary bounded inputs and public snapshots are used.
import assert from "node:assert/strict";
export async function checkLookRecovery({ evaluate }) {
  const cases = [];
  await evaluate(`window.lookRecoveryTest={respawns:qev.respawner.enabled};qev.respawner.enabled=false;
    lookRecoveryTest.command=(fields={})=>{const s=qev.engine.snapshot();return {epoch:s.epoch,tick:s.tick,ref:0,
      forward:0,side:0,up:0,yawRate:0,pitchRate:0,fire:false,jump:false,weapon:0,ticks:12,...fields};};
    lookRecoveryTest.reset=async()=>{qev.pause();await qev.engine.loadMap('lq_e0m6',2);qev.engine.speed(1);
      document.querySelector('#map').value='lq_e0m6';document.querySelector('#difficulty').value='2';
      if(!qev.engine.snapshot().viewRecovery.level)throw new Error('Fixture needs a fresh level view');};`);
  try {
    for (const pitchRate of [-60, 60]) {
      const result = await evaluate(`(async()=>{await lookRecoveryTest.reset();const before=qev.engine.snapshot();
        await qev.engine.act(lookRecoveryTest.command({pitchRate:${pitchRate}}));const looked=qev.engine.snapshot();
        await new Promise(r=>setTimeout(r,160));const frozen=qev.engine.snapshot();
        await qev.engine.frame();const maintenance=qev.engine.snapshot();
        await qev.engine.act(lookRecoveryTest.command());const level=qev.engine.snapshot();
        return {kind:'frozen-look',pitchRate:${pitchRate},before,looked,frozen,maintenance,level};})()`);
      const { before, looked, frozen, maintenance, level } = result;
      assert.equal(looked.tick - before.tick, 12); assert.equal(looked.actionTicks, 12);
      assert.equal(looked.viewRecovery.level, false); assert.equal(looked.viewRecovery.ticks, 0);
      assert.equal(frozen.tick, looked.tick); assert.deepEqual(frozen.viewRecovery, looked.viewRecovery);
      assert.equal(maintenance.tick, looked.tick + 1); assert.equal(maintenance.viewRecovery.level, false); assert.equal(maintenance.viewRecovery.ticks, 0);
      assert.equal(level.tick - maintenance.tick, 12); assert.equal(level.actionTicks, 12);
      assert.equal(level.viewRecovery.level, true); assert.equal(level.viewRecovery.active, false); assert.equal(level.paused, true);
      assert.ok(level.viewRecovery.ticks > 0 && level.viewRecovery.ticks <= 12);
      assert.equal(level.weaponPresses, 0); assert.equal(level.meleeApproachTicks, 0); assert.equal(level.player.shells, before.player.shells);
      cases.push(result);
      console.log(`PASS explicit look-${pitchRate > 0 ? "down" : "up"} Step freezes; maintenance adds no recovery; next ordinary Step levels within its own ticks`);
    }
    for (const pitchRate of [-60, 60]) {
      const result = await evaluate(`(async()=>{await lookRecoveryTest.reset();const before=qev.engine.snapshot(),session=qev.engine.startAuto();
        if(!qev.engine.applyLive(lookRecoveryTest.command({pitchRate:${pitchRate}}),session))throw new Error('Look rejected');
        await qev.engine.waitFor(s=>s.actionTicks>=3);const holding=qev.engine.snapshot();
        await qev.engine.waitFor(s=>!s.actionTicksLeft&&s.viewRecovery.level&&!s.viewRecovery.active);
        const level=qev.engine.snapshot();qev.pause();return {kind:'live-look',pitchRate:${pitchRate},before,holding,level};})()`);
      assert.equal(result.holding.viewRecovery.active, false); assert.equal(result.holding.viewRecovery.ticks, 0);
      assert.ok(result.holding.actionTicksLeft > 0); assert.equal(result.holding.viewRecovery.level, false);
      assert.equal(result.level.actionTicks, 12); assert.equal(result.level.actionTicksLeft, 0);
      assert.ok(result.level.viewRecovery.ticks > 0 && result.level.viewRecovery.ticks <= 30);
      assert.equal(result.level.weaponPresses, 0); assert.equal(result.level.meleeApproachTicks, 0);
      assert.equal(result.level.player.shells, result.before.player.shells); cases.push(result);
      console.log(`PASS live look-${pitchRate > 0 ? "down" : "up"} returns to horizontal after expiry without extra action inputs`);
    }
    const replacement = await evaluate(`(async()=>{await lookRecoveryTest.reset();const session=qev.engine.startAuto();
      qev.engine.applyLive(lookRecoveryTest.command({pitchRate:60,ticks:45}),session);
      await qev.engine.waitFor(s=>s.actionTicks>=6);const looking=qev.engine.snapshot();
      if(!qev.engine.applyLive(lookRecoveryTest.command(),session))throw new Error('Ordinary replacement rejected');
      await qev.engine.waitFor(s=>!s.actionTicksLeft&&s.viewRecovery.level&&!s.viewRecovery.active);
      const level=qev.engine.snapshot();qev.pause();return {kind:'ordinary-replacement',looking,level};})()`);
    assert.ok(replacement.looking.actionTicksLeft > 0); assert.equal(replacement.looking.viewRecovery.level, false);
    assert.equal(replacement.level.actionSerial, replacement.looking.actionSerial + 1); assert.equal(replacement.level.actionTicks, 12);
    assert.ok(replacement.level.viewRecovery.ticks > replacement.looking.viewRecovery.ticks);
    assert.equal(replacement.level.weaponPresses, 0); assert.equal(replacement.level.meleeApproachTicks, 0);
    cases.push(replacement); console.log("PASS an ordinary live replacement levels a look before the old pitch lease expires");
    const priority = await evaluate(`(async()=>{await lookRecoveryTest.reset();const session=qev.engine.startAuto();
      qev.engine.applyLive(lookRecoveryTest.command({pitchRate:180,ticks:45}),session);
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const recovering=qev.engine.snapshot();
      if(!recovering.viewRecovery.active)throw new Error('Fixture missed active cleanup');
      if(!qev.engine.applyLive(lookRecoveryTest.command({pitchRate:-60}),session))throw new Error('New look rejected');
      await qev.engine.waitFor(s=>s.actionTicks>=3);const holding=qev.engine.snapshot();
      await qev.engine.waitFor(s=>!s.actionTicksLeft&&s.viewRecovery.level&&!s.viewRecovery.active);
      const level=qev.engine.snapshot();qev.pause();return {kind:'new-look-priority',recovering,holding,level};})()`);
    assert.equal(priority.holding.viewRecovery.active, false); assert.ok(priority.holding.actionTicksLeft > 0);
    assert.equal(priority.holding.viewRecovery.ticks, priority.recovering.viewRecovery.ticks);
    assert.ok(priority.level.viewRecovery.ticks > priority.holding.viewRecovery.ticks); assert.equal(priority.level.actionTicks, 12);
    cases.push(priority); console.log("PASS a new explicit look preempts active cleanup, then releases into its own bounded return");
    const stopped = await evaluate(`(async()=>{await lookRecoveryTest.reset();const session=qev.engine.startAuto();
      qev.engine.applyLive(lookRecoveryTest.command({pitchRate:60,ticks:45}),session);
      await qev.engine.waitFor(s=>s.actionTicks>=6);qev.pause();const stopped=qev.engine.snapshot();
      await new Promise(r=>setTimeout(r,160));const later=qev.engine.snapshot();
      await qev.engine.act(lookRecoveryTest.command());const level=qev.engine.snapshot();
      return {kind:'stop-during-look',stopped,later,level};})()`);
    assert.equal(stopped.stopped.viewRecovery.level, false); assert.equal(stopped.stopped.viewRecovery.active, false);
    assert.equal(stopped.later.tick, stopped.stopped.tick); assert.deepEqual(stopped.later.viewRecovery, stopped.stopped.viewRecovery);
    assert.equal(stopped.level.tick - stopped.later.tick, 12); assert.equal(stopped.level.viewRecovery.level, true);
    cases.push(stopped); console.log("PASS Stop freezes explicit-look recovery; only a later ordinary command resumes leveling");
    return { fixture: true, purpose: "Native explicit-look camera regression; not model gameplay or a survival result", cases };
  } finally {
    await evaluate("qev.pause();qev.respawner.enabled=lookRecoveryTest.respawns;delete window.lookRecoveryTest;qev.engine.loadMap('lq_e0m6',2)");
  }
}
