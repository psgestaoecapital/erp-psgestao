// Gate (Pdois #144 · CEO 01/10): o formulário do Job segue a ordem do SIGA — Cliente → Peça/tipo → Título (campo
// grande) → Prazo → Responsável → Briefing (por último). Confere a ordem no código do modal. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/producao/page.tsx', 'utf8')
const ini = src.indexOf("{showForm === 'job' && (")
const fim = src.indexOf("{showForm === 'timesheet' && (", ini)
const modal = ini >= 0 && fim > ini ? src.slice(ini, fim) : ''
ok(modal.length > 0, 'modal do job encontrado')

const ordem = ['data-testid="job-cliente"|testId="job-cliente"', 'testId="job-tipo"', 'data-testid="job-titulo"', 'testId="job-prazo"', 'testId="job-responsavel"', '<BriefingEditor', 'Mais detalhes']
const pos = ordem.map((m) => Math.min(...m.split('|').map((x) => { const i = modal.indexOf(x); return i < 0 ? Infinity : i })))
ok(pos.every((p) => Number.isFinite(p)), 'todos os campos da ordem estão no modal')
ok(pos.every((p, i) => i === 0 || pos[i - 1] < p), 'ordem: Cliente → Peça → Título → Prazo → Responsável → Briefing → Mais detalhes')
ok(/data-testid="job-titulo" rows=\{2\}/.test(modal), 'Título é campo grande (textarea)')
ok(modal.indexOf('label="Título *"') < 0, 'não sobrou o Título antigo (campo pequeno no topo)')

const tipos = src.slice(src.indexOf('const TIPOS_PECA'), src.indexOf(']\n\n', src.indexOf('const TIPOS_PECA')))
for (const k of ['post_rede_social', 'arte_avulsa', 'capa_rede_social', 'site', 'video', 'arte', 'social_media', 'campanha', 'logomarca', 'catalogo', 'lp', 'assessoria']) {
  ok(tipos.includes(`'${k}'`), `peça/tipo "${k}" na lista (as antigas continuam)`)
}

if (falhas) { console.error(`\ncheck-job-ordem-144: ${falhas} falha(s)`); process.exit(1) }
console.log('\nJob na ordem do SIGA (#144): ok')
