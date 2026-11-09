// Secure best-effort web push for a 60-second Family Chess challenge.
// Secrets CHESS_VAPID_PRIVATE_KEY + CHESS_VAPID_PUBLIC_KEY live ONLY in Supabase Edge Secrets.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";

const appOrigin="https://chess.allseasonpestllc.com";
const headers={
 "Access-Control-Allow-Origin":appOrigin,
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Content-Type":"application/json"
};
const respond=(status:number,body:Record<string,unknown>)=>
 new Response(JSON.stringify(body),{status,headers});
const uuid=(s:unknown)=>typeof s==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 if(req.headers.get("origin")&&req.headers.get("origin")!==appOrigin)
  return respond(403,{error:"Origin denied"});
 try {
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!token)return respond(401,{error:"Authentication required"});
  const url=Deno.env.get("SUPABASE_URL")||"";
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!service)return respond(503,{error:"Supabase server keys unavailable"});
  const client=createClient(url,anon,{auth:{persistSession:false}});
  const {data:{user},error:userError}=await client.auth.getUser(token);
  if(userError||!user)return respond(401,{error:"Invalid login session"});
  const body=await req.json().catch(()=>({}));
  const challengeId=body?.challenge_id;
  if(!uuid(challengeId))return respond(400,{error:"Invalid challenge ID"});
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:c,error:challengeError}=await admin.from("chess_challenges")
   .select("id,challenger_id,target_id,status,expires_at,push_sent_at")
   .eq("id",challengeId).maybeSingle();
  if(challengeError)return respond(500,{error:"Unable to load challenge"});
  if(!c||c.challenger_id!==user.id)return respond(403,{error:"Not your challenge"});
  if(c.status!=="pending"||Date.parse(c.expires_at)<=Date.now())
   return respond(409,{error:"Challenge is not active"});
  if(c.push_sent_at)return respond(200,{configured:true,sent:0,already_sent:true});
  let publicKey=Deno.env.get("CHESS_VAPID_PUBLIC_KEY")||"";
  let privateKey=Deno.env.get("CHESS_VAPID_PRIVATE_KEY")||"";
  if(!publicKey||!privateKey){
   // This project already has Supabase Vault; keep the private signing key
   // encrypted there and only fetch it using this service-role Edge Function.
   const {data:keys,error:keysError}=await admin.rpc("chess_vapid_config");
   if(!keysError){publicKey=keys?.publicKey||"";privateKey=keys?.privateKey||"";}
  }
  if(!publicKey||!privateKey)
   return respond(200,{configured:false,sent:0,error:"Push signing keys unavailable"});
  const {data:subs,error:subsError}=await admin.from("chess_push_subscriptions")
   .select("id,endpoint,p256dh,auth").eq("user_id",c.target_id).limit(10);
  if(subsError)return respond(500,{error:"Push subscriptions unavailable"});
  if(!subs?.length)return respond(200,{configured:true,sent:0});
  // An atomic update prevents repeated push spam if the client retries the request.
  const {data:claimed,error:claimError}=await admin.from("chess_challenges")
   .update({push_sent_at:new Date().toISOString()}).eq("id",c.id)
   .is("push_sent_at",null).eq("status","pending")
   .gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
  if(claimError)return respond(500,{error:"Could not lock notification"});
  if(!claimed)return respond(200,{configured:true,sent:0,already_sent:true});
  const {data:sender}=await admin.from("chess_profiles")
   .select("display_name").eq("id",user.id).maybeSingle();
  const name=String(sender?.display_name||"A family member").slice(0,40);
  webpush.setVapidDetails("mailto:no-reply@auth.allseasonpestllc.com",publicKey,privateKey);
  const message=JSON.stringify({
   title:"Family Chess challenge",
   body:name+" challenged you. Accept within 60 seconds.",
   url:"/?challenge="+c.id,
   tag:"chess-challenge-"+c.id
  });
  const ttl=Math.max(1,Math.min(60,Math.ceil((Date.parse(c.expires_at)-Date.now())/1000)));
  let sent=0,failed=0;
  await Promise.all(subs.map(async sub=>{
   try{
    await webpush.sendNotification({
      endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}
    },message,{TTL:ttl,urgency:"high"});
    sent++;
   }catch(e){
    failed++;
    if(e&&typeof e==="object"&&"statusCode" in e&&
      (e.statusCode===404||e.statusCode===410)){
      await admin.from("chess_push_subscriptions").delete().eq("id",sub.id);
    }
   }
  }));
  return respond(200,{configured:true,sent,failed});
 }catch(e){
  console.error("Chess challenge push failed",e instanceof Error?e.message:"unknown");
  return respond(500,{error:"Push delivery failed"});
 }
});
