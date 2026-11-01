// Adapter Banco do Brasil — API Extratos v1 (#1736, FC Pisos).
// GET /extratos/v1/conta-corrente/agencia/{agencia}/conta/{conta}
//     ?gw-dev-app-key=..&numeroPaginaSolicitacao=N&quantidadeRegistroPaginaSolicitacao=200
//     &dataInicioSolicitacao=DDMMAAAA&dataFimSolicitacao=DDMMAAAA
// - Datas do BB são NÚMEROS no formato DDMMAAAA (o zero à esquerda do dia some: 1º/01/2026 = 1012026).
// - Resposta: { numeroPaginaProximo, listaLancamento: [{ dataLancamento, valorLancamento,
//   indicadorSinalLancamento 'C'|'D', textoDescricaoHistorico, numeroDocumento, numeroLote, codigoHistorico,
//   textoInformacaoComplementar, ... }] }. As linhas de SALDO ("Saldo Anterior", "S A L D O") vêm misturadas
//   e não são movimento — ficam de fora.
// - O BB não devolve id de lançamento: id_externo = hash determinístico dos campos do lançamento + a ordem
//   entre lançamentos IDÊNTICOS do mesmo dia (idempotente entre sincronizações).
// - Produção exige mTLS (certificado da empresa cadastrado no app do BB Developers).
import { createHash } from 'node:crypto'
import { obterToken, bbRequest, BB_HOSTS, BB_SCOPE_EXTRATO, type BbAmbiente } from '@/lib/banco/bb'
import type { ExtratoAdapter, ExtratoJanela, MovimentoExtrato } from './types'

const POR_PAGINA = 200
const MAX_PAGINAS = 100

// "1505-2" → "1505"; "0001505" → "1505". O path do BB é numérico e sem dígito verificador.
export function semDv(v: string | null | undefined): string {
  const base = String(v ?? '').split('-')[0].replace(/\D/g, '')
  return base.replace(/^0+(?=\d)/, '')
}

// 'YYYY-MM-DD' → número DDMMAAAA do BB (sem zero à esquerda no dia).
export function dataBb(iso: string): string {
  const [y, m, d] = iso.split('-')
  return String(Number(`${d}${m}${y}`))
}

// número DDMMAAAA do BB → 'YYYY-MM-DD'. 0/ inválido → ''.
export function isoDeBb(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  const s = String(Math.trunc(n)).padStart(8, '0')
  const dd = s.slice(0, 2), mm = s.slice(2, 4), yyyy = s.slice(4, 8)
  if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) return ''
  return `${yyyy}-${mm}-${dd}`
}

export function ehLinhaDeSaldo(row: Record<string, unknown>): boolean {
  const desc = String(row.textoDescricaoHistorico ?? '').replace(/\s+/g, '').toUpperCase()
  return !isoDeBb(row.dataLancamento) || desc.startsWith('SALDO')
}

// Blocos de até 1 mês (mesmo critério do Sicoob) — o BB limita o período por consulta.
export function blocosMensaisBb(j: ExtratoJanela): ExtratoJanela[] {
  const out: ExtratoJanela[] = []
  let ini = j.begin
  while (ini <= j.end) {
    const [y, m] = ini.split('-').map(Number)
    const ultimo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const fim = ultimo < j.end ? ultimo : j.end
    out.push({ begin: ini, end: fim })
    const prox = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    ini = prox
  }
  return out
}

export function normalizarLancamentosBb(linhas: Record<string, unknown>[], contaRef: string): MovimentoExtrato[] {
  const vistos = new Map<string, number>()
  const out: MovimentoExtrato[] = []
  for (const row of linhas) {
    if (ehLinhaDeSaldo(row)) continue
    const data = isoDeBb(row.dataLancamento)
    const bruto = Number(row.valorLancamento ?? 0)
    const valor = Math.abs(Number.isFinite(bruto) ? bruto : 0)
    const sinal = String(row.indicadorSinalLancamento ?? '').trim().toUpperCase()
    const natureza: 'credito' | 'debito' = sinal === 'D' ? 'debito' : sinal === 'C' ? 'credito' : (bruto < 0 ? 'debito' : 'credito')
    const historico = String(row.textoDescricaoHistorico ?? '').trim()
    const complemento = String(row.textoInformacaoComplementar ?? '').trim()
    const descricao = [historico, complemento].filter(Boolean).join(' · ')
    const docNum = Number(row.numeroDocumento ?? 0)
    const documento = docNum ? String(row.numeroDocumento).trim() : null
    const chave = [data, valor.toFixed(2), natureza, String(row.codigoHistorico ?? ''), String(row.numeroLote ?? ''), documento ?? '', descricao].join('|')
    const ordem = (vistos.get(chave) ?? 0) + 1
    vistos.set(chave, ordem)
    const hash = createHash('sha1').update(`${chave}|${ordem}`).digest('hex').slice(0, 32)
    out.push({ data_transacao: data, valor, natureza, descricao, id_externo: `bb:${contaRef}:${hash}`, documento })
  }
  return out
}

export const bbExtratoAdapter: ExtratoAdapter = {
  async listarMovimentos(cred, janela) {
    const ambiente: BbAmbiente = cred.ambiente === 'homologacao' ? 'homologacao' : 'producao'
    const agencia = semDv(cred.agencia)
    const conta = semDv(cred.conta)
    if (!agencia || !conta) throw new Error('BB: agência e conta corrente são obrigatórias para o extrato.')
    const temCert = !!cred.pfx && cred.pfx.length > 0
    if (ambiente === 'producao' && !temCert) {
      throw new Error('BB: o extrato em produção exige o certificado de comunicação da empresa (mTLS). Envie o .pfx na configuração.')
    }
    const bb = {
      client_id: cred.client_id, client_secret: cred.client_secret ?? '', app_key: cred.api_key ?? '',
      ambiente, pfx: temCert ? cred.pfx : null, passphrase: cred.passphrase,
    }
    const token = await obterToken(bb, BB_SCOPE_EXTRATO)
    const host = BB_HOSTS[ambiente].extratos
    const linhas: Record<string, unknown>[] = []

    for (const bloco of blocosMensaisBb(janela)) {
      let pagina = 1
      for (let guard = 0; guard < MAX_PAGINAS && pagina > 0; guard++) {
        const qs = new URLSearchParams({
          'gw-dev-app-key': bb.app_key,
          numeroPaginaSolicitacao: String(pagina),
          quantidadeRegistroPaginaSolicitacao: String(POR_PAGINA),
          dataInicioSolicitacao: dataBb(bloco.begin),
          dataFimSolicitacao: dataBb(bloco.end),
        }).toString()
        const res = await bbRequest({
          host, method: 'GET',
          path: `/extratos/v1/conta-corrente/agencia/${agencia}/conta/${conta}?${qs}`,
          headers: { authorization: `Bearer ${token}` },
          pfx: bb.pfx, passphrase: bb.passphrase,
        })
        if (res.status === 401 || res.status === 403) {
          throw new Error(`extrato_nao_habilitado_${res.status}: ${res.raw.slice(0, 200)}`)
        }
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`bb_extrato_${res.status}: ${res.raw.slice(0, 200)}`)
        }
        const body = (res.body ?? {}) as { listaLancamento?: unknown; numeroPaginaProximo?: unknown }
        if (Array.isArray(body.listaLancamento)) linhas.push(...(body.listaLancamento as Record<string, unknown>[]))
        const prox = Number(body.numeroPaginaProximo ?? 0)
        pagina = Number.isFinite(prox) && prox > pagina ? prox : 0
      }
    }
    return normalizarLancamentosBb(linhas, `${agencia}-${conta}`)
  },
}
