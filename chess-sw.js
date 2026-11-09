/* Push alerts for directly invited Family Chess players. No credentials live here. */
self.addEventListener('push',event=>{
 let payload={};
 try{payload=event.data?.json()||{}}catch{payload={}}
 const title=String(payload.title||'Family Chess challenge').slice(0,90);
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
