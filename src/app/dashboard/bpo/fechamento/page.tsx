// src/app/dashboard/bpo/fechamento/page.tsx
// ONDA 5 - Landing do Fechamento Mensal
// Mostra empresas e status de fechamento por mes referencia
// Botao "Executar lote" recalcula tudo. Por linha: ver detalhe, enviar email/whatsapp.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Fechamento {
  id: string;
  company_id: string;
  empresa: string;
  status: string;
  pronto_para_fechar: boolean;
  qtd_gaps: number;
  qtd_bloqueantes: number;
  receita: number | null;
  ebitda: number | null;
  margem_pct: number | null;
  pdf_gerado_em: string | null;
  enviado_email: boolean;
  enviado_whatsapp: boolean;
  link_portal: string;
  updated_at: string;
}

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function fmtMoney(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FechamentoLandingPage() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [fechamentos, setFechamentos] = useState<Fechamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [executando, setExecutando] = useState(false);

  // Mes referencia: default = mes anterior (fechamos abril em maio)
  const hoje = new Date();
  const mesPadrao = hoje.getDate() <= 5
    ? new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
    : new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  const [ano, setAno] = useState(mesPadrao.getFullYear());
  const [mes, setMes] = useState(mesPadrao.getMonth() + 1);

  const mesRef = `${ano}-${String(mes).padStart(2, "0")}-01`;

  async function verificarSupervisor() {
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return false;
    }
    const { data: sup } = await supabase
      .from("bpo_companies_assignment")
      .select("id")
      .eq("user_id", user.id)
      .eq("papel", "supervisor")
      .eq("ativo", true)
      .limit(1);
    return !!(sup && sup.length > 0);
  }

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const ok = await verificarSupervisor();
      if (!ok) { setAutorizado(false); return; }
      setAutorizado(true);

      const data = await rpc<Fechamento[]>("fn_bpo_fechamento_listar_mes", { p_mes_ref: mesRef });
      setFechamentos(data || []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar fechamentos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [mesRef]);

  async function executarLote() {
    if (!confirm(`Executar lote para ${MESES_PT[mes - 1]}/${ano}?\n\nIsso re-valida todas as empresas BPO e regenera os pacotes que estão prontos. Empresas já enviadas não são afetadas.`)) {
      return;
    }
    setExecutando(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      const r = await rpc<any>("fn_bpo_fechamento_executar_lote", {
        p_mes_ref: mesRef,
        p_user_id: user?.id || null,
      });
      setAviso(`Lote executado: ${r.prontos_gerados} prontos, ${r.bloqueados} bloqueados de ${r.total_empresas} empresas`);
      setTimeout(() => setAviso(null), 7000);
      await carregar();
    } catch (e: any) {
      setErro(e.message || "Não foi possível executar lote");
    } finally {
      setExecutando(false);
    }
  }

  if (autorizado === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="max-w-md text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="text-xl font-semibold text-[#3D2314]">Acesso restrito</h2>
          <p className="mt-2 text-sm text-[#3D2314]/70">
            Apenas supervisores podem acessar o fechamento mensal.
          </p>
        </div>
      </div>
    );
  }

  const prontos = fechamentos.filter((f) => f.pronto_para_fechar).length;
  const bloqueados = fechamentos.filter((f) => f.status === "bloqueado").length;
  const enviados = fechamentos.filter((f) => f.status === "enviado").length;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#3D2314]">Fechamento Mensal</h1>
              <p className="text-xs text-[#3D2314]/60">
                Gere e envie pacotes mensais de DRE/Fluxo aos clientes BPO.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value))}
                className="rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                {MESES_PT.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value))}
                className="rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                {[2025, 2026, 2027].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <button
                onClick={executarLote}
                disabled={executando}
                className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#A87810] disabled:opacity-50"
              >
                {executando ? "Executando..." : "⚡ Executar lote"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {(erro || aviso) && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
          {aviso && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>}
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-[#FAF7F2] p-4">
            <div className="text-xs uppercase text-[#3D2314]/60">Total empresas</div>
            <div className="mt-1 text-2xl font-bold text-[#3D2314]">{fechamentos.length}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4">
            <div className="text-xs uppercase text-emerald-700">Prontos</div>
            <div className="mt-1 text-2xl font-bold text-emerald-800">{prontos}</div>
          </div>
          <div className="rounded-xl bg-red-50 p-4">
            <div className="text-xs uppercase text-red-700">Bloqueados</div>
            <div className="mt-1 text-2xl font-bold text-red-800">{bloqueados}</div>
          </div>
          <div className="rounded-xl bg-[#C8941A]/10 p-4">
            <div className="text-xs uppercase text-[#C8941A]">Enviados</div>
            <div className="mt-1 text-2xl font-bold text-[#3D2314]">{enviados}</div>
          </div>
        </div>

        {loading ? (
          <div className="text-[#3D2314]/60">Carregando fechamentos...</div>
        ) : fechamentos.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
            <div className="mb-4 text-5xl">📊</div>
            <h3 className="text-lg font-semibold text-[#3D2314]">
              Nenhum fechamento para {MESES_PT[mes - 1]}/{ano}
            </h3>
            <p className="mt-2 text-sm text-[#3D2314]/70">
              Clique em &quot;Executar lote&quot; para gerar os fechamentos deste mês.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {fechamentos.map((f) => (
              <FechamentoCard key={f.id} f={f} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function FechamentoCard({ f }: { f: Fechamento }) {
  const cores: Record<string, { bg: string; pill: string }> = {
    gerado: { bg: "bg-emerald-50", pill: "bg-emerald-200 text-emerald-900" },
    enviado: { bg: "bg-[#C8941A]/10", pill: "bg-[#C8941A] text-white" },
    bloqueado: { bg: "bg-red-50", pill: "bg-red-200 text-red-900" },
    pendente: { bg: "bg-yellow-50", pill: "bg-yellow-200 text-yellow-900" },
    pronto_gerar: { bg: "bg-blue-50", pill: "bg-blue-200 text-blue-900" },
    cancelado: { bg: "bg-gray-50", pill: "bg-gray-200 text-gray-900" },
  };
  const cor = cores[f.status] || cores.pendente;

  return (
    <a
      href={`/dashboard/bpo/fechamento/${f.id}`}
      className={`block rounded-2xl p-4 transition hover:shadow-md ${cor.bg}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1">
          <div className="font-semibold text-[#3D2314]">{f.empresa}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#3D2314]/70">
            <span className={`rounded-full px-2 py-0.5 font-medium ${cor.pill}`}>
              {f.status}
            </span>
            {f.qtd_bloqueantes > 0 && (
              <span className="rounded-full bg-red-200 px-2 py-0.5 font-medium text-red-900">
                {f.qtd_bloqueantes} bloqueante{f.qtd_bloqueantes > 1 ? "s" : ""}
              </span>
            )}
            {f.qtd_gaps > f.qtd_bloqueantes && (
              <span className="rounded-full bg-yellow-200 px-2 py-0.5 font-medium text-yellow-900">
                {f.qtd_gaps - f.qtd_bloqueantes} aviso{f.qtd_gaps - f.qtd_bloqueantes > 1 ? "s" : ""}
              </span>
            )}
            {f.enviado_email && <span>✉ email enviado</span>}
            {f.enviado_whatsapp && <span>📱 wpp enviado</span>}
          </div>
        </div>
        {f.receita !== null && (
          <div className="flex gap-3 text-right">
            <div>
              <div className="text-xs text-[#3D2314]/60">Receita</div>
              <div className="font-semibold text-[#3D2314]">{fmtMoney(f.receita)}</div>
            </div>
            <div>
              <div className="text-xs text-[#3D2314]/60">EBITDA</div>
              <div
                className={`font-semibold ${
                  (f.ebitda || 0) >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {fmtMoney(f.ebitda)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#3D2314]/60">Margem</div>
              <div
                className={`font-semibold ${
                  (f.margem_pct || 0) >= 10 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {f.margem_pct?.toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </a>
  );
}
