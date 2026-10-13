import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { exigirLogin, exigirEmpresas, negar, type ContextoGuarda } from '@/lib/auth/guardaApi'

// PR C (CEO 28/09): o instalador do agente ATAK sai por URL ASSINADA (10 min), não mais pelo bucket público.
// Só usuário logado com acesso à empresa E empresa com conexão ATAK cadastrada. O token do agente não sai daqui
// (a tela já o tem); só os links do .exe e do nssm.exe e a versão publicada (versao.json).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'agente'
const VALIDADE_S = 10 * 60

export const GET = exigirLogin(async (req: NextRequest, ctx: ContextoGuarda) => {
  const companyId = req.nextUrl.searchParams.get('company_id')
  const negado = await exigirEmpresas(ctx, [companyId])
  if (negado) return negado

  const { data: conexao } = await supabaseAdmin.from('atak_conexao_config')
    .select('company_id').eq('company_id', companyId!).maybeSingle()
  if (!conexao) return negar(404, 'Esta empresa não tem conexão ATAK cadastrada.')

  const [exe, nssm, man] = await Promise.all([
    supabaseAdmin.storage.from(BUCKET).createSignedUrl('agente-atak.exe', VALIDADE_S),
    supabaseAdmin.storage.from(BUCKET).createSignedUrl('nssm.exe', VALIDADE_S),
    supabaseAdmin.storage.from(BUCKET).download('versao.json'),
  ])
  if (exe.error || !exe.data?.signedUrl || nssm.error || !nssm.data?.signedUrl) {
    return negar(503, 'O instalador ainda não foi publicado. Avise o suporte PS.')
  }
  let versao: string | null = null
  let sha256: string | null = null
  try {
    const m = man.data ? JSON.parse(await man.data.text()) : null
    versao = typeof m?.versao === 'string' ? m.versao : null
    sha256 = typeof m?.sha256 === 'string' ? m.sha256 : null
  } catch { /* manifesto opcional */ }

  return NextResponse.json(
    { ok: true, exe: exe.data.signedUrl, nssm: nssm.data.signedUrl, versao, sha256, validade_s: VALIDADE_S },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
