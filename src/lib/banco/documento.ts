// Classificação PF/PJ do pagador de boleto — pela ÚNICA fonte confiável: o documento.
//
// Por que isto existe: a Jordana (chamado #61) tinha um cliente pessoa física (CPF, 11
// dígitos) com o campo "tipo_pessoa" em branco no cadastro. As rotas de boleto deduzem o
// tipo desse campo e, quando ele vem vazio, caíam no default "PJ". O conector então mandava
// tipoPessoa = PESSOA_JURIDICA fixo, e o banco recusou com 422:
//   "Em pagador, para o PESSOA_JURIDICA o documento deve possuir 14 digitos."
// O código chutava o tipo em vez de olhar o documento. O documento não mente: 11 dígitos é
// CPF (física), 14 é CNPJ (jurídica). Qualquer outra quantidade é documento incompleto.

export const onlyDigitsDoc = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export type PessoaTipo = 'FISICA' | 'JURIDICA'

// Deriva PF/PJ pelo tamanho do documento LIMPO (só dígitos). null = documento inválido
// (nem CPF nem CNPJ): quem chamar deve barrar antes de ir ao banco, com mensagem clara.
export function tipoPessoaPorDocumento(documento: string | null | undefined): PessoaTipo | null {
  const d = onlyDigitsDoc(documento)
  if (d.length === 11) return 'FISICA'
  if (d.length === 14) return 'JURIDICA'
  return null
}
