// Conferência Focus × local (dívida de visibilidade fiscal, 25/09).
// Compara o CADASTRO da empresa no Focus (objeto bruto de GET /v2/empresas) com a NOSSA config
// (erp_fiscal_provider_config + companies). Motivo: a Focus CARIMBA no DPS o que está no cadastro dela
// (regime/optante, série, IM…), e nunca damos PUT lá — então uma DIVERGÊNCIA entre os dois vira
// rejeição na emissão (foi o que injetou o pTotTribSN no E0713 da FC, e provável causa do E0010 de série).
//
// Regra de divergência (RD-38, sem adivinhar): só marca `diverge=true` quando OS DOIS lados têm valor
// e eles DIFEREM. Se a Focus não expõe o campo, marca `diverge=false` + observação — nunca bloqueia por
// desconhecido (bloquear no escuro quebraria emissões válidas).

export interface LocalFiscalConfig {
  regime_tributario: string | null
  opcao_simples_nacional: number | null
  serie_nfse_padrao: string | null
  inscricao_municipal: string | null
}

export interface CampoConferencia {
  chave: string
  rotulo: string
  local: string | null
  focus: string | null
  diverge: boolean
  observacao?: string
}

export interface ResultadoConferencia {
  campos: CampoConferencia[]
  divergencias: number
}

// Lê a 1ª chave presente (não-nula) dentre várias candidatas do objeto bruto da Focus.
function pega(obj: Record<string, unknown>, chaves: string[]): unknown {
  for (const k of chaves) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') return obj[k]
  }
  return undefined
}
const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const boolish = (v: unknown): boolean | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['true', 't', '1', 'sim', 's', 'optante'].includes(s)) return true
  if (['false', 'f', '0', 'nao', 'não', 'n'].includes(s)) return false
  return null
}

// Optante do Simples pela NOSSA config: opção 2 (MEI) / 3 (ME-EPP) OU regime que cite "simples".
function localEhOptante(local: LocalFiscalConfig): boolean {
  if (local.opcao_simples_nacional === 2 || local.opcao_simples_nacional === 3) return true
  return /simples/i.test(local.regime_tributario ?? '')
}

export function compararFocusLocal(
  focus: Record<string, unknown> | null,
  local: LocalFiscalConfig,
): ResultadoConferencia {
  const campos: CampoConferencia[] = []
  if (!focus) return { campos, divergencias: 0 }

  // (1) OPTANTE DO SIMPLES — o campo do E0713. Focus pode expor booleano ou string de regime.
  // ANTI-FALSO-POSITIVO (CEO 25/09): só marca divergência com SINAL INEQUÍVOCO. Um regime numérico
  // ou desconhecido NÃO vira "não optante" por suposição (isso daria falso positivo numa empresa do
  // Simples cujo regime a Focus devolvesse como código). Boolean → usa; string clara (simples / normal/
  // presumido/lucro/real) → usa; qualquer outra coisa → null (não expõe de forma confiável, não bloqueia).
  {
    const localOpt = localEhOptante(local)
    const focusRaw = pega(focus, ['optante_simples_nacional', 'simples_nacional', 'optante_simples', 'optante_pelo_simples'])
    let focusOpt = boolish(focusRaw)
    if (focusOpt === null) {
      const reg = String(pega(focus, ['regime_tributario', 'codigo_regime_tributario']) ?? '')
      if (/simples/i.test(reg)) focusOpt = true
      else if (/normal|presumid|lucro|real/i.test(reg)) focusOpt = false
      // regime numérico/vazio/desconhecido → focusOpt permanece null (não sinaliza)
    }
    campos.push({
      chave: 'optante_simples',
      rotulo: 'Optante do Simples Nacional',
      local: localOpt ? 'Optante' : 'Não optante',
      focus: focusOpt === null ? null : (focusOpt ? 'Optante' : 'Não optante'),
      diverge: focusOpt !== null && focusOpt !== localOpt,
      observacao: focusOpt === null ? 'Focus não expõe o regime de forma legível nesta resposta — confira no painel' : undefined,
    })
  }

  // (2) INSCRIÇÃO MUNICIPAL (E0116) — compara só dígitos.
  {
    const localIM = soDigitos(local.inscricao_municipal)
    const focusRaw = pega(focus, ['inscricao_municipal', 'im'])
    const focusIM = focusRaw === undefined ? '' : soDigitos(focusRaw)
    campos.push({
      chave: 'inscricao_municipal',
      rotulo: 'Inscrição Municipal',
      local: local.inscricao_municipal ?? null,
      focus: focusRaw === undefined ? null : String(focusRaw),
      diverge: !!localIM && !!focusIM && localIM !== focusIM,
      observacao: focusRaw === undefined ? 'Focus não expõe a IM nesta resposta' : undefined,
    })
  }

  // (3) SÉRIE NFS-e — INFORMATIVO por ora (nunca bloqueia). ANTI-FALSO-POSITIVO: sem o leiaute (Dívida 1)
  // não sabemos se a chave que a Focus expõe é a série da NFS-e ou de outro documento (NF-e), então
  // comparar poderia acusar divergência onde não há. Mostra os dois lados para o humano conferir; quando
  // a Dívida 1 confirmar o campo exato, isto volta a bloquear.
  {
    const focusRaw = pega(focus, ['serie_nfse', 'serie_rps_nfse', 'serie_dps', 'serie_rps'])
    campos.push({
      chave: 'serie_nfse',
      rotulo: 'Série da NFS-e (informativo)',
      local: local.serie_nfse_padrao ?? null,
      focus: focusRaw === undefined ? null : String(focusRaw),
      diverge: false,
      observacao: 'Comparação informativa até o leiaute confirmar o campo de série no Focus',
    })
  }

  // (4) NFS-e habilitada no Focus — não é divergência com o local, mas trava a emissão se false.
  {
    const habRaw = pega(focus, ['habilita_nfse', 'habilita_nfsen'])
    const hab = boolish(habRaw)
    campos.push({
      chave: 'habilita_nfse',
      rotulo: 'NFS-e habilitada no Focus',
      local: 'esperado: sim',
      focus: hab === null ? null : (hab ? 'sim' : 'não'),
      diverge: hab === false,
      observacao: hab === null ? 'Focus não expõe habilita_nfse nesta resposta' : undefined,
    })
  }

  return { campos, divergencias: campos.filter((c) => c.diverge).length }
}
