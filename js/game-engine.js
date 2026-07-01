// game-engine.js — core gameplay loop, HUD, bots, online sync
import { Store, genCode, myClientId } from './store.js';
import { Nav, notify } from './nav.js';
import { buildCharacterMesh, charStats, defaultCharData, CharOptions } from './character-builder.js';
import { buildTerrainScene, objectMeshFactory, placeObjectsInScene, weatherParticles, updateWeatherParticles, WEAPON_PRESETS, resolveWeapon } from './terrain-builder.js';
import { preloadAssets } from './parts.js';

const GameEngine = (()=>{
  let scene, camera, renderer, heightFn, biome, worldData, clock, raycaster;
  let player, playerMesh, crates=[], spawns=[], weatherFx=null, assetsMap={};
  let bots=[], remotePlayers={}; // clientId -> {mesh,data,targetPos,hp,alive}
  let mode='solo', running=false, rafId=null, pollTimer=null, lastPollWrite=0;
  let roomCode=null, isHost=false, lastHitProcessed=0;
  let input = { move:{x:0,y:0}, jump:false, fire:false };
  let aiming=false, recoilPitch=0, muzzleLight=null;
  let killFeedTimer=null;

  function _resetState(){
    bots=[]; remotePlayers={}; crates=[]; spawns=[]; roomCode=null; isHost=false; lastHitProcessed=0;
    aiming=false; recoilPitch=0;
    if(pollTimer) clearInterval(pollTimer); pollTimer=null;
    if(rafId) cancelAnimationFrame(rafId); rafId=null;
    document.getElementById('killFeed').innerHTML='';
    document.getElementById('adsBtn').classList.remove('on');
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
      weaponData: WEAPON_PRESETS.fists, lastFire:0, alive:true
    };
    document.getElementById('hpName').textContent = charData.name;
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

    let targetMeshes = [];
    if(mode==='bots') targetMeshes = bots.filter(b=>b.alive).map(b=>b.mesh);
    if(mode==='online') targetMeshes = Object.values(remotePlayers).filter(r=>r.data && r.data.alive!==false).map(r=>r.mesh);
    if(targetMeshes.length===0) return;

    raycaster.setFromCamera({x:0,y:0}, camera);
    const hits = raycaster.intersectObjects(targetMeshes, true);
    const hit = hits.find(h=>h.distance <= w.range);
    if(!hit) return;

    const isHead = !!hit.object.userData.isHead;
    const dmg = isHead ? Math.round(w.dmg*2) : w.dmg;
    const owner = hit.object.parent;
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
      bots.push({ id:'bot'+i, mesh, name:cd.name, hp:90, maxHp:90, alive:true, facing:0, lastFire:0, wanderDir:Math.random()*Math.PI*2, wanderT:0 });
    }
  }
  function _updateBots(delta,now){
    bots.forEach(b=>{
      if(!b.alive) return;
      const toPlayer = player.pos.clone().sub(b.mesh.position); toPlayer.y=0;
      const dist = toPlayer.length();
      let moveDir=null;
      if(player.alive && dist < 20 && dist > 3.5){
        moveDir = toPlayer.normalize();
      } else if(player.alive && dist <= 3.5){
        if(now - b.lastFire > 1300){
          b.lastFire = now;
          if(Math.random()<0.7){
            player.hp -= 8 + Math.random()*7;
            killFeed(b.name+' أصاب '+player.data.name);
            if(player.hp<=0 && player.alive) _die();
            updateHUD();
          }
        }
      } else {
        b.wanderT -= delta;
        if(b.wanderT<=0){ b.wanderDir = Math.random()*Math.PI*2; b.wanderT = 2+Math.random()*3; }
        moveDir = new THREE.Vector3(Math.sin(b.wanderDir),0,Math.cos(b.wanderDir));
      }
      if(moveDir){
        const spd = 2.6*delta;
        b.mesh.position.x += moveDir.x*spd;
        b.mesh.position.z += moveDir.z*spd;
        b.mesh.position.y = heightFn(b.mesh.position.x, b.mesh.position.z);
        b.facing = Math.atan2(moveDir.x, moveDir.z);
        b.mesh.rotation.y = b.facing;
      }
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
          hp:player.hp, alive:player.alive, ts:now
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
          remotePlayers[id] = { mesh, data:r };
        }
        const rp = remotePlayers[id];
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
      if(Math.abs(mv.x)>0.05 || Math.abs(mv.y)>0.05){
        const camAngle = playerCamYaw;
        const worldX = mv.x*Math.cos(camAngle) + mv.y*Math.sin(camAngle);
        const worldZ = -mv.x*Math.sin(camAngle) + mv.y*Math.cos(camAngle);
        const len = Math.hypot(worldX,worldZ)||1;
        const dx = worldX/len, dz = worldZ/len;
        const spd = player.speed * (aiming ? 0.5 : 1);
        player.pos.x += dx*spd*delta;
        player.pos.z += dz*spd*delta;
        player.facing = Math.atan2(dx,dz);
      }
      if(input.jump && player.onGround){ player.vy = 5.4; player.onGround=false; input.jump=false; }
      player.vy -= 14*delta;
      player.pos.y += player.vy*delta;
      const groundY = heightFn(player.pos.x, player.pos.z);
      if(player.pos.y <= groundY){ player.pos.y = groundY; player.vy=0; player.onGround=true; }

      playerMesh.position.copy(player.pos);
      playerMesh.rotation.y = player.facing;

      if(input.fire) _tryFire(now);
      _checkCrates();
    }

    if(mode==='bots') _updateBots(delta, now);
    updateWeatherParticles(weatherFx, delta);
    recoilPitch = Math.max(0, recoilPitch - delta*0.7);

    // chase camera behind player, zooms in when aiming (ADS)
    const camDist = aiming ? 3.0 : 5.2, camHeight = aiming ? 2.2 : 2.6;
    const targetFov = aiming ? 40 : 62;
    if(Math.abs(camera.fov-targetFov) > 0.3){ camera.fov += (targetFov-camera.fov)*0.15; camera.updateProjectionMatrix(); }
    const behindX = player.pos.x - Math.sin(player.facing)*camDist;
    const behindZ = player.pos.z - Math.cos(player.facing)*camDist;
    const desired = new THREE.Vector3(behindX, player.pos.y+camHeight, behindZ);
    camera.position.lerp(desired, aiming ? 0.22 : 0.12);
    camera.lookAt(player.pos.x, player.pos.y+1.4+recoilPitch*2.2, player.pos.z);

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
