"use client";
// Ficha 360° do cliente Wealth (padrão premium). Header dinâmico (fn_wealth_cliente_resumo) + 7 abas.
// As telas Suitability/IPS/Recomendações viram abas recebendo clienteId do contexto (sem dropdown).
// Preserva o fluxo de conexão Open Finance (Pluggy) e upload OFX na aba Carteira.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ChevronLeft, RefreshCw, Plus, FileUp, AlertCircle, TrendingUp, FileText } from "lucide-react";
import { ClienteKPIs } from "./cliente-kpis";
import { ClientePositionsTable } from "./cliente-positions-table";
import { ClienteConexoesSection } from "./cliente-conexoes-section";
import { TermoConsentModal } from "./termo-consent-modal";
import { PluggyWidgetWrapper } from "./pluggy-widget-wrapper";
import { OFXUploadModal } from "./ofx-upload-modal";
import { SyncHistorySection } from "./sync-history-section";
import { SuitabilityPanel } from "./panels/suitability-panel";
import { ContratoIpsPanel } from "./panels/contrato-ips-panel";
import { RecomendacoesPanel } from "./panels/recomendacoes-panel";
import { ESP, GOLD, BG, LINE, MUT, fmtBRL, fmtData, Avatar, PerfilChip, Pizza, LegendaClasses, BarrasAderencia, type Desvio } from "./wealth-ui";

interface ClienteDetalheViewProps { clienteId: string }
type FluxoConectar = "idle" | "termo" | "widget";
interface PluggyItemData { item: { id: string; connector: { id: number; name: string; type?: string } } }

type Alerta = { tipo: string; severidade: string; msg: string };
type ResumoCliente = {
  id: string; nome: string; foto_url: string | null; perfil_risco: string | null; status: string | null;
  consultor_nome: string | null; pep: boolean | null; investidor_qualificado: boolean | null;
  investidor_profissional: boolean | null; renda_mensal: number | null; patrimonio_declarado: number | null;
  profissao: string | null; email: string | null; telefone: string | null;
};
type Resumo = {
  ok: boolean; erro?: string; cliente: ResumoCliente; aum: number; alocacao_atual: Record<string, number>;
  aderencia: { success?: boolean; desvios?: Desvio[]; ips_versao?: number };
  perfil: string | null; perfil_valido_ate: string | null; perfil_vencido: boolean; tem_ips_aprovado: boolean; alertas: Alerta[];
};

type Aba = "visao" | "carteira" | "perfil" | "ips" | "recomendacoes" | "kyc" | "relatorios";
const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "visao", label: "Visão Geral" }, { id: "carteira", label: "Carteira" }, { id: "perfil", label: "Perfil" },
  { id: "ips", label: "Contrato + IPS" }, { id: "recomendacoes", label: "Recomendações" },
  { id: "kyc", label: "KYC / Compliance" }, { id: "relatorios", label: "Relatórios" },
];

export function ClienteDetalheView({ clienteId }: ClienteDetalheViewProps) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [aba, setAba] = useState<Aba>("visao");

  const [fluxoConectar, setFluxoConectar] = useState<FluxoConectar>("idle");
  const [consentId, setConsentId] = useState<string | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [showOfxModal, setShowOfxModal] = useState(false);

  const refreshAll = useCallback(() => setRefreshKey((k) => k + 1), []);

  const carregarResumo = useCallback(async () => {
    const [{ data: r }, { data: c }] = await Promise.all([
      supabase.rpc("fn_wealth_cliente_resumo", { p_client_id: clienteId }),
      supabase.from("wealth_clients").select("company_id").eq("id", clienteId).maybeSingle(),
    ]);
    const j = (r ?? null) as Resumo | null;
    if (!j?.ok) { setError(j?.erro ?? "Cliente não encontrado ou sem permissão"); setResumo(null); }
    else { setResumo(j); setError(null); }
    setCompanyId((c as { company_id?: string } | null)?.company_id ?? null);
    setLoading(false);
  }, [clienteId]);

  useEffect(() => { let alive = true; setLoading(true); void carregarResumo().finally(() => { if (!alive) return; }); return () => { alive = false }; }, [carregarResumo, refreshKey]);

  const handleConectarClick = () => setFluxoConectar("termo");
  const handleTermoAceito = async (newConsentId: string) => {
    setConsentId(newConsentId); setTokenLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pluggy-connect-token`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ client_id: clienteId, consent_id: newConsentId }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || `HTTP ${resp.status}`); }
      const { connect_token } = await resp.json();
      setConnectToken(connect_token); setFluxoConectar("widget");
    } catch (e) { alert(`Erro ao iniciar conexão: ${(e as Error).message}`); setFluxoConectar("idle"); }
    finally { setTokenLoading(false); }
  };
  const handleTermoCancelado = () => { setFluxoConectar("idle"); setConsentId(null); };
  const handlePluggySuccess = async (itemData: PluggyItemData) => {
    if (!consentId) { alert("Consent ID ausente - reinicie o fluxo."); setFluxoConectar("idle"); return; }
    try {
      const { data: localItemId, error: rpcErr } = await supabase.rpc("sp_pluggy_register_item", {
        p_client_id: clienteId, p_consent_id: consentId, p_pluggy_item_id: itemData.item.id,
        p_connector_id: itemData.item.connector.id, p_connector_name: itemData.item.connector.name,
        p_connector_type: itemData.item.connector.type || null,
      });
      if (rpcErr) throw rpcErr;
      if (localItemId) await supabase.rpc("sp_pluggy_dispatch_sync", { p_item_id: localItemId, p_origem: "item_created" });
      setFluxoConectar("idle"); setConsentId(null); setConnectToken(null); refreshAll();
    } catch (e) { alert(`Conta conectada no Pluggy mas falha ao registrar localmente: ${(e as Error).message}`); }
  };
  const handlePluggyError = (err: unknown) => { console.error("Pluggy widget error:", err); setFluxoConectar("idle"); };
  const handleClosePluggy = () => { setFluxoConectar("idle"); setConsentId(null); setConnectToken(null); };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-4 rounded-full" style={{ borderColor: GOLD, borderTopColor: "transparent" }} /></div>;
  }
  if (error || !resumo) {
    return (
      <div className="rounded-lg border p-6" style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2" }}>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: "#DC2626" }} />
          <div>
            <p className="font-medium" style={{ color: "#7F1D1D" }}>Cliente não encontrado ou sem permissão</p>
            <p className="text-sm mt-1" style={{ color: "#B91C1C" }}>{error || "O cliente solicitado não está disponível"}</p>
            <Link href="/dashboard/wealth" className="inline-flex items-center gap-1 mt-3 text-sm underline" style={{ color: "#B91C1C" }}><ChevronLeft className="h-4 w-4" />Voltar para a lista</Link>
          </div>
        </div>
      </div>
    );
  }

  const c = resumo.cliente;

  return (
    <div className="space-y-5">
      <Link href="/dashboard/wealth" className="inline-flex items-center gap-1 text-sm hover:underline" style={{ color: MUT }}><ChevronLeft className="h-4 w-4" />Carteira de Clientes</Link>

      {/* Header premium */}
      <div className="rounded-2xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar nome={c.nome} foto={c.foto_url} size={60} />
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl truncate" style={{ color: ESP, fontFamily: "serif" }}>{c.nome}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <PerfilChip perfil={c.perfil_risco} />
                {c.pep && <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#F4E3D2", color: "#7A4A0F" }}>PEP</span>}
                {c.investidor_qualificado && <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#E4EDF3", color: "#25506B" }}>Inv. Qualificado</span>}
                {c.investidor_profissional && <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#E4EDF3", color: "#25506B" }}>Inv. Profissional</span>}
                {c.consultor_nome && <span className="text-xs" style={{ color: MUT }}>· Consultor: {c.consultor_nome}</span>}
              </div>
            </div>
          </div>
          <div className="text-left md:text-right">
            <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>AUM sob gestão</div>
            <div className="text-2xl md:text-3xl font-bold" style={{ color: ESP }}>{fmtBRL(resumo.aum)}</div>
          </div>
        </div>
        {/* Ações rápidas */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => setAba("recomendacoes")} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md" style={{ backgroundColor: ESP, color: BG }}><TrendingUp className="h-4 w-4" />Nova recomendação</button>
          <button onClick={() => setAba("relatorios")} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border" style={{ borderColor: LINE, color: ESP }}><FileText className="h-4 w-4" />Gerar relatório</button>
          <button onClick={() => setAba("perfil")} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border" style={{ borderColor: LINE, color: ESP }}><RefreshCw className="h-4 w-4" />Refazer suitability</button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: LINE }}>
        {ABAS.map((t) => {
          const on = aba === t.id;
          return (
            <button key={t.id} onClick={() => setAba(t.id)} className="px-3.5 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2"
              style={{ color: on ? ESP : MUT, fontWeight: on ? 700 : 500, borderColor: on ? GOLD : "transparent" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo */}
      {aba === "visao" && <VisaoGeral resumo={resumo} />}

      {aba === "carteira" && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={refreshAll} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border" style={{ borderColor: LINE, color: ESP }}><RefreshCw className="h-4 w-4" />Atualizar</button>
            <button onClick={handleConectarClick} disabled={tokenLoading} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md disabled:opacity-60" style={{ backgroundColor: ESP, color: BG }}><Plus className="h-4 w-4" />Conectar conta</button>
            <button onClick={() => setShowOfxModal(true)} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border" style={{ borderColor: LINE, color: ESP }}><FileUp className="h-4 w-4" />Upload OFX</button>
          </div>
          <ClienteKPIs clienteId={clienteId} key={`kpi-${refreshKey}`} />
          <ClientePositionsTable clienteId={clienteId} key={`pos-${refreshKey}`} />
        </div>
      )}

      {aba === "perfil" && companyId && <SuitabilityPanel clienteId={clienteId} empresa={companyId} onChange={refreshAll} />}
      {aba === "ips" && <ContratoIpsPanel clienteId={clienteId} perfil={resumo.perfil ?? c.perfil_risco} onChange={refreshAll} />}
      {aba === "recomendacoes" && <RecomendacoesPanel clienteId={clienteId} onChange={refreshAll} />}

      {aba === "kyc" && <KycCompliance c={c} clienteId={clienteId} refreshKey={refreshKey} onChange={refreshAll} />}

      {aba === "relatorios" && (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: LINE, background: "#fff" }}>
          <FileText className="h-10 w-10 mx-auto mb-3" style={{ color: "rgba(61,35,20,0.3)" }} />
          <p style={{ color: ESP, fontWeight: 600 }}>Relatório mensal</p>
          <p className="text-sm mt-1" style={{ color: MUT }}>Última tela da Fase 1 · performance + posições + comparativo. Em breve.</p>
        </div>
      )}

      {showOfxModal && <OFXUploadModal clienteId={clienteId} onClose={() => setShowOfxModal(false)} onSuccess={refreshAll} />}
      {fluxoConectar === "termo" && <TermoConsentModal clienteId={clienteId} onAceitar={handleTermoAceito} onCancelar={handleTermoCancelado} />}
      {tokenLoading && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 shadow-xl"><div className="animate-spin h-8 w-8 border-4 rounded-full mx-auto" style={{ borderColor: GOLD, borderTopColor: "transparent" }} /><p className="mt-3 text-sm" style={{ color: ESP }}>Preparando conexão segura...</p></div>
        </div>
      )}
      {fluxoConectar === "widget" && connectToken && <PluggyWidgetWrapper connectToken={connectToken} onSuccess={handlePluggySuccess} onError={handlePluggyError} onClose={handleClosePluggy} />}
    </div>
  );
}

function VisaoGeral({ resumo }: { resumo: Resumo }) {
  const desvios = resumo.aderencia?.desvios ?? [];
  const alertas = resumo.alertas ?? [];
  const sevCor: Record<string, [string, string]> = { alta: ["#FCEEEE", "#7A1F1F"], media: ["#FFF6E9", "#7A4A0F"], baixa: ["#F0F4F0", "#2F5D2F"] };
  return (
    <div className="grid gap-4">
      {alertas.length > 0 && (
        <section className="grid gap-2">
          {alertas.map((a, i) => {
            const [bg, fg] = sevCor[a.severidade] ?? ["#F3EBDD", "#7A4A0F"];
            return <div key={i} className="rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2" style={{ borderColor: LINE, background: bg, color: fg }}><AlertCircle className="h-4 w-4 flex-shrink-0" />{a.msg}</div>;
          })}
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
          <h3 className="text-lg mb-3" style={{ color: ESP, fontFamily: "serif" }}>Alocação atual</h3>
          {Object.keys(resumo.alocacao_atual ?? {}).length === 0 ? <p className="text-sm" style={{ color: MUT }}>Sem posições registradas.</p> : (
            <div className="grid gap-4 sm:grid-cols-2 items-center"><Pizza aloc={resumo.alocacao_atual} /><LegendaClasses aloc={resumo.alocacao_atual} /></div>
          )}
        </section>
        <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg" style={{ color: ESP, fontFamily: "serif" }}>Aderência ao IPS</h3>
            {resumo.tem_ips_aprovado ? <span className="text-xs" style={{ color: MUT }}>IPS v{resumo.aderencia?.ips_versao}</span> : <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "#FFF3D9", color: "#7A4A0F" }}>sem IPS aprovado</span>}
          </div>
          {resumo.aderencia?.success && desvios.length > 0 ? <BarrasAderencia desvios={desvios} /> : <p className="text-sm" style={{ color: MUT }}>Aprove um IPS para medir a aderência da carteira.</p>}
        </section>
      </div>
      <section className="rounded-xl border p-5 grid gap-2 sm:grid-cols-3" style={{ borderColor: LINE, background: "#fff" }}>
        <Info label="AUM" valor={fmtBRL(resumo.aum)} />
        <Info label="Perfil vigente" valor={resumo.perfil ?? "—"} sub={resumo.perfil ? `válido até ${fmtData(resumo.perfil_valido_ate)}${resumo.perfil_vencido ? " (vencido)" : ""}` : "sem suitability"} alerta={resumo.perfil_vencido} />
        <Info label="IPS" valor={resumo.tem_ips_aprovado ? "Aprovado" : "Não aprovado"} alerta={!resumo.tem_ips_aprovado} />
      </section>
    </div>
  );
}

function Info({ label, valor, sub, alerta }: { label: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>{label}</div>
      <div className="text-lg mt-0.5 capitalize" style={{ color: alerta ? "#7A1F1F" : ESP, fontWeight: 600 }}>{valor}</div>
      {sub && <div className="text-xs" style={{ color: alerta ? "#7A1F1F" : MUT }}>{sub}</div>}
    </div>
  );
}

function KycCompliance({ c, clienteId, refreshKey, onChange }: { c: ResumoCliente; clienteId: string; refreshKey: number; onChange: () => void }) {
  const row = (label: string, valor: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b text-sm" style={{ borderColor: LINE }}>
      <span style={{ color: MUT }}>{label}</span><span style={{ color: ESP, fontWeight: 500 }}>{valor}</span>
    </div>
  );
  return (
    <div className="grid gap-5">
      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
        <h3 className="text-lg mb-2" style={{ color: ESP, fontFamily: "serif" }}>Cadastro & Compliance</h3>
        <div className="grid sm:grid-cols-2 gap-x-8">
          <div>
            {row("E-mail", c.email ?? "—")}
            {row("Telefone", c.telefone ?? "—")}
            {row("Profissão", c.profissao ?? "—")}
          </div>
          <div>
            {row("Renda mensal", fmtBRL(c.renda_mensal))}
            {row("Patrimônio declarado", fmtBRL(c.patrimonio_declarado))}
            {row("PEP", c.pep ? "Sim" : "Não")}
            {row("Investidor qualificado", c.investidor_qualificado ? "Sim" : "Não")}
          </div>
        </div>
      </section>
      <ClienteConexoesSection clienteId={clienteId} key={`con-${refreshKey}`} onChange={onChange} />
      <SyncHistorySection clienteId={clienteId} key={`syn-${refreshKey}`} />
    </div>
  );
}
