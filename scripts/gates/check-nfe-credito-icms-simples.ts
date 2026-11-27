/**
 * Gate (#2876): crédito de ICMS do Simples na NF-e (CSOSN 101 + pCredSN/vCredICMSSN + texto do art. 23 da LC 123).
 * Travas do CEO: só emitente do Simples com alíquota cadastrada · só destinatário contribuinte que não é consumidor
 * final · nota normal (devolução fora) · sem alíquota = nada muda.
 */
import { readFileSync, readdirSync } from 'node:fs'
import {
  aplicaCreditoSN, csosnDoItem, empresaComCreditoSN, faltaCreditoCompetenciaSN, observacoesComSimples,
  valorCreditoSN, textoCreditoSN, TEXTO_SIMPLES, type CondicaoCreditoSN,
} from '../../src/lib/fiscal/creditoIcmsSimples'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const base: CondicaoCreditoSN = { ehSimples: true, aliquota: 3.8, indIEDest: 1, consumidorFinal: false, finalidade: 'normal' }
ok(aplicaCreditoSN(base), 'Simples + alíquota + contribuinte revenda → crédito')
ok(!aplicaCreditoSN({ ...base, consumidorFinal: true }), 'consumidor final → sem crédito')
ok(!aplicaCreditoSN({ ...base, indIEDest: 9 }) && !aplicaCreditoSN({ ...base, indIEDest: 2 }), 'não contribuinte / isento → sem crédito')
ok(!aplicaCreditoSN({ ...base, ehSimples: false }), 'emitente fora do Simples → sem crédito')
ok(!aplicaCreditoSN({ ...base, aliquota: null }) && !aplicaCreditoSN({ ...base, aliquota: 0 }) && !aplicaCreditoSN({ ...base, aliquota: 12 }), 'sem alíquota válida → sem crédito')
ok(!aplicaCreditoSN({ ...base, finalidade: 'devolucao' }), 'devolução → sem crédito (regra própria)')

ok(csosnDoItem('102', base) === '101' && csosnDoItem('101', base) === '101', 'contribuinte: 101/102 do cadastro saem 101')
ok(csosnDoItem('101', { ...base, consumidorFinal: true }) === '102' && csosnDoItem('102', { ...base, consumidorFinal: true }) === '102', 'consumidor final: sai 102')
ok(csosnDoItem('500', base) === '500' && csosnDoItem('900', base) === '900' && csosnDoItem(undefined, base) === undefined, 'outros CSOSN (ST 500, 900, vazio) não mudam')
ok(csosnDoItem('101', { ...base, aliquota: null }) === '101' && csosnDoItem('102', { ...base, ehSimples: false }) === '102', 'empresa sem alíquota: CSOSN do cadastro intocado (nada muda)')
ok(!empresaComCreditoSN({ ehSimples: true, aliquota: null }) && empresaComCreditoSN({ ehSimples: true, aliquota: 3.8 }), 'opt-in pela alíquota cadastrada (compat: sem o flag, deriva da alíquota)')

// #11424 · crédito MENSAL por competência: opt-in (flag) separado do valor do mês (aliquota).
ok(empresaComCreditoSN({ ehSimples: true, aliquota: null, optouCredito: true }), 'opt-in explícito: optou vale mesmo sem crédito do mês')
ok(!empresaComCreditoSN({ ehSimples: true, aliquota: 3.8, optouCredito: false }), 'opt-out explícito: não optou vence a alíquota cadastrada')
ok(csosnDoItem('101', { ...base, optouCredito: true, aliquota: null }) === '102' && csosnDoItem('102', { ...base, optouCredito: true, aliquota: null }) === '102', 'optou mas sem crédito da competência → 102 (nunca usa valor de outro mês)')
ok(csosnDoItem('101', { ...base, optouCredito: true, aliquota: 3.8 }) === '101', 'optou + crédito do mês + contribuinte → 101')
ok(faltaCreditoCompetenciaSN({ ...base, optouCredito: true, aliquota: null }), 'alerta: optou, contribuinte, sem crédito da competência')
ok(!faltaCreditoCompetenciaSN({ ...base, optouCredito: true, aliquota: 3.8 }), 'sem alerta: crédito do mês lançado')
ok(!faltaCreditoCompetenciaSN({ ...base, optouCredito: true, aliquota: null, consumidorFinal: true }), 'sem alerta: consumidor final (nota 102, não carregaria crédito)')
ok(!faltaCreditoCompetenciaSN({ ...base, optouCredito: true, aliquota: null, indIEDest: 9 }), 'sem alerta: não contribuinte')
ok(!faltaCreditoCompetenciaSN({ ...base, aliquota: null }) && !faltaCreditoCompetenciaSN({ ...base, optouCredito: false, aliquota: null }), 'sem alerta: empresa não optou pelo crédito')

ok(valorCreditoSN(1000, 3.8) === 38 && valorCreditoSN(123.45, 3.8) === 4.69 && valorCreditoSN(-5, 3.8) === 0, 'vCredICMSSN = valor do item × alíquota, 2 casas')
ok(textoCreditoSN(38, 3.8).includes('R$ 38,00') && textoCreditoSN(38, 3.8).includes('3,80%') && /ART\. 23 DA LEI COMPLEMENTAR Nº 123\/2006/.test(textoCreditoSN(38, 3.8)), 'texto do crédito com valor e alíquota em pt-BR')
const obs = observacoesComSimples('Pedido 55', 38, 3.8)
ok(obs.startsWith('Pedido 55') && obs.includes(TEXTO_SIMPLES) && obs.includes('R$ 38,00'), 'observações: mantém o que havia + Simples + crédito')
ok(!observacoesComSimples(undefined, null, 3.8).includes('APROVEITAMENTO') && observacoesComSimples(undefined, null, 3.8) === TEXTO_SIMPLES, 'consumidor final: só a frase do Simples')
ok(observacoesComSimples(obs, 38, 3.8) === obs, 'não duplica as frases')

const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const focus = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
ok(/csosnDoItem\(cstIcmsProd, condCreditoSN\)/.test(builder), 'builder aplica a regra no CSOSN do item (fora da devolução)')
ok(/it\.icmsOverride\s*\n?\s*\?\s*\{\s*\n\s*cst: it\.icmsOverride\.csosn/.test(builder), 'devolução (icmsOverride) segue intocada')
ok(/observacoes: ehSimples\s*\n\s*\? observacoesComSimples\(/.test(builder), 'frase do Simples em TODA nota do Simples, com ou sem alíquota (ajuste 20/10, NF-e nº 2 FCR)')
ok(/aliqCreditoSN \?\? 0,/.test(builder) && observacoesComSimples(undefined, null, 0) === TEXTO_SIMPLES, 'sem alíquota: só a frase do Simples, nunca a do crédito')
ok(/select\('serie_nfe_padrao, aliquota_credito_icms_sn'\)/.test(builder), 'alíquota vem da configuração fiscal da empresa')
ok(/icms_aliquota_credito_simples: item\.icms\.creditoSN\.aliquota/.test(focus) && /icms_valor_credito_simples: item\.icms\.creditoSN\.valor/.test(focus), 'payload Focus: pCredSN e vCredICMSSN')

// #11424 · a emissão passa a LER o crédito da COMPETÊNCIA da nota; opt-in (flag) separado do valor do mês; alerta.
ok(/from\('erp_fiscal_credito_sn'\)/.test(builder), 'builder lê o crédito do MÊS da nota (erp_fiscal_credito_sn)')
ok(/optouCredito:/.test(builder), 'builder separa o opt-in (flag) do valor da competência')
// #11424 (revisão) · empresa que optou NUNCA cai pra 102 em silêncio: sem o mês lançado, usa o último valor conhecido.
ok(/creditoMesFaltante/.test(builder) && /\.lte\('competencia'/.test(builder), 'builder: fallback ao último valor conhecido + creditoMesFaltante (não cai pra 102 em silêncio)')
const rotaEmitir = readFileSync('src/app/api/fiscal/nfe/emitir/route.ts', 'utf8')
ok(/avisoCreditoSN/.test(rotaEmitir), 'emissão devolve o alerta do crédito (prévia e resposta final)')
ok(/credito_sn_bloqueia_sem_mes/.test(rotaEmitir), 'rota: opção (b) — bloqueia quando o perfil pede e o mês não foi lançado')
const modalNfe = readFileSync('src/components/fiscal/NFePreviewModal.tsx', 'utf8')
ok(/avisoCreditoSN/.test(modalNfe), 'tela de emissão: alerta do crédito VISÍVEL (não só nos dados da prévia)')
// #11424 (revisão) · os DOIS pontos reais de emissão (comércio e oficina) leem a prévia inline e precisam
// SURFAR o aviso — antes liam só informacoesComplementares/limite e o alerta ficava invisível.
const nfeCard = readFileSync('src/components/comum/NFeCard.tsx', 'utf8')
const osBtn = readFileSync('src/components/comum/EmitirNFeOSButton.tsx', 'utf8')
ok(/previa\.avisoCreditoSN/.test(nfeCard) && /nfe-pedido-aviso-credito-sn/.test(nfeCard), 'tela comércio (NFeCard): faixa do crédito VISÍVEL acima do Emitir')
ok(/previa\.avisoCreditoSN/.test(osBtn) && /os-nfe-aviso-credito-sn/.test(osBtn), 'tela oficina (EmitirNFeOSButton): faixa do crédito VISÍVEL acima do Emitir')

const mig = readFileSync('supabase/migrations/20261017022020_fiscal_credito_icms_simples.sql', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS aliquota_credito_icms_sn numeric/.test(mig) && !/DEFAULT\s+\d/.test(mig.split('aliquota_credito_icms_sn numeric')[1]?.slice(0, 20) ?? ''), 'coluna do opt-in nula por padrão (ninguém muda sem cadastrar)')
ok(/fn__guarda_empresa\(p_company_id\)/.test(mig) && /fn_pagar_usuario_master\(p_company_id\)/.test(mig), 'gravação do opt-in com guarda de empresa e de Master')
ok(/REVOKE EXECUTE ON FUNCTION public\.fn_fiscal_credito_icms_sn_salvar\(uuid, numeric\) FROM anon, public/.test(mig), 'função do opt-in sem acesso anônimo')

// #11424 · migração do crédito por competência — achada por SUFIXO (robusta à renumeração da fila de merge).
const migCompNome = readdirSync('supabase/migrations').find((f) => /_fiscal_credito_icms_sn_competencia\.sql$/.test(f))
const migComp = migCompNome ? readFileSync(`supabase/migrations/${migCompNome}`, 'utf8') : ''
ok(/CREATE TABLE IF NOT EXISTS public\.erp_fiscal_credito_sn/.test(migComp) && /UNIQUE \(company_id, competencia\)/.test(migComp), 'tabela do crédito por competência (uma linha por empresa × mês)')
ok(/ENABLE ROW LEVEL SECURITY/.test(migComp) && /REVOKE ALL ON public\.erp_fiscal_credito_sn FROM anon/.test(migComp), 'RLS ligada e sem acesso anônimo')
ok(/fn__guarda_empresa\(p_company_id\)/.test(migComp) && /fn_pagar_usuario_master\(p_company_id\)/.test(migComp), 'gravação mensal com guarda de empresa e de Master')
ok(/REVOKE EXECUTE ON FUNCTION public\.fn_fiscal_credito_sn_salvar\(uuid, date, numeric\) FROM anon, public/.test(migComp), 'função mensal sem acesso anônimo')
ok(/ADD COLUMN IF NOT EXISTS credito_sn_bloqueia_sem_mes boolean NOT NULL DEFAULT false/.test(migComp), 'migração: flag de bloqueio (opção b), default false')
ok(/INSERT INTO public\.erp_fiscal_credito_sn[\s\S]*FROM public\.erp_fiscal_provider_config[\s\S]*aliquota_credito_icms_sn[\s\S]*ON CONFLICT \(company_id, competencia\) DO NOTHING/.test(migComp), 'migração: SEED idempotente preserva o status quo (flat>0 → competência corrente)')
// #11424 (revisão) · DATA FIXA: o seed nunca copia o crédito para outro mês (a regra mensal vale a partir de 12/2026).
ok(/DATE '2026-11-01'|competencia\s*=\s*'2026-11-01'/.test(migComp) && !/date_trunc\('month',\s*timezone\([^)]*now\(\)\)/.test(migComp), 'migração: SEED com competência FIXA 2026-11-01 (sem now(), nunca copia para outro mês)')

const card = readFileSync('src/components/fiscal/ConfigFiscalEditCard.tsx', 'utf8')
for (const c of [...card.matchAll(/<AjudaCampo chave="([^"]+credito[^"]*)"/g)].map((m) => m[1])) ok(mig.includes(`'${c}'`) || migComp.includes(`'${c}'`), `"?" cadastrado: ${c}`)

if (falhas) { console.error(`\n[check-nfe-credito-icms-simples] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-credito-icms-simples] crédito de ICMS do Simples conferido.')
