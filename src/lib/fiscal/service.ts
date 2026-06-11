import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FocusNFeProvider } from './providers/focusnfe'
import { decryptApiKey } from './decrypt'
import { FiscalError } from './errors'
import type {
  FiscalProvider,
  NFSeRequest,
  NFSeResponse,
  NFeRequest,
  NFeResponse,
  MDeListaRequest,
  MDeListaResponse,
  MDeManifestarRequest,
  MDeManifestarResponse,
  TestarConexaoResponse,
  FiscalAmbiente,
} from './types'

export interface FiscalService {
  readonly providerName: string
  readonly ambiente: FiscalAmbiente

  testarConexao(): Promise<TestarConexaoResponse>
  // FEAT-NFE-DIAGNOSTICO-FOCUS-v1
  diagnosticoEmpresas(): Promise<{
    status: number
    autenticou: boolean
    empresas: Array<{
      cnpj: string; nome: string;
      habilita_nfe: boolean; habilita_nfce: boolean;
      habilita_nfse: boolean; habilita_cte: boolean; habilita_mdfe: boolean;
    }>
  }>
  emitirNFSe(req: NFSeRequest): Promise<NFSeResponse>
  consultarNFSe(ref: string): Promise<NFSeResponse>
  cancelarNFSe(ref: string, justificativa: string): Promise<NFSeResponse>
  emitirNFe(req: NFeRequest): Promise<NFeResponse>
  consultarNFe(chave: string): Promise<NFeResponse>
  cancelarNFe(chave: string, justificativa: string): Promise<NFeResponse>
  mdeListar(req: MDeListaRequest): Promise<MDeListaResponse>
  mdeManifestar(req: MDeManifestarRequest): Promise<MDeManifestarResponse>
  mdeBaixarXml(chave: string): Promise<string>
}

interface CreateFiscalServiceOpts {
  // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1 · override SO desce pra homologacao
  // body NUNCA consegue subir pra producao a partir desta opcao
  ambienteOverride?: 'homologacao' | 'producao'
}

export async function createFiscalService(
  companyId: string,
  opts: CreateFiscalServiceOpts = {},
): Promise<FiscalService> {
  const { data, error } = await supabaseAdmin.rpc('fn_buscar_provider_config_ativa', {
    p_company_id: companyId,
    p_provider: 'focusnfe',
  })

  if (error) {
    throw new FiscalError('CONFIG_NAO_ENCONTRADA', error.message, { rpc_error: error })
  }

  const payload = (data ?? {}) as {
    encontrou?: boolean
    tem_certificado?: boolean
    certificado?: { validade_fim?: string }
  }

  if (!payload.encontrou) {
    throw new FiscalError(
      'CONFIG_NAO_ENCONTRADA',
      'Configuracao Focus NFe nao encontrada · cadastre em /dashboard/configuracoes/fiscal'
    )
  }
  if (!payload.tem_certificado) {
    throw new FiscalError(
      'CERTIFICADO_AUSENTE',
      'Certificado A1 nao encontrado · cadastre em /dashboard/configuracoes/fiscal'
    )
  }

  const { data: configRow, error: cfgErr } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('api_key_encrypted, ambiente')
    .eq('company_id', companyId)
    .eq('provider', 'focusnfe')
    .eq('ativo', true)
    .maybeSingle()

  if (cfgErr || !configRow?.api_key_encrypted) {
    throw new FiscalError('API_KEY_INVALIDA', 'api_key Focus NFe nao encontrada')
  }

  const apiKey = decryptApiKey(configRow.api_key_encrypted)
  // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1
  // ambiente da config + override anti-engano: SO desce pra homologacao;
  // body NUNCA consegue subir pra producao
  const configAmbiente = (configRow.ambiente ?? 'homologacao') as FiscalAmbiente
  const ambiente: FiscalAmbiente =
    opts.ambienteOverride === 'homologacao' ? 'homologacao' : configAmbiente

  const { data: company, error: companyErr } = await supabaseAdmin
    .from('companies')
    .select('cnpj')
    .eq('id', companyId)
    .maybeSingle()

  if (companyErr || !company?.cnpj) {
    throw new FiscalError('CONFIG_NAO_ENCONTRADA', 'CNPJ da empresa nao encontrado em companies.cnpj')
  }

  const cnpjEmpresa = String(company.cnpj).replace(/\D/g, '')

  const validadeFim = payload.certificado?.validade_fim
    ? new Date(payload.certificado.validade_fim)
    : null
  const diasParaExpirar = validadeFim
    ? Math.floor((validadeFim.getTime() - Date.now()) / 86_400_000)
    : undefined

  const provider: FiscalProvider = new FocusNFeProvider({
    apiKey,
    ambiente,
    cnpjEmpresa,
    diasParaExpirarCert: diasParaExpirar,
  })

  return {
    providerName: provider.name,
    ambiente,
    testarConexao: () => provider.testarConexao(),
    diagnosticoEmpresas: () => provider.diagnosticoEmpresas(),
    emitirNFSe: (req) => provider.emitirNFSe(req),
    consultarNFSe: (ref) => provider.consultarNFSe(ref),
    cancelarNFSe: (ref, j) => provider.cancelarNFSe(ref, j),
    emitirNFe: (req) => provider.emitirNFe(req),
    consultarNFe: (c) => provider.consultarNFe(c),
    cancelarNFe: (c, j) => provider.cancelarNFe(c, j),
    mdeListar: (req) => provider.mdeListar(req),
    mdeManifestar: (req) => provider.mdeManifestar(req),
    mdeBaixarXml: (c) => provider.mdeBaixarXml(c),
  }
}
