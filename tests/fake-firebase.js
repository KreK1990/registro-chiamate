// Firebase finto per i controlli automatici: stessa interfaccia "compat" usata dall'app
// (auth, firestore con collection/doc/onSnapshot/get/set/update/delete/batch, storage), con i
// dati in memoria. I dati iniziali arrivano da window.__seed = { 'collection': [{id, ...}] }
// (percorsi relativi all'archivio dell'utente, es. 'contacts').
(function(){
  const UID = 'test-user';
  const store = new Map();           // percorso documento -> dati
  const listeners = new Map();       // percorso collection -> Set(callback)
  let autoId = 0;
  const clone = v=>v==null ? v : JSON.parse(JSON.stringify(v));
  const later = fn=>setTimeout(fn, 0);
  const parent = p=>p.split('/').slice(0, -1).join('/');
  function collDocs(cpath){
    const out = [];
    store.forEach((data, p)=>{ if(parent(p)===cpath) out.push({ id: p.split('/').pop(), data }); });
    return out;
  }
  function qsnap(cpath){
    const docs = collDocs(cpath).map(d=>({ id: d.id, exists: true, data: ()=>clone(d.data), ref: docRef(cpath+'/'+d.id) }));
    return { docs, size: docs.length, empty: !docs.length, forEach: f=>docs.forEach(f) };
  }
  function notify(cpath){ const ls = listeners.get(cpath); if(ls) ls.forEach(cb=>later(()=>cb(qsnap(cpath)))); }
  function write(path, data){ if(data===undefined) store.delete(path); else store.set(path, data); notify(parent(path)); }
  function docRef(path){
    return {
      id: path.split('/').pop(), path,
      collection: name=>collRef(path+'/'+name),
      get: async()=>{ const d = store.get(path); return { id: path.split('/').pop(), exists: !!d, data: ()=>clone(d) }; },
      set: async(data, opt)=>{ write(path, opt && opt.merge ? { ...(store.get(path)||{}), ...clone(data) } : clone(data)); },
      update: async(data)=>{ if(!store.has(path)) throw Object.assign(new Error('not-found'), { code:'not-found' }); write(path, { ...store.get(path), ...clone(data) }); },
      delete: async()=>{ write(path, undefined); },
      onSnapshot: cb=>{ later(()=>{ const d = store.get(path); cb({ id: path.split('/').pop(), exists: !!d, data: ()=>clone(d) }); }); return ()=>{}; }
    };
  }
  function collRef(cpath){
    return {
      path: cpath,
      doc: id=>docRef(cpath+'/'+(id || ('auto'+(++autoId)))),
      add: async data=>{ const r = docRef(cpath+'/auto'+(++autoId)); await r.set(data); return r; },
      get: async()=>qsnap(cpath),
      limit: ()=>collRef(cpath),
      where: ()=>({ limit: ()=>({ get: async()=>({ empty: true, docs: [] }) }) }),
      onSnapshot: (cb, err)=>{ if(!listeners.has(cpath)) listeners.set(cpath, new Set()); listeners.get(cpath).add(cb); later(()=>cb(qsnap(cpath))); return ()=>listeners.get(cpath).delete(cb); }
    };
  }
  const fsApi = {
    collection: name=>collRef(name),
    doc: path=>docRef(path),
    batch: ()=>{ const ops = []; return { set: (r, d)=>ops.push(()=>r.set(d)), update: (r, d)=>ops.push(()=>r.update(d)), delete: r=>ops.push(()=>r.delete()), commit: async()=>{ for(const op of ops) await op(); } }; },
    enablePersistence: ()=>Promise.resolve()
  };
  const files = new Map();
  const user = { uid: UID, email: 'test@example.com', getIdToken: async()=>'test-token' };
  window.firebase = {
    apps: [],
    initializeApp(){ this.apps.push({}); },
    auth: ()=>({ currentUser: user, onAuthStateChanged: cb=>{ later(()=>cb(user)); return ()=>{}; }, signOut: async()=>{}, signInWithEmailAndPassword: async()=>{}, sendPasswordResetEmail: async()=>{} }),
    firestore: ()=>fsApi,
    storage: ()=>({ ref: p=>({ put: async f=>{ files.set(p, f); }, getDownloadURL: async()=>files.has(p) && files.get(p) instanceof Blob ? URL.createObjectURL(files.get(p)) : 'https://example.test/'+encodeURIComponent(p), delete: async()=>{ files.delete(p); } }) })
  };
  // dati iniziali e accesso ai dati per i controlli
  const seed = window.__seed || {};
  Object.entries(seed).forEach(([coll, docs])=>docs.forEach(d=>{ const { id, ...rest } = d; store.set(`users/${UID}/${coll}/${id}`, clone(rest)); }));
  window.__fake = {
    uid: UID, store, files,
    docs: coll=>collDocs(`users/${UID}/${coll}`).map(d=>({ id: d.id, ...clone(d.data) })),
    put: (coll, id, data)=>write(`users/${UID}/${coll}/${id}`, clone(data))
  };
})();
