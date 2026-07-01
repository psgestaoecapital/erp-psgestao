// Adapter Sicoob — Extrato Conta Corrente.
// - Reusa o obterToken() do modulo Sicoob existente (Keycloak + cert A1
//   mTLS). Escopo unico por request: 'cco_extrato' (bug Keycloak
//   multi-scope ja conhecido).
// - Endpoint validado na doc Sicoob:
//     GET /conta-corrente/v4/extrato/{mes}/{ano}
//       ?diaInicial=..&diaFinal=..&numeroContaCorrente=..
// - Janelas > 1 mes: quebramos mes-a-mes; combinamos os movimentos.
// - id_externo: se o Sicoob retornar sequencial/id da transacao, usamos.
//   Senao, hash deterministico (data|valor|natureza|descricao|documento|
//   sequencial_no_dia) — garante idempotencia mesmo com response variavel.

import https from 'node:https'
import { createHash } from 'node:crypto'
import { obterToken } from '@/lib/banco/sicoob'
import type { ExtratoAdapter, ExtratoCredencial, ExtratoJanela, MovimentoExtrato } from './types'

const SICOOB_SCOPE_EXTRATO = 'cco_extrato'

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

export const sicoobExtratoAdapter: ExtratoAdapter = {
  async listarMovimentos(cred, janela) {
    const token = await obterToken({
      client_id: cred.client_id, ambiente: cred.ambiente,
      pfx: cred.pfx, passphrase: cred.passphrase,
      cooperativa: cred.cooperativa, conta: cred.conta,
      codigo_beneficiario: cred.codigo_beneficiario, convenio: cred.convenio,
    }, SICOOB_SCOPE_EXTRATO)

    const host = SICOOB_HOSTS[cred.ambiente]
    const numeroContaCorrente = cred.conta.replace(/\D/g, '')
    const todos: MovimentoExtrato[] = []
    let ordemNoDiaByDia = new Map<string, number>()

    for (const b of blocosMensais(janela)) {
      const qs = new URLSearchParams({
        diaInicial: String(b.d1),
        diaFinal: String(b.d2),
        numeroContaCorrente,
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
