/**
 * Gate (#3861, piloto FCR): NF-e avulsa com escolha de CFOP.
 * CFOP pela UF (5 no estado · 6 outra UF com aviso · 7 exterior), finalidade ≠ normal exige chave referenciada,
 * remessa no Simples exige CSOSN da operação (o do cadastro é o de venda, que viraria 101 com crédito, #2876),
 * CSOSN × CST pelo regime, botão "Emitir NF-e" na lista e "?" cadastrado para cada chave usada.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { escopoCfop, validarNFeAvulsa, cfopNoCatalogo, type CfopSaida } from '../../src/lib/fiscal/nfeAvulsa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const catalogo: CfopSaida[] = [
  { cfop: '5949', descricao: 'Outra saída', natureza_sugerida: 'Outras saídas', exige_referenciada: false },
  { cfop: '5915', descricao: 'Remessa p/ conserto', natureza_sugerida: 'Remessa para conserto', exige_referenciada: false },
  { cfop: '5916', descricao: 'Retorno de conserto', natureza_sugerida: 'Retorno de conserto', exige_referenciada: true },
  { cfop: '5102', descricao: 'Venda', natureza_sugerida: 'Venda de mercadoria', exige_referenciada: false },
  { cfop: '7949', descricao: 'Outra saída exterior', natureza_sugerida: 'Outras saídas', exige_referenciada: false },
]
const chave = '4'.repeat(44)

ok(escopoCfop('5949', 'SC', 'SC').cfop === '5949' && !escopoCfop('5949', 'SC', 'SC').aviso, 'SC → SC: 5.949 fica, sem aviso')
const fora = escopoCfop('5949', 'SC', 'PR')
ok(fora.cfop === '6949' && !!fora.aviso && fora.aviso.includes('6.949'), 'SC → PR: 5.949 vira 6.949 COM aviso')
const volta = escopoCfop('6915', 'SC', 'SC')
ok(volta.cfop === '5915' && !!volta.aviso, 'SC → SC: 6.915 volta a 5.915 com aviso')
ok(!!escopoCfop('5949', 'SC', 'EX').erro && !escopoCfop('7949', 'SC', 'EX').erro, 'exterior exige 7.xxx')
ok(!!escopoCfop('7949', 'SC', 'SC').erro, '7.xxx com destinatário no Brasil é recusado')
ok(!!escopoCfop('5949', 'SC', undefined).erro, 'destinatário sem UF é recusado (não chuta o escopo)')
ok(!!escopoCfop('1102', 'SC', 'SC').erro && !!escopoCfop('59', 'SC', 'SC').erro, 'CFOP de entrada ou incompleto é recusado')
ok(cfopNoCatalogo('6916', catalogo)?.cfop === '5916', 'catálogo: 6.xxx acha o espelho 5.xxx')

const base = { cfop: '5915', ufEmitente: 'SC', ufDestino: 'SC', finalidade: 'normal' as const, simples: true, icmsCodigo: '400', catalogo }
const r0 = validarNFeAvulsa(base)
ok(r0.erros.length === 0 && r0.cfop === '5915', 'remessa p/ conserto no Simples com CSOSN 400: sem erro')
ok(validarNFeAvulsa({ ...base, icmsCodigo: undefined }).erros.some((e) => e.includes('CSOSN')), 'remessa no Simples sem CSOSN da operação: recusa')
ok(validarNFeAvulsa({ ...base, cfop: '5102', icmsCodigo: undefined }).erros.length === 0, 'venda (5.102) no Simples pode usar o CSOSN do cadastro')
ok(validarNFeAvulsa({ ...base, icmsCodigo: '41' }).erros.length === 1, 'Simples com CST 41: recusa (usa CSOSN)')
ok(validarNFeAvulsa({ ...base, simples: false, icmsCodigo: '400' }).erros.length === 1 && validarNFeAvulsa({ ...base, simples: false, icmsCodigo: '41' }).erros.length === 0, 'regime normal: CST 41 sim, CSOSN 400 não')
ok(validarNFeAvulsa({ ...base, finalidade: 'devolucao' }).erros.some((e) => e.includes('44')), 'finalidade devolução sem chave: recusa')
ok(validarNFeAvulsa({ ...base, finalidade: 'complementar', chaveReferenciada: chave }).erros.length === 0, 'complementar com chave de 44 dígitos: ok')
const ret = validarNFeAvulsa({ ...base, cfop: '5916' })
ok(ret.erros.length === 0 && ret.avisos.some((a) => a.includes('retorno')), 'retorno de conserto sem chave: só aviso')
const pr = validarNFeAvulsa({ ...base, ufDestino: 'PR', itensCfop: [undefined, '5949'] })
ok(pr.cfop === '6915' && pr.itensCfop[0] === '6915' && pr.itensCfop[1] === '6949' && pr.avisos.length >= 2, 'outra UF: nota e itens viram 6.xxx com aviso')
ok(validarNFeAvulsa({ ...base, cfop: '5999' }).avisos.some((a) => a.includes('fora do catálogo')), 'CFOP fora do catálogo: aviso')

const rota = readFileSync('src/app/api/fiscal/nfe/remessa/route.ts', 'utf8')
ok(/validarNFeAvulsa\(/.test(rota) && /avulsa\.erros\.length > 0/.test(rota), 'rota valida com a mesma regra da tela antes de montar a nota')
ok(/cfopOverride: avulsa\.itensCfop\[i\] \?\? avulsa\.cfop/.test(rota), 'rota emite com o CFOP ajustado pela UF')
ok(/p_erp_receber_id: null/.test(rota), 'NF-e avulsa não gera título (etapa 1)')

const lista = readFileSync('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', 'utf8')
ok(/href="\/dashboard\/fiscal\/nfe\/remessa"[^>]*data-testid="nfe-emitir-avulsa"/.test(lista), 'botão "Emitir NF-e" em Notas emitidas')

const mig = readFileSync('supabase/migrations/20261027010020_fiscal_nfe_avulsa_cfop.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_fiscal_cfop_saida FROM anon, public/.test(mig), 'catálogo com RLS e sem acesso anônimo')
for (const cod of ['5915', '5916', '5908', '5912', '5949', '5910']) ok(mig.includes(`('${cod}'`), `catálogo traz o CFOP ${cod}`)
const tela = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')
// chaves acrescentadas depois (ex.: "Consultar agora", #3861); acha pelo sufixo, a fila pode renumerar a versão
const migAjuda = readdirSync('supabase/migrations').filter((f) => f.endsWith('_ajuda_nfe_avulsa_consultar.sql'))
  .map((f) => readFileSync('supabase/migrations/' + f, 'utf8')).join('\n')
for (const c of new Set([...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g), ...lista.matchAll(/<AjudaCampo chave="(fiscal\.nfe\.[^"]+)"/g)].map((m) => m[1]))) {
  ok(mig.includes(`'${c}'`) || migAjuda.includes(`'${c}'`), `"?" cadastrado: ${c}`)
}

if (falhas) { console.error(`\n[check-nfe-avulsa-cfop] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-avulsa-cfop] NF-e avulsa com CFOP conferida.')
