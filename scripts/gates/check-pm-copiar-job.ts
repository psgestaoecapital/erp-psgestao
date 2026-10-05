// Gate · P&M "Copiar de um job pronto" (spec aprovada pelo CEO, 03/10). Sem rede.
// 1) regras puras da tela (src/lib/pm/copiarJob.ts): busca sem acento, prazo da cópia (hoje + duração do original;
//    sem ela, prazo padrão da peça; sem nada, sem prazo), o que vai / o que não vai, opções e filtros;
// 2) a migration: busca tolerante (pt_unaccent + unaccent IMMUTABLE + busca_texto com gatilho + 2 índices), busca e
//    "parecidos" com a RLS de quem chama, cópia com guarda de empresa que nunca copia datas/situação/rodada/comentários/
//    aprovações/horas, copiado_de_job_id, linha no histórico; nada aberto a anônimo; nada apagado; nenhuma tabela nova;
// 3) a tela: botão no Novo Job, "Jobs parecidos (N)", cópia só pela função, "?" em cada campo com chave no banco.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import {
  normalizarBusca, prazoDaCopia, duracaoOriginal, explicarPrazo, oQueCopia, montarOpcoes, limparFiltrosCopia,
  contarFiltrosCopia, tituloBuscavel, rotuloPeca, TIPOS_PECA, OPCOES_PADRAO,
} from '../../src/lib/pm/copiarJob'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

// ── 1) regras puras ──
ok(normalizarBusca('Carrossel — Dia das Crianças!') === 'carrossel dia das criancas', 'busca sem acento e sem pontuação (espelho do banco)')
ok(normalizarBusca(null) === '' && normalizarBusca('  Ação  Pão ') === 'acao pao', 'busca: vazio e espaços')
const hoje = '2026-10-03'
const p1 = prazoDaCopia({ data_inicio: '2026-09-01', data_prazo: '2026-09-06', criado_em: null }, hoje, 10)
ok(p1.regra === 'duracao' && p1.dias === 5 && p1.data_prazo === '2026-10-08', 'prazo = hoje + duração do original (início → prazo)')
const p2 = prazoDaCopia({ data_inicio: null, data_prazo: '2026-09-10', criado_em: '2026-09-07T15:00:00Z' }, hoje)
ok(p2.regra === 'duracao' && p2.dias === 3, 'sem início: duração conta da criação (data de São Paulo)')
ok(duracaoOriginal({ data_inicio: null, data_prazo: '2026-09-10', criado_em: '2026-09-11T02:00:00Z' }) === 0, 'criação 23h de SP conta como o dia 10 (fuso)')
const p3 = prazoDaCopia({ data_inicio: null, data_prazo: '2026-09-01', criado_em: '2026-09-28T12:00:00Z' }, hoje, 4)
ok(p3.regra === 'peca' && p3.data_prazo === '2026-10-07', 'duração negativa (job importado) → prazo padrão da peça')
const p4 = prazoDaCopia({ data_inicio: '2026-09-01', data_prazo: null, criado_em: null }, hoje, null)
ok(p4.regra === 'sem_prazo' && p4.data_prazo === null, 'sem duração e sem prazo da peça → sem prazo')
ok(prazoDaCopia({ data_inicio: '2025-01-01', data_prazo: '2026-09-01', criado_em: null }, hoje, null).regra === 'sem_prazo', 'duração acima de 1 ano não vale')
const p5 = prazoDaCopia({ data_inicio: '2026-09-01', data_prazo: '2026-09-06', criado_em: null }, hoje, null, '2026-10-20')
ok(p5.regra === 'informado' && p5.data_prazo === '2026-10-20' && p5.dias === 17, 'prazo escolhido na tela vence a regra')
ok(prazoDaCopia({ data_inicio: '2026-12-28', data_prazo: '2027-01-02', criado_em: null }, '2026-12-30', null).data_prazo === '2027-01-04', 'virada de ano')
ok(explicarPrazo(p1).includes('5 dias') && explicarPrazo(p3).includes('padrão da peça') && explicarPrazo(p4).includes('não tem prazo'), 'texto do prazo explica a regra')
const o1 = oQueCopia(OPCOES_PADRAO)
ok(o1.vai.includes('Briefing') && o1.vai.some((v) => v.startsWith('Tarefas')) && o1.naoVai.some((v) => v.startsWith('Responsáveis')) && o1.naoVai.some((v) => v.startsWith('Anexos')), 'padrão: responsáveis e anexos NÃO vão')
for (const n of ['Datas', 'Comentários', 'Aprovações', 'Horas lançadas']) ok(o1.naoVai.includes(n), `nunca vai: ${n}`)
const o2 = oQueCopia({ responsaveis: true, anexos: true })
ok(o2.vai.some((v) => v.startsWith('Responsáveis')) && o2.vai.some((v) => v.startsWith('Anexos')), 'marcados: responsáveis e anexos vão')
ok(JSON.stringify(montarOpcoes({ responsaveis: false, anexos: true })) === '{"responsaveis":false,"anexos":true}', 'opções: cliente ausente = o do original')
ok((montarOpcoes({ ...OPCOES_PADRAO, cliente_id: null }) as { cliente_id: string }).cliente_id === '', 'opções: cliente limpo = sem cliente')
ok((montarOpcoes({ ...OPCOES_PADRAO, titulo: '  Novo  ', data_prazo: '2026-10-09' }) as { titulo: string; data_prazo: string }).titulo === 'Novo', 'opções: título aparado e prazo')
ok(contarFiltrosCopia({ clientes: [], pecas: ['story'], data_de: '', data_ate: '2026-10-01' }) === 2 && Object.keys(limparFiltrosCopia({ situacoes: [] })).length === 0, 'filtros vazios não contam')
ok(!tituloBuscavel('Pó!') && tituloBuscavel('post'), '"Jobs parecidos" só com 4+ letras')
ok(rotuloPeca('lp') === 'Landing Page' && rotuloPeca('reels_x') === 'reels x' && rotuloPeca(null) === '', 'rótulo da peça')

// ── 2) migration ──
const mig = readFileSync('supabase/migrations/20261003110000_pm_copiar_job.sql', 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const fn = (n: string) => { const i = sql.indexOf(`FUNCTION public.${n}(`); return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', sql.indexOf('AS $$', i)) + 3) }
ok(/CREATE TEXT SEARCH CONFIGURATION public\.pt_unaccent \(COPY = pg_catalog\.portuguese\)/.test(sql)
  && /ALTER MAPPING FOR hword, hword_part, word WITH public\.unaccent, pg_catalog\.portuguese_stem/.test(sql), 'pt_unaccent = português + unaccent')
ok(/fn_pm_busca_normalizar\(p_texto text\) RETURNS text\s+LANGUAGE sql IMMUTABLE/.test(sql), 'normalizador IMMUTABLE (serve em índice)')
ok(/ADD COLUMN IF NOT EXISTS busca_texto\s+text/.test(sql) && /ADD COLUMN IF NOT EXISTS copiado_de_job_id uuid REFERENCES public\.agency_jobs\(id\) ON DELETE SET NULL/.test(sql), 'colunas busca_texto e copiado_de_job_id (FK)')
const gat = fn('trg_agency_jobs_busca_texto')
ok(/NEW\.titulo/.test(gat) && /agency_clientes/.test(gat) && /fn_pm_peca_rotulo\(NEW\.tipo\)/.test(gat) && /agency_campanhas/.test(gat) && /NEW\.descricao/.test(gat), 'busca_texto = título + cliente + peça + campanha + briefing')
ok(/BEFORE INSERT OR UPDATE OF numero, titulo, descricao, tipo, cliente_id, campanha_id, busca_texto ON public\.agency_jobs/.test(sql), 'gatilho recalcula a cada gravação do job')
ok('trg_agency_jobs_busca_texto' > 'trg_agency_job_numero', 'gatilho da busca roda depois do número do job (ordem alfabética)')
ok(/UPDATE public\.agency_jobs SET busca_texto = NULL WHERE busca_texto IS NULL;/.test(sql), 'preenchimento único dos jobs existentes')
ok(/USING gin \(to_tsvector\('public\.pt_unaccent'::regconfig, COALESCE\(busca_texto, ''\)\)\)/.test(sql) && /USING gin \(busca_texto public\.gin_trgm_ops\)/.test(sql), 'dois índices: texto completo sem acento + trigramas')
ok(!/pg_trgm\.word_similarity_threshold TO/.test(sql), 'sem SET de parâmetro do pg_trgm na função (o Supabase recusa)')
const busca = fn('fn_pm_jobs_buscar'), par = fn('fn_pm_jobs_parecidos'), cop = fn('fn_pm_job_copiar')
ok(/SECURITY INVOKER/.test(busca) && /SECURITY INVOKER/.test(par) && !/SECURITY DEFINER/.test(busca + par), 'busca e parecidos com a RLS de quem chama')
ok(/excluido_em IS NULL/.test(busca) && /excluido_em IS NULL/.test(par), 'lixeira fora da busca')
ok(/ts_rank\(/.test(busca) && /word_similarity\(/.test(busca) && /similarity\(q, public\.fn_pm_busca_normalizar\(j\.titulo\)\)/.test(busca), 'ranking: relevância das palavras + semelhança')
for (const f of ["'clientes'", "'pecas'", "'situacoes'", "'data_de'", "'data_ate'"]) ok(busca.includes(f), `filtro ${f}`)
ok(/LIMIT v_por OFFSET \(v_pag - 1\) \* v_por/.test(busca) && /LEAST\(GREATEST\(COALESCE\(p_por_pagina, 12\), 1\), 50\)/.test(busca), 'paginada (máx. 50 por página)')
ok(/q <% j\.busca_texto/.test(par) && /LIMIT 200/.test(par), 'parecidos: operador de trigramas (índice), leve')
ok(/SECURITY DEFINER SET search_path TO 'public'/.test(cop) && /PERFORM public\.fn__guarda_empresa\(j\.company_id\);/.test(cop), 'cópia: SECURITY DEFINER com guarda de empresa')
ok(/c\.company_id = j\.company_id/.test(cop) && /cliente_invalido/.test(cop), 'cliente trocado tem de ser da mesma empresa')
ok(/job_na_lixeira/.test(cop) && /prazo_passado/.test(cop), 'não copia job da lixeira nem aceita prazo no passado')
ok(/'nao_iniciada', 'normal', 0, v_prazo/.test(cop), 'job novo: "Não iniciada", prioridade normal, rodada 0')
const insJob = cop.slice(cop.indexOf('INSERT INTO agency_jobs'), cop.indexOf('RETURNING', cop.indexOf('INSERT INTO agency_jobs')))
for (const c of ['data_inicio', 'data_entrega', 'horas_realizadas', 'comentarios', 'aguardando', 'nota', 'valor_job', 'numero']) ok(!new RegExp(`\\b${c}\\b`).test(insJob), `cópia não grava ${c} do original`)
ok(/CASE WHEN v_resp THEN j\.responsavel_id END/.test(insJob) && /CASE WHEN v_anx AND jsonb_typeof\(j\.arquivos\) = 'array' THEN j\.arquivos ELSE '\[\]'::jsonb END/.test(insJob), 'responsáveis e anexos só se marcados')
ok(/copiado_de_job_id\)/.test(insJob) && /, j\.id\)/.test(insJob), 'copiado_de_job_id = job de origem')
const insTar = cop.slice(cop.indexOf('INSERT INTO agency_tarefas'), cop.indexOf('GET DIAGNOSTICS'))
ok(/'pendente'/.test(insTar) && /fn_pm_checklist_desmarcar\(t\.checklist\)/.test(insTar) && !/data_prazo|data_inicio|data_conclusao|horas_realizadas/.test(insTar), 'tarefas: pendentes, checklist desmarcado, sem datas nem horas')
ok(/CASE WHEN v_resp THEN t\.responsavel_id END/.test(insTar), 'responsável da tarefa só se marcado')
ok(/v_hoje \+ v_dur/.test(cop) && /v_dur BETWEEN 0 AND 365/.test(cop) && /prazo_dias_padrao/.test(cop) && /'sem_prazo'/.test(cop), 'prazo: hoje + duração; senão prazo padrão da peça; senão sem prazo')
ok(/PERFORM public\.fn__pm_job_registrar\(j\.company_id, v_novo,/.test(cop) && /Copiado do job/.test(cop), 'linha no histórico do job novo')
const desm = fn('fn_pm_checklist_desmarcar')
ok(/jsonb_object_agg\(k, false\)/.test(desm) && /'feito'/.test(desm) && /'concluido'/.test(desm), 'checklist: marcas viram false')
for (const [f, a] of [['fn_pm_busca_normalizar', 'text'], ['fn_pm_peca_rotulo', 'text'], ['fn_pm_jobs_buscar', 'uuid, text, jsonb, integer, integer'],
  ['fn_pm_jobs_parecidos', 'uuid, text, integer'], ['fn_pm_checklist_desmarcar', 'jsonb'], ['fn_pm_job_copiar', 'uuid, jsonb']]) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION public.${f}(${a}) FROM PUBLIC, anon;`), `${f}: fechada para anônimo`)
}
ok(sql.includes('REVOKE ALL ON FUNCTION public.trg_agency_jobs_busca_texto() FROM PUBLIC, anon, authenticated;'), 'gatilho sem acesso direto')
ok([...sql.matchAll(/\bGRANT\b[^;]*?\bTO\b([^;]*);/g)].every((m) => !/\b(anon|public)\b/i.test(m[1])), 'nenhum GRANT a anônimo')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(TABLE|COLUMN|FUNCTION|INDEX)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado (RD-30)')
ok(!/CREATE TABLE/i.test(sql), 'nenhuma tabela nova')
const chavesMig = new Set([...mig.matchAll(/\('((?:pm)\.[a-z0-9_.]+)'/g)].map((m) => m[1]))

// mapa de peças: tela, lib e banco com as mesmas chaves
const pagina = readFileSync('src/app/dashboard/producao/page.tsx', 'utf8')
const tiposPagina = [...pagina.slice(pagina.indexOf('const TIPOS_PECA'), pagina.indexOf(']\n\n', pagina.indexOf('const TIPOS_PECA'))).matchAll(/\['([a-z_]+)'/g)].map((m) => m[1])
ok(tiposPagina.length >= 12 && tiposPagina.join() === TIPOS_PECA.map(([k]) => k).join(), 'peças da lib = peças do Novo Job')
ok(TIPOS_PECA.every(([k]) => fn('fn_pm_peca_rotulo').includes(`WHEN '${k}'`)), 'banco conhece o rótulo de toda peça')

// ── 3) tela ──
const comp = readFileSync('src/components/pm/CopiarJob.tsx', 'utf8')
ok(comp.includes('"fn_pm_jobs_buscar"') && comp.includes('"fn_pm_jobs_parecidos"') && comp.includes('"fn_pm_job_copiar"'), 'tela usa as três funções')
ok(!/from\("agency_(jobs|tarefas)"\)\.(insert|update|upsert|delete)/.test(comp), 'a tela nunca grava job/tarefa direto — só pela função')
ok(!/dangerouslySetInnerHTML/.test(comp), 'briefing na prévia nunca vira HTML')
ok(/data-testid="job-copiar-abrir"/.test(pagina) && /<JobsParecidos empresa=\{sel\}/.test(pagina) && /<CopiarJob empresa=\{sel\}/.test(pagina), 'Novo Job: botão "Copiar de um job pronto" e "Jobs parecidos (N)"')
ok(/sm:max-w-5xl/.test(comp) && /fixed inset-0/.test(comp), 'abre em tela cheia no celular e em janela no computador')

// "?" em cada campo: todo input/select/textarea do componente dentro de <label> (ou <ClienteBusca>) com <AjudaCampo>
const src = ts.createSourceFile('CopiarJob.tsx', comp, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const tag = (n: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const temAjuda = (n: ts.Node): boolean => { let a = false; const v = (x: ts.Node) => { if (a) return; if ((ts.isJsxSelfClosingElement(x) || ts.isJsxElement(x)) && tag(x) === 'AjudaCampo') { a = true; return } ts.forEachChild(x, v) }; v(n); return a }
let campos = 0, semAjuda = 0
const visita = (n: ts.Node) => {
  if ((ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) && ['input', 'select', 'textarea'].includes(tag(n))) {
    campos++
    let p: ts.Node | undefined = n.parent
    while (p && !(ts.isJsxElement(p) && tag(p) === 'label')) p = p.parent
    if (!p || !temAjuda(p)) { semAjuda++; console.error('  campo sem "?":', n.getText().slice(0, 80)) }
  }
  ts.forEachChild(n, visita)
}
visita(src)
ok(campos >= 9 && semAjuda === 0, `todo campo do "Copiar" tem o "?" (${campos - semAjuda}/${campos})`)
const chavesTela = new Set([...comp.matchAll(/(?:chave|ajuda)="(pm\.[a-z0-9_.]+)"/g)].map((m) => m[1]))
chavesTela.add('pm.job.titulo')
ok(pagina.includes('<AjudaCampo chave="pm.job.titulo" />'), 'Título do Novo Job ganhou o "?"')
for (const k of chavesTela) ok(chavesMig.has(k), `"?" ${k} tem texto no banco (rota /dashboard/producao)`)

if (falhas) { console.error(`\ncheck-pm-copiar-job: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M copiar de um job pronto: ok')
