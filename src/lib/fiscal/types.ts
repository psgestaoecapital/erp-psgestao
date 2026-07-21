export type FiscalAmbiente = 'homologacao' | 'producao'
export type RegimeTributario =
  | 'simples_nacional'
  | 'simples_nacional_excesso'
  | 'regime_normal'
  | 'mei'

export interface EnderecoFiscal {
  logradouro: string
  numero?: string
  complemento?: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  codigoMunicipio?: string
}

export interface NFSeRequest {
  numero?: string
  serie: string
  dataEmissao?: string
  cnaeServico: string
  codigoServico: string
  descricaoServico: string
  valorServicos: number
  valorIss?: number
  aliquotaIss?: number
  retemIss?: boolean
  prestador: {
    cnpj: string
    razaoSocial: string
    inscricaoMunicipal?: string
    codigoMunicipio?: string
  }
  tomador: {
    cnpj?: string
    cpf?: string
    razaoSocial: string
    email?: string
    endereco?: EnderecoFiscal
  }
  observacoes?: string
  // NFSe Nacional (municípios aderidos) — emissão via Focus no endpoint /v2/nfsen.
  // Quando padraoNacional=true, o provider Focus monta o layout nacional
  // (codigo_tributacao_nacional_iss, codigo_municipio_emissora, data_competencia, opção/regime SN).
  padraoNacional?: boolean
  serieRps?: string
  numeroRps?: number
  opcaoSimplesNacional?: number   // 1=Não optante · 2=MEI · 3=ME/EPP
  percentualTribSN?: number       // pTotTribSN
  regimeApuracaoSN?: number       // regApTribSN (1/2/3)
}

export interface NFSeResponse {
  ok: boolean
  numero?: string
  codigoVerificacao?: string
  protocolo?: string
  xmlUrl?: string
  pdfUrl?: string
  status: 'autorizada' | 'cancelada' | 'rejeitada' | 'processando'
  motivoRejeicao?: string
  providerReference: string
  providerRaw?: unknown
}

export interface NFeProdutoItem {
  codigo: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  cest?: string
  origem?: string
  icms?: { cst?: string; aliquota?: number; valor?: number }
  ipi?: { cst?: string; aliquota?: number; valor?: number }
  pis?: { cst?: string; aliquota?: number; valor?: number }
  cofins?: { cst?: string; aliquota?: number; valor?: number }
}

export interface NFeRequest {
  serie: string
  naturezaOperacao: string
  finalidade: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
  emitente: {
    cnpj: string
    razaoSocial: string
    inscricaoEstadual: string
  }
  destinatario: {
    cnpj?: string
    cpf?: string
    razaoSocial: string
    email?: string
    endereco?: EnderecoFiscal
  }
  itens: NFeProdutoItem[]
  pagamento?: {
    formaPagamento: string
    valor: number
  }
  observacoes?: string
  // fiscal-devolucao-compra-v1: chave 44 digitos da NF-e original
  // (usado em finalidade='devolucao'/'ajuste' · grupo NFref/refNFe)
  chaveReferenciada?: string
}

export interface NFeResponse {
  ok: boolean
  numero?: string
  chave?: string
  protocolo?: string
  xmlUrl?: string
  danfeUrl?: string
  status: 'autorizada' | 'cancelada' | 'rejeitada' | 'processando' | 'denegada'
  motivoRejeicao?: string
  providerReference: string
  providerRaw?: unknown
}

export interface MDeListaRequest {
  cnpj: string
  ultimoNsu?: string
}

export interface MDeNotaRecebida {
  chave: string
  cnpjEmitente: string
  razaoEmitente: string
  valorTotal: number
  dataEmissao: string
  situacao: string
  nsu: string
  xmlDisponivel: boolean
}

export interface MDeListaResponse {
  ok: boolean
  notas: MDeNotaRecebida[]
  ultimoNsu?: string
  temMais: boolean
  providerRaw?: unknown
}

export type MDeAcao = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada'

export interface MDeManifestarRequest {
  chave: string
  acao: MDeAcao
  justificativa?: string
}

export interface MDeManifestarResponse {
  ok: boolean
  protocolo?: string
  motivoRejeicao?: string
  providerRaw?: unknown
}

export interface TestarConexaoResponse {
  ok: boolean
  ambiente: FiscalAmbiente
  apiAlcancavel: boolean
  certificadoOk: boolean
  diasParaExpirarCert?: number
  mensagem: string
  detalhes?: Record<string, unknown>
}

export interface FiscalProvider {
  readonly name: string

  testarConexao(): Promise<TestarConexaoResponse>

  emitirNFSe(req: NFSeRequest): Promise<NFSeResponse>
  consultarNFSe(referenceOrNumero: string): Promise<NFSeResponse>
  cancelarNFSe(referenceOrNumero: string, justificativa: string): Promise<NFSeResponse>

  emitirNFe(req: NFeRequest): Promise<NFeResponse>
  emitirNFCe(req: NFeRequest): Promise<NFeResponse>
  consultarNFe(referenceOrChave: string): Promise<NFeResponse>
  cancelarNFe(chave: string, justificativa: string): Promise<NFeResponse>
  cartaCorrecaoNFe(chave: string, correcao: string): Promise<{
    status: 'registrado' | 'rejeitado' | 'processando'
    protocolo?: string
    motivoRejeicao?: string
    providerRaw: unknown
  }>

  mdeListar(req: MDeListaRequest): Promise<MDeListaResponse>
  mdeManifestar(req: MDeManifestarRequest): Promise<MDeManifestarResponse>
  mdeBaixarXml(chave: string): Promise<string>

  // FEAT-NFE-DIAGNOSTICO-FOCUS-v1 · zero emissao · sanitiza
  diagnosticoEmpresas(): Promise<{
    status: number
    autenticou: boolean
    empresas: Array<{
      cnpj: string; nome: string;
      habilita_nfe: boolean; habilita_nfce: boolean;
      habilita_nfse: boolean; habilita_cte: boolean; habilita_mdfe: boolean;
    }>
  }>
}
