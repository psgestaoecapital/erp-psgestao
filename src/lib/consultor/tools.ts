// Consultor IA — execução das ferramentas do agente com o company_id SEMPRE FORÇADO pelo servidor (CEO 25/11).
// O modelo NUNCA escolhe a empresa: o company_id vem do closure (validado na rota contra o usuário logado), nunca do
// input que o modelo mandou. Por isso FERRAMENTAS (em agente.ts) não tem nenhum campo de empresa no input_schema e aqui
// o `input` do modelo é ignorado para fins de empresa. Módulo separado da rota para ser testável sem o runtime do Next
// (o parser SQL — sqlGuard/pgsql-parser WASM — só é carregado quando a ferramenta consultar_dados é realmente usada).

import { erroLegivel } from './agente'

// Interface mínima de um client Supabase (o suficiente para as ferramentas; facilita o mock no gate de CI).
export type SbLike = {
  // PromiseLike porque o client do Supabase devolve um builder "thenable" (não um Promise puro). Aceita o shape
  // { data, error } — error só precisa expor `message`.
  rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

// CEO 26/11, item 3: devolve ao modelo um {erro} LEGÍVEL. Vale para o erro de transporte (error.message) e para o erro
// que vem como DADO — o fn_consultor_sql captura o timeout internamente e retorna { erro, sqlstate } (statement timeout
// vira "a consulta demorou demais; tente de outro jeito"). Preserva o restante da saída quando não há erro.
function legibilizar(data: unknown): unknown {
  if (data && typeof data === 'object' && 'erro' in (data as Record<string, unknown>)) {
    const d = data as Record<string, unknown>
    return { ...d, erro: erroLegivel(String(d.erro ?? '')) }
  }
  return data
}

// Cria o executor de ferramentas amarrado a UM company_id. Toda RPC recebe p_company_id = companyId (forçado),
// independentemente do que o modelo tenha colocado em `input`.
// T5 (log de TODA consulta, CEO 26/11): cada execução de ferramenta grava em consultor_ia_consulta (company_id,
// user_id, pergunta_id, sql/descritor, linhas, ms, erro). consultar_dados já registra pela fn_consultor_sql (que passa
// a receber o pergunta_id); aqui registramos as DEMAIS ferramentas e a rejeição de guarda do SQL — sem duplicar.
export function fazerExecutarTool(sb: SbLike, companyId: string, perguntaId?: string | null) {
  const pid = perguntaId ?? null
  // registro best-effort: nunca aguardado, nunca lança — o log não pode atrasar nem derrubar a resposta.
  const registrar = (sql: string, linhas: number | null, ms: number, erro: string | null): void => {
    try {
      void Promise.resolve(
        sb.rpc('fn_consultor_registrar_consulta', {
          p_company_id: companyId, p_pergunta_id: pid, p_sql: sql, p_linhas: linhas, p_ms: ms, p_erro: erro,
        }),
      ).then(() => {}, () => {})
    } catch { /* ignora */ }
  }
  const nLinhas = (d: unknown): number | null => (Array.isArray(d) ? d.length : d == null ? null : 1)

  return async (nome: string, input: Record<string, unknown>): Promise<unknown> => {
    const t0 = Date.now()
    if (nome === 'consultar_dados') {
      const sql = typeof input.sql === 'string' ? input.sql : ''
      const { validarSqlConsultor } = await import('./sqlGuard')   // T1 (parser) antes do banco — import tardio
      const g = await validarSqlConsultor(sql)
      if (!g.ok) {
        // rejeitado pelo parser: não chega ao banco, então a fn_consultor_sql não registra — registramos aqui.
        registrar('consultar_dados: ' + sql.slice(0, 2000), null, Date.now() - t0, 'consulta não permitida: ' + g.motivo)
        return { erro: 'consulta não permitida: ' + g.motivo }
      }
      // fn_consultor_sql registra em consultor_ia_consulta (via consultor.fn_log), agora COM o pergunta_id — não duplicamos.
      const { data, error } = await sb.rpc('fn_consultor_sql', { p_company_id: companyId, p_sql: sql, p_pergunta_id: pid })
      if (error) return { erro: erroLegivel(error.message) }
      return legibilizar(data)
    }
    if (nome === 'situacao_parceiro') {
      const termo = typeof input.termo === 'string' ? input.termo.slice(0, 120) : ''
      const tipo = typeof input.tipo === 'string' && ['cliente', 'fornecedor'].includes(input.tipo) ? input.tipo : 'auto'
      if (termo.length < 2) return { erro: 'informe o nome ou CNPJ do cliente/fornecedor' }
      const { data, error } = await sb.rpc('fn_consultor_situacao_parceiro', { p_company_id: companyId, p_termo: termo, p_tipo: tipo })
      registrar(`situacao_parceiro: termo=${termo} tipo=${tipo}`, error ? null : nLinhas(data), Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : legibilizar(data)
    }
    if (nome === 'raio_x') {
      const { data, error } = await sb.rpc('fn_consultor_raiox', { p_company_id: companyId })
      registrar('raio_x', error ? null : nLinhas(data), Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : legibilizar(data)
    }
    if (nome === 'divergencia_saldo') {
      const { data, error } = await sb.rpc('fn_consultor_divergencia_contas', { p_company_id: companyId })
      registrar('divergencia_saldo', error ? null : nLinhas(data), Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : legibilizar(data)
    }
    if (nome === 'lancamentos_detalhe') {
      const filtro = typeof input.filtro === 'string' ? input.filtro : 'nao_conciliados'
      const termo = typeof input.termo === 'string' ? input.termo.slice(0, 100) : null
      const conta = typeof input.conta === 'string' ? input.conta.slice(0, 80) : null
      const { data, error } = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: filtro, p_termo: termo, p_conta: conta, p_limite: 50 })
      registrar(`lancamentos_detalhe: filtro=${filtro}${termo ? ' termo=' + termo : ''}${conta ? ' conta=' + conta : ''}`, error ? null : nLinhas(data), Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : legibilizar(data)
    }
    if (nome === 'saldo_contas') {
      const { data, error } = await sb.rpc('fn_saldo_bancos_dinamico', { p_company_ids: [companyId] })
      registrar('saldo_contas', error ? null : 1, Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : { saldo_total: Number(data ?? 0) }
    }
    if (nome === 'listagem') {
      const tipo = input.tipo === 'pagar' ? 'pagar' : 'receber'
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: tipo, p_data_inicio: null, p_data_fim: null, p_status_filtro: 'todos', p_status_filtros: ['todos'] })
      registrar(`listagem: tipo=${tipo}`, error ? null : nLinhas(data), Date.now() - t0, error?.message ?? null)
      return error ? { erro: erroLegivel(error.message) } : legibilizar(data)
    }
    return { erro: 'ferramenta desconhecida' }
  }
}
