// POST /api/demo/revenda/logo-crlv
// Onda final A · Ativos sintéticos da Demonstração Revenda: LOGO da loja (marca d'água) + CRLV de 3
// veículos (carro, moto, e um com campos faltando). Tudo SVG sintético com selo "DEMONSTRAÇÃO" — sem
// placa/chassi/Renavam reais (não é dado pessoal). Sobe pelo bucket privado revenda-veiculos (mesmo prefixo
// por company_id que a RLS exige) e grava os caminhos: veic_config.logo_storage_path + marca_dagua_ativa e
// veic_veiculo.crlv_storage_path. Guardas iguais ao endpoint de fotos: PS_ADMIN OU x-watcher-secret, e
// empresa OBRIGATORIAMENTE is_demo (fail-closed). Idempotente: pula o que já tem logo/CRLV.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withAuth } from '@/lib/withAuth'
import { empresaPermitidaParaRobo, MSG_ROBO_SO_DEMO } from '@/lib/gold/roboEmpresaPermitida'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const BUCKET = 'revenda-veiculos'
// 3 veículos para CRLV: um carro, uma moto e um com campos faltando (recém-entrado).
const CRLV_ALVOS = ['DEMO0REVENDA00004', 'DEMO0REVENDA00010', 'DEMO0REVENDA00001'] as const

function esc(s: string): string { return String(s || '').replace(/[<>&]/g, '') }

function svgLogo(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160" viewBox="0 0 400 160">
  <rect width="400" height="160" rx="16" fill="#3D2314"/>
  <text x="200" y="72" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="40" font-weight="800" fill="#C8941A">AUTO DEMO</text>
  <text x="200" y="108" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="20" letter-spacing="3" fill="#E8DCC8">REVENDA · DEMONSTRAÇÃO</text>
</svg>`
}

// CRLV sintético — layout de documento com selo d'água DEMONSTRAÇÃO. faltando=true omite campos (demo do "completar").
function svgCrlv(modelo: string, ano: string, cor: string, faltando: boolean): string {
  const linha = (y: number, k: string, v: string) =>
    `<text x="70" y="${y}" font-family="system-ui,Arial,sans-serif" font-size="22" fill="#6B5D4F">${esc(k)}</text>` +
    `<text x="360" y="${y}" font-family="system-ui,Arial,sans-serif" font-size="22" font-weight="700" fill="#3D2314">${esc(v)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="600" viewBox="0 0 850 600">
  <rect width="850" height="600" fill="#FAF7F2"/>
  <rect x="30" y="30" width="790" height="540" rx="18" fill="#FFFFFF" stroke="#E0D8CC" stroke-width="2"/>
  <text x="425" y="90" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="30" font-weight="800" fill="#3D2314">CRLV (DEMONSTRAÇÃO)</text>
  ${linha(160, 'Marca/Modelo', modelo)}
  ${linha(210, 'Ano fab/mod', ano)}
  ${linha(260, 'Cor', cor)}
  ${linha(310, 'Placa', faltando ? '—' : 'ABC1D23')}
  ${linha(360, 'Renavam', faltando ? '—' : '00000000000')}
  ${linha(410, 'Chassi', faltando ? '—' : '9BW00000000000000')}
  <text x="425" y="300" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="120" font-weight="800" fill="#B42318" fill-opacity="0.12" transform="rotate(-18 425 300)">DEMONSTRAÇÃO</text>
  <text x="425" y="530" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="18" fill="#9C8E80">Documento fictício — sem dado real. ${faltando ? 'Campos propositalmente faltando.' : ''}</text>
</svg>`
}

async function core(req: NextRequest, ctx: { userId: string | null; viaSecret?: boolean }) {
  const sb = supabaseAdmin
  if (!ctx.viaSecret) {
    const { data: perfil } = await sb.from('users').select('system_role').eq('id', ctx.userId!).maybeSingle()
    if (!perfil || !['PS_ADMIN', 'PS_ADMIN_CVM'].includes(String(perfil.system_role))) {
      return NextResponse.json({ erro: 'apenas_ps_admin' }, { status: 403 })
    }
  }
  let body: { empresa_id?: string } = {}
  try { body = await req.json() } catch { /* opcional */ }
  const empresaId = (body.empresa_id || DEMO_REVENDA).trim()
  if (!(await empresaPermitidaParaRobo(sb, empresaId))) {
    return NextResponse.json({ erro: 'empresa_nao_demo', mensagem: MSG_ROBO_SO_DEMO, empresa_id: empresaId }, { status: 403 })
  }

  const out: { logo?: string; crlvs: { chassi: string; ok: boolean; erro?: string }[] } = { crlvs: [] }

  // ── LOGO da loja (marca d'água) ─────────────────────────────────────────────
  const { data: cfg } = await sb.from('veic_config').select('logo_storage_path').eq('company_id', empresaId).maybeSingle()
  if (!(cfg as { logo_storage_path?: string | null } | null)?.logo_storage_path) {
    const logoPath = `${empresaId}/_config/logo-demo.svg`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(logoPath, Buffer.from(svgLogo(), 'utf-8'), { contentType: 'image/svg+xml', upsert: true })
    if (!upErr) {
      await sb.from('veic_config').update({ logo_storage_path: logoPath, marca_dagua_ativa: true, updated_at: new Date().toISOString() }).eq('company_id', empresaId)
      out.logo = logoPath
    } else out.logo = `erro: ${upErr.message}`
  } else out.logo = 'ja_tinha'

  // ── CRLV de 3 veículos ──────────────────────────────────────────────────────
  const { data: veics } = await sb.from('veic_veiculo')
    .select('id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, crlv_storage_path')
    .eq('company_id', empresaId).in('chassi', CRLV_ALVOS as unknown as string[]).is('deleted_at', null)
  for (const v of (veics as Array<{ id: string; chassi: string; marca: string | null; modelo: string | null; ano_fabricacao: number | null; ano_modelo: number | null; cor: string | null; crlv_storage_path: string | null }>) ?? []) {
    if (v.crlv_storage_path) { out.crlvs.push({ chassi: v.chassi, ok: true }); continue }
    const faltando = v.chassi === 'DEMO0REVENDA00001'
    const modelo = [v.marca, v.modelo].filter(Boolean).join(' ') || 'Veículo'
    const ano = `${v.ano_fabricacao ?? '—'}/${v.ano_modelo ?? '—'}`
    const path = `${empresaId}/${v.id}/crlv-demo.svg`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, Buffer.from(svgCrlv(modelo, ano, v.cor || '—', faltando), 'utf-8'), { contentType: 'image/svg+xml', upsert: true })
    if (upErr) { out.crlvs.push({ chassi: v.chassi, ok: false, erro: upErr.message }); continue }
    const { error: updErr } = await sb.from('veic_veiculo').update({ crlv_storage_path: path, updated_at: new Date().toISOString() }).eq('id', v.id)
    if (updErr) { await sb.storage.from(BUCKET).remove([path]); out.crlvs.push({ chassi: v.chassi, ok: false, erro: updErr.message }); continue }
    out.crlvs.push({ chassi: v.chassi, ok: true })
  }

  return NextResponse.json({ ok: true, empresa_id: empresaId, ...out })
}

export async function POST(req: NextRequest, routeCtx: unknown) {
  const secret = req.headers.get('x-watcher-secret')
  const expected = process.env.WATCHER_SECRET
  if (expected && secret === expected) return core(req, { userId: null, viaSecret: true })
  return withAuth((r, c) => core(r, { userId: c.userId, viaSecret: false }))(req, routeCtx)
}
