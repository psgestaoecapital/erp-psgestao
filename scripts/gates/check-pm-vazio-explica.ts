// Gate (Pdois/Marciana 07/10 · RD-51 + RD-71): telas de jobs da P&M nunca mostram vazio calado. Sem rede.
//  (1) a regra pura descreve, em palavras, o filtro guardado que escondia o job da Marciana (atalho + responsável);
//  (2) Pauta: faixa "Filtro aplicado" com "Mostrar todos", vazio por filtro explicado, erro na contagem ≠ "pauta vazia";
//  (3) Pauta, Meus trabalhos e Painel de Jobs: empresa não resolvida diz o motivo (carregando / sem empresa / escolher);
//  (4) Meus trabalhos sem job seu diz quantos a empresa tem; Painel diz quando o filtro esconde todos.
import { readFileSync } from 'node:fs'
import { descreverFiltros } from '../../src/lib/pm/pauta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

// (1) o caso real da Marciana
const EDNEY = '6fac646a-674f-407e-b09f-edf8ad4e1386'
const d = descreverFiltros({ atalho: 'atrasados', responsaveis: [EDNEY] }, { responsaveis: { [EDNEY]: 'Edney Prigol' } })
ok(d.join(' | ') === 'Atalho: Atrasados | Responsável: Edney Prigol', `filtro da Marciana em palavras (${d.join(' | ')})`)
ok(descreverFiltros({}, {}).length === 0 && descreverFiltros({ titulo: '  ' }).length === 0, 'sem filtro → nada a descrever')
ok(descreverFiltros({ responsaveis: ['x'] }, {})[0] === 'Responsável: item não encontrado', 'id sem nome não some calado')
ok(descreverFiltros({ data_de: '2026-10-01', data_ate: '2026-10-31' }, {})[0] === 'Prazo de 01/10/2026 até 31/10/2026', 'período em data brasileira')
ok(descreverFiltros({}, {}, 'Em produção').join() === 'Aba: Em produção', 'aba diferente de "Todas" também é filtro')

// (2) Pauta
const pauta = ler('src/app/dashboard/pm/pauta/page.tsx')
ok(/data-testid="pauta-filtro-ativo"/.test(pauta) && /data-testid="pauta-mostrar-todos"/.test(pauta) && /guardado da sua última visita/.test(pauta),
  'Pauta: faixa do filtro em uso, com origem (última visita) e "Mostrar todos"')
ok(/data-testid="pauta-filtro-escondendo"/.test(pauta) && /A pauta tem jobs, mas nenhum passa no filtro aplicado/.test(pauta) && /data-testid="pauta-vazia-mostrar-todos"/.test(pauta),
  'Pauta: vazio por filtro explicado, com botão')
ok(/setTemJob\(eJobs \? null :/.test(pauta) && !/Nenhum job com esse filtro\./.test(pauta), 'Pauta: erro na contagem não vira "pauta vazia"; a linha calada saiu')
ok(/function mostrarTodos\(\)[\s\S]*?setAba\("todas"\)[\s\S]*?salvarPreferencia\(\{\}, agrup, "todas"\)/.test(pauta), '"Mostrar todos" limpa filtro e aba e guarda assim')

// (3) empresa não resolvida
const comp = ler('src/components/pm/EmpresaNaoResolvida.tsx')
ok(/pm-empresa-carregando/.test(comp) && /pm-sem-empresa/.test(comp) && /pm-escolha-empresa/.test(comp), 'componente distingue carregando / sem empresa / escolher')
for (const [p, n] of [['src/app/dashboard/pm/pauta/page.tsx', 'Pauta'], ['src/app/dashboard/pm/meus-trabalhos/page.tsx', 'Meus trabalhos'], ['src/app/dashboard/pm/painel-jobs/page.tsx', 'Painel de Jobs']] as const) {
  const s = ler(p)
  ok(/if \(!empresa\) return <EmpresaNaoResolvida carregando=\{carregandoEmpresa\} temEmpresa=\{companies\.length > 0\}/.test(s), `${n}: empresa não resolvida diz o motivo`)
}

// (4) Meus trabalhos e Painel
const mt = ler('src/app/dashboard/pm/meus-trabalhos/page.tsx')
ok(/data-testid="mt-vazio"/.test(mt) && /fn_pauta_contadores/.test(mt) && /ver na Pauta/.test(mt), 'Meus trabalhos: sem job seu, diz quantos a empresa tem e leva à Pauta')
const pj = ler('src/app/dashboard/pm/painel-jobs/page.tsx')
ok(/data-testid="painel-sem-jobs"/.test(pj) && /data-testid="painel-filtro-escondendo"/.test(pj) && /data-testid="painel-limpar-filtro"/.test(pj), 'Painel: sem jobs × filtro escondendo todos, com botão')

if (falhas) { console.error(`\ncheck-pm-vazio-explica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M sem vazio calado: ok')
