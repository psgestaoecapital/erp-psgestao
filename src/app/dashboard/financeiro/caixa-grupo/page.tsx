"use client";
// Caixa do dia do grupo (Item 5 F1) — só leitura. Caixa de todas as empresas do grupo (companies.group_id)
// num dia: saldo inicial, entradas e saídas do dia por conta, saldo final; por empresa e consolidado;
// + "o que vence" (hoje/atrasado/7 dias). Cada número abre os títulos. Genérico para qualquer grupo.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/financeiro/caixa-grupo";
const BG = "var(--ps-bg,#FAF7F2)", BG2 = "var(--ps-bg2,#FFFFFF)", BG3 = "var(--ps-bg3,#F0ECE3)";
const TX = "var(--ps-text,#3D2314)", TXM = "var(--ps-text-m,#6B5D4F)", TXD = "var(--ps-text-d,#9C8E80)";
const BD = "var(--ps-border,#E0D8CC)", GO = "var(--ps-gold,#C8941A)";
const VERDE = "#3B6D11", VERM = "#A32D2D", AZUL = "#2563EB";

const brl = (v: unknown) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hojeISO = () => new Date().toISOString().slice(0, 10);

type Conta = { conta_id: string | null; nome: string; saldo_inicial: number; entradas: number; saidas: number; transf: number; saldo_final: number };
type Empresa = { company_id: string; nome: string; contas: Conta[]; saldo_inicial: number; entradas: number; saidas: number; transf: number; saldo_final: number };
type Totais = { saldo_inicial: number; entradas: number; saidas: number; transf: number; saldo_final: number };
type Vence = { receber: { hoje: number; atrasado: number; proximos7: number }; pagar: { hoje: number; atrasado: number; proximos7: number } };
type Resp = { ok: boolean; data: string; empresas: Empresa[]; consolidado: Totais; vence: Vence; atrasados_n: number; resumo: string };
type Titulo = { id: string; nome: string; descricao: string | null; valor: number; data: string };

export default function CaixaGrupoPage() {
  const { companyIds, selInfo, companies } = useCompanyIds();
  // Caixa do dia do GRUPO: se uma empresa de um grupo está selecionada, trazer TODAS as irmãs do mesmo
  // group_id às quais o usuário tem acesso (companies já vem filtrado por acesso; a RPC fail-closed refiltra).
  // Empresa sem grupo = só ela. Consolidado/grupo já vêm com o conjunto certo em companyIds.
  const effectiveIds = useMemo<string[]>(() => {
    const base = companyIds ?? [];
    if (!companies?.length) return base;
    const sel = new Set(base);
    const gruposSel = new Set(
      companies.filter((c) => sel.has(c.id) && c.group_id).map((c) => c.group_id as string)
    );
    if (gruposSel.size === 0) return base;
    const ids = new Set(base);
    companies.forEach((c) => { if (c.group_id && gruposSel.has(c.group_id)) ids.add(c.id); });
    return [...ids];
  }, [companyIds, companies]);
  const companyIdsKey = useMemo(() => [...effectiveIds].sort().join(","), [effectiveIds]);
  const [data, setData] = useState<string>(hojeISO());
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ titulo: string; bucket: string; companyId: string | null } | null>(null);
  const [titulos, setTitulos] = useState<Titulo[] | null>(null);
  // Contas de cada empresa ABERTAS por padrão (CEO 12/11): guardamos as empresas COLAPSADAS manualmente.
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    if (!companyIdsKey) { setResp(null); setLoading(false); return; }
    setLoading(true); setErro(null);
    const ids = companyIdsKey.split(",");
    const { data: d, error } = await supabase.rpc("fn_caixa_grupo_dia", { p_company_ids: ids, p_data: data });
    if (error) { setErro("Não foi possível carregar o caixa do dia. Tente de novo."); setResp(null); setLoading(false); return; }
    setResp(d as Resp);
    setLoading(false);
  }, [companyIdsKey, data]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao mudar grupo/data; loading é estado de carregamento legítimo.
  useEffect(() => { void carregar(); }, [carregar]);

  const abrirTitulos = useCallback(async (titulo: string, bucket: string, companyId: string | null) => {
    setDrill({ titulo, bucket, companyId }); setTitulos(null);
    const ids = companyIdsKey.split(",");
    const { data: d, error } = await supabase.rpc("fn_caixa_grupo_titulos", { p_company_ids: ids, p_data: data, p_bucket: bucket, p_company_id: companyId });
    setTitulos(error ? [] : ((d as Titulo[]) || []));
  }, [companyIdsKey, data]);

  const empresas = useMemo<Empresa[]>(() => resp?.empresas ?? [], [resp]);
  const cons = resp?.consolidado;
  const multi = empresas.length > 1;

  // Matriz: colunas = empresas (quando >1) + consolidado
  const colunas = useMemo(() => {
    const base = empresas.map((e) => ({ id: e.company_id, nome: e.nome, tot: e as Totais, isCons: false }));
    if (cons && multi) base.push({ id: "__cons__", nome: "Consolidado", tot: cons, isCons: true });
    return base;
  }, [empresas, cons, multi]);

  const linhas: Array<{ chave: keyof Totais; rotulo: string; ajuda: string; cor?: string; clicavel?: "entradas" | "saidas" }> = [
    { chave: "saldo_inicial", rotulo: "Saldo inicial", ajuda: "financeiro.caixa_grupo.saldo_inicial" },
    { chave: "entradas", rotulo: "Entradas do dia", ajuda: "financeiro.caixa_grupo.entradas", cor: VERDE, clicavel: "entradas" },
    { chave: "saidas", rotulo: "Saídas do dia", ajuda: "financeiro.caixa_grupo.saidas", cor: VERM, clicavel: "saidas" },
    { chave: "saldo_final", rotulo: "Saldo final", ajuda: "financeiro.caixa_grupo.saldo_final" },
  ];

  const th: React.CSSProperties = { padding: "10px 12px", fontSize: 11, color: TXD, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: TXD, textTransform: "uppercase", letterSpacing: 1 }}>Financeiro · Gestão Empresarial</div>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 25, color: TX, margin: "4px 0 0", fontWeight: 400 }}>Caixa do dia do grupo</h1>
          <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>
            {selInfo?.nome ?? "Grupo"}{empresas.length ? ` · ${empresas.length} empresa${empresas.length > 1 ? "s" : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, color: TXM }}>Dia</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value || hojeISO())}
            style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
          <AjudaCampo chave="financeiro.caixa_grupo.data" rota={ROTA} />
        </div>
      </div>

      {erro && <div role="alert" style={{ background: "#FCEBEB", color: VERM, padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{erro}</div>}

      {/* Resumo do dia */}
      {resp?.resumo && (
        <div style={{ background: `linear-gradient(90deg, ${GO}14, transparent)`, border: `1px solid ${GO}40`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: TX }}>{resp.resumo}</span>
          <AjudaCampo chave="financeiro.caixa_grupo.resumo" rota={ROTA} />
        </div>
      )}

      {loading ? (
        <div style={{ padding: 50, textAlign: "center", color: TXD }}>Carregando o caixa do dia…</div>
      ) : empresas.length === 0 ? (
        <div style={{ background: BG2, borderRadius: 12, padding: 50, textAlign: "center", color: TXM, border: `1px solid ${BD}` }}>
          Nenhuma empresa do seu acesso neste grupo. Selecione o grupo (ou consolidado) no seletor de empresa do topo.
        </div>
      ) : (
        <>
          {/* Matriz indicadores × empresas (+ consolidado) */}
          <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: multi ? 520 : 320 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BD}` }}>
                  <th style={{ ...th, textAlign: "left" }}>
                    <span style={{ display: "inline-flex", alignItems: "center" }}>Empresa / CNPJ<AjudaCampo chave="financeiro.caixa_grupo.empresa" rota={ROTA} /></span>
                  </th>
                  {colunas.map((c) => (
                    <th key={c.id} style={{ ...th, color: c.isCons ? GO : TXD, fontWeight: c.isCons ? 700 : 600 }}>{c.nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((ln) => (
                  <tr key={ln.chave} style={{ borderBottom: `0.5px solid ${BD}` }}>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: TXM, textAlign: "left" }}>
                      <span style={{ display: "inline-flex", alignItems: "center" }}>{ln.rotulo}<AjudaCampo chave={ln.ajuda} rota={ROTA} /></span>
                    </td>
                    {colunas.map((c) => {
                      const val = c.tot[ln.chave];
                      const podeClicar = ln.clicavel && Math.abs(Number(val)) > 0.005 && !c.isCons;
                      return (
                        <td key={c.id} style={{ ...td, color: ln.cor ?? (Number(val) < 0 ? VERM : TX), fontWeight: ln.chave === "saldo_final" ? 700 : 500 }}>
                          {podeClicar ? (
                            <button onClick={() => abrirTitulos(`${ln.rotulo} · ${c.nome}`, ln.clicavel!, c.id)}
                              style={{ background: "transparent", border: "none", color: ln.cor ?? TX, fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", fontVariantNumeric: "tabular-nums" }}>
                              {brl(val)}
                            </button>
                          ) : brl(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Por conta (RD-98: detalhe por conta bancária de cada empresa) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: TXD, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "inline-flex", alignItems: "center" }}>
              Por conta bancária<AjudaCampo chave="financeiro.caixa_grupo.conta" rota={ROTA} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {empresas.map((e) => {
                const aberta = !colapsadas.has(e.company_id);
                return (
                <div key={e.company_id} style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 10, overflow: "hidden" }}>
                  <button onClick={() => setColapsadas((prev) => { const n = new Set(prev); if (n.has(e.company_id)) n.delete(e.company_id); else n.add(e.company_id); return n; })}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: TX }}>{aberta ? "▾" : "▸"} {e.nome}</span>
                    <span style={{ fontSize: 13, color: Number(e.saldo_final) < 0 ? VERM : VERDE, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{brl(e.saldo_final)}</span>
                  </button>
                  {aberta && (
                    <div style={{ overflowX: "auto", borderTop: `1px solid ${BD}` }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                        <thead>
                          <tr style={{ borderBottom: `0.5px solid ${BD}` }}>
                            <th style={{ ...th, textAlign: "left" }}>Conta</th>
                            <th style={th}>Saldo inicial</th><th style={{ ...th, color: VERDE }}>Entradas</th>
                            <th style={{ ...th, color: VERM }}>Saídas</th><th style={th}>Saldo final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.contas.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: TXD, fontSize: 12 }}>Sem conta bancária cadastrada nesta empresa.</td></tr>
                          ) : e.contas.map((ct, i) => (
                            <tr key={ct.conta_id ?? `sem-${i}`} style={{ borderBottom: `0.5px solid ${BD}` }}>
                              <td style={{ padding: "9px 12px", fontSize: 12, color: ct.conta_id ? TX : TXD, textAlign: "left", fontStyle: ct.conta_id ? "normal" : "italic" }}>{ct.nome}</td>
                              <td style={td}>{brl(ct.saldo_inicial)}</td>
                              <td style={{ ...td, color: VERDE }}>{brl(ct.entradas)}</td>
                              <td style={{ ...td, color: VERM }}>{brl(ct.saidas)}</td>
                              <td style={{ ...td, fontWeight: 600 }}>{brl(ct.saldo_final)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>

          {/* O que vence */}
          {resp?.vence && (
            <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: TXD, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, display: "inline-flex", alignItems: "center" }}>
                O que vence<AjudaCampo chave="financeiro.caixa_grupo.vence" rota={ROTA} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {([
                  { lbl: "Atrasados a receber", v: resp.vence.receber.atrasado, b: "receber_atrasado", cor: VERM },
                  { lbl: "A receber hoje", v: resp.vence.receber.hoje, b: "receber_hoje", cor: VERDE },
                  { lbl: "A receber · 7 dias", v: resp.vence.receber.proximos7, b: "receber_proximos7", cor: AZUL },
                  { lbl: "Atrasados a pagar", v: resp.vence.pagar.atrasado, b: "pagar_atrasado", cor: VERM },
                  { lbl: "A pagar hoje", v: resp.vence.pagar.hoje, b: "pagar_hoje", cor: GO },
                  { lbl: "A pagar · 7 dias", v: resp.vence.pagar.proximos7, b: "pagar_proximos7", cor: AZUL },
                ]).map((x) => (
                  <button key={x.b} disabled={Math.abs(Number(x.v)) < 0.005} onClick={() => abrirTitulos(x.lbl, x.b, null)}
                    style={{ background: BG3, border: `1px solid ${BD}`, borderRadius: 10, padding: "10px 12px", textAlign: "left", cursor: Math.abs(Number(x.v)) < 0.005 ? "default" : "pointer", opacity: Math.abs(Number(x.v)) < 0.005 ? 0.55 : 1 }}>
                    <div style={{ fontSize: 10, color: TXD, textTransform: "uppercase", letterSpacing: 0.4 }}>{x.lbl}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: x.cor, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{brl(x.v)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de títulos (drill-through) */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: BG2, borderRadius: 16, padding: 22, maxWidth: 560, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TX }}>{drill.titulo}</div>
                <div style={{ fontSize: 11, color: TXD }}>{new Date(data + "T00:00:00").toLocaleDateString("pt-BR")} · <span style={{ display: "inline-flex", alignItems: "center" }}>títulos<AjudaCampo chave="financeiro.caixa_grupo.titulos" rota={ROTA} /></span></div>
              </div>
              <button onClick={() => setDrill(null)} aria-label="Fechar" style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: TXM }}>×</button>
            </div>
            <div style={{ overflowY: "auto" }}>
              {titulos === null ? (
                <div style={{ padding: 24, textAlign: "center", color: TXD }}>Carregando…</div>
              ) : titulos.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: TXD, fontSize: 13 }}>Nenhum título aqui.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {titulos.map((t) => (
                      <tr key={t.id} style={{ borderBottom: `0.5px solid ${BD}` }}>
                        <td style={{ padding: "9px 6px", fontSize: 12, color: TX }}>
                          <div style={{ fontWeight: 600 }}>{t.nome}</div>
                          {t.descricao && <div style={{ fontSize: 11, color: TXD }}>{t.descricao}</div>}
                        </td>
                        <td style={{ padding: "9px 6px", fontSize: 11, color: TXD, textAlign: "right", whiteSpace: "nowrap" }}>{t.data ? new Date(t.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                        <td style={{ padding: "9px 6px", fontSize: 13, fontWeight: 600, color: TX, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{brl(t.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
