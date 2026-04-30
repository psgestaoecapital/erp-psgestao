// src/app/cliente/[company_id]/[token]/page.tsx
// PORTAL CLIENTE - publico, mobile-first, sem login
// Cliente acessa via link unico do fechamento

"use client";

import { useEffect, useState, use } from "react";
import { supabaseBrowser } from "@/lib/authFetch";

interface Dados {
  empresa: { nome: string; cnpj: string };
  mes_referencia_label: string;
  resumo: { receita_total: number; ebitda: number; lucro_liquido: number; margem_ebitda_pct: number };
  comparativo: {
    mes_anterior_label: string;
    receita_anterior: number | null;
    variacao_receita_pct: number | null;
    variacao_ebitda_pct: number | null;
  };
  insights: Array<{ titulo: string; descricao: string; tipo: string }>;
}

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PortalClientePage({
  params,
}: {
  params: Promise<{ company_id: string; token: string }>;
}) {
  const { company_id, token } = use(params);
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = supabaseBrowser();
        // Lookup pelo token unico do portal
        const { data, error } = await supabase
          .from("bpo_fechamento_mensal")
          .select("dados_consolidados, link_portal_acessado_em, status")
          .eq("company_id", company_id)
          .eq("link_portal", token)
          .order("mes_referencia", { ascending: false })
          .limit(1)
          .single();

        if (error) throw new Error("Link inválido ou expirado");
        if (!data?.dados_consolidados) throw new Error("Dados ainda não disponíveis");

        setDados(data.dados_consolidados as Dados);

        // Marcar acesso (best effort)
        if (!data.link_portal_acessado_em) {
          await supabase
            .from("bpo_fechamento_mensal")
            .update({ link_portal_acessado_em: new Date().toISOString() })
            .eq("company_id", company_id)
            .eq("link_portal", token);
        }
      } catch (e: any) {
        setErro(e.message || "Não foi possível carregar relatório");
      } finally {
        setLoading(false);
      }
    })();
  }, [company_id, token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Carregando seu relatório...</div>
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF7F2] p-4">
        <div className="max-w-md text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h1 className="text-xl font-bold text-[#3D2314]">{erro || "Relatório não encontrado"}</h1>
          <p className="mt-2 text-sm text-[#3D2314]/70">
            Entre em contato com a PS Gestão para obter um novo link.
          </p>
        </div>
      </div>
    );
  }

  const ebitdaPositivo = dados.resumo.ebitda >= 0;
  const margemBoa = dados.resumo.margem_ebitda_pct >= 10;

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <header className="bg-[#3D2314] px-5 py-6 text-[#FAF7F2]">
        <div className="mx-auto max-w-2xl">
          <div className="text-xs uppercase tracking-wider text-[#C8941A]">PS Gestão & Capital</div>
          <h1 className="mt-1 text-xl font-bold">{dados.empresa.nome}</h1>
          <p className="mt-1 text-sm text-[#FAF7F2]/70">
            Fechamento de {dados.mes_referencia_label}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        {/* RESUMO PRINCIPAL */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-center">
            <div className="text-xs uppercase text-[#3D2314]/60">Resultado do mês</div>
            <div
              className={`mt-2 text-4xl font-bold ${
                dados.resumo.lucro_liquido >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {fmtMoney(dados.resumo.lucro_liquido)}
            </div>
            <div className="mt-1 text-sm text-[#3D2314]/60">Lucro líquido</div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-[#FAF7F2] p-3 text-center">
              <div className="text-xs text-[#3D2314]/60">Receita</div>
              <div className="mt-1 text-sm font-bold text-[#3D2314]">
                {fmtMoney(dados.resumo.receita_total)}
              </div>
            </div>
            <div className="rounded-lg bg-[#FAF7F2] p-3 text-center">
              <div className="text-xs text-[#3D2314]/60">EBITDA</div>
              <div className={`mt-1 text-sm font-bold ${ebitdaPositivo ? "text-emerald-700" : "text-red-700"}`}>
                {fmtMoney(dados.resumo.ebitda)}
              </div>
            </div>
            <div className="rounded-lg bg-[#FAF7F2] p-3 text-center">
              <div className="text-xs text-[#3D2314]/60">Margem</div>
              <div className={`mt-1 text-sm font-bold ${margemBoa ? "text-emerald-700" : "text-red-700"}`}>
                {dados.resumo.margem_ebitda_pct}%
              </div>
            </div>
          </div>
        </div>

        {/* COMPARATIVO */}
        {dados.comparativo.variacao_receita_pct !== null && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-[#3D2314]">
              vs {dados.comparativo.mes_anterior_label}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <VarBox
                label="Receita"
                variacao={dados.comparativo.variacao_receita_pct}
              />
              {dados.comparativo.variacao_ebitda_pct !== null && (
                <VarBox
                  label="EBITDA"
                  variacao={dados.comparativo.variacao_ebitda_pct}
                />
              )}
            </div>
          </div>
        )}

        {/* INSIGHTS */}
        <div>
          <h2 className="mb-3 px-1 text-sm font-semibold uppercase text-[#3D2314]/70">
            💡 O que isso significa
          </h2>
          <div className="space-y-2">
            {dados.insights.map((ins, i) => (
              <div
                key={i}
                className={`rounded-2xl p-4 shadow-sm ${
                  ins.tipo === "alerta" ? "bg-red-50 border-l-4 border-red-500"
                  : ins.tipo === "destaque" ? "bg-[#C8941A]/10 border-l-4 border-[#C8941A]"
                  : "bg-white"
                }`}
              >
                <div className="font-semibold text-[#3D2314]">{ins.titulo}</div>
                <div className="mt-1 text-sm text-[#3D2314]/80">{ins.descricao}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RODAPE */}
        <div className="rounded-2xl bg-white p-5 text-center">
          <div className="text-sm text-[#3D2314]/70">
            Dúvidas sobre este relatório?
          </div>
          <div className="mt-1 font-semibold text-[#3D2314]">
            Entre em contato com seu consultor PS Gestão
          </div>
          <div className="mt-3 text-xs text-[#3D2314]/50">
            Relatório gerado automaticamente · PS Gestão & Capital
          </div>
        </div>
      </main>
    </div>
  );
}

function VarBox({ label, variacao }: { label: string; variacao: number }) {
  const positiva = variacao >= 0;
  return (
    <div className="rounded-lg bg-[#FAF7F2] p-3 text-center">
      <div className="text-xs text-[#3D2314]/60">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${positiva ? "text-emerald-700" : "text-red-700"}`}>
        {positiva ? "↑" : "↓"} {Math.abs(variacao).toFixed(1)}%
      </div>
    </div>
  );
}
