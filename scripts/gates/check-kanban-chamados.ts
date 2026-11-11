// Gate (CEO 09/11, Fase 2 do #7050) — quadro de chamados. Prova a regra pura de colunas e de busca (src/lib/melhorias/kanban.ts),
// que é a mesma que a tela usa, e confere a ajuda "?" (RD-95) da busca e do filtro na migration.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { casaBusca, colunaDoChamado, passaFiltro, type ChamadoKanban } from '../../src/lib/melhorias/kanban'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const base: ChamadoKanban = { status: 'nova', responsavel_id: null, agente: null, resposta_aprovada: false, confirmado_pelo_autor: false }
const c = (x: Partial<ChamadoKanban>) => ({ ...base, ...x })
const rot = (s: string) => ({ nova: 'Nova', em_analise: 'Em análise', concluida: 'Concluída', arquivada: 'Arquivada' } as Record<string, string>)[s] ?? s

ok(colunaDoChamado(c({ status: 'arquivada' })) === null, 'arquivado NÃO tem coluna (só na busca)')
ok(colunaDoChamado(c({ status: 'concluida' })) === 'finalizados', 'concluída → Finalizados')
ok(colunaDoChamado(c({ status: 'recusada' })) === 'finalizados', 'recusada → Finalizados')
ok(colunaDoChamado(c({ status: 'duplicada' })) === 'finalizados', 'duplicada → Finalizados')
ok(colunaDoChamado(c({ status: 'nova' })) === 'pendentes', 'nova → Pendentes')
ok(colunaDoChamado(c({ status: 'em_analise' })) === 'pendentes', 'em análise SEM dono → Pendentes (com selo Sem dono)')
ok(colunaDoChamado(c({ status: 'em_analise', agente: 'jordana-code' })) === 'andamento', 'em análise COM agente → Em andamento')
ok(colunaDoChamado(c({ status: 'em_desenvolvimento', responsavel_id: 'x' })) === 'andamento', 'em desenvolvimento → Em andamento')
ok(colunaDoChamado(c({ status: 'aguardando_confirmacao' })) === 'andamento', 'aguardando_confirmacao SEM resposta aprovada → Em andamento (não é do usuário ainda)')
ok(colunaDoChamado(c({ status: 'em_desenvolvimento', resposta_aprovada: true })) === 'aguardando', 'resposta aprovada e enviada, autor não confirmou → Aguardando usuário')
ok(colunaDoChamado(c({ status: 'em_desenvolvimento', resposta_aprovada: true, confirmado_pelo_autor: true })) === 'andamento', 'autor já confirmou → sai de Aguardando (volta ao fluxo)')
ok(colunaDoChamado(c({ status: 'concluida', resposta_aprovada: true })) === 'finalizados', 'finalizado tem prioridade sobre Aguardando')

ok(passaFiltro(c({ responsavel_id: 'eu' }), 'minha', 'eu') === true, 'Minha carteira: responsável é a pessoa logada')
ok(passaFiltro(c({ responsavel_id: 'outro' }), 'minha', 'eu') === false, 'Minha carteira: responsável de outro fica de fora')
ok(passaFiltro(c({ responsavel_id: null }), 'minha', null) === false, 'Minha carteira sem usuário logado não mostra nada')
ok(passaFiltro(c({ responsavel_id: 'outro' }), 'gerais', 'eu') === true, 'Gerais mostra todos')

const q = { numero: 7050, titulo: 'Impressão do boleto', descricao: 'não sai', empresa: 'Frioeste', user_name: 'Ana', status: 'concluida' }
ok(casaBusca(q, '7050', rot), 'busca pelo número')
ok(casaBusca(q, '#7050', rot), 'busca pelo número com #')
ok(casaBusca(q, 'boleto', rot), 'busca pelo título')
ok(casaBusca(q, 'frioeste', rot), 'busca pela empresa (sem diferenciar maiúsculas)')
ok(casaBusca(q, 'ana', rot), 'busca por quem abriu')
ok(casaBusca(q, 'concluida', rot) === true, 'busca pelo status (código do status)')
ok(casaBusca(q, 'Concluída', (x) => (x === 'concluida' ? 'Concluída' : x)) === true, 'busca pelo nome do status (rótulo na tela)')
ok(casaBusca(q, '', rot), 'busca vazia não filtra')
ok(!casaBusca(q, 'xyzabc', rot), 'termo que não existe não casa')

// RD-95: busca e filtro da tela têm "?" com chave existente na migration
const mig = readFileSync(join(process.cwd(), 'supabase/migrations/20261111130010_melhorias_kanban_ajuda.sql'), 'utf8')
ok(/'melhorias\.kanban\.busca'/.test(mig) && /'melhorias\.kanban\.filtro'/.test(mig), 'ajuda "?" da busca e do filtro existe no banco (migration)')
const quadro = readFileSync(join(process.cwd(), 'src/components/melhorias/QuadroChamados.tsx'), 'utf8')
ok(/AjudaCampo chave="melhorias\.kanban\.busca"/.test(quadro) && /AjudaCampo chave="melhorias\.kanban\.filtro"/.test(quadro), 'tela usa as chaves "?" da busca e do filtro')

// RD-100: nenhum nome de terceiro no texto visível do quadro
const proibidos = /\b(siga|omie|sienge|procore|bling|olist|totvs|protheus|conta azul|contaazul)\b/i
ok(!proibidos.test(quadro) && !proibidos.test(readFileSync(join(process.cwd(), 'src/lib/melhorias/kanban.ts'), 'utf8')), 'RD-100: sem nome de sistema de terceiros no quadro')

// Migration de ajuda: aditiva e idempotente
ok(/ON CONFLICT \(chave\) DO NOTHING/.test(mig) && !/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i.test(mig), 'migration de ajuda é aditiva (INSERT ... ON CONFLICT DO NOTHING)')

if (falhas) { console.error(`\ncheck-kanban-chamados: ${falhas} falha(s)`); process.exit(1) }
console.log('\nQuadro de chamados: ok')
