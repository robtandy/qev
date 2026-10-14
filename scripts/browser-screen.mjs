// Real rendered-frame tests. Called only by the harness that enforces --mute-audio.
// Console render controls below are test-only; no production cheat/probe export.
export async function checkScreen({ evaluate, check, until, pressKeys }) {
  const fresh = async () => {
    await evaluate("qev.pause();document.querySelector('#map').value='qev_encounter';document.querySelector('#difficulty').value='0';document.querySelector('#map').dispatchEvent(new Event('change',{bubbles:true}))");
    await until(() => evaluate("qev.engine.snapshot().ready && qev.engine.snapshot().alive && !document.querySelector('#map').disabled"));
  };
  const key = async letter => { await pressKeys([[letter, 'Key' + letter.toUpperCase(), letter.toUpperCase().charCodeAt(0)]]); await evaluate("qev.engine.frame()"); };
  await evaluate(`window.screenTest={respawns:qev.respawner.enabled};qev.respawner.enabled=false;
    screenTest.command=(fields={})=>{const s=qev.engine.snapshot();return {epoch:s.epoch,tick:s.tick,ref:0,forward:0,side:0,up:0,yawRate:0,pitchRate:0,fire:false,jump:false,weapon:0,ticks:12,...fields};}`);
  try {
    await evaluate(`qev.pause();qev.engine.module.FS.writeFile('/id1/qevscreen.cfg',
      'bind v "fov 120"\\nbind f "fov 90"\\nbind b "r_drawentities 0"\\nbind c "r_drawentities 1"\\nbind g "r_drawflat 1"\\nbind h "r_drawflat 0"\\nbind j "echo score; +showscores"\\nbind k "-showscores"\\nbind l "god"\\n');qev.engine.play()`);
    await pressKeys([[String.fromCharCode(96), 'Backquote', 192]]); await new Promise(r => setTimeout(r, 120));
    const keys = [...'exec qevscreen.cfg'].map(c => [c, c === ' ' ? 'Space' : c === '.' ? 'Period' : 'Key' + c.toUpperCase(), c === ' ' ? 32 : c === '.' ? 190 : c.toUpperCase().charCodeAt(0)]);
    await pressKeys([...keys, ['Enter', 'Enter', 13]]); await new Promise(r => setTimeout(r, 120));
    await pressKeys([[String.fromCharCode(96), 'Backquote', 192]]); await evaluate("qev.pause()");
    await fresh(); await key('l');
    await check('the only native snapshot contains rendered pixels/HUD, without privileged coordinates or legacy exports', `
      const s=qev.engine.snapshot();screenTest.first=s;const m=qev.engine.module;
      if(!s.screen.available || !s.enemies.length)throw new Error(JSON.stringify(s));
      await new Promise(r=>setTimeout(r,120));const now=qev.engine.snapshot();
      return s.version===4 && s.controlMode==='player-observable' && m._qev_screen_version()===3 && m._qev_control_version()===6 &&
        ['_qev_evaluation','_qev_assistance','_qev_probe','_qev_action','_qev_live_action','_qev_input_action','_qev_live_input'].every(k=>!(k in m)) &&
        !('position' in s.player) && !('yaw' in s.player) && !('pitch' in s.player) && !qev.engine.probe && !qev.engine.setAssistance &&
        s.screen.source==='renderer-visible-pixels' && s.screen.tick===s.tick && s.screen.viewport.join(',')==='0,0,640,432' &&
        now.screen.frame===s.screen.frame && now.tick===s.tick &&
        [...s.enemies,...s.pickups,...s.features].every(e=>e.ref>0 && e.screen.pixels>0 &&
          ['distance','range','bearing','elevation','slot','generation','position','health','intent'].every(k=>!(k in e)));
    `);
    await check('visible surface coverage and owned inventory are supplied without walkability/endpoint predictions', `
      const s=qev.engine.snapshot(), {prepareDecision}=await import('/src/decisions.js'), r=prepareDecision(s);
      return s.scene.length===9 && s.scene.every(c=>c.length===8 && c.every(Number.isInteger)) &&
        s.player.weapons.some(w=>w.name==='axe') && s.player.weapons.some(w=>w.name==='shotgun') &&
        r.sharedState.includes('Lower view:') && r.sharedState.includes('Not a safe-route test') &&
        r.eligible.every(c=>c.allowed && !c.geometry && !c.route) && r.bindings.aim.length>0 && !!r.grounding.weapon;
    `);
    await key('v');
    await check('widening rendered FOV changes apparent target size without measuring world distance', `
      const a=screenTest.first.enemies.find(e=>e.kind==='monster_army'), s=qev.engine.snapshot(), b=s.enemies.find(e=>e.kind==='monster_army');
      if(!b || (b.screen.bounds[3]-b.screen.bounds[1])>=(a.screen.bounds[3]-a.screen.bounds[1])*0.85)throw new Error(JSON.stringify({a,b,s}));
      return s.screen.available && s.screen.frame>screenTest.first.screen.frame && s.tick-screenTest.first.tick===1 && b.screen.pixels<a.screen.pixels;
    `);
    await key('f'); await key('b');
    await check('not-drawn actors provide no perception or target capability even though they still exist in the level', `
      const s=qev.engine.snapshot(), old=screenTest.first.enemies[0].ref;
      return s.screen.available && s.enemies.length===0 && s.pickups.length===0 &&
        !qev.engine.module._qev_command(...qev.engine.commandValues(screenTest.command({ref:old}))) && s.scene.length===9;
    `);
    await key('c');
    await check('seeing a contact again produces a new capability, never through-wall reacquisition by an old command', `
      const s=qev.engine.snapshot();screenTest.restored=s;
      return s.screen.available && s.enemies.length>0 && s.enemies[0].ref!==screenTest.first.enemies[0].ref &&
        s.enemies.every(e=>typeof e.screen.aimOverlap==='boolean' && e.screen.pixels>0 && e.screen.sameKindCount>=1);
    `);
    await evaluate(`screenTest.session=qev.engine.startAuto();screenTest.target=qev.engine.snapshot().enemies[0].ref;
      if(!qev.engine.applyLive(screenTest.command({ref:screenTest.target,ticks:45}),screenTest.session))throw new Error('Visible target command rejected');`);
    await pressKeys([['b','KeyB',66]]);
    await until(() => evaluate("qev.engine.snapshot().actionTicksLeft===0"));
    await check('loss of actual visible pixels releases a held targeted command without changing targets or pausing the world', `
      const s=qev.engine.snapshot();qev.pause();
      return !s.paused && s.stopReason==='Chosen contact is no longer visible.' && s.enemies.length===0 && s.actionTicks<45;
    `);
    await key('c'); await key('j');
    await check('covered scoreboard views abstain instead of supplying entities behind the overlay', `
      const s=qev.engine.snapshot();return !s.screen.available && s.screen.reason==='Player view covered' && !s.enemies.length && !s.scene.length;
    `);
    await key('k'); await key('g');
    await check('unsupported debug rendering fails closed while leaving neutral/raw tactics available', `
      const s=qev.engine.snapshot(), {prepareDecision}=await import('/src/decisions.js'), r=prepareDecision(s);
      return !s.screen.available && /Unsupported debug render/.test(s.screen.reason) && !s.enemies.length &&
        !r.bindings.aim.length && r.eligible.some(c=>c.id==='fire') && r.eligible.some(c=>c.id==='jump') && r.sharedState.includes('View unavailable');
    `);
    await key('h'); await fresh(); await key('l');
    await evaluate("(async()=>{for(let i=0;i<2;i++)await qev.engine.act(screenTest.command({yawRate:180,pitchRate:45}));})()");
    await check('brush pickups also have actual drawn extents rather than projected world-space boxes', `
      const s=qev.engine.snapshot();if(!s.pickups.some(e=>e.kind==='health' && e.screen.pixels>0))throw new Error(JSON.stringify(s));
      return s.screen.available && s.pickups.every(e=>e.screen.bounds.length===4 && !('range' in e));
    `);
  } finally {
    await evaluate("qev.pause()"); for (const letter of ['f','c','h','k']) await key(letter);
    await fresh();
    await evaluate("qev.engine.module.FS.unlink('/id1/qevscreen.cfg');qev.respawner.enabled=screenTest.respawns;qev.agent.invalidate();delete window.screenTest;document.activeElement.blur()");
  }
}

/** Synthetic text-budget checks only. They never execute or masquerade as gameplay. */
export async function checkScreenModel({ evaluate, check }) {
  const report = await evaluate(`(async()=>{
    const {prepareDecision}=await import('/src/decisions.js'), {WEAPONS}=await import('/src/perception.js');
    let ref=0;const object=kind=>({kind,ref:++ref,visible:true,pose:'attack',screen:{bounds:[0,0,0.9123,0.8345],pixels:12345,aimOverlap:ref===1,clipped:true,sameKindCount:1}});
    const s={ready:true,alive:true,completed:false,epoch:1,tick:10,
      screen:{source:'renderer-visible-pixels',available:true,frame:10,tick:10,viewport:[0,0,640,432],distorted:false},
      player:{health:123,armor:200,ammo:125,weapon:'double shotgun',silverKey:true,goldKey:true,grounded:true,inWater:true,
        shells:125,nails:200,rockets:50,cells:100,powerups:{quad:true,suit:true},weapons:WEAPONS.map((name,i)=>({id:i+1,name}))},
      enemies:['monster_army','monster_shalrath','monster_enforcer','monster_shambler','monster_hell_knight','monster_ogre'].map(object),
      pickups:['weapon_supershotgun','weapon_supernailgun','gold_key','silver_key','mega_health','item_artifact_invulnerability'].map(object),
      features:Array.from({length:6},()=>object('projectile')),
      scene:Array.from({length:9},()=>[10000,10000,0,0,0,0,2000,0]),
      audio:{source:'mixed-sound-captions',available:true,events:[{kind:'weapon',direction:'left',loudness:'clear',ageTicks:0},{kind:'creature_or_effect',direction:'right',loudness:'quiet',ageTicks:80}]}};
    const memory={pastSightings:[{kind:'monster_zombie',side:'right',ageTicks:180}],actions:[{action:'Aim and attack moving right · e1 grunt',actionId:'right-fire',healthChange:-32,ammoChange:-12}],repeated:6};
    const variants=[];
    for(const [variant,patch] of [
      ['loaded',{}],
      ['empty',{weapon:'axe',ammo:0,shells:0,nails:0,rockets:0,cells:0}],
      ['one-round',{weapon:'shotgun',ammo:1,shells:1,nails:1,rockets:1,cells:1}],
      ['axe-with-loaded-guns',{weapon:'axe',ammo:0}],
    ]) {
      const snapshot=structuredClone(s);Object.assign(snapshot.player,patch);
      const prepared=prepareDecision(snapshot,memory,{realtime:true,heldAction:'right-fire'});
      if(!prepared.requests.every(r=>{const names=r.state.split('Owned weapons: ')[1]?.split('.')[0].split(', ');
        return names?.length===WEAPONS.length && WEAPONS.every(name=>names.includes(name));}))
        throw new Error('A question lost part of the owned inventory');
      const responses=await qev.model.decideMany(prepared.requests);
      const heads=prepared.requests.map(request=>({...request,state:''}));
      const headResponses=await qev.model.decideMany(heads), probes=[], names=[];
      heads.forEach((request,index)=>{
        const [name,question]=Object.entries(request.questions)[0];
        for(const key of [null,...Object.keys(question.criteria)]) {
          const copy=structuredClone(request);
          if(key===null)copy.questions[name].instructions+=' zebra';else copy.questions[name].criteria[key]+=' zebra';
          probes.push(copy);names.push({variant,index,question:name,field:key??'instructions'});
        }
      });
      const probeResponses=await qev.model.decideMany(probes);
      const headCanaries=names.map((name,i)=>({...name,before:headResponses[name.index].usage.input_tokens,after:probeResponses[i].usage.input_tokens}));
      variants.push({variant,requests:prepared.requests,responses,headCanaries});
    }
    return {synthetic:true,purpose:'Crowded 18-object/full-inventory budgets, ammunition edge cases and head truncation canaries; not gameplay or accuracy evidence',
      requests:variants[0].requests,responses:variants[0].responses,headCanaries:variants.flatMap(v=>v.headCanaries),variants};
  })()`);
  await check('text-budget probing leaves the game stopped', `return qev.engine.snapshot().paused && !qev.agent.busy;`);
  for (const variant of report.variants) {
    const tokens = variant.responses.map(r => r.usage?.input_tokens);
    if (tokens.some(n => !Number.isFinite(n) || n >= 512)) throw new Error(`Crowded ${variant.variant} questions reached Laya's input limit: ${tokens.join(', ')}; state: ${variant.requests[0].state}`);
    console.log(`PASS crowded full-inventory ${variant.variant} questions fit Laya (${tokens.join(', ')} tokens)`);
  }
  if (report.headCanaries.some(c => c.after <= c.before)) throw new Error(`Question head may truncate: ${JSON.stringify(report.headCanaries.filter(c=>c.after<=c.before))}`);
  console.log(`PASS all ${report.headCanaries.length} full-inventory head/option canaries remain readable`);
  return report;
}
