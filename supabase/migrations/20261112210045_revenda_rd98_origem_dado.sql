-- RD-98 p3 (origem do dado): documenta views_consumidas / rpcs_chamadas de 2 telas da
-- Revenda que estavam VAZIAS no catálogo public.system_screens e por isso tinham o selo
-- do auditor bloqueado:
--   * /dashboard/revenda          — Painel do dono
--   * /dashboard/revenda/veiculo  — Ficha do veículo (rota dinâmica veiculo/[id])
--
-- Origem PROVADA por leitura do código (RD-38):
--   * chamadas supabase.from()/rpc() de cada page.tsx; e
--   * as tabelas lidas por dentro das RPCs do painel (pg_get_functiondef em produção).
--
-- Aditiva, idempotente e sem risco: só metadados do catálogo de telas das 2 rotas.
-- Não toca dado de cliente, RLS, cálculo fiscal/financeiro.
-- Code: jordana-code

-- /dashboard/revenda — Painel do dono (dados só via RPC; tabelas vindas das próprias RPCs)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'veic_veiculo','veic_venda','veic_custo','veic_config',
         'veic_venda_recebimento','veic_coaf_ocorrencia','insp_vistoria'
       ],
       rpcs_chamadas = ARRAY[
         'fn_veic_painel','fn_veic_patio_conta','fn_veic_carrego_parametros',
         'fn_veic_coaf_avaliar','fn_veic_coaf_marcar'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/revenda';

-- /dashboard/revenda/veiculo — Ficha do veículo (lê tabelas direto + usa AjudaCampo)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'veic_veiculo','veic_veiculo_evento','veic_veiculo_foto','veic_venda','veic_custo',
         'veic_reserva','veic_config','veic_precificacao_hist','v_veic_patio',
         'insp_vistoria','insp_foto','erp_banco_contas'
       ],
       rpcs_chamadas = ARRAY[
         'fn_veic_venda_composicao','fn_veic_mudar_situacao','fn_veic_custo_excluir',
         'fn_veic_reserva_cancelar','fn_veic_venda_entregar','fn_veic_venda_cancelar',
         'fn_veic_reserva_criar','fn_veic_venda_registrar','fn_veic_custo_gerar_pagar',
         'fn_veic_custo_salvar','fn_veic_conta_do_carro','fn_veic_preparacao_confronto',
         'fn_veic_preparacao_listar','fn_veic_preparacao_concluir','fn_veic_preparacao_abrir',
         'fn_veic_interessados','fn_veic_oportunidade_abrir','fn_veic_procura_registrar',
         'fn_veic_completude_fiscal','fn_veic_veiculo_fiscal','fn_veic_atualizar_dados',
         'fn_insp_vistoria_obter','fn_veic_config_obter','fn_veic_foto_registrar',
         'fn_veic_foto_principal','fn_veic_foto_reordenar','fn_veic_foto_remover',
         'fn_veic_anuncio_salvar','fn_veic_preco_minimo',
         'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/revenda/veiculo';
