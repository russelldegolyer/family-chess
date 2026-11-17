/* Push alerts for directly invited Chess players. No credentials live here. */
self.addEventListener('push',event=>{
 let payload={};
 try{payload=event.data?.json()||{}}catch{payload={}}
 const title=String(payload.title||'Chess challenge').slice(0,90);
 const body=String(payload.body||'You have a new 60-second chess invitation.').slice(0,180);
 const path=typeof payload.url==='string'&&/^\/\?challenge=[0-9a-f-]{36}$/i.test(payload.url)?
   payload.url:'/';
 event.waitUntil(self.registration.showNotification(title,{
  body,icon:'/icon-192-svg-v4.png',badge:'/favicon-svg-v4.png',
  tag:String(payload.tag||'family-chess-invite').slice(0,90),
  data:{url:path},timestamp:Date.now()
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const path=event.notification.data?.url||'/';
 const dest=new URL(path,self.location.origin);
 if(dest.origin!==self.location.origin)return;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const win of windows){
   if(new URL(win.url).origin===dest.origin){
    await win.navigate(dest.href);
    return win.focus();
   }
  }
  return self.clients.openWindow(dest.href);
 })());
});

/* Offline cache. Pages: network first, the cached copy when offline. App files (versioned with ?v=)
   and pinned CDN libraries: served from the cache, refreshed in the background. Supabase and other
   live data are never cached. Practice games and lessons keep working with no signal. */
const CACHE='family-chess-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const k of await caches.keys())if(k.startsWith('family-chess-')&&k!==CACHE)await caches.delete(k);
  await self.clients.claim();
 })());
});
const STATIC=/\.(?:js|mjs|css|png|svg|webmanifest|json|bin|wasm|woff2?)$/i;
function cacheable(url){
 if(url.origin===self.location.origin)return STATIC.test(url.pathname)&&url.pathname!=='/chess-sw.js';
 return url.hostname==='cdn.jsdelivr.net'&&/@\d+\.\d+\.\d+/.test(url.pathname);
}
async function remember(req,res){
 if(!res||!res.ok||res.type==='opaque')return;
 const cache=await caches.open(CACHE);
 const url=new URL(req.url);
 // a new ?v= replaces the old copy of the same file
 if(url.origin===self.location.origin&&url.search){
  for(const old of await cache.keys()){const o=new URL(old.url);if(o.pathname===url.pathname&&o.search!==url.search)await cache.delete(old);}
 }
 await cache.put(req,res);
}
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(req.mode==='navigate'&&url.origin===self.location.origin){
  event.respondWith((async()=>{
   try{
    const res=await fetch(req);
    if(res.ok){const copy=res.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put('/',copy)));}
    return res;
   }catch{
    return (await caches.match('/'))||Response.error();
   }
  })());
  return;
 }
 if(!cacheable(url))return;
 event.respondWith((async()=>{
  const hit=await caches.match(req);
  const live=fetch(req).then(res=>{event.waitUntil(remember(req,res.clone()));return res;});
  if(hit){event.waitUntil(live.catch(()=>{}));return hit;}
  return live;
 })());
});
