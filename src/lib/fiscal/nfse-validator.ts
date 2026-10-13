import type { NFSeRequest } from './types'
import { FiscalError } from './errors'

export function validateNFSeRequest(req: NFSeRequest): void {
  const erros: string[] = []

  if (!req.descricaoServico || req.descricaoServico.trim().length < 3) {
    erros.push('descricaoServico e obrigatorio (min 3 caracteres)')
  }
  if (!req.valorServicos || req.valorServicos <= 0) {
    erros.push('valorServicos deve ser maior que zero')
  }
  if (!req.codigoServico) {
    erros.push('codigoServico (item lista municipal) e obrigatorio · cadastre em /dashboard/cadastros/servicos')
  } else if (!/^\d{6}$/.test(String(req.codigoServico).trim())) {
    erros.push(`Codigo do servico invalido: "${req.codigoServico}" · precisa ter 6 digitos numericos (ex.: 170101). Corrija no cadastro do servico.`)
  }
  if (!req.prestador?.cnpj || req.prestador.cnpj.length !== 14) {
    erros.push('CNPJ do prestador invalido')
  }
  if (!req.prestador?.razaoSocial) {
    erros.push('Razao social do prestador obrigatoria')
  }
  if (!req.tomador?.razaoSocial) {
    erros.push('Razao social do tomador obrigatoria')
  }
  if (req.tomador.cnpj && req.tomador.cnpj.length !== 14) {
    erros.push('CNPJ do tomador deve ter 14 digitos')
  }
  if (req.tomador.cpf && req.tomador.cpf.length !== 11) {
    erros.push('CPF do tomador deve ter 11 digitos')
  }
  if (!req.tomador.cnpj && !req.tomador.cpf) {
    erros.push('Tomador precisa de CNPJ OU CPF')
  }

  if (erros.length > 0) {
    throw new FiscalError('PAYLOAD_INVALIDO', erros.join(' · '), { erros })
  }
}
