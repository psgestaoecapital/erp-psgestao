-- RD-98 p3 (origem do dado) · Linhas de negócio (GE) — completa o gap do auditor "rpcs_chamadas vazios"
-- na rota /dashboard/linhas-negocio.
--
-- A migration anterior (20261110120145_linhas_negocio_screen_rd98) registrou views_consumidas
-- (linhas_negocio, linhas_negocio_budget) mas deixou rpcs_chamadas = [] por entender que "nenhuma RPC é
-- chamada diretamente". Isso não é verdade: o componente padrão de ajuda <AjudaCampo/> — presente em TODO
-- campo/indicador/ação desta tela (RD-95) — chama via supabase.rpc() as funções:
--   * fn_ajuda_campo_listar  (carrega o texto do "?" de cada chave) — src/components/ajuda/AjudaCampo.tsx:23
--   * fn_ajuda_campo_uso     (registra o clique no "?")            — src/components/ajuda/AjudaCampo.tsx:46
-- Ambas existem no banco (conferidas em pg_proc) e são as MESMAS RPCs já catalogadas nas telas irmãs de GE
-- (ex.: /dashboard/dre-divisional, /dashboard/cadastros/fornecedores/importar). Deixar rpcs_chamadas vazio
-- numa tela com "?" é catálogo incompleto — "desconhecido disfarçado de conhecido".
--
-- RD-38 (provar no dado): só se registra a relação PROVADA. As RPCs do DRE/benchmark continuam de fora porque
-- a tela as consome por rota /api (.from em tabelas), não por rpc() — e a relação-fantasma `lancamentos`
-- segue NÃO registrada (não existe no banco), como já documentado na migration anterior.
--
-- Aditiva e idempotente: só preenche se rpcs_chamadas ainda estiver vazio — não sobrescreve ajuste manual.
-- Metadata de sistema, sem dado de cliente.

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
WHERE rota = '/dashboard/linhas-negocio'
  AND COALESCE(array_length(rpcs_chamadas, 1), 0) = 0;
