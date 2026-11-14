-- RD-98 p3 (aud8 09/11 18:34) · documentar a ORIGEM DO DADO das telas de Oficina.
-- As colunas system_screens.views_consumidas / rpcs_chamadas estavam NULL em 3 rotas de Oficina
-- (agenda, recepção, diagnóstico). O auditor segura o selo (>=95) enquanto a origem do dado não é
-- documentada — mesmo com a tela funcional, "?" (RD-95) e CRUD completos.
--
-- Aditiva e idempotente: só preenche METADADO de catálogo (system_screens). Nenhum dado de cliente,
-- nenhuma mudança de schema, nenhuma RLS/permissão. Re-rodar resulta no mesmo estado.
-- Valores extraídos do código VIVO de cada page.tsx (RD-38): `.rpc('fn_...')` e `.from('tabela/view')`.
-- A ajuda "?" (AjudaCampo) chama fn_ajuda_campo_listar/fn_ajuda_campo_uso em toda tela.
-- Code: dev7claudeps

-- /dashboard/oficina/agenda
UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_clientes','erp_os','erp_os_mecanico']::text[],
  rpcs_chamadas = ARRAY[
    'fn_agenda_listar','fn_agendamento_criar','fn_agendamento_editar','fn_agendamento_excluir',
    'fn_agendamento_mudar_status','fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/oficina/agenda';

-- /dashboard/oficina/recepcao
UPDATE public.system_screens SET
  views_consumidas = ARRAY[]::text[],
  rpcs_chamadas = ARRAY[
    'fn_oficina_recepcao_criar','fn_oficina_buscar_placa','fn_oficina_buscar_por_placa',
    'fn_cliente_buscar','fn_cliente_criar_inline','fn_pessoa_existe_por_cnpj',
    'fn_oficina_cliente_contato_obter','fn_oficina_cliente_contato_upsert',
    'fn_oficina_mecanicos','fn_oficina_mecanicos_cadastrados',
    'fn_oficina_orcamento_avulso','fn_oficina_orcamento_para_os',
    'fn_agendamento_vincular_os','fn_os_designar_responsavel',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/oficina/recepcao';

-- /dashboard/oficina/diagnostico
UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_fornecedores','erp_oficina_servicos']::text[],
  rpcs_chamadas = ARRAY[
    'fn_oficina_diagnostico_obter','fn_oficina_diagnostico_salvar','fn_oficina_os_fila',
    'fn_oficina_pecas_buscar','fn_oficina_registro_legenda','fn_oficina_registro_listar',
    'fn_oficina_registro_salvar','fn_oficina_servico_criar','fn_os_diagnostico_gerar_cotacao',
    'fn_cotacao_convidar_fornecedores','fn_os_foto_excluir','fn_os_link_publico_gerar',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/oficina/diagnostico';
