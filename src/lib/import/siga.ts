// SIGA / Conta Azul (export financeiro com colunas receber + pagar).
// Logica robusta PORTADA de src/app/api/import/universal/route.ts pra
// poder ser consumida tambem pelo card UI sem duplicar codigo.
// A rota sera aposentada em PR futuro · este helper passa a ser a unica
// fonte da verdade.
//
// Detecta o formato pelos headers, mapeia colunas por nome (case-
// insensitive + contains como fallback), processa cada linha emitindo
// um record no CONTRATO V3 (fn_import_financeiro_v3 via
// fn_import_universal_dispatch).

export interface SigaRecordV3 {
  company_id: string
  tipo: 'pagar' | 'receber'
  valor_documento: number
  data_vencimento: string                       // YYYY-MM-DD
  data_emissao: string | null
  data_pagamento: string | null
  valor_pago: number | null
  descricao: string
  status: 'aberto' | 'pago' | 'vencido' | 'parcial' | 'cancelado'
  categoria: string | null
  centro_custo: string | null
  forma_pagamento: string | null
  nome_pessoa: string
  import_hash: string
}

// ---- Detect --------------------------------------------------------

export function sigaDetect(headers: string[]): boolean {
  const h = (headers || []).map((x) => (x ?? '').toLowerCase().trim())
  const hasReceber = h.some((x) => x === 'receber')
  const hasPagar = h.some((x) => x === 'pagar')
  const hasQuitado = h.some((x) => x.includes('quitado em') || x === 'quitado')
  const hasSaldo = h.some((x) => x === 'saldo')
  return hasReceber && hasPagar && (hasQuitado || hasSaldo)
}

// ---- Helpers (portados da rota) ------------------------------------

function parseDate(val: unknown): string | null {
  if (val == null || val === '') return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  const s = String(val).trim()
  if (!s) return null
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m1) {
    let y = parseInt(m1[3], 10)
    if (m1[3].length === 2) y += 2000
    return `${y}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`
  }
  const m2 = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`
  if (/^\d{5}$/.test(s)) {
    // serial Excel
    const d = new Date((parseInt(s, 10) - 25569) * 86400 * 1000)
    return d.toISOString().split('T')[0]
  }
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}

function parseNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val == null || val === '') return 0
  const s = String(val).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(s) || 0
}

function normalize(s: string): string {
  return (s || '').trim().toUpperCase().slice(0, 150)
}

// Status mapeado pro CHECK do erp_pagar / erp_receber.
function mapStatus(val: unknown): SigaRecordV3['status'] {
  const s = String(val ?? '').toLowerCase().trim()
  if (/quit/.test(s)) return 'pago'
  if (/vencid|atrasad/.test(s)) return 'vencido'
  if (/parcial/.test(s)) return 'parcial'
  if (/cancelad/.test(s)) return 'cancelado'
  return 'aberto'
}

// ---- Map de colunas (busca por header exato, fallback contains) ----

interface ColMap {
  data_emissao?: number
  data_vencimento?: number
  data_pagamento?: number
  status?: number
  forma_pagamento?: number
  numero_documento?: number
  numero_nf?: number
  nome_pessoa?: number
  descricao?: number
  valor_base?: number
  valor_receber?: number
  valor_pagar?: number
  conta_corrente?: number
  categoria?: number
  centro_custo?: number
  cliente_relacionado?: number
}

function mapColumnsSiga(headers: string[]): ColMap {
  const h = headers.map((x) => (x ?? '').toLowerCase().trim())
  const find = (name: string) => h.findIndex((x) => x === name)
  const contains = (name: string) => h.findIndex((x) => x.includes(name))
  const m: Record<string, number> = {}

  const set = (key: string, idx: number) => { if (idx !== -1) m[key] = idx }

  set('data_emissao',   find('emissao') !== -1 ? find('emissao') : find('emissão'))
  set('data_vencimento', find('vencimento'))
  let dPag = contains('quitado em')
  if (dPag === -1) dPag = find('quitado')
  set('data_pagamento', dPag)
  set('status', find('situacao') !== -1 ? find('situacao') : find('situação'))
  set('forma_pagamento', contains('meio'))
  set('numero_documento', find('codigo') !== -1 ? find('codigo') : find('código'))
  set('numero_nf', find('documento'))
  set('nome_pessoa', contains('nome fantasia'))
  set('descricao', find('descricao') !== -1 ? find('descricao') : find('descrição'))
  set('valor_base', contains('valor base'))
  set('valor_receber', find('receber'))
  set('valor_pagar', find('pagar'))
  set('conta_corrente', contains('conta corrente'))
  set('categoria', find('categoria'))
  set('centro_custo', contains('centro de custo'))
  set('cliente_relacionado', contains('cliente relacionado'))

  return m as ColMap
}

// ---- Process 1 linha → SigaRecordV3 | erro --------------------------

// Decisao tipo/valor com fallbacks:
//   1) receber > 0      → 'receber'
//   2) pagar > 0        → 'pagar'
//   3) valor_base > 0   → deduz por categoria
//                          'receita'/'credito' → receber, senao pagar
//   senao descarta (so quando NADA bate)
//
// Nome em cascata:
//   nome_pessoa → cliente_relacionado → ultima parte da categoria
//     ("DESPESAS > Aluguel" → "Aluguel") → "(SEM NOME)"
//
// Descricao fallback: descricao → categoria
//
// valor_pago condicional (mesma regra da rota):
//   se houve receber/pagar OU tem data_pagamento, valor_pago = valor
//   senao valor_pago = null (nao 0, pra nao poluir relatorios)

function processSigaRow(
  row: unknown[],
  m: ColMap,
  companyId: string,
  seqCounter: Map<string, number>
): SigaRecordV3 | { erro: string } {
  const cell = (i?: number): unknown => (i === undefined ? null : row[i])

  const receber = parseNumber(cell(m.valor_receber))
  const pagar = parseNumber(cell(m.valor_pagar))
  const valorBase = parseNumber(cell(m.valor_base))

  let tipo: 'receber' | 'pagar' | null = null
  let valor = 0

  if (receber > 0) { tipo = 'receber'; valor = receber }
  else if (pagar > 0) { tipo = 'pagar'; valor = pagar }
  else if (valorBase > 0) {
    const cat = String(cell(m.categoria) ?? '').toLowerCase()
    if (cat.includes('receita') || cat.includes('credito')) {
      tipo = 'receber'; valor = valorBase
    } else {
      tipo = 'pagar'; valor = valorBase
    }
  }

  if (!tipo || valor <= 0) return { erro: 'linha sem valor (receber/pagar/base)' }

  // Nome cascata
  const nomePessoa = String(cell(m.nome_pessoa) ?? '').trim()
  const clienteRel = String(cell(m.cliente_relacionado) ?? '').trim()
  const categoriaStr = String(cell(m.categoria) ?? '').trim()
  let nomeFinal = nomePessoa || clienteRel
  if (!nomeFinal) {
    const catParts = categoriaStr.split('>').map((s) => s.trim()).filter(Boolean)
    const catLeaf = catParts[catParts.length - 1] || ''
    nomeFinal = catLeaf ? `(SEM NOME) ${catLeaf}` : '(SEM NOME)'
  }

  const descricaoRaw = String(cell(m.descricao) ?? '').trim()
  const descricao = descricaoRaw || categoriaStr
  if (!descricao) return { erro: 'sem descricao nem categoria' }

  const dataVencimento = parseDate(cell(m.data_vencimento))
  if (!dataVencimento) return { erro: 'data_vencimento invalida' }

  const dataEmissao = parseDate(cell(m.data_emissao))
  const dataPagamento = parseDate(cell(m.data_pagamento))
  const status = mapStatus(cell(m.status))

  const valorPago = (receber > 0 || pagar > 0 || dataPagamento) ? valor : null

  const centroCusto = String(cell(m.centro_custo) ?? '').trim() || null
  const formaPagamento = String(cell(m.forma_pagamento) ?? '').trim() || null

  // import_hash:
  //   - tem codigo → 'siga:{company}:{codigo}' (1a vez) ou
  //                  'siga:{company}:{codigo}:{seq}' (duplicatas intencionais)
  //   - sem codigo → 'siga:{company}:nocodigo:{venc}-{valor}-{nome30}:{seq}'
  //     (deterministico · permite re-import sem duplicar)
  const codigo = String(cell(m.numero_documento) ?? '').trim()
  let importHash: string
  if (codigo) {
    const key = `cod:${codigo}`
    const seq = (seqCounter.get(key) || 0) + 1
    seqCounter.set(key, seq)
    importHash = seq === 1
      ? `siga:${companyId}:${codigo}`
      : `siga:${companyId}:${codigo}:${seq}`
  } else {
    const fallbackBase = [
      dataVencimento,
      valor.toFixed(2),
      normalize(nomeFinal).slice(0, 30),
      normalize(descricao).slice(0, 30),
    ].join('-').replace(/[^A-Za-z0-9.\-_]/g, '_')
    const key = `fb:${fallbackBase}`
    const seq = (seqCounter.get(key) || 0) + 1
    seqCounter.set(key, seq)
    importHash = `siga:${companyId}:nocodigo:${fallbackBase}:${seq}`
  }

  return {
    company_id: companyId,
    tipo,
    valor_documento: valor,
    data_vencimento: dataVencimento,
    data_emissao: dataEmissao,
    data_pagamento: dataPagamento,
    valor_pago: valorPago,
    descricao,
    status,
    categoria: categoriaStr || null,
    centro_custo: centroCusto,
    forma_pagamento: formaPagamento,
    nome_pessoa: nomeFinal,
    import_hash: importHash,
  }
}

// ---- Public: sigaParseRows -----------------------------------------

export function sigaParseRows(
  headers: string[],
  rows: unknown[][],
  companyId: string
): { records: SigaRecordV3[]; erros: Array<{ linha: number; motivo: string }> } {
  const m = mapColumnsSiga(headers)
  const records: SigaRecordV3[] = []
  const erros: Array<{ linha: number; motivo: string }> = []
  const seqCounter = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? []

    // Pula 'Saldo Inicial' (linha de cabecalho ficticia comum do Conta Azul)
    const nome = String(r[m.nome_pessoa ?? -1] ?? '').trim().toLowerCase()
    if (nome === 'saldo inicial') continue

    const result = processSigaRow(r, m, companyId, seqCounter)
    if ('erro' in result) {
      // linha+2 = 1 (header) + 1 (1-based)
      erros.push({ linha: i + 2, motivo: result.erro })
    } else {
      records.push(result)
    }
  }
  return { records, erros }
}
