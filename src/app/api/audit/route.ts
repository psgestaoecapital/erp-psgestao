import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const { user_id, user_email, action, detail, module } = await req.json();
    if (!action) return NextResponse.json({ error: "action obrigatorio" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
    const ua = req.headers.get("user-agent") || "";
    const device = ua.includes("Mobile") ? "Mobile" : ua.includes("Chrome") ? "Chrome" : ua.includes("Firefox") ? "Firefox" : ua.includes("Safari") ? "Safari" : "Outro";

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from("audit_log").insert({
      user_id: user_id || null,
      user_email: user_email || null,
      action,
      detail: detail || null,
      module: module || null,
      ip_address: ip,
      user_agent: ua.substring(0, 200),
      device,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const action = url.searchParams.get("action") || null;

    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (action) query = query.eq("action", action);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Active sessions: users who logged in recently without logout
    const sessions: any[] = [];
    const seen = new Set<string>();
    for (const log of (data || [])) {
      if (log.action === "login" && !seen.has(log.user_email)) {
        seen.add(log.user_email);
        const hasLogout = (data || []).some((l: any) => l.user_email === log.user_email && l.action === "logout" && l.created_at > log.created_at);
        if (!hasLogout) {
          const minAgo = Math.round((Date.now() - new Date(log.created_at).getTime()) / 60000);
          sessions.push({ ...log, minutes_ago: minAgo, status: minAgo < 5 ? "ativo" : minAgo < 30 ? "inativo" : "expirado" });
        }
      }
    }

    return NextResponse.json({ success: true, logs: data || [], sessions, total: data?.length || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
