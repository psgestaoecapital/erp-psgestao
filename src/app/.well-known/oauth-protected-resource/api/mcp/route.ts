// Canal PS · metadados do recurso protegido (RFC 9728) do servidor MCP /api/mcp: o login é o OAuth do Supabase Auth do
// próprio ERP. Público (só metadados). Servido na raiz e no caminho com o recurso (/.well-known/oauth-protected-resource/api/mcp).
import { respostaMetadados } from '@/lib/canalPs/mcp'

export const dynamic = 'force-dynamic'

export function GET(req: Request): Response {
  return respostaMetadados(req, process.env.NEXT_PUBLIC_SUPABASE_URL || '')
}
