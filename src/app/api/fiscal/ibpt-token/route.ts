import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { gravarCredencialEmpresa, credencialEmpresa } from '@/lib/credenciais/servidor'
import { consultarApiIbpt, gravarCacheIbpt, registrarStatusIbpt, type ConsultaIbpt } from '@/lib/fiscal/ibptEmpresa'
import { escolherProdutoTeste, escolherVeiculoTeste, type VeiculoTeste } from '@/lib/fiscal/ibptTeste'

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
//  - produto: NCM 2710 (óleo) primeiro — 1ª prova na KGF —, senão qualquer produto com NCM VÁLIDO (nunca vazio/00000000);
//    na REVENDA (#994), que não usa erp_produtos, o produto do teste é um VEÍCULO com NCM válido (veic_veiculo);
//  - serviço: o código da ÚLTIMA NFS-e da empresa primeiro (FC: 07.05, para bater com a nota autorizada de
//    referência), senão qualquer serviço com LC116.
// Sem nenhum dos dois, um código padrão e o aviso de "teste genérico" (ajuste 2 do CEO).
async function itensDeTeste(companyId: string, uf: string): Promise<{ itens: ConsultaIbpt[]; generico: boolean }> {
  const itens: ConsultaIbpt[] = []
  // NCM inválido (vazio/00000000) nunca é o item do teste — pula para o próximo (CEO 28/09).
  type Prod = { ncm: string | null; nome: string | null; descricao: string | null; unidade: string | null; preco_venda: number | null; codigo_barras: string | null }
  let p: (Prod & { ncmTeste: string }) | null = null
  for (const filtro of ['2710%', '%']) {
    const { data: prods } = await supabaseAdmin.from('erp_produtos')
      .select('ncm, nome, descricao, unidade, preco_venda, codigo_barras')
      .eq('company_id', companyId).eq('ativo', true).like('ncm', filtro).not('ncm', 'is', null).neq('ncm', '00000000')
      .limit(200)
    p = escolherProdutoTeste((prods ?? []) as Prod[], '2710')
    if (p) break
  }
  if (p) {
    itens.push({
      tipo: 'produto', codigo: p.ncmTeste, uf, ex: 0, descricao: String(p.nome || p.descricao || 'produto'),
      unidadeMedida: String(p.unidade || 'UN'), valor: Number(p.preco_venda) || 1, gtin: p.codigo_barras ? String(p.codigo_barras) : null,
    })
  } else {
    // Revenda (#994, Alliance): sem produto em erp_produtos, o produto do teste é um VEÍCULO com NCM válido
    // (veic_veiculo). Prefere o que está em estoque ('disponivel'); senão qualquer veículo ativo. Empresa sem
    // veículo (não é revenda) não acha nada aqui e segue para o serviço/teste genérico — comportamento inalterado.
    const { data: veics } = await supabaseAdmin.from('veic_veiculo')
      .select('ncm, marca, modelo, preco_venda, preco_minimo, valor_fipe, situacao')
      .eq('company_id', companyId).eq('ativo', true).not('ncm', 'is', null).neq('ncm', '00000000')
      .limit(200)
    const veiculos = ((veics ?? []) as Array<VeiculoTeste & { situacao: string | null }>)
      .slice().sort((a, b) => Number(b.situacao === 'disponivel') - Number(a.situacao === 'disponivel'))
    const v = escolherVeiculoTeste(veiculos)
    if (v) itens.push({ tipo: 'produto', codigo: v.ncmTeste, uf, ex: 0, descricao: v.descricao, unidadeMedida: 'UN', valor: v.valor, gtin: null })
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

// Mesma regra de regime da emissão (nfe/emitir/route.ts): Simples pelo regime_tributario OU pela opção do SN.
function ehSimplesConfig(c: { regime_tributario?: string | null; opcao_simples_nacional?: number | null } | null): boolean {
  return /simples/i.test(String(c?.regime_tributario ?? '')) || c?.opcao_simples_nacional != null
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
    supabaseAdmin.from('erp_fiscal_provider_config').select('ibpt_empresa_nas_notas, lei12741_ativo, regime_tributario, opcao_simples_nacional, percentual_total_tributos_sn').eq('company_id', companyId).eq('ativo', true).limit(1).maybeSingle(),
  ])
  const c = cfg as { ibpt_empresa_nas_notas?: boolean; lei12741_ativo?: boolean; regime_tributario?: string | null; opcao_simples_nacional?: number | null; percentual_total_tributos_sn?: number | string | null } | null
  return NextResponse.json({
    ok: true,
    configurado: !!cred,
    salvoEm: st?.token_salvo_em ?? cred?.atualizado_em ?? null,
    ultimaConsultaOk: st?.ultima_consulta_ok ?? null,
    ultimoErro: st?.ultimo_erro ?? null, ultimoErroEm: st?.ultimo_erro_em ?? null,
    versao: st?.ultima_versao ?? null, vigenciaFim: st?.ultima_vigencia_fim ?? null,
    usoNasNotas: !!c?.ibpt_empresa_nas_notas,
    lei12741Ativo: !!c?.lei12741_ativo,
    // Simples usa o percentual único (percentual_total_tributos_sn); regime normal usa a tabela/token IBPT.
    ehSimples: ehSimplesConfig(c),
    pctTributosSn: c?.percentual_total_tributos_sn != null ? Number(c.percentual_total_tributos_sn) : null,
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

// #bug NFS-e "sem tributos aproximados" · "Atualizar agora": reconsulta o IBPT com o token JÁ salvo (do Vault) e
// repopula o cache (erp_ibpt_cache) + o status, SEM precisar remover/recolocar o token. Mesma consulta do "salvar e
// testar", só que sem gravar token. Guarda: gerente (igual ao salvar).
export const PUT = withAuth(async (req: NextRequest, { userId }) => {
  const body = (await req.json().catch(() => ({}))) as { companyId?: string }
  const companyId = String(body.companyId ?? '')
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'ibpt_token_reconsultar', endpoint: 'ibpt-token' } })
  if (negado) return negado

  const token = await credencialEmpresa(companyId, 'ibpt', 'token')
  if (!token) return NextResponse.json({ ok: false, mensagem: 'Nenhum token do IBPT salvo nesta empresa. Cadastre o token primeiro.' }, { status: 400 })
  const emp = await dadosEmpresa(companyId)
  if (emp.cnpj.length !== 14 || emp.uf.length !== 2) {
    return NextResponse.json({ ok: false, mensagem: 'Complete o CNPJ e a UF fiscal da empresa antes de atualizar o IBPT.' }, { status: 400 })
  }
  const { itens } = await itensDeTeste(companyId, emp.uf)
  const resultados: Array<{ consulta: ConsultaIbpt; r: Awaited<ReturnType<typeof consultarApiIbpt>> }> = []
  for (const consulta of itens) resultados.push({ consulta, r: await consultarApiIbpt(token, emp.cnpj, consulta) })
  const recusado = resultados.find((x) => !x.r.ok && x.r.motivo === 'token_invalido')
  const oks = resultados.filter((x) => x.r.ok)
  if (recusado || oks.length === 0) {
    const falha = (recusado ?? resultados[0]).r as { ok: false; motivo: string; mensagem: string }
    await registrarStatusIbpt(companyId, { ultimo_erro_em: new Date().toISOString(), ultimo_erro: falha.mensagem })
    return NextResponse.json({ ok: false, motivo: falha.motivo, mensagem: falha.mensagem }, { status: falha.motivo === 'fora_do_ar' ? 503 : 400 })
  }
  const agora = new Date().toISOString()
  for (const x of oks) if (x.r.ok) await gravarCacheIbpt(companyId, x.consulta, x.r.dado, x.r.cru)
  const ult = oks[oks.length - 1].r
  await registrarStatusIbpt(companyId, {
    ultima_consulta_ok: agora, ultimo_erro: null, ultimo_erro_em: null,
    ultima_versao: ult.ok ? ult.dado.versao : null, ultima_vigencia_fim: ult.ok ? ult.dado.vigenciaFim : null,
  })
  return NextResponse.json({
    ok: true, atualizados: oks.length,
    versao: ult.ok ? ult.dado.versao : null, vigenciaFim: ult.ok ? ult.dado.vigenciaFim : null,
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
  // Token removido → a empresa deixa de usar o token da empresa nas notas (volta à tabela genérica). O "Lei 12.741
  // ativo" NÃO é mexido aqui (o valor aproximado continua saindo pela tabela genérica / percentual do Simples).
  await supabaseAdmin.from('erp_fiscal_provider_config').update({ ibpt_empresa_nas_notas: false })
    .eq('company_id', companyId).eq('ativo', true)
  return NextResponse.json({ ok: true })
})

// #11321 · liga/desliga, por empresa, o "valor aproximado dos tributos" (Lei 12.741) nas notas:
//   lei12741Ativo        → lei12741_ativo (vale para qualquer regime: o gate da emissão já concatena o bloco só a
//                          consumidor final, com o percentual do Simples OU a tabela/token do regime normal)
//   ibptEmpresaNasNotas  → ibpt_empresa_nas_notas (SÓ regime normal, e só com token configurado + 1ª consulta OK)
// Guarda: gerente da empresa (mesma do salvar token). Não altera cálculo — só liga/desliga a composição já existente.
export const PATCH = withAuth(async (req: NextRequest, { userId }) => {
  const body = (await req.json().catch(() => ({}))) as { companyId?: string; lei12741Ativo?: boolean; ibptEmpresaNasNotas?: boolean }
  const companyId = String(body.companyId ?? '')
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'ibpt_toggle_salvar', endpoint: 'ibpt-token' } })
  if (negado) return negado

  const updates: Record<string, boolean> = {}
  if (typeof body.lei12741Ativo === 'boolean') updates.lei12741_ativo = body.lei12741Ativo
  if (typeof body.ibptEmpresaNasNotas === 'boolean') {
    if (body.ibptEmpresaNasNotas === true) {
      const [{ data: cfg }, { data: cred }, { data: st }] = await Promise.all([
        supabaseAdmin.from('erp_fiscal_provider_config').select('regime_tributario, opcao_simples_nacional').eq('company_id', companyId).eq('ativo', true).limit(1).maybeSingle(),
        supabaseAdmin.from('erp_credencial').select('id').eq('provider', 'ibpt').eq('chave', 'token').eq('escopo', 'empresa').eq('company_id', companyId).eq('ativo', true).maybeSingle(),
        supabaseAdmin.from('erp_ibpt_empresa_status').select('ultima_consulta_ok').eq('company_id', companyId).maybeSingle(),
      ])
      if (ehSimplesConfig(cfg as { regime_tributario?: string | null; opcao_simples_nacional?: number | null } | null)) {
        return NextResponse.json({ ok: false, mensagem: 'Empresa do Simples Nacional usa o percentual aproximado cadastrado, não o token do IBPT.' }, { status: 400 })
      }
      if (!cred || !st?.ultima_consulta_ok) {
        return NextResponse.json({ ok: false, mensagem: 'Configure e teste o token do IBPT (com uma consulta OK) antes de usá-lo nas notas.' }, { status: 400 })
      }
    }
    updates.ibpt_empresa_nas_notas = body.ibptEmpresaNasNotas
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: false, mensagem: 'Nada para alterar.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('erp_fiscal_provider_config').update(updates).eq('company_id', companyId).eq('ativo', true)
  if (error) return NextResponse.json({ ok: false, mensagem: 'Não foi possível salvar a configuração agora. Tente de novo.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})
