// Adapter Sicoob — Extrato Conta Corrente.
// - Reusa o obterToken() do modulo Sicoob existente (Keycloak + cert A1
//   mTLS). Escopo unico por request: 'cco_consulta' (bug Keycloak
//   multi-scope ja conhecido). ATENCAO: NAO existe 'cco_extrato' no
//   portal Sicoob — extrato + saldo saem pelo escopo 'cco_consulta',
//   confirmado pelo CEO em 01/07/2026.
// - Endpoint validado na doc Sicoob "3 - Conta Corrente":
//     GET https://api.sicoob.com.br/conta-corrente/v4/extrato/{mes}/{ano}
//       ?diaInicial=..&diaFinal=..&numeroContaCorrente=..
//       &agruparCreditosDebitos=false
// - Janelas > 1 mes: quebramos mes-a-mes; combinamos os movimentos.
// - id_externo: se o Sicoob retornar sequencial/id da transacao, usamos.
//   Senao, hash deterministico (data|valor|natureza|descricao|documento|
//   sequencial_no_dia) — garante idempotencia mesmo com response variavel.

import https from 'node:https'
import { createHash } from 'node:crypto'
import { obterToken } from '@/lib/banco/sicoob'
import type { ExtratoAdapter, ExtratoAdapterOpts, ExtratoCredencial, ExtratoJanela, MovimentoExtrato } from './types'

const SICOOB_SCOPE_CONSULTA = 'cco_consulta'

type Http = { status: number; body: unknown; raw: string }

function request(opts: {
  host: string; path: string; method: 'GET'
  headers: Record<string, string>
  pfx: Buffer; passphrase: string
}): Promise<Http> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: opts.host, port: 443, path: opts.path, method: opts.method,
      headers: { accept: 'application/json', ...opts.headers },
      pfx: opts.pfx, passphrase: opts.passphrase,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let parsed: unknown = raw
        try { parsed = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed, raw })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// pega o campo em varios nomes possiveis (Sicoob varia por versao)
function pick<T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T
  return undefined
}

function hashIdExterno(inputs: string[]): string {
  return createHash('sha1').update(inputs.join('|')).digest('hex').slice(0, 32)
}

function toISO(v: unknown): string {
  // aceita 'YYYY-MM-DD', 'DD/MM/YYYY', ISO com hora
  if (typeof v !== 'string' || !v) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return v
}

function numeroAbs(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Math.abs(Number.isFinite(n) ? n : 0)
}

function naturezaFrom(row: Record<string, unknown>): 'credito' | 'debito' {
  const t = String(pick<string>(row, 'tipo', 'natureza', 'tipoOperacao', 'sinal') ?? '').toUpperCase()
  if (t.includes('CRE') || t === 'C' || t === '+' || t === 'CREDITO') return 'credito'
  if (t.includes('DEB') || t === 'D' || t === '-' || t === 'DEBITO') return 'debito'
  // fallback: se valor for negativo bruto, chame debito
  const raw = pick<unknown>(row, 'valor')
  const n = typeof raw === 'number' ? raw : Number(raw ?? 0)
  return n < 0 ? 'debito' : 'credito'
}

function extrairLista(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    const resultado = obj.resultado ?? obj.data
    if (Array.isArray(resultado)) return resultado as Record<string, unknown>[]
    if (resultado && typeof resultado === 'object') {
      const r = resultado as Record<string, unknown>
      for (const k of ['transacoes', 'lancamentos', 'movimentos', 'extrato']) {
        const v = r[k]
        if (Array.isArray(v)) return v as Record<string, unknown>[]
      }
    }
    for (const k of ['transacoes', 'lancamentos', 'movimentos', 'extrato']) {
      const v = obj[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

function normalizar(row: Record<string, unknown>, contaConta: string, ordemNoDia: number): MovimentoExtrato {
  const data = toISO(pick(row, 'dataMovimento', 'data', 'dataLancamento', 'data_transacao', 'dataOcorrencia'))
  const valor = numeroAbs(pick(row, 'valor', 'valorMovimento'))
  const natureza = naturezaFrom(row)
  const descricao = String(pick<string>(row, 'descricao', 'historico', 'descricaoHistorico', 'observacao') ?? '').trim()
  const documento = String(pick<string>(row, 'documento', 'numeroDocumento', 'nsu') ?? '').trim() || null

  // se a API devolve id da transacao, usa; senao hash deterministico.
  const idFornecido = pick<string>(row, 'idTransacao', 'nrLancamento', 'numeroLancamento', 'idExterno', 'id')
  const id_externo = idFornecido && String(idFornecido).length > 0
    ? `sicoob:${contaConta}:${idFornecido}`
    : `sicoob:${contaConta}:${hashIdExterno([data, valor.toFixed(2), natureza, descricao, documento ?? '', String(ordemNoDia)])}`

  return { data_transacao: data, valor, natureza, descricao, id_externo, documento }
}

// Quebra a janela em blocos mensais (Sicoob V4 opera por mes/ano).
function blocosMensais(janela: ExtratoJanela): Array<{ mes: number; ano: number; d1: number; d2: number }> {
  const [y1, m1, d1] = janela.begin.split('-').map(Number)
  const [y2, m2, d2] = janela.end.split('-').map(Number)
  const blocos: Array<{ mes: number; ano: number; d1: number; d2: number }> = []
  let ano = y1, mes = m1
  while (ano < y2 || (ano === y2 && mes <= m2)) {
    const primeiroDia = (ano === y1 && mes === m1) ? d1 : 1
    const ultimoDiaDoMes = new Date(ano, mes, 0).getDate()
    const ultimoDia = (ano === y2 && mes === m2) ? d2 : ultimoDiaDoMes
    blocos.push({ mes, ano, d1: primeiroDia, d2: ultimoDia })
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return blocos
}

const SICOOB_HOSTS: Record<'producao' | 'homologacao', string> = {
  producao: 'api.sicoob.com.br',
  homologacao: 'sandbox.sicoob.com.br',
}

// SPEC SONDA-SALDO (diagnóstico, temporário) — retrato dos campos de saldo da resposta CRUA.
// Regras inegociáveis: NÃO devolve o payload inteiro; só (1) nomes das chaves de 1º nível e de
// `resultado`, (2) pares chave/valor de qualquer chave cujo nome contenha saldo/balance (escalar,
// CRU, sem normalizar), recursivo até 3 níveis. NUNCA desce em arrays de lançamento (LGPD: descrição/
// CPF/favorecido ficam de fora); para arrays cujo NOME é de saldo (ex.: saldos por dia), registra só
// a forma (nº de itens + nomes das chaves do 1º item), nunca os valores.
export function montarRetratoSaldo(
  payload: unknown,
  endpoint: string,
  qtdTransacoes: number,
): Record<string, unknown> {
  const MAX_CAMPOS = 40
  const camposSaldo: Record<string, string> = {}
  const ehSaldo = (k: string) => /saldo|balance/i.test(k)
  const escalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 3 || node === null || typeof node !== 'object' || Array.isArray(node)) return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (Object.keys(camposSaldo).length >= MAX_CAMPOS) return
      const p = path ? `${path}.${k}` : k
      if (ehSaldo(k) && escalar(v)) {
        camposSaldo[p] = String(v)                       // valor CRU, sem normalizar
      } else if (ehSaldo(k) && Array.isArray(v)) {
        const first = v[0]
        const chaves = first && typeof first === 'object' && !Array.isArray(first)
          ? Object.keys(first as Record<string, unknown>) : []
        camposSaldo[p] = `[array de ${v.length} itens; chaves: ${chaves.join(',')}]` // forma, sem valores
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, p, depth + 1)
      }
    }
  }
  walk(payload, '', 1)

  const obj = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>) : {}
  const resultado = obj.resultado
  const chavesResultado = resultado && typeof resultado === 'object' && !Array.isArray(resultado)
    ? Object.keys(resultado as Record<string, unknown>) : null

  return {
    sonda: 'saldo_v1',
    endpoint,
    chaves_nivel_1: Object.keys(obj),
    chaves_resultado: chavesResultado,
    campos_saldo_encontrados: camposSaldo,
    qtd_campos_saldo: Object.keys(camposSaldo).length,
    qtd_transacoes: qtdTransacoes,
  }
}

export const sicoobExtratoAdapter: ExtratoAdapter = {
  async listarMovimentos(cred, janela, opts?: ExtratoAdapterOpts) {
    const token = await obterToken({
      client_id: cred.client_id, ambiente: cred.ambiente,
      pfx: cred.pfx, passphrase: cred.passphrase,
      cooperativa: cred.cooperativa, conta: cred.conta,
      codigo_beneficiario: cred.codigo_beneficiario, convenio: cred.convenio,
    }, SICOOB_SCOPE_CONSULTA)

    const host = SICOOB_HOSTS[cred.ambiente]
    const numeroContaCorrente = cred.conta.replace(/\D/g, '')
    const todos: MovimentoExtrato[] = []
    let ordemNoDiaByDia = new Map<string, number>()

    for (const b of blocosMensais(janela)) {
      const qs = new URLSearchParams({
        diaInicial: String(b.d1),
        diaFinal: String(b.d2),
        numeroContaCorrente,
        agruparCreditosDebitos: 'false',
      }).toString()
      const res = await request({
        host,
        path: `/conta-corrente/v4/extrato/${b.mes}/${b.ano}?${qs}`,
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          client_id: cred.client_id,
        },
        pfx: cred.pfx, passphrase: cred.passphrase,
      })
      if (res.status === 401 || res.status === 403) {
        throw new Error(`extrato_nao_habilitado_${res.status}: ${res.raw.slice(0, 200)}`)
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`sicoob_extrato_${res.status}: ${res.raw.slice(0, 200)}`)
      }
      const linhas = extrairLista(res.body)
      // SPEC SONDA-SALDO: captura o retrato de saldo desta resposta (não altera o fluxo normal).
      if (opts?.onRetratoSaldo) {
        try {
          opts.onRetratoSaldo(montarRetratoSaldo(
            res.body, `/conta-corrente/v4/extrato/${b.mes}/${b.ano}`, linhas.length))
        } catch { /* a sonda nunca derruba a importação */ }
      }
      for (const linha of linhas) {
        const dataProvisoria = toISO(pick(linha, 'dataMovimento', 'data', 'dataLancamento'))
        const ordem = (ordemNoDiaByDia.get(dataProvisoria) ?? 0) + 1
        ordemNoDiaByDia.set(dataProvisoria, ordem)
        todos.push(normalizar(linha, numeroContaCorrente, ordem))
      }
    }
    return todos
  },
}
