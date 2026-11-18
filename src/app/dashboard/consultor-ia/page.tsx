"use client";
// Consultor IA — Assistente de dados (SPEC Eng. Chefe RD-41 · CEO 17/11, RD-101).
// Pergunta em linguagem natural → /api/consultor-ia (IA ROTEADOR: escolhe a RPC, os dados NÃO vão ao LLM;
// company_id forçado no servidor; teto GLOBAL US$ 2/dia). Fallback de graça: chips + Raio-X determinístico.
// Tema CLARO do ERP (Espresso em off-white) — corrige o "título fantasma" da V1 escura no shell branco.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AjudaCampo from "@/components/ajuda/AjudaCampo";

const ESP = "#3D2314", GO = "#C8941A", OW = "#FAF7F2", CARD = "#FFFFFF", BD = "#E7DED3",
  TXM = "#6B5D4F", TXD = "#918C82", GRN = "#1F5A1F", RED = "#B91C1C", Y = "#8A5A00";

type Achado = { codigo: string; categoria: string; severidade: "alta" | "media" | "baixa"; titulo: string; mensagem: string; como_corrigir: string; rota_link: string };
type Raiox = { ok: boolean; erro?: string; resumo?: { alta: number; media: number; baixa: number; total: number }; achados?: Achado[] };
type Resposta = {
  ok: boolean; bloqueado?: boolean; naoEntendi?: boolean; mensagem?: string; error?: string;
  tipo?: "lista" | "valor" | "cliente" | "raiox"; titulo?: string; resumo?: string;
  kpis?: any; linhas?: any[]; valor?: number; achados?: Achado[];
};

const CHIPS = ["Contas a receber que vencem hoje", "Despesas que vencem amanhã", "Quais clientes estão inadimplentes?", "Qual o saldo das minhas contas?"];
const ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR: Record<string, string> = { alta: RED, media: Y, baixa: GRN };
const DOT: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "🟢" };
const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (s?: string) => { if (!s) return "—"; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

export default function ConsultorIAPage() {
  const router = useRouter();
  const [empresa, setEmpresa] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [raiox, setRaiox] = useState<Raiox | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => { carregarEmpresa(); }, []);

  async function carregarEmpresa() {
    // Empresa vem do CONTEXTO/sessão (shell) — sem seletor no topo (SPEC §6.1).
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingDb(false); return; }
    const saved = typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "";
    if (saved) { setEmpresa(saved); setLoadingDb(false); return; }
    const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
    let first = "";
    if (up?.role === "adm" || up?.role === "acesso_total") {
      const r = await supabase.from("companies").select("id").order("nome_fantasia").limit(1);
      first = r.data?.[0]?.id || "";
    } else {
      const r = await supabase.from("user_companies").select("company_id").eq("user_id", user.id).limit(1);
      first = (r.data?.[0] as any)?.company_id || "";
    }
    setEmpresa(first); setLoadingDb(false);
  }

  // Assistente (IA roteador) — pergunta livre.
  async function perguntar(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || !empresa) return;
    if (texto) setPergunta(texto);
    setLoading(true); setErro(""); setResposta(null); setRaiox(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/consultor-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ pergunta: q, company_id: empresa }),
      });
      const j = (await res.json()) as Resposta;
      if (!res.ok || j.ok === false) { setErro(j.error || "Não consegui responder agora. Tente de novo."); setLoading(false); return; }
      setResposta(j);
    } catch { setErro("Falha de conexão. Tente de novo em instantes."); }
    setLoading(false);
  }

  // Raio-X determinístico (grátis) — atalho/fallback, sem IA.
  async function rodarRaiox() {
    if (!empresa) return;
    setLoading(true); setErro(""); setResposta(null); setRaiox(null);
    const { data, error } = await supabase.rpc("fn_consultor_raiox", { p_company_id: empresa });
    if (error) { setErro("Não consegui analisar agora. Tente de novo."); setLoading(false); return; }
    const r = data as Raiox;
    if (r && r.ok === false) { setErro(r.erro === "sem_acesso" ? "Você não tem acesso aos dados desta empresa." : "Não consegui analisar agora."); setLoading(false); return; }
    setRaiox(r); setLoading(false);
  }

  if (loadingDb) return <div style={{ padding: 40, textAlign: "center", color: TXM }}>Carregando…</div>;

  const achados = (resposta?.tipo === "raiox" ? resposta.achados : raiox?.achados) || [];
  const achadosOrd = achados.slice().sort((a, b) => (ORDEM[a.severidade] ?? 3) - (ORDEM[b.severidade] ?? 3));
  const bloqueadoOuFalha = resposta?.bloqueado || resposta?.naoEntendi;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px", color: ESP }}>
      {/* CABEÇALHO (sem nome da empresa — vem do contexto) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: ESP, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>💬</span> Consultor IA · Assistente dos seus dados
        </div>
        <div style={{ fontSize: 12.5, color: TXM, marginTop: 3, lineHeight: 1.5, maxWidth: 580 }}>
          Pergunte em português — <strong style={{ color: ESP }}>“contas a receber que vencem hoje”, “o cliente X está cadastrado?”</strong> — e eu trago direto dos seus dados. Os atalhos abaixo são gratuitos.
        </div>
      </div>

      {/* CAIXA DE PERGUNTA */}
      <div style={{ background: CARD, borderRadius: 14, border: `1px solid ${BD}`, padding: 14, marginBottom: 14, boxShadow: "0 1px 3px rgba(61,35,20,0.05)" }}>
        <label data-ajuda="inteligencia.consultor.sintoma" style={{ display: "block" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
            Pergunte sobre seus dados<AjudaCampo chave="inteligencia.consultor.sintoma" />
          </div>
          <textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(); } }}
            placeholder="Ex.: quais despesas vencem amanhã? — ou toque num atalho abaixo."
            rows={2}
            style={{ width: "100%", background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => perguntar(c)}
              style={{ background: OW, border: `1px solid ${BD}`, color: TXM, borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}>
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => perguntar()} disabled={loading || !empresa || !pergunta.trim()}
            style={{ flex: "1 1 220px", borderRadius: 10, border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: loading || !empresa || !pergunta.trim() ? "not-allowed" : "pointer", color: "#fff", background: loading || !empresa || !pergunta.trim() ? "#CDB89A" : `linear-gradient(135deg,${ESP},${GO})` }}>
            {loading ? "Consultando…" : "Perguntar ao assistente"}
          </button>
          <button type="button" onClick={rodarRaiox} disabled={loading || !empresa}
            style={{ borderRadius: 10, border: `1px solid ${GO}`, background: "transparent", color: ESP, padding: "12px 16px", fontSize: 13, fontWeight: 600, cursor: loading || !empresa ? "not-allowed" : "pointer" }}>
            🔎 Raio-X (grátis)
          </button>
        </div>
      </div>

      {/* ERRO */}
      {erro && <div style={{ background: "#FBEAEA", border: `1px solid #E6B8B8`, borderRadius: 10, padding: 12, color: RED, fontSize: 12.5, marginBottom: 12 }}>{erro}</div>}

      {/* AVISO (teto estourado / não entendeu) → aponta para o Raio-X grátis */}
      {bloqueadoOuFalha && (
        <div style={{ background: "#FBF3DE", border: `1px solid ${GO}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{resposta?.mensagem}</div>
          <button type="button" onClick={rodarRaiox} style={{ marginTop: 10, background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            🔎 Rodar Raio-X dos meus dados (grátis)
          </button>
        </div>
      )}

      {/* RESPOSTA DO ASSISTENTE */}
      {resposta?.ok && !bloqueadoOuFalha && resposta.resumo && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: `4px solid ${GO}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontWeight: 600, color: ESP }}>
            {resposta.resumo}
          </div>

          {/* LISTA (receber/pagar/inadimplentes) */}
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

          {/* CLIENTE */}
          {resposta.tipo === "cliente" && (resposta.linhas?.length ?? 0) > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {resposta.linhas!.map((c: any, i: number) => (
                <div key={c.id ?? i} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ fontWeight: 700, color: ESP }}>{c.razao_social || c.nome_fantasia || c.nome || "Cliente"}</div>
                  <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>
                    {(c.cpf_cnpj || c.cnpj_cpf) ? `CNPJ/CPF: ${c.cpf_cnpj || c.cnpj_cpf}` : ""}{(c.cidade) ? ` · ${c.cidade}${c.uf ? "/" + c.uf : ""}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VALOR (saldo) */}
          {resposta.tipo === "valor" && (
            <div style={{ marginTop: 10, background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: Number(resposta.valor) < 0 ? RED : ESP }}>{brl(resposta.valor)}</div>
              <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>saldo atual das contas bancárias</div>
            </div>
          )}
        </div>
      )}

      {/* RAIO-X determinístico (chip/fallback) ou tipo raiox */}
      {(raiox?.ok || resposta?.tipo === "raiox") && (
        <div style={{ marginBottom: 12 }}>
          {achadosOrd.length === 0 ? (
            <div style={{ background: "#EAF4EA", border: `1px solid #B8D8B8`, borderRadius: 14, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: ESP, marginTop: 6 }}>Analisei tudo e não achei problema</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {achadosOrd.map((a) => (
                <div key={a.codigo} style={{ background: CARD, borderRadius: 14, border: `1px solid ${BD}`, borderLeft: `4px solid ${COR[a.severidade] || BD}`, padding: 14 }}>
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
        O assistente lê só sua pergunta e escolhe qual consulta rodar — os números vêm direto do seu banco, pela empresa da sua sessão. Os atalhos e o Raio-X não têm custo.
      </div>
    </div>
  );
}
