import type { NFeRequest } from './types'
import { FiscalError } from './errors'

const NCM_REGEX = /^\d{8}$/
const CFOP_REGEX = /^\d{4}$/

export function validateNFeRequest(req: NFeRequest): void {
  const erros: string[] = []

  if (!req.naturezaOperacao || req.naturezaOperacao.length < 3) {
    erros.push('naturezaOperacao obrigatoria')
  }
  if (!req.emitente?.cnpj || req.emitente.cnpj.length !== 14) {
    erros.push('CNPJ emitente invalido (14 digitos)')
  }
  if (!req.emitente?.inscricaoEstadual) {
    erros.push('Inscricao Estadual emitente obrigatoria pra NFe · configure na empresa')
  }
  if (!req.destinatario?.razaoSocial) {
    erros.push('Razao social destinatario obrigatoria')
  }
  if (!req.destinatario.cnpj && !req.destinatario.cpf) {
    erros.push('Destinatario precisa de CNPJ OU CPF')
  }
  if (!req.destinatario.endereco) {
    erros.push('Endereco completo do destinatario obrigatorio pra NFe')
  } else {
    if (!req.destinatario.endereco.logradouro) erros.push('Logradouro destinatario obrigatorio')
    if (!req.destinatario.endereco.cep) erros.push('CEP destinatario obrigatorio')
    if (!req.destinatario.endereco.uf) erros.push('UF destinatario obrigatorio')
    if (!req.destinatario.endereco.cidade) erros.push('Cidade destinatario obrigatoria')
  }
  if (!req.itens || req.itens.length === 0) {
    erros.push('NFe precisa de pelo menos 1 item')
  } else {
    req.itens.forEach((item, idx) => {
      const prefixo = `Item ${idx + 1}`
      if (!item.descricao || item.descricao.length < 2) erros.push(`${prefixo}: descricao obrigatoria`)
      if (!item.ncm || !NCM_REGEX.test(item.ncm.replace(/\D/g, ''))) {
        erros.push(`${prefixo}: NCM invalido (8 digitos · ex: 84713012)`)
      }
      if (!item.cfop || !CFOP_REGEX.test(item.cfop)) {
        erros.push(`${prefixo}: CFOP invalido (4 digitos · ex: 5102)`)
      }
      if (!item.quantidade || item.quantidade <= 0) erros.push(`${prefixo}: quantidade > 0`)
      if (!item.valorUnitario || item.valorUnitario <= 0) erros.push(`${prefixo}: valor unitario > 0`)
      if (!item.unidade) erros.push(`${prefixo}: unidade obrigatoria (ex: UN, KG, M)`)
    })
  }

  if (erros.length > 0) {
    throw new FiscalError('PAYLOAD_INVALIDO', erros.join(' · '), { erros })
  }
}
