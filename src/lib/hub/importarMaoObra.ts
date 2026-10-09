// Importação em massa da Mão de obra (CEO 07/10 · FC Pisos): modelo padrão do Eng. Chefe (abas 1_Encargos_empresa e
// 2_Funcionarios). Aqui só a regra pura (sem rede): normaliza, valida linha a linha com o motivo que ensina (RD-74/RD-77)
// e monta os payloads das RPCs que já existem (fn_mao_obra_encargos_salvar / funcao_salvar / ficha_salvar). Sem caminho paralelo.
import { cpfValido, soDigitosCpf } from '@/lib/documentos/cpf'

export const VINCULOS_IMP: Record<string, string> = { clt: 'clt', 'clt intermitente': 'clt_intermitente', rpa: 'rpa', pj: 'pj', diarista: 'diarista' }
export const FORMAS_IMP: Record<string, string> = { mensal: 'mensal', hora: 'hora', producao: 'producao', diaria: 'diaria', m2: 'm2' }
export const REGIMES_IMP: Record<string, string> = { simples: 'simples', 'simples nacional': 'simples', presumido: 'presumido', 'lucro presumido': 'presumido', real: 'real', 'lucro real': 'real' }

// colunas da aba 2_Funcionarios (ordem do modelo; * = obrigatória)
export const COLUNAS_FUNC = [
  'Matrícula*', 'Nome completo*', 'CPF*', 'Data de admissão*', 'Função*', 'CBO', 'Setor', 'Vínculo*', 'Forma de pagamento*', 'Salário base (R$)*',
  'Valor por unidade (R$)', 'Insalubridade', 'Periculosidade', 'Outros adicionais', 'Vale-transporte', 'Alimentação', 'Plano de saúde', 'Seguro de vida',
  'EPI e uniforme (R$/mês)', 'Horas produtivas/mês', 'Dias trabalhados/mês', 'Vigência a partir de*', 'MEI de obra (Sim/Não)', 'Observações',
] as const
// campos da aba 1_Encargos_empresa (vertical campo/valor)
export const CAMPOS_ENC = [
  'Regime tributário*', 'Anexo do Simples', 'INSS patronal %', 'RAT %', 'FAP', 'Terceiros %', 'FGTS %', 'Provisão 13º %', 'Provisão férias + 1/3 %', 'Provisão rescisão %',
  'Desoneração da folha (Sim/Não)', 'CPRB %', 'Horas produtivas padrão', 'Salário mínimo de referência (R$)', 'Benefício padrão — vale-transporte (R$)',
  'Benefício padrão — alimentação (R$)', 'Benefício padrão — plano de saúde (R$)', 'Benefício padrão — seguro de vida (R$)', 'Benefício padrão — EPI e uniforme (R$)', 'Vigência a partir de',
] as const

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*_]/g, ' ').replace(/\s+/g, ' ').trim()

export type Celula = string | number | boolean | Date | null | undefined
export type Linha = Record<string, Celula>

const vazio = (v: Celula) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Data da planilha: Date, número serial do Excel, dd/mm/aaaa ou aaaa-mm-dd → 'aaaa-mm-dd' (null = inválida). */
export function lerData(v: Celula): string | null {
  let y: number, m: number, d: number
  if (v instanceof Date) { if (isNaN(v.getTime())) return null; y = v.getUTCFullYear(); m = v.getUTCMonth() + 1; d = v.getUTCDate() }
  else if (typeof v === 'number') { if (v < 20000 || v > 80000) return null; const t = new Date(Math.round((v - 25569) * 86400000)); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate() }
  else {
    const s = String(v ?? '').trim()
    let r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
    if (r) { d = +r[1]; m = +r[2]; y = +r[3] } else { r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!r) return null; y = +r[1]; m = +r[2]; d = +r[3] }
  }
  const t = new Date(Date.UTC(y, m - 1, d))
  if (y < 1950 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Número da planilha: 1234.5 · "1.234,50" · "R$ 1.234,50" · "20%" (null = não numérico). */
export function lerNumero(v: Celula): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim().replace(/^R\$\s*/i, '').replace(/%$/, '').trim()
  if (!/^-?[\d.,]+$/.test(s)) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const simNao = (v: Celula): boolean | null => { const s = norm(v); return s === 'sim' || s === 's' ? true : s === 'nao' || s === 'n' || s === '' ? false : null }

export interface LinhaFunc {
  linha: number; erros: string[]; avisos: string[]; ok: boolean
  matricula: string; nome: string; cpf: string; admissao: string; funcao: string; cbo: string; setor: string
  vinculo: string; forma: string; salario: number; valorUnidade: number | null
  insalubridade: number; periculosidade: number; outros: number
  vt: number; alimentacao: number; saude: number; seguro: number; epi: number
  horas: number | null; dias: number | null; vigencia: string; mei: boolean; obs: string
}

const CAMPO_OBRIG: [string, string][] = [['matricula', 'Matrícula'], ['nome', 'Nome completo'], ['cpf', 'CPF'], ['admissao', 'Data de admissão'], ['funcao', 'Função'],
  ['vinculo', 'Vínculo'], ['forma', 'Forma de pagamento'], ['salario', 'Salário base'], ['vigencia', 'Vigência a partir de']]

const chaveColuna = (h: string): string | null => {
  const n = norm(h)
  const mapa: Record<string, string> = { matricula: 'matricula', 'nome completo': 'nome', cpf: 'cpf', 'data de admissao': 'admissao', funcao: 'funcao', cbo: 'cbo', setor: 'setor', vinculo: 'vinculo',
    'forma de pagamento': 'forma', 'salario base': 'salario', 'valor por unidade': 'valorUnidade', insalubridade: 'insalubridade', periculosidade: 'periculosidade', 'outros adicionais': 'outros',
    'vale-transporte': 'vt', alimentacao: 'alimentacao', 'plano de saude': 'saude', 'seguro de vida': 'seguro', 'epi e uniforme': 'epi', 'horas produtivas/mes': 'horas',
    'dias trabalhados/mes': 'dias', 'vigencia a partir de': 'vigencia', 'mei de obra': 'mei', observacoes: 'obs' }
  return mapa[n] ?? null
}
// colunas que NÃO entram (LGPD: o modelo não pede dado pessoal além do CPF)
const PROIBIDA = /\b(rg|ctps|nascimento|data de nasc|mae|pai|endereco|telefone|pis|titulo de eleitor|cnh)\b/

export interface ResultadoLeitura { linhas: LinhaFunc[]; avisos: string[] }

/** `linhas` = linhas da aba 2_Funcionarios como objetos {cabeçalho: valor}; `primeira` = nº da linha do Excel da 1ª linha de dados. */
export function validarFuncionarios(linhas: Linha[], primeira = 2): ResultadoLeitura {
  const avisos: string[] = []
  const cab = new Set<string>(); linhas.forEach((l) => Object.keys(l).forEach((k) => cab.add(k)))
  const ignoradas = [...cab].filter((h) => !chaveColuna(h) && PROIBIDA.test(norm(h)))
  if (ignoradas.length) avisos.push(`Colunas ignoradas por LGPD (o sistema não guarda): ${ignoradas.join(', ')}.`)
  const desconhecidas = [...cab].filter((h) => !chaveColuna(h) && !PROIBIDA.test(norm(h)))
  if (desconhecidas.length) avisos.push(`Colunas que o modelo não conhece e foram ignoradas: ${desconhecidas.join(', ')}.`)
  const vistos = new Map<string, number>()
  const out: LinhaFunc[] = []
  linhas.forEach((raw, i) => {
    const r: Record<string, Celula> = {}
    for (const [h, v] of Object.entries(raw)) { const k = chaveColuna(h); if (k) r[k] = v }
    if (Object.values(r).every(vazio)) return
    if (/^linha de exemplo/i.test(String(r.obs ?? '').trim())) { avisos.push(`Linha ${primeira + i}: é a linha de exemplo do modelo — ignorada.`); return }
    const nLinha = primeira + i
    const erros: string[] = [], av: string[] = []
    const txt = (k: string) => (vazio(r[k]) ? '' : String(r[k]).trim())
    for (const [k, rot] of CAMPO_OBRIG) if (vazio(r[k])) erros.push(`${rot}: obrigatório e está vazio.`)
    const cpf = soDigitosCpf(txt('cpf'))
    if (!vazio(r.cpf)) {
      if (!cpfValido(cpf)) erros.push(cpf.length !== 11 ? `CPF "${txt('cpf')}": precisa ter 11 números.` : `CPF "${txt('cpf')}": o dígito verificador não confere — confira os números.`)
      else if (vistos.has(cpf)) erros.push(`CPF repetido no arquivo (já está na linha ${vistos.get(cpf)}).`)
      else vistos.set(cpf, nLinha)
    }
    const admissao = vazio(r.admissao) ? null : lerData(r.admissao)
    if (!vazio(r.admissao) && !admissao) erros.push(`Data de admissão "${txt('admissao')}": use dd/mm/aaaa (ex.: 15/03/2022).`)
    const vigencia = vazio(r.vigencia) ? null : lerData(r.vigencia)
    if (!vazio(r.vigencia) && !vigencia) erros.push(`Vigência "${txt('vigencia')}": use dd/mm/aaaa (ex.: 01/10/2026).`)
    const vinculo = VINCULOS_IMP[norm(r.vinculo)]
    if (!vazio(r.vinculo) && !vinculo) erros.push(`Vínculo "${txt('vinculo')}": escolha CLT, CLT intermitente, RPA, PJ ou Diarista.`)
    const forma = FORMAS_IMP[norm(r.forma)]
    if (!vazio(r.forma) && !forma) erros.push(`Forma de pagamento "${txt('forma')}": escolha Mensal, Hora, Produção, Diária ou m².`)
    if (/s[oó]cio|pr[oó]-?labore/i.test(`${txt('funcao')} ${txt('vinculo')}`)) erros.push('Sócio / pró-labore fica fora desta importação — cadastre pela tela, se precisar.')
    const num = (k: string, rot: string, obrig = false): number | null => {
      if (vazio(r[k])) return null
      const n = lerNumero(r[k])
      if (n === null) { erros.push(`${rot} "${txt(k)}": não é um número (use 1234,56).`); return null }
      if (n < 0) { erros.push(`${rot}: não pode ser negativo.`); return null }
      void obrig; return n
    }
    const salario = num('salario', 'Salário base')
    const valorUnidade = num('valorUnidade', 'Valor por unidade')
    if (forma === 'mensal' && salario !== null && salario <= 0) erros.push('Salário base: informe o valor mensal (maior que zero).')
    if ((forma === 'hora' || forma === 'diaria' || forma === 'producao' || forma === 'm2') && !(valorUnidade && valorUnidade > 0) && !(salario && salario > 0))
      erros.push(`Forma "${txt('forma')}": informe o "Valor por unidade (R$)" (valor da hora, da diária ou do m²).`)
    const insalubridade = num('insalubridade', 'Insalubridade') ?? 0, periculosidade = num('periculosidade', 'Periculosidade') ?? 0, outros = num('outros', 'Outros adicionais') ?? 0
    const vt = num('vt', 'Vale-transporte') ?? 0, alimentacao = num('alimentacao', 'Alimentação') ?? 0, saude = num('saude', 'Plano de saúde') ?? 0
    const seguro = num('seguro', 'Seguro de vida') ?? 0, epi = num('epi', 'EPI e uniforme') ?? 0
    const horas = num('horas', 'Horas produtivas/mês'), dias = num('dias', 'Dias trabalhados/mês')
    const mei = simNao(r.mei)
    if (mei === null) erros.push(`MEI de obra "${txt('mei')}": responda Sim ou Não.`)
    if (mei && vinculo && vinculo !== 'pj') av.push('MEI de obra só vale para vínculo PJ — ignorado.')
    out.push({ linha: nLinha, erros, avisos: av, ok: erros.length === 0, matricula: txt('matricula'), nome: txt('nome'), cpf, admissao: admissao ?? '', funcao: txt('funcao'), cbo: txt('cbo'),
      setor: txt('setor'), vinculo: vinculo ?? '', forma: forma ?? '', salario: salario ?? 0, valorUnidade, insalubridade, periculosidade, outros, vt, alimentacao, saude, seguro, epi,
      horas, dias, vigencia: vigencia ?? '', mei: !!mei && vinculo === 'pj', obs: txt('obs') })
  })
  return { linhas: out, avisos }
}

export interface ComponenteImp { tipo: string; subtipo: string | null; descricao?: string; valor: number; quantidade?: number; unidade?: string | null; estimado?: boolean }

/** Remuneração da linha → componentes que o banco já entende (as chaves de incidência o banco preenche pelo vínculo). */
export function componentesDaLinha(l: LinhaFunc): ComponenteImp[] {
  const c: ComponenteImp[] = []
  const unit = l.valorUnidade && l.valorUnidade > 0 ? l.valorUnidade : l.salario
  switch (l.forma) {
    case 'mensal': c.push({ tipo: 'fixo', subtipo: 'mensal', valor: l.salario }); break
    case 'hora': c.push({ tipo: 'fixo', subtipo: 'hora', valor: unit, quantidade: l.horas ?? 176 }); break
    case 'diaria': c.push({ tipo: 'diaria', subtipo: null, valor: unit, quantidade: l.dias ?? 22 }); break
    default:
      if (l.salario > 0 && l.valorUnidade) c.push({ tipo: 'fixo', subtipo: 'mensal', valor: l.salario })
      c.push({ tipo: 'producao', subtipo: null, valor: unit, quantidade: 0, unidade: 'm2', estimado: true })
  }
  if (l.insalubridade > 0) c.push({ tipo: 'adicional', subtipo: 'outro', descricao: 'Insalubridade', valor: l.insalubridade })
  if (l.periculosidade > 0) c.push({ tipo: 'adicional', subtipo: 'outro', descricao: 'Periculosidade', valor: l.periculosidade })
  if (l.outros > 0) c.push({ tipo: 'adicional', subtipo: 'outro', descricao: 'Outros adicionais', valor: l.outros })
  return c
}

export function fichaDaLinha(l: LinhaFunc, funcaoId: string, funcionarioId: string | null) {
  const ficha: Record<string, unknown> = {
    tipo: 'pessoa', funcao_id: funcaoId, setor: l.setor || null, vinculo: l.vinculo, forma_pagamento: l.forma === 'm2' ? 'm2' : l.forma, componentes: componentesDaLinha(l),
    beneficio_vt: l.vt, beneficio_alimentacao: l.alimentacao, beneficio_saude: l.saude, beneficio_seguro: l.seguro, beneficio_epi: l.epi,
    mei_servico_obra: l.mei, vigencia_inicio: l.vigencia, quantidade_pessoas: 1, descricao: l.obs || null,
  }
  if (l.horas) ficha.horas_produtivas_mes = l.horas
  if (funcionarioId) ficha.funcionario_id = funcionarioId
  const pessoa = funcionarioId ? null : { nome_completo: l.nome, cpf: l.cpf, data_admissao: l.admissao, matricula: l.matricula || null, setor: l.setor || null, cargo: l.funcao }
  return { ficha, pessoa }
}

export interface EncargosLidos { dados: Record<string, unknown> | null; erros: string[]; avisos: string[] }
/** Aba 1_Encargos_empresa: pares campo/valor. Aba toda vazia = não mexe nos encargos da empresa. */
export function lerEncargos(pares: [Celula, Celula][]): EncargosLidos {
  const m = new Map<string, Celula>(); pares.forEach(([k, v]) => { if (!vazio(k)) m.set(norm(k), v) })
  const sa = (t: string) => norm(t).replace(/[^a-z0-9]/g, '')
  // o modelo pode vir com rótulos um pouco diferentes: casa pelo rótulo exato e, se faltar, pelo começo/fim sem símbolos
  const get = (rot: string): Celula => {
    const k = norm(rot); if (m.has(k)) return m.get(k)
    const a = sa(rot); const ent = [...m.entries()].find(([kk]) => { const b = sa(kk); return b.length >= 3 && (b.startsWith(a) || a.startsWith(b)) })
    return ent?.[1]
  }
  if (![...m.values()].some((v) => !vazio(v))) return { dados: null, erros: [], avisos: ['Aba de encargos vazia: os encargos da empresa não serão alterados.'] }
  const erros: string[] = [], avisos: string[] = ['Encargos entram como PROVISÓRIOS até o contador confirmar na tela.']
  const d: Record<string, unknown> = {}
  const regime = REGIMES_IMP[norm(get('Regime tributário*'))]
  if (!regime) erros.push(`Regime tributário "${String(get('Regime tributário*') ?? '')}": escolha Simples, Lucro Presumido ou Lucro Real.`); else d.regime = regime
  const n = (rot: string, chave: string) => { const v = get(rot); if (vazio(v)) return; const x = lerNumero(v); if (x === null || x < 0) erros.push(`${rot.replace('*', '')} "${String(v)}": não é um número válido.`); else d[chave] = x }
  const anexo = get('Anexo do Simples'); if (!vazio(anexo)) d.simples_anexo = String(anexo).trim().toUpperCase()
  n('INSS patronal %', 'inss_patronal_pct'); n('RAT %', 'rat_pct'); n('FAP', 'fap'); n('Terceiros %', 'terceiros_pct'); n('FGTS %', 'fgts_pct')
  n('Provisão 13º %', 'prov_13_pct'); n('Provisão férias + 1/3 %', 'prov_ferias_pct'); n('Provisão rescisão %', 'prov_rescisao_pct'); n('CPRB %', 'cprb_pct')
  n('Horas produtivas padrão', 'horas_produtivas_padrao'); n('Salário mínimo de referência (R$)', 'salario_minimo_ref')
  n('Benefício padrão — vale-transporte (R$)', 'beneficio_vt_padrao'); n('Benefício padrão — alimentação (R$)', 'beneficio_alimentacao_padrao')
  n('Benefício padrão — plano de saúde (R$)', 'beneficio_saude_padrao'); n('Benefício padrão — seguro de vida (R$)', 'beneficio_seguro_padrao'); n('Benefício padrão — EPI e uniforme (R$)', 'beneficio_epi_padrao')
  const des = simNao(get('Desoneração da folha (Sim/Não)')); if (des === null) erros.push('Desoneração: responda Sim ou Não.'); else d.desoneracao = des
  const vig = get('Vigência a partir de'); if (!vazio(vig)) { const dt = lerData(vig); if (!dt) erros.push(`Vigência dos encargos "${String(vig)}": use dd/mm/aaaa.`); else d.vigencia_inicio = dt }
  return { dados: erros.length ? null : d, erros, avisos }
}
