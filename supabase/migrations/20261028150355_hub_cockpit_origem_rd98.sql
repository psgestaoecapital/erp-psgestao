-- Hub · /dashboard/projetos/cockpit — delta 76 -> 95 (aud 27/10 15:29 · Code: dev7claudeps)
--   RD-98 p3 (ORIGEM): system_screens.views_consumidas/rpcs_chamadas estavam 0/0. A tela lê v_obra_resultado_alocado
--   (receita/custo/margem por obra) e projetos_obras (cliente, cidade, avanço, prazo); não chama RPC.
--   RD-95: os "?" de KPIs/filtros/CTAs já cobrem todo campo da tela (conferido). Obra excluída (deleted_at) sai do cockpit.
--   RD-98 p1 (dado real): semear medição/custo na DEMO NÃO é feito aqui (NFS-e/medição é fiscal) — aguarda decisão do Eng. Chefe.
-- Migration ADITIVA (RD-94.1): só UPDATE de catálogo de telas.
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'v_obra_resultado_alocado',  -- cards: receita, custo, margem, mão de obra por obra
        'projetos_obras'             -- cliente, cidade, avanço (pct_conclusao) e prazo
       ]::text[],
       rpcs_chamadas = ARRAY[]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/cockpit';
