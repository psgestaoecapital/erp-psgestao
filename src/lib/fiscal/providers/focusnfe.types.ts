export interface FocusEndereco {
  logradouro: string
  numero?: string
  complemento?: string
  bairro: string
  codigo_municipio?: string
  uf: string
  cep: string
}

export interface FocusNFeNFSePayload {
  data_emissao: string
  prestador?: {
    cnpj: string
    inscricao_municipal?: string
    codigo_municipio?: string
  }
  tomador: {
    cnpj?: string
    cpf?: string
    razao_social: string
    email?: string
    endereco?: FocusEndereco
  }
  servico: {
    aliquota?: number
    discriminacao: string
    iss_retido?: 'true' | 'false'
    item_lista_servico?: string
    codigo_cnae?: string
    codigo_tributario_municipio?: string
    valor_servicos: number
    valor_iss?: number
  }
  // Informações complementares livres do ABRASF municipal (NÃO é a discriminação do serviço).
  // É onde vai, entre outras coisas, o "valor aproximado dos tributos" da Lei 12.741/2012.
  outras_informacoes?: string
}

export interface FocusNFeNFSeResponse {
  cnpj_prestador?: string
  ref?: string
  numero?: string
  serie?: string
  status: 'autorizado' | 'processando_autorizacao' | 'erro_autorizacao' | 'cancelado'
  status_sefaz?: string
  mensagem_sefaz?: string
  url?: string
  caminho_xml_nota_fiscal?: string
  url_danfse?: string
  codigo_verificacao?: string
  numero_rps?: string
  // #90: em rejeição (status erro_autorizacao) o Focus pode devolver o motivo aqui, não em mensagem_sefaz.
  mensagem?: string
  erros?: Array<{ codigo?: string; mensagem?: string }>
}

export interface FocusNFeAPIError {
  codigo?: string
  mensagem?: string
  erros?: Array<{ codigo: string; mensagem: string }>
}

export type FocusNFeBaseUrl =
  | 'https://api.focusnfe.com.br'
  | 'https://homologacao.focusnfe.com.br'

export interface FocusNFeNFeResponse {
  ref?: string
  chave_nfe?: string
  numero?: string
  serie?: string
  protocolo?: string
  status: 'autorizado' | 'processando_autorizacao' | 'erro_autorizacao' | 'cancelado' | 'denegado'
  status_sefaz?: string
  mensagem_sefaz?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  url_danfe?: string
}
