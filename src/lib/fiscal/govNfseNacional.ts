// NFS-e Nacional (gov.br) — constantes do padrão nacional usadas pela revenda (itens 2 e 4 do spec de 26/11).
//
// ENDPOINTS OFICIAIS do ADN (Ambiente de Dados Nacional), portal gov.br/nfse
// (biblioteca › documentação técnica › APIs - Prod. Restrita e Produção):
//   produção           → https://adn.nfse.gov.br
//   produção restrita  → https://adn.producaorestrita.nfse.gov.br  (= ambiente de testes / homologação)
// A EMISSÃO em si sai pelo provedor (Focus, endpoint /v2/nfsen) quando o município aderiu — este valor é
// gravado em erp_fiscal_provider_config.gov_nfse_endpoint_base como REFERÊNCIA do ADN nacional do ambiente
// (item 2: sincronizar a adesão do município na config da empresa). Não é a URL de transmissão.
export const ADN_NACIONAL_PRODUCAO = 'https://adn.nfse.gov.br'
export const ADN_NACIONAL_PRODUCAO_RESTRITA = 'https://adn.producaorestrita.nfse.gov.br'

/** Base do ADN nacional por ambiente ('producao' → produção; qualquer outro → produção restrita/homologação). */
export function adnEndpointBase(ambiente: string | null | undefined): string {
  return String(ambiente ?? '').trim().toLowerCase() === 'producao'
    ? ADN_NACIONAL_PRODUCAO
    : ADN_NACIONAL_PRODUCAO_RESTRITA
}

// Serviço de INTERMEDIAÇÃO (padrão único da revenda — "toda nota de serviço sai assim"): agenciamento /
// corretagem / intermediação de financiamento de veículo. Código de tributação NACIONAL 10.02.01
// (item 10.02 · subitem 01) → 6 dígitos "100201". A LC 116 do item é "10.02".
// IMPORTANTE (spec 26/11): aqui ficam só o CÓDIGO e a descrição padrão. O VALOR FISCAL (CST de PIS/COFINS/ISS
// e a alíquota) NÃO é hardcode — vem da parametrização: ISS por município (fiscal_iss_municipio, lido pela
// rota /api/fiscal/nfse/emitir) e retenções do cadastro. A contabilidade confirma.
export const INTERMEDIACAO_CODIGO_TRIBUTACAO_NACIONAL = '100201'
export const INTERMEDIACAO_CODIGO_LC116 = '10.02'
export const INTERMEDIACAO_DESCRICAO_PADRAO = 'Intermediação de financiamento de veículo'
