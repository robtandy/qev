// Only invoked by the --mute-audio-enforced browser harness.
export async function checkController({ evaluate, check, until, onCorpse = async () => {} }) {
  await evaluate(`window.controlTest={respawns:qev.respawner.enabled};qev.respawner.enabled=false;
    controlTest.command=(fields={})=>{const s=qev.engine.snapshot();return{epoch:s.epoch,tick:s.tick,ref:0,forward:0,side:0,up:0,yawRate:0,pitchRate:0,fire:false,jump:false,weapon:0,ticks:12,...fields};};`);
  try {
    await evaluate("qev.engine.resumeAudio()"); // Previously unlocked by the trusted audio tests; host remains muted.
    await evaluate("qev.pause();qev.engine.loadMap('qev_encounter',0)");
    await evaluate("(async()=>{for(let i=0;i<90&&!qev.engine.snapshot().player.grounded;i++)await qev.engine.frame()})()");
    await check('model-selected equipment switches once alongside the tactic, never as an automatic best-weapon picker', `
      const {prepareDecision,resolveSelection}=await import('/src/decisions.js');
      for(const [id,name] of [['w1','axe'],['w2','shotgun']]) {
        const s=qev.engine.snapshot(),r=prepareDecision(s), index=r.eligible.findIndex(c=>c.id==='forward');
        r.selectedIndex=index;r.responses=testReplies(r.requests,index,{weapon:id});
        const chosen=resolveSelection(r);await qev.engine.act(chosen.params);
        const after=qev.engine.snapshot();
        if(after.player.weapon!==name || after.weaponPresses!==1 || after.actionTicks!==12 || chosen.params.forward!==1)
          throw new Error('Concurrent equipment failed '+JSON.stringify({chosen,after}));
      }
      return true;
    `);
    await check('repeated model choices to keep the shotgun retain movement with zero repeated weapon presses', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      for(let i=0;i<4;i++) {
        const s=qev.engine.snapshot(),r=prepareDecision(s);
        r.responses=testDecisionReplies(r,{action:i%2?'back':'forward',weapon:'w2'});
        r.selectedIndex=rankDecision(r)[0].index;const chosen=resolveSelection(r);
        await qev.engine.act(chosen.params);const after=qev.engine.snapshot();
        if(after.player.weapon!=='shotgun' || after.weaponPresses!==0 || after.actionTicks!==12 || Math.abs(chosen.params.forward)!==1)
          throw new Error('Held shotgun displaced tactic '+JSON.stringify({chosen,after}));
      }
      return true;
    `);
    await check('a weapon that was held at observation time is rechecked against the current HUD at live execution', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      const r=prepareDecision(qev.engine.snapshot());r.responses=testDecisionReplies(r,{action:'forward',weapon:'w2'});
      r.selectedIndex=rankDecision(r)[0].index;const chosen=resolveSelection(r);
      await qev.engine.act(controlTest.command({weapon:1}));
      if(qev.engine.snapshot().player.weapon!=='axe')throw new Error('Fixture did not change weapons');
      const session=qev.engine.startAuto();
      if(!qev.engine.applyLive(chosen.params,session))throw new Error('Fresh live command rejected');
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const after=qev.engine.snapshot();qev.pause();
      return after.player.weapon==='shotgun' && after.weaponPresses===1 && after.actionTicks===12 && chosen.params.forward===1;
    `);
    await check('an explicit jump command lifts the grounded player while ordinary gravity continues', `
      for(let i=0;i<90&&!qev.engine.snapshot().player.grounded;i++)await qev.engine.frame();
      const before=qev.engine.snapshot();await qev.engine.act(controlTest.command({jump:true,forward:1}));
      const after=qev.engine.snapshot();
      return before.player.grounded && !after.player.grounded && after.paused && after.tick-before.tick===12 && after.actionTicks===12;
    `);
    await check('vertical swim input is structurally supported and invalid numeric/weapon commands fail closed', `
      const m=qev.engine.module, values=p=>qev.engine.commandValues(controlTest.command(p));
      const s=qev.engine.snapshot();
      const invalid=!m._qev_command(...values({up:1.1})) && !m._qev_command(...values({weapon:8})) &&
        !m._qev_command(...values({ticks:13})) && !m._qev_command(...values({ref:2147483000})) &&
        m._qev_command(s.epoch,s.tick,0,NaN,0,0,0,0,0,0,0,12)===0;
      await qev.engine.act(controlTest.command({up:1,ticks:1}));
      return invalid && qev.engine.snapshot().actionTicks===1;
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await evaluate("(async()=>{for(let i=0;i<90&&!qev.engine.snapshot().player.grounded;i++)await qev.engine.frame()})()");
    await check('switching while firing first confirms the chosen gun, then fires without reselecting it', `
      await qev.engine.act(controlTest.command({weapon:1}));const shells=qev.engine.snapshot().player.shells;
      await qev.engine.act(controlTest.command({weapon:2,fire:true,ticks:1}));
      const switched=qev.engine.snapshot();
      if(switched.weaponPresses!==1 || switched.player.weapon!=='shotgun' || switched.player.shells!==shells)
        throw new Error('Switch/firing order '+JSON.stringify(switched));
      await qev.engine.act(controlTest.command({weapon:2,fire:true}));const fired=qev.engine.snapshot();
      return fired.weaponPresses===0 && fired.player.weapon==='shotgun' && fired.player.shells<shells;
    `);
    await evaluate("(async()=>{await qev.engine.loadMap('qev_encounter',0);controlTest.engagement=[];})()");
    await check('axe engagement is a declared choice that really advances; stationary axe attack is not rewritten', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      for(let i=0;i<90&&!qev.engine.snapshot().player.grounded;i++)await qev.engine.frame();
      await qev.engine.act(controlTest.command({weapon:1}));
      for(const action of ['attack','engage']) {
        const s=qev.engine.snapshot(),r=prepareDecision(s);
        r.responses=testDecisionReplies(r,{action,weapon:'w1'});r.selectedIndex=rankDecision(r)[0].index;
        const choice=resolveSelection(r), raw=JSON.stringify(r.responses), samples=[];
        const executing=qev.engine.act(choice.params);
        while(qev.engine.snapshot().remaining>0){await new Promise(resolve=>setTimeout(resolve,5));samples.push(qev.engine.snapshot());}
        const after=await executing;
        controlTest.engagement.push({before:s,requests:r.requests,responses:r.responses,selected:choice,after});
        if(JSON.stringify(r.responses)!==raw || choice.params.forward!==0)throw new Error('Test choice was rewritten');
        if(after.weaponPresses!==0)throw new Error('Held axe was redundantly selected; decode the one-byte HUD value correctly');
        if(action==='attack' && after.meleeApproachTicks!==0)throw new Error('Stationary axe attack gained movement');
        if(action==='engage' && (!(after.meleeApproachTicks>0) || after.meleeApproachTicks!==after.actionTicks || !samples.some(s=>s.player.moving)))
          throw new Error('Axe engagement did not move '+JSON.stringify({choice,after,motion:samples.map(s=>({tick:s.tick,moving:s.player.moving,advance:s.meleeApproachTicks}))}));
      }
      return true;
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await check('ranged engagement aims and attacks without injecting melee advance', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      const s=qev.engine.snapshot(),r=prepareDecision(s);
      r.responses=testDecisionReplies(r,{action:'engage',weapon:'w2'});r.selectedIndex=rankDecision(r)[0].index;
      const choice=resolveSelection(r);await qev.engine.act(choice.params);const after=qev.engine.snapshot();
      controlTest.engagement.push({before:s,requests:r.requests,responses:r.responses,selected:choice,after});
      return choice.params.meleeApproach===true && after.player.weapon==='shotgun' && after.meleeApproachTicks===0 && after.actionTicks===12;
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await check('engagement rechecks the current HUD weapon through a real live switch rather than freezing movement at score time', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      await qev.engine.act(controlTest.command({weapon:1}));const s=qev.engine.snapshot(),r=prepareDecision(s,null,{realtime:true});
      r.responses=testDecisionReplies(r,{action:'engage',weapon:'w1'});r.selectedIndex=rankDecision(r)[0].index;const choice=resolveSelection(r);
      await qev.engine.act(controlTest.command({weapon:2}));
      if(qev.engine.snapshot().player.weapon!=='shotgun')throw new Error('Fixture failed to change HUD equipment');
      const session=qev.engine.startAuto();if(!qev.engine.applyLive(choice.params,session))throw new Error('Fresh engagement rejected');
      await qev.engine.waitFor(s=>!s.actionTicksLeft);const after=qev.engine.snapshot();qev.pause();
      controlTest.engagement.push({before:s,requests:r.requests,responses:r.responses,selected:choice,after});
      return after.weaponPresses===1 && after.player.weapon==='axe' && after.meleeApproachTicks>0 && after.meleeApproachTicks<after.actionTicks;
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await check('a controlled distribution fixture executes sampled non-argmax tactic and equipment while preserving the SDK response', `
      const {Agent}=await import('/src/agent.js');let original;const draws=[0.125,0.125];
      const model={info:{model:'synthetic-sampling-fixture'},async decideMany(){
        const r=agent.current,responses=testDecisionReplies(r,{action:'wait',weapon:'w2'});
        const action=responses[0].answers.action;
        action.probabilities[action.choice]=0.75;action.probabilities[r.eligible.find(c=>c.id==='forward').optionId]=0.25;
        const weapon=responses.find(r=>r.answers.weapon).answers.weapon;weapon.probabilities={w1:0.25,w2:0.75};
        original=JSON.stringify(responses);return responses;
      }};
      const agent=new Agent({engine:qev.engine,getModel:()=>model,random:()=>draws.shift()});
      const r=await agent.score();await agent.step();controlTest.sampling=r;
      return r.selected.id==='forward' && r.selected.params.weapon===1 && r.after.player.weapon==='axe' &&
        r.execution.ticksApplied===12 && r.execution.weaponPresses===1 && JSON.stringify(r.responses)===original &&
        r.selected.optionId!==r.responses[0].answers.action.choice && r.selected.weaponSelection.id!==r.selected.weaponSelection.answer.choice &&
        r.sampling.complete && r.sampling.heads.action.draw===0.125 && r.sampling.heads.weapon.draw===0.125 && draws.length===0;
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await check('malformed or contradictory engagement inputs reject without substituting a raw action', `
      const s=qev.engine.snapshot(),ref=s.enemies[0].ref,m=qev.engine.module;
      const values=fields=>qev.engine.commandValues(controlTest.command({ref,fire:true,meleeApproach:true,...fields}));
      for(const fields of [{ref:0},{fire:false},{forward:1},{side:-1},{up:1},{yawRate:90},{pitchRate:30},{jump:true}])
        if(m._qev_command(...values(fields)))throw new Error('Contradictory engagement accepted '+JSON.stringify(fields));
      for(const invalid of [-1,2]) {const args=values({});args[args.length-1]=invalid;if(m._qev_command(...args))throw new Error('Invalid engage flag accepted');}
      return qev.engine.snapshot().actionSerial===s.actionSerial && qev.engine.snapshot().tick===s.tick;
    `);
    await check('screen-space aim can execute a chosen visible target without world targeting/line-of-fire probes', `
      const before=qev.engine.snapshot(), target=before.enemies[0];
      if(!target)throw new Error('No rendered target '+JSON.stringify(before));
      let after=before;
      for(let i=0;i<5 && after.player.ammo===before.player.ammo;i++) {
        await qev.engine.act(controlTest.command({ref:target.ref,fire:true}));after=qev.engine.snapshot();
        if(!after.enemies.some(e=>e.ref===target.ref))break;
      }
      if(after.player.ammo>=before.player.ammo)throw new Error('Pixel aim never fired '+JSON.stringify({before,after}));
      return after.paused && !('distance' in target) && !('position' in target) && !qev.engine.probe;
    `);
    await check('actual nonzero game audio produces bounded stereo captions without source coordinates', `
      const s=qev.engine.snapshot();
      if(!s.audio.available || !s.audio.events.length)throw new Error('Missing mixed-audio cues '+JSON.stringify({audio:s.audio,state:qev.engine.module.SDL2?.audioContext?.state}));
      return s.audio.source==='mixed-sound-captions' && s.audio.events.length<=4 && s.audio.events.every(e=>
        ['left','right','center'].includes(e.direction) && ['quiet','clear'].includes(e.loudness) && e.ageTicks>=0 &&
        Object.keys(e).sort().join(',')==='ageTicks,direction,kind,loudness');
    `);
    await evaluate("qev.engine.loadMap('qev_encounter',0)");
    await check('a real visible death animation ends the chosen attack without retargeting, and stale corpse attacks reject', `
      const {prepareDecision,rankDecision,resolveSelection}=await import('/src/decisions.js');
      const before=qev.engine.snapshot(), target=before.enemies.find(e=>e.kind==='monster_army');
      if(!target || target.pose==='unknown')throw new Error('Pinned rendered animation was not recognized '+JSON.stringify(before));
      controlTest.deathBefore=before;controlTest.deathDecisions=[];
      const session=qev.engine.startAuto();let after, stopped=false;
      for(let i=0;i<8;i++) {
        const r=prepareDecision(qev.engine.snapshot(),null,{realtime:true});
        const entry=r.bindings.aim.find(e=>e.ref===target.ref);
        if(!entry)throw new Error('Fixture lost its selected live target before demonstrating death completion '+JSON.stringify(qev.engine.snapshot()));
        r.responses=testDecisionReplies(r,{action:'engage',aim:entry.id,weapon:'w2'});
        r.selectedIndex=rankDecision(r)[0].index;const choice=resolveSelection(r);
        if(!qev.engine.applyLive(choice.params,session))throw new Error('Live fixture attack rejected');
        await qev.engine.waitFor(s=>!s.actionTicksLeft);
        after=qev.engine.snapshot();controlTest.deathDecisions.push({requests:r.requests,responses:r.responses,selected:choice,after});
        if(after.stopReason==='Chosen enemy is visibly dead or dying.') {
          const fallen=after.enemies.find(e=>e.ref===target.ref);
          if(!fallen || !['death','dead'].includes(fallen.pose) || after.actionTicks>=45 || after.tick-choice.params.tick>60)
            throw new Error('Missing current visible death/completion '+JSON.stringify(after));
          if(qev.engine.applyLive(choice.params,session))throw new Error('An alive-at-scoring target was accepted after visible death');
          stopped=true;break;
        }
      }
      controlTest.deathStopped=after;
      await qev.engine.waitFor(s=>s.viewRecovery.level&&!s.viewRecovery.active);
      controlTest.deathRecovery=qev.engine.snapshot();qev.pause();
      return stopped && after.player.kills>before.player.kills && after.actionTicksLeft===0 &&
        controlTest.deathRecovery.actionSerial===after.actionSerial && controlTest.deathRecovery.actionTicks===after.actionTicks;
    `);
    await check('visible death releases the attack and restores camera level without another model command', `
      const stopped=controlTest.deathStopped,after=controlTest.deathRecovery;
      return after.viewRecovery.level && !after.viewRecovery.active && after.viewRecovery.ticks>0 &&
        !after.actionTicksLeft && after.player.shells===stopped.player.shells;
    `);
    await check('a rendered corpse remains in evidence but cannot be an aimed enemy; raw fire remains explicit', `
      const {prepareDecision}=await import('/src/decisions.js');
      for(let i=0;i<120&&!qev.engine.snapshot().enemies.some(e=>e.pose==='dead');i++)await qev.engine.frame();
      const s=qev.engine.snapshot(), corpse=s.enemies.find(e=>e.pose==='dead'), r=prepareDecision(s);
      if(!corpse)throw new Error('No rendered terminal corpse '+JSON.stringify(s));
      controlTest.corpse=s;controlTest.corpseRequests=r.requests;
      if(r.bindings.aim.length || r.eligible.some(c=>c.id==='attack') || !r.sharedState.includes('dead/corpse'))
        throw new Error('Corpse offered as living enemy '+JSON.stringify(r));
      if(qev.engine.module._qev_command(...qev.engine.commandValues(controlTest.command({ref:corpse.ref,fire:true}))))
        throw new Error('Fresh corpse-directed attack accepted');
      return r.eligible.some(c=>c.id==='fire') && s.enemies.length>0;
    `);
    await onCorpse();
    await check('the actual equipped axe advertises contact-only reach in every request after a real weapon switch', `
      const {prepareDecision}=await import('/src/decisions.js');
      await qev.engine.act(controlTest.command({weapon:1}));const s=qev.engine.snapshot(),r=prepareDecision(s);
      controlTest.axe=s;controlTest.axeRequests=r.requests;
      return s.player.weapon==='axe' && r.requests.every(request=>request.state===r.sharedState &&
        request.state.includes('axe (contact-only melee, not ranged), no ammo needed') && request.state.includes('crosshair not melee contact')) &&
        r.grounding.weapon.criteria.w2.includes('ranged pellets') && r.grounding.weapon.criteria.w1.includes('(held)');
    `);
    await check('every native observation request distinguishes owned inventory from the held axe and visible pickups', `
      const {prepareDecision}=await import('/src/decisions.js');
      const s=qev.engine.snapshot(),r=prepareDecision(s),expected='Owned weapons: '+s.player.weapons.map(w=>w.name).join(', ')+'.';
      return s.player.weapon==='axe' && s.player.weapons.some(w=>w.id===2) &&
        r.requests.every(request=>request.state.includes(expected)&&request.state.includes('held axe')&&request.state.includes('axe last resort'));
    `);
    await check('raw firing remains an explicit input even when the only visible enemy object is a corpse', `
      await qev.engine.act(controlTest.command({fire:true,ticks:1}));
      return qev.engine.snapshot().actionTicks===1;
    `);
    await check('newly chosen visible-target bindings never use a hidden historical contact', `
      const {ObservationMemory}=await import('/src/perception.js'),{prepareDecision}=await import('/src/decisions.js');
      const before=qev.engine.snapshot(), memory=new ObservationMemory();memory.observe(before);
      // Structural adversarial fixture, not a claim this modified snapshot is gameplay.
      const hidden=structuredClone(before);hidden.tick++;hidden.screen.tick++;hidden.screen.frame++;hidden.enemies=[];
      memory.observe(hidden);const r=prepareDecision(hidden,memory.describe(hidden));
      return !r.bindings.aim.some(e=>e.group==='enemy') && r.eligible.every(c=>c.allowed) && !r.navigation;
    `);
    await evaluate("qev.engine.loadMap('lq_e0m6',2)");
    await check('a real double-shotgun pickup updates the full inventory in every next question without rewriting old requests', `
      const {prepareDecision}=await import('/src/decisions.js');
      const before=qev.engine.snapshot(),old=prepareDecision(before),staging=[];
      const oldLine=old.sharedState.split('\\n').find(line=>line.startsWith('Owned weapons:'));
      if(before.player.weapons.some(w=>w.id===3))throw new Error('Fixture must start without the double shotgun');
      for(let i=0;i<18 && qev.engine.snapshot().alive && !qev.engine.snapshot().player.weapons.some(w=>w.id===3);i++) {
        await qev.engine.act(controlTest.command({forward:1}));staging.push(qev.engine.snapshot());
      }
      const after=qev.engine.snapshot(),next=prepareDecision(after);
      controlTest.inventoryPickup={fixture:true,before,oldRequests:old.requests,staging,after,nextRequests:next.requests};
      const expected='Owned weapons: '+after.player.weapons.map(w=>w.name).join(', ')+'.';
      return after.player.weapons.some(w=>w.id===3) && next.requests.every(request=>request.state.includes(expected)) &&
        !!next.grounding.weapon.criteria.w3 && !oldLine.includes('double shotgun') &&
        old.sharedState.split('\\n').find(line=>line.startsWith('Owned weapons:'))===oldLine;
    `);
    return await evaluate(`({fixture:true,purpose:'Real renderer/physics with explicit test choices; not model gameplay or a skill benchmark',
      inventoryPickup:controlTest.inventoryPickup,sampling:controlTest.sampling,engagement:controlTest.engagement,before:controlTest.deathBefore,decisions:controlTest.deathDecisions,stopped:controlTest.deathStopped,
      recovery:controlTest.deathRecovery,corpse:controlTest.corpse,corpseRequests:controlTest.corpseRequests,axe:controlTest.axe,axeRequests:controlTest.axeRequests})`);
  } finally {
    await evaluate("qev.pause();qev.respawner.enabled=controlTest.respawns;delete window.controlTest;qev.engine.loadMap('qev_encounter',0)");
    await until(() => evaluate("qev.engine.snapshot().paused && !qev.agent.busy && !document.querySelector('#reset').disabled"));
  }
}

/** One short independent episode, never a success/completion benchmark. */
export async function runPlayerTrial({ evaluate, until, durationMs = 12000, map = 'lq_e0m6', difficulty = 2 }) {
  await evaluate(`(async()=>{qev.pause();qev.agent.invalidate();await qev.engine.loadMap(${JSON.stringify(map)},${difficulty});
    window.playerTrial={start:qev.engine.snapshot(),records:new Map(),onChange:qev.agent.onChange,respawns:qev.respawner.enabled};
    qev.respawner.enabled=false; qev.agent.onChange=()=>{const r=qev.agent.current;if(r)playerTrial.records.set(r.id,r);playerTrial.onChange();};})()`);
  try {
    await until(() => evaluate("!document.querySelector('#auto').disabled"));
    await evaluate("document.querySelector('#auto').click()");
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      await new Promise(r => setTimeout(r, 200));
      if (await evaluate("qev.engine.snapshot().paused || !qev.engine.snapshot().alive || qev.engine.snapshot().completed")) break;
    }
    await evaluate("qev.pause()"); await until(() => evaluate("!qev.agent.busy"), 30_000);
    return await evaluate(`(()=>{const records=[...playerTrial.records.values()];return {controlMode:qev.controlMode,
      caveat:'One independent short episode, not matched replay, a survival-rate estimate or proof of improved decisions.',
      start:playerTrial.start,end:qev.engine.snapshot(),records,summary:{decisions:records.length,applied:records.filter(r=>r.appliedAt).length,
        choices:records.filter(r=>r.appliedAt).map(r=>r.selected.label),
        weaponChoices:records.filter(r=>r.appliedAt).map(r=>r.selected.weaponSelection?.name??null),
        weaponPresses:records.reduce((sum,r)=>sum+(r.execution?.weaponPresses??0),0),
        meleeApproachTicks:records.reduce((sum,r)=>sum+(r.execution?.meleeApproachTicks??0),0),
        tokenCounts:records.flatMap(r=>r.responses?.map(x=>x.usage?.input_tokens)||[])}}})()`);
  } finally {
    await evaluate("qev.pause();qev.agent.onChange=playerTrial.onChange;qev.respawner.enabled=playerTrial.respawns;delete window.playerTrial");
  }
}
