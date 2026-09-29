// Dados do EMISSOR que vêm da Configuração Fiscal da empresa (erp_fiscal_provider_config): série da NFS-e,
// CNAE padrão e município (IBGE) do prestador. A emissão pelo Recebível (nfse-builder) e a NFS-e AVULSA
// (caminho manual da rota /api/fiscal/nfse/emitir) usam ESTA mesma leitura — antes a avulsa montava o
// prestador sem o município e com a série '1', e travava em "falta o código do município da empresa
// emitente" (nenhuma avulsa saiu pela Focus desde 23/09).

export type ConfigEmissor = {
  serie_nfse_padrao?: string | null
  cnae_padrao?: string | null
  gov_nfse_municipio_codigo?: string | null
}

export const SELECT_CONFIG_EMISSOR = 'cnae_padrao, serie_nfse_padrao, gov_nfse_municipio_codigo'

export function dadosEmissorDaConfig(cfg: ConfigEmissor | null | undefined, cnaeInformado?: string | null) {
  const muni = String(cfg?.gov_nfse_municipio_codigo ?? '').trim()
  return {
    serie: cfg?.serie_nfse_padrao || '1',
    cnaeServico: cnaeInformado || cfg?.cnae_padrao || '',
    codigoMunicipio: muni || undefined,
  }
}
