// Hub · Mão de obra — a MESMA conta de public.fn_mao_obra_custo_calcular (migration 20261002130000, remuneração por
// componentes, SPEC Hub E1+E2 rev. 16 seção 5.1). A tela usa esta para mostrar o custo enquanto a pessoa digita; o banco
// usa a dele para a média da função e para o catálogo. O teste de aceitação confere que as duas dão o mesmo número.
//
// Cada componente vira um valor do mês: fixo mensal = valor; fixo por hora = valor × horas; produção = R$/unidade ×
// volume médio; empreitada = valor × 30 ÷ dias da obra; diária = R$ × dias; comissão = % × base média; bônus = valor;
// hora extra = horas × valor da hora (fixo ÷ 220, ou o informado) × (1 + adicional, 50% padrão); insalubridade = % do
// salário mínimo; periculosidade = % (30) do fixo; noturno = horas × hora × % (20).
// CLT/intermitente (pelas chaves de incidência de cada componente):
//   DSR = fator (1/6) × Σ(gera DSR); provisões = (Σ entra em 13º/férias + DSR) × (13º + férias + 1/3);
//   encargos = (Σ incide INSS/FGTS + DSR + provisões) × encargos %; rescisão = (Σ integra + DSR) × rescisão %.
// Autônomo (RPA) e diarista: + INSS do RPA (20%; 0% no Simples Anexo III/V). MEI/PJ/empreiteiro: sem encargos, salvo
// MEI em serviço de obra (+20% de INSS patronal, LC 123). Benefícios somam no fim. Tudo "a confirmar com o contador".
// Exemplo da SPEC 5.1: fixo 2.000 + R$ 3,00/m² × 500 m² → R$ 7.077/mês → R$ 40,21/h ou R$ 14,15/m².
// Ficha antiga (salário único): R$ 2.800 → R$ 5.487 → R$ 31,18/h (Lucro Real, 36,8%).

export type Vinculo = 'clt' | 'clt_intermitente' | 'rpa' | 'pj' | 'diarista'
export type FormaPagamento = 'mensal' | 'hora' | 'producao' | 'diaria' | 'm2'
export type TipoComponente = 'fixo' | 'producao' | 'empreitada' | 'diaria' | 'comissao' | 'bonus' | 'hora_extra' | 'adicional'

export interface ChavesIncidencia {
  gera_dsr: boolean
  integra_13_ferias: boolean
  incide_encargos: boolean
  integra_remuneracao: boolean
}

export interface Componente extends Partial<ChavesIncidencia> {
  id?: string
  tipo: TipoComponente
  subtipo?: string | null       // fixo: mensal|hora · adicional: insalubridade|periculosidade|noturno|outro
  descricao?: string | null
  valor?: number | null         // R$ (mês, hora, unidade, obra, dia, bônus)
  quantidade?: number | null    // volume/mês, horas, dias, dias da obra, base da comissão
  percentual?: number | null    // comissão %, adicional da HE, % do adicional
  unidade?: string | null       // m2, m, ponto, peca…
  estimado?: boolean
  chaves_ajustadas?: boolean
}

export interface FichaCusto {
  vinculo: Vinculo
  forma_pagamento: FormaPagamento
  componentes: Componente[]
  mei_servico_obra: boolean
  beneficio_vt: number
  beneficio_alimentacao: number
  beneficio_saude: number
  beneficio_seguro: number
  beneficio_epi: number
  horas_produtivas_mes: number
  // ficha antiga (sem componentes)
  salario: number
  valor_unidade: number
  dias_mes: number
  adicional_insalubridade: number
  adicional_periculosidade: number
  adicional_outros: number
  // ajuste desta ficha (null/ausente = padrão da empresa)
  encargos_folha_pct_ajuste?: number | null
  prov_13_pct_ajuste?: number | null
  prov_ferias_pct_ajuste?: number | null
  prov_rescisao_pct_ajuste?: number | null
  dsr_fator_ajuste?: number | null
}

/** Padrões da empresa para a ficha nova ("Configurar padrões"). */
export interface PadroesFicha {
  horas_produtivas_mes: number
  vinculo: Vinculo
  forma_pagamento: FormaPagamento
  beneficio_vt: number
  beneficio_alimentacao: number
  beneficio_saude: number
  beneficio_seguro: number
  beneficio_epi: number
  dsr_fator: number
  rpa_inss_pct: number
  salario_minimo: number
  incidencia: Record<string, ChavesIncidencia>
}

export interface Encargos {
  provisorio: boolean
  regime: 'simples' | 'presumido' | 'real'
  simples_anexo: string | null
  inss_patronal_pct: number
  rat_pct: number
  fap: number
  terceiros_pct: number
  fgts_pct: number
  desoneracao: boolean
  desoneracao_fator_folha: number
  cprb_pct: number | null
  prov_13_pct: number
  prov_ferias_pct: number
  prov_rescisao_pct: number
  encargos_folha_pct: number
  padroes?: Partial<PadroesFicha>
}

export type AlertaCusto = 'diarista_mais_8_dias' | 'volume_estimado'

export interface ResultadoCusto {
  base: number
  dsr: number
  provisoes: number
  remuneracao: number
  encargos: number
  rescisao: number
  beneficios: number
  custo_mensal: number | null
  custo_hora: number | null
  custo_unidade: number | null
  unidade: string | null
  custo_m2: number | null
  // horas extras (Mão de obra · HE): custo da hora SEM e COM horas extras, lado a lado
  horas_extras: number
  custo_he: number | null
  custo_mensal_sem_he: number | null
  custo_hora_sem_he: number | null
  custo_hora_com_he: number | null
  // percentuais efetivamente usados (ajuste da ficha ou padrão da empresa)
  encargos_folha_pct: number
  prov_13_pct: number
  prov_ferias_pct: number
  prov_rescisao_pct: number
  dsr_fator: number
  rpa_inss_pct: number
  alertas: AlertaCusto[]
}

export const TIPOS_COMPONENTE: { tipo: TipoComponente; rotulo: string; ajuda: string }[] = [
  { tipo: 'fixo', rotulo: 'Fixo', ajuda: 'Salário mensal ou valor por hora' },
  { tipo: 'producao', rotulo: 'Produção por unidade', ajuda: 'R$ por m², metro, ponto, peça… × volume médio do mês' },
  { tipo: 'empreitada', rotulo: 'Empreitada por obra', ajuda: 'Valor da obra × 30 ÷ dias da obra' },
  { tipo: 'diaria', rotulo: 'Diária', ajuda: 'R$ por dia × dias no mês' },
  { tipo: 'comissao', rotulo: 'Comissão', ajuda: '% sobre a base média do mês' },
  { tipo: 'bonus', rotulo: 'Bônus / prêmio', ajuda: 'Valor médio do mês' },
  { tipo: 'hora_extra', rotulo: 'Horas extras habituais', ajuda: 'Horas no mês × hora × (1 + adicional)' },
  { tipo: 'adicional', rotulo: 'Adicional legal', ajuda: 'Insalubridade (% do mínimo), periculosidade (30% do fixo), noturno' },
]

export const VINCULOS: { v: Vinculo; rotulo: string }[] = [
  { v: 'clt', rotulo: 'CLT' },
  { v: 'clt_intermitente', rotulo: 'CLT intermitente' },
  { v: 'rpa', rotulo: 'Autônomo (RPA)' },
  { v: 'pj', rotulo: 'MEI / PJ / empreiteiro' },
  { v: 'diarista', rotulo: 'Diarista' },
]

/** Funções em que o MEI paga 20% de INSS patronal pelo contratante (LC 123): a chave "MEI em serviço de obra" já vem ligada. */
const AREAS_MEI_OBRA = /hidr[aá]ul|encanad|el[eé]tric|pint|alvenar|pedreir|carpint/i
export function meiServicoObraPadrao(nomeFuncao: string | null | undefined): boolean {
  return AREAS_MEI_OBRA.test(nomeFuncao ?? '')
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown, d = 0) => { if (v === null || v === undefined || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d }

/** Encargos da folha (%) = INSS patronal × fator da folha (desoneração) + RAT × FAP + terceiros + FGTS. */
export function encargosFolhaPct(e: Pick<Encargos, 'inss_patronal_pct' | 'desoneracao_fator_folha' | 'rat_pct' | 'fap' | 'terceiros_pct' | 'fgts_pct'>): number {
  return Math.round((num(e.inss_patronal_pct) * num(e.desoneracao_fator_folha, 1) + num(e.rat_pct) * num(e.fap, 1) + num(e.terceiros_pct) + num(e.fgts_pct)) * 10000) / 10000
}

/** INSS do autônomo (RPA) pelo regime: 0% no Simples Anexo III/V (já está no DAS); 20% no Anexo IV, Real e Presumido. */
export function rpaInssPadrao(regime: string | null | undefined, anexo: string | null | undefined): number {
  return regime === 'simples' && (anexo === 'III' || anexo === 'V') ? 0 : 20
}

/** Chaves de incidência pré-preenchidas pelo tipo e vínculo (mesma regra de fn_mao_obra_chaves_padrao). */
export function chavesPadrao(vinculo: Vinculo, tipo: TipoComponente, subtipo?: string | null, empresa: Record<string, ChavesIncidencia> = {}): ChavesIncidencia {
  const nao = { gera_dsr: false, integra_13_ferias: false, incide_encargos: false, integra_remuneracao: false }
  if (vinculo !== 'clt' && vinculo !== 'clt_intermitente') return nao   // terceiros: regra do vínculo, sem chaves de folha
  const k = subtipo ? `${tipo}:${subtipo}` : tipo
  if (empresa[k]) return { ...empresa[k] }
  if (empresa[tipo]) return { ...empresa[tipo] }
  if (tipo === 'bonus') return nao
  if (tipo === 'fixo' && (subtipo ?? 'mensal') === 'mensal') return { gera_dsr: false, integra_13_ferias: true, incide_encargos: true, integra_remuneracao: true }
  if (tipo === 'adicional' && (subtipo ?? 'outro') !== 'noturno') return { gera_dsr: false, integra_13_ferias: true, incide_encargos: true, integra_remuneracao: true }
  return { gera_dsr: true, integra_13_ferias: true, incide_encargos: true, integra_remuneracao: true }
}

/** Ficha antiga (salário único, sem componentes) → componentes equivalentes (mesmo resultado de antes). */
export function componentesDaFichaAntiga(f: Partial<FichaCusto>): Componente[] {
  const vinc = f.vinculo ?? 'clt'
  const forma = f.forma_pagamento ?? 'mensal'
  if (vinc === 'diarista') return [{ tipo: 'diaria', valor: num(f.valor_unidade), quantidade: num(f.dias_mes, 22) }]
  if (vinc === 'pj' && forma === 'hora') return [{ tipo: 'fixo', subtipo: 'hora', valor: num(f.valor_unidade), quantidade: num(f.horas_produtivas_mes, 176) }]
  if (vinc === 'pj' && (forma === 'm2' || forma === 'producao')) return [{ tipo: 'producao', valor: num(f.valor_unidade), quantidade: 0, unidade: 'm2' }]
  const out: Componente[] = [{ tipo: 'fixo', subtipo: 'mensal', valor: num(f.salario), ...chavesPadrao(vinc, 'fixo', 'mensal') }]
  if (vinc === 'clt' || vinc === 'clt_intermitente') {
    out.push({ tipo: 'adicional', subtipo: 'outro', valor: num(f.adicional_insalubridade) + num(f.adicional_periculosidade) + num(f.adicional_outros), ...chavesPadrao(vinc, 'adicional', 'outro') })
  }
  return out
}

/** Valor do mês de um componente (precisa do fixo mensal e da hora-base da ficha). */
export function valorMesComponente(c: Componente, ctx: { fixoMes: number; horaBase: number; salarioMinimo: number }): number {
  const valor = num(c.valor), qtd = num(c.quantidade)
  switch (c.tipo) {
    case 'fixo': return (c.subtipo ?? 'mensal') === 'hora' ? valor * qtd : valor
    case 'producao': return valor * qtd
    case 'empreitada': return valor * 30 / Math.max(qtd, 1)
    case 'diaria': return valor * qtd
    case 'comissao': return num(c.percentual) / 100 * qtd
    case 'bonus': return valor
    case 'hora_extra': return qtd * (valor > 0 ? valor : ctx.horaBase) * (1 + num(c.percentual, 50) / 100)
    case 'adicional':
      switch (c.subtipo ?? 'outro') {
        case 'insalubridade': return num(c.percentual, 20) / 100 * ctx.salarioMinimo
        case 'periculosidade': return num(c.percentual, 30) / 100 * ctx.fixoMes
        case 'noturno': return qtd * ctx.horaBase * num(c.percentual, 20) / 100
        default: return valor
      }
    default: return 0
  }
}

/** "Pelo menos um componente com valor" (mesma regra de fn__mao_obra_componentes_tem_valor). */
export function temComponenteComValor(comps: Componente[] | null | undefined): boolean {
  return (comps ?? []).some(c => num(c.valor) > 0
    || (c.tipo === 'comissao' && num(c.percentual) > 0 && num(c.quantidade) > 0)
    || (c.tipo === 'adicional' && (c.subtipo === 'insalubridade' || c.subtipo === 'periculosidade') && num(c.percentual) > 0))
}

export function calcularCustoMaoObra(
  f: Partial<FichaCusto>,
  e: Pick<Encargos, 'prov_13_pct' | 'prov_ferias_pct' | 'prov_rescisao_pct' | 'encargos_folha_pct'> & { padroes?: Partial<PadroesFicha> },
): ResultadoCusto {
  const vinc = f.vinculo ?? 'clt'
  const pad = e.padroes ?? {}
  const horas = num(f.horas_produtivas_mes, 176) || null
  const ben = num(f.beneficio_vt) + num(f.beneficio_alimentacao) + num(f.beneficio_saude) + num(f.beneficio_seguro) + num(f.beneficio_epi)
  const aj = (v: number | null | undefined, padrao: number) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? padrao : Number(v))
  const p13 = aj(f.prov_13_pct_ajuste, num(e.prov_13_pct, 8.33)), pfer = aj(f.prov_ferias_pct_ajuste, num(e.prov_ferias_pct, 11.11))
  const presc = aj(f.prov_rescisao_pct_ajuste, num(e.prov_rescisao_pct, 4)), encp = aj(f.encargos_folha_pct_ajuste, num(e.encargos_folha_pct, 36.8))
  const dsrf = aj(f.dsr_fator_ajuste, num(pad.dsr_fator, 1 / 6))
  const rpa = num(pad.rpa_inss_pct, 20)
  const sm = num(pad.salario_minimo, 1518)
  const comps = f.componentes && f.componentes.length > 0 ? f.componentes : componentesDaFichaAntiga(f)

  let fixoMes = 0, horaFixa = 0
  for (const c of comps) if (c.tipo === 'fixo') { if ((c.subtipo ?? 'mensal') === 'hora') horaFixa += num(c.valor); else fixoMes += num(c.valor) }
  const ctx = { fixoMes, horaBase: fixoMes / 220 + horaFixa, salarioMinimo: sm }

  let heH = 0, heV = 0
  let a = 0, sDsr = 0, s13 = 0, sEnc = 0, sInt = 0, vol = 0, diasDiaria = 0, estimado = false
  let uni: string | null = null, valProd: number | null = null
  for (const c of comps) {
    const v = valorMesComponente(c, ctx)
    a += v
    if (c.tipo === 'hora_extra') { heH += num(c.quantidade); heV += v }
    if (c.integra_remuneracao) {
      sInt += v
      if (c.gera_dsr) sDsr += v
      if (c.integra_13_ferias) s13 += v
      if (c.incide_encargos) sEnc += v
    }
    if (c.tipo === 'producao') {
      vol += num(c.quantidade)
      uni = uni ?? (c.unidade || 'm2')
      if (valProd === null && c.valor !== null && c.valor !== undefined) valProd = num(c.valor)
    }
    if (c.tipo === 'diaria') diasDiaria += num(c.quantidade)
    if (c.estimado) estimado = true
  }

  let d = 0, p = 0, enc = 0, r = 0
  if (vinc === 'clt' || vinc === 'clt_intermitente') {
    d = sDsr * dsrf
    p = (s13 + d) * (p13 + pfer) / 100
    enc = (sEnc + d + p) * encp / 100
    r = (sInt + d) * presc / 100
  } else if (vinc === 'rpa' || vinc === 'diarista') {
    enc = a * rpa / 100                         // diarista: calculado como autônomo (CEO 01/10)
  } else if (vinc === 'pj' && f.mei_servico_obra) {
    enc = a * 20 / 100                          // MEI em serviço de obra: 20% de INSS do contratante (LC 123)
  }
  let mensal: number | null = a + d + p + enc + r + ben
  if (a === 0 && valProd !== null) mensal = null  // só produção, sem volume: não inventa custo mensal

  // custo SEM horas extras: a mesma conta sem os componentes de HE (DSR, 13º, férias, encargos e rescisão saem junto)
  const mensalSem = heV > 0 && mensal !== null ? calcularCustoMaoObra({ ...f, componentes: comps.filter(c => c.tipo !== 'hora_extra') }, e).custo_mensal : mensal

  const alertas: AlertaCusto[] = []
  if (vinc === 'diarista' && diasDiaria > 8) alertas.push('diarista_mais_8_dias')
  if (estimado) alertas.push('volume_estimado')

  const unidade = vol > 0 ? (mensal === null ? null : mensal / vol) : valProd
  const ehM2 = (uni ?? 'm2') === 'm2'
  const m2 = vol > 0 && ehM2 && mensal !== null ? mensal / vol : (valProd !== null && ehM2 && vol === 0 ? valProd : null)
  return {
    base: r2(a), dsr: r2(d), provisoes: r2(p), remuneracao: r2(a + d + p), encargos: r2(enc), rescisao: r2(r), beneficios: r2(ben),
    custo_mensal: mensal === null ? null : r2(mensal),
    custo_hora: mensal === null || horas === null ? null : r2(mensal / horas),
    custo_unidade: unidade === null ? null : r2(unidade), unidade: uni,
    custo_m2: m2 === null ? null : r2(m2),
    horas_extras: r2(heH),
    custo_he: mensal === null || mensalSem === null ? null : r2(mensal - mensalSem),
    custo_mensal_sem_he: mensalSem === null ? null : r2(mensalSem),
    custo_hora_sem_he: mensalSem === null || horas === null ? null : r2(mensalSem / horas),
    custo_hora_com_he: mensal === null || horas === null ? null : r2(mensal / (horas + heH)),
    encargos_folha_pct: encp, prov_13_pct: p13, prov_ferias_pct: pfer, prov_rescisao_pct: presc, dsr_fator: dsrf, rpa_inss_pct: rpa,
    alertas,
  }
}

/** Reoneração gradual da folha (Lei 14.973/2024): parte do INSS patronal que volta à folha, por ano. */
export function fatorFolhaReoneracao(ano: number): number {
  if (ano <= 2024) return 0
  if (ano === 2025) return 0.25
  if (ano === 2026) return 0.5
  if (ano === 2027) return 0.75
  return 1
}
