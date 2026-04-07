"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",R="#EF4444",Y="#FACC15",
    BG2="#252320",BG3="#33312A",BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90";

type Flag = {
  tipo: "critical"|"attention"|"opportunity";
  titulo: string;
  analise: string;
  acao: string;
  impacto: string;
};

function gerarFlags(dados: any, contexto: string, periodo: string): Flag[] {
  const flags: Flag[] = [];
  if (!dados) return flags;

  const totalRec = dados.total_receitas || dados.total_rec_operacional || 0;
  const totalDesp = dados.total_despesas || 0;
  const resultado = dados.resultado_periodo || (totalRec - totalDesp);
  const margem = totalRec > 0 ? (resultado / totalRec * 100) : 0;

  // DRE data from monthly
  const dre = dados.dre_mensal || [];
  const lastMonth = dre.length > 0 ? dre[dre.length - 1] : null;
  const prevMonth = dre.length > 1 ? dre[dre.length - 2] : null;

  // Grupos de custo
  const grupos = dados.grupos_custo || [];
  const topCusto = grupos.length > 0 ? grupos[0] : null;

  // ── CRÍTICOS ────────────────────────────────────
  if (resultado < 0) {
    flags.push({
      tipo: "critical",
      titulo: `Resultado Negativo: R$ ${(resultado/1000).toFixed(0)}K`,
      analise: `No período ${periodo}, a empresa gastou mais do que faturou. Receitas: R$ ${(totalRec/1000).toFixed(0)}K vs. Despesas: R$ ${(totalDesp/1000).toFixed(0)}K. Margem: ${margem.toFixed(1)}%.${contexto ? " Contexto da empresa deve ser considerado na análise das causas." : ""}`,
      acao: `1) Identificar os 3 maiores centros de custo e buscar redução imediata de 10%. 2) Revisar política de preços — a receita está cobrindo os custos variáveis? 3) Congelar contratações e gastos não essenciais até o resultado voltar ao positivo.`,
      impacto: `Para zerar o prejuízo, é necessário aumentar receita em R$ ${(Math.abs(resultado)/1000).toFixed(0)}K ou cortar custos no mesmo valor.`,
    });
  }

  if (margem > 0 && margem < 5 && totalRec > 50000) {
    flags.push({
      tipo: "critical",
      titulo: `Margem Muito Baixa: ${margem.toFixed(1)}%`,
      analise: `A operação gera lucro mínimo no período ${periodo}. Qualquer aumento de custo pode inverter o resultado para negativo.`,
      acao: `Revisar os 10 maiores itens de custo. Renegociar com fornecedores que representam mais de 5% do custo total. ${contexto.includes("energia") ? "O custo de energia mencionado no contexto deve ser priorizado." : ""}`,
      impacto: `Meta: margem de 10% em 90 dias = +R$ ${(totalRec * 0.05 / 1000).toFixed(0)}K de resultado adicional.`,
    });
  }

  // Top custo crescendo
  if (topCusto && topCusto.total > totalDesp * 0.3) {
    flags.push({
      tipo: "critical",
      titulo: `Concentração de Custos: ${topCusto.nome}`,
      analise: `O grupo "${topCusto.nome}" representa ${(topCusto.total/totalDesp*100).toFixed(0)}% do total de despesas (R$ ${(topCusto.total/1000).toFixed(0)}K de R$ ${(totalDesp/1000).toFixed(0)}K). Alta concentração em um único grupo gera vulnerabilidade.`,
      acao: `Detalhar as ${topCusto.contas?.length || 0} contas deste grupo. Identificar quais cresceram acima da inflação. ${contexto.includes("rotatividade") ? "A rotatividade mencionada no contexto pode estar inflando custos de pessoal com rescisões." : "Negociar contratos de maior valor."}`,
      impacto: `Redução de 10% neste grupo = economia de R$ ${(topCusto.total * 0.1 / 1000).toFixed(0)}K no período.`,
    });
  }

  // ── ATENÇÃO ────────────────────────────────────
  if (lastMonth && prevMonth) {
    const recAtual = Number(lastMonth.receita) || 0;
    const recAnterior = Number(prevMonth.receita) || 0;
    if (recAnterior > 0 && recAtual < recAnterior * 0.9) {
      const queda = ((1 - recAtual / recAnterior) * 100).toFixed(1);
      flags.push({
        tipo: "attention",
        titulo: `Receita Caiu ${queda}% no Último Mês`,
        analise: `Receita passou de R$ ${(recAnterior/1000).toFixed(0)}K para R$ ${(recAtual/1000).toFixed(0)}K. ${contexto.includes("sazonalidade") || contexto.includes("Sazonalidade") ? "Verificar se a queda é sazonal conforme indicado no contexto." : "Investigar causa: perda de clientes, redução de ticket ou problema operacional."}`,
        acao: `Contatar os 10 maiores clientes para entender se há insatisfação. Verificar se concorrentes lançaram promoção.`,
        impacto: `Recuperar o nível anterior significaria +R$ ${((recAnterior - recAtual)/1000).toFixed(0)}K/mês.`,
      });
    }
  }

  // Custo crescendo mais que receita
  if (dre.length >= 3) {
    const first = dre[0];
    const last = dre[dre.length - 1];
    const recGrowth = first.receita > 0 ? ((last.receita || 0) / first.receita - 1) : 0;
    const despGrowth = first.lucro_final !== undefined && first.receita > 0
      ? (((last.receita || 0) - (last.lucro_final || 0)) / ((first.receita || 0) - (first.lucro_final || 0)) - 1)
      : 0;
    if (despGrowth > recGrowth + 0.05 && despGrowth > 0.1) {
      flags.push({
        tipo: "attention",
        titulo: "Custos Crescem Mais Rápido que Receita",
        analise: `No período ${periodo}, os custos cresceram ${(despGrowth*100).toFixed(0)}% enquanto a receita cresceu ${(recGrowth*100).toFixed(0)}%. A tesoura está abrindo — se continuar, a margem será comprimida.`,
        acao: `Revisar cada grupo de custo no Mapa acima e identificar quais subiram acima da média. Priorizar renegociação dos 3 maiores aumentos.`,
        impacto: `Equalizar o crescimento de custos com receita preservaria R$ ${(totalRec * Math.abs(despGrowth - recGrowth) * 0.5 / 1000).toFixed(0)}K de margem.`,
      });
    }
  }

  // Multiple cost groups with issues
  const gruposAltos = grupos.filter((g: any) => g.total > totalDesp * 0.15);
  if (gruposAltos.length >= 3) {
    flags.push({
      tipo: "attention",
      titulo: `${gruposAltos.length} Grupos de Custo Significativos`,
      analise: `Há ${gruposAltos.length} grupos de custo que individualmente representam mais de 15% das despesas: ${gruposAltos.map((g: any) => g.nome).join(", ")}. Atenção à dispersão de gastos.`,
      acao: `Para cada grupo, definir um responsável e uma meta de redução de 5% em 60 dias. Acompanhar semanalmente.`,
      impacto: `Redução de 5% nos ${gruposAltos.length} grupos = economia total de R$ ${(gruposAltos.reduce((s: number, g: any) => s + g.total, 0) * 0.05 / 1000).toFixed(0)}K.`,
    });
  }

  // ── OPORTUNIDADES ────────────────────────────────
  if (margem > 10) {
    flags.push({
      tipo: "opportunity",
      titulo: `Margem Saudável de ${margem.toFixed(1)}% — Potencial de Investimento`,
      analise: `Com margem acima de 10%, a empresa tem espaço para investir em crescimento sem comprometer a operação. Resultado de R$ ${(resultado/1000).toFixed(0)}K no período.`,
      acao: `Avaliar: 1) Investimento em marketing para acelerar vendas (ROI esperado: 3x). 2) Automação de processos para reduzir custos recorrentes. 3) Capacitação da equipe para aumentar produtividade.`,
      impacto: `Reinvestir 20% do resultado (R$ ${(resultado * 0.2 / 1000).toFixed(0)}K) pode gerar crescimento de 15-20% no faturamento.`,
    });
  }

  if (lastMonth && prevMonth) {
    const recAtual = Number(lastMonth.receita) || 0;
    const recAnterior = Number(prevMonth.receita) || 0;
    if (recAnterior > 0 && recAtual > recAnterior * 1.1) {
      flags.push({
        tipo: "opportunity",
        titulo: `Receita em Crescimento: +${((recAtual/recAnterior-1)*100).toFixed(0)}%`,
        analise: `Receita cresceu de R$ ${(recAnterior/1000).toFixed(0)}K para R$ ${(recAtual/1000).toFixed(0)}K no último mês. ${contexto.includes("crescimento") || contexto.includes("Crescimento") ? "Confirma a tendência de crescimento mencionada no contexto." : "Momentum positivo para capitalizar."}`,
        acao: `Aproveitar o momento: reforçar equipe comercial, negociar melhores condições com fornecedores usando o volume como argumento.`,
        impacto: `Se mantido o ritmo, projeção de receita anual: R$ ${(recAtual * 12 / 1000000).toFixed(1)}M.`,
      });
    }
  }

  // Context-specific opportunities
  if (contexto.includes("exportação") || contexto.includes("internacional")) {
    flags.push({
      tipo: "opportunity",
      titulo: "Potencial de Expansão Internacional",
      analise: "O contexto indica operação internacional. Com câmbio favorável, há oportunidade de aumentar a participação de exportação para melhorar margem em reais.",
      acao: "Prospectar novos mercados via APEX Brasil. Avaliar certificações adicionais para acessar mercados premium.",
      impacto: `Cada 10% a mais de exportação pode agregar 2-3pp de margem adicional.`,
    });
  }

  if (contexto.includes("OEE") || contexto.includes("oee")) {
    flags.push({
      tipo: "opportunity",
      titulo: "Ganho de Eficiência Industrial (OEE)",
      analise: "O contexto menciona indicador OEE com meta acima do atual. Cada ponto de OEE representa ganho direto de produtividade e margem.",
      acao: "Implementar programa de melhoria contínua com metas semanais de OEE. Focar nos 3 maiores gargalos: setup, paradas e refugo.",
      impacto: `Cada 1pp de OEE equivale a aproximadamente R$ ${(totalRec * 0.004 / 1000).toFixed(0)}K de margem adicional/período.`,
    });
  }

  return flags;
}

const FlagColors = {
  critical: { bg: "#EF444410", border: "#EF444435", accent: R, label: "CRÍTICO" },
  attention: { bg: "#FACC1510", border: "#FACC1530", accent: Y, label: "ATENÇÃO" },
  opportunity: { bg: "#22C55E10", border: "#22C55E30", accent: G, label: "OPORTUNIDADE" },
};

export default function AnaliseIAFlags({ realData, empresaId, periodo }: { realData: any; empresaId: string; periodo: string }) {
  const [contexto, setContexto] = useState("");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadContexto = async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("ai_reports")
          .select("report_content")
          .eq("report_type", "contexto_humano")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (data?.report_content) {
          const content = typeof data.report_content === "string" ? data.report_content : JSON.stringify(data.report_content);
          setContexto(content);
        }
      } catch {}
      setLoading(false);
    };
    loadContexto();
  }, [empresaId]);

  useEffect(() => {
    if (!loading) {
      const result = gerarFlags(realData, contexto, periodo);
      setFlags(result);
      setExpanded({});
    }
  }, [realData, contexto, periodo, loading]);

  if (!realData || flags.length === 0) return null;

  const counts = {
    critical: flags.filter(f => f.tipo === "critical").length,
    attention: flags.filter(f => f.tipo === "attention").length,
    opportunity: flags.filter(f => f.tipo === "opportunity").length,
  };

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${GO}, ${GOL})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#0F0F0D"
          }}>PS</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: GOL }}>Análise IA — Consultor Digital</div>
            <div style={{ fontSize: 9, color: TXD }}>Cruzamento: DRE + Custos + Contexto · {periodo}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {counts.critical > 0 && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, color: R, background: "#EF444415", border: "1px solid #EF444430" }}>🔴 {counts.critical}</span>}
          {counts.attention > 0 && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, color: Y, background: "#FACC1515", border: "1px solid #FACC1530" }}>🟡 {counts.attention}</span>}
          {counts.opportunity > 0 && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, color: G, background: "#22C55E15", border: "1px solid #22C55E30" }}>🟢 {counts.opportunity}</span>}
        </div>
      </div>

      {/* Flags */}
      {flags.map((flag, i) => {
        const c = FlagColors[flag.tipo];
        const isOpen = !!expanded[i];
        return (
          <div key={i} style={{
            background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
            marginBottom: 6, overflow: "hidden", borderLeft: `3px solid ${c.accent}`,
          }}>
            <div
              onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
              style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {flag.tipo === "critical" ? "🔴" : flag.tipo === "attention" ? "🟡" : "🟢"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: TX }}>{flag.titulo}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: "1px 6px", borderRadius: 4, background: `${c.accent}20`, color: c.accent }}>{c.label}</span>
                </div>
                <div style={{ fontSize: 11, color: TXM, lineHeight: 1.5 }}>{flag.analise}</div>
              </div>
              <span style={{ color: TXD, fontSize: 14, flexShrink: 0, transition: "transform 0.3s", transform: isOpen ? "rotate(180deg)" : "" }}>▾</span>
            </div>
            {isOpen && (
              <div style={{ borderTop: `1px solid ${c.border}`, padding: "10px 14px 10px 40px" }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.accent, letterSpacing: 1, marginBottom: 4 }}>▸ AÇÃO RECOMENDADA</div>
                  <div style={{ fontSize: 11, color: TX, lineHeight: 1.6, background: "#00000030", padding: "8px 10px", borderRadius: 6 }}>{flag.acao}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.accent, letterSpacing: 1, marginBottom: 4 }}>▸ IMPACTO ESTIMADO</div>
                  <div style={{ fontSize: 11, color: TX, lineHeight: 1.5 }}>{flag.impacto}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 8, color: TXD, textAlign: "right", marginTop: 6 }}>
        Análise automática · {flags.length} alertas · {new Date().toLocaleDateString("pt-BR")} {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}
