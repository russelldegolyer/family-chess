import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {Chess} from 'npm:chess.js@1.4.0';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://chess.allseasonpestllc.com','https://family-chess-theta.vercel.app']);
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const square=/^[a-h][1-8]$/;
Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const headers={
  'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://chess.allseasonpestllc.com',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'
 };
 const reply=(code:number,body:unknown)=>new Response(JSON.stringify(body),{status:code,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 try{
  const token=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!token)return reply(401,{error:'Sign in to play'});
  const {data:auth,error:authErr}=await db.auth.getUser(token);
  if(authErr||!auth.user?.id)return reply(401,{error:'Your session expired'});
  const {game_id,action,pawn_square}=await req.json();
  if(typeof game_id!=='string'||!uuid.test(game_id)
     ||!['penalty','sacrifice'].includes(action)
     ||(pawn_square!==null && (typeof pawn_square!=='string'||!square.test(pawn_square))))
    return reply(400,{error:'Invalid pawn action'});
  const {data:g,error:gErr}=await db.from('chess_games')
    .select('id,white_player_id,black_player_id,current_fen,status,clock_state,clock_penalty_side,clock_mode')
    .eq('id',game_id).maybeSingle();
  if(gErr)throw gErr;
  const user=auth.user.id;
  const actor=g?.white_player_id===user?'w':g?.black_player_id===user?'b':null;
  if(!g||!actor)return reply(403,{error:'You are not a player in this match'});
  if(g.status!=='active')return reply(409,{error:'This match is finished'});
  // Normal time controls allow pawn-for-time. The per-move countdown does not.
  if(!['10m','12m','15m'].includes(g.clock_mode))
    return reply(409,{error:'Pawn exchanges are available only in normal timed games'});
  const chess=new Chess(g.current_fen);
  const turn=chess.turn();
  const victim=action==='sacrifice'?actor:g.clock_penalty_side;
  if(action==='sacrifice'){
    if(actor!==turn||g.clock_state!=='running'||g.clock_mode==='off')
      return reply(409,{error:'Only the active player can trade a pawn while timed'});
    if(chess.inCheck())return reply(422,{error:'You must escape check instead of trading a pawn'});
  }else if(g.clock_state!=='penalty'||actor===victim||turn!==victim)
    return reply(409,{error:'Waiting for the other player to choose a pawn'});
  const pawns=chess.board().flat().filter((x)=>x?.type==='p'&&x.color===victim);
  if(pawn_square===null){
    if(action!=='penalty'||pawns.length>0)return reply(422,{error:'Choose a pawn'});
  }else{
    const piece=chess.get(pawn_square);
    if(!piece||piece.type!=='p'||piece.color!==victim)
      return reply(422,{error:'Select one of the correct player’s pawns'});
    chess.remove(pawn_square);
    if(action==='sacrifice'&&chess.inCheck())
      return reply(422,{error:'That pawn protects your king. Choose another pawn'});
  }
  const parts=chess.fen().split(' ');
  parts[3]='-';parts[4]='0';
  if(action==='sacrifice'){
    parts[1]=actor==='w'?'b':'w';
    if(actor==='b')parts[5]=String(Number(parts[5])+1);
  }
  // If no pawn remains, resume without a board change. Preserve the
  // exact server FEN, including its en-passant and move counters.
  const next_fen=pawn_square===null?g.current_fen:parts.join(' ');
  try{new Chess(next_fen);}catch{return reply(422,{error:'Pawn removal would create an invalid board'});}
  const {data:id,error:commitError}=await db.rpc('chess_commit_clock_action',{
    p_game_id:game_id,p_player_id:user,p_kind:action,p_square:pawn_square,
    p_expected_fen:g.current_fen,p_next_fen:next_fen
  });
  if(commitError)return reply(409,{error:commitError.message||'Action changed; refresh game'});
  if(Number(id)===0)return reply(409,{error:'Time expired. Your opponent must select a pawn.',needs_penalty:true});
  return reply(200,{ok:true,action_id:id,kind:action,fen:next_fen});
 }catch(e){
  console.error('chess-clock-action',e instanceof Error?e.message:'unknown error');
  return reply(500,{error:'Could not process pawn action. Please retry.'});
 }
});