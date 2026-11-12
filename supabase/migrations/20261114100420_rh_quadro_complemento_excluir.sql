-- Chamado/auditor · /dashboard/industrial/rh/quadro · RD-98 p2 (excluir rastreável do complemento)
-- Gap do auditor: o quadro só tinha editar/salvar por linha, sem forma de REMOVER o complemento de uma
-- pessoa (cargo/setor/supervisor/salário) de modo rastreável. Esta migration é ADITIVA: cria a RPC de
-- EXCLUSÃO LÓGICA (soft-delete) do complemento, com os MESMOS guardas da fn_rh_pessoa_complemento_salvar
-- (acesso à empresa + fn__rh_pode_custo = RH/diretoria/admin), motivo obrigatório e trilha em
-- audit_log_global. Nada é apagado de verdade: grava excluido_em/excluido_por (recuperável).
-- LGPD: salário/CPF seguem sob o mesmo gate pode_custo; o audit só guarda cpf/matrícula/cargo/setor + motivo.

CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_excluir(
  p_company_id uuid,
  p_cpf text,
  p_matricula text,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cpf text; v_mat text; v_id uuid; v_motivo text; v_ant jsonb;
BEGIN
  -- Mesmos guardas da fn_rh_pessoa_complemento_salvar (RD-38: padrão vivo mirrorado).
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;

  v_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_mat := NULLIF(btrim(COALESCE(p_matricula, '')), '');

  -- Identidade idêntica à do salvar: CPF (11 dígitos) tem precedência; senão matrícula (linha sem cpf).
  IF length(v_cpf) = 11 THEN
    SELECT id, jsonb_build_object('cpf', cpf, 'matricula', matricula, 'cargo_id', cargo_id, 'setor_id', setor_id)
      INTO v_id, v_ant
      FROM rh_pessoa_complemento
     WHERE company_id = p_company_id AND excluido_em IS NULL AND cpf = v_cpf
     LIMIT 1;
  ELSIF v_mat IS NOT NULL THEN
    SELECT id, jsonb_build_object('cpf', cpf, 'matricula', matricula, 'cargo_id', cargo_id, 'setor_id', setor_id)
      INTO v_id, v_ant
      FROM rh_pessoa_complemento
     WHERE company_id = p_company_id AND excluido_em IS NULL AND cpf IS NULL AND matricula = v_mat
     LIMIT 1;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'identificacao_invalida');
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;

  UPDATE rh_pessoa_complemento
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now(), atualizado_por = auth.uid()
   WHERE id = v_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'rh_pessoa_complemento', v_id::text, 'excluir',
          v_ant, jsonb_build_object('excluido_em', now(), 'motivo', v_motivo));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- Segurança: nunca anon; só usuário autenticado (sob os guardas internos) e conexão de serviço.
REVOKE ALL ON FUNCTION public.fn_rh_pessoa_complemento_excluir(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_rh_pessoa_complemento_excluir(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_pessoa_complemento_excluir(uuid, text, text, text) TO authenticated, service_role;

-- RD-95: a nova ação "Excluir" da linha precisa do "?" com chave cadastrada.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'rh.quadro.excluir',
  '/dashboard/industrial/rh/quadro',
  'Quadro',
  'Excluir',
  'Remove o complemento desta pessoa (cargo, setor, supervisor e salário).',
  'Tira a pessoa do custo da folha quando o complemento foi lançado por engano ou a pessoa saiu. É exclusão lógica (recuperável) e fica registrada com o motivo; a pessoa continua no ponto/folha.',
  'Motivo: "lançado na empresa errada" ou "desligado em 11/2026".',
  'Excluir não apaga o histórico de ponto/folha — só o complemento (cargo/setor/salário) desta pessoa.',
  'industrial',
  17,
  1,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
