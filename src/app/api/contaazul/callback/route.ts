import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) return NextResponse.redirect(new URL(`/dashboard/conectores?ca_error=${encodeURIComponent(error)}`, req.url));
  if (!code) return NextResponse.redirect(new URL("/dashboard/conectores?ca_error=no_code", req.url));

  let clientId = "", clientSecret = "", companyId = "";
  if (state) {
    try {
      const d = JSON.parse(atob(decodeURIComponent(state)));
      clientId = d.ci || ""; clientSecret = d.cs || ""; companyId = d.cid || "";
    } catch {}
  }

  if (!clientId || !clientSecret) return NextResponse.redirect(new URL("/dashboard/conectores?ca_error=missing_credentials", req.url));

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const redirectUri = `${req.nextUrl.origin}/api/contaazul/callback`;

    const tokenRes = await fetch("https://api.contaazul.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      if (companyId) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from("companies").update({
          contaazul_token: tokenData.access_token,
          contaazul_refresh_token: tokenData.refresh_token || "",
          contaazul_client_id: clientId,
          contaazul_client_secret: clientSecret,
        }).eq("id", companyId);
      }
      return NextResponse.redirect(new URL(`/dashboard/conectores?ca_success=true`, req.url));
    }
    return NextResponse.redirect(new URL(`/dashboard/conectores?ca_error=${encodeURIComponent(tokenData.error_description || "token_failed")}`, req.url));
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/dashboard/conectores?ca_error=${encodeURIComponent(e.message)}`, req.url));
  }
}
