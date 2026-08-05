// Motor CNAB 240 de pagamento (genérico) + perfis Sicoob (756) e Sicredi (748). Provado byte a byte
// (docs/cnab, scripts/cnab-*). Cada perfil é isolado; o motor não conhece banco (RD-52).
export * from './engine'
export * from './sicoob'
export * from './mapear'
export { buildArquivoSicredi, reconstruirInputSicredi, construirBenefBodySicredi } from './sicredi'
export { mapearRemessaSicredi, type ResultadoMapaSicredi } from './mapear-sicredi'
export { parseRetornoSicredi, type RetornoSicredi, type ItemRetornoSicredi } from './retorno-sicredi'
export { TED_TRAVADO_PARA_PRODUCAO, SEG_A_INFERIDO } from './segmento-a'
