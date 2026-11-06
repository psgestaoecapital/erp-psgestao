// Gate (HB0, auditor F15 em /dashboard/projetos/propostas · "Proposta → Obra visível") — a lista mostra a obra que nasceu
// de cada proposta, pelos dois lados do vínculo (erp_orcamentos.obra_id ou projetos_obras.orcamento_id). Regra única em
// obraPorProposta (src/lib/hub/propostas.ts); proposta ganha sem obra é sinalizada, nunca escondida. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { ganhasComObra, obraPorProposta } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const props = [
  { id: 'A', status: 'aprovado', obra_id: 'o1', eh_obra: true }, // vínculo pela proposta
  { id: 'B', status: 'convertido', obra_id: null, eh_obra: null }, // vínculo só pela obra (orcamento_id)
  { id: 'C', status: 'aprovado', obra_id: null, eh_obra: true }, // ganha sem obra
  { id: 'D', status: 'aprovado', obra_id: null, eh_obra: false }, // venda sem obra (opt-out)
  { id: 'E', status: 'enviado', obra_id: null, eh_obra: true }, // em aberto
  { id: 'F', status: 'aprovado', obra_id: 'o9', eh_obra: true }, // obra_id fora da lista lida: continua ligada
]
const s = obraPorProposta(props, [
  { id: 'o1', numero: ' OB-1 ', nome: ' Galpão ', status: 'em_andamento', orcamento_id: 'A' },
  { id: 'o2', numero: 'OB-2', nome: null, status: 'pausada', orcamento_id: 'B' },
  { id: 'o3', numero: 'OB-3', nome: 'x', status: 'concluida', orcamento_id: 'Z' },
])
ok(s.A?.tipo === 'obra' && s.A.obra.numero === 'OB-1' && s.A.obra.nome === 'Galpão', 'obra pelo obra_id, número/nome aparados')
ok(s.B?.tipo === 'obra' && s.B.obra.id === 'o2' && s.B.obra.status === 'pausada', 'obra pelo orcamento_id quando a proposta não tem obra_id')
ok(s.C?.tipo === 'sem_obra', 'ganha sem obra é sinalizada')
ok(s.D?.tipo === 'nao_e_obra', 'eh_obra=false = não é obra (não acusa falta)')
ok(s.E?.tipo === 'aberta', 'proposta em aberto: vira obra ao aprovar')
ok(s.F?.tipo === 'obra' && s.F.obra.id === 'o9', 'obra_id sem a linha da obra continua com link, sem inventar número')
const g = ganhasComObra(s, props)
ok(g.ganhas === 4 && g.comObra === 3, 'ganhas com obra: 3 de 4 (D fora da conta, C conta como falta)')
ok(ganhasComObra({}, []).ganhas === 0, 'lista vazia: 0 de 0')

const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes('obraPorProposta(') && src.includes("from('projetos_obras')") && src.includes('orcamento_id.in.('), 'tela lê a obra pelos dois lados e usa a regra única')
ok(src.includes('setObraErro(true)') && src.includes('aprovada sem obra'), 'falha ao ler obras não derruba a lista; ganha sem obra em destaque')
for (const id of ['hub-propostas-ganhas-com-obra', 'hub-proposta-obra-situacao', 'hub-proposta-obra', 'hub-proposta-sem-obra']) ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)

const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['obra', 'ganhas_com_obra'].map(c => `projetos.propostas.${c}`)) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-obra`); process.exit(1) }
console.log('\ncheck-hub-propostas-obra: verde')
