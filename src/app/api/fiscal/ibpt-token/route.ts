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

async function itemDeTeste(companyId: string, uf: string): Promise<{ consulta: ConsultaIbpt; generico: boolean }> {
  // produto real da empresa com NCM — de preferência óleo (NCM 2710, pedido do CEO para a 1ª prova na KGF)
  for (const filtro of ['2710%', '%']) {
    const { data: p } = await supabaseAdmin.from('erp_produtos')
      .select('ncm, nome, descricao, unidade, preco_venda, codigo_barras')
      .eq('company_id', companyId).eq('ativo', true).like('ncm', filtro).not('ncm', 'is', null)
      .limit(1).maybeSingle()
    const ncm = String(p?.ncm ?? '').replace(/\D/g, '')
    if (p && ncm.length === 8) {
      return { generico: false, consulta: {
        tipo: 'produto', codigo: ncm, uf, ex: 0, descricao: String(p.nome || p.descricao || 'produto'),
        unidadeMedida: String(p.unidade || 'UN'), valor: Number(p.preco_venda) || 1, gtin: p.codigo_barras ? String(p.codigo_barras) : null,
      } }
    }
  }
  const { data: s } = await supabaseAdmin.from('erp_servicos')
    .select('codigo_lc116, descricao_resumida, valor_unitario').eq('company_id', companyId).eq('ativo', true)
    .not('codigo_lc116', 'is', null).limit(1).maybeSingle()
  const lc = String(s?.codigo_lc116 ?? '').replace(/\D/g, '')
  if (s && lc.length === 4) {
    return { generico: false, consulta: { tipo: 'servico', codigo: lc, uf, descricao: String(s.descricao_resumida || 'serviço'), unidadeMedida: 'UN', valor: Number(s.valor_unitario) || 1 } }
  }
  return { generico: true, consulta: { ...TESTE_GENERICO[0], uf } }
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
  const { consulta, generico } = await itemDeTeste(companyId, emp.uf)
  const r = await consultarApiIbpt(token, emp.cnpj, consulta)
  if (!r.ok) {
    // não grava token que não funcionou; o motivo aparece na tela (o token nunca vai para o log)
    return NextResponse.json({ ok: false, motivo: r.motivo, mensagem: `${r.mensagem} O token não foi salvo.` }, { status: r.motivo === 'fora_do_ar' ? 503 : 400 })
  }
  const salvo = await gravarCredencialEmpresa(companyId, 'ibpt', 'token', token, 'Token IBPT (De Olho no Imposto)')
  if (!salvo) return NextResponse.json({ ok: false, mensagem: 'O IBPT aceitou o token, mas não foi possível guardá-lo. Tente de novo.' }, { status: 500 })
  const agora = new Date().toISOString()
  await gravarCacheIbpt(companyId, consulta, r.dado, r.cru)
  await registrarStatusIbpt(companyId, {
    token_salvo_em: agora, ultima_consulta_ok: agora, ultimo_erro: null, ultimo_erro_em: null,
    ultima_versao: r.dado.versao, ultima_vigencia_fim: r.dado.vigenciaFim,
  })
  return NextResponse.json({
    ok: true, generico,
    teste: {
      tipo: consulta.tipo, codigo: consulta.codigo, uf: consulta.uf, descricao: consulta.descricao,
      nacional: r.dado.nacional, importado: r.dado.importado, estadual: r.dado.estadual, municipal: r.dado.municipal,
      versao: r.dado.versao, vigenciaInicio: r.dado.vigenciaInicio, vigenciaFim: r.dado.vigenciaFim, fonte: r.dado.fonte,
    },
  })
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
