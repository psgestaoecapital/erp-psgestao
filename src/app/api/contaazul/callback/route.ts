import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verificarEstado, usuarioTemAcessoEmpresa } from "@/lib/auth/contaazulState";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) return NextResponse.redirect(new URL(`/dashboard/conectores?ca_error=${encodeURIComponent(error)}`, req.url));
  if (!code) return NextResponse.redirect(new URL("/dashboard/conectores?ca_error=no_code", req.url));

  // Redirect do navegador (sem Bearer): a prova de quem iniciou é o state ASSINADO (HMAC + validade 10 min),
  // gerado em /api/contaazul/state. State forjado/expirado ou usuário sem acesso à empresa = nada é gravado.
  const est = verificarEstado(state);
  if (!est) return NextResponse.redirect(new URL("/dashboard/conectores?ca_error=invalid_state", req.url));
  if (!(await usuarioTemAcessoEmpresa(est.uid, est.cid))) {
    return NextResponse.redirect(new URL("/dashboard/conectores?ca_error=forbidden", req.url));
  }
  const clientId = est.ci, clientSecret = est.cs, companyId = est.cid;

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
