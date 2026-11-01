// Gate (HB3 fatia 9 · próximas semanas do cronograma). Sem rede. Prova o recorte do período (atrasada, começa, termina,
// em andamento, fora da janela, concluída) e a ordem, e confere que a tela mostra o quadro com os "?" semeados.
import { readFileSync } from 'node:fs'
import { lookahead } from '../../src/lib/hub/lookahead'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const hoje = '2026-03-10'
const t = [
  { id: 'fora', nome: 'Pintura', inicio: '2026-04-01', fim: '2026-04-10', percentual: 0 },
  { id: 'comeca', nome: 'Alvenaria', inicio: '2026-03-15', fim: '2026-03-30', percentual: 0 },
  { id: 'termina', nome: 'Estrutura', inicio: '2026-03-01', fim: '2026-03-20', percentual: 60 },
  { id: 'atrasada', nome: 'Fundação', inicio: '2026-02-01', fim: '2026-03-07', percentual: 90 },
  { id: 'andamento', nome: 'Elétrica', inicio: '2026-03-01', fim: '2026-04-30', percentual: 10 },
  { id: 'pronta', nome: 'Limpeza', inicio: '2026-03-01', fim: '2026-03-05', percentual: 100 },
]
const r = lookahead(t, hoje, 14)
const sit = new Map(r.itens.map((i) => [i.tarefa.id, i.situacao]))
ok(r.ate === '2026-03-23', '2 semanas = hoje até hoje + 13 dias')
ok(sit.get('atrasada') === 'atrasada' && r.itens[0].tarefa.id === 'atrasada' && r.itens[0].diasAtraso === 3, 'atrasada vem primeiro, com os dias de atraso')
ok(sit.get('comeca') === 'comeca' && sit.get('termina') === 'termina' && sit.get('andamento') === 'andamento', 'começa / termina / em andamento')
ok(!sit.has('fora') && !sit.has('pronta'), 'fora do período e concluída não aparecem')
ok(r.itens.map((i) => i.tarefa.id).join(',') === 'atrasada,termina,andamento,comeca', 'ordem: atrasadas, depois por início')
const r1 = lookahead(t, hoje, 7)
ok(r1.ate === '2026-03-16' && r1.itens.some((i) => i.tarefa.id === 'comeca' && i.situacao === 'comeca') && r1.itens.find((i) => i.tarefa.id === 'termina')?.situacao === 'andamento', '1 semana: recorte menor muda a situação')
ok(lookahead([], hoje).itens.length === 0, 'sem tarefas = quadro vazio')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261024200000_hb3_cronograma_fatia9_lookahead_ajuda.sql', 'utf8')
ok(tela.includes("from '@/lib/hub/lookahead'") && tela.includes('lookahead('), 'a tela usa a lib do lookahead')
for (const k of ['projetos.cronograma.lookahead', 'projetos.cronograma.lookahead_periodo']) {
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
}
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) no lookahead`); process.exit(1) }
console.log('\nPróximas semanas do cronograma: ok')
