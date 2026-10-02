// Gate · Pauta P&M P2 (SPEC "P&M · Pauta", seções 5 e 6; lista do banco aprovada pelo CEO 02/10). Sem rede.
// 1) regras puras da tela (src/lib/pm/pauta.ts); 2) a migration mantém o que foi aprovado (filtro ÚNICO para lista e
// contadores, margem só para gestor/financeiro, desfazer 24 h, exclusão lógica, guarda de empresa, preferência e visto
// por pessoa); 3) a tela usa as funções certas, salva o filtro, desfaz, e a IA nunca aplica sozinha.
import { readFileSync } from 'node:fs'
import {
  agrupar, atalhosVisiveis, chaveGrupo, codigoJob, contarFiltros, letraRodada, limparFiltros, rotuloDia, seloEscopo,
  textoAguardando, textoAtraso, validarFiltroIA, type ItemPauta,
} from '../../src/lib/pm/pauta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

// ── 1. regras puras ──
ok(letraRodada(0) === '' && letraRodada(1) === 'A' && letraRodada(2) === 'B' && letraRodada(26) === 'Z' && letraRodada(30) === 'Z', 'letra da rodada: 1=A, 2=B… (rodada 0 sem letra)')
ok(codigoJob('113223', 1) === '113223A' && codigoJob(113223, 0) === '113223', 'código = número + letra da rodada (113223A)')
ok(JSON.stringify(limparFiltros({ clientes: [], titulo: '  ', codigo: ' 12 ', data_tipo: 'prazo' })) === '{"codigo":"12"}', 'filtro limpo: tira vazios e o tipo de data sem período')
ok(contarFiltros({ clientes: ['a'], atalho: 'meus', lixeira: true, titulo: 'x' }) === 2, 'contador do botão Filtro ignora atalho e lixeira')
ok(atalhosVisiveis(false).every((a) => a.id !== 'margem_negativa') && atalhosVisiveis(true).some((a) => a.id === 'margem_negativa'),
  '"Margem negativa" só aparece para quem vê margem (gestor/financeiro)')
ok(atalhosVisiveis(false).some((a) => a.id === 'estourando_escopo'), '"Estourando o escopo" aparece para todos (selo sem valor)')
ok(rotuloDia('2026-09-14') === 'Segunda, 14/09' && rotuloDia(null) === 'Sem prazo', 'grupo do dia: "Segunda, 14/09"')
const it = (o: Partial<ItemPauta>): ItemPauta => ({ id: 'x', numero: '1', codigo: '1', rodada: 0, titulo: 't', status: 'em_producao', prioridade: null, nota: null,
  data_prazo: '2026-09-14', atrasado: false, dias_atraso: null, cliente_id: null, cliente: 'C', cliente_status: null, responsavel_id: null, responsavel: 'R',
  servico: null, tipo: null, tem_anexo: false, tem_link: false, comentarios_novos: 0, aguardando_de: null, aguardando_motivo: null, aguardando_dias: null,
  ajustes_limite: null, escopo_estourou: false, excluido_em: null, valor_job: null, custo: null, margem: null, ...o })
ok(chaveGrupo(it({ atrasado: true }), 'prazo') === 'Atrasados', 'atrasado vai para o grupo "Atrasados"')
const g = agrupar([it({ id: '1', atrasado: true }), it({ id: '2', atrasado: true }), it({ id: '3' }), it({ id: '4' })], 'prazo')
ok(g.length === 2 && g[0].grupo === 'Atrasados' && g[0].itens.length === 2, 'agrupamento mantém a ordem do banco ("Atrasados" no topo)')
ok(agrupar([it({}), it({})], 'sem').length === 1, 'sem agrupar = um bloco só')
ok(seloEscopo(it({ rodada: 2, ajustes_limite: 3 })) === '2/3 ajustes' && seloEscopo(it({ rodada: 4, ajustes_limite: 3, escopo_estourou: true })) === 'estourou'
  && seloEscopo(it({})) === null, 'selo de escopo: "2/3 ajustes" / "estourou" / nada sem limite')
ok(textoAtraso(1) === 'há 1 dia' && textoAtraso(3) === 'há 3 dias' && textoAtraso(0) === '', 'atraso "há N dias"')
ok(textoAguardando('cliente', 3) === 'aguardando cliente há 3 dias', '"aguardando cliente há 3 dias"')
const ia = validarFiltroIA({ clientes: ['c1', 'inventado'], responsaveis: ['u9'], atalho: 'apagar_tudo', titulo: 'reels', data_de: '2026-10-01', sql: 'DROP' },
  { clientes: new Set(['c1']), responsaveis: new Set(['u1']), servicos: new Set() })
ok(JSON.stringify(ia.clientes) === '["c1"]' && !ia.responsaveis && !ia.atalho && ia.titulo === 'reels' && ia.data_tipo === 'prazo' && !('sql' in ia),
  'filtro da IA só passa ids que existem na empresa e chaves conhecidas')

// ── 2. migration ──
const mig = readFileSync('supabase/migrations/20261002170000_pauta_p2.sql', 'utf8')
const fn = (nome: string) => { const i = mig.indexOf(`FUNCTION public.${nome}(`); return i < 0 ? '' : mig.slice(i, mig.indexOf('$$;', mig.indexOf('$$', i) + 2) + 3) }
ok(/fn__pauta_filtrar\(p_company_id, p_filtros\)/.test(fn('fn_pauta_contadores')) && /fn__pauta_filtrar\(p_company_id, p_filtros\)/.test(fn('fn_pauta_listar')),
  'contadores e lista usam o MESMO filtro (a aba bate com a lista)')
ok(/SECURITY INVOKER/.test(fn('fn__pauta_filtrar')) && /SECURITY INVOKER/.test(fn('fn_pauta_listar')) && /SECURITY INVOKER/.test(fn('fn_pauta_contadores')),
  'filtro, lista e contadores rodam com a RLS de quem chama')
ok(/'estourando_escopo'/.test(fn('fn__pauta_filtrar')) && /ajustes_limite/.test(fn('fn__pauta_filtrar')), 'atalho "Estourando o escopo" pelo limite do contrato')
ok(/'margem_negativa' THEN public\.fn_pm_pode_ver_margem\(p_company_id\)/.test(fn('fn__pauta_filtrar')), '"Margem negativa" só filtra para quem vê margem')
const listar = fn('fn_pauta_listar')
ok(/fn__guarda_empresa\(p_company_id\)/.test(listar), 'lista confere a empresa (42501)')
ok(/'valor_job', CASE WHEN v_margem/.test(listar) && /'margem', CASE WHEN v_margem/.test(listar) && /'custo', CASE WHEN v_margem/.test(listar), 'valores em reais só para gestor/financeiro')
ok(/LEAST\(GREATEST\(COALESCE\(p_por_pagina, 50\), 1\), 500\)/.test(listar), 'página de 50 (no máximo 500 por chamada)')
ok(/'Atrasados'|NOT atrasado/.test(listar), 'atrasados primeiro no agrupamento por prazo')
for (const f of ['fn_pauta_editar_em_massa', 'fn_pauta_excluir', 'fn_pauta_desfazer']) {
  ok(/fn__guarda_empresa/.test(fn(f)) && /audit_log_global/.test(fn(f)), `${f}: guarda de empresa + audit_log_global`)
}
ok(/interval '24 hours'/.test(fn('fn_pauta_desfazer')) && /fn_acessos_pode_gerir/.test(fn('fn_pauta_desfazer')), 'desfazer: 24 h, quem fez ou o gestor')
ok(/excluido_em\s*=\s*CASE WHEN p_restaurar THEN NULL ELSE now\(\) END/.test(fn('fn_pauta_excluir')) && !/DELETE\s+FROM\s+public\.agency_jobs/i.test(mig),
  'exclusão lógica (lixeira restaura; nada é apagado — RD-30)')
ok(/situacao_job/.test(fn('fn_pauta_editar_em_massa')) && /responsavel_fora_da_empresa/.test(fn('fn_pauta_editar_em_massa')), 'edição em massa valida situação e responsável da empresa')
for (const t of ['agency_pauta_lote', 'agency_pauta_preferencia', 'agency_job_visto'])
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(mig) && new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon`).test(mig), `${t}: RLS ligada, sem anon`)
ok(/agency_pauta_preferencia_propria[\s\S]*user_id = auth\.uid\(\)/.test(mig) && /agency_job_visto_proprio[\s\S]*user_id = auth\.uid\(\)/.test(mig), 'preferência e visto: só da própria pessoa')
ok(/GRANT SELECT ON public\.agency_pauta_lote TO authenticated;/.test(mig), 'lote: a pessoa só lê; grava só pelas funções')
ok(/'pm_pauta', 'Pauta', 'pm'/.test(mig) && /plan_modules/.test(mig), 'menu "Pauta" no P&M nos planos de Jobs')

// ── 3. tela ──
const tela = readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8')
for (const f of ['fn_pauta_contadores', 'fn_pauta_listar', 'fn_pauta_editar_em_massa', 'fn_pauta_excluir', 'fn_pauta_desfazer', 'fn_pauta_opcoes'])
  ok(tela.includes(`"${f}"`), `tela usa ${f}`)
ok(/agency_pauta_preferencia/.test(tela) && /onConflict: "company_id,user_id"/.test(tela), 'filtro salvo por pessoa entre visitas')
ok(/agency_job_visto/.test(tela), 'abrir o job marca "visto" (balão de comentários novos)')
ok(/Confira antes de aplicar/.test(tela) && /setSugestaoIA\(\{ filtros: j\.filtros/.test(tela), 'filtro por frase: a IA sugere, a pessoa confere e aplica')
ok(/window\.print\(\)/.test(tela) && /print:block/.test(tela) && /exportarExcel/.test(tela), 'impressão A4 e planilha')
ok(/pauta-desfazer/.test(tela) && /pauta-lixeira/.test(tela) && /pauta-restaurar/.test(tela), 'desfazer, lixeira e restaurar na tela')
ok(!/\.from\("agency_jobs"\)\.(update|delete|insert)/.test(tela), 'a tela não grava agency_jobs direto (só pelas funções com desfazer)')
const rota = readFileSync('src/app/api/pm/pauta/filtro-ia/route.ts', 'utf8')
ok(/aiGuardedCall/.test(rota) && /validarFiltroIA/.test(rota) && !/agency_jobs/.test(rota), 'rota da IA: teto de custo, só nomes da empresa, nenhum dado de job sai')

if (falhas) { console.error(`\ncheck-pauta-p2: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPauta P2: ok')
