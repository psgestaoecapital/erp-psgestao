// src/app/dashboard/bpo/foco/page.tsx
// Landing Modo Foco: lista empresas que o operador atende
// ordenadas por score (pior primeiro - quem mais precisa de atencao)

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface EmpresaFoco {
  company_id: string;
  empresa: string;
  papel: string;
  score: number;
  inbox_pendente: number;
  inbox_vencido: number;
  conciliacao_pendente: number;
  classificacao_pendente: number;
  pior_dimensao: string | null;
}

export default function FocoLandingPage() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<EmpresaFoco[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "criticas">("todas");

  useEffect(() => {
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login");
          return;
        }
        const data = await rpc<EmpresaFoco[]>("fn_bpo_listar_empresas_foco", {
          p_user_id: user.id,
        });
        setEmpresas(data || []);
      } catch (e: any) {
        setErro(e.message || "Não foi possível carregar empresas");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const visiveis = empresas.filter((e) => filtro === "criticas" ? e.score < 60 : true);

  function corScore(s: number) {
    if (s >= 80) return "text-emerald-700 bg-emerald-100";
    if (s >= 50) return "text-yellow-800 bg-yellow-100";
    return "text-red-800 bg-red-100";
  }

  function corPapel(p: string) {
    if (p === "titular") return "bg-[#C8941A]/20 text-[#3D2314]";
    if (p === "backup") return "bg-blue-100 text-blue-800";
    return "bg-[#3D2314] text-[#FAF7F2]";
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <a href="/dashboard/bpo/meu-dia" className="text-sm text-[#C8941A] hover:underline">
            ← Voltar ao Meu Dia
          </a>
          <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">Modo Foco</h1>
          <p className="mt-1 text-sm text-[#3D2314]/70">
            Selecione uma empresa para ver checklist completo de fechamento. As mais críticas aparecem primeiro.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setFiltro("todas")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filtro === "todas"
                ? "bg-[#3D2314] text-[#FAF7F2]"
                : "bg-[#FAF7F2] text-[#3D2314]"
            }`}
          >
            Todas ({empresas.length})
          </button>
          <button
            onClick={() => setFiltro("criticas")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filtro === "criticas"
                ? "bg-red-600 text-white"
                : "bg-[#FAF7F2] text-[#3D2314]"
            }`}
          >
            Críticas ({empresas.filter((e) => e.score < 60).length})
          </button>
        </div>

        {erro && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        )}

        {loading ? (
          <div className="text-[#3D2314]/60">Calculando saúde das empresas…</div>
        ) : visiveis.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
            <div className="mb-4 text-5xl">🏢</div>
            <h3 className="text-lg font-semibold text-[#3D2314]">Nenhuma empresa</h3>
            <p className="mt-2 text-sm text-[#3D2314]/70">
              Você ainda não está atribuído a nenhuma empresa BPO.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visiveis.map((emp) => (
              <button
                key={emp.company_id}
                onClick={() => router.push(`/dashboard/bpo/foco/${emp.company_id}`)}
                className="group rounded-2xl bg-[#FAF7F2] p-4 text-left transition hover:shadow-lg"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-semibold text-[#3D2314]">{emp.empresa}</div>
                    <div className="mt-1 flex gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${corPapel(emp.papel)}`}>
                        {emp.papel}
                      </span>
                    </div>
                  </div>
                  <div className={`rounded-xl px-3 py-1.5 text-center ${corScore(emp.score)}`}>
                    <div className="text-2xl font-bold leading-none">{emp.score}</div>
                    <div className="text-[10px] uppercase">/ 100</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <Mini label="Inbox" valor={emp.inbox_pendente} alerta={emp.inbox_vencido > 0} />
                  <Mini
                    label="Concil"
                    valor={emp.conciliacao_pendente}
                    alerta={emp.conciliacao_pendente > 100}
                  />
                  <Mini
                    label="IA"
                    valor={emp.classificacao_pendente}
                    alerta={emp.classificacao_pendente > 20}
                  />
                </div>

                <div className="mt-3 text-xs text-[#C8941A] group-hover:underline">
                  Abrir Modo Foco →
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Mini({ label, valor, alerta }: { label: string; valor: number; alerta?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${alerta ? "bg-red-50" : "bg-white"}`}>
      <div className="text-[10px] uppercase text-[#3D2314]/60">{label}</div>
      <div className={`text-lg font-bold ${alerta ? "text-red-700" : "text-[#3D2314]"}`}>
        {valor}
      </div>
    </div>
  );
}
