// src/app/dashboard/bpo/foco/[company_id]/page.tsx
// Modo Foco em 1 empresa: checklist visual de fechamento + score + acoes diretas

"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { rpc } from "@/lib/authFetch";

interface ChecklistItem {
  id: string;
  titulo: string;
  descricao: string;
  status: "verde" | "amarelo" | "vermelho";
  qtd?: number;
  link: string;
  icone: string;
}

interface ModoFocoData {
  empresa: { id: string; nome: string; cnpj: string; regime: string };
  score: number;
  score_max: number;
  mes_referencia: string;
  checklist: ChecklistItem[];
  servicos_contratados: Record<string, boolean>;
  sla_horas: number;
  dia_fechamento: number;
}

export default function ModoFocoEmpresaPage({
  params,
}: {
  params: Promise<{ company_id: string }>;
}) {
  const { company_id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<ModoFocoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const r = await rpc<ModoFocoData>("fn_bpo_modo_foco_empresa", {
        p_company_id: company_id,
      });
      setData(r);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar empresa");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/dashboard/bpo/foco");
      if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        carregar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Calculando estado da empresa…</div>
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="rounded-lg bg-red-50 p-4 text-red-800">
          {erro || "Empresa não encontrada"}
        </div>
      </div>
    );
  }

  const completos = data.checklist.filter((c) => c.status === "verde").length;
  const total = data.checklist.length;
  const pct = total > 0 ? Math.round((completos / total) * 100) : 0;

  function corBg(status: string) {
    if (status === "verde") return "bg-emerald-50 border-emerald-200";
    if (status === "amarelo") return "bg-yellow-50 border-yellow-200";
    return "bg-red-50 border-red-200";
  }

  function corTexto(status: string) {
    if (status === "verde") return "text-emerald-800";
    if (status === "amarelo") return "text-yellow-800";
    return "text-red-800";
  }

  function corBadgeScore() {
    if (data!.score >= 80) return "text-emerald-700 bg-emerald-100";
    if (data!.score >= 50) return "text-yellow-800 bg-yellow-100";
    return "text-red-800 bg-red-100";
  }

  return (
    <div className="min-h-screen bg-white">
      {/* HEADER */}
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <a
            href="/dashboard/bpo/foco"
            className="text-sm text-[#C8941A] hover:underline"
          >
            ← Voltar à seleção de empresas
          </a>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#3D2314]">{data.empresa.nome}</h1>
              <p className="text-xs text-[#3D2314]/60">
                CNPJ: {data.empresa.cnpj || "—"} · Regime: {data.empresa.regime || "—"} · SLA{" "}
                {data.sla_horas}h · Fechamento dia {data.dia_fechamento}
              </p>
            </div>
            <div className={`rounded-2xl px-5 py-2 text-center ${corBadgeScore()}`}>
              <div className="text-3xl font-bold leading-none">{data.score}</div>
              <div className="text-xs uppercase">/ {data.score_max}</div>
            </div>
          </div>
        </div>
      </header>

      {/* PROGRESS BAR */}
      <div className="border-b border-[#3D2314]/10 bg-white px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-[#3D2314]">
              {completos} de {total} dimensões em dia
            </span>
            <span className="text-[#3D2314]/60">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#FAF7F2]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#C8941A] to-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* CHECKLIST */}
      <main className="mx-auto max-w-5xl px-6 py-6">
        <h2 className="mb-4 text-lg font-semibold text-[#3D2314]">
          Checklist para fechar mês {data.mes_referencia.slice(0, 7)}
        </h2>

        <div className="space-y-3">
          {data.checklist.map((item) => (
            <div
              key={item.id}
              className={`rounded-2xl border-2 p-4 transition ${corBg(item.status)}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-3">
                  <div className="text-3xl">{item.icone}</div>
                  <div className="flex-1">
                    <div className={`font-semibold ${corTexto(item.status)}`}>
                      {item.titulo}
                      {item.status === "verde" && <span className="ml-2">✓</span>}
                    </div>
                    <div className="text-sm text-[#3D2314]/70">{item.descricao}</div>
                  </div>
                </div>
                {item.status !== "verde" && (
                  <a
                    href={item.link}
                    className="rounded-lg bg-[#3D2314] px-4 py-2 text-sm text-[#FAF7F2] transition hover:bg-[#5C3A24]"
                  >
                    Resolver →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* SERVIÇOS CONTRATADOS */}
        <div className="mt-8 rounded-2xl bg-[#FAF7F2] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#3D2314]">Serviços contratados</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.servicos_contratados)
              .filter(([_, v]) => v)
              .map(([k]) => (
                <span
                  key={k}
                  className="rounded-full bg-[#C8941A]/20 px-3 py-1 text-xs text-[#3D2314]"
                >
                  {k.replace(/_/g, " ")}
                </span>
              ))}
            {Object.values(data.servicos_contratados).every((v) => !v) && (
              <span className="text-xs italic text-[#3D2314]/50">
                Nenhum serviço marcado
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between text-xs text-[#3D2314]/60">
          <span>
            <kbd className="rounded border border-[#3D2314]/20 bg-white px-1.5 py-0.5 font-mono">
              Esc
            </kbd>{" "}
            voltar
          </span>
          <span>
            <kbd className="rounded border border-[#3D2314]/20 bg-white px-1.5 py-0.5 font-mono">
              Ctrl+R
            </kbd>{" "}
            atualizar score
          </span>
        </div>
      </main>
    </div>
  );
}
