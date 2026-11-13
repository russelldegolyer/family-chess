// Connection servers for voice chat. Always returns public STUN; adds a TURN relay (for mobile networks that
// block direct calls) only when these Edge Secrets are set: CHESS_TURN_URLS (comma separated, e.g.
// "turn:turn.example.com:3478,turns:turn.example.com:5349"), CHESS_TURN_USERNAME, CHESS_TURN_CREDENTIAL.
// Signed-in players only (verify_jwt=false; the bearer token is checked here). No audio passes through this.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const allowed = new Set(["https://chess.allseasonpestllc.com", "https://family-chess-theta.vercel.app"]);
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://chess.allseasonpestllc.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return reply(401, { error: "Sign in first." });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return reply(401, { error: "Your session expired. Sign in again." });
  const iceServers: { urls: string[]; username?: string; credential?: string }[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const urls = (Deno.env.get("CHESS_TURN_URLS") || "").split(",").map((s) => s.trim()).filter((s) => /^turns?:/.test(s));
  const username = Deno.env.get("CHESS_TURN_USERNAME"), credential = Deno.env.get("CHESS_TURN_CREDENTIAL");
  if (urls.length && username && credential) iceServers.push({ urls, username, credential });
  return reply(200, { iceServers, relay: iceServers.length > 1 });
});
