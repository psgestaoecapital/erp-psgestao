import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { code, client_id, client_secret, redirect_uri } = await req.json();

    if (!code || !client_id || !client_secret) {
      return NextResponse.json({ error: "Parâmetros ausentes" }, { status: 400 });
    }

    const tokenRes = await fetch("https://api.contaazul.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect_uri || "",
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      return NextResponse.json({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || "",
        expires_in: tokenData.expires_in || 3600,
      });
    } else {
      return NextResponse.json({
        error: tokenData.error_description || tokenData.error || "Token exchange failed",
      }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
