"use client";
// Consultor IA — Assistente de dados (SPEC Eng. Chefe RD-41 · CEO 17/11, RD-101).
// Pergunta em linguagem natural → /api/consultor-ia (IA ROTEADOR: escolhe a RPC, os dados NÃO vão ao LLM;
// company_id forçado no servidor; teto GLOBAL US$ 2/dia). Fallback de graça: chips + Raio-X determinístico.
// Tema CLARO do ERP (Espresso em off-white) — corrige o "título fantasma" da V1 escura no shell branco.
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
type Resposta = {
  ok: boolean; bloqueado?: boolean; naoEntendi?: boolean; mensagem?: string; error?: string;
  tipo?: "lista" | "valor" | "cliente" | "raiox" | "divergencia" | "lista_lancamentos"; titulo?: string; resumo?: string;
  kpis?: any; linhas?: any[]; valor?: number; achados?: Achado[];
  contas?: { conta_id: string; conta_nome: string; saldo_sistema: number; saldo_banco: number; diferenca: number; rota_link?: string }[];
  contas_sem_extrato?: { conta_nome: string; saldo_sistema?: number }[];
};

const CHIPS = ["Contas a receber que vencem hoje", "Despesas que vencem amanhã", "Quais clientes estão inadimplentes?", "Qual o saldo das minhas contas?",
  "Meu saldo bate com o banco?", "Lançamentos sem conciliar", "Lançamentos sem CNPJ"];
const ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR: Record<string, string> = { alta: RED, media: Y, baixa: GRN };
const DOT: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "🟢" };
const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (s?: string) => { if (!s) return "—"; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

export default function ConsultorIAPage() {
  const router = useRouter();
  // LGPD / isolamento por CNPJ (CEO 18/11): a empresa é SEMPRE a do seletor do topo (ps_empresa_sel), acompanhada
  // ao vivo pelo hook. Multi-empresa sem seleção, "consolidado" ou grupo → null → pede para escolher UM CNPJ.
  // Nunca chutamos "a primeira empresa": a resposta tem de ser da empresa que o usuário está vendo no topo.
  const { companyId } = useEmpresaSelecionada();
  const empresa = companyId ?? "";
  const empresaRef = useRef(empresa);
  const [empresaInfo, setEmpresaInfo] = useState<{ nome: string; cnpj: string } | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [loading, setLoading] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [raiox, setRaiox] = useState<Raiox | null>(null);
  const [erro, setErro] = useState("");

  // Troca de empresa no topo: limpa tudo que foi respondido para a empresa anterior e mostra o CNPJ atual.
  useEffect(() => {
    empresaRef.current = empresa;
    setResposta(null); setRaiox(null); setErro(""); setEmpresaInfo(null);
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

  // Assistente (IA roteador) — pergunta livre.
  async function perguntar(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || !empresa) return;
    const alvo = empresa;
    if (texto) setPergunta(texto);
    setLoading(true); setErro(""); setResposta(null); setRaiox(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/consultor-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ pergunta: q, company_id: alvo }),
      });
      const j = (await res.json()) as Resposta;
      if (empresaRef.current !== alvo) { setLoading(false); return; } // empresa trocada no meio: descarta
      if (!res.ok || j.ok === false) { setErro(j.error || "Não consegui responder agora. Tente de novo."); setLoading(false); return; }
      setResposta(j);
    } catch { setErro("Falha de conexão. Tente de novo em instantes."); }
    setLoading(false);
  }

  // Raio-X determinístico (grátis) — atalho/fallback, sem IA.
  async function rodarRaiox() {
    if (!empresa) return;
    const alvo = empresa;
    setLoading(true); setErro(""); setResposta(null); setRaiox(null);
    const { data, error } = await supabase.rpc("fn_consultor_raiox", { p_company_id: alvo });
    if (empresaRef.current !== alvo) { setLoading(false); return; } // empresa trocada no meio: descarta
    if (error) { setErro("Não consegui analisar agora. Tente de novo."); setLoading(false); return; }
    const r = data as Raiox;
    if (r && r.ok === false) { setErro(r.erro === "sem_acesso" ? "Você não tem acesso aos dados desta empresa." : "Não consegui analisar agora."); setLoading(false); return; }
    setRaiox(r); setLoading(false);
  }

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

      {/* EMPRESA CONSULTADA — o assistente só lê dados deste CNPJ (o do seletor do topo) */}
      <div data-testid="consultor-empresa" style={{ background: empresa ? "#F3EDE3" : "#FDF2E9", border: `1px solid ${empresa ? BD : GO}`, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: ESP }}>
        {empresa
          ? <><Lock size={13} strokeWidth={1.5} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden /><AjudaCampo chave="inteligencia.consultor.empresa" /> Consultando só os dados de <strong>{empresaInfo?.nome || "…"}</strong>{empresaInfo?.cnpj ? <> · CNPJ {empresaInfo.cnpj}</> : null}. Para outra empresa, troque no seletor do topo.</>
          : <>Selecione <strong>uma empresa</strong> no seletor do topo. O assistente responde por um CNPJ de cada vez e não mistura dados de empresas.</>}
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

          {/* DIVERGÊNCIA sistema × banco, por conta */}
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
                <div style={{ fontSize: 12, color: TXM, marginTop: 8 }}>
                  Sem extrato para comparar: {resposta.contas_sem_extrato!.map((c) => c.conta_nome).join(", ")}.
                </div>
              )}
              {(resposta.contas?.length ?? 0) > 0 && (
                <button type="button" onClick={() => perguntar("Lançamentos sem conciliar")}
                  style={{ marginTop: 10, background: OW, border: `1px solid ${BD}`, color: ESP, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Ver os lançamentos sem conciliar
                </button>
              )}
            </div>
          )}

          {/* LANÇAMENTOS (sem conciliar / sem CNPJ / busca) — cada um com o botão para abrir e corrigir */}
          {resposta.tipo === "lista_lancamentos" && (resposta.linhas?.length ?? 0) > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {resposta.linhas!.map((l: any, i: number) => (
                <div key={l.id ?? i} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <div style={{ fontWeight: 700, color: ESP, fontSize: 13 }}>
                      {l.descricao || l.numero_documento || "Lançamento"}
                      <span style={{ fontWeight: 500, color: TXM, fontSize: 11, marginLeft: 6 }}>{l.natureza === "pagar" ? "a pagar" : "a receber"}</span>
                    </div>
                    <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>
                      {l.contraparte_nome || "Sem fornecedor/cliente"} · {l.contraparte_cnpj ? `CNPJ/CPF ${l.contraparte_cnpj}` : <span style={{ color: RED, fontWeight: 600 }}>sem CNPJ</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: TXM, marginTop: 2 }}>
                      Venc. {fmtData(l.data_vencimento)}{l.data_pagamento ? ` · pago em ${fmtData(l.data_pagamento)}` : ""}{l.conta ? ` · ${l.conta}` : ""} · {l.status || "—"}
                      {!l.conciliado && (l.data_pagamento || l.status === "pago" || l.status === "recebido") ? <span style={{ marginLeft: 6, background: "#FDF2E9", color: Y, borderRadius: 999, padding: "1px 8px", fontWeight: 600 }}>sem conciliar</span> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, color: ESP, fontSize: 13.5 }}>{brl(l.valor)}</span>
                    {l.rota_link && (
                      <button type="button" onClick={() => router.push(l.rota_link)}
                        style={{ background: "transparent", border: `1px solid ${GO}`, color: ESP, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                        Abrir lançamento →
                      </button>
                    )}
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
        O assistente lê só sua pergunta e escolhe qual consulta rodar — os números vêm direto do seu banco, pela empresa da sua sessão. Os atalhos e o Raio-X não têm custo.
      </div>
    </div>
  );
}
