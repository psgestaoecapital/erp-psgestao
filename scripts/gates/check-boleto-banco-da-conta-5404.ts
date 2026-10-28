// Gate (chamado #5404 · boleto pelo banco da conta do título). Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const lib = readFileSync('src/lib/banco/providersBoleto.ts', 'utf8')
ok(/export function rotaBoletoDaConta/.test(lib) && /c\.banco_conta_id === conta\.id/.test(lib), 'rota pela configuração ligada à conta')
ok(/'001': 'bb'/.test(lib) && /'748': 'sicredi'/.test(lib), 'fallback pelo banco_codigo da conta')
ok(/não tem boleto ativado/.test(lib), 'mensagem clara quando a conta não tem boleto (sem cair em outro banco)')

const tela = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(tela.includes('rotaBoletoDaConta(') && tela.includes('boleto-sem-banco-conta'), 'tela de Receber usa o banco da conta do título')

const mig = readFileSync('supabase/migrations/20261029211020_fcpisos_boleto_banco_da_conta_5404.sql', 'utf8')
ok(/b202b50f-37cb-462e-accf-126869de49f0/.test(mig) && !/DELETE|TRUNCATE/i.test(mig), 'migration só da FC Pisos, sem apagar')

if (falhas) { console.error(`check-boleto-banco-da-conta-5404: ${falhas} falha(s)`); process.exit(1) }
console.log('check-boleto-banco-da-conta-5404: ok')
