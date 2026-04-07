import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state"); // company_id
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(error)}`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/dados?ca_error=no_code", req.url));
  }

  // Exchange code for token
  try {
    // Get client credentials from query state (base64 encoded)
    let clientId = "";
    let clientSecret = "";
    
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64").toString());
        clientId = decoded.client_id || "";
        clientSecret = decoded.client_secret || "";
      } catch {}
    }

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL("/dashboard/dados?ca_error=missing_credentials", req.url));
    }

    const tokenRes = await fetch("https://api.contaazul.com/oauth2/token", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${req.nextUrl.origin}/api/contaazul/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      // Redirect back to dados with token
      const params = new URLSearchParams({
        ca_token: tokenData.access_token,
        ca_refresh: tokenData.refresh_token || "",
        ca_expires: tokenData.expires_in?.toString() || "3600",
      });
      return NextResponse.redirect(new URL(`/dashboard/dados?${params.toString()}`, req.url));
    } else {
      return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(tokenData.error_description || tokenData.error || "token_failed")}`, req.url));
    }
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(e.message)}`, req.url));
  }
}
