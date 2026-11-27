// Leituras para a decisão do BI Financeiro da Diretoria — frases calculadas a partir do JSON da porta
// fn_bi_financeiro_painel (sem API paga: a "IA" do painel aqui é regra explícita sobre os números, auditável).
// Função pura, sem React, para o gate e para teste.

export type Faixa = { faixa: string; ordem: number; receber: number; receber_n: number; pagar: number; pagar_n: number }
export type Semana = { semana: string; entradas: number; saidas: number; liquido: number; acumulado: number }
export type MesFin = {
  mes: string
  receita_emissao: number; despesa_emissao: number; resultado_emissao: number
  receita_caixa: number; despesa_caixa: number; resultado_caixa: number
  impostos: number
}
export type PainelFin = {
  ok: boolean; erro?: string; mensagem?: string
  visao: 'gerencial'; aviso: string; regime: 'competencia' | 'caixa'
  periodo: { de: string; ate: string; dias: number }
  resumo: { receita: number; despesa: number; resultado: number; margem_pct: number | null; impostos: number; titulos_receber: number; titulos_pagar: number }
  anterior: { de: string; ate: string; receita: number; despesa: number; resultado: number }
  outro_regime: { regime: 'competencia' | 'caixa'; receita: number; despesa: number; resultado: number }
  meses: MesFin[]
  aberto: {
    receber: { saldo: number; vencido: number; vencido_30: number; titulos: number; clientes_vencidos: number }
    pagar: { saldo: number; vencido: number; vencido_30: number; titulos: number }
    inadimplencia_pct: number | null; inadimplencia_30_pct: number | null
    adiantamentos: { clientes: number; fornecedores: number }
    data_base: string
  }
  aging: Faixa[]
  devedores: { cliente: string; vencido: number; titulos: number; maior_atraso: number }[]
  fluxo: { vencidos: { entradas: number; saidas: number }; semanas: Semana[]; depois: { entradas: number; saidas: number } }
  impostos: {
    total: number; pct_despesa: number | null
    por_tipo: { tipo: string; valor: number; titulos: number }[]
    credores: { credor: string; tipo: string; valor: number }[]
    status: 'proposta' | 'validada' | 'sem_regra'
    regras: { tipo: string; campo: string; padrao: string; status: string; de: string }[]
  }
  despesa_natureza: { natureza: string; valor: number; titulos: number; pct: number | null }[]
  despesa_forma: { forma: string; valor: number; titulos: number; pct: number | null }[]
  despesa_fornecedor: { fornecedor: string; natureza: string; valor: number; titulos: number; pct: number | null }[]
  receita_cliente: { cliente: string; grupo: string | null; valor: number; titulos: number; pct: number | null }[]
  receita_grupo: { grupo: string; valor: number; clientes: number; pct: number | null }[]
  concentracao: { top10_clientes_pct: number | null; top10_fornecedores_pct: number | null; receita_com_grupo_pct: number | null }
  fora_resultado: { adiant_clientes: number; adiant_fornecedores: number }
  qualidade: { titulos: number; cancelados: number; cancelados_valor: number; sem_classificacao: number; ultima_importacao: string | null; primeira_emissao: string | null }
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
export const brlc = (v: number | null | undefined) =>
  v == null ? '—' : Math.abs(v) >= 1e6 ? `R$ ${nf({ maximumFractionDigits: 1 }).format(v / 1e6)} mi`
    : Math.abs(v) >= 1e4 ? `R$ ${nf({ maximumFractionDigits: 0 }).format(v / 1e3)} mil`
      : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
export const pct = (v: number | null | undefined, d = 1) => v == null || !isFinite(v) ? '—' : `${nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}%`
export const varp = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : 100 * (a - b) / Math.abs(b)
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesRot = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`

/** Situação de um indicador (verde/âmbar/vermelho) — limites explícitos, mostrados na ajuda. */
export function situacaoMargem(m: number | null | undefined): 'ok' | 'atencao' | 'ruim' | null {
  if (m == null) return null
  return m >= 8 ? 'ok' : m >= 0 ? 'atencao' : 'ruim'
}
export function situacaoInadimplencia(p: number | null | undefined): 'ok' | 'atencao' | 'ruim' | null {
  if (p == null) return null
  return p <= 5 ? 'ok' : p <= 12 ? 'atencao' : 'ruim'
}

/** Frase-resumo do topo. */
export function fraseResumo(p: PainelFin): string {
  const r = p.resumo
  const visao = p.regime === 'caixa' ? 'pelo caixa (recebido − pago)' : 'pela emissão dos títulos'
  const sinal = r.resultado >= 0 ? 'positivo' : 'negativo'
  return `Resultado gerencial ${sinal} de ${brlc(r.resultado)} ${visao}: entraram ${brlc(r.receita)} e saíram ${brlc(r.despesa)}` +
    (r.margem_pct != null ? `, margem de ${pct(r.margem_pct)} sobre a receita.` : '.')
}

/** Leituras para a decisão — no máximo 6, do mais importante ao menos. */
export function leituras(p: PainelFin): string[] {
  const out: string[] = []
  const r = p.resumo, a = p.anterior, ab = p.aberto
  // 1) resultado × período anterior (só compara se o anterior tem movimento comparável)
  const vRes = varp(r.resultado, a.resultado)
  if (a.receita > 0.5 * r.receita && vRes != null) {
    out.push(`Resultado ${vRes >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(vRes))} contra o período anterior de mesmo tamanho (${brlc(a.resultado)}).`)
  } else if (a.receita > 0) {
    out.push('O período anterior tem histórico incompleto no ERP de origem; a comparação fica para quando houver o mesmo intervalo completo.')
  }
  // 2) mês mais fraco da visão escolhida
  const cx = p.regime === 'caixa'
  const meses = p.meses.filter((m) => (cx ? m.receita_caixa : m.receita_emissao) > 0)
  if (meses.length >= 3) {
    const res = (m: MesFin) => cx ? m.resultado_caixa : m.resultado_emissao
    const pior = meses.reduce((x, y) => res(y) < res(x) ? y : x)
    const melhor = meses.reduce((x, y) => res(y) > res(x) ? y : x)
    out.push(`Melhor mês: ${mesRot(melhor.mes)} (${brlc(res(melhor))}); mais fraco: ${mesRot(pior.mes)} (${brlc(res(pior))}). Vale abrir o mais fraco por natureza da despesa.`)
  }
  // 3) emissão × caixa
  const dif = p.outro_regime.resultado - r.resultado
  if (Math.abs(dif) > 0.05 * Math.max(1, Math.abs(r.resultado))) {
    out.push(`Na visão ${p.outro_regime.regime === 'caixa' ? 'de caixa' : 'por emissão'} o resultado seria ${brlc(p.outro_regime.resultado)} (${dif >= 0 ? '+' : '−'}${brlc(Math.abs(dif))}): é o prazo entre faturar e receber/pagar.`)
  }
  // 4) inadimplência
  if (ab.inadimplencia_pct != null && ab.receber.vencido > 0) {
    const top = p.devedores[0]
    out.push(`${pct(ab.inadimplencia_pct)} do a receber está vencido (${brlc(ab.receber.vencido)} em ${ab.receber.clientes_vencidos} clientes), ${pct(ab.inadimplencia_30_pct)} há mais de 30 dias` +
      (top ? `; o maior é ${top.cliente} com ${brlc(top.vencido)} e ${top.maior_atraso} dias.` : '.'))
  }
  // 5) caixa das próximas 4 semanas
  const s4 = p.fluxo.semanas.slice(0, 4)
  if (s4.length) {
    const liq = s4.reduce((s, w) => s + w.liquido, 0)
    const neg = s4.find((w) => w.liquido < 0)
    out.push(`Próximas 4 semanas pelos vencimentos: ${liq >= 0 ? 'sobra' : 'falta'} de ${brlc(Math.abs(liq))}` +
      (neg ? `; a semana de ${neg.semana.slice(8, 10)}/${neg.semana.slice(5, 7)} sai mais do que entra (${brlc(neg.liquido)}).` : '.'))
  }
  // 6) concentração
  const nat0 = p.despesa_natureza[0]
  if (nat0?.pct != null && nat0.pct >= 40) out.push(`${nat0.natureza} pesa ${pct(nat0.pct)} da despesa: é a alavanca principal do resultado.`)
  else if (p.concentracao.top10_clientes_pct != null && p.concentracao.top10_clientes_pct >= 40) out.push(`Os 10 maiores clientes somam ${pct(p.concentracao.top10_clientes_pct)} da receita: concentração alta.`)
  return out.slice(0, 6)
}
