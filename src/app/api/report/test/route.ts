import { NextRequest, NextResponse } from "next/server";
import { modeloPara, registrarFalhaIA } from "@/lib/aiModel";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json({ status: "ERRO", msg: "ANTHROPIC_API_KEY não encontrada" });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modeloPara('relatorio'),
        max_tokens: 50,
        messages: [{ role: "user", content: "Diga apenas: OK" }],
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      await registrarFalhaIA({ endpoint: '/api/report/test', finalidade: 'relatorio', modelo: modeloPara('relatorio'), status: res.status, erro: data?.error?.message || 'sem corpo' });
      return NextResponse.json({ status: "ERRO_API", msg: data.error?.message, tipo: data.error?.type });
    }
    return NextResponse.json({ status: "OK", resposta: data.content?.[0]?.text, msg: "Claude API funcionando!" });
  } catch (e: any) {
    return NextResponse.json({ status: "ERRO_REDE", msg: e.message });
  }
}
