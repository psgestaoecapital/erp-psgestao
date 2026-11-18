"use client";
// Caixa do dia do grupo (Item 5 F1) — só leitura. Caixa de todas as empresas do grupo (companies.group_id)
// num dia: saldo inicial, entradas e saídas do dia por conta, saldo final; por empresa e consolidado;
// + "o que vence" (hoje/atrasado/7 dias). Cada número abre os títulos. Genérico para qualquer grupo.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { ParaTratarHoje } from "@/components/financeiro/ParaTratarHoje";

const ROTA = "/dashboard/financeiro/caixa-grupo";
const BG = "var(--ps-bg,#FAF7F2)", BG2 = "var(--ps-bg2,#FFFFFF)", BG3 = "var(--ps-bg3,#F0ECE3)";
const TX = "var(--ps-text,#3D2314)", TXM = "var(--ps-text-m,#6B5D4F)", TXD = "var(--ps-text-d,#9C8E80)";
const BD = "var(--ps-border,#E0D8CC)", GO = "var(--ps-gold,#C8941A)";
const VERDE = "#3B6D11", VERM = "#A32D2D", AZUL = "#2563EB";

const brl = (v: unknown) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hojeISO = () => new Date().toISOString().slice(0, 10);
// Saldo do banco (extrato): data curta dd/mm e idade em dias (para avisar quando o extrato está velho).
const diaMes = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };
const diasAtras = (iso?: string | null) => { if (!iso) return Infinity; const d = new Date(iso); return isNaN(d.getTime()) ? Infinity : Math.floor((Date.now() - d.getTime()) / 86400000); };
// Navegação por dia e por mês (v2, cd8f31c5) — monta a data a partir dos componentes locais (sem fuso).
const p2 = (n: number) => String(n).padStart(2, "0");
const isoDe = (dt: Date) => `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`;
const shiftDia = (iso: string, days: number) => { const [y, m, d] = iso.split("-").map(Number); return isoDe(new Date(y, m - 1, d + days)); };
// Mês: mantém o dia; se o mês de destino for mais curto, usa o último dia dele (não "vaza" para o mês seguinte).
const shiftMes = (iso: string, months: number) => { const [y, m, d] = iso.split("-").map(Number); const alvo = new Date(y, m - 1 + months, 1); const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate(); return isoDe(new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimo))); };
const rotuloDia = (iso: string) => { const dt = new Date(iso + "T00:00:00"); return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); };

type Conta = { conta_id: string | null; nome: string; saldo_inicial: number; entradas: number; saidas: number; transf: number; saldo_final: number;
  soma_no_saldo?: boolean; saldo_extrato?: number | null; saldo_extrato_em?: string | null; saldo_extrato_origem?: string | null };
type Empresa = { company_id: string; nome: string; contas: Conta[]; saldo_inicial: number; entradas: number; saidas: number; transf: number; saldo_final: number; sem_conta_n?: number };
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

  const navBtn: React.CSSProperties = { width: 32, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 8, fontSize: 15, cursor: "pointer", lineHeight: 1 };
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <label style={{ fontSize: 12, color: TXM, marginRight: 2 }}>Dia</label>
            <button type="button" aria-label="Mês anterior" title="Mês anterior" onClick={() => setData((d) => shiftMes(d, -1))} style={navBtn}>«</button>
            <button type="button" aria-label="Dia anterior" title="Dia anterior" onClick={() => setData((d) => shiftDia(d, -1))} style={navBtn}>‹</button>
            <input type="date" value={data} onChange={(e) => setData(e.target.value || hojeISO())}
              style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
            <button type="button" aria-label="Próximo dia" title="Próximo dia" onClick={() => setData((d) => shiftDia(d, 1))} style={navBtn}>›</button>
            <button type="button" aria-label="Próximo mês" title="Próximo mês" onClick={() => setData((d) => shiftMes(d, 1))} style={navBtn}>»</button>
            <button type="button" onClick={() => setData(hojeISO())} disabled={data === hojeISO()}
              style={{ ...navBtn, width: "auto", padding: "0 12px", fontWeight: 600, opacity: data === hojeISO() ? 0.5 : 1, cursor: data === hojeISO() ? "default" : "pointer" }}>Hoje</button>
            <AjudaCampo chave="financeiro.caixa_grupo.data" rota={ROTA} />
          </div>
          <div style={{ fontSize: 12, color: TXM, textTransform: "capitalize" }}>{rotuloDia(data)}</div>
        </div>
      </div>

      {erro && <div role="alert" style={{ background: "#FCEBEB", color: VERM, padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{erro}</div>}

      {/* Para tratar hoje — o que o financeiro precisa resolver no dia (CEO 12/11) */}
      <ParaTratarHoje companyIds={effectiveIds} data={data} multiEmpresa={multi} />

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
          {/* Faixa de cartões — headline do grupo (v2 fatia 2, cd8f31c5): Recebido/Pago do dia, Saldo,
              A receber/A pagar em aberto e o líquido a realizar. Só leitura, do mesmo fn_caixa_grupo_dia (RD-26). */}
          {cons && (() => {
            const vR = resp?.vence?.receber, vP = resp?.vence?.pagar;
            const aReceber = (Number(vR?.atrasado) || 0) + (Number(vR?.hoje) || 0) + (Number(vR?.proximos7) || 0);
            const aPagar = (Number(vP?.atrasado) || 0) + (Number(vP?.hoje) || 0) + (Number(vP?.proximos7) || 0);
            const emAberto = aReceber - aPagar;
            const cards = [
              { lbl: "Recebido no dia", v: cons.entradas, cor: VERDE, ajuda: "financeiro.caixa_grupo.entradas" },
              { lbl: "Pago no dia", v: cons.saidas, cor: VERM, ajuda: "financeiro.caixa_grupo.saidas" },
              { lbl: "Saldo do grupo", v: cons.saldo_final, cor: Number(cons.saldo_final) < 0 ? VERM : TX, ajuda: "financeiro.caixa_grupo.saldo_final" },
              { lbl: "A receber em aberto", v: aReceber, cor: VERDE, ajuda: "financeiro.caixa_grupo.vence" },
              { lbl: "A pagar em aberto", v: aPagar, cor: GO, ajuda: "financeiro.caixa_grupo.vence" },
              { lbl: "Em aberto (líquido)", v: emAberto, cor: emAberto < 0 ? VERM : VERDE, ajuda: "financeiro.caixa_grupo.vence" },
            ];
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                {cards.map((c) => (
                  <div key={c.lbl} style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: "14px 16px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, color: TXD, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {c.lbl}<AjudaCampo chave={c.ajuda} rota={ROTA} />
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: c.cor, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{brl(c.v)}</div>
                  </div>
                ))}
              </div>
            );
          })()}

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
                // Contas que SOMAM no caixa (soma_no_saldo != false, exclui a linha sintética "Sem conta"),
                // contas de CONTROLE (soma_no_saldo === false, não entram no caixa) e o aviso "Sem conta".
                const somam = e.contas.filter((c) => c.conta_id && c.soma_no_saldo !== false);
                const controle = e.contas.filter((c) => c.soma_no_saldo === false);
                const semN = Number(e.sem_conta_n) || 0;
                return (
                <div key={e.company_id} style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 10, overflow: "hidden" }}>
                  <button onClick={() => setColapsadas((prev) => { const n = new Set(prev); if (n.has(e.company_id)) n.delete(e.company_id); else n.add(e.company_id); return n; })}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: TX }}>{aberta ? "▾" : "▸"} {e.nome}</span>
                    <span style={{ fontSize: 13, color: Number(e.saldo_final) < 0 ? VERM : VERDE, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{brl(e.saldo_final)}</span>
                  </button>
                  {aberta && (
                    <div style={{ borderTop: `1px solid ${BD}` }}>
                      <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                        <thead>
                          <tr style={{ borderBottom: `0.5px solid ${BD}` }}>
                            <th style={{ ...th, textAlign: "left" }}>Conta</th>
                            <th style={th}>Saldo inicial</th><th style={{ ...th, color: VERDE }}>Entradas</th>
                            <th style={{ ...th, color: VERM }}>Saídas</th><th style={th}>Saldo (sistema)</th>
                            <th style={th}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end" }}>Banco (extrato)<AjudaCampo chave="financeiro.caixa_grupo.saldo_banco" rota={ROTA} /></span></th>
                            <th style={th}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end" }}>Diferença<AjudaCampo chave="financeiro.caixa_grupo.diferenca" rota={ROTA} /></span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {somam.length === 0 ? (
                            <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: TXD, fontSize: 12 }}>Sem conta bancária que some no caixa nesta empresa.</td></tr>
                          ) : somam.map((ct, i) => {
                            const temExtrato = ct.saldo_extrato !== null && ct.saldo_extrato !== undefined;
                            const velho = temExtrato && diasAtras(ct.saldo_extrato_em) > 3;
                            const dif = temExtrato ? Number(ct.saldo_final) - Number(ct.saldo_extrato) : 0;
                            const zerado = Math.abs(dif) < 0.005;
                            return (
                            <tr key={ct.conta_id ?? `som-${i}`} style={{ borderBottom: `0.5px solid ${BD}` }}>
                              <td style={{ padding: "9px 12px", fontSize: 12, color: TX, textAlign: "left" }}>{ct.nome}</td>
                              <td style={td}>{brl(ct.saldo_inicial)}</td>
                              <td style={{ ...td, color: VERDE }}>{brl(ct.entradas)}</td>
                              <td style={{ ...td, color: VERM }}>{brl(ct.saidas)}</td>
                              <td style={{ ...td, fontWeight: 600 }}>{brl(ct.saldo_final)}</td>
                              <td style={td}>
                                {!temExtrato ? <span style={{ color: TXD }}>— sem extrato</span> : (
                                  <div>
                                    <div style={{ fontWeight: 500 }}>{brl(ct.saldo_extrato)}</div>
                                    <div style={{ fontSize: 10, color: velho ? VERM : TXD }}>
                                      {velho ? `extrato de ${diaMes(ct.saldo_extrato_em)} — importe o extrato` : `extrato ${diaMes(ct.saldo_extrato_em)}${ct.saldo_extrato_origem ? ` · ${ct.saldo_extrato_origem}` : ""}`}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td style={{ ...td, color: !temExtrato ? TXD : (zerado ? VERDE : VERM), fontWeight: 600 }}>
                                {!temExtrato ? "—" : zerado ? "OK" : brl(dif)}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>

                      {/* Lançamentos sem conta: aviso clicável para atribuir a conta certa */}
                      {semN > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderTop: `0.5px solid ${BD}`, background: "#FCF6E8" }}>
                          <button onClick={() => abrirTitulos(`Lançamentos sem conta · ${e.nome}`, "sem_conta", e.company_id)}
                            style={{ background: "transparent", border: "none", color: GO, fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "inline-flex", alignItems: "center", gap: 6 }}>
                            ⚠ {semN} lançamento{semN > 1 ? "s" : ""} sem conta — atribuir
                          </button>
                          <AjudaCampo chave="financeiro.caixa_grupo.sem_conta" rota={ROTA} />
                        </div>
                      )}

                      {/* Contas de controle: não somam no caixa (permuta, adiantamentos, aplicações de controle) */}
                      {controle.length > 0 && (
                        <div style={{ borderTop: `0.5px solid ${BD}` }}>
                          <div style={{ display: "inline-flex", alignItems: "center", padding: "8px 16px 2px", fontSize: 10.5, color: TXD, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            Contas de controle (não somam no caixa)<AjudaCampo chave="financeiro.caixa_grupo.contas_controle" rota={ROTA} />
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                              <thead>
                                <tr style={{ borderBottom: `0.5px solid ${BD}` }}>
                                  <th style={{ ...th, textAlign: "left" }}>Conta</th>
                                  <th style={th}>Saldo inicial</th><th style={{ ...th, color: VERDE }}>Entradas</th>
                                  <th style={{ ...th, color: VERM }}>Saídas</th><th style={th}>Saldo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {controle.map((ct, i) => (
                                  <tr key={ct.conta_id ?? `ctr-${i}`} style={{ borderBottom: `0.5px solid ${BD}`, opacity: 0.8 }}>
                                    <td style={{ padding: "9px 12px", fontSize: 12, color: TXM, textAlign: "left" }}>{ct.nome}</td>
                                    <td style={td}>{brl(ct.saldo_inicial)}</td>
                                    <td style={{ ...td, color: VERDE }}>{brl(ct.entradas)}</td>
                                    <td style={{ ...td, color: VERM }}>{brl(ct.saidas)}</td>
                                    <td style={{ ...td, fontWeight: 600 }}>{brl(ct.saldo_final)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
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
