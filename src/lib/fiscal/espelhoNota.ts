// Chamado #11234 — a "nota resumida" que as rotas de NF-e devolvem na PRÉVIA (apenasPrevia) para o espelho em PDF, num só lugar
// (antes cada rota — emitir, remessa, devolução — repetia o mesmo bloco). Além do resumo que já existia (usado pelo card de
// conferência), leva os dados completos do DANFE (`danfe`), para o espelho sair no leiaute oficial. Só reorganiza dados.
import type { NFeRequest } from './types'
import type { EspelhoNota } from './espelhoPdf'
import { danfeDeNFeRequest } from './danfeDados'
import { carregarEmitenteDanfe } from './danfeEmitente'

export async function notaEspelhoDeNFeReq(nfeReq: NFeRequest, companyId: string): Promise<EspelhoNota> {
  const d = nfeReq.destinatario
  const end = d.endereco
  const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)
  const emitente = await carregarEmitenteDanfe(companyId)
  return {
    naturezaOperacao: nfeReq.naturezaOperacao,
    serie: nfeReq.serie,
    finalidade: nfeReq.finalidade,
    consumidorFinal: nfeReq.consumidorFinal ?? null,
    destinatario: {
      razaoSocial: d.razaoSocial,
      documento: d.cnpj || d.cpf || null,
      tipoDocumento: d.cnpj ? 'CNPJ' : (d.cpf ? 'CPF' : null),
      email: d.email ?? null,
      endereco: end ? [end.logradouro, end.numero, end.bairro, end.cidade, end.uf, end.cep].filter(Boolean).join(', ') : null,
    },
    itens: nfeReq.itens.map((it) => ({
      descricao: it.descricao,
      ncm: it.ncm ?? null,
      cfop: it.cfop ?? null,
      cst: it.icms?.cst ?? null,
      cBenef: it.icms?.cBenef ?? null,
      chassi: it.veiculo?.chassi ?? null,
      icmsBase: it.icms?.base ?? null,
      icmsValor: it.icms?.valor ?? null,
      ibsCbs: it.ibsCbs ? { base: it.ibsCbs.baseCalculo, cbs: it.ibsCbs.cbsValor, ibs: it.ibsCbs.ibsValorTotal } : null,
      valorTotal: it.valorTotal,
    })),
    totais: {
      produtos: valorProdutos,
      ibsCbs: nfeReq.ibsCbsTotais ? { base: nfeReq.ibsCbsTotais.baseCalculo, cbs: nfeReq.ibsCbsTotais.cbsValor, ibs: nfeReq.ibsCbsTotais.ibsValor } : null,
    },
    danfe: danfeDeNFeRequest(nfeReq, emitente),
  }
}
