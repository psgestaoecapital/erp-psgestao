// CEP gravado em erp_clientes.cep (varchar(9)) só com os 8 dígitos — mesma regra da tela de Cadastros.
// A ReceitaWS devolve "89.900-000" (10 caracteres) e estourava a coluna no cadastro rápido (#2982).
export function normalizarCep(cep?: string | null): string {
  return (cep ?? '').replace(/\D/g, '')
}
