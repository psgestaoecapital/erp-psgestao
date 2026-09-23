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
  // Guarda 232: destinatario declarado CONTRIBUINTE (indIEDest=1) precisa de Inscricao Estadual. A
  // SEFAZ rejeita "IE do destinatario nao informada" (232). Barra ANTES de enviar — melhor parar aqui
  // com mensagem clara do que gastar uma rejeicao na frente do cliente. Isento(2)/nao-contribuinte(9)
  // nao exigem IE. Chokepoint unico: todo caminho de emissao passa por validateNFeRequest.
  if (req.destinatario.indicadorIE === 1 && !req.destinatario.inscricaoEstadual) {
    erros.push('Destinatario e contribuinte de ICMS mas esta sem Inscricao Estadual · '
      + 'informe a IE no cadastro do cliente, ou marque-o como isento / nao contribuinte · '
      + 'sem isso a SEFAZ rejeita (232 · IE do destinatario nao informada)')
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
      // Guarda ST retido (padrão do 232): CST 60/500 (ICMS cobrado antes por ST) exige os 4 campos de
      // ST retido; sem eles a SEFAZ rejeita (938). Barra ANTES de emitir, dizendo quais faltam — melhor
      // parar aqui do que gastar uma rejeição. Zero é valor válido, então testa == null (não falsy).
      if (item.icms?.cst === '500' || item.icms?.cst === '60') {
        const s = item.icms.stRet
        const faltando: string[] = []
        if (s?.vBcstRet == null) faltando.push('Base de cálculo do ICMS ST retido (vBCSTRet)')
        if (s?.pst == null) faltando.push('Alíquota suportada pelo consumidor final (pST)')
        if (s?.vIcmsSubstituto == null) faltando.push('ICMS próprio do substituto (vICMSSubstituto)')
        if (s?.vIcmsStRet == null) faltando.push('ICMS ST retido (vICMSSTRet)')
        if (faltando.length > 0) {
          erros.push(`${prefixo}: CST ${item.icms.cst} exige os campos de ST retido no cadastro do produto (bloco Fiscal) · faltando: ${faltando.join(', ')}`)
        }
      }
      // Guarda comb (padrão do 232/938): item com NCM de combustível/lubrificante (começa com 2710) exige
      // o grupo comb (NT 2016/002) — cProdANP e descANP no cadastro do produto (a UFCons vem do
      // destinatário). Sem eles a SEFAZ rejeita. Barra ANTES de emitir, dizendo o que falta, pra a Jordana
      // testar uma vez só com tudo. cProdANP é inteiro (aceita 0 teórico), por isso testa == null.
      const ncmComb = (item.ncm ?? '').replace(/\D/g, '')
      if (ncmComb.startsWith('2710')) {
        const faltandoComb: string[] = []
        if (item.comb?.cProdANP == null) faltandoComb.push('Código ANP do produto (cProdANP)')
        if (!item.comb?.descANP) faltandoComb.push('Descrição ANP do produto (descANP)')
        if (faltandoComb.length > 0) {
          erros.push(`${prefixo}: produto com NCM ${ncmComb} (combustível/lubrificante) exige o grupo ANP no cadastro do produto (bloco Fiscal) · faltando: ${faltandoComb.join(', ')} · sem isso a SEFAZ rejeita (grupo comb · NT 2016/002)`)
        }
      }
    })
  }

  if (erros.length > 0) {
    throw new FiscalError('PAYLOAD_INVALIDO', erros.join(' · '), { erros })
  }
}
