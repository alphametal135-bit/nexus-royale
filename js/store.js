// store.js — persistent storage wrapper (window.storage bridge, localStorage fallback)
import { notify } from './nav.js';

const Store = {
  _lsKey(key, shared){ return 'nx-store:'+(shared?'shared:':'local:')+key; },
  _lsGet(key, shared){
    try{ const raw = localStorage.getItem(this._lsKey(key,shared)); return raw!=null ? JSON.parse(raw) : undefined; }
    catch(e){ return undefined; }
  },
  _lsSet(key, val, shared){
    try{ localStorage.setItem(this._lsKey(key,shared), JSON.stringify(val)); return true; }
    catch(e){ return false; }
  },
  _lsDelete(key, shared){
    try{ localStorage.removeItem(this._lsKey(key,shared)); return true; }
    catch(e){ return false; }
  },
  async _retry(fn, tries=2){
    let lastErr;
    for(let i=0;i<tries;i++){
      try{ return await fn(); }
      catch(e){ lastErr = e; }
    }
    throw lastErr;
  },
  async get(key, shared=false){
    try{
      if(window.storage && window.storage.get){
        const r = await this._retry(()=>window.storage.get(key, shared));
        if(r && typeof r.value==='string') return JSON.parse(r.value);
      }
    }catch(e){ /* fall through to local cache */ }
    const local = this._lsGet(key, shared);
    return local!==undefined ? local : null;
  },
  async set(key, val, shared=false){
    this._lsSet(key, val, shared); // always cache locally first so nothing is ever lost
    try{
      if(window.storage && window.storage.set){
        const r = await this._retry(()=>window.storage.set(key, JSON.stringify(val), shared));
        if(r) return r;
      }
    }catch(e){
      console.error('store set fail', key, e);
      notify('⚠️ تعذّر الحفظ السحابي — تم الحفظ محليًا بدلاً منه');
    }
    return { key, value: val, shared };
  },
  async list(prefix, shared=false){
    try{
      if(window.storage && window.storage.list){
        const r = await this._retry(()=>window.storage.list(prefix, shared));
        if(r) return r.keys;
      }
    }catch(e){ /* fall through */ }
    try{
      const p = this._lsKey(prefix||'', shared);
      return Object.keys(localStorage).filter(k=>k.startsWith(p)).map(k=>k.slice(this._lsKey('',shared).length));
    }catch(e){ return []; }
  },
  async delete(key, shared=false){
    this._lsDelete(key, shared);
    try{
      if(window.storage && window.storage.delete){
        return await this._retry(()=>window.storage.delete(key, shared));
      }
    }catch(e){ /* already removed locally */ }
    return null;
  }
};
function genCode(len=6){ const C='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<len;i++) s+=C[Math.floor(Math.random()*C.length)]; return s; }
function myClientId(){ let id = sessionStorage.getItem('nx-client-id'); if(!id){ id = 'c'+Math.random().toString(36).slice(2,10); sessionStorage.setItem('nx-client-id', id); } return id; }

export { Store, genCode, myClientId };
