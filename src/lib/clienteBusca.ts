// Filtro PostgREST .or() para busca de cliente por nome/CNPJ.
//
// BUG Jordana (08/07): o padrão antigo era
//   .or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cpf_cnpj.ilike.%${t.replace(/\D/g,'')}%`)
// Ao digitar um NOME (sem dígitos), t.replace(/\D/g,'') vira '' → cpf_cnpj.ilike.%%
// que casa QUALQUER cliente com CNPJ preenchido. Como é OR, o filtro por nome era
// anulado e a lista devolvia os primeiros N clientes sem filtrar. (Latente até o
// CNPJ dos clientes ser preenchido em massa via sync/cadastro.)
//
// Correção:
//  - CNPJ só entra quando há >= 2 dígitos no termo;
//  - nome busca em razao_social E nome_fantasia;
//  - sanitiza vírgula/parênteses/aspas/barra — quebram o parser do .or() do PostgREST
//    (comum em razão social: "FULANO (ME)", "X, Y & Cia").
// Retorna null quando não sobra nenhuma cláusula válida (chamador zera a lista).
//
// Chamado #11084: o documento do cliente mora em cpf_cnpj OU em cnpj_cpf conforme a origem do cadastro (na base: 7.283
// só em cpf_cnpj, 4.396 só em cnpj_cpf). Buscar numa coluna só escondia o CPF/CNPJ de quem estava na outra — por isso
// as DUAS colunas entram no filtro. O parâmetro colCpf ficou só por compatibilidade com quem já chama.

export function orFiltroClienteBusca(
  busca: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _colCpf: 'cpf_cnpj' | 'cnpj_cpf' = 'cpf_cnpj',
): string | null {
  const termo = busca.replace(/[,()"\\]/g, '').trim()
  const digits = busca.replace(/\D/g, '')
  const parts: string[] = []
  if (termo.length >= 2) {
    parts.push(`razao_social.ilike.%${termo}%`, `nome_fantasia.ilike.%${termo}%`)
  }
  if (digits.length >= 2) {
    parts.push(`cpf_cnpj.ilike.%${digits}%`, `cnpj_cpf.ilike.%${digits}%`)
  }
  return parts.length ? parts.join(',') : null
}
