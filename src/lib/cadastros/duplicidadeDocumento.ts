// #129/#130 (Jordana · KGF/Gean) · Quando conferir se o CNPJ/CPF já existe em outro cadastro da empresa.
// Na inclusão, sempre que houver documento. Na edição, só se o documento mudou: editar o próprio cadastro sem mexer no
// CNPJ não é "criar um duplicado" — o alerta aparecia mesmo assim quando havia outro cadastro ATIVO com o mesmo CNPJ, e
// "abrir o existente" fechava o formulário sem salvar a correção (ex.: Contribuinte de ICMS). A consulta, quando roda,
// só considera cadastros ativos (um duplicado inativado não bloqueia nada).
export const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

export function deveConferirDuplicidade(atual: { id?: string | null; cnpj_cpf?: string | null } | null, documentoDigitado: string): boolean {
  const doc = soDigitos(documentoDigitado)
  if (!doc) return false
  if (!atual?.id) return true
  return soDigitos(atual.cnpj_cpf) !== doc
}
