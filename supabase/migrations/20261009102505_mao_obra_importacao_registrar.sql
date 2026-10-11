-- Mão de obra · importação em massa (CEO 07/10, FC Pisos): registro de QUEM importou (LGPD). Função NOVA e aditiva;
-- a gravação em si usa as RPCs existentes (fn_mao_obra_encargos_salvar / funcao_salvar / ficha_salvar). Sem dado pessoal no log: só contagens.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_importacao_registrar(p_company_id uuid, p_resumo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, auth.uid(), 'erp_mao_obra_custo', p_company_id::text, 'MAO_OBRA_IMPORTACAO',
          jsonb_build_object('arquivo', left(COALESCE(p_resumo->>'arquivo', ''), 200), 'lidas', (p_resumo->>'lidas')::int, 'gravadas', (p_resumo->>'gravadas')::int,
                             'recusadas', (p_resumo->>'recusadas')::int, 'encargos', COALESCE((p_resumo->>'encargos')::boolean, false)));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_mao_obra_importacao_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_importacao_registrar(uuid, jsonb) TO authenticated, service_role;

-- "?" de ajuda do campo de arquivo da importação (só texto; aditivo)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('projetos.mao_obra.importar.arquivo', 'Importar planilha', 'Arquivo da planilha',
  'Escolha o modelo (.xlsx) preenchido — baixe o modelo no botão "Baixar modelo". A aba 2_Funcionarios traz uma pessoa por linha; a 1_Encargos_empresa, os encargos da empresa.',
  'O sistema mostra a prévia linha a linha e grava só as linhas certas, pelas mesmas regras do cadastro à mão. Quem já existe (mesmo CPF) ganha nova vigência, sem duplicar. As fichas entram "não conferidas".',
  'MODELO_mao_de_obra_PS.xlsx', 'Mandar outro formato de planilha, ou deixar a linha de exemplo do modelo.', 90, '/dashboard/projetos/mao-obra', 'hub_construcao', 'publicado')
ON CONFLICT (chave) DO NOTHING;
