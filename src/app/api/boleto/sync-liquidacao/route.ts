// POST /api/boleto/sync-liquidacao — baixa automática dos boletos pagos, CIENTE DO BANCO (CEO 29/09 · aprovada).
// Para cada empresa, percorre as conexões ATIVAS com boleto (erp_banco_provider_config) dos bancos com consulta
// (src/lib/banco/liquidacao.ts: Sicoob e Sicredi; Bradesco quando chegar a documentação — #297). Cada banco só é
// consultado sobre os boletos DELE (boleto_banco_codigo) e a baixa vai por fn_boleto_liquidar com o banco (acha o título
// por empresa + banco + nosso número e baixa na conta daquele banco; idempotente). Cada execução empresa/banco fica em
// erp_boleto_liquidacao_execucao (sucesso ou falha); 2 falhas seguidas viram alerta no briefing.
//
// Quem chama:
//  - agendado: pg_cron 7h e 13h (Brasília) → fn_boleto_liquidacao_dispatch → Bearer <service key> { origem, lote_id } → TODAS as empresas;
//  - botão "Sincronizar liquidação" (usuário logado) → { company_id } → só aquela empresa (tem de ser dele);
//  - legado: x-ping-secret + { company_id }.
// NÃO fabrica movimento no fluxo — a conciliação com o extrato continua pelo OFX/extrato.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ehChamadaServico, exigirUsuario, empresasDoUsuario } from '@/lib/auth/guardaApi'
import { PROVEDORES_LIQUIDACAO, BANCOS_COM_CONSULTA, provedorPorBanco, situacaoPaga, statusExecucao, type Ambiente } from '@/lib/banco/liquidacao'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICOOB_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided); const B = Buffer.from(expected)
  return A.length === B.length && timingSafeEqual(A, B)
}

type Alvo = { company_id: string; banco_codigo: string; provider: string }
type Resultado = Alvo & { status: string; consultados: number; liquidados: number; erros: Array<{ nosso_numero: string; erro: string }>; mensagem: string | null }

async function registrar(lote: string, origem: 'agendado' | 'manual', r: Pick<Resultado, 'status' | 'consultados' | 'liquidados' | 'erros' | 'mensagem'> & Partial<Alvo>, usuario: string | null) {
  try {
    await supabaseAdmin.rpc('fn_boleto_liquidacao_registrar', {
      p_lote_id: lote, p_origem: origem, p_company_id: r.company_id ?? null, p_banco_codigo: r.banco_codigo ?? null,
      p_provider: r.provider ?? null, p_status: r.status, p_consultados: r.consultados, p_liquidados: r.liquidados,
      p_erros: r.erros.slice(0, 50), p_mensagem: r.mensagem, p_usuario_id: usuario,
    })
  } catch { /* o registro nunca derruba a baixa */ }
}

async function executarAlvo(alvo: Alvo): Promise<Resultado> {
  const base: Resultado = { ...alvo, status: 'ok', consultados: 0, liquidados: 0, erros: [], mensagem: null }
  const prov = provedorPorBanco(alvo.banco_codigo)
  if (!prov) return { ...base, status: 'erro', mensagem: `banco ${alvo.banco_codigo} sem consulta de boleto` }

  // só os boletos DESTE banco
  const { data: boletos, error: berr } = await supabaseAdmin.from('erp_receber')
    .select('id, boleto_nosso_numero, valor')
    .eq('company_id', alvo.company_id).eq('boleto_banco_codigo', alvo.banco_codigo)
    .is('deleted_at', null).eq('boleto_status', 'registrado').in('status', ['aberto', 'vencido', 'parcial'])
    .not('boleto_nosso_numero', 'is', null)
  if (berr) return { ...base, status: 'erro', mensagem: berr.message }
  const lista = (boletos ?? []) as { id: string; boleto_nosso_numero: string; valor: number }[]
  if (lista.length === 0) return { ...base, status: 'sem_boletos' }

  // credencial do banco (produção; se não houver, homologação)
  let ambiente: Ambiente = 'producao'
  let credRow = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: alvo.company_id, p_banco_codigo: alvo.banco_codigo, p_ambiente: 'producao' })).data as Record<string, unknown> | null
  if (!credRow || credRow.ok === false) {
    credRow = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: alvo.company_id, p_banco_codigo: alvo.banco_codigo, p_ambiente: 'homologacao' })).data as Record<string, unknown> | null
    ambiente = 'homologacao'
  }
  if (!credRow || credRow.ok === false) return { ...base, status: 'erro', mensagem: `credencial ${prov.provider} não configurada` }
  const montada = prov.montarCredencial(credRow, ambiente)
  if ('faltando' in montada) return { ...base, status: 'erro', mensagem: montada.faltando }

  let liquidados = 0
  const erros: Resultado['erros'] = []
  for (const b of lista) {
    const nn = b.boleto_nosso_numero
    try {
      const r = await prov.consultar(montada.cred, nn)
      try {
        await supabaseAdmin.rpc('fn_webhook_registrar_log', {
          p_provider: prov.provider, p_tipo: 'boleto_liquidacao', p_provider_reference: nn,
          p_status_recebido: r.situacao ?? 'DESCONHECIDA', p_ip_origem: null, p_user_agent: 'sync-liquidacao',
          p_payload_raw: r.raw, p_signature_valid: true,
        })
      } catch { /* log opcional */ }
      if (situacaoPaga(r.situacao)) {
        const { data: liq } = await supabaseAdmin.rpc('fn_boleto_liquidar', {
          p_company_id: alvo.company_id, p_nosso_numero: nn,
          p_data_pagamento: r.dataLiquidacao ?? new Date().toISOString().slice(0, 10),
          p_valor_pago: r.valorPago ?? b.valor, p_provider_raw: r.raw,
          p_provider: prov.provider, p_banco_codigo: alvo.banco_codigo,
        })
        const j = liq as { sucesso?: boolean; ja_liquidado?: boolean; erro?: string } | null
        if (j?.sucesso && !j.ja_liquidado) liquidados++
        else if (j && !j.sucesso) erros.push({ nosso_numero: nn, erro: j.erro ?? 'falha na baixa' })
      }
    } catch (e) {
      erros.push({ nosso_numero: nn, erro: e instanceof Error ? e.message.slice(0, 300) : String(e) })
    }
  }
  await supabaseAdmin.from('erp_banco_provider_config')
    .update({ ultimo_sync_em: new Date().toISOString(), ultimo_sync_status: erros.length > 0 ? 'parcial' : 'ok' })
    .eq('company_id', alvo.company_id).eq('banco_codigo', alvo.banco_codigo).eq('ambiente', ambiente).eq('ativo', true)
  const status = statusExecucao(lista.length, erros.length)
  return { ...base, status, consultados: lista.length, liquidados, erros,
    mensagem: status === 'erro' ? (erros[0]?.erro ?? 'todas as consultas falharam') : null }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { company_id?: string; lote_id?: string; origem?: string }
  const agendado = ehChamadaServico(req)
  const origem: 'agendado' | 'manual' = agendado ? 'agendado' : 'manual'
  const lote = agendado && typeof body.lote_id === 'string' ? body.lote_id : randomUUID()
  let usuario: string | null = null
  let companyId: string | null = null

  if (!agendado) {
    if (temSegredoValido(req)) {
      if (!body.company_id) return NextResponse.json({ ok: false, erro: 'company_id ausente' }, { status: 400 })
      companyId = body.company_id
    } else {
      const u = await exigirUsuario(req)
      if (u instanceof NextResponse) return u
      usuario = u.userId
      const permitidas = [...(await empresasDoUsuario(u.token))]
      if (permitidas.length === 0) return NextResponse.json({ ok: false, erro: 'sem empresas acessiveis' }, { status: 403 })
      if (body.company_id && !permitidas.includes(body.company_id)) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
      companyId = body.company_id ?? permitidas[0]
    }
  }

  try {
    // conexões ativas com boleto dos bancos que têm consulta (uma por empresa+banco)
    let q = supabaseAdmin.from('erp_banco_provider_config').select('company_id, banco_codigo, provider')
      .eq('ativo', true).eq('cap_boleto', true).in('banco_codigo', [...BANCOS_COM_CONSULTA])
    if (companyId) q = q.eq('company_id', companyId)
    const { data: cfgs, error } = await q
    if (error) throw new Error(error.message)
    const vistos = new Set<string>()
    const alvos: Alvo[] = []
    for (const c of (cfgs ?? []) as Alvo[]) {
      const k = `${c.company_id}|${c.banco_codigo}`
      if (!vistos.has(k)) { vistos.add(k); alvos.push({ company_id: c.company_id, banco_codigo: c.banco_codigo, provider: provedorPorBanco(c.banco_codigo)?.provider ?? c.provider }) }
    }

    const resultados: Resultado[] = []
    for (const alvo of alvos) {
      const r = await executarAlvo(alvo)
      resultados.push(r)
      await registrar(lote, origem, r, usuario)
    }
    const consultados = resultados.reduce((s, r) => s + r.consultados, 0)
    const liquidados = resultados.reduce((s, r) => s + r.liquidados, 0)
    const erros = resultados.flatMap((r) => (r.status === 'erro' && r.erros.length === 0 && r.mensagem ? [{ nosso_numero: '-', erro: `${r.provider}: ${r.mensagem}` }] : r.erros))
    const falhou = resultados.some((r) => r.status === 'erro')
    if (agendado) {
      await registrar(lote, 'agendado', { status: falhou ? (resultados.every((r) => r.status === 'erro') ? 'erro' : 'parcial') : 'ok',
        consultados, liquidados, erros: [], mensagem: `${resultados.length} empresa(s)/banco(s)` }, null)
    }
    return NextResponse.json({
      ok: true, lote_id: lote, consultados, liquidados, erros,
      por_banco: resultados.map((r) => ({ company_id: r.company_id, banco_codigo: r.banco_codigo, provider: r.provider, status: r.status, consultados: r.consultados, liquidados: r.liquidados, mensagem: r.mensagem })),
      bancos_com_consulta: Object.keys(PROVEDORES_LIQUIDACAO),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await registrar(lote, origem, { company_id: companyId ?? undefined, status: 'erro', consultados: 0, liquidados: 0, erros: [], mensagem: msg }, usuario)
    return NextResponse.json({ ok: false, erro: msg, lote_id: lote }, { status: 500 })
  }
}
