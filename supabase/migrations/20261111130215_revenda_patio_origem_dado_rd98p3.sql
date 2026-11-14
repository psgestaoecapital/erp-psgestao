-- RD-98 p3 (aud8 09/11) · documentar a ORIGEM DO DADO da tela Revenda › Pátio.
-- system_screens.views_consumidas / rpcs_chamadas estavam VAZIOS em /dashboard/revenda/patio —
-- único gap que segura o selo (>=95); tela funcional e RD-95 "?" (11 chaves) já bons.
--
-- Aditiva e idempotente: só metadado de catálogo (system_screens). Nenhum dado de cliente, schema,
-- RLS ou permissão. Valores extraídos do código vivo de page.tsx (RD-38): `.rpc()` e `.from()`;
-- o AjudaCampo chama fn_ajuda_campo_listar/fn_ajuda_campo_uso.
-- Code: dev7claudeps

UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_crm_oportunidade','insp_vistoria','revenda','v_veic_patio','veic_veiculo']::text[],
  rpcs_chamadas = ARRAY[
    'fn_veic_criar','fn_veic_patio_conta','fn_veic_precificacao_lote','fn_veic_preparacao_listar',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/revenda/patio';
