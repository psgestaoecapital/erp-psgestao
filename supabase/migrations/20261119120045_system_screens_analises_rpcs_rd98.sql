-- RD-98 p3 (origem do dado) · gap do auditor em /dashboard/analises
-- A tela tinha system_screens.rpcs_chamadas = [] (vazio), enquanto as irmas da GE
-- trazem as RPCs preenchidas. Prova RD-38 (leitura de codigo, 16/11):
--   - a page.tsx nao chama supabase.rpc() diretamente;
--   - os componentes filhos (BalancoPatrimonial, IndicadoresFinanceiros, FluxoCaixa,
--     AnaliseIAFlags) tambem nao chamam .rpc();
--   - as unicas RPCs vem do componente padrao AjudaCampo (RD-95): fn_ajuda_campo_listar
--     e fn_ajuda_campo_uso (mesmo par de /dashboard/viabilidade).
-- views_consumidas ja estava preenchida; aqui so completamos rpcs_chamadas.
-- Aditivo/idempotente: so grava se estiver vazio/NULL, nao sobrescreve valor existente.

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/analises'
   AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
