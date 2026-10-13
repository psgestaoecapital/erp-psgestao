import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin'
import { exigirUsuario } from '@/lib/auth/guardaApi'

export async function GET(req: Request) {
  const guarda = await exigirUsuario(req, { admin: true })
  if (guarda instanceof NextResponse) return guarda
  const results: Record<string, any> = {}
  const tables = [
    'empresas', 'clientes_assessoria', 'assessorias', 'lancamentos',
    'diagnosticos', 'users', 'linhas_negocio', 'custos_industriais',
  ]

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase.from(table).select('*', { count: 'exact' }).limit(5)
      if (error) {
        results[table] = { error: error.message, code: error.code }
      } else {
        results[table] = {
          count: count || (data || []).length,
          columns: data && data.length > 0 ? Object.keys(data[0]) : [],
          sample: (data || []).slice(0, 3).map((row: any) => {
            const preview: Record<string, string> = {}
            Object.keys(row).forEach(k => {
              if (row[k] !== null && row[k] !== undefined) {
                preview[k] = String(row[k]).substring(0, 60)
              }
            })
            return preview
          }),
        }
      }
    } catch (e: unknown) {
      results[table] = { error: e instanceof Error ? e.message : 'erro' }
    }
  }

  return NextResponse.json(results)
}