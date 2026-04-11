/**
 * session.ts — PS Gestão v1.3
 * Sem dependência de @supabase/ssr.
 * Use nas API Routes junto com withAuth para obter dados do usuário.
 */
import { createClient } from '@supabase/supabase-js'

/**
 * Cria um cliente Supabase autenticado com o Bearer token do request.
 * Use em Server Actions ou helpers de servidor que recebem o token.
 */
export function createAuthClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  )
}

/**
 * Verifica um token e retorna o usuário — uso em helpers de servidor.
 * Retorna null se inválido.
 */
export async function getUserFromToken(accessToken: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user }, error } = await supabase.auth.getUser(accessToken)
  if (error || !user) return null
  return user
}

/**
 * Retorna empresa_id do usuário via tabela profiles.
 */
export async function getEmpresaId(userId: string): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('profiles')
    .select('empresa_id')
    .eq('id', userId)
    .single()
  return data?.empresa_id ?? null
}
