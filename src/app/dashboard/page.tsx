"use client";
import { useState } from "react";

// PS Gestão Colors
const GO="#C6973F",GOL="#E8C872",BG="#0F0F0D",BG2="#1C1B18",BG3="#2A2822",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",P="#A855F7",T="#14B8A6",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

// Demo data (Solar Oeste) — will be replaced by Supabase queries
const empresaDemo = { nome: "SOLAR OESTE ENERGIA", cnpj: "52.341.876/0001-45", cidade: "Chapecó/SC", periodo: "Jan-Mar 2025", lns: 6, colaboradores: 54 };

const kpis = [
  { rotulo: "Faturamento 1T", valor: "R$ 6,5M", detalhe: "▲ 9% acima da meta", positivo: true },
  { rotulo: "Lucro da Operação", valor: "R$ 663K", detalhe: "10,2% do faturamento", positivo: true },
  { rotulo: "Lucro Final", valor: "R$ 602K", detalhe: "Após impostos e juros", positivo: true },
  { rotulo: "Dinheiro Disponível", valor: "R$ 702K", detalhe: "113 dias de cobertura", positivo: true },
  { rotulo: "Caixa - Dívidas", valor: "Sobram R$ 72K", detalhe: "✓ Caixa > Dívida", positivo: true },
  { rotulo: "Colaboradores", valor: "54 pessoas", detalhe: "38 oper. + 8 adm.", positivo: null },
  { rotulo: "Loja Online", valor: "(R$ 24K)", detalhe: "⚠ Prejuízo no trimestre", positivo: false },
  { rotulo: "Fevereiro", valor: "R$ 1,14M", detalhe: "Queda de 49%", positivo: false },
];

const negocios = [
  { nome: "Venda de Equipamentos", tipo: "Comércio", fat: "1.764K", mc: "19,5%", lucro: "158K", lucro_p: "9,5%", saude: "Forte", cor: GO },
  { nome: "Projetos Residenciais", tipo: "Serviço", fat: "748K", mc: "17,1%", lucro: "53K", lucro_p: "7,5%", saude: "Crescendo", cor: B },
  { nome: "Projetos Comerciais", tipo: "Serviço", fat: "1.360K", mc: "27,2%", lucro: "228K", lucro_p: "17,7%", saude: "Estrela ★", cor: G },
  { nome: "Projetos de Usinas", tipo: "Serviço", fat: "2.340K", mc: "18,3%", lucro: "216K", lucro_p: "10,6%", saude: "Instável", cor: P },
  { nome: "Manutenção O&M", tipo: "Serviço", fat: "159K", mc: "30,8%", lucro: "31K", lucro_p: "20,4%", saude: "Joia ★★", cor: T },
  { nome: "Loja Online", tipo: "Comércio", fat: "129K", mc: "-9,4%", lucro: "(24K)", lucro_p: "-19,6%", saude: "Prejuízo", cor: R },
];

const alertas = [
  { cor: G, titulo: "Faturamento 9% acima da meta", texto: "R$ 6,5 milhões contra meta de R$ 5,95 milhões. Projetos Comerciais e Usinas como motores." },
  { cor: G, titulo: "Manutenção: negócio mais rentável", texto: "20,4% de lucro real com 168 contratos fixos mensais. Receita previsível e crescente." },
  { cor: Y, titulo: "Fevereiro despencou 49%", texto: "Sem projeto de usina, faturamento caiu. Equipe de R$ 68K/mês ficou ociosa." },
  { cor: Y, titulo: "Custo dos produtos em 48,8%", texto: "Equipamentos e Loja Online com 60%. Renegociar com fornecedores pode economizar R$ 377K/ano." },
  { cor: R, titulo: "Loja Online perde R$ 8K/mês", texto: "Cada R$ 1 vendido custa R$ 1,09. Encerrar ou refazer preços em 30 dias." },
  { cor: R, titulo: "Preços 3x abaixo do necessário", texto: "Markup real é 11% quando o gestor acredita ser 42%. Tabela de preços precisa ser refeita." },
];

const KPI = ({ rotulo, valor, detalhe, positivo }: any) => (
  <div style={{ background: BG2, borderRadius: 10, padding: "10px 12px", borderLeft: `3px solid ${positivo ? GO : positivo === false ? R : BD}` }}>
    <div style={{ fontSize: 9, color: TXD, letterSpacing: 0.4, textTransform: "uppercase" }}>{rotulo}</div>
    <div style={{ fontSize: 17, fontWeight: 700, color: positivo ? GOL : positivo === false ? R : TX, marginTop: 3 }}>{valor}</div>
    <div style={{ fontSize: 9, color: positivo ? G : positivo === false ? R : TXM, marginTop: 2 }}>{detalhe}</div>
  </div>
);

export default function DashboardPage() {
  const [aba, setAba] = useState("geral");

  const abas = [
    { id: "geral", nome: "Painel Geral" },
    { id: "negocios", nome: "Negócios" },
    { id: "resultado", nome: "Resultado" },
    { id: "relatorio", nome: "Relatório IA" },
  ];

  return (
    <div>
      {/* Empresa selecionada */}
      <div style={{ padding: "12px 20px", background: BG2, borderBottom: `1px solid ${BD}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, color: GOL, fontWeight: 600 }}>{empresaDemo.nome}</div>
            <div style={{ fontSize: 10, color: TXD }}>{empresaDemo.cidade} | {empresaDemo.lns} negócios | {empresaDemo.colaboradores} colaboradores</div>
          </div>
          <div style={{ fontSize: 10, color: TXM, background: BG3, padding: "4px 10px", borderRadius: 6, border: `0.5px solid ${BD}` }}>
            {empresaDemo.periodo}
          </div>
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: "flex", gap: 3, padding: "8px 12px", overflowX: "auto", borderBottom: `1px solid ${BD}` }}>
        {abas.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)} style={{
            padding: "7px 14px", borderRadius: 20, fontSize: 11, whiteSpace: "nowrap",
            border: `0.5px solid ${aba === a.id ? GO : BD}`,
            background: aba === a.id ? GO + "18" : "transparent",
            color: aba === a.id ? GOL : TXM, fontWeight: aba === a.id ? 600 : 400
          }}>{a.nome}</button>
        ))}
      </div>

      <div style={{ padding: "14px 20px", maxWidth: 1200, margin: "0 auto" }}>

        {/* PAINEL GERAL */}
        {aba === "geral" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 16 }}>
              {kpis.map((k, i) => <KPI key={i} {...k} />)}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 10px" }}>
              <div style={{ width: 3, height: 16, background: GO, borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Alertas para Decisão</span>
            </div>

            {alertas.map((a, i) => (
              <div key={i} style={{
                background: BG2, borderRadius: 8, padding: "10px 12px", marginBottom: 6,
                borderLeft: `3px solid ${a.cor}`, border: `0.5px solid ${BD}`
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: a.cor, marginBottom: 3 }}>● {a.titulo}</div>
                <div style={{ fontSize: 10, color: TXM, lineHeight: 1.55 }}>{a.texto}</div>
              </div>
            ))}

            <div style={{
              background: BG2, borderRadius: 12, padding: 16, marginTop: 16, border: `0.5px solid ${BD}`
            }}>
              <div style={{ background: BG3, borderRadius: 8, padding: 12, border: `0.5px solid ${GO}40` }}>
                <div style={{ fontSize: 10, color: GO, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>PARECER DO CONSELHO</div>
                <div style={{ fontSize: 11, color: TX, lineHeight: 1.7 }}>
                  Empresa sólida com faturamento de R$ 6,5 milhões e lucro de 10,2%. Duas prioridades:
                  triplicar a Manutenção (único negócio com receita fixa e maior margem) e corrigir preços
                  incluindo o custo da estrutura no cálculo. A Loja Online deve ser encerrada em 30 dias.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* NEGÓCIOS */}
        {aba === "negocios" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" }}>
              <div style={{ width: 3, height: 16, background: GO, borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Lucro Real por Negócio (após custo da estrutura)</span>
            </div>

            {negocios.map((n, i) => (
              <div key={i} style={{
                background: BG2, borderRadius: 10, padding: "12px 14px", marginBottom: 8,
                borderLeft: `3px solid ${n.cor}`, border: `0.5px solid ${BD}`
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>{n.nome}</div>
                    <div style={{ fontSize: 9, color: TXD }}>{n.tipo}</div>
                  </div>
                  <span style={{
                    fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 600,
                    background: n.lucro.includes("(") ? R + "20" : GO + "20",
                    color: n.lucro.includes("(") ? R : GO
                  }}>{n.saude}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                  {[
                    ["Faturou", `R$${n.fat}`, TX],
                    ["Margem", n.mc, parseFloat(n.mc) >= 0 ? G : R],
                    ["Lucro Real", `R$${n.lucro}`, n.lucro.includes("(") ? R : GO],
                    ["Lucro %", n.lucro_p, parseFloat(n.lucro_p) >= 0 ? GO : R]
                  ].map(([lb, vl, cl]) => (
                    <div key={lb as string} style={{ textAlign: "center", background: BG3, borderRadius: 6, padding: "6px 4px" }}>
                      <div style={{ fontSize: 8, color: TXD }}>{lb}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: cl as string }}>{vl}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* RESULTADO */}
        {aba === "resultado" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" }}>
              <div style={{ width: 3, height: 16, background: GO, borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Resultado Financeiro — De onde vem e para onde vai o dinheiro</span>
            </div>

            <div style={{ background: BG2, borderRadius: 12, padding: 8, border: `0.5px solid ${BD}`, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 500 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BD}` }}>
                    {["", "Janeiro", "Fevereiro", "Março", "Total 1T"].map(h => (
                      <th key={h} style={{ padding: "8px 6px", textAlign: h === "" ? "left" : "right", color: GOL, fontSize: 10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { conta: "FATURAMENTO BRUTO", jan: "2.226.400", fev: "1.144.200", mar: "3.129.400", acum: "6.500.000", dest: true, tipo: "fat" },
                    { conta: "(-) Devoluções + Impostos", jan: "(122.040)", fev: "(68.940)", mar: "(172.375)", acum: "(363.355)", dest: false, tipo: "custo" },
                    { conta: "= FATURAMENTO LÍQUIDO", jan: "2.104.360", fev: "1.075.260", mar: "2.957.025", acum: "6.136.645", dest: true, tipo: "sub" },
                    { conta: "(-) Custo Produtos + Equipe Direta", jan: "(1.689.690)", fev: "(970.884)", mar: "(2.270.411)", acum: "(4.930.985)", dest: false, tipo: "custo" },
                    { conta: "= MARGEM DIRETA", jan: "414.670", fev: "104.376", mar: "686.614", acum: "1.205.660", dest: true, tipo: "margem" },
                    { conta: "(-) Custo Estrutura Central", jan: "(178.485)", fev: "(178.650)", mar: "(185.720)", acum: "(542.855)", dest: false, tipo: "custo" },
                    { conta: "= LUCRO DA OPERAÇÃO", jan: "236.185", fev: "(74.274)", mar: "500.894", acum: "662.805", dest: true, tipo: "lucro" },
                    { conta: "(-) Desgaste + Juros + IR", jan: "(20.400)", fev: "(19.000)", mar: "(21.800)", acum: "(61.200)", dest: false, tipo: "custo" },
                    { conta: "= LUCRO FINAL", jan: "215.785", fev: "(93.274)", mar: "479.094", acum: "601.605", dest: true, tipo: "final" },
                  ].map((r, i) => (
                    <tr key={i} style={{
                      background: r.tipo === "margem" ? G + "10" : r.tipo === "lucro" ? GO + "10" : r.tipo === "final" ? GO + "18" : "transparent",
                      borderBottom: `0.5px solid ${BD}40`
                    }}>
                      <td style={{ padding: 6, fontWeight: r.dest ? 700 : 400, color: r.dest ? TX : TXM }}>{r.conta}</td>
                      {[r.jan, r.fev, r.mar, r.acum].map((v, j) => (
                        <td key={j} style={{
                          padding: 6, textAlign: "right", fontWeight: r.dest ? 700 : 400,
                          color: v.includes("(") ? R : r.tipo === "margem" || r.tipo === "lucro" || r.tipo === "final" ? GOL : TX
                        }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <div style={{ background: BG2, borderRadius: 8, padding: 12, textAlign: "center", border: `0.5px solid ${BD}` }}>
                <div style={{ fontSize: 9, color: TXD }}>Faturamento Mínimo / Mês</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: GOL }}>R$ 978K</div>
                <div style={{ fontSize: 9, color: TXM }}>Abaixo disso, dá prejuízo</div>
              </div>
              <div style={{ background: BG2, borderRadius: 8, padding: 12, textAlign: "center", border: `0.5px solid ${BD}` }}>
                <div style={{ fontSize: 9, color: TXD }}>Custo Estrutura / Mês</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: Y }}>R$ 181K</div>
                <div style={{ fontSize: 9, color: TXM }}>Sede, ADM, veículos</div>
              </div>
            </div>
          </div>
        )}

        {/* RELATÓRIO IA */}
        {aba === "relatorio" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" }}>
              <div style={{ width: 3, height: 16, background: GO, borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Gerar Relatório Completo para o Conselho</span>
            </div>

            <div style={{ background: BG2, borderRadius: 12, padding: 16, border: `0.5px solid ${BD}` }}>
              <div style={{ fontSize: 11, color: TXD, marginBottom: 8 }}>Período de análise</div>
              <select style={{ marginBottom: 12 }}>
                <option>Janeiro a Março de 2025</option>
              </select>

              <div style={{ fontSize: 11, color: TXD, marginBottom: 8 }}>Tipo de relatório</div>
              <select style={{ marginBottom: 16 }}>
                <option>Completo — 20 análises + gráficos + fichas técnicas</option>
                <option>Resumido — 5 análises principais</option>
              </select>

              <button style={{
                width: "100%", padding: 14, border: "none", borderRadius: 10,
                background: `linear-gradient(135deg, ${GO} 0%, ${GOL} 100%)`,
                color: BG, fontSize: 15, fontWeight: 700, letterSpacing: 0.5
              }}>
                ◆ Gerar Relatório
              </button>
            </div>

            <div style={{
              background: BG2, borderRadius: 12, padding: 16, marginTop: 12, border: `0.5px solid ${BD}`
            }}>
              <div style={{ fontSize: 11, color: GO, fontWeight: 600, marginBottom: 8 }}>ℹ Como funciona</div>
              <div style={{ fontSize: 11, color: TXM, lineHeight: 1.7 }}>
                O sistema coleta automaticamente os dados dos 19 módulos, calcula o rateio proporcional
                de cada negócio, analisa as fichas técnicas de 30 produtos, e envia tudo para a inteligência
                artificial que gera um relatório de 20 análises com gráficos, plano de ação e carta aos sócios.
                O documento final fica pronto em PDF para download.
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "24px 16px 20px", borderTop: `1px solid ${BD}`, marginTop: 40 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: GOL }}>PS Gestão e Capital</div>
        <div style={{ fontSize: 9, color: TXD, marginTop: 4 }}>Assessoria Empresarial e BPO Financeiro</div>
      </div>
    </div>
  );
}
