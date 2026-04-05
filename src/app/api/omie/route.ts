import { NextRequest, NextResponse } from "next/server";

// Omie API base URL
const OMIE_BASE = "https://app.omie.com.br/api/v1";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { app_key, app_secret, endpoint, method, params } = body;

    if (!app_key || !app_secret || !endpoint || !method) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const omiePayload = {
      call: method,
      app_key,
      app_secret,
      param: [params || {}],
    };

    const response = await fetch(`${OMIE_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(omiePayload),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
