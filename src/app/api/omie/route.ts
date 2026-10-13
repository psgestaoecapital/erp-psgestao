import { NextRequest, NextResponse } from "next/server";
import { exigirUsuario, exigirEmpresas } from "@/lib/auth/guardaApi";
import { credencialEmpresa } from "@/lib/credenciais/servidor";

// Omie API base URL
const OMIE_BASE = "https://app.omie.com.br/api/v1";

// PR E (CEO 28/09): exige login; com company_id, as chaves vêm do Vault no servidor (o navegador não as tem mais).
// Chaves digitadas na tela (teste antes de salvar) ainda são aceitas no corpo.
export async function POST(req: NextRequest) {
  const guarda = await exigirUsuario(req);
  if (guarda instanceof NextResponse) return guarda;
  try {
    const body = await req.json();
    const { endpoint, method, params, company_id } = body;
    let { app_key, app_secret } = body;

    if ((!app_key || !app_secret) && company_id) {
      const negado = await exigirEmpresas(guarda, [company_id]);
      if (negado) return negado;
      app_key = app_key || (await credencialEmpresa(company_id, "omie", "app_key"));
      app_secret = app_secret || (await credencialEmpresa(company_id, "omie", "app_secret"));
    }

    if (!app_key || !app_secret || !endpoint || !method) {
      return NextResponse.json({ error: "Credenciais do Omie não cadastradas para esta empresa (salve em Conectores)." }, { status: 400 });
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
