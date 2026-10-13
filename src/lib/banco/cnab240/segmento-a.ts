// SEGMENTO A — TRANSFERÊNCIA / TED (crédito em conta / outro banco).
// 🔴 TRAVADO PARA PRODUÇÃO: NÃO temos .rem real do Sicoob com segmento A. O layout abaixo é o padrão
// FEBRABAN inferido — NÃO provado byte a byte (RD-38). A forma 'transferencia' só pode ser gerada em
// AMBIENTE DE HOMOLOGAÇÃO até: (a) um .rem real de TED do Sicoob provar o layout, OU (b) o Sicoob aceitar
// o arquivo de homologação. Só então liberar em produção. Dinheiro saindo não vai a prod sem prova.
import { Field } from './engine'

/** Marca de gate: a UI/gerador deve BLOQUEAR 'transferencia' fora de homologação enquanto true. */
export const TED_TRAVADO_PARA_PRODUCAO = true

// Layout FEBRABAN padrão do segmento A (a VALIDAR em homologação — posições podem ajustar no Sicoob).
export const SEG_A_INFERIDO: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['mov', 3, 'N'],
  ['camara', 3, 'N'], ['bancoFavorecido', 3, 'N'], ['agFav', 5, 'N'], ['dvAgFav', 1, 'A'], ['contaFav', 12, 'N'],
  ['dvContaFav', 1, 'A'], ['dvAgContaFav', 1, 'A'], ['nomeFav', 30, 'A'], ['seuNum', 20, 'A'], ['dtPagto', 8, 'N'],
  ['tipoMoeda', 3, 'A'], ['qtdMoeda', 15, 'N'], ['valPagto', 15, 'N'], ['nossoNum', 20, 'A'], ['dtReal', 8, 'N'],
  ['valReal', 15, 'N'], ['outrasInfo', 40, 'A'], ['finalidadeDoc', 2, 'A'], ['finalidadeTed', 5, 'A'],
  ['cnab1', 5, 'A'], ['avisoFav', 1, 'A'], ['ocorrencias', 10, 'A'],
]
// Soma das larguras acima = 240. Este arquivo existe para a F1-T; a montagem só é liberada em homologação.
