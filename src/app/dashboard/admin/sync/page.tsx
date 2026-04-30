// src/app/dashboard/admin/sync/page.tsx
// Dashboard Sync Multi-ERP - resumo + tabela empresas + avaliação promoção

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { ModoBadge, H1, SectionLabel, Breadcrumb, fmtDateTime } from "./_components";

interface SyncEmpresa {
  company_id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  provider: string;
  sync_mode: string;
  saude: string;
  ops_24h_total: number;
  ops_24h_sucesso: number;
  ops_24h_erro: number;
  dead_letter: number;
  tempo_medio_segundos: number | null;
  soft_launch_active: boolean | null;
  ops_hoje: number | null;
  max_ops_dia: number | null;
}

interface AvaliacaoPromocao {
  pode_promover: boolean;
  motivos_bloqueio?: string[];
  condicoes?: Record<string, boolean | { ok: boolean; detalhe?: string }>;
  [key: string]: any;
}

interface HealthAlert {
  company_id?: string;
  empresa?: string;
  tipo?: string;
  mensagem?: string;
  severidade?: string;
  [key: string]: any;
}

export default function SyncDashboardPage() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<SyncEmpresa[]>([]);
  const [alertas, setAlertas] = useState<HealthAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avaliacaoOpen, setAvaliacaoOpen] = useState<{ id: string; nome: string } | null>(null);
  const [avaliacao, setAvaliacao] = useState<AvaliacaoPromocao | null>(null);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<{
    tipo: "promover" | "pausar" | "reativar";
    empresa: SyncEmpresa;
  } | null>(null);
  const [motivoPausa, setMotivoPausa] = useState("");

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [{ data: emp, error: e1 }, healthRes] = await Promise.all([
        supabase.from("v_sync_health").select("*"),
        supabase.rpc("fn_sync_health_check"),
      ]);
      if (e1) throw e1;
      setEmpresas((emp as any[]) || []);
      // RPC pode retornar array, objeto único ou null. Normaliza para array.
      const h = healthRes.data;
      setAlertas(Array.isArray(h) ? h : h ? [h] : []);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar painel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    const interval = setInterval(carregar, 30000); // polling 30s
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, []);

  async function abrirAvaliacao(emp: SyncEmpresa) {
    setAvaliacao(null);
    setAvaliacaoOpen({ id: emp.company_id, nome: emp.nome_fantasia || emp.razao_social || "—" });
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_avaliar_promocao_write_back", {
        p_company_id: emp.company_id,
        p_provider: emp.provider || "omie",
      });
      if (error) throw error;
      setAvaliacao(data as AvaliacaoPromocao);
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function executarPromover(emp: SyncEmpresa) {
    setAcaoEmAndamento(emp.company_id);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("fn_provider_promover_para_write_back", {
        p_company_id: emp.company_id,
        p_provider: emp.provider || "omie",
        p_motivo: "Shadow validado pelo CEO via UI",
      });
      if (error) throw error;
      setAviso(`${emp.nome_fantasia || emp.razao_social} promovida para Write-back`);
      setTimeout(() => setAviso(null), 5000);
      setAvaliacaoOpen(null);
      setConfirmacao(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function executarPausar(emp: SyncEmpresa) {
    if (!motivoPausa.trim()) {
      setErro("Informe o motivo da pausa de emergência.");
      return;
    }
    setAcaoEmAndamento(emp.company_id);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("fn_provider_pausar_emergencia", {
        p_company_id: emp.company_id,
        p_provider: emp.provider || "omie",
        p_motivo: motivoPausa,
      });
      if (error) throw error;
      setAviso(`${emp.nome_fantasia || emp.razao_social} pausada`);
      setTimeout(() => setAviso(null), 5000);
      setMotivoPausa("");
      setConfirmacao(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function executarReativar(emp: SyncEmpresa) {
    setAcaoEmAndamento(emp.company_id);
    try {
      const supabase = supabaseBrowser();
      // Reativa setando sync_mode de volta para read_only
      const { error } = await supabase
        .from("erp_provider_config")
        .update({ sync_mode: "read_only" })
        .eq("company_id", emp.company_id)
        .eq("provider", emp.provider || "omie");
      if (error) throw error;
      setAviso(`${emp.nome_fantasia || emp.razao_social} reativada em read-only`);
      setTimeout(() => setAviso(null), 5000);
      setConfirmacao(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  const totais = {
    ativas: empresas.filter((e) => e.sync_mode !== "paused").length,
    ops24h: empresas.reduce((s, e) => s + (e.ops_24h_total || 0), 0),
    alertas: alertas.length,
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="px-6 pt-4 pb-2">
        <Breadcrumb
          items={[
            { label: "Início", href: "/dashboard" },
            { label: "Administração" },
            { label: "Sync Multi-ERP" },
          ]}
        />
      </div>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <H1>Sync Multi-ERP</H1>
            <p className="mt-1 text-sm text-[#3D2314]/60">
              Operação e monitoramento do Outbox Pattern · shadow mode + soft launch
            </p>
          </div>
          <button
            onClick={carregar}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </header>

        {erro && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        )}
        {aviso && (
          <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>
        )}

        {/* SEÇÃO 1: Resumo geral */}
        <section className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
          <ResumoCard label="Empresas com sync ativo" valor={totais.ativas} />
          <ResumoCard label="Operações nas últimas 24h" valor={totais.ops24h} />
          <ResumoCard
            label="Alertas ativos"
            valor={totais.alertas}
            tom={totais.alertas > 0 ? "vermelho" : "verde"}
          />
        </section>

        {/* Alertas */}
        {alertas.length > 0 && (
          <section className="mb-8 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-900">
              <AlertTriangle size={16} />
              Alertas do health check
            </div>
            <ul className="space-y-1 text-sm text-yellow-900/90">
              {alertas.slice(0, 5).map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span>•</span>
                  <span>
                    {a.empresa && <strong>{a.empresa}: </strong>}
                    {a.mensagem || a.tipo || JSON.stringify(a)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* SEÇÃO 2: Tabela de empresas */}
        <section className="mb-8">
          <SectionLabel>Empresas em sincronia</SectionLabel>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
                <tr>
                  <th className="px-4 py-3 text-left">Empresa</th>
                  <th className="px-4 py-3 text-left">Modo</th>
                  <th className="px-4 py-3 text-left">Saúde</th>
                  <th className="px-4 py-3 text-left">Ops 24h</th>
                  <th className="px-4 py-3 text-left">Soft Launch</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3D2314]/8">
                {loading && empresas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#3D2314]/50">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!loading && empresas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#3D2314]/50">
                      Nenhuma empresa configurada
                    </td>
                  </tr>
                )}
                {empresas.map((emp) => (
                  <tr key={`${emp.company_id}-${emp.provider}`} className="hover:bg-[#3D2314]/3">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/admin/sync/empresa/${emp.company_id}`}
                        className="font-medium text-[#3D2314] hover:underline"
                      >
                        {emp.nome_fantasia || emp.razao_social || "—"}
                      </Link>
                      <div className="text-xs text-[#3D2314]/50">{emp.provider}</div>
                    </td>
                    <td className="px-4 py-3">
                      <ModoBadge modo={emp.sync_mode} />
                    </td>
                    <td className="px-4 py-3">
                      <SaudePill saude={emp.saude} />
                    </td>
                    <td className="px-4 py-3 text-[#3D2314]">
                      {emp.ops_24h_sucesso || 0} / {emp.ops_24h_total || 0}
                      {emp.ops_24h_erro > 0 && (
                        <span className="ml-2 text-xs text-red-700">
                          ({emp.ops_24h_erro} erro{emp.ops_24h_erro > 1 ? "s" : ""})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#3D2314]/70">
                      {emp.soft_launch_active && emp.max_ops_dia
                        ? `${emp.ops_hoje ?? 0}/${emp.max_ops_dia} hoje`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {emp.sync_mode === "shadow_mode" && (
                        <button
                          onClick={() => abrirAvaliacao(emp)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#C8941A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#A87810]"
                        >
                          Avaliar promoção
                          <ArrowRight size={12} />
                        </button>
                      )}
                      {emp.sync_mode === "write_back" && (
                        <button
                          onClick={() => setConfirmacao({ tipo: "pausar", empresa: emp })}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Pausar
                        </button>
                      )}
                      {emp.sync_mode === "paused" && (
                        <button
                          onClick={() => setConfirmacao({ tipo: "reativar", empresa: emp })}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Reativar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SEÇÃO 3: Avaliação de promoção */}
        {avaliacaoOpen && (
          <section className="mb-8 rounded-xl border border-[#C8941A]/40 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3
                  className="text-lg font-medium text-[#3D2314]"
                  style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                >
                  Avaliação de promoção · {avaliacaoOpen.nome}
                </h3>
                <p className="text-xs text-[#3D2314]/60">
                  Verificando se a empresa está pronta para sair de Shadow para Write-back
                </p>
              </div>
              <button
                onClick={() => {
                  setAvaliacaoOpen(null);
                  setAvaliacao(null);
                }}
                className="text-[#3D2314]/60 hover:text-[#3D2314]"
              >
                ✕
              </button>
            </div>

            {!avaliacao ? (
              <div className="text-sm text-[#3D2314]/60">Avaliando…</div>
            ) : (
              <>
                {/* Condições em cards */}
                {avaliacao.condicoes && (
                  <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
                    {Object.entries(avaliacao.condicoes).map(([nome, val]) => {
                      const ok = typeof val === "boolean" ? val : !!val?.ok;
                      const detalhe = typeof val === "object" && val ? val.detalhe : null;
                      return (
                        <div
                          key={nome}
                          className={`rounded-lg border p-3 text-xs ${
                            ok
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-red-200 bg-red-50 text-red-900"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-semibold">
                            {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            {nome.replace(/_/g, " ")}
                          </div>
                          {detalhe && <div className="mt-1 opacity-80">{detalhe}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Motivos de bloqueio */}
                {avaliacao.motivos_bloqueio && avaliacao.motivos_bloqueio.length > 0 && (
                  <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                    <div className="mb-1 font-semibold">Bloqueios:</div>
                    <ul className="list-disc pl-5">
                      {avaliacao.motivos_bloqueio.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* CTA promover */}
                {avaliacao.pode_promover ? (
                  <button
                    onClick={() => {
                      const emp = empresas.find((e) => e.company_id === avaliacaoOpen.id);
                      if (emp) setConfirmacao({ tipo: "promover", empresa: emp });
                    }}
                    className="w-full rounded-lg bg-[#C8941A] py-3 text-sm font-semibold text-white hover:bg-[#A87810]"
                  >
                    Promover para Write-back
                  </button>
                ) : (
                  <div className="rounded-lg bg-[#3D2314]/5 p-3 text-center text-sm text-[#3D2314]/70">
                    Empresa ainda não está pronta para promoção. Resolva os bloqueios acima primeiro.
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>

      {/* MODAL CONFIRMAÇÃO */}
      {confirmacao && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setConfirmacao(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-bold text-[#3D2314]">
              {confirmacao.tipo === "promover" && "Promover para Write-back"}
              {confirmacao.tipo === "pausar" && "Pausar emergência"}
              {confirmacao.tipo === "reativar" && "Reativar em read-only"}
            </h3>

            <p className="mb-4 text-sm text-[#3D2314]/70">
              {confirmacao.tipo === "promover" && (
                <>
                  Confirma promover <strong>{confirmacao.empresa.nome_fantasia || confirmacao.empresa.razao_social}</strong>{" "}
                  de Shadow Mode para Write-back? A partir daqui, operações serão executadas no provider real.
                </>
              )}
              {confirmacao.tipo === "pausar" && (
                <>
                  Confirma pausar <strong>{confirmacao.empresa.nome_fantasia || confirmacao.empresa.razao_social}</strong>?
                  Operações pendentes serão suspensas.
                </>
              )}
              {confirmacao.tipo === "reativar" && (
                <>
                  Reativar <strong>{confirmacao.empresa.nome_fantasia || confirmacao.empresa.razao_social}</strong> em read-only? A empresa volta a ler do provider sem escrever.
                </>
              )}
            </p>

            {confirmacao.tipo === "pausar" && (
              <textarea
                value={motivoPausa}
                onChange={(e) => setMotivoPausa(e.target.value)}
                placeholder="Motivo da pausa (obrigatório)..."
                rows={3}
                className="mb-4 w-full rounded-lg border border-[#3D2314]/12 bg-white p-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmacao(null);
                  setMotivoPausa("");
                }}
                className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (confirmacao.tipo === "promover") executarPromover(confirmacao.empresa);
                  if (confirmacao.tipo === "pausar") executarPausar(confirmacao.empresa);
                  if (confirmacao.tipo === "reativar") executarReativar(confirmacao.empresa);
                }}
                disabled={!!acaoEmAndamento}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  confirmacao.tipo === "pausar"
                    ? "bg-red-600 hover:bg-red-700"
                    : confirmacao.tipo === "reativar"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-[#C8941A] hover:bg-[#A87810]"
                }`}
              >
                {acaoEmAndamento ? "Executando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoCard({
  label,
  valor,
  tom,
}: {
  label: string;
  valor: number;
  tom?: "verde" | "vermelho";
}) {
  const cor =
    tom === "verde" ? "text-emerald-700" : tom === "vermelho" ? "text-red-700" : "text-[#3D2314]";
  return (
    <div className="rounded-xl border border-[#3D2314]/12 bg-white p-5 shadow-sm">
      <div className="mb-2 text-xs uppercase tracking-wider text-[#3D2314]/50">{label}</div>
      <div className={`text-2xl font-medium ${cor}`} style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
        {valor}
      </div>
    </div>
  );
}

function SaudePill({ saude }: { saude: string }) {
  const map: Record<string, { emoji: string; label: string; cls: string }> = {
    saudavel: { emoji: "🟢", label: "Saudável", cls: "text-emerald-700" },
    atencao: { emoji: "🟡", label: "Atenção", cls: "text-yellow-700" },
    critico: { emoji: "🔴", label: "Crítico", cls: "text-red-700" },
  };
  const m = map[saude] || { emoji: "⚪", label: saude || "—", cls: "text-[#3D2314]/60" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>
      <span>{m.emoji}</span>
      {m.label}
    </span>
  );
}
