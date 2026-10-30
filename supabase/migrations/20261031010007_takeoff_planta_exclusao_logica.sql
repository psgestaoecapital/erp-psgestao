-- Take-off · exclusão lógica de planta (RD-98 CRUD). Aditiva: duas colunas novas + RPC nova; a planta nunca é apagada
-- fisicamente (deleted_at + quem excluiu + audit_log_global). A busca por hash passa a ignorar planta excluída, para
-- reenviar o mesmo arquivo depois de excluir não reabrir a planta excluída.
ALTER TABLE public.erp_obra_planta ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.erp_obra_planta ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_excluir(p_planta_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_p public.erp_obra_planta%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  SELECT * INTO v_p FROM public.erp_obra_planta WHERE id = p_planta_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'planta_nao_encontrada'); END IF;
  IF NOT (v_p.company_id = ANY (ARRAY(SELECT get_user_company_ids()))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE public.erp_obra_planta SET deleted_at = now(), excluido_por = auth.uid(), updated_at = now() WHERE id = p_planta_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (v_p.company_id, auth.uid(), 'erp_obra_planta', p_planta_id::text, 'soft_delete',
          jsonb_build_object('nome', v_p.nome, 'status', v_p.status, 'orcamento_id', v_p.orcamento_id));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_takeoff_planta_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_excluir(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_procurar_por_hash(p_company_id uuid, p_arquivo_hash text)
RETURNS TABLE(id uuid, nome text, aps_status text, analisado_em timestamp with time zone, arquivo_dwg_path text, arquivo_path text, arquivo_tipo text, orcamento_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF p_arquivo_hash IS NULL OR length(p_arquivo_hash) < 16 THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.nome, p.aps_status, p.analisado_em, p.arquivo_dwg_path, p.arquivo_path, p.arquivo_tipo, p.orcamento_id
    FROM public.erp_obra_planta p
   WHERE p.company_id = p_company_id AND p.arquivo_hash = p_arquivo_hash AND p.deleted_at IS NULL
   ORDER BY (CASE p.aps_status WHEN 'radiografado' THEN 1 WHEN 'traduzindo' THEN 2 ELSE 3 END), p.updated_at DESC
   LIMIT 1;
END $$;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Take-off', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/takeoff', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.takeoff.planta_ver_orcamento', 'Ver orçamento da planta', 'Nada a preencher: abre o orçamento ao qual a planta está ligada.', 'Confere os itens gerados a partir das medidas da planta.', 'Planta "Vista Verde" abre o orçamento da obra.', 'Planta sem orçamento: o botão fica desligado até gerar o orçamento.', 240),
 ('projetos.takeoff.planta_excluir', 'Excluir planta', 'Nada a preencher: pede confirmação e tira a planta da lista.', 'Remove da lista uma planta enviada por engano. O registro fica guardado (quem excluiu e quando), não é apagado.', 'Planta enviada duas vezes: exclua a repetida.', 'Excluir a planta que já gerou orçamento: o orçamento continua existindo.', 250)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
