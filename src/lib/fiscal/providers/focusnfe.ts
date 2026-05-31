import { FiscalError } from '../errors'
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
} from '../types'
import type {
  FocusNFeBaseUrl,
  FocusNFeNFSePayload,
  FocusNFeNFSeResponse,
  FocusNFeAPIError,
} from './focusnfe.types'

interface FocusNFeClientOptions {
  apiKey: string
  ambiente: FiscalAmbiente
  cnpjEmpresa: string
  diasParaExpirarCert?: number
  timeoutMs?: number
}

const BASE_URLS: Record<FiscalAmbiente, FocusNFeBaseUrl> = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
}

export class FocusNFeProvider implements FiscalProvider {
  readonly name = 'focusnfe'
  private readonly baseUrl: FocusNFeBaseUrl
  private readonly authHeader: string
  private readonly timeoutMs: number

  constructor(private readonly opts: FocusNFeClientOptions) {
    if (!opts.apiKey) throw new FiscalError('API_KEY_INVALIDA', 'api_key ausente')
    if (!opts.cnpjEmpresa) throw new FiscalError('PAYLOAD_INVALIDO', 'cnpjEmpresa ausente')
    this.baseUrl = BASE_URLS[opts.ambiente]
    // Focus NFe usa Basic Auth · api_key como username · senha vazia
    this.authHeader = 'Basic ' + Buffer.from(`${opts.apiKey}:`).toString('base64')
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      })

      const text = await resp.text()
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = { raw: text }
      }

      if (!resp.ok) {
        const apiErr = parsed as FocusNFeAPIError
        const msg = apiErr?.mensagem ?? apiErr?.erros?.[0]?.mensagem ?? `HTTP ${resp.status}`

        if (resp.status === 401 || resp.status === 403) {
          throw new FiscalError('API_KEY_INVALIDA', msg, { status: resp.status, body: parsed })
        }
        if (resp.status === 404) {
          throw new FiscalError('CHAVE_NAO_ENCONTRADA', msg, { status: resp.status, body: parsed })
        }
        if (resp.status === 429) {
          throw new FiscalError('PROVIDER_RATE_LIMIT', msg, { status: resp.status }, true)
        }
        if (resp.status >= 500) {
          throw new FiscalError('PROVIDER_ERRO_INTERNO', msg, { status: resp.status }, true)
        }
        if (resp.status === 422 || resp.status === 400) {
          throw new FiscalError('PAYLOAD_INVALIDO', msg, { status: resp.status, body: parsed })
        }
        throw new FiscalError('PROVIDER_ERRO_INTERNO', msg, { status: resp.status, body: parsed })
      }

      return parsed as T
    } catch (err) {
      if (err instanceof FiscalError) throw err
      if ((err as Error)?.name === 'AbortError') {
        throw new FiscalError('TIMEOUT', `Timeout em ${this.timeoutMs}ms · ${url}`, undefined, true)
      }
      throw new FiscalError('API_INACESSIVEL', (err as Error).message ?? 'Erro de rede', undefined, true)
    } finally {
      clearTimeout(timer)
    }
  }

  async testarConexao(): Promise<TestarConexaoResponse> {
    try {
      // Focus NFe nao tem endpoint "ping" formal.
      // Estrategia: GET /v2/empresas (lista empresas vinculadas a api_key).
      await this.request<unknown>('GET', '/v2/empresas')
      return {
        ok: true,
        ambiente: this.opts.ambiente,
        apiAlcancavel: true,
        certificadoOk: true,
        diasParaExpirarCert: this.opts.diasParaExpirarCert,
        mensagem:
          this.opts.diasParaExpirarCert !== undefined && this.opts.diasParaExpirarCert < 30
            ? `API OK · certificado expira em ${this.opts.diasParaExpirarCert} dias`
            : `API ${this.opts.ambiente} OK · certificado valido`,
      }
    } catch (err) {
      if (err instanceof FiscalError) {
        return {
          ok: false,
          ambiente: this.opts.ambiente,
          apiAlcancavel: err.code !== 'API_INACESSIVEL' && err.code !== 'TIMEOUT',
          certificadoOk: false,
          mensagem: err.message,
          detalhes: { code: err.code, ...err.details },
        }
      }
      throw err
    }
  }

  async emitirNFSe(req: NFSeRequest): Promise<NFSeResponse> {
    const referencia = `nfse-${Date.now()}`
    const payload: FocusNFeNFSePayload = {
      data_emissao: req.dataEmissao ?? new Date().toISOString(),
      prestador: {
        cnpj: req.prestador.cnpj.replace(/\D/g, ''),
        inscricao_municipal: req.prestador.inscricaoMunicipal,
      },
      tomador: {
        cnpj: req.tomador.cnpj?.replace(/\D/g, ''),
        cpf: req.tomador.cpf?.replace(/\D/g, ''),
        razao_social: req.tomador.razaoSocial,
        email: req.tomador.email,
        endereco: req.tomador.endereco
          ? {
              logradouro: req.tomador.endereco.logradouro,
              numero: req.tomador.endereco.numero,
              complemento: req.tomador.endereco.complemento,
              bairro: req.tomador.endereco.bairro,
              codigo_municipio: req.tomador.endereco.codigoMunicipio,
              uf: req.tomador.endereco.uf,
              cep: req.tomador.endereco.cep.replace(/\D/g, ''),
            }
          : undefined,
      },
      servico: {
        aliquota: req.aliquotaIss,
        discriminacao: req.descricaoServico,
        iss_retido: req.retemIss ? 'true' : 'false',
        codigo_cnae: req.cnaeServico,
        codigo_tributario_municipio: req.codigoServico,
        valor_servicos: req.valorServicos,
        valor_iss: req.valorIss,
      },
    }

    const data = await this.request<FocusNFeNFSeResponse>(
      'POST',
      `/v2/nfse?ref=${encodeURIComponent(referencia)}`,
      payload
    )

    return this.mapFocusNFSeResponse(referencia, data)
  }

  async consultarNFSe(referenceOrNumero: string): Promise<NFSeResponse> {
    const data = await this.request<FocusNFeNFSeResponse>(
      'GET',
      `/v2/nfse/${encodeURIComponent(referenceOrNumero)}`
    )
    return this.mapFocusNFSeResponse(referenceOrNumero, data)
  }

  async cancelarNFSe(referenceOrNumero: string, justificativa: string): Promise<NFSeResponse> {
    const data = await this.request<FocusNFeNFSeResponse>(
      'DELETE',
      `/v2/nfse/${encodeURIComponent(referenceOrNumero)}?justificativa=${encodeURIComponent(justificativa)}`
    )
    return this.mapFocusNFSeResponse(referenceOrNumero, data)
  }

  private mapFocusNFSeResponse(referencia: string, data: FocusNFeNFSeResponse): NFSeResponse {
    const status =
      data.status === 'autorizado'
        ? 'autorizada'
        : data.status === 'cancelado'
          ? 'cancelada'
          : data.status === 'erro_autorizacao'
            ? 'rejeitada'
            : 'processando'

    return {
      ok: status === 'autorizada',
      numero: data.numero,
      codigoVerificacao: data.codigo_verificacao,
      protocolo: data.numero_rps,
      xmlUrl: data.caminho_xml_nota_fiscal ? `${this.baseUrl}${data.caminho_xml_nota_fiscal}` : undefined,
      pdfUrl: data.url_danfse,
      status,
      motivoRejeicao: data.mensagem_sefaz,
      providerReference: referencia,
      providerRaw: data,
    }
  }

  // GE-F5 implementa NFe
  async emitirNFe(_req: NFeRequest): Promise<NFeResponse> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'emitirNFe sera implementado no GE-F5')
  }
  async consultarNFe(_chave: string): Promise<NFeResponse> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'consultarNFe sera implementado no GE-F5')
  }
  async cancelarNFe(_chave: string, _just: string): Promise<NFeResponse> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'cancelarNFe sera implementado no GE-F5')
  }

  // GE-F8 implementa MDe
  async mdeListar(_req: MDeListaRequest): Promise<MDeListaResponse> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'mdeListar sera implementado no GE-F8')
  }
  async mdeManifestar(_req: MDeManifestarRequest): Promise<MDeManifestarResponse> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'mdeManifestar sera implementado no GE-F8')
  }
  async mdeBaixarXml(_chave: string): Promise<string> {
    throw new FiscalError('PROVIDER_ERRO_INTERNO', 'mdeBaixarXml sera implementado no GE-F8')
  }
}
