// Erro do banco → frase do usuário (HB0, auditor 24/10: /dashboard/projetos/catalogo/[id] mostrava
// "invalid input syntax for type uuid: %5Bid%5D"). Regra: a tela nunca mostra mensagem crua do Postgres/PostgREST.
// - RAISE EXCEPTION das NOSSAS funções (código P0001) já vem em português para o usuário → passa como está.
// - Os códigos conhecidos viram frase pronta; o resto cai na frase genérica do contexto.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export const MSG_ENDERECO_INVALIDO = 'Registro não encontrado: o endereço desta página está incompleto. Volte à lista e abra o item de novo.'

type ErroLike = { code?: unknown; message?: unknown } | null | undefined

export function erroAmigavel(e: unknown, generica = 'Não foi possível concluir. Tente de novo.'): string {
  const err = (e && typeof e === 'object' ? e : { message: e }) as ErroLike
  const code = typeof err?.code === 'string' ? err.code : ''
  const msg = typeof err?.message === 'string' ? err.message.trim() : ''

  if (code === 'P0001' && msg) return /^[a-z0-9_]+$/.test(msg) ? codigoAmigavel(msg, generica) : msg
  if (code === '22P02' || /invalid input syntax for type uuid/i.test(msg)) return MSG_ENDERECO_INVALIDO
  if (code === 'PGRST116') return 'Registro não encontrado ou sem acesso.'
  if (code === '42501' || /permission denied|row-level security/i.test(msg)) return 'Você não tem permissão para esta ação nesta empresa.'
  if (code === '23505') return 'Já existe um registro com esses dados.'
  if (code === '23503') return 'Este registro está ligado a outro e não pode ser alterado assim.'
  if (code === '23502' || /null value in column/i.test(msg)) return 'Preencha os campos obrigatórios.'
  if (code === '23514') return 'Algum valor está fora do permitido. Confira os campos.'
  if (code === '57014' || /timeout|failed to fetch|network/i.test(msg)) return 'A conexão demorou ou caiu. Tente de novo.'
  return generica
}

// Código de retorno das nossas RPCs ({ ok:false, erro:'sem_acesso' }) → frase. Código desconhecido nunca aparece
// cru ("Erro: obra_nao_encontrada"): vira a frase genérica do contexto.
const CODIGOS: Record<string, string> = {
  sem_acesso: 'Você não tem acesso a este registro.',
  sem_permissao: 'Você não tem permissão para esta ação nesta empresa.',
  nao_encontrado: 'Registro não encontrado ou sem acesso.',
  nao_encontrada: 'Registro não encontrado ou sem acesso.',
  motivo_obrigatorio: 'Informe o motivo.',
}
export function codigoAmigavel(codigo: unknown, generica = 'Não foi possível concluir. Tente de novo.'): string {
  if (typeof codigo !== 'string' || !codigo) return generica
  if (CODIGOS[codigo]) return CODIGOS[codigo]
  // Texto já em linguagem do usuário (tem espaço e não é snake_case) passa como está.
  if (/\s/.test(codigo) && !/^[a-z0-9_]+$/.test(codigo)) return codigo
  return generica
}
