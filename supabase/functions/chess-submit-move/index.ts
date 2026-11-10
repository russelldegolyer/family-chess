
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { Chess } from 'npm:chess.js@1.4.0';

const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = new Set(['https://chess.allseasonpestllc.com','https://family-chess-theta.vercel.app']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://chess.allseasonpestllc.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin'
  };
  const reply = (code, payload) => new Response(JSON.stringify(payload),{
    status:code,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}
  });
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{error:'Use POST.'});
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
    if(!token)return reply(401,{error:'Sign in to make a move.'});
    const {data:auth,error:authErr}=await db.auth.getUser(token);
    if(authErr || !auth.user?.id)return reply(401,{error:'Your session expired. Sign in again.'});

    const {game_id,move_uci}=await req.json();
    if(typeof game_id!=='string'||!uuid.test(game_id)||typeof move_uci!=='string'||!uci.test(move_uci))
      return reply(400,{error:'Invalid game ID or move.'});
    const {data:g,error:gErr}=await db.from('chess_games')
      .select('id,white_player_id,black_player_id,current_fen,status,result')
      .eq('id',game_id).maybeSingle();
    if(gErr)throw gErr;
    if(!g||(g.white_player_id!==auth.user.id && g.black_player_id!==auth.user.id))
      return reply(403,{error:'You are not a player in this match.'});
    if(g.status!=='active')return reply(409,{error:'This game is not active.'});

    const {data:records,error:hErr}=await db.from('chess_moves')
      .select('ply,move_uci').eq('game_id',game_id).order('ply',{ascending:true}).limit(1001);
    if(hErr)throw hErr;
    if((records?.length||0)>1000)return reply(409,{error:'Game history exceeds supported size.'});
    const chess=new Chess();
    for(let i=0;i<(records?.length||0);i++){
      const rec=records[i];
      if(rec.ply!==i+1)return reply(409,{error:'Game history is inconsistent.'});
      const m=rec.move_uci;
      try{chess.move({from:m.slice(0,2),to:m.slice(2,4),promotion:m[4]||undefined});}
      catch{return reply(409,{error:'Invalid saved game history.'});}
    }
    if(chess.fen()!==g.current_fen)return reply(409,{error:'Game position needs repair before moves can resume.'});
    const side=chess.turn();
    if((side==='w'?g.white_player_id:g.black_player_id)!==auth.user.id)
      return reply(403,{error:'It is not your turn.'});

    let mv;
    try{mv=chess.move({from:move_uci.slice(0,2),to:move_uci.slice(2,4),promotion:move_uci[4]||undefined});}
    catch{return reply(422,{error:'That is not a legal move.'});}
    if(!mv)return reply(422,{error:'That is not a legal move.'});
    const canonical=mv.from+mv.to+(mv.promotion||'');
    if(canonical!==move_uci)return reply(422,{error:'Invalid promotion.'});
    const finished=chess.isGameOver();
    const result=!finished?null:chess.isCheckmate()?(side==='w'?'1-0':'0-1'):'1/2-1/2';
    const newFen=chess.fen();
    const {data:ply,error:commitErr}=await db.rpc('chess_commit_validated_move',{
      p_game_id:game_id,p_player_id:auth.user.id,p_expected_fen:g.current_fen,
      p_move_uci:canonical,p_move_san:mv.san,p_next_fen:newFen,
      p_finished:finished,p_result:result
    });
    if(commitErr)return reply(409,{error:commitErr.message||'Move conflicted. Refresh the game.'});
    if(ply===0)return reply(409,{error:'Time expired. The other player wins on time.',timeout:true});
    return reply(200,{ok:true,ply,move_uci:canonical,move_san:mv.san,fen:newFen,
      status:finished?'finished':'active',result});
  } catch(e){
    console.error('chess-submit-move',e instanceof Error?e.message:'Unexpected error');
    return reply(500,{error:'Could not save move. Try again.'});
  }
});
