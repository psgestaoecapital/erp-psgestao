// Bradesco Cobranca — auth mTLS + registrar boleto.
// Node runtime only (mTLS via https.Agent com .pfx).
import https from 'node:https'
import { Buffer } from 'node:buffer'
import { tipoPessoaPorDocumento } from '@/lib/banco/documento'
import { pfxParaMtls } from '@/lib/banco/pfxMtls'

export type BradescoAmbiente = 'producao' | 'sandbox'

const HOSTS: Record<BradescoAmbiente, string> = {
  producao: 'openapi.bradesco.com.br',
  sandbox: 'openapisandbox.prebanco.com.br',
}

type TokenCacheEntry = { access_token: string; expires_at: number }
const tokenCache = new Map<string, TokenCacheEntry>()
const TOKEN_TTL_MS = 55 * 60 * 1000

export type Credencial = {
  client_id: string
  client_secret: string
  ambiente: BradescoAmbiente
  pfx: Buffer
  passphrase: string
}

type HttpResult<T> = { status: number; body: T }

function request<T = unknown>(opts: {
  host: string; path: string; method: 'GET' | 'POST'; headers?: Record<string, string>;
  body?: string; pfx: Buffer; passphrase: string;
}): Promise<HttpResult<T>> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: opts.host, port: 443, path: opts.path, method: opts.method,
      headers: { 'accept': 'application/json', ...(opts.headers ?? {}) },
      // Lê PKCS#12 legado via node-forge (OpenSSL 3 recusa o A1 legado com "Unsupported PKCS12 PFX data").
      ...pfxParaMtls(opts.pfx, opts.passphrase),
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let parsed: unknown = raw
        try { parsed = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed as T })
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

export async function obterToken(c: Credencial): Promise<string> {
  const key = `${c.client_id}:${c.ambiente}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires_at > Date.now()) return hit.access_token

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.client_id,
    client_secret: c.client_secret,
  }).toString()

  const res = await request<{ access_token?: string; error?: string; error_description?: string }>({
    host: HOSTS[c.ambiente], path: '/auth/server-mtls/v2/token', method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) },
    body, pfx: c.pfx, passphrase: c.passphrase,
  })
  if (res.status !== 200 || !res.body?.access_token) {
    throw new Error(`Bradesco auth falhou: ${res.status} ${JSON.stringify(res.body)}`)
  }
  tokenCache.set(key, { access_token: res.body.access_token, expires_at: Date.now() + TOKEN_TTL_MS })
  return res.body.access_token
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')
const cleanText = (s: string | null | undefined, max = 70) =>
  stripAccents((s ?? '').trim()).replace(/[.\-\/]/g, ' ').replace(/\s+/g, ' ').slice(0, max)
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
const fmtPct = (n: number | null | undefined) => (n == null ? '0.00' : Number(n).toFixed(2))
const fmtVal = (n: number) => n.toFixed(2)

export type RegistrarBoletoInput = {
  cred: Credencial
  cnpjBeneficiario: string  // 14 digitos da empresa
  agencia: string           // 4 digitos
  conta: string             // sem digito (7 digitos)
  carteira: string          // ex.: '09'
  convenio?: string | null  // numero do convenio Bradesco (opcional)
  codigoBeneficiario?: string | null  // codigo do beneficiario na cobranca (opcional)
  nuNegociacao?: string | null  // sobrescreve o derivado (ag+0000000+conta); preservar zeros a esquerda
  nuCliente: string         // numero do documento / id curto
  emissaoISO: string        // YYYY-MM-DD
  vencimentoISO: string     // YYYY-MM-DD
  valor: number
  pagador: {
    tipo: 'PF' | 'PJ'
    documento: string
    nome: string
    logradouro: string | null
    numero: string | null
    bairro: string | null
    cidade: string | null
    uf: string | null
    cep: string | null
  }
  jurosPct?: number | null
  multaPct?: number | null
  // Dias após o vencimento em que o encargo passa a incidir (qtdeDiasJuros/qtdeDiasMulta).
  // Quando o percentual está preenchido mas o dia não, o adapter usa 1 (padrão sensato).
  qtdeDiasJuros?: number | null
  qtdeDiasMulta?: number | null
  instrucoes?: Array<string | null | undefined>
}

export type RegistroResult = {
  status: number
  nuTituloGerado?: string
  linhaDigitavel?: string
  cdBarras?: string
  raw: unknown
  payload_resumo?: Record<string, unknown>  // payload enviado (segredos mascarados) — para diagnostico
}

export async function registrarBoleto(input: RegistrarBoletoInput): Promise<RegistroResult> {
  const token = await obterToken(input.cred)

  const cnpj = onlyDigits(input.cnpjBeneficiario)
  if (cnpj.length !== 14) throw new Error('CNPJ do beneficiario invalido')
  const nuCPFCNPJ = cnpj.slice(0, 8)
  const filialCPFCNPJ = cnpj.slice(8, 12)
  const ctrlCPFCNPJ = cnpj.slice(12)

  // CEP do pagador: a API Bradesco exige cepPagador com 5 digitos + complementoCepPagador com 3.
  // Falha amigavel ANTES de chamar o banco se o cliente nao tem CEP completo.
  const cepRaw = onlyDigits(input.pagador.cep ?? '')
  if (cepRaw.length !== 8) {
    throw new Error('Cliente sem CEP valido para emissao de boleto (esperado 8 digitos)')
  }
  const cepPagador = cepRaw.slice(0, 5)
  const complementoCepPagador = cepRaw.slice(5, 8)

  // CPF/CNPJ do pagador: o indicador (cdIndCpfcnpjPagador 1=CPF, 2=CNPJ) sai do DOCUMENTO,
  // nunca de um campo de cadastro chutado — 11 dígitos = física, 14 = jurídica. Documento
  // fora disso é incompleto e para aqui (a rota já avisa a tela antes de chegar ao banco).
  const docPagador = onlyDigits(input.pagador.documento)
  const pessoaPagador = tipoPessoaPorDocumento(docPagador)
  if (!pessoaPagador) {
    throw new Error(`Documento do pagador inválido (${docPagador.length} dígito(s)): informe um CPF (11) ou CNPJ (14) no cadastro do cliente antes de gerar o boleto.`)
  }

  const ag = onlyDigits(input.agencia).padStart(4, '0').slice(-4)
  // nuNegociacao (18 dígitos): FORMATO OFICIAL Bradesco = agência(4) + 0000000 (7 zeros) +
  // conta SEM dígito verificador (7). Confirmado na doc/SDK (exemplo "123400000001234567" =
  // 1234 + 0000000 + 1234567) e no comportamento do OMIE (aba Beneficiário em branco → usa o
  // beneficiário PADRÃO = agência + conta, sem código especial). O DÍGITO VERIFICADOR NÃO ENTRA.
  // Config tem prioridade absoluta (código informado pelo gerente); só cai no derivado quando vazia.
  // BUG CORRIGIDO: antes fazia onlyDigits(conta).padStart(7).slice(-7), que embutia o DV na conta e
  //   truncava (slice(-7)) quando conta+DV >= 8 dígitos. Agora usa a conta SEM o DV, zero-preenchida a 7.
  const contaSemDv = onlyDigits(String(input.conta ?? '').split('-')[0]).padStart(7, '0').slice(-7)
  const nuNegociacaoConfig = input.nuNegociacao ? onlyDigits(input.nuNegociacao) : ''
  const nuNegociacaoDerivado = `${ag}0000000${contaSemDv}`
  const nuNegociacaoOrigem: 'config' | 'derivado' = nuNegociacaoConfig.length > 0 ? 'config' : 'derivado'
  const nuNegociacao = nuNegociacaoConfig.length > 0 ? nuNegociacaoConfig : nuNegociacaoDerivado

  const payload: Record<string, unknown> = {
    nuCPFCNPJ, filialCPFCNPJ, ctrlCPFCNPJ,
    idProduto: input.carteira,
    nuNegociacao,
    nuCliente: input.nuCliente.slice(0, 25),
    dtEmissaoTitulo: fmtDate(input.emissaoISO),
    dtVencimentoTitulo: fmtDate(input.vencimentoISO),
    vlNominalTitulo: fmtVal(input.valor),
    cdEspecieTitulo: 2,
    nomePagador: cleanText(input.pagador.nome, 70),
    logradouroPagador: cleanText(input.pagador.logradouro ?? '', 40),
    nuLogradouroPagador: cleanText(input.pagador.numero ?? '', 10),
    bairroPagador: cleanText(input.pagador.bairro ?? '', 40),
    municipioPagador: cleanText(input.pagador.cidade ?? '', 30),
    ufPagador: cleanText(input.pagador.uf ?? '', 2).toUpperCase(),
    cepPagador,                  // 5 digitos (Bradesco rejeita >5)
    complementoCepPagador,       // 3 digitos (sufixo do CEP)
    tpVencimento: 0,
    cdIndCpfcnpjPagador: pessoaPagador === 'FISICA' ? 1 : 2,
    nuCpfcnpjPagador: docPagador,
    listaMsgs: (input.instrucoes ?? [])
      .filter((m): m is string => !!m && String(m).trim().length > 0)
      .slice(0, 4)
      .map((m) => ({ mensagem: cleanText(m, 80) })),
  }
  // codigoBeneficiario e convenio sao OPCIONAIS — incluidos quando o
  // provider_config tem o valor. Algumas APIs do Bradesco resolvem o
  // contrato de cobranca via convenio+cnpj; outras exigem codigoBeneficiario
  // explicito. Enviar quando disponivel reduz risco de CBTT0004
  // "NENHUM REGISTRO FOI ENCONTRADO".
  if (input.codigoBeneficiario) payload.codigoBeneficiario = onlyDigits(input.codigoBeneficiario)
  if (input.convenio) payload.numConvenio = onlyDigits(input.convenio)

  // GRUPO MULTA/JUROS (CBTT0505 — "INFORME TODOS OS CAMPOS PARA MULTA"):
  // O Bradesco só aceita o encargo quando o PERCENTUAL vem ACOMPANHADO da quantidade de dias após
  // o vencimento em que ele passa a incidir (qtdeDiasMulta / qtdeDiasJuros). Regras aplicadas:
  //  - só enviamos o grupo quando o percentual está preenchido (> 0); percentual 0/null → nenhum campo,
  //    o boleto sai limpo (não inventamos encargo que o cliente não cobra);
  //  - qtdeDias padrão = 1 quando não configurada (mantém configurável via dias_multa/dias_juros);
  //  - percentual e vlMulta/vlJuros são ALTERNATIVOS — com percentual preenchido NÃO enviamos vl*;
  //  - GUARDA: percentual preenchido mas qtdeDias inválida (0, negativa, não-inteira) → bloqueia ANTES
  //    de chamar o banco, com mensagem clara (evita o CBTT0505 vindo do servidor sem contexto).
  const aplicarEncargo = (
    campoPct: 'percentualMulta' | 'percentualJuros',
    campoDias: 'qtdeDiasMulta' | 'qtdeDiasJuros',
    pctRaw: number | null | undefined,
    diasRaw: number | null | undefined,
    rotulo: string,
  ) => {
    const pct = pctRaw == null ? 0 : Number(pctRaw)
    if (!(pct > 0)) return // sem encargo: não envia percentual nem dias
    const dias = diasRaw == null ? 1 : Math.trunc(Number(diasRaw))
    if (!Number.isFinite(dias) || dias < 1) {
      throw new Error(
        `${rotulo} de ${fmtPct(pct)}% configurada sem quantidade de dias válida (após o vencimento). ` +
        `Informe os dias de ${rotulo.toLowerCase()} na configuração do banco (mínimo 1) antes de gerar o boleto.`,
      )
    }
    payload[campoPct] = fmtPct(pct)
    payload[campoDias] = dias
  }
  aplicarEncargo('percentualMulta', 'qtdeDiasMulta', input.multaPct, input.qtdeDiasMulta, 'Multa')
  aplicarEncargo('percentualJuros', 'qtdeDiasJuros', input.jurosPct, input.qtdeDiasJuros, 'Juros')

  const body = JSON.stringify(payload)
  const res = await request<{ nuTituloGerado?: string; linhaDigitavel?: string; cdBarras?: string }>({
    host: HOSTS[input.cred.ambiente],
    path: '/boleto/cobranca-registro/v1/cobranca',
    method: 'POST',
    headers: {
      // OBS: exemplo Bradesco usa token cru, sem "Bearer"
      'authorization': token,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body, pfx: input.cred.pfx, passphrase: input.cred.passphrase,
  })

  // Payload resumido para log/diagnostico: mascara CPF/CNPJ do pagador
  const mask = (s: string) => s.length <= 4 ? '****' : s.slice(0, 3) + '*'.repeat(Math.max(0, s.length - 6)) + s.slice(-3)
  const payload_resumo: Record<string, unknown> = { ...payload }
  if (typeof payload_resumo.nuCpfcnpjPagador === 'string') payload_resumo.nuCpfcnpjPagador = mask(payload_resumo.nuCpfcnpjPagador as string)
  if (typeof payload_resumo.nuCPFCNPJ === 'string') payload_resumo.nuCPFCNPJ = mask(payload_resumo.nuCPFCNPJ as string)
  payload_resumo._endpoint = `${HOSTS[input.cred.ambiente]}/boleto/cobranca-registro/v1/cobranca`
  // Guarda de diagnostico: origem do nuNegociacao. Se der CBTT0004 de novo, sabemos de cara
  // se o numero veio da CONFIG (gerente/painel) ou foi DERIVADO da agencia+conta (calculo).
  payload_resumo._nuNegociacaoOrigem = nuNegociacaoOrigem

  return {
    status: res.status,
    nuTituloGerado: res.body?.nuTituloGerado,
    linhaDigitavel: res.body?.linhaDigitavel,
    cdBarras: res.body?.cdBarras,
    raw: res.body,
    payload_resumo,
  }
}
