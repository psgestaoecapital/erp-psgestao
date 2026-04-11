import { redirect } from 'next/navigation'
import { getServerUser } from './session'

/**
 * Use em Server Components de página para garantir autenticação.
 * Redireciona automaticamente para /login se não autenticado.
 *
 * Exemplo:
 *   export default async function DashboardPage() {
 *     const user = await requireAuth()
 *     return <Dashboard user={user} />
 *   }
 */
export async function requireAuth() {
  const user = await getServerUser()
  if (!user) redirect('/login')
  return user
}

/**
 * Verifica papel (role) do usuário.
 * Redireciona para /dashboard se não tiver permissão.
 */
export async function requireRole(allowedRoles: string[]) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const role = (user.user_metadata?.role as string) ?? 'viewer'
  if (!allowedRoles.includes(role)) redirect('/dashboard')

  return user
}
