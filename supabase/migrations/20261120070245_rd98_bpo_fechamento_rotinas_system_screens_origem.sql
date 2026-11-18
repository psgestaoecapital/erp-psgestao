-- RD-98 p3 · origem do dado NULA em duas telas de MENU do BPO (ativo=true em module_catalog),
-- enquanto as telas irmas ja tem o registro. So metadado de registro da tela.
--
-- Fontes reais das telas (prova no codigo, RD-38):
--   /dashboard/bpo/fechamento  ("Fechamento Mensal") -> src/app/dashboard/bpo/fechamento/page.tsx
--     * LEITURA: tabela bpo_companies_assignment     (.from, L69) — empresas atribuidas ao operador.
--     * ACAO:    RPC fn_bpo_fechamento_listar_mes     (L86)  — lista o fechamento do mes de referencia.
--     * ACAO:    RPC fn_bpo_fechamento_executar_lote  (L105) — executa o fechamento em lote.
--   /dashboard/bpo/rotinas     ("Relatorios Automaticos") -> src/app/dashboard/bpo/rotinas/page.tsx
--     * LEITURA: tabela companies    (.from, L80) — empresas do operador.
--     * LEITURA/ESCRITA: tabela bpo_rotinas (.from select/insert/update, L82/L102/L118) — rotinas agendadas.
--     * A tela opera direto nas tabelas (sem RPC) -> rpcs_chamadas = {} (documentado como "sem RPC").
--
-- Estado antes (producao): ambas com views_consumidas = NULL e rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente: NAO toca RLS, grants, dado de cliente, nem comportamento.
-- Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE deterministico das linhas existentes por rota).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['bpo_companies_assignment']::text[],
       rpcs_chamadas    = ARRAY['fn_bpo_fechamento_listar_mes','fn_bpo_fechamento_executar_lote']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/bpo/fechamento';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['companies','bpo_rotinas']::text[],
       rpcs_chamadas    = ARRAY[]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/bpo/rotinas';
