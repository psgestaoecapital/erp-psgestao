"use client";
// Consultor IA — AGENTE ANALISTA (CEO 25/11, RD-101). Pergunta em linguagem natural → /api/consultor-ia (SSE):
// o agente consulta o banco DAQUELA empresa (company_id forçado no servidor), cruza e explica com números e links.
// Mostra os passos enquanto pensa; a resposta traz "Por quê", "O que fazer" e "Ver os dados". 👍/👎 por resposta.
// Atalho grátis: Raio-X determinístico (sem IA). Tema CLARO do ERP (Espresso em off-white).
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
type DadoFerramenta = { ferramenta: string; objetivo?: string; resultado: unknown };
type Agente = { resposta: string; dados: DadoFerramenta[]; numeros_a_conferir: string[]; custo_usd: number; rounds: number; limite: string | null };
type Mensagem = { role: "user" | "assistant"; content: string };

const CHIPS = ["Por que o saldo do IGP está negativo?", "Quem são os clientes que mais atrasam?", "Quanto paguei de juros este mês?", "Meu saldo bate com o banco?", "Por que o DRE caiu em relação ao mês passado?"];
const ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR: Record<string, string> = { alta: RED, media: Y, baixa: GRN };
const DOT: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "🟢" };

export default function ConsultorIAPage() {
  const router = useRouter();
  const { companyId } = useEmpresaSelecionada();
  const empresa = companyId ?? "";
  const empresaRef = useRef(empresa);
  const [empresaInfo, setEmpresaInfo] = useState<{ nome: string; cnpj: string } | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [nomeParceiro, setNomeParceiro] = useState("");
  const [loading, setLoading] = useState(false);
  const [passos, setPassos] = useState<string[]>([]);
  const [agente, setAgente] = useState<Agente | null>(null);
  const [perguntaFeita, setPerguntaFeita] = useState("");
  const [raiox, setRaiox] = useState<Raiox | null>(null);
  const [erro, setErro] = useState("");
  const [bloqueio, setBloqueio] = useState("");
  const [verDados, setVerDados] = useState(false);
  const [feedback, setFeedback] = useState<null | boolean>(null);
  const historicoRef = useRef<Mensagem[]>([]);

  useEffect(() => {
    empresaRef.current = empresa;
    setAgente(null); setRaiox(null); setErro(""); setBloqueio(""); setEmpresaInfo(null); setPassos([]); historicoRef.current = [];
    if (!empresa) return;
    let vivo = true;
    supabase.from("companies").select("nome_fantasia, razao_social, cnpj").eq("id", empresa).maybeSingle()
      .then(({ data }) => {
        if (!vivo || !data) return;
        const d = data as { nome_fantasia?: string | null; razao_social?: string | null; cnpj?: string | null };
        setEmpresaInfo({ nome: d.nome_fantasia || d.razao_social || "", cnpj: d.cnpj || "" });
      });
    return () => { vivo = false; };
  }, [empresa]);

  // Agente (SSE): mostra os passos enquanto pensa e, no fim, a resposta.
  async function perguntar(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || !empresa || loading) return;
    const alvo = empresa;
    if (texto) setPergunta(texto);
    setLoading(true); setErro(""); setBloqueio(""); setAgente(null); setRaiox(null); setPassos([]); setVerDados(false); setFeedback(null); setPerguntaFeita(q);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/consultor-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ pergunta: q, company_id: alvo, historico: historicoRef.current.slice(-10) }),
      });
      // bloqueio de custo/IA volta como JSON (não SSE)
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (empresaRef.current !== alvo) { setLoading(false); return; }
        if (j?.bloqueado) setBloqueio(j.mensagem || "Assistente indisponível agora.");
        else setErro(j?.error || "Não consegui responder agora.");
        setLoading(false); return;
      }
      if (!res.body) { setErro("Não consegui iniciar a análise."); setLoading(false); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const partes = buf.split("\n\n");
        buf = partes.pop() || "";
        for (const p of partes) {
          const linha = p.split("\n").find((l) => l.startsWith("data:"));
          if (!linha) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(linha.slice(5).trim()); } catch { continue; }
          if (empresaRef.current !== alvo) continue;
          if (ev.tipo === "passo") setPassos((ps) => [...ps, String(ev.texto)]);
          else if (ev.tipo === "erro") setErro(String(ev.mensagem || "Não consegui concluir a análise."));
          else if (ev.tipo === "resposta") {
            const a = ev as unknown as Agente;
            setAgente(a);
            historicoRef.current = [...historicoRef.current, { role: "user" as const, content: q }, { role: "assistant" as const, content: a.resposta }].slice(-10);
          }
        }
      }
    } catch { setErro("Falha de conexão. Tente de novo em instantes."); }
    setLoading(false);
  }

  async function enviarFeedback(util: boolean) {
    if (!empresa || !agente) return;
    setFeedback(util);
    try { await supabase.rpc("fn_consultor_ia_feedback", { p_company_id: empresa, p_util: util, p_pergunta: perguntaFeita, p_resposta: agente.resposta }); } catch { /* feedback é best-effort */ }
  }

  async function rodarRaiox() {
    if (!empresa || loading) return;
    const alvo = empresa;
    setLoading(true); setErro(""); setBloqueio(""); setAgente(null); setRaiox(null); setPassos([]);
    const { data, error } = await supabase.rpc("fn_consultor_raiox", { p_company_id: alvo });
    if (empresaRef.current !== alvo) { setLoading(false); return; }
    if (error) { setErro("Não consegui analisar agora. Tente de novo."); setLoading(false); return; }
    const r = data as Raiox;
    if (r && r.ok === false) { setErro(r.erro === "sem_acesso" ? "Você não tem acesso aos dados desta empresa." : "Não consegui analisar agora."); setLoading(false); return; }
    setRaiox(r); setLoading(false);
  }

  const achados = raiox?.achados || [];
  const achadosOrd = achados.slice().sort((a, b) => (ORDEM[a.severidade] ?? 3) - (ORDEM[b.severidade] ?? 3));

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px", color: ESP }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: ESP, display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <span style={{ fontSize: 24 }}>💬</span> Consultor IA · Analista dos seus dados
        </h1>
        <div style={{ fontSize: 12.5, color: TXM, marginTop: 3, lineHeight: 1.5, maxWidth: 600 }}>
          Pergunte em português — inclusive <strong style={{ color: ESP }}>“por quê”</strong>. Eu investigo nos seus dados, cruzo as fontes e explico com números e o link da tela. O Raio-X abaixo é gratuito.
        </div>
      </div>

      <div data-testid="consultor-empresa" style={{ background: empresa ? "#F3EDE3" : "#FDF2E9", border: `1px solid ${empresa ? BD : GO}`, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: ESP }}>
        {empresa
          ? <><Lock size={13} strokeWidth={1.5} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden /><AjudaCampo chave="inteligencia.consultor.empresa" /> Analisando só os dados de <strong>{empresaInfo?.nome || "…"}</strong>{empresaInfo?.cnpj ? <> · CNPJ {empresaInfo.cnpj}</> : null}. Para outra empresa, troque no seletor do topo.</>
          : <>Selecione <strong>uma empresa</strong> no seletor do topo. O assistente responde por um CNPJ de cada vez e não mistura dados de empresas.</>}
      </div>

      <div style={{ background: CARD, borderRadius: 14, border: `1px solid ${BD}`, padding: 14, marginBottom: 14, boxShadow: "0 1px 3px rgba(61,35,20,0.05)" }}>
        <label data-ajuda="inteligencia.consultor.sintoma" style={{ display: "block" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
            Pergunte sobre seus dados<AjudaCampo chave="inteligencia.consultor.sintoma" />
          </div>
          <textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(); } }}
            placeholder="Ex.: por que o saldo do cliente X está negativo se ele pagou o boleto?"
            rows={2}
            style={{ width: "100%", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => perguntar(c)} disabled={loading || !empresa}
              style={{ background: OW, border: `1px solid ${BD}`, color: TXM, borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: loading || !empresa ? "not-allowed" : "pointer" }}>
              {c}
            </button>
          ))}
        </div>
        {/* ATALHO: situação de UM cliente/fornecedor (RD-95 "?") — "por que o saldo do X...", "o X pagou?" */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BD}` }}>
          <label data-ajuda="inteligencia.consultor.situacao_parceiro" style={{ display: "block" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
              Situação de um cliente ou fornecedor<AjudaCampo chave="inteligencia.consultor.situacao_parceiro" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={nomeParceiro} onChange={(e) => setNomeParceiro(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && nomeParceiro.trim()) { e.preventDefault(); perguntar(`Situação de ${nomeParceiro.trim()} — títulos, pagamentos e por que o saldo está assim`); } }}
                placeholder="Nome ou CNPJ — ex.: IGP Cereais"
                style={{ flex: "1 1 220px", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              <button type="button" onClick={() => nomeParceiro.trim() && perguntar(`Situação de ${nomeParceiro.trim()} — títulos, pagamentos e por que o saldo está assim`)} disabled={loading || !empresa || !nomeParceiro.trim()}
                style={{ borderRadius: 10, border: `1px solid ${GO}`, background: "transparent", color: ESP, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: loading || !empresa || !nomeParceiro.trim() ? "not-allowed" : "pointer" }}>
                Ver situação
              </button>
            </div>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => perguntar()} disabled={loading || !empresa || !pergunta.trim()}
            style={{ flex: "1 1 220px", borderRadius: 10, border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: loading || !empresa || !pergunta.trim() ? "not-allowed" : "pointer", color: "#fff", background: loading || !empresa || !pergunta.trim() ? "#CDB89A" : `linear-gradient(135deg,${ESP},${GO})` }}>
            {loading ? "Analisando…" : "Perguntar ao analista"}
          </button>
          <button type="button" onClick={rodarRaiox} disabled={loading || !empresa}
            style={{ borderRadius: 10, border: `1px solid ${GO}`, background: "transparent", color: ESP, padding: "12px 16px", fontSize: 13, fontWeight: 600, cursor: loading || !empresa ? "not-allowed" : "pointer" }}>
            🔎 Raio-X (grátis)
          </button>
        </div>
      </div>

      {erro && <div style={{ background: "#FBEAEA", border: `1px solid #E6B8B8`, borderRadius: 10, padding: 12, color: RED, fontSize: 12.5, marginBottom: 12 }}>{erro}</div>}

      {bloqueio && (
        <div style={{ background: "#FBF3DE", border: `1px solid ${GO}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{bloqueio}</div>
          <button type="button" onClick={rodarRaiox} style={{ marginTop: 10, background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            🔎 Rodar Raio-X dos meus dados (grátis)
          </button>
        </div>
      )}

      {/* PASSOS enquanto pensa (streaming) */}
      {loading && passos.length > 0 && !agente && (
        <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
          {passos.map((p, i) => (
            <div key={i} style={{ fontSize: 12.5, color: i === passos.length - 1 ? ESP : TXM, display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
              <span>{i === passos.length - 1 ? "⏳" : "✓"}</span> {p}
            </div>
          ))}
        </div>
      )}

      {/* RESPOSTA DO ANALISTA */}
      {agente && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: `4px solid ${GO}`, borderRadius: 12, padding: "14px 16px", fontSize: 13.5, color: ESP, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {agente.resposta || "Não consegui formular uma resposta."}
          </div>

          {agente.numeros_a_conferir.length > 0 && (
            <div style={{ marginTop: 10, background: "#FBF3DE", border: `1px solid ${GO}`, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: Y }}>
              ⚠️ Confira estes valores: {agente.numeros_a_conferir.join(", ")} — não consegui confirmá-los nos dados.
            </div>
          )}

          {/* Ver os dados que embasaram a resposta */}
          {agente.dados.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setVerDados((v) => !v)}
                style={{ background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {verDados ? "Ocultar os dados" : `Ver os dados (${agente.dados.length} consulta${agente.dados.length > 1 ? "s" : ""})`}
              </button>
              {verDados && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {agente.dados.map((d, i) => (
                    <div key={i} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: ESP, marginBottom: 4 }}>{d.objetivo || d.ferramenta}</div>
                      <pre style={{ margin: 0, fontSize: 11, color: TXM, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflow: "auto" }}>
                        {JSON.stringify((d.resultado as { dados?: unknown })?.dados ?? d.resultado, null, 2).slice(0, 4000)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* feedback 👍/👎 */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: TXM }}>
            {feedback === null ? (
              <>
                <span>Essa resposta ajudou?</span>
                <button type="button" aria-label="Sim, ajudou" onClick={() => enviarFeedback(true)} style={{ background: OW, border: `1px solid ${BD}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>👍</button>
                <button type="button" aria-label="Não ajudou" onClick={() => enviarFeedback(false)} style={{ background: OW, border: `1px solid ${BD}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>👎</button>
              </>
            ) : <span style={{ color: GRN }}>Obrigado pelo retorno!</span>}
            {agente.custo_usd > 0 && <span style={{ marginLeft: "auto", color: TXD, fontSize: 10.5 }}>custo desta análise: US$ {agente.custo_usd.toFixed(3)}</span>}
          </div>
        </div>
      )}

      {/* RAIO-X determinístico (grátis) */}
      {raiox?.ok && (
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

      {/* AVISO LGPD (com "?") */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4, fontSize: 10.5, color: TXD, marginTop: 16, lineHeight: 1.5, justifyContent: "center", textAlign: "center" }}>
        <span><AjudaCampo chave="inteligencia.consultor.lgpd" /> As respostas são geradas por IA a partir dos dados desta empresa. Só os dados necessários para a sua pergunta são enviados ao provedor de IA, que não os usa para treinar modelos. O Raio-X não tem custo.</span>
      </div>
    </div>
  );
}
