"use client";
// Consultor IA — AGENTE que investiga e explica (PR B, SPEC Eng. Chefe · RD-101 · CEO 17/11).
// Texto livre ("por quê") → /api/consultor-ia: o agente usa ferramentas, LÊ os dados e explica (streaming dos
// passos + Resposta/Por quê/O que fazer + "Ver os dados" + trava de número). Tem custo (teto global + por empresa).
// Atalhos (chips, situação de parceiro, Raio-X) → /api/consultor-ia/atalho e RPC direta: DETERMINÍSTICOS e GRÁTIS.
// Empresa SEMPRE a do seletor do topo (LGPD/isolamento por CNPJ). Tema CLARO do ERP (Espresso em off-white).
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AjudaCampo from "@/components/ajuda/AjudaCampo";
import { useEmpresaSelecionada } from "@/hooks/useEmpresaSelecionada";
import { Lock } from "lucide-react";

const ESP = "#3D2314", GO = "#C8941A", OW = "#FAF7F2", CARD = "#FFFFFF", BD = "#E7DED3",
  TXM = "#6B5D4F", TXD = "#918C82", GRN = "#1F5A1F", RED = "#B91C1C", Y = "#8A5A00";

type Achado = { codigo: string; categoria: string; severidade: "alta" | "media" | "baixa"; titulo: string; mensagem: string; como_corrigir: string; rota_link: string };
type Raiox = { ok: boolean; erro?: string; resumo?: { alta: number; media: number; baixa: number; total: number }; achados?: Achado[] };
type DiagParceiro = { codigo: string; frase: string; link?: string };
type TituloParceiro = { id: string; natureza: string; vencimento?: string; valor?: number; juros?: number; multa?: number; desconto?: number; valor_pago?: number; saldo?: number; status?: string; conciliado?: boolean; link?: string };
type OpcaoParceiro = { tipo: string; id: string; nome: string; cidade?: string; documento_mascarado?: string };
type Resposta = {
  ok: boolean; bloqueado?: boolean; naoEntendi?: boolean; mensagem?: string; error?: string;
  tipo?: "lista" | "valor" | "cliente" | "raiox" | "divergencia" | "lista_lancamentos" | "situacao_parceiro"; titulo?: string; resumo?: string;
  kpis?: any; linhas?: any[]; valor?: number; achados?: Achado[];
  contas?: { conta_id: string; conta_nome: string; saldo_sistema: number; saldo_banco: number; diferenca: number; rota_link?: string }[];
  contas_sem_extrato?: { conta_nome: string; saldo_sistema?: number }[];
  parceiro?: { nome?: string; tipo?: string; cidade?: string; documento_mascarado?: string | null };
  titulos?: TituloParceiro[]; diagnosticos?: DiagParceiro[];
  totais?: { em_aberto?: number; vencido?: number; pago_periodo?: number; juros_receber?: number; juros_pagar?: number };
  opcoes?: OpcaoParceiro[];
};
type AgenteResp = { texto: string; verDados: unknown[]; avisoNumeros: string[] };
type Hist = { role: "user" | "assistant"; texto: string };

// Atalhos GRÁTIS (determinísticos): o botão já sabe a ferramenta — nada de IA.
const CHIPS: { label: string; tool: string; params?: Record<string, unknown> }[] = [
  { label: "Contas a receber que vencem hoje", tool: "contas_receber", params: { periodo: "hoje" } },
  { label: "Despesas que vencem amanhã", tool: "contas_pagar", params: { periodo: "amanha" } },
  { label: "Quais clientes estão inadimplentes?", tool: "inadimplentes" },
  { label: "Qual o saldo das minhas contas?", tool: "saldo_contas" },
  { label: "Meu saldo bate com o banco?", tool: "divergencia_saldo" },
  { label: "Lançamentos sem conciliar", tool: "lancamentos_sem_conciliar" },
  { label: "Lançamentos sem CNPJ", tool: "lancamentos_sem_cnpj" },
];
const ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR: Record<string, string> = { alta: RED, media: Y, baixa: GRN };
const DOT: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "🟢" };
const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (s?: string) => { if (!s) return "—"; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

// Render leve do markdown do agente: **negrito** e quebras de linha; sem lib.
function Prosa({ texto }: { texto: string }) {
  return (
    <div style={{ fontSize: 13.5, color: ESP, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
      {texto.split("\n").map((linha, i) => (
        <div key={i} style={{ marginBottom: linha.trim() ? 4 : 8 }}>
          {linha.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
            p.startsWith("**") && p.endsWith("**")
              ? <strong key={j} style={{ color: ESP }}>{p.slice(2, -2)}</strong>
              : <span key={j}>{p}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ConsultorIAPage() {
  const router = useRouter();
  const { companyId } = useEmpresaSelecionada();
  const empresa = companyId ?? "";
  const empresaRef = useRef(empresa);
  // id de sessão gerado UMA vez (initializer do useState — puro para a render; o ref só expõe o valor).
  const [sessaoId] = useState<string>(() => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2)}`);
  const sessaoRef = useRef<string>(sessaoId);
  const [empresaInfo, setEmpresaInfo] = useState<{ nome: string; cnpj: string } | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [nomeParceiro, setNomeParceiro] = useState("");
  const [loading, setLoading] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null); // resultado dos ATALHOS (determinístico)
  const [raiox, setRaiox] = useState<Raiox | null>(null);
  const [erro, setErro] = useState("");
  // Agente (texto livre):
  const [agente, setAgente] = useState<AgenteResp | null>(null);
  const [passos, setPassos] = useState<string[]>([]);
  const [verDadosAberto, setVerDadosAberto] = useState(false);
  const [historico, setHistorico] = useState<Hist[]>([]);
  const [ultimaPergunta, setUltimaPergunta] = useState("");
  const [fb, setFb] = useState<null | boolean>(null);
  const [oqueFaltou, setOqueFaltou] = useState("");
  const [fbEnviado, setFbEnviado] = useState(false);

  useEffect(() => {
    empresaRef.current = empresa;
    setResposta(null); setRaiox(null); setErro(""); setEmpresaInfo(null); setAgente(null); setPassos([]); setHistorico([]); setFb(null); setFbEnviado(false);
    if (!empresa) return;
    let vivo = true;
    supabase.from("companies").select("nome_fantasia, razao_social, cnpj").eq("id", empresa).maybeSingle()
      .then(({ data }) => { if (!vivo || !data) return; const d = data as { nome_fantasia?: string | null; razao_social?: string | null; cnpj?: string | null }; setEmpresaInfo({ nome: d.nome_fantasia || d.razao_social || "", cnpj: d.cnpj || "" }); });
    return () => { vivo = false; };
  }, [empresa]);

  function limparRespostas() { setResposta(null); setRaiox(null); setErro(""); setAgente(null); setPassos([]); setVerDadosAberto(false); setFb(null); setFbEnviado(false); setOqueFaltou(""); }

  // AGENTE (texto livre) — streaming SSE: mostra os passos ao vivo e a resposta final.
  async function perguntarAgente(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || !empresa) return;
    const alvo = empresa;
    if (texto) setPergunta(texto);
    limparRespostas(); setLoading(true); setUltimaPergunta(q);
    const histEnviar = historico.slice(-10);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/consultor-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ pergunta: q, company_id: alvo, sessao_id: sessaoRef.current, historico: histEnviar }),
      });
      if (!res.ok || !res.body) { setErro("Não consegui responder agora. Tente de novo."); setLoading(false); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let textoFinal = "";
      let avisos: string[] = [];
      let verDados: unknown[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (empresaRef.current !== alvo) { reader.cancel(); setLoading(false); return; }
        buf += dec.decode(value, { stream: true });
        const partes = buf.split("\n\n");
        buf = partes.pop() ?? "";
        for (const bloco of partes) {
          const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
          if (!linha) continue;
          let ev: any; try { ev = JSON.parse(linha.slice(5).trim()); } catch { continue; }
          if (ev.tipo === "passo" && ev.texto) setPassos((p) => [...p, ev.texto]);
          else if (ev.tipo === "aviso_numero") avisos = ev.valores || [];
          else if (ev.tipo === "resposta") { textoFinal = ev.texto || ""; verDados = ev.ver_dados || []; }
          else if (ev.tipo === "bloqueado" || ev.tipo === "erro") setErro(ev.mensagem || "Não consegui responder agora.");
        }
      }
      if (textoFinal) {
        setAgente({ texto: textoFinal, verDados, avisoNumeros: avisos });
        setHistorico((h) => [...h, { role: "user" as const, texto: q }, { role: "assistant" as const, texto: textoFinal }].slice(-20));
      } else if (!erro) setErro("Não consegui montar a resposta agora. Tente reformular ou use um atalho.");
    } catch { setErro("Falha de conexão. Tente de novo em instantes."); }
    setLoading(false);
  }

  // ATALHO determinístico (grátis) — o cliente diz a ferramenta; o servidor executa e devolve o payload de render.
  async function atalho(tool: string, params?: Record<string, unknown>) {
    if (!empresa) return;
    const alvo = empresa;
    limparRespostas(); setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/consultor-ia/atalho", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ tool, params: params ?? {}, company_id: alvo }),
      });
      const j = (await res.json()) as Resposta;
      if (empresaRef.current !== alvo) { setLoading(false); return; }
      if (!res.ok || j.ok === false) { setErro(j.error || "Não consegui buscar agora. Tente de novo."); setLoading(false); return; }
      setResposta(j);
    } catch { setErro("Falha de conexão. Tente de novo em instantes."); }
    setLoading(false);
  }

  // Raio-X determinístico (grátis).
  async function rodarRaiox() {
    if (!empresa) return;
    const alvo = empresa;
    limparRespostas(); setLoading(true);
    const { data, error } = await supabase.rpc("fn_consultor_raiox", { p_company_id: alvo });
    if (empresaRef.current !== alvo) { setLoading(false); return; }
    if (error) { setErro("Não consegui analisar agora. Tente de novo."); setLoading(false); return; }
    const r = data as Raiox;
    if (r && r.ok === false) { setErro(r.erro === "sem_acesso" ? "Você não tem acesso aos dados desta empresa." : "Não consegui analisar agora."); setLoading(false); return; }
    setRaiox(r); setLoading(false);
  }

  async function enviarFeedback(util: boolean) {
    setFb(util);
    if (util) { // 👍 grava na hora; 👎 só depois de dizer o que faltou
      await gravarFeedback(true, "");
    }
  }
  async function gravarFeedback(util: boolean, oque: string) {
    if (!empresa || !agente) return;
    try {
      await supabase.rpc("fn_consultor_feedback_registrar", {
        p_company_id: empresa, p_sessao_id: sessaoRef.current, p_pergunta: ultimaPergunta.slice(0, 500),
        p_resposta_resumo: agente.texto.slice(0, 1000), p_util: util, p_o_que_faltou: oque.slice(0, 1000) || null,
      });
    } catch { /* feedback nunca bloqueia */ }
    setFbEnviado(true);
  }

  const achados = (resposta?.tipo === "raiox" ? resposta.achados : raiox?.achados) || [];
  const achadosOrd = achados.slice().sort((a, b) => (ORDEM[a.severidade] ?? 3) - (ORDEM[b.severidade] ?? 3));

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px", color: ESP }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: ESP, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>💬</span> Consultor IA · seu analista financeiro
        </div>
        <div style={{ fontSize: 12.5, color: TXM, marginTop: 3, lineHeight: 1.5, maxWidth: 580 }}>
          Pergunte <strong style={{ color: ESP }}>“por que o saldo do cliente X está negativo?”</strong> — eu investigo nos seus dados e explico o porquê e o que fazer. Os atalhos abaixo são gratuitos.
        </div>
      </div>

      {/* EMPRESA CONSULTADA */}
      <div data-testid="consultor-empresa" style={{ background: empresa ? "#F3EDE3" : "#FDF2E9", border: `1px solid ${empresa ? BD : GO}`, borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: ESP }}>
        {empresa
          ? <><Lock size={13} strokeWidth={1.5} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden /><AjudaCampo chave="inteligencia.consultor.empresa" /> Consultando só os dados de <strong>{empresaInfo?.nome || "…"}</strong>{empresaInfo?.cnpj ? <> · CNPJ {empresaInfo.cnpj}</> : null}. Para outra empresa, troque no seletor do topo.</>
          : <>Selecione <strong>uma empresa</strong> no seletor do topo. O assistente responde por um CNPJ de cada vez e não mistura dados de empresas.</>}
      </div>

      {/* AVISO LGPD (com "?") */}
      <div style={{ background: "#F7F3EC", border: `1px solid ${BD}`, borderRadius: 10, padding: "7px 12px", marginBottom: 12, fontSize: 11.5, color: TXM, display: "flex", alignItems: "center", gap: 2 }}>
        <AjudaCampo chave="inteligencia.consultor.lgpd" /> As respostas são geradas por IA a partir dos dados desta empresa. Só os dados necessários para a sua pergunta são enviados ao provedor de IA, que não os usa para treinar modelos. O assistente nunca altera nada — ele explica e mostra o link para você corrigir.
      </div>

      {/* CAIXA DE PERGUNTA */}
      <div style={{ background: CARD, borderRadius: 14, border: `1px solid ${BD}`, padding: 14, marginBottom: 14, boxShadow: "0 1px 3px rgba(61,35,20,0.05)" }}>
        <label data-ajuda="inteligencia.consultor.sintoma" style={{ display: "block" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
            Pergunte sobre seus dados<AjudaCampo chave="inteligencia.consultor.sintoma" />
          </div>
          <textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntarAgente(); } }}
            placeholder="Ex.: por que o saldo do IGP está negativo se ele pagou o boleto com juros?"
            rows={2}
            style={{ width: "100%", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {CHIPS.map((c) => (
            <button key={c.label} type="button" onClick={() => atalho(c.tool, c.params)} disabled={loading || !empresa}
              style={{ background: OW, border: `1px solid ${BD}`, color: TXM, borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: loading || !empresa ? "not-allowed" : "pointer" }}>
              {c.label}
            </button>
          ))}
        </div>
        {/* ATALHO: situação de UM cliente/fornecedor (grátis, determinístico) */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BD}` }}>
          <label data-ajuda="inteligencia.consultor.situacao_parceiro" style={{ display: "block" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
              Situação de um cliente ou fornecedor<AjudaCampo chave="inteligencia.consultor.situacao_parceiro" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={nomeParceiro} onChange={(e) => setNomeParceiro(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && nomeParceiro.trim()) { e.preventDefault(); atalho("situacao_parceiro", { termo: nomeParceiro.trim() }); } }}
                placeholder="Nome ou CNPJ — ex.: IGP Cereais"
                style={{ flex: "1 1 220px", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              <button type="button" onClick={() => nomeParceiro.trim() && atalho("situacao_parceiro", { termo: nomeParceiro.trim() })} disabled={loading || !empresa || !nomeParceiro.trim()}
                style={{ borderRadius: 10, border: `1px solid ${GO}`, background: "transparent", color: ESP, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: loading || !empresa || !nomeParceiro.trim() ? "not-allowed" : "pointer" }}>
                Ver situação
              </button>
            </div>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => perguntarAgente()} disabled={loading || !empresa || !pergunta.trim()}
            style={{ flex: "1 1 220px", borderRadius: 10, border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: loading || !empresa || !pergunta.trim() ? "not-allowed" : "pointer", color: "#fff", background: loading || !empresa || !pergunta.trim() ? "#CDB89A" : `linear-gradient(135deg,${ESP},${GO})` }}>
            {loading ? "Investigando…" : "Perguntar ao analista"}
          </button>
          <button type="button" onClick={rodarRaiox} disabled={loading || !empresa}
            style={{ borderRadius: 10, border: `1px solid ${GO}`, background: "transparent", color: ESP, padding: "12px 16px", fontSize: 13, fontWeight: 600, cursor: loading || !empresa ? "not-allowed" : "pointer" }}>
            🔎 Raio-X (grátis)
          </button>
        </div>
      </div>

      {/* ERRO */}
      {erro && <div style={{ background: "#FBEAEA", border: `1px solid #E6B8B8`, borderRadius: 10, padding: 12, color: RED, fontSize: 12.5, marginBottom: 12 }}>{erro}
        <button type="button" onClick={rodarRaiox} style={{ display: "block", marginTop: 8, background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🔎 Rodar Raio-X (grátis)</button>
      </div>}

      {/* PASSOS do agente (streaming) */}
      {loading && passos.length > 0 && (
        <div data-testid="consultor-passos" style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
          {passos.map((p, i) => (
            <div key={i} style={{ fontSize: 12.5, color: i === passos.length - 1 ? ESP : TXM, display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
              <span>{i === passos.length - 1 ? "⏳" : "✓"}</span> {p}
            </div>
          ))}
        </div>
      )}

      {/* RESPOSTA DO AGENTE (texto livre) */}
      {agente && (
        <div data-testid="consultor-resposta-agente" style={{ marginBottom: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: `4px solid ${GO}`, borderRadius: 12, padding: "14px 16px" }}>
            <Prosa texto={agente.texto} />
            {agente.avisoNumeros.length > 0 && (
              <div style={{ marginTop: 10, background: "#FBF3DE", border: `1px solid ${GO}`, borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: Y }}>
                Confira este valor: {agente.avisoNumeros.join(", ")} — não encontrei esse valor exato nos dados consultados.
              </div>
            )}
          </div>

          {/* VER OS DADOS (recolhido) */}
          {agente.verDados.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setVerDadosAberto((v) => !v)}
                style={{ background: "transparent", border: `1px solid ${BD}`, color: TXM, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                {verDadosAberto ? "Ocultar os dados" : "Ver os dados que usei"}
              </button>
              {verDadosAberto && (
                <pre style={{ marginTop: 8, background: OW, border: `1px solid ${BD}`, borderRadius: 10, padding: 12, fontSize: 11, color: TXM, overflowX: "auto", maxHeight: 360 }}>
                  {JSON.stringify(agente.verDados, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* FEEDBACK 👍/👎 + o que faltou (com "?") */}
          <div data-ajuda="inteligencia.consultor.feedback" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: TXM, display: "flex", alignItems: "center" }}>A resposta ajudou?<AjudaCampo chave="inteligencia.consultor.feedback" /></span>
            {fbEnviado ? (
              <span style={{ fontSize: 12, color: GRN, fontWeight: 600 }}>Obrigado pelo retorno!</span>
            ) : (
              <>
                <button type="button" onClick={() => enviarFeedback(true)} aria-label="Ajudou"
                  style={{ background: fb === true ? "#EAF4EA" : "transparent", border: `1px solid ${BD}`, borderRadius: 8, padding: "5px 12px", fontSize: 14, cursor: "pointer" }}>👍</button>
                <button type="button" onClick={() => setFb(false)} aria-label="Não ajudou"
                  style={{ background: fb === false ? "#FBEAEA" : "transparent", border: `1px solid ${BD}`, borderRadius: 8, padding: "5px 12px", fontSize: 14, cursor: "pointer" }}>👎</button>
                {fb === false && (
                  <div style={{ display: "flex", gap: 8, flex: "1 1 240px", flexWrap: "wrap" }}>
                    <input value={oqueFaltou} onChange={(e) => setOqueFaltou(e.target.value)} placeholder="O que faltou?"
                      style={{ flex: "1 1 180px", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 8, padding: "7px 10px", fontSize: 12.5, outline: "none", boxSizing: "border-box" }} />
                    <button type="button" onClick={() => gravarFeedback(false, oqueFaltou)}
                      style={{ border: `1px solid ${GO}`, background: "transparent", color: ESP, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Enviar</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* RESPOSTA DOS ATALHOS (determinística) */}
      {resposta?.ok && resposta.naoEntendi && (
        <div style={{ background: "#FBF3DE", border: `1px solid ${GO}`, borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 13, color: ESP, fontWeight: 600 }}>{resposta.mensagem}</div>
      )}
      {resposta?.ok && !resposta.naoEntendi && resposta.resumo && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: `4px solid ${GO}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontWeight: 600, color: ESP }}>
            {resposta.resumo}
          </div>

          {resposta.tipo === "lista" && (resposta.linhas?.length ?? 0) > 0 && (
            <div style={{ overflowX: "auto", marginTop: 10, border: `1px solid ${BD}`, borderRadius: 12, background: CARD }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: OW, color: ESP }}>
                  {["Cliente/Fornecedor", "Descrição", "Vencimento", "Valor", "Situação"].map((h) => <th key={h} style={{ textAlign: h === "Valor" ? "right" : "left", padding: "8px 10px", fontWeight: 700, borderBottom: `1px solid ${BD}` }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {resposta.linhas!.slice(0, 100).map((l: any, i: number) => (
                    <tr key={l.id ?? i} style={{ borderBottom: `1px solid ${BD}` }}>
                      <td style={{ padding: "7px 10px" }}>{l.nome_pessoa || "—"}</td>
                      <td style={{ padding: "7px 10px", color: TXM }}>{l.descricao || l.numero_documento || "—"}</td>
                      <td style={{ padding: "7px 10px" }}>{fmtData(l.data_vencimento)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>{brl(l.valor_documento ?? l.valor_pago)}</td>
                      <td style={{ padding: "7px 10px", color: TXM }}>{l.situacao || l.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resposta.tipo === "situacao_parceiro" && (
            <div style={{ marginTop: 10 }}>
              {(resposta.opcoes?.length ?? 0) > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {resposta.opcoes!.map((o) => (
                    <button key={o.id} type="button" onClick={() => atalho("situacao_parceiro", { termo: o.nome, tipo: o.tipo })}
                      style={{ textAlign: "left", background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "10px 14px", cursor: "pointer" }}>
                      <span style={{ fontWeight: 700, color: ESP }}>{o.nome}</span>
                      <span style={{ fontSize: 12, color: TXM }}> · {o.tipo === "fornecedor" ? "fornecedor" : "cliente"}{o.cidade ? ` · ${o.cidade}` : ""}{o.documento_mascarado ? ` · ${o.documento_mascarado}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
              {(resposta.diagnosticos?.length ?? 0) > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: (resposta.titulos?.length ?? 0) ? 10 : 0 }}>
                  {resposta.diagnosticos!.map((d, i) => (
                    <div key={`${d.codigo}-${i}`} style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: `4px solid ${GO}`, borderRadius: 12, padding: "10px 14px" }}>
                      <div style={{ fontSize: 12.5, color: ESP, lineHeight: 1.5 }}>{d.frase}</div>
                      {d.link && (
                        <button type="button" onClick={() => router.push(d.link!)}
                          style={{ marginTop: 8, background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Abrir título →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {resposta.totais && (resposta.titulos?.length ?? 0) > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {([["Em aberto", resposta.totais.em_aberto], ["Vencido", resposta.totais.vencido], ["Pago no período", resposta.totais.pago_periodo], ["Juros", resposta.parceiro?.tipo === "fornecedor" ? resposta.totais.juros_pagar : resposta.totais.juros_receber]] as [string, number | undefined][]).map(([rot, val]) => (
                    <div key={rot} style={{ flex: "1 1 120px", background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: "8px 12px" }}>
                      <div style={{ fontSize: 10.5, color: TXM, textTransform: "uppercase", letterSpacing: 0.4 }}>{rot}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: Number(val) < 0 ? RED : ESP }}>{brl(Number(val || 0))}</div>
                    </div>
                  ))}
                </div>
              )}
              {(resposta.titulos?.length ?? 0) > 0 && (
                <div style={{ overflowX: "auto", border: `1px solid ${BD}`, borderRadius: 12, background: CARD }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: OW, color: ESP }}>
                      {["Vencimento", "Valor", "Pago", "Saldo", "Situação", ""].map((h, i) => <th key={i} style={{ textAlign: i >= 1 && i <= 3 ? "right" : "left", padding: "8px 10px", fontWeight: 700, borderBottom: `1px solid ${BD}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resposta.titulos!.map((t) => (
                        <tr key={t.id} style={{ borderBottom: `1px solid ${BD}` }}>
                          <td style={{ padding: "7px 10px" }}>{fmtData(t.vencimento)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{brl(t.valor)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{brl(t.valor_pago)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: Number(t.saldo) < 0 ? RED : ESP }}>{brl(t.saldo)}</td>
                          <td style={{ padding: "7px 10px", color: TXM }}>{t.status || "—"}{!t.conciliado && (t.status === "pago" || t.status === "recebido") ? <span style={{ marginLeft: 6, background: "#FDF2E9", color: Y, borderRadius: 999, padding: "1px 8px", fontWeight: 600 }}>sem conciliar</span> : null}</td>
                          <td style={{ padding: "7px 10px" }}>{t.link && <button type="button" onClick={() => router.push(t.link!)} style={{ background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Abrir →</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {resposta.tipo === "divergencia" && (
            <div style={{ marginTop: 10 }}>
              {(resposta.contas?.length ?? 0) > 0 && (
                <div style={{ overflowX: "auto", border: `1px solid ${BD}`, borderRadius: 12, background: CARD }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: OW, color: ESP }}>
                      {["Conta", "Sistema", "Banco", "Diferença", ""].map((h, i) => <th key={i} style={{ textAlign: i === 0 || i === 4 ? "left" : "right", padding: "8px 10px", fontWeight: 700, borderBottom: `1px solid ${BD}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resposta.contas!.map((c) => (
                        <tr key={c.conta_id} style={{ borderBottom: `1px solid ${BD}` }}>
                          <td style={{ padding: "7px 10px", fontWeight: 600 }}>{c.conta_nome}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{brl(c.saldo_sistema)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{brl(c.saldo_banco)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: RED }}>{brl(c.diferenca)}</td>
                          <td style={{ padding: "7px 10px" }}>
                            <button type="button" onClick={() => router.push(c.rota_link || "/dashboard/financeiro/conciliacao/inbox")}
                              style={{ background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                              Abrir conciliação →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(resposta.contas_sem_extrato?.length ?? 0) > 0 && (
                <div style={{ fontSize: 12, color: TXM, marginTop: 8 }}>Sem extrato para comparar: {resposta.contas_sem_extrato!.map((c) => c.conta_nome).join(", ")}.</div>
              )}
              {(resposta.linhas?.length ?? 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ESP, marginBottom: 6 }}>Lançamentos sem conciliar que explicam a diferença</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {resposta.linhas!.map((l: any, i: number) => (
                      <div key={l.id ?? i} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                          <div style={{ fontWeight: 700, color: ESP, fontSize: 13 }}>{l.descricao || l.numero_documento || "Lançamento"}<span style={{ fontWeight: 500, color: TXM, fontSize: 11, marginLeft: 6 }}>{l.natureza === "pagar" ? "a pagar" : "a receber"}</span></div>
                          <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>{l.contraparte_nome || "Sem fornecedor/cliente"} · {l.contraparte_cnpj ? `CNPJ/CPF ${l.contraparte_cnpj}` : <span style={{ color: RED, fontWeight: 600 }}>sem CNPJ</span>}</div>
                          <div style={{ fontSize: 11.5, color: TXM, marginTop: 2 }}>Venc. {fmtData(l.data_vencimento)}{l.data_pagamento ? ` · pago em ${fmtData(l.data_pagamento)}` : ""}{l.conta ? ` · ${l.conta}` : ""} · {l.status || "—"}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontWeight: 700, color: ESP, fontSize: 13.5 }}>{brl(l.valor)}</span>
                          {l.rota_link && <button type="button" onClick={() => router.push(l.rota_link)} style={{ background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Abrir lançamento →</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {resposta.tipo === "lista_lancamentos" && (resposta.linhas?.length ?? 0) > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {resposta.linhas!.map((l: any, i: number) => (
                <div key={l.id ?? i} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <div style={{ fontWeight: 700, color: ESP, fontSize: 13 }}>{l.descricao || l.numero_documento || "Lançamento"}<span style={{ fontWeight: 500, color: TXM, fontSize: 11, marginLeft: 6 }}>{l.natureza === "pagar" ? "a pagar" : "a receber"}</span></div>
                    <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>{l.contraparte_nome || "Sem fornecedor/cliente"} · {l.contraparte_cnpj ? `CNPJ/CPF ${l.contraparte_cnpj}` : <span style={{ color: RED, fontWeight: 600 }}>sem CNPJ</span>}</div>
                    <div style={{ fontSize: 11.5, color: TXM, marginTop: 2 }}>Venc. {fmtData(l.data_vencimento)}{l.data_pagamento ? ` · pago em ${fmtData(l.data_pagamento)}` : ""}{l.conta ? ` · ${l.conta}` : ""} · {l.status || "—"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, color: ESP, fontSize: 13.5 }}>{brl(l.valor)}</span>
                    {l.rota_link && <button type="button" onClick={() => router.push(l.rota_link)} style={{ background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Abrir lançamento →</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {resposta.tipo === "valor" && (
            <div style={{ marginTop: 10, background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: Number(resposta.valor) < 0 ? RED : ESP }}>{brl(resposta.valor)}</div>
              <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>saldo atual das contas bancárias</div>
            </div>
          )}
        </div>
      )}

      {/* RAIO-X determinístico */}
      {(raiox?.ok || resposta?.tipo === "raiox") && (
        <div style={{ marginBottom: 12 }}>
          {achadosOrd.length === 0 ? (
            <div style={{ background: "#EAF4EA", border: `1px solid #B8D8B8`, borderRadius: 14, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: ESP, marginTop: 6 }}>Analisei tudo e não achei problema</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {achadosOrd.map((a, i) => (
                <div key={`${a.codigo}-${i}`} style={{ background: CARD, borderRadius: 14, border: `1px solid ${BD}`, borderLeft: `4px solid ${COR[a.severidade] || BD}`, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14 }}>{DOT[a.severidade] || "•"}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{a.titulo}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: TXM, lineHeight: 1.6 }}>{a.mensagem}</div>
                  <div style={{ marginTop: 8, background: OW, borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: Y }}>Como corrigir</span>
                    <div style={{ fontSize: 12, color: ESP, marginTop: 2, lineHeight: 1.5 }}>{a.como_corrigir}</div>
                  </div>
                  {a.rota_link && (
                    <button type="button" onClick={() => router.push(a.rota_link)}
                      style={{ marginTop: 10, background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Ir pra tela →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: TXD, textAlign: "center", marginTop: 16 }}>
        O analista investiga nos seus dados, pela empresa da sua sessão, e todo número vem do seu banco. Os atalhos e o Raio-X não têm custo.
      </div>
    </div>
  );
}
