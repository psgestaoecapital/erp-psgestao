// Gate (Rodrigo, Canal PS 04/11 · chamado #6729 Tryo) — o card do kanban não pode dizer "aguardando o PDF" se o PDF já foi anexado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const k = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadesKanban.tsx', 'utf8')
ok(/from\('erp_orcamentos'\)\.select\('id'\)\.in\('id', orcIds\)\.not\('pdf_anexo_path', 'is', null\)/.test(k), 'kanban: busca quais orçamentos do card já têm PDF anexado')
ok(/setPdfOrc\(pm\)/.test(k), 'kanban: guarda o mapa de PDF anexado')
ok(/pdfOrc\[orcMap\[c\.id\]\.orcamento_id\] \? 'PDF anexado/.test(k), 'kanban: com PDF anexado mostra "PDF anexado", não "aguardando"')
ok(/'aguardando o PDF do orçamento'/.test(k), 'kanban: sem PDF continua mostrando "aguardando o PDF do orçamento"')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
