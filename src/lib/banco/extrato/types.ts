// Camada agnostica de EXTRATO bancario (multi-provider).
// Cada provider (sicoob hoje; bradesco, sicredi... depois) tem um adapter
// que fala com a API do banco e devolve movimentos normalizados neste
// formato canonico. A rota /api/banco/extrato/sync chama o adapter, passa
// pra fn_extrato_importar_sistema (idempotente por id_externo) e dispara
// fn_conciliacao_rodar_lote.

export type ExtratoProvider = 'sicoob' | 'bradesco' | 'sicredi'

export type MovimentoExtrato = {
  data_transacao: string      // ISO YYYY-MM-DD (fuso America/Sao_Paulo)
  valor: number               // absoluto positivo
  natureza: 'credito' | 'debito'
  descricao: string
  id_externo: string          // chave de idempotencia
  documento: string | null
}

export type ExtratoCredencial = {
  client_id: string
  base_url: string
  ambiente: 'producao' | 'homologacao'
  pfx: Buffer                 // A1 mTLS (Sicoob)
  passphrase: string
  cooperativa: string
  conta: string               // conta corrente
  codigo_beneficiario: string
  convenio: string
}

export type ExtratoJanela = {
  begin: string               // YYYY-MM-DD
  end: string                 // YYYY-MM-DD
}

export interface ExtratoAdapter {
  listarMovimentos(cred: ExtratoCredencial, janela: ExtratoJanela): Promise<MovimentoExtrato[]>
}
