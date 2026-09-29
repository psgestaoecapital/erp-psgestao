// Baixa automática de boleto, ciente do BANCO (CEO 29/09 · aprovada; molde para o BB). Um "provedor de liquidação" sabe
// montar a credencial do banco (a partir de fn_banco_obter_credencial) e consultar um boleto pelo nosso número.
// A rota /api/boleto/sync-liquidacao percorre as conexões ATIVAS de cada empresa e só consulta cada banco sobre os
// boletos DAQUELE banco (boleto_banco_codigo) — antes mandava tudo para o Sicoob.
// Bradesco entra quando chegar a documentação oficial de consulta de título (#297). Gate: scripts/check-baixa-boleto-banco.ts.
import { Buffer } from 'node:buffer'
import { consultarBoleto as consultarSicoob, type Credencial as CredSicoob } from '@/lib/banco/sicoob'
import { consultarBoleto as consultarSicredi, type Credencial as CredSicredi } from '@/lib/banco/sicredi'

export type Ambiente = 'producao' | 'homologacao'
export type ResultadoConsulta = { situacao: string | null; dataLiquidacao: string | null; valorPago: number | null; raw: unknown }
type LinhaCredencial = Record<string, unknown>

export interface ProvedorLiquidacao {
  provider: string
  banco_codigo: string
  // null = credencial incompleta (a rota registra erro com a mensagem)
  montarCredencial: (row: LinhaCredencial, ambiente: Ambiente) => { cred: unknown } | { faltando: string }
  consultar: (cred: unknown, nossoNumero: string) => Promise<ResultadoConsulta>
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')

export const PROVEDORES_LIQUIDACAO: Record<string, ProvedorLiquidacao> = {
  sicoob: {
    provider: 'sicoob', banco_codigo: '756',
    montarCredencial: (row, ambiente) => {
      if (!s(row.client_id) || !s(row.cert_base64) || !s(row.cert_senha) || !s(row.codigo_beneficiario)) {
        return { faltando: 'credencial Sicoob incompleta (client_id, certificado ou beneficiário)' }
      }
      const cred: CredSicoob = {
        client_id: s(row.client_id), ambiente, pfx: Buffer.from(s(row.cert_base64), 'base64'), passphrase: s(row.cert_senha),
        cooperativa: s(row.cooperativa), conta: s(row.conta), codigo_beneficiario: s(row.codigo_beneficiario), convenio: s(row.convenio),
      }
      return { cred }
    },
    consultar: async (cred, nn) => consultarSicoob(cred as CredSicoob, nn),
  },
  sicredi: {
    provider: 'sicredi', banco_codigo: '748',
    montarCredencial: (row, ambiente) => {
      // username = beneficiário + cooperativa; password = Código de Acesso (manual Cobrança v3.9.1 — mesmo do registrar-boleto)
      const username = s(row.codigo_beneficiario) && s(row.cooperativa) ? `${s(row.codigo_beneficiario)}${s(row.cooperativa)}` : ''
      if (!username || !s(row.client_secret) || !s(row.api_key)) return { faltando: 'Código de Acesso ou x-api-key do Sicredi faltando' }
      const cred: CredSicredi = {
        username, password: s(row.client_secret), api_key: s(row.api_key), ambiente,
        cooperativa: s(row.cooperativa), posto: s(row.posto), codigo_beneficiario: s(row.codigo_beneficiario),
        conta: s(row.conta), agencia: s(row.agencia) || null,
      }
      return { cred }
    },
    consultar: async (cred, nn) => consultarSicredi(cred as CredSicredi, nn),
  },
}

export const BANCOS_COM_CONSULTA: readonly string[] = Object.values(PROVEDORES_LIQUIDACAO).map((p) => p.banco_codigo)

export function provedorPorBanco(bancoCodigo: string | null | undefined): ProvedorLiquidacao | null {
  return Object.values(PROVEDORES_LIQUIDACAO).find((p) => p.banco_codigo === bancoCodigo) ?? null
}

// Situação devolvida pelo banco → pago? Normaliza ("Liquidado Rede" → LIQUIDADO_REDE). Só o que é LIQUIDAÇÃO conta:
// "BAIXADO" sozinho (baixa por pedido/protesto) NÃO é pagamento.
export function situacaoPaga(situacao: string | null | undefined): boolean {
  if (!situacao) return false
  const n = situacao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return n === 'PAGO' || n.startsWith('LIQUIDAD') || n === 'BAIXADO_LIQUIDADO' || n === 'BAIXADO_POR_LIQUIDACAO'
}

// Status da execução de uma empresa/banco a partir do resultado
export function statusExecucao(consultados: number, erros: number): 'ok' | 'parcial' | 'erro' | 'sem_boletos' {
  if (consultados === 0 && erros === 0) return 'sem_boletos'
  if (erros === 0) return 'ok'
  return erros >= consultados ? 'erro' : 'parcial'
}
