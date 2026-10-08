// Salário por pessoa (compliance_funcionarios.salario_base) — LGPD (CEO 04/10, migration 20261005180000).
// Rotas de /api usam o service_role (ignora o direito por coluna), então a regra mora aqui: nenhuma resposta leva
// salario_base. O valor individual só vem de fn_compliance_funcionario_salario, chamada com o JWT do PRÓPRIO usuário
// (a função confere empresa + "vê salário" e registra o acesso); quem não vê recebe a média da função (grupo de 3+).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SalarioFuncionario =
  | { pode_ver: true; salario_base: number | null }
  | { pode_ver: false; cargo: string | null; pessoas_no_cargo: number; media_funcao: number | null }

/** Tira salario_base de uma linha (ou lista) lida com service_role. */
export function removerSalario<T extends Record<string, unknown>>(linha: T): Omit<T, 'salario_base'>
export function removerSalario<T extends Record<string, unknown>>(linha: T[]): Omit<T, 'salario_base'>[]
export function removerSalario<T extends Record<string, unknown>>(linha: T | T[]): unknown {
  const tira = (r: T) => { const { salario_base: _descartado, ...resto } = r; void _descartado; return resto }
  return Array.isArray(linha) ? linha.map(tira) : tira(linha)
}

/** Cliente com o JWT do usuário (RLS + funções SECURITY DEFINER enxergam auth.uid()). */
export function clienteDoUsuario(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export async function lerSalario(token: string, funcionarioId: string): Promise<SalarioFuncionario | null> {
  const { data, error } = await clienteDoUsuario(token).rpc('fn_compliance_funcionario_salario', { p_id: funcionarioId })
  if (error || !data) return null
  return data as SalarioFuncionario
}

/** true = gravou; false = o usuário não vê salário (não grava) ou a função recusou. */
export async function gravarSalario(token: string, funcionarioId: string, valor: number | null): Promise<boolean> {
  const { error } = await clienteDoUsuario(token).rpc('fn_compliance_funcionario_salario_salvar', { p_id: funcionarioId, p_valor: valor })
  return !error
}

/** Converte o que veio no corpo para número (ou null = limpar). undefined = valor inválido, não grava. */
export function salarioDoCorpo(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
