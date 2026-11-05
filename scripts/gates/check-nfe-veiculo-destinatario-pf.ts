/**
 * Gate: NF-e de venda de veículo para PESSOA FÍSICA usa o nome do cadastro (nome_fantasia) quando a razão social está vazia
 * (cadastro de PF só tem "Nome / Apelido"). PJ continua exigindo razão social. Estático, sem rede nem banco.
 */
import { readFileSync } from 'node:fs'
import { nomeDestinatarioVenda } from '../../src/lib/fiscal/nomeDestinatario'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(nomeDestinatarioVenda(null, 'CLIENTE TESTE HOMOLOGACAO', true) === 'CLIENTE TESTE HOMOLOGACAO', 'PF sem razão social → usa nome_fantasia')
ok(nomeDestinatarioVenda('  ', ' Maria ', true) === 'Maria', 'PF com razão em branco → nome_fantasia aparado')
ok(nomeDestinatarioVenda('Maria Silva', 'Mari', true) === 'Maria Silva', 'PF com razão social → razão social vence')
ok(nomeDestinatarioVenda(null, 'Fantasia', false) === '', 'PJ sem razão social → vazio (validador segue exigindo)')
ok(nomeDestinatarioVenda('Empresa LTDA', 'Fantasia', false) === 'Empresa LTDA', 'PJ com razão social → razão social')
ok(nomeDestinatarioVenda(null, null, true) === '', 'PF sem nenhum nome → vazio (validador recusa)')

const b = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(b.includes('nomeDestinatarioVenda(cli.razao_social, cli.nome_fantasia, docLimpo.length === 11)'), 'builder da venda de veículo usa o nome do destinatário PF')
ok(/\.select\('razao_social, nome_fantasia, cnpj_cpf[^']*'\)\s*\.eq\('id', input\.vendaVeiculo\.clienteId\)/.test(b), 'builder seleciona nome_fantasia do cliente da venda')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfe-veiculo-destinatario-pf OK')
