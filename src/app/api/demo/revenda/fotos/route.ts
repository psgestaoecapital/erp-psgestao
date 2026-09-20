// POST /api/demo/revenda/fotos
// Revenda R1a · Fotos da demonstração pelo fluxo REAL de upload (fecha R0.4/R0.5 e prova o #1580).
//
// Sobe fotos SINTÉTICAS (sem placa/chassi real — não é dado pessoal) nos veículos da Demonstração
// Revenda, pelo MESMO caminho da tela: bytes no bucket privado `revenda-veiculos` no path
// `{company_id}/{veiculo_id}/{ts}-{i}.svg` (o mesmo prefixo por company_id que a RLS do bucket exige,
// exatamente o que o #1580 corrigiu) + registro via a MESMA regra do fn_veic_foto_registrar
// (1ª foto = principal, ordem sequencial, veic_veiculo.foto_url = principal → aparece no card do Pátio).
//
// Guardas (RD-69/RD-70, fail-closed):
//   • autenticação: sessão PS_ADMIN (system_role IN PS_ADMIN, PS_ADMIN_CVM) OU header x-watcher-secret
//     (mesmo padrão do screen-watcher/juiz) — assim o Eng. Chefe roda a FILA-4 só com o secret;
//   • empresa OBRIGATORIAMENTE is_demo=true (empresaPermitidaParaRobo) — nunca toca empresa de cliente,
//     valha o secret ou a sessão (a trava de demo é o que protege, não o tipo de credencial);
//   • idempotente: veículo que já tem foto é PULADO (não duplica em re-execução).
//
// Prova (RD-38, RD-70): rodar → abrir /dashboard/revenda/patio na demo → cards com foto; recarregar →
// continuam (bytes reais no bucket, URL assinada). O upload usa service_role (secret só existe no
// servidor); o path por company_id é idêntico ao da tela, então a LEITURA na tela (createSignedUrls,
// RLS `split_part(name,'/',1) IN get_user_company_ids`) passa para um membro da empresa demo.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withAuth } from '@/lib/withAuth'
import { empresaPermitidaParaRobo, MSG_ROBO_SO_DEMO } from '@/lib/gold/roboEmpresaPermitida'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const BUCKET = 'revenda-veiculos'
// Ângulos sintéticos por veículo (2 fotos: card + galeria). Sem placa, sem chassi.
const ANGULOS = ['Frente', 'Lateral'] as const

// Paleta determinística a partir do id (mesma cor sempre → re-execução visual estável).
function corDoId(id: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const hue = h % 360
  return { bg: `hsl(${hue} 42% 30%)`, fg: `hsl(${hue} 55% 88%)` }
}

// SVG sintético (texto, sem binário) — modelo + ângulo + selo de demonstração. Nada de placa real.
function svgSintetico(modelo: string, angulo: string, id: string): string {
  const { bg, fg } = corDoId(id)
  const modeloSafe = String(modelo || 'Veículo').replace(/[<>&]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="${bg}"/>
  <rect x="60" y="60" width="1080" height="680" rx="28" fill="none" stroke="${fg}" stroke-opacity="0.35" stroke-width="3"/>
  <text x="600" y="360" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="120" font-weight="700" fill="${fg}">🚗</text>
  <text x="600" y="470" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="72" font-weight="700" fill="#FFFFFF">${modeloSafe}</text>
  <text x="600" y="540" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="40" fill="${fg}">${angulo}</text>
  <text x="600" y="700" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="30" letter-spacing="2" fill="${fg}" fill-opacity="0.8">DEMONSTRAÇÃO — SEM PLACA REAL</text>
</svg>`
}

async function handlerCore(req: NextRequest, ctx: { userId: string | null; viaSecret?: boolean }) {
  const supabase = supabaseAdmin

  // Guarda 1 (autenticação): só quando NÃO veio pelo x-watcher-secret. O secret já é a autorização
  // (validado no POST); a trava real que impede tocar cliente é a Guarda 2 (is_demo), abaixo.
  if (!ctx.viaSecret) {
    const { data: perfil, error: perfilErr } = await supabase
      .from('users').select('system_role').eq('id', ctx.userId!).maybeSingle()
    if (perfilErr) return NextResponse.json({ erro: 'falha_perfil', detalhe: perfilErr.message }, { status: 500 })
    if (!perfil || !['PS_ADMIN', 'PS_ADMIN_CVM'].includes(String(perfil.system_role))) {
      return NextResponse.json({ erro: 'apenas_ps_admin' }, { status: 403 })
    }
  }

  let body: { empresa_id?: string; max?: number } = {}
  try { body = await req.json() } catch { /* body opcional */ }
  const empresaId = (body.empresa_id || DEMO_REVENDA).trim()
  const max = Math.max(1, Math.min(20, Number(body.max) || 8))

  // Guarda 2: só is_demo (fail-closed)
  if (!(await empresaPermitidaParaRobo(supabase, empresaId))) {
    return NextResponse.json({ erro: 'empresa_nao_demo', mensagem: MSG_ROBO_SO_DEMO, empresa_id: empresaId }, { status: 403 })
  }

  // Veículos SEM foto (idempotência), até `max`.
  const { data: veiculos, error: vErr } = await supabase
    .from('veic_veiculo')
    .select('id, modelo, veic_veiculo_foto(id)')
    .eq('company_id', empresaId)
    .is('deleted_at', null)
    .order('modelo', { ascending: true })
  if (vErr) return NextResponse.json({ erro: 'falha_veiculos', detalhe: vErr.message }, { status: 500 })

  const semFoto = (veiculos ?? [])
    .filter((v: { veic_veiculo_foto?: unknown[] }) => !(v.veic_veiculo_foto && v.veic_veiculo_foto.length))
    .slice(0, max) as { id: string; modelo: string | null }[]

  const resultado: { veiculo_id: string; modelo: string | null; fotos: number; erro?: string }[] = []
  let subiram = 0

  for (const v of semFoto) {
    const paths: string[] = []
    let falhou: string | null = null
    for (let i = 0; i < ANGULOS.length; i++) {
      const svg = svgSintetico(v.modelo || 'Veículo', ANGULOS[i], v.id)
      const path = `${empresaId}/${v.id}/${Date.now()}-${i}.svg`
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, Buffer.from(svg, 'utf-8'), { contentType: 'image/svg+xml', upsert: false })
      if (upErr) { falhou = upErr.message; break }
      paths.push(path)
    }
    if (falhou) {
      // limpa órfãos do storage (mesmo padrão da tela quando o registro falha)
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
      resultado.push({ veiculo_id: v.id, modelo: v.modelo, fotos: 0, erro: falhou })
      continue
    }

    // Registro pela MESMA regra do fn_veic_foto_registrar: 1ª = principal, ordem 0..n, foto_url = principal.
    const linhas = paths.map((p, idx) => ({
      veiculo_id: v.id, company_id: empresaId, storage_path: p,
      principal: idx === 0, ordem: idx, created_by: ctx.userId,
    }))
    const { error: insErr } = await supabase.from('veic_veiculo_foto').insert(linhas)
    if (insErr) {
      await supabase.storage.from(BUCKET).remove(paths)
      resultado.push({ veiculo_id: v.id, modelo: v.modelo, fotos: 0, erro: insErr.message })
      continue
    }
    await supabase.from('veic_veiculo')
      .update({ foto_url: paths[0], updated_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', v.id)

    resultado.push({ veiculo_id: v.id, modelo: v.modelo, fotos: paths.length })
    subiram += paths.length
  }

  return NextResponse.json({
    ok: true,
    empresa_id: empresaId,
    veiculos_processados: semFoto.length,
    fotos_criadas: subiram,
    ja_tinham_foto: (veiculos ?? []).length - semFoto.length,
    detalhe: resultado,
  })
}

// Dois caminhos de auth: x-watcher-secret (Eng. Chefe/robô, sem sessão) OU sessão PS_ADMIN (withAuth).
// Em ambos, a Guarda 2 (is_demo) recusa empresa real com 403.
export async function POST(req: NextRequest, routeCtx: unknown) {
  const secret = req.headers.get('x-watcher-secret')
  const expected = process.env.WATCHER_SECRET
  if (expected && secret === expected) {
    return handlerCore(req, { userId: null, viaSecret: true })
  }
  return withAuth((r, c) => handlerCore(r, { userId: c.userId, viaSecret: false }))(req, routeCtx)
}
