// Gate (Canal PS · Rodrigo 21/10 · "Cancelar boleto"): cancela SÓ o boleto, o título permanece ativo. Regras puras + travas da rota. Sem rede.
import { readFileSync } from 'node:fs'
import { boletoElegivelParaCancelar, camposAposCancelarBoleto, suportaCancelarBoleto, motivoSemSuporte } from '../../src/lib/banco/cancelarBoleto'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) elegibilidade: só boleto registrado de título em aberto
for (const st of ['aberto', 'vencido', 'parcial']) ok(boletoElegivelParaCancelar({ boleto_status: 'registrado', boleto_nosso_numero: '123', status: st }), `boleto registrado + título ${st}: oferece cancelar`)
ok(!boletoElegivelParaCancelar({ boleto_status: 'registrado', boleto_nosso_numero: '123', status: 'pago' }), 'título pago: não oferece')
ok(!boletoElegivelParaCancelar({ boleto_status: 'liquidado', boleto_nosso_numero: '123', status: 'aberto' }), 'boleto liquidado: não oferece')
ok(!boletoElegivelParaCancelar({ boleto_status: 'cancelado', boleto_nosso_numero: null, status: 'aberto' }), 'boleto já cancelado: não oferece')
ok(!boletoElegivelParaCancelar({ boleto_status: 'registrado', boleto_nosso_numero: null, status: 'aberto' }), 'sem nosso número: não oferece')

// 2) o título permanece: a atualização só toca colunas boleto_*
const campos = camposAposCancelarBoleto()
ok(Object.keys(campos).every((k) => k.startsWith('boleto_')), 'atualização só toca colunas boleto_* (status/valor/vencimento do título intactos)')
ok(campos.boleto_status === 'cancelado' && campos.boleto_linha_digitavel === null && campos.boleto_nosso_numero === null, 'boleto fica "cancelado" e sem linha digitável/nosso número')

// 3) provedores: Sicoob suporta; os demais avisam em vez de falhar em silêncio
ok(suportaCancelarBoleto('sicoob') && !suportaCancelarBoleto('sicredi') && !suportaCancelarBoleto('bradesco'), 'só o Sicoob tem baixa por API; os demais não')
ok(/ainda não está disponível para o Sicredi/.test(motivoSemSuporte('Sicredi')), 'aviso claro para banco sem suporte')

// 4) a rota: sessão de usuário, aceite do banco antes de marcar, não toca o título, audita
const rota = readFileSync('src/app/api/banco/sicoob/cancelar-boleto/route.ts', 'utf8')
ok(!/x-ping-secret/.test(rota) && /auth\.getUser\(\)/.test(rota), 'rota exige usuário logado (sem segredo de teste)')
ok(rota.indexOf('baixarBoleto(') < rota.indexOf('camposAposCancelarBoleto()') && /if \(!baixa\.ok\)[\s\S]{0,400}return NextResponse/.test(rota), 'só marca cancelado depois do aceite do banco')
ok(!/\.delete\(\)|deleted_at|status: 'cancelado'/.test(rota.replace(/boleto_status: 'cancelado'/g, '')), 'a rota não exclui nem cancela o título')
ok(/BOLETO_CANCELADO/.test(rota) && /user_id: user\.id/.test(rota) && /retorno_banco/.test(rota), 'auditoria: quem, quando e retorno do banco')
const tela = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')
ok(/window\.confirm\([\s\S]{0,200}Cancelar o boleto/.test(tela) && /receber\.boleto\.cancelar/.test(tela), 'tela pede confirmação e tem o "?" (RD-95)')
const mig = readFileSync('supabase/migrations/20261021140030_receber_cancelar_boleto_ajuda.sql', 'utf8')
ok(/'receber\.boleto\.cancelar'/.test(mig), 'chave de ajuda existe na migration')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-cancelar-boleto: OK')
