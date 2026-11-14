-- RD-98 p3 · documentar a ORIGEM DO DADO das telas de Estoque e Fichas Técnicas (Comércio).
-- system_screens.views_consumidas / rpcs_chamadas estavam NULL em 2 rotas de Comércio; o auditor
-- segura o selo enquanto a origem do dado não está no catálogo.
--
-- Aditiva e idempotente: só preenche METADADO de catálogo (system_screens). Nenhum dado de cliente,
-- nenhuma mudança de schema, nenhuma RLS/permissão. Re-rodar resulta no mesmo estado.
-- Valores extraídos do código VIVO de cada page.tsx (RD-38): `.rpc('...')` e `.from('tabela/view')`.
-- Objetos conferidos no banco (existem): erp_estoque_locais, erp_inventario_itens, erp_inventarios,
-- erp_produtos, v_estoque_movimentacoes, ficha_itens, fichas_tecnicas, fechar_inventario,
-- fn_curva_abc_estoque, fn_estoque_reservas, fn_inventario_registrar_contagem, fn_veic_estoque_ge,
-- next_inventario_numero, registrar_movimento_estoque.
-- Code: desenvolvedor_4_g

-- /dashboard/commerce/estoque
UPDATE public.system_screens SET
  views_consumidas = ARRAY[
    'erp_produtos','erp_estoque_locais','erp_inventarios','erp_inventario_itens',
    'v_estoque_movimentacoes'
  ]::text[],
  rpcs_chamadas = ARRAY[
    'fn_curva_abc_estoque','fn_estoque_reservas','registrar_movimento_estoque',
    'fn_inventario_registrar_contagem','fechar_inventario','next_inventario_numero',
    'fn_veic_estoque_ge'
  ]::text[]
WHERE rota = '/dashboard/commerce/estoque';

-- /dashboard/commerce/fichas
UPDATE public.system_screens SET
  views_consumidas = ARRAY['fichas_tecnicas','ficha_itens']::text[],
  rpcs_chamadas = ARRAY[]::text[]
WHERE rota = '/dashboard/commerce/fichas';
