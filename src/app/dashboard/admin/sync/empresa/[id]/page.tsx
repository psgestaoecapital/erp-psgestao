// src/app/dashboard/admin/sync/empresa/[id]/page.tsx
// Detalhe de empresa específica: configuração + saúde + últimas 20 operações

"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/authFetch";
import {
  H1,
  Breadcrumb,
  ModoBadge,
  StatusBadge,
  fmtDateTime,
  shortNome,
} from "../../_components";

interface Config {
  company_id: string;
  provider: string;
  sync_mode: string;
  soft_launch_active: boolean | null;
  max_ops_dia: number | null;
  max_valor_operacao: number | null;
  ops_permitidas: string[] | null;
  ops_hoje: number | null;
}

interface Saude {
  saude: string;
  ops_24h_total: number;
  ops_24h_sucesso: number;
  ops_24h_erro: number;
  dead_letter: number;
  tempo_medio_segundos: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
}

interface Op {
  id: string;
  operacao: string;
  status: string;
  shadow_run: boolean;
  tentativas: number;
  created_at: string;
}

export default function EmpresaSyncDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [config, setConfig] = useState<Config | null>(null);
  const [saude, setSaude] = useState<Saude | null>(null);
  const [ultimas, setUltimas] = useState<Op[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(false);
  const [confirmacao, setConfirmacao] = useState<"promover" | "pausar" | "reativar" | null>(null);
  const [motivoPausa, setMotivoPausa] = useState("");

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [cfgR, saudeR, opsR] = await Promise.all([
        supabase
          .from("erp_provider_config")
          .select("*")
          .eq("company_id", id)
          .eq("provider", "omie")
          .maybeSingle(),
        supabase
          .from("v_sync_health")
          .select("*")
          .eq("company_id", id)
          .maybeSingle(),
        supabase
          .from("erp_outbox_sync")
          .select("id, operacao, status, shadow_run, tentativas, created_at")
          .eq("company_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (cfgR.error && cfgR.error.code !== "PGRST116") throw cfgR.error;
      if (saudeR.error && saudeR.error.code !== "PGRST116") throw saudeR.error;
      if (opsR.error) throw opsR.error;
      setConfig((cfgR.data as any) || null);
      setSaude((saudeR.data as any) || null);
      setUltimas((opsR.data as any[]) || []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line
  }, [id]);

  async function executarAcao() {
    if (!config || !confirmacao) return;
    setAcaoEmAndamento(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      if (confirmacao === "promover") {
        const { error } = await supabase.rpc("fn_provider_promover_para_write_back", {
          p_company_id: id,
          p_provider: config.provider || "omie",
          p_motivo: "Promoção via UI detalhe empresa",
        });
        if (error) throw error;
        setAviso("Empresa promovida para Write-back");
      }
      if (confirmacao === "pausar") {
        if (!motivoPausa.trim()) {
          setErro("Informe o motivo da pausa.");
          setAcaoEmAndamento(false);
          return;
        }
        const { error } = await supabase.rpc("fn_provider_pausar_emergencia", {
          p_company_id: id,
          p_provider: config.provider || "omie",
          p_motivo: motivoPausa,
        });
        if (error) throw error;
        setAviso("Empresa pausada");
      }
      if (confirmacao === "reativar") {
        const { error } = await supabase
          .from("erp_provider_config")
          .update({ sync_mode: "read_only" })
          .eq("company_id", id)
          .eq("provider", config.provider || "omie");
        if (error) throw error;
        setAviso("Empresa reativada em read-only");
      }
      setTimeout(() => setAviso(null), 5000);
      setMotivoPausa("");
      setConfirmacao(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcaoEmAndamento(false);
    }
  }

  const empresaNome = saude ? shortNome(saude) : "—";

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="px-6 pt-4 pb-2">
        <Breadcrumb
          items={[
            { label: "Início", href: "/dashboard" },
            { label: "Sync Multi-ERP", href: "/dashboard/admin/sync" },
            { label: empresaNome },
          ]}
        />
      </div>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <H1>{empresaNome}</H1>
            <p className="mt-1 text-sm text-[#3D2314]/60">Configuração e operações de sincronia</p>
          </div>
          {config && <ModoBadge modo={config.sync_mode} />}
        </header>

        {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
        {aviso && (
          <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>
        )}

        {loading && <div className="text-[#3D2314]/60">Carregando…</div>}

        {!loading && !config && (
          <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-[#3D2314]">Empresa sem configuração de sync</h3>
            <p className="mt-2 text-sm text-[#3D2314]/60">
              Esta empresa ainda não tem registro em <code>erp_provider_config</code>.
            </p>
          </div>
        )}

        {config && (
          <>
            {/* Config + Saúde */}
            <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Card configuração */}
              <div className="rounded-xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
                <h2
                  className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#3D2314]/60"
                  style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                >
                  Configuração
                </h2>
                <KV label="Provider" valor={config.provider} mono />
                <KV label="Modo atual" valor={config.sync_mode} />
                <KV
                  label="Soft launch ativo"
                  valor={config.soft_launch_active ? "Sim" : "Não"}
                />
                {config.soft_launch_active && (
                  <>
                    <KV
                      label="Limite ops/dia"
                      valor={config.max_ops_dia ? String(config.max_ops_dia) : "—"}
                    />
                    <KV
                      label="Operações hoje"
                      valor={`${config.ops_hoje ?? 0}${
                        config.max_ops_dia ? ` / ${config.max_ops_dia}` : ""
                      }`}
                    />
                    <KV
                      label="Limite valor / op"
                      valor={
                        config.max_valor_operacao
                          ? config.max_valor_operacao.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "—"
                      }
                    />
                  </>
                )}
                {config.ops_permitidas && config.ops_permitidas.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs uppercase tracking-wider text-[#3D2314]/50">
                      Operações permitidas
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {config.ops_permitidas.map((op) => (
                        <span
                          key={op}
                          className="rounded-full bg-[#3D2314]/8 px-2 py-0.5 font-mono text-xs text-[#3D2314]"
                        >
                          {op}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card saúde */}
              <div className="rounded-xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
                <h2
                  className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#3D2314]/60"
                  style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                >
                  Saúde
                </h2>
                <KV label="Status" valor={saude?.saude || "—"} />
                <KV
                  label="Ops 24h total"
                  valor={String(saude?.ops_24h_total ?? 0)}
                />
                <KV
                  label="Ops 24h sucesso"
                  valor={String(saude?.ops_24h_sucesso ?? 0)}
                />
                <KV
                  label="Ops 24h erro"
                  valor={String(saude?.ops_24h_erro ?? 0)}
                  tom={(saude?.ops_24h_erro ?? 0) > 0 ? "vermelho" : undefined}
                />
                <KV
                  label="Dead letter"
                  valor={String(saude?.dead_letter ?? 0)}
                  tom={(saude?.dead_letter ?? 0) > 0 ? "vermelho" : undefined}
                />
                <KV
                  label="Tempo médio"
                  valor={
                    saude?.tempo_medio_segundos != null
                      ? `${saude.tempo_medio_segundos.toFixed(1)}s`
                      : "—"
                  }
                />
              </div>
            </section>

            {/* Últimas operações */}
            <section className="mb-6 rounded-xl border border-[#3D2314]/8 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-[#3D2314]/8 p-4">
                <h2
                  className="text-sm font-semibold uppercase tracking-wider text-[#3D2314]/60"
                  style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                >
                  Últimas 20 operações
                </h2>
              </div>
              {ultimas.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#3D2314]/60">
                  Nenhuma operação registrada ainda
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#3D2314]/3 text-xs uppercase tracking-wider text-[#3D2314]/60">
                    <tr>
                      <th className="px-4 py-2 text-left">Data</th>
                      <th className="px-4 py-2 text-left">Operação</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-center">Shadow</th>
                      <th className="px-4 py-2 text-center">Tent.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#3D2314]/8">
                    {ultimas.map((op) => (
                      <tr key={op.id}>
                        <td className="px-4 py-2 text-[#3D2314]/70">{fmtDateTime(op.created_at)}</td>
                        <td className="px-4 py-2 font-mono text-xs text-[#3D2314]/80">{op.operacao}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={op.status} />
                        </td>
                        <td className="px-4 py-2 text-center text-yellow-700">
                          {op.shadow_run ? "👤" : ""}
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-[#3D2314]/70">
                          {op.tentativas}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Ações */}
            <section className="flex flex-wrap gap-3">
              {config.sync_mode === "shadow_mode" && (
                <button
                  onClick={() => setConfirmacao("promover")}
                  className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-medium text-white hover:bg-[#A87810]"
                >
                  Avaliar e promover
                </button>
              )}
              {config.sync_mode === "write_back" && (
                <button
                  onClick={() => setConfirmacao("pausar")}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Pausar emergência
                </button>
              )}
              {config.sync_mode === "paused" && (
                <button
                  onClick={() => setConfirmacao("reativar")}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Reativar em read-only
                </button>
              )}
              <button
                onClick={() => router.push("/dashboard/admin/sync")}
                className="rounded-lg border border-[#3D2314]/12 bg-white px-4 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5"
              >
                ← Voltar ao painel
              </button>
            </section>
          </>
        )}
      </main>

      {/* Modal confirmação */}
      {confirmacao && config && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setConfirmacao(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-bold text-[#3D2314]">
              {confirmacao === "promover" && "Promover para Write-back"}
              {confirmacao === "pausar" && "Pausar emergência"}
              {confirmacao === "reativar" && "Reativar em read-only"}
            </h3>
            <p className="mb-4 text-sm text-[#3D2314]/70">
              {confirmacao === "promover" &&
                "A partir daqui, operações serão executadas no provider real (Omie). Confirma?"}
              {confirmacao === "pausar" &&
                "Operações pendentes serão suspensas. Informe motivo abaixo."}
              {confirmacao === "reativar" && "A empresa volta a ler do provider sem escrever."}
            </p>
            {confirmacao === "pausar" && (
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
                onClick={executarAcao}
                disabled={acaoEmAndamento}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  confirmacao === "pausar"
                    ? "bg-red-600 hover:bg-red-700"
                    : confirmacao === "reativar"
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

function KV({
  label,
  valor,
  mono,
  tom,
}: {
  label: string;
  valor: string;
  mono?: boolean;
  tom?: "vermelho";
}) {
  const cor = tom === "vermelho" ? "text-red-700" : "text-[#3D2314]";
  return (
    <div className="flex items-center justify-between border-b border-[#3D2314]/8 py-2 text-sm last:border-0">
      <span className="text-[#3D2314]/60">{label}</span>
      <span className={`font-medium ${cor} ${mono ? "font-mono text-xs" : ""}`}>{valor}</span>
    </div>
  );
}
