import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { empresasDoUsuario, exigirEmpresas, type UsuarioApi } from '@/lib/auth/guardaApi'

// Empresas pedidas aos dashboards (grupo_id | company_ids | company_id), já conferidas com a guardaApi.
// - ids explícitos → TODOS precisam ser do usuário (403 se algum não for);
// - grupo_id → fica só a interseção com as empresas do usuário (grupo salvo pode ter empresa da qual
//   o usuário saiu: a tela não quebra, a empresa só some). Grupo de outro usuário vira lista vazia.
// Lista vazia = nada pedido/permitido; a rota mantém a resposta "sem_empresas" que já tinha.

export async function somenteEmpresasDoUsuario(u: UsuarioApi, ids: string[]): Promise<string[]> {
  if (u.maquina) return ids
  const permitidas = await empresasDoUsuario(u.token)
  return ids.filter((id) => permitidas.has(id))
}

export async function empresasDoGrupo(grupoId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('dashboard_grupos_empresas').select('company_id').eq('grupo_id', grupoId)
  return ((data || []) as { company_id: string }[]).map((g) => g.company_id)
}

export async function resolverEmpresasDashboard(u: UsuarioApi, sp: URLSearchParams): Promise<string[] | NextResponse> {
  const grupoId = sp.get('grupo_id')
  if (grupoId) return somenteEmpresasDoUsuario(u, await empresasDoGrupo(grupoId))
  const lista = sp.get('company_ids')
  const ids = lista ? lista.split(',').map((s) => s.trim()).filter(Boolean) : sp.get('company_id') ? [sp.get('company_id')!] : []
  if (ids.length === 0) return []
  const negado = await exigirEmpresas(u, ids)
  return negado ?? ids
}
