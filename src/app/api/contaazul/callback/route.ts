import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(error)}`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/dados?ca_error=no_code", req.url));
  }

  // Decode credentials from state
  let clientId = "";
  let clientSecret = "";
  
  if (state) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(state)));
      clientId = decoded.ci || "";
      clientSecret = decoded.cs || "";
    } catch {}
  }

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/dashboard/dados?ca_error=missing_credentials", req.url));
  }

  try {
    // Token exchange with Basic Auth (as ContaAzul requires)
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const redirectUri = `${req.nextUrl.origin}/api/contaazul/callback`;

    const tokenRes = await fetch("https://api.contaazul.com/oauth2/token", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      return NextResponse.redirect(new URL(`/dashboard/dados?ca_token=${tokenData.access_token}`, req.url));
    } else {
      const errMsg = tokenData.error_description || tokenData.error || "token_failed";
      return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(errMsg)}`, req.url));
    }
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/dashboard/dados?ca_error=${encodeURIComponent(e.message)}`, req.url));
  }
}
