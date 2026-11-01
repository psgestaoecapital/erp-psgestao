// Gate (HB0, auditor F15 em /dashboard/projetos/propostas · "Oportunidade → Proposta, Visita → Proposta, Take-off →
// Proposta") — a lista mostra a origem de cada proposta pelos vínculos que já existem no banco. Regra única em
// origemPorProposta (src/lib/hub/propostas.ts); sem vínculo = "avulsa", nunca origem inventada. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { origemPorProposta, temOrigem } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const o = origemPorProposta(
  [{ id: 'op1', titulo: ' Piso epóxi galpão ', orcamento_id: 'A' }, { id: 'op2', titulo: null, orcamento_id: null }],
  [
    { id: 'v1', oportunidade_id: 'op1', gerou_orcamento_id: null }, // visita da oportunidade da proposta A
    { id: 'v2', oportunidade_id: 'op1', gerou_orcamento_id: 'A' }, // vínculo direto: conta uma vez só
    { id: 'v3', oportunidade_id: 'op2', gerou_orcamento_id: null }, // oportunidade sem proposta: não conta
    { id: 'v4', oportunidade_id: null, gerou_orcamento_id: 'B' },
  ],
  [{ id: 'p1', nome: 'Planta térreo', orcamento_id: 'A' }, { id: 'p2', nome: '', orcamento_id: 'C' }, { id: 'p3', nome: 'x', orcamento_id: null }],
)
ok(o.A?.oportunidade?.id === 'op1' && o.A.oportunidade.titulo === 'Piso epóxi galpão', 'oportunidade ligada pela orcamento_id, título aparado')
ok(o.A?.visitas === 2, 'visitas: direta + da oportunidade, cada visita conta uma vez')
ok(o.B?.visitas === 1 && !o.B.oportunidade && o.B.plantas.length === 0, 'visita com gerou_orcamento_id liga direto à proposta')
ok(o.A?.plantas.length === 1 && o.C?.plantas[0]?.nome === 'Planta', 'plantas do take-off por orcamento_id; sem nome → "Planta"')
ok(Object.keys(o).sort().join() === 'A,B,C', 'oportunidade/visita/planta sem proposta não cria origem')
ok(temOrigem(o.A) && temOrigem(o.B) && temOrigem(o.C) && !temOrigem(undefined) && !temOrigem({ oportunidade: null, visitas: 0, plantas: [] }), 'temOrigem só com vínculo real')

const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes('origemPorProposta(') && ["from('erp_crm_oportunidade')", "from('erp_crm_visita')", "from('erp_obra_planta')"].every(t => src.includes(t)), 'tela lê os 3 vínculos e usa a regra única')
ok(src.includes('avulsa') && src.includes('setOrigErro(true)'), 'sem vínculo = "avulsa"; falha ao ler origem não derruba a lista')
ok(src.includes('/dashboard/projetos/oportunidades/${') && src.includes('/dashboard/projetos/takeoff?planta_id=${'), 'origem abre a oportunidade e a planta do take-off')
for (const id of ['hub-propostas-com-origem', 'hub-proposta-origem']) ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)

const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['origem', 'com_origem'].map(c => `projetos.propostas.${c}`)) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-origem`); process.exit(1) }
console.log('\ncheck-hub-propostas-origem: verde')
