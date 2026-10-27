-- Hub · /dashboard/projetos/obras/resultado — delta 83 -> 95 (aud 27/10 15:29 · Code: dev7claudeps)
--   RD-98 p3 (ORIGEM): system_screens.views_consumidas/rpcs_chamadas estavam null. Registra a origem real do dado
--   (page.tsx lê v_obra_resultado_alocado → fallback v_obra_resultado, e chama fn_obras_receita).
--   Receita R$0 (RD-98 p1): a tela passa a mostrar "sem medição" (estado explicado) no lugar do R$ 0,00 mudo; a receita
--   real sai de erp_nfse_obra_medicao/NFS-e — semear nota fiscal fictícia na DEMO NÃO é feito aqui (fiscal, sensível).
-- Migration ADITIVA (RD-94.1): só UPDATE de catálogo de telas.
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'v_obra_resultado_alocado',  -- custo por obra com mão de obra alocada (fonte principal)
        'v_obra_resultado',          -- fallback: receita serviço/material, custo material e viagens
        'erp_nfse_obra_medicao',     -- receita de serviço medida (via view)
        'erp_pedidos',               -- venda de material por obra (via view)
        'erp_nfse_emitidas'          -- faturado (via fn_obras_receita)
       ]::text[],
       rpcs_chamadas = ARRAY['fn_obras_receita']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/resultado';
