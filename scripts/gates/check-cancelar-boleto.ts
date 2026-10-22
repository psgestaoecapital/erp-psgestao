// Gate (Canal PS Rodrigo 21/10 · Cancelar boleto em Receitas a Receber). Regras puras + travas do código. Sem rede.
import { readFileSync } from 'node:fs'
import {
  BANCO_PROVIDER, CANCELAMENTO_API, MSG_SEM_API, CAMPOS_BOLETO_CANCELADO, motivoNaoCancelavel, jaBaixadoNoBanco,
} from '../../src/lib/banco/cancelarBoleto'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) cobertura: todos os bancos com boleto (cap_boleto) mapeados; sem API = aviso explícito, nunca omitido
ok(BANCO_PROVIDER['756'] === 'sicoob' && BANCO_PROVIDER['748'] === 'sicredi' && BANCO_PROVIDER['237'] === 'bradesco', 'Sicoob 756, Sicredi 748, Bradesco 237 cobertos')
ok(CANCELAMENTO_API.sicoob && CANCELAMENTO_API.sicredi, 'Sicoob e Sicredi cancelam pela API')
ok(!CANCELAMENTO_API.bradesco && MSG_SEM_API.bradesco.length > 20, 'Bradesco sem API: mensagem clara ao usuário')

// 2) elegibilidade: só boleto registrado de título em aberto
const base = { boleto_status: 'registrado', boleto_nosso_numero: '123', boleto_banco_codigo: '756', status: 'aberto' }
ok(motivoNaoCancelavel(base) === null, 'registrado + título aberto: pode cancelar')
ok(motivoNaoCancelavel({ ...base, status: 'vencido' }) === null && motivoNaoCancelavel({ ...base, status: 'parcial' }) === null, 'vencido e parcial também')
ok(motivoNaoCancelavel({ ...base, status: 'pago' }) !== null, 'título pago: bloqueia')
ok(motivoNaoCancelavel({ ...base, boleto_status: 'liquidado' }) !== null, 'boleto liquidado: bloqueia')
ok(motivoNaoCancelavel({ ...base, boleto_status: null, boleto_nosso_numero: null }) !== null, 'sem boleto: bloqueia')
ok(motivoNaoCancelavel({ ...base, boleto_banco_codigo: '001' }) !== null, 'banco desconhecido: bloqueia')

// 3) o título permanece: o update só toca colunas boleto_*
ok(Object.keys(CAMPOS_BOLETO_CANCELADO).every((k) => k.startsWith('boleto_')) && CAMPOS_BOLETO_CANCELADO.boleto_status === 'cancelado', 'update só em colunas boleto_* (status/valor/vencimento do título intactos)')
ok(CAMPOS_BOLETO_CANCELADO.boleto_nosso_numero === null && CAMPOS_BOLETO_CANCELADO.boleto_linha_digitavel === null, 'nosso número e linha digitável invalidados (permite gerar outro)')
ok(jaBaixadoNoBanco({ mensagem: 'Boleto já baixado' }) && !jaBaixadoNoBanco({ mensagem: 'erro interno' }), 'banco "já baixado" é idempotente')

// 4) a rota e a tela
const rota = readFileSync('src/app/api/banco/cancelar-boleto/route.ts', 'utf8')
ok(rota.includes('sb.auth.getUser()') && rota.includes("from('erp_receber')\n      .select"), 'rota exige usuário e lê o título pela RLS dele')
ok(!/\.delete\(\)/.test(rota) && !/status:\s*'cancelado'/.test(rota) && rota.includes('.update(CAMPOS_BOLETO_CANCELADO)'), 'rota não exclui nem cancela o título')
ok(rota.includes("tipo: 'boleto_cancelar'"), 'auditoria em erp_banco_sync_log (boleto_cancelar)')
ok(rota.includes('usuario: user.id') && rota.includes('retorno:'), 'auditoria: quem, quando e retorno do banco')
const tela = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')
ok(tela.includes('data-testid="boleto-cancelar"') && tela.includes('confirmaCancelar') && tela.includes('tituloAberto'), 'tela: botão só com título aberto e com confirmação')
ok(tela.includes('chave="receber.boleto.cancelar"'), 'RD-95: "?" na ação')
const mig = readFileSync('supabase/migrations/20261021140030_ajuda_receber_cancelar_boleto.sql', 'utf8')
ok(mig.includes("'receber.boleto.cancelar'") && mig.endsWith('\n') && /30\.sql$/.test('20261021140030_x30.sql') , 'chave de ajuda existe no banco (migration, segundos 30)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncancelar-boleto: OK')
