// game-engine.js — core gameplay loop, HUD, bots, online sync
import { Store, genCode, myClientId } from './store.js';
import { Nav, notify } from './nav.js';
import { buildCharacterMesh, charStats, defaultCharData, CharOptions } from './character-builder.js';
import { buildTerrainScene, objectMeshFactory, placeObjectsInScene, weatherParticles, updateWeatherParticles, WEAPON_PRESETS, resolveWeapon, makeWeaponMesh } from './terrain-builder.js';
import { preloadAssets } from './parts.js';

const GameEngine = (()=>{
  let scene, camera, renderer, heightFn, biome, worldData, clock, raycaster;
  let player, playerMesh, crates=[], spawns=[], weatherFx=null, assetsMap={}, obstacleMeshes=[];
  let bots=[], remotePlayers={}; // clientId -> {mesh,data,targetPos,hp,alive}
  let mode='solo', running=false, rafId=null, pollTimer=null, lastPollWrite=0;
  let roomCode=null, isHost=false, lastHitProcessed=0;
  let input = { move:{x:0,y:0}, jump:false, fire:false, crouch:false };
  let aiming=false, recoilPitch=0, muzzleLight=null;
  let killFeedTimer=null;

  function _resetState(){
    bots=[]; remotePlayers={}; crates=[]; spawns=[]; obstacleMeshes=[]; roomCode=null; isHost=false; lastHitProcessed=0;
    aiming=false; recoilPitch=0;
    if(pollTimer) clearInterval(pollTimer); pollTimer=null;
    if(rafId) cancelAnimationFrame(rafId); rafId=null;
    document.getElementById('killFeed').innerHTML='';
    document.getElementById('adsBtn').classList.remove('on');
    document.getElementById('crouchBtn').classList.remove('on');
  }

  async function _buildScene(wd){
    while(scene.children.length) scene.remove(scene.children[0]);
    const t = buildTerrainScene(wd, scene);
    heightFn = t.heightFn; biome = t.biome; worldData = wd;
    weatherFx = weatherParticles(scene, wd.weather, wd.size||110);
    const ids = [];
    wd.objects.forEach(o=>{
      if(o.assetId) ids.push(o.assetId);
      if(o.type==='crate' && o.weaponId && !WEAPON_PRESETS[o.weaponId]) ids.push(o.weaponId);
    });
    assetsMap = await preloadAssets(ids);
    const group = new THREE.Group();
    wd.objects.forEach(o=>{
      if(o.type==='spawn'){ spawns.push(o); return; }
      const m = objectMeshFactory(o, biome, assetsMap);
      m.position.set(o.x, heightFn(o.x,o.z), o.z);
      if(o.type==='crate'){ m.userData.weaponId = o.weaponId||'easy'; crates.push(m); }
      if(o.type==='tree' || o.type==='rock' || o.type==='mountain' || o.type==='bush') obstacleMeshes.push(m);
      group.add(m);
    });
    scene.add(group);
    if(spawns.length===0) spawns.push({x:0,z:0});
  }

  function _spawnPoint(idx){
    const s = spawns[idx % spawns.length];
    const jitter = idx>0 ? 3:0;
    const x = s.x + (Math.random()-.5)*jitter, z = s.z + (Math.random()-.5)*jitter;
    return new THREE.Vector3(x, heightFn(x,z), z);
  }

  function _initThree(){
    const cv = document.getElementById('game-cv');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.1, 500);
    renderer = new THREE.WebGLRenderer({canvas:cv, antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();
    function resize(){ renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize);
  }

  function _spawnPlayer(charData, idx){
    const stats = charStats(charData);
    playerMesh = buildCharacterMesh(charData);
    const pos = _spawnPoint(idx);
    playerMesh.position.copy(pos);
    scene.add(playerMesh);
    player = {
      data:charData, pos, vy:0, onGround:true, facing:0,
      hp: stats.hp, maxHp: stats.hp, speed: 2.2 + stats.speed/100*2.4, armor:stats.armor,
      weaponData: Object.assign({id:'fists'}, WEAPON_PRESETS.fists), lastFire:0, alive:true
    };
    _attachWeapon(playerMesh, 'fists');
    document.getElementById('hpName').textContent = charData.name;
  }

  /* ---------------- weapon attachment ---------------- */
  function _attachWeapon(mesh, weaponId){
    if(!mesh || !mesh.userData.weaponSocket) return;
    const socket = mesh.userData.weaponSocket;
    while(socket.children.length) socket.remove(socket.children[0]);
    const wm = makeWeaponMesh(weaponId);
    if(wm) socket.add(wm);
    mesh.userData.currentWeaponId = weaponId;
  }

  /* ---------------- procedural limb animation (walk / jump / fire / crouch) ---------------- */
  function _animateCharacter(mesh, dt, opts){
    const limbs = mesh.userData.limbs;
    if(!limbs) return; // custom (mold-built) bodies have no rig — skip safely
    const moving = !!opts.moving, onGround = opts.onGround!==false, crouching = !!opts.crouching;
    const spdF = opts.speedFactor||1;
    mesh.userData.walkPhase = (mesh.userData.walkPhase||0) + dt * (moving ? 8*spdF : 3.2);
    const phase = mesh.userData.walkPhase;
    const amp = crouching ? 0.28 : 0.55;
    const legSwing = moving ? Math.sin(phase)*amp : Math.sin(phase)*0.045;
    let targetLegL = legSwing, targetLegR = -legSwing;
    let targetArmL = moving ? -legSwing*0.6 : Math.sin(phase*0.5)*0.03;
    let targetArmR = opts.armed ? -1.15 : (moving ? legSwing*0.6 : -Math.sin(phase*0.5)*0.03);
    if(!onGround){
      targetLegL = -0.5; targetLegR = -0.32; targetArmL = -0.35;
    }
    mesh.userData.fireKick = Math.max(0, (mesh.userData.fireKick||0) - dt*6);
    if(mesh.userData.fireKick>0) targetArmR -= mesh.userData.fireKick*0.35;

    // smooth (lerp) toward target angles instead of snapping — avoids jittery transitions
    const k = Math.min(1, dt*14);
    limbs.legPivotL.rotation.x += (targetLegL - limbs.legPivotL.rotation.x)*k;
    limbs.legPivotR.rotation.x += (targetLegR - limbs.legPivotR.rotation.x)*k;
    limbs.armPivotL.rotation.x += (targetArmL - limbs.armPivotL.rotation.x)*k;
    limbs.armPivotR.rotation.x += (targetArmR - limbs.armPivotR.rotation.x)*k;

    // slight forward torso lean while sprinting — purely rotational, safe to lerp every frame
    const targetLean = moving && onGround ? -0.08*spdF : 0;
    limbs.torso.rotation.x += (targetLean - limbs.torso.rotation.x)*k;

    // crouch: compress the whole rig height smoothly
    const targetScaleY = crouching ? 0.8 : 1;
    mesh.scale.y += (targetScaleY - mesh.scale.y)*k;
  }

  /* ---------------- bullet tracer ---------------- */
  function _spawnTracer(start, end){
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if(len < 0.05 || !scene) return;
    const geo = new THREE.CylinderGeometry(0.014,0.014,len,5);
    const mat = new THREE.MeshBasicMaterial({color:0xfff2b0, transparent:true, opacity:0.9});
    const tracer = new THREE.Mesh(geo, mat);
    tracer.position.copy(start).addScaledVector(dir, 0.5);
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
    scene.add(tracer);
    const startT = performance.now();
    (function fade(){
      const t = (performance.now()-startT)/90;
      if(t>=1 || !scene){ scene && scene.remove(tracer); tracer.geometry.dispose(); tracer.material.dispose(); return; }
      tracer.material.opacity = 0.9*(1-t);
      requestAnimationFrame(fade);
    })();
  }

  /* ---------------- input ---------------- */
  function _setupInput(){
    const joyZone=document.getElementById('joyZone'), joyKnob=document.getElementById('joyKnob');
    let joyActive=false, joyStart={x:0,y:0};
    function joyDown(e){ joyActive=true; const t=e.touches?e.touches[0]:e; joyStart={x:t.clientX,y:t.clientY}; }
    function joyMove(e){
      if(!joyActive) return;
      const t=e.touches?e.touches[0]:e;
      let dx=t.clientX-joyStart.x, dy=t.clientY-joyStart.y;
      const d=Math.hypot(dx,dy), max=42;
      if(d>max){ dx=dx/d*max; dy=dy/d*max; }
      joyKnob.style.left=(33+dx)+'px'; joyKnob.style.top=(33+dy)+'px';
      input.move.x = dx/max; input.move.y = dy/max;
    }
    function joyUp(){ joyActive=false; joyKnob.style.left='33px'; joyKnob.style.top='33px'; input.move.x=0; input.move.y=0; }
    joyZone.addEventListener('touchstart', joyDown, {passive:true});
    joyZone.addEventListener('touchmove', joyMove, {passive:true});
    joyZone.addEventListener('touchend', joyUp);
    joyZone.addEventListener('mousedown', joyDown);
    window.addEventListener('mousemove', joyMove);
    window.addEventListener('mouseup', joyUp);

    const keys={};
    window.addEventListener('keydown', e=>{ keys[e.key.toLowerCase()]=true; });
    window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });
    GameEngine._keys = keys;

    document.getElementById('jumpBtn').addEventListener('click', ()=>{ input.jump=true; });
    const fireBtn = document.getElementById('fireBtn');
    fireBtn.addEventListener('touchstart', e=>{ input.fire=true; e.preventDefault(); }, {passive:false});
    fireBtn.addEventListener('touchend', ()=>{ input.fire=false; });
    fireBtn.addEventListener('mousedown', ()=>{ input.fire=true; });
    fireBtn.addEventListener('mouseup', ()=>{ input.fire=false; });
    window.addEventListener('keydown', e=>{ if(e.key===' ') input.jump=true; if(e.key.toLowerCase()==='f') input.fire=true; });
    window.addEventListener('keyup', e=>{ if(e.key.toLowerCase()==='f') input.fire=false; });

    const adsBtn = document.getElementById('adsBtn');
    adsBtn.addEventListener('click', ()=>{ aiming=!aiming; adsBtn.classList.toggle('on', aiming); });

    const crouchBtn = document.getElementById('crouchBtn');
    crouchBtn.addEventListener('click', ()=>{ input.crouch=!input.crouch; crouchBtn.classList.toggle('on', input.crouch); });
    window.addEventListener('keydown', e=>{ if(e.key.toLowerCase()==='c'){ input.crouch=!input.crouch; crouchBtn.classList.toggle('on', input.crouch); } });

    document.getElementById('exitBtn').onclick = stop;
  }

  function _readMoveVector(){
    let mx=input.move.x, my=input.move.y;
    const k = GameEngine._keys||{};
    if(k['w']||k['arrowup']) my=-1;
    if(k['s']||k['arrowdown']) my=1;
    if(k['a']||k['arrowleft']) mx=-1;
    if(k['d']||k['arrowright']) mx=1;
    return {x:mx,y:my};
  }

  /* ---------------- kill feed ---------------- */
  function killFeed(msg){
    const el = document.getElementById('killFeed');
    const d = document.createElement('div'); d.className='killMsg'; d.textContent=msg;
    el.appendChild(d);
    setTimeout(()=>{ d.remove(); }, 3500);
  }

  /* ---------------- HUD ---------------- */
  function updateHUD(){
    const pct = Math.max(0, player.hp/player.maxHp*100);
    document.getElementById('hpBarFill').style.width = pct+'%';
    document.getElementById('hpBarFill').style.background = pct<30 ? 'linear-gradient(90deg,#ef4444,#f59e0b)' : 'linear-gradient(90deg,#10b981,#4ade80)';
    document.getElementById('hpNum').textContent = Math.max(0,Math.round(player.hp))+'/'+player.maxHp;
    const w = player.weaponData || WEAPON_PRESETS.fists;
    document.getElementById('weaponLine').textContent = (w.icon||'🔫')+' '+w.name;
    if(mode==='bots'){
      const alive = bots.filter(b=>b.alive).length;
      document.getElementById('playersLeft').textContent = 'الأعداء المتبقون: '+alive;
    } else if(mode==='online'){
      const aliveOthers = Object.values(remotePlayers).filter(r=>r.data && r.data.alive!==false).length;
      document.getElementById('playersLeft').textContent = 'اللاعبون: '+(1+aliveOthers);
    } else {
      document.getElementById('playersLeft').textContent = 'وضع تجربة حرة';
    }
  }

  /* ---------------- crate pickup ---------------- */
  function _checkCrates(){
    crates = crates.filter(c=>{
      if(c.position.distanceTo(player.pos) < 1.6){
        player.weaponData = resolveWeapon(c.userData.weaponId, assetsMap);
        _attachWeapon(playerMesh, player.weaponData.id);
        scene.remove(c);
        notify('✅ التقطت: '+player.weaponData.name);
        return false;
      }
      return true;
    });
  }

  /* ---------------- combat: real crosshair raycast, PUBG-style ---------------- */
  function _muzzleFlash(){
    if(!muzzleLight){ muzzleLight = new THREE.PointLight(0xffcc66, 0, 6); scene.add(muzzleLight); }
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    muzzleLight.position.copy(camera.position).addScaledVector(dir, 0.6);
    muzzleLight.intensity = 3.2;
    clearTimeout(_muzzleFlash._t);
    _muzzleFlash._t = setTimeout(()=>{ if(muzzleLight) muzzleLight.intensity = 0; }, 65);
  }
  function _showHitMarker(isHead){
    const hm = document.getElementById('hitMarker');
    hm.style.color = isHead ? '#f59e0b' : '#ef4444';
    hm.textContent = isHead ? '✕ هيدشوت' : '✕';
    hm.style.opacity = 1;
    clearTimeout(_showHitMarker._t);
    _showHitMarker._t = setTimeout(()=>{ hm.style.opacity = 0; }, 200);
  }
  function _tryFire(now){
    const w = player.weaponData || WEAPON_PRESETS.fists;
    if(now - player.lastFire < w.cooldown) return;
    player.lastFire = now;
    recoilPitch = Math.min(recoilPitch + (w.recoil!=null?w.recoil:3)*0.018, 0.3);
    _muzzleFlash();
    if(playerMesh) playerMesh.userData.fireKick = 1;

    raycaster.setFromCamera({x:0,y:0}, camera);
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const muzzleWorld = new THREE.Vector3();
    if(playerMesh && playerMesh.userData.weaponSocket){
      playerMesh.updateMatrixWorld(true);
      playerMesh.userData.weaponSocket.getWorldPosition(muzzleWorld);
    } else muzzleWorld.copy(camera.position);

    let targetMeshes = [];
    if(mode==='bots') targetMeshes = bots.filter(b=>b.alive).map(b=>b.mesh);
    if(mode==='online') targetMeshes = Object.values(remotePlayers).filter(r=>r.data && r.data.alive!==false).map(r=>r.mesh);

    let hit = null;
    if(targetMeshes.length){
      const hits = raycaster.intersectObjects(targetMeshes, true);
      hit = hits.find(h=>h.distance <= w.range) || null;
    }
    const endPoint = hit ? hit.point.clone() : camera.position.clone().addScaledVector(dir, w.range);
    _spawnTracer(muzzleWorld, endPoint);
    if(!hit) return;

    const isHead = !!hit.object.userData.isHead;
    const dmg = isHead ? Math.round(w.dmg*2) : w.dmg;
    let owner = hit.object;
    while(owner.parent && owner.parent !== scene) owner = owner.parent;
    _showHitMarker(isHead);

    if(mode==='bots'){
      const bot = bots.find(b=>b.mesh===owner);
      if(bot && bot.alive){
        bot.hp -= dmg;
        if(bot.hp<=0){
          bot.alive=false; scene.remove(bot.mesh);
          killFeed('☠️ '+player.data.name+' أقصى '+bot.name+(isHead?' 🎯 هيدشوت':''));
          if(bots.every(b=>!b.alive)) _win();
        }
      }
    } else if(mode==='online'){
      const entry = Object.entries(remotePlayers).find(([id,r])=>r.mesh===owner);
      if(entry){
        const [id] = entry;
        Store.set('room:'+roomCode+':hit:'+id, {dmg, from:myClientId(), ts:Date.now(), head:isHead}, true);
      }
    }
  }

  /* ---------------- perception helpers (used by bot AI) ---------------- */
  function _hasLineOfSight(fromPos, toPos){
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    if(dist < 0.15) return true;
    dir.normalize();
    raycaster.set(fromPos, dir);
    raycaster.far = dist - 0.3;
    const hits = obstacleMeshes.length ? raycaster.intersectObjects(obstacleMeshes, true) : [];
    raycaster.far = Infinity;
    return hits.length===0;
  }
  function _nearestCover(fromPos, awayFromPos){
    let best=null, bestScore=-Infinity;
    obstacleMeshes.forEach(m=>{
      const d = m.position.distanceTo(fromPos);
      if(d>16) return;
      const behindDir = m.position.clone().sub(awayFromPos).normalize();
      const score = -d + behindDir.dot(m.position.clone().sub(fromPos).normalize())*3;
      if(score>bestScore){ bestScore=score; best=m.position; }
    });
    return best;
  }
  function _nearestCrate(fromPos){
    let best=null, bestD=Infinity;
    crates.forEach(c=>{
      const d = c.position.distanceTo(fromPos);
      if(d<bestD){ bestD=d; best=c; }
    });
    return best;
  }

  /* ---------------- bots AI ---------------- */
  function _spawnBots(n){
    const names=['Vex','Raze','Nyx','Kade','Zoro','Frost','Talon','Onyx'];
    for(let i=0;i<n;i++){
      const cd = Object.assign(defaultCharData(), {
        skin: CharOptions.skin[Math.floor(Math.random()*CharOptions.skin.length)],
        outfitColor: CharOptions.outfitColor[Math.floor(Math.random()*CharOptions.outfitColor.length)],
        outfit: CharOptions.outfit[Math.floor(Math.random()*CharOptions.outfit.length)],
        name: names[i%names.length]+'-'+(i+1)
      });
      const mesh = buildCharacterMesh(cd);
      const pos = _spawnPoint(i+1);
      mesh.position.copy(pos);
      scene.add(mesh);
      _attachWeapon(mesh, 'easy');
      bots.push({ id:'bot'+i, mesh, name:cd.name, hp:90, maxHp:90, alive:true, facing:0, lastFire:0,
        wanderDir:Math.random()*Math.PI*2, wanderT:0, state:'wander', lastSeenPos:null });
    }
  }
  function _updateBots(delta,now){
    bots.forEach(b=>{
      if(!b.alive) return;
      const eyeB = b.mesh.position.clone().add(new THREE.Vector3(0,1.5,0));
      const eyeP = player.pos.clone().add(new THREE.Vector3(0,1.4,0));
      const toPlayer = player.pos.clone().sub(b.mesh.position); toPlayer.y=0;
      const dist = toPlayer.length();
      const canSense = player.alive && dist < 24;
      const hasLOS = canSense && _hasLineOfSight(eyeB, eyeP);
      if(hasLOS) b.lastSeenPos = player.pos.clone();
      const lowHp = b.hp < b.maxHp*0.35;
      let moveDir=null, spdMul=1;

      if(lowHp && hasLOS && dist < 14){
        b.state='flee';
        const cover = _nearestCover(b.mesh.position, player.pos);
        const away = toPlayer.clone().negate();
        const to = cover ? cover.clone().sub(b.mesh.position) : away;
        to.y=0;
        if(to.length()>0.4) moveDir = to.normalize();
        spdMul = 1.3;
      } else if(hasLOS && dist>3.5 && dist<20){
        b.state='chase';
        moveDir = toPlayer.normalize();
      } else if(hasLOS && dist<=3.5){
        b.state='attack';
        if(now - b.lastFire > 1300){
          b.lastFire = now;
          b.mesh.userData.fireKick = 1;
          const muzzle = new THREE.Vector3();
          if(b.mesh.userData.weaponSocket){
            b.mesh.updateMatrixWorld(true);
            b.mesh.userData.weaponSocket.getWorldPosition(muzzle);
          } else muzzle.copy(b.mesh.position).add(new THREE.Vector3(0,1.3,0));
          const target = player.pos.clone().add(new THREE.Vector3(0,1.3,0));
          _spawnTracer(muzzle, target);
          if(Math.random()<0.7){
            player.hp -= 8 + Math.random()*7;
            killFeed(b.name+' أصاب '+player.data.name);
            if(player.hp<=0 && player.alive) _die();
            updateHUD();
          }
        }
      } else {
        const nearCrate = _nearestCrate(b.mesh.position);
        const wantsWeapon = b.mesh.userData.currentWeaponId==='easy';
        if(wantsWeapon && nearCrate && nearCrate.position.distanceTo(b.mesh.position) < 18){
          b.state='seekWeapon';
          const to = nearCrate.position.clone().sub(b.mesh.position); to.y=0;
          if(to.length() < 1.4){
            const wid = nearCrate.userData.weaponId||'easy';
            _attachWeapon(b.mesh, wid);
            crates = crates.filter(c=>c!==nearCrate);
            scene.remove(nearCrate);
          } else moveDir = to.normalize();
        } else if(b.lastSeenPos && b.mesh.position.distanceTo(b.lastSeenPos) > 1.5){
          b.state='investigate';
          const to = b.lastSeenPos.clone().sub(b.mesh.position); to.y=0;
          if(to.length()>0.1) moveDir = to.normalize();
        } else {
          b.state='wander';
          b.wanderT -= delta;
          if(b.wanderT<=0){ b.wanderDir = Math.random()*Math.PI*2; b.wanderT = 2+Math.random()*3; }
          moveDir = new THREE.Vector3(Math.sin(b.wanderDir),0,Math.cos(b.wanderDir));
        }
      }
      if(moveDir){
        const spd = 2.6*spdMul*delta;
        b.mesh.position.x += moveDir.x*spd;
        b.mesh.position.z += moveDir.z*spd;
        b.mesh.position.y = heightFn(b.mesh.position.x, b.mesh.position.z);
        b.facing = Math.atan2(moveDir.x, moveDir.z);
        b.mesh.rotation.y = b.facing;
      }
      _animateCharacter(b.mesh, delta, { moving:!!moveDir, onGround:true, speedFactor: spdMul, armed:true });
    });
  }

  /* ---------------- online sync ---------------- */
  async function _pollOnline(){
    try{
      const now = Date.now();
      if(now-lastPollWrite > 650){
        lastPollWrite = now;
        await Store.set('room:'+roomCode+':player:'+myClientId(), {
          name: player.data.name, charData: player.data,
          x:player.pos.x, y:player.pos.y, z:player.pos.z, ry:player.facing,
          hp:player.hp, alive:player.alive, weaponId: player.weaponData ? player.weaponData.id : 'fists', ts:now
        }, true);
      }
      const keys = await Store.list('room:'+roomCode+':player:', true);
      for(const k of keys){
        const id = k.split(':player:')[1];
        if(id===myClientId()) continue;
        const r = await Store.get(k, true);
        if(!r) continue;
        if(!remotePlayers[id]){
          const mesh = buildCharacterMesh(r.charData||defaultCharData());
          scene.add(mesh);
          _attachWeapon(mesh, r.weaponId||'easy');
          remotePlayers[id] = { mesh, data:r, moving:false };
        }
        const rp = remotePlayers[id];
        if(r.weaponId && r.weaponId !== (rp.data&&rp.data.weaponId)) _attachWeapon(rp.mesh, r.weaponId);
        const movedDist = rp.mesh.position.distanceTo(new THREE.Vector3(r.x,r.y,r.z));
        rp.moving = movedDist > 0.03;
        rp.data = r;
        rp.mesh.position.lerp(new THREE.Vector3(r.x,r.y,r.z), 0.5);
        rp.mesh.rotation.y = r.ry||0;
        if(r.alive===false) rp.mesh.visible=false;
      }
      const hitKey = 'room:'+roomCode+':hit:'+myClientId();
      const hit = await Store.get(hitKey, true);
      if(hit && hit.ts > lastHitProcessed){
        lastHitProcessed = hit.ts;
        player.hp -= hit.dmg;
        killFeed(hit.head ? 'أصابك خصمك في الرأس! 🎯' : 'أصابك خصمك!');
        if(player.hp<=0 && player.alive) _die();
        updateHUD();
      }
      if(mode==='online' && player.alive){
        const others = Object.values(remotePlayers);
        if(others.length>0 && others.every(o=>o.data.alive===false)) _win();
      }
    }catch(e){ console.error('poll error', e); }
  }

  /* ---------------- win / death ---------------- */
  function _die(){
    player.alive=false;
    document.getElementById('overlay-death').classList.remove('hidden');
  }
  function _win(){
    document.getElementById('win-sub').textContent = 'أنت آخر الناجين!';
    document.getElementById('overlay-win').classList.remove('hidden');
  }

  /* ---------------- main loop ---------------- */
  function _tick(){
    if(!running) return;
    rafId = requestAnimationFrame(_tick);
    const delta = Math.min(clock.getDelta(), 0.05);
    const now = Date.now();

    if(player.alive){
      const mv = _readMoveVector();
      const isMoving = Math.abs(mv.x)>0.05 || Math.abs(mv.y)>0.05;
      const crouching = input.crouch && player.onGround;
      if(isMoving){
        const camAngle = playerCamYaw;
        const worldX = mv.x*Math.cos(camAngle) + mv.y*Math.sin(camAngle);
        const worldZ = -mv.x*Math.sin(camAngle) + mv.y*Math.cos(camAngle);
        const len = Math.hypot(worldX,worldZ)||1;
        const dx = worldX/len, dz = worldZ/len;
        const spd = player.speed * (crouching ? 0.45 : (aiming ? 0.5 : 1));
        player.pos.x += dx*spd*delta;
        player.pos.z += dz*spd*delta;
        player.facing = Math.atan2(dx,dz);
      }
      if(input.jump && crouching) input.jump = false;
      if(input.jump && player.onGround){ player.vy = 5.4; player.onGround=false; input.jump=false; }
      player.vy -= 14*delta;
      player.pos.y += player.vy*delta;
      const groundY = heightFn(player.pos.x, player.pos.z);
      if(player.pos.y <= groundY){ player.pos.y = groundY; player.vy=0; player.onGround=true; }

      playerMesh.position.copy(player.pos);
      playerMesh.rotation.y = player.facing;
      _animateCharacter(playerMesh, delta, {
        moving:isMoving, onGround:player.onGround, speedFactor: aiming?0.6:1, crouching,
        armed: player.weaponData && player.weaponData.id!=='fists'
      });

      if(input.fire) _tryFire(now);
      _checkCrates();
    }

    if(mode==='bots') _updateBots(delta, now);
    if(mode==='online'){
      Object.values(remotePlayers).forEach(rp=>{
        _animateCharacter(rp.mesh, delta, { moving:!!rp.moving, onGround:true, speedFactor:1, armed:true });
      });
    }
    updateWeatherParticles(weatherFx, delta);
    recoilPitch = Math.max(0, recoilPitch - delta*0.7);

    // chase camera behind player, zooms in when aiming (ADS), lowers slightly when crouching
    const crouchNow = input.crouch && player.onGround;
    const camDist = aiming ? 3.0 : 5.2, camHeight = (aiming ? 2.2 : 2.6) - (crouchNow?0.4:0);
    const targetFov = aiming ? 40 : 62;
    if(Math.abs(camera.fov-targetFov) > 0.3){ camera.fov += (targetFov-camera.fov)*0.15; camera.updateProjectionMatrix(); }
    const behindX = player.pos.x - Math.sin(player.facing)*camDist;
    const behindZ = player.pos.z - Math.cos(player.facing)*camDist;
    const desired = new THREE.Vector3(behindX, player.pos.y+camHeight, behindZ);
    camera.position.lerp(desired, aiming ? 0.22 : 0.12);
    camera.lookAt(player.pos.x, player.pos.y+(crouchNow?1.0:1.4)+recoilPitch*2.2, player.pos.z);

    updateHUD();
    renderer.render(scene, camera);
  }
  let playerCamYaw = 0;

  /* ---------------- lifecycle ---------------- */
  async function _commonStart(charData, wd, idx){
    _resetState();
    Nav.show('screen-game');
    if(!scene) _initThree();
    await _buildScene(wd);
    _spawnPlayer(charData, idx);
    _setupInput();
    document.getElementById('overlay-death').classList.add('hidden');
    document.getElementById('overlay-win').classList.add('hidden');
    running = true;
    clock.getDelta();
    _tick();
  }

  async function startSolo(charData, wd){ mode='solo'; await _commonStart(charData, wd, 0); notify('🧪 وضع التجربة الحرة — تحرك واستكشف'); }
  async function startBots(charData, wd, n){ mode='bots'; await _commonStart(charData, wd, 0); _spawnBots(n); notify('🤖 ضد '+n+' بوتات — اقتل الجميع للفوز'); }

  async function startOnline(charData, codeInput, worldCodeIfHost){
    mode='online';
    let meta;
    if(codeInput){
      meta = await Store.get('room:'+codeInput+':meta', true);
      if(!meta){ notify('⚠️ الكود غير صحيح أو الغرفة لسه متعملتش'); return; }
      roomCode = codeInput; isHost=false;
    } else {
      roomCode = genCode(); isHost=true;
      meta = { worldCode: worldCodeIfHost, hostId: myClientId(), createdAt: Date.now() };
      await Store.set('room:'+roomCode+':meta', meta, true);
    }
    const wd = await Store.get('world:'+meta.worldCode, true);
    if(!wd){ notify('⚠️ تعذر تحميل خريطة الغرفة'); return; }
    await _commonStart(charData, wd, isHost?0:1);
    notify(isHost ? ('🌐 أنشأت غرفة! شارك الكود مع صديقك: '+roomCode) : ('🌐 انضممت لغرفة '+roomCode));
    pollTimer = setInterval(_pollOnline, 800);
  }

  function stop(){
    running=false;
    if(rafId) cancelAnimationFrame(rafId);
    if(pollTimer) clearInterval(pollTimer);
    document.getElementById('overlay-death').classList.add('hidden');
    document.getElementById('overlay-win').classList.add('hidden');
    Nav.show('screen-menu');
  }

  document.getElementById('death-exit').addEventListener('click', stop);
  document.getElementById('win-exit').addEventListener('click', stop);

  return { startSolo, startBots, startOnline, stop, _keys:{} };
})();

export { GameEngine };
