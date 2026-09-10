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
  codigoNbs?: string              // código NBS do serviço (obrigatório no layout nacional)
  opcaoSimplesNacional?: number   // 1=Não optante · 2=MEI · 3=ME/EPP
  regimeApuracaoSN?: number       // regime_tributario_simples_nacional (1/2/3)
  percentualTribSN?: number       // percentual_total_tributos_simples_nacional (totTrib p/ ME/EPP)
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
  // cst carrega CST (regime normal) OU CSOSN (Simples). base/modBc/valor sao usados na devolucao
  // (espelho da entrada): CSOSN 900 + icms_base_calculo/icms_aliquota/icms_valor devolvem o credito.
  icms?: { cst?: string; aliquota?: number; base?: number; valor?: number; modBc?: string }
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
    // Inscricao Estadual do destinatario. Obrigatoria quando ele e contribuinte de ICMS
    // (ex.: devolucao de compra a um fornecedor/distribuidor) — sem ela a SEFAZ rejeita
    // "IE do destinatario nao informada". Ausente/vazia => tratado como nao contribuinte.
    inscricaoEstadual?: string
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
  // Totais que compõem o valor da nota ALÉM dos produtos. Lei Kandir: o FRETE entra na base do ICMS,
  // então a devolução precisa declará-los para o total (vNF) bater com a base do ICMS. Ex.: produtos
  // 370 + frete 55 = total 425 = base ICMS. total = produtos + frete + seguro + outras − desconto.
  totais?: {
    frete?: number
    seguro?: number
    outrasDespesas?: number
    desconto?: number
    modalidadeFrete?: number   // 0 CIF · 1 FOB · 2 por conta de terceiros · 3/4 próprio · 9 sem frete
  }
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
