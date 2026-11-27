// Chamado #11084 — busca de destinatário da NF-e avulsa pelo SERVIDOR (funções canônicas fn_cliente_buscar /
// fn_fornecedor_buscar: nome_fantasia OR razao_social OR documento nas duas colunas). Antes a tela carregava só 500
// cadastros ordenados por razao_social (NULL por último) e filtrava no navegador: quem tem razão social vazia (pessoa
// física guarda o nome em nome_fantasia) caía depois do corte e "sumia". Puro (sem Supabase): recebe a chamada ao banco.

export type TabelaDestinatario = 'erp_clientes' | 'erp_fornecedores'

export type OpcaoDestinatario = { id: string; nome: string; documento: string | null; cidade: string | null }

export const MIN_TERMO_DESTINATARIO = 2
export const LIMITE_OPCOES_DESTINATARIO = 20

export const FUNCAO_BUSCA: Record<TabelaDestinatario, 'fn_cliente_buscar' | 'fn_fornecedor_buscar'> = {
  erp_clientes: 'fn_cliente_buscar',
  erp_fornecedores: 'fn_fornecedor_buscar',
}

type Linha = { cliente_id?: string; fornecedor_id?: string; nome?: string; cnpj_cpf?: string | null; cidade?: string | null }
type Resposta = { ok?: boolean; erro?: string; resultados?: Linha[] } | null

/** O termo vale para busca? (a função do banco devolve vazio abaixo de 2 caracteres — não varre a base) */
export function termoValido(termo: string): boolean {
  return termo.trim().length >= MIN_TERMO_DESTINATARIO
}

/** Resposta da função do banco → opções da lista (cliente_id/fornecedor_id viram id). */
export function opcoesDaResposta(resp: Resposta): OpcaoDestinatario[] {
  if (!resp || resp.ok === false) return []
  return (resp.resultados ?? [])
    .map((r) => ({ id: String(r.cliente_id ?? r.fornecedor_id ?? ''), nome: r.nome ?? '—', documento: r.cnpj_cpf ?? null, cidade: r.cidade ?? null }))
    .filter((o) => o.id)
}

/** Texto de uma opção: nome · documento · cidade. */
export function textoOpcao(o: Pick<OpcaoDestinatario, 'nome' | 'documento' | 'cidade'>): string {
  return [o.nome, o.documento, o.cidade].filter(Boolean).join(' · ')
}

export type ChamarRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

/** Busca no servidor. Erro de rede/permissão vira `erro` (a tela mostra), nunca lista vazia silenciosa. */
export async function buscarDestinatarios(
  chamar: ChamarRpc, tabela: TabelaDestinatario, companyId: string, termo: string,
): Promise<{ opcoes: OpcaoDestinatario[]; erro: string | null }> {
  if (!termoValido(termo)) return { opcoes: [], erro: null }
  const { data, error } = await chamar(FUNCAO_BUSCA[tabela], { p_company_id: companyId, p_termo: termo.trim(), p_limit: LIMITE_OPCOES_DESTINATARIO })
  if (error) return { opcoes: [], erro: 'Não foi possível buscar agora. Tente de novo.' }
  const resp = data as Resposta
  if (resp && resp.ok === false) return { opcoes: [], erro: resp.erro ?? 'Não foi possível buscar agora.' }
  return { opcoes: opcoesDaResposta(resp), erro: null }
}
