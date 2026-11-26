// Consultor IA — execução das ferramentas do agente com o company_id SEMPRE FORÇADO pelo servidor (CEO 25/11).
// O modelo NUNCA escolhe a empresa: o company_id vem do closure (validado na rota contra o usuário logado), nunca do
// input que o modelo mandou. Por isso FERRAMENTAS (em agente.ts) não tem nenhum campo de empresa no input_schema e aqui
// o `input` do modelo é ignorado para fins de empresa. Módulo separado da rota para ser testável sem o runtime do Next
// (o parser SQL — sqlGuard/pgsql-parser WASM — só é carregado quando a ferramenta consultar_dados é realmente usada).

// Interface mínima de um client Supabase (o suficiente para as ferramentas; facilita o mock no gate de CI).
export type SbLike = {
  // PromiseLike porque o client do Supabase devolve um builder "thenable" (não um Promise puro). Aceita o shape
  // { data, error } — error só precisa expor `message`.
  rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

// Cria o executor de ferramentas amarrado a UM company_id. Toda RPC recebe p_company_id = companyId (forçado),
// independentemente do que o modelo tenha colocado em `input`.
export function fazerExecutarTool(sb: SbLike, companyId: string) {
  return async (nome: string, input: Record<string, unknown>): Promise<unknown> => {
    if (nome === 'consultar_dados') {
      const sql = typeof input.sql === 'string' ? input.sql : ''
      const { validarSqlConsultor } = await import('./sqlGuard')   // T1 (parser) antes do banco — import tardio
      const g = await validarSqlConsultor(sql)
      if (!g.ok) return { erro: 'consulta não permitida: ' + g.motivo }
      const { data, error } = await sb.rpc('fn_consultor_sql', { p_company_id: companyId, p_sql: sql })
      if (error) return { erro: error.message }
      return data
    }
    if (nome === 'situacao_parceiro') {
      const termo = typeof input.termo === 'string' ? input.termo.slice(0, 120) : ''
      const tipo = typeof input.tipo === 'string' && ['cliente', 'fornecedor'].includes(input.tipo) ? input.tipo : 'auto'
      if (termo.length < 2) return { erro: 'informe o nome ou CNPJ do cliente/fornecedor' }
      const { data, error } = await sb.rpc('fn_consultor_situacao_parceiro', { p_company_id: companyId, p_termo: termo, p_tipo: tipo })
      return error ? { erro: error.message } : data
    }
    if (nome === 'raio_x') {
      const { data, error } = await sb.rpc('fn_consultor_raiox', { p_company_id: companyId })
      return error ? { erro: error.message } : data
    }
    if (nome === 'divergencia_saldo') {
      const { data, error } = await sb.rpc('fn_consultor_divergencia_contas', { p_company_id: companyId })
      return error ? { erro: error.message } : data
    }
    if (nome === 'lancamentos_detalhe') {
      const filtro = typeof input.filtro === 'string' ? input.filtro : 'nao_conciliados'
      const termo = typeof input.termo === 'string' ? input.termo.slice(0, 100) : null
      const conta = typeof input.conta === 'string' ? input.conta.slice(0, 80) : null
      const { data, error } = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: filtro, p_termo: termo, p_conta: conta, p_limite: 50 })
      return error ? { erro: error.message } : data
    }
    if (nome === 'saldo_contas') {
      const { data, error } = await sb.rpc('fn_saldo_bancos_dinamico', { p_company_ids: [companyId] })
      return error ? { erro: error.message } : { saldo_total: Number(data ?? 0) }
    }
    if (nome === 'listagem') {
      const tipo = input.tipo === 'pagar' ? 'pagar' : 'receber'
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: tipo, p_data_inicio: null, p_data_fim: null, p_status_filtro: 'todos', p_status_filtros: ['todos'] })
      return error ? { erro: error.message } : data
    }
    return { erro: 'ferramenta desconhecida' }
  }
}
