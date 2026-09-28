import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { gravarCredencialEmpresa } from '@/lib/credenciais/servidor'
import { consultarApiIbpt, gravarCacheIbpt, registrarStatusIbpt, type ConsultaIbpt } from '@/lib/fiscal/ibptEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// IBPT por empresa (CEO 28/09) · Configurações › Fiscal. A PRÓPRIA empresa salva, troca ou remove o token dela.
// O token vai direto para o Vault (cofre de credenciais da PR E) e NUNCA volta — nem para a própria empresa.
// "Salvar e testar" faz uma consulta real ao IBPT com o CNPJ/UF da empresa e só grava se o IBPT aceitar.
//   GET    ?companyId=…      → estado (configurado em, última consulta, último erro, versão) — sem o token
//   POST   { companyId, token } → testa e salva
//   DELETE { companyId }     → remove (volta para a tabela genérica)

// Teste genérico quando a empresa não tem produto nem serviço (ajuste 2 do CEO): um NCM e um LC116 comuns.
const TESTE_GENERICO: Omit<ConsultaIbpt, 'uf'>[] = [
  { tipo: 'produto', codigo: '27101932', descricao: 'Óleo lubrificante (teste)', unidadeMedida: 'UN', valor: 1, ex: 0 },
  { tipo: 'servico', codigo: '1701', descricao: 'Assessoria ou consultoria (teste)', unidadeMedida: 'UN', valor: 1 },
]

// Itens da consulta de teste: UM produto e UM serviço, quando a empresa tem os dois (CEO 28/09):
//  - produto: NCM 2710 (óleo) primeiro — 1ª prova na KGF —, senão qualquer produto com NCM;
//  - serviço: o código da ÚLTIMA NFS-e da empresa primeiro (FC: 07.05, para bater com a nota autorizada de
//    referência), senão qualquer serviço com LC116.
// Sem nenhum dos dois, um código padrão e o aviso de "teste genérico" (ajuste 2 do CEO).
async function itensDeTeste(companyId: string, uf: string): Promise<{ itens: ConsultaIbpt[]; generico: boolean }> {
  const itens: ConsultaIbpt[] = []
  for (const filtro of ['2710%', '%']) {
    const { data: p } = await supabaseAdmin.from('erp_produtos')
      .select('ncm, nome, descricao, unidade, preco_venda, codigo_barras')
      .eq('company_id', companyId).eq('ativo', true).like('ncm', filtro).not('ncm', 'is', null)
      .limit(1).maybeSingle()
    const ncm = String(p?.ncm ?? '').replace(/\D/g, '')
    if (p && ncm.length === 8) {
      itens.push({
        tipo: 'produto', codigo: ncm, uf, ex: 0, descricao: String(p.nome || p.descricao || 'produto'),
        unidadeMedida: String(p.unidade || 'UN'), valor: Number(p.preco_venda) || 1, gtin: p.codigo_barras ? String(p.codigo_barras) : null,
      })
      break
    }
  }
  const { data: ultima } = await supabaseAdmin.from('erp_nfse_emitidas')
    .select('codigo_servico').eq('company_id', companyId).not('codigo_servico', 'is', null)
    .order('data_emissao', { ascending: false }).limit(1).maybeSingle()
  const lcUltima = String(ultima?.codigo_servico ?? '').replace(/\D/g, '').slice(0, 4)   // 070501 -> 0705
  const { data: servs } = await supabaseAdmin.from('erp_servicos')
    .select('codigo_lc116, descricao_resumida, valor_unitario').eq('company_id', companyId).eq('ativo', true)
    .not('codigo_lc116', 'is', null).limit(50)
  const lista = ((servs ?? []) as Array<{ codigo_lc116: string | null; descricao_resumida: string | null; valor_unitario: number | null }>)
    .map((x) => ({ ...x, lc: String(x.codigo_lc116 ?? '').replace(/\D/g, '') }))
    .filter((x) => x.lc.length === 4)
  const s = lista.find((x) => x.lc === lcUltima) ?? lista[0]
  if (s) itens.push({ tipo: 'servico', codigo: s.lc, uf, descricao: String(s.descricao_resumida || 'serviço'), unidadeMedida: 'UN', valor: Number(s.valor_unitario) || 1 })
  if (itens.length > 0) return { itens, generico: false }
  return { itens: [{ ...TESTE_GENERICO[0], uf }], generico: true }
}

async function dadosEmpresa(companyId: string) {
  const { data } = await supabaseAdmin.from('companies').select('cnpj, uf_fiscal').eq('id', companyId).maybeSingle()
  return { cnpj: String(data?.cnpj ?? '').replace(/\D/g, ''), uf: String(data?.uf_fiscal ?? '').trim().toUpperCase() }
}

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const companyId = req.nextUrl.searchParams.get('companyId') ?? ''
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'membro', log: { notaTipo: 'nfe', operacao: 'ibpt_token', endpoint: 'ibpt-token' } })
  if (negado) return negado
  const [{ data: cred }, { data: st }, { data: gen }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from('erp_credencial').select('atualizado_em').eq('provider', 'ibpt').eq('chave', 'token').eq('escopo', 'empresa').eq('company_id', companyId).eq('ativo', true).maybeSingle(),
    supabaseAdmin.from('erp_ibpt_empresa_status').select('token_salvo_em, ultima_consulta_ok, ultimo_erro_em, ultimo_erro, ultima_versao, ultima_vigencia_fim').eq('company_id', companyId).maybeSingle(),
    supabaseAdmin.from('fiscal_ibpt_aliquota').select('versao, vigencia_fim').order('vigencia_fim', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('erp_fiscal_provider_config').select('ibpt_empresa_nas_notas').eq('company_id', companyId).eq('ativo', true).limit(1).maybeSingle(),
  ])
  return NextResponse.json({
    ok: true,
    configurado: !!cred,
    salvoEm: st?.token_salvo_em ?? cred?.atualizado_em ?? null,
    ultimaConsultaOk: st?.ultima_consulta_ok ?? null,
    ultimoErro: st?.ultimo_erro ?? null, ultimoErroEm: st?.ultimo_erro_em ?? null,
    versao: st?.ultima_versao ?? null, vigenciaFim: st?.ultima_vigencia_fim ?? null,
    usoNasNotas: !!(cfg as { ibpt_empresa_nas_notas?: boolean } | null)?.ibpt_empresa_nas_notas,
    generica: gen ? { versao: gen.versao, vigenciaFim: gen.vigencia_fim } : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = (await req.json().catch(() => ({}))) as { companyId?: string; token?: string }
  const companyId = String(body.companyId ?? '')
  const token = String(body.token ?? '').trim()
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'ibpt_token_salvar', endpoint: 'ibpt-token' } })
  if (negado) return negado
  if (token.length < 10) return NextResponse.json({ ok: false, mensagem: 'Cole o token do IBPT completo.' }, { status: 400 })

  const emp = await dadosEmpresa(companyId)
  if (emp.cnpj.length !== 14 || emp.uf.length !== 2) {
    return NextResponse.json({ ok: false, mensagem: 'Complete o CNPJ e a UF fiscal da empresa antes de testar o token do IBPT.' }, { status: 400 })
  }
  const { itens, generico } = await itensDeTeste(companyId, emp.uf)
  // Consulta real ao IBPT para cada item. O token vale se o IBPT aceitar ao menos uma; token recusado em qualquer
  // uma = não salva. O token nunca vai para log nem volta na resposta.
  const resultados: Array<{ consulta: ConsultaIbpt; r: Awaited<ReturnType<typeof consultarApiIbpt>> }> = []
  for (const consulta of itens) resultados.push({ consulta, r: await consultarApiIbpt(token, emp.cnpj, consulta) })
  const recusado = resultados.find((x) => !x.r.ok && x.r.motivo === 'token_invalido')
  const oks = resultados.filter((x) => x.r.ok)
  if (recusado || oks.length === 0) {
    const falha = (recusado ?? resultados[0]).r as { ok: false; motivo: string; mensagem: string }
    return NextResponse.json({ ok: false, motivo: falha.motivo, mensagem: `${falha.mensagem} O token não foi salvo.` }, { status: falha.motivo === 'fora_do_ar' ? 503 : 400 })
  }
  const salvo = await gravarCredencialEmpresa(companyId, 'ibpt', 'token', token, 'Token IBPT (De Olho no Imposto)')
  if (!salvo) return NextResponse.json({ ok: false, mensagem: 'O IBPT aceitou o token, mas não foi possível guardá-lo. Tente de novo.' }, { status: 500 })
  const agora = new Date().toISOString()
  for (const x of oks) if (x.r.ok) await gravarCacheIbpt(companyId, x.consulta, x.r.dado, x.r.cru)
  const ult = oks[oks.length - 1].r
  await registrarStatusIbpt(companyId, {
    token_salvo_em: agora, ultima_consulta_ok: agora, ultimo_erro: null, ultimo_erro_em: null,
    ultima_versao: ult.ok ? ult.dado.versao : null, ultima_vigencia_fim: ult.ok ? ult.dado.vigenciaFim : null,
  })
  // Lado a lado com a tabela genérica (a mesma que as notas usam hoje), para a conferência da PS antes de ligar.
  const testes = []
  for (const x of resultados) {
    const { data: g } = await supabaseAdmin.rpc('fn_ibpt_aliquota_vigente', {
      p_ncm: x.consulta.codigo, p_ex: '0', p_uf: x.consulta.uf, p_origem: '0',
    })
    const gen = (Array.isArray(g) ? g[0] : g) as { federal?: number; estadual?: number; municipal?: number; versao?: string } | null
    testes.push({
      tipo: x.consulta.tipo, codigo: x.consulta.codigo, uf: x.consulta.uf, descricao: x.consulta.descricao,
      ok: x.r.ok, erro: x.r.ok ? null : x.r.mensagem,
      nacional: x.r.ok ? x.r.dado.nacional : null, importado: x.r.ok ? x.r.dado.importado : null,
      estadual: x.r.ok ? x.r.dado.estadual : null, municipal: x.r.ok ? x.r.dado.municipal : null,
      versao: x.r.ok ? x.r.dado.versao : null, vigenciaInicio: x.r.ok ? x.r.dado.vigenciaInicio : null,
      vigenciaFim: x.r.ok ? x.r.dado.vigenciaFim : null, fonte: x.r.ok ? x.r.dado.fonte : null,
      generica: gen && gen.federal != null ? { federal: Number(gen.federal), estadual: Number(gen.estadual ?? 0), municipal: Number(gen.municipal ?? 0), versao: gen.versao ?? null } : null,
    })
  }
  return NextResponse.json({ ok: true, generico, testes })
})

export const DELETE = withAuth(async (req: NextRequest, { userId }) => {
  const body = (await req.json().catch(() => ({}))) as { companyId?: string }
  const companyId = String(body.companyId ?? '')
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'ibpt_token_remover', endpoint: 'ibpt-token' } })
  if (negado) return negado
  await supabaseAdmin.from('erp_credencial').update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq('provider', 'ibpt').eq('chave', 'token').eq('escopo', 'empresa').eq('company_id', companyId)
  await registrarStatusIbpt(companyId, { token_salvo_em: null })
  return NextResponse.json({ ok: true })
})
