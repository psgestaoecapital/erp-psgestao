-- PDCA P&M · /dashboard/pm/meu-dia (aud8 95/95) — fecha os 2 gaps do auditor_pdca_2 (01/11), provados no dado.
-- GAP p2 (CRUD): a anotação só podia ser Incluída/Fixada/Arquivada — NÃO dava para EDITAR o texto.
--   A edição é feita direto na tabela (RLS autor-only já existente: user_id = auth.uid()); esta migration só
--   garante o "?" (RD-95) da ação de editar.
-- GAP p4 (exclusão rastreável): agency_anotacoes não tinha excluido_por e o "arquivar" não gravava audit_log_global.
--   Esta migration:
--     1) adiciona (aditiva, idempotente) a coluna excluido_por;
--     2) cria fn_agency_anotacao_arquivar(uuid): soft-delete com excluido_em + excluido_por = auth.uid() e
--        INSERT em audit_log_global (acao 'anotacao_arquivada'), guarda autor-only, idempotente (ja_arquivada).
-- Nada de dado de cliente é apagado/alterado; a anotação é privada do autor. RD-96: nomes/fluxo próprios.
-- Code: code-desenvolvedor-3

-- 1) Coluna aditiva de rastro (quem arquivou) — idempotente
ALTER TABLE public.agency_anotacoes
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Arquivar com rastro completo (RD-98 p4: nunca DELETE físico; QUEM e QUANDO + audit_log)
CREATE OR REPLACE FUNCTION public.fn_agency_anotacao_arquivar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row agency_anotacoes%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM agency_anotacoes WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'anotacao não encontrada'); END IF;

  -- A anotação é privada do autor (mesma guarda da RLS agency_anotacoes_autor: user_id = auth.uid()).
  IF v_row.user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- Guarda de empresa do REGISTRO (check_fn_guards regra 4): defesa em profundidade além do autor-only.
  PERFORM public.fn__guarda_empresa(v_row.company_id);

  -- Idempotência: já arquivada → nada a fazer
  IF v_row.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_arquivada', true);
  END IF;

  -- RD-98 p4: rastro de quem/quando arquivou + valor anterior
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_anotacoes', p_id::text,
          'anotacao_arquivada',
          jsonb_build_object('texto', v_row.texto, 'fixada', v_row.fixada, 'job_id', v_row.job_id),
          jsonb_build_object('arquivada', true, 'excluido_por', v_uid));

  -- soft-delete — a listagem (meu-dia) já filtra excluido_em IS NULL
  UPDATE agency_anotacoes
     SET excluido_em = now(), excluido_por = v_uid, atualizado_em = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Guarda de função SECURITY DEFINER (check_fn_guards · regra 1 · revoke_anon): REVOKE/GRANT explícito.
REVOKE ALL ON FUNCTION public.fn_agency_anotacao_arquivar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_anotacao_arquivar(uuid) TO authenticated, service_role;

-- 3) RD-95: "?" da ação de EDITAR anotação (texto do banco, abre sem sair da tela)
INSERT INTO public.erp_ajuda_campo
  (rota, chave, grupo, ordem, rotulo, status, versao, exemplo, vertical, erro_comum, para_que_serve, o_que_preencher)
VALUES
  ('/dashboard/pm/meu-dia', 'pm.dia.anotacao.editar', 'Meu dia', 42, 'Editar anotação', 'publicado', 1,
   'Corrigir "ligar às 15h" para "16h" sem apagar e criar de novo.', 'pm',
   'Editar não avisa ninguém — a anotação continua só sua.',
   'Ajusta o texto de uma anotação já guardada, mantendo o histórico (atualizado em).',
   'Clique no lápis, corrija o texto e salve.')
ON CONFLICT (chave) DO NOTHING;
