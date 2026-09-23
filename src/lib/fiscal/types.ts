export type FiscalAmbiente = 'homologacao' | 'producao'

// Resolve a opção do Simples Nacional (1=Não optante · 2=MEI · 3=ME/EPP) SEM adivinhar:
// - opção cadastrada (1/2/3) → usa-a;
// - opção NULA → deriva do regime tributário da empresa (Simples → optante; regimes normais → não optante);
// - regime desconhecido/ausente → null: o chamador BLOQUEIA a emissão (adivinhar regime é pior que parar).
export function resolverOpcaoSimplesNacional(
  opcao: number | null | undefined,
  regimeTributario: string | null | undefined,
): number | null {
  if (opcao === 1 || opcao === 2 || opcao === 3) return opcao
  switch ((regimeTributario ?? '').toLowerCase().trim()) {
    case 'mei':
      return 2
    case 'simples':
    case 'simples_nacional':
    case 'simples_nacional_excesso':
      return 3
    case 'regime_normal':
    case 'lucro_presumido':
    case 'lucro_real':
      return 1
    default:
      return null
  }
}
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
  opcaoSimplesNacional?: number   // 1=Não optante · 2=MEI · 3=ME/EPP (já RESOLVIDO — ver resolverOpcaoSimplesNacional)
  regimeTributario?: string | null // regime tributário da empresa (fonte para derivar a opção quando nula)
  regimeApuracaoSN?: number       // regime_tributario_simples_nacional (1/2/3)
  percentualTribSN?: number       // percentual_total_tributos_simples_nacional (totTrib p/ ME/EPP)
  // #90 paridade OMIE · alíquota efetiva do Simples do MÊS (pAliq / percentual_aliquota_relativa_municipio).
  // Só no regime SN com regApTribSN=1; vem da config por competência (nunca chutada). Regime 2 usa a municipal.
  aliquotaISSSN?: number | null
  // #90 · retenção do ISS escolhida no modal: 1=Não retido · 2=Retido pelo tomador · 3=Retido pelo intermediário.
  // Default 1. Substitui o boolean retemIss quando informado (mantido p/ compat).
  tipoRetencaoISS?: number
  // #18 · E0370: grupo de OBRA (serviço de construção civil). Endereço da obra OU CNO/CIB — o layout
  // nacional exige um dos dois quando o código de tributação está na lista E0370 (fn_fiscal_exige_obra).
  obra?: {
    cno?: string                  // Cadastro Nacional de Obras (CNO/CEI)
    inscricaoImobiliaria?: string // CIB (Cadastro Imobiliário Brasileiro)
    logradouro?: string; numero?: string; complemento?: string; bairro?: string
    codigoMunicipio?: string; uf?: string; cep?: string
  }
  // #90 / Focus #242149 · campos da Reforma Tributária (IBS/CBS) do layout NFS-e Nacional. OPCIONAIS
  // e DESLIGADOS por padrão: só vão ao JSON quando a empresa preenche na Configuração Fiscal (nenhum
  // valor default no código). Confirmar obrigatoriedade/valores com a Focus antes de exigir.
  reforma?: {
    finalidadeEmissao?: number | null       // finNFSe (0 = NFS-e regular)
    consumidorFinal?: number | null          // indFinal (0 = não · 1 = sim)
    indicadorDestinatario?: number | null    // indDest (0 = tomador é o destinatário · 1 = outro)
    ibsCbsCst?: string | null                // ibs_cbs_situacao_tributaria (CST · String[3])
    ibsCbsClassifTrib?: string | null        // ibs_cbs_classificacao_tributaria (cClassTrib · String[6])
  }
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
  // #90/#64: corpo (JSON) efetivamente enviado ao provider — sem cert/token (que vão no header).
  // Persistido em erp_nfse_emitidas.payload_enviado para depurar rejeições sem emitir no escuro.
  payloadEnviado?: unknown
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
  icms?: { cst?: string; aliquota?: number; base?: number; valor?: number; modBc?: string
    // CST 60 / CST 500 · ICMS cobrado anteriormente por ST. vBCSTRet/vICMSSubstituto/vICMSSTRet são
    // VALORES (já multiplicados pela quantidade no builder); pst é ALÍQUOTA (não multiplica). NT 2018.005.
    stRet?: { vBcstRet?: number; pst?: number; vIcmsSubstituto?: number; vIcmsStRet?: number } }
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
    // indIEDest declarado no cadastro: 1=contribuinte (manda a IE) · 2=isento de inscricao
    // (declarado, SEM numero de IE) · 9=nao contribuinte. "isento" != "sem IE": um e escolha,
    // o outro e ausencia de dado. Quando ausente, o provider deriva de ter IE (1) ou nao (9).
    indicadorIE?: 1 | 2 | 9
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
  // Espelho do #90/#64 (que já persiste o payload da NFS-e): corpo (JSON) efetivamente enviado ao
  // provider na emissão — sem cert/token (que vão no header). Persistido em
  // erp_nfe_emitidas.payload_enviado para depurar rejeições (ex.: SEFAZ 938 do ST retido) sem
  // reconstruir o payload no escuro. Preenchido só nas emissões (NF-e/NFC-e), não nas consultas.
  payloadEnviado?: unknown
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
