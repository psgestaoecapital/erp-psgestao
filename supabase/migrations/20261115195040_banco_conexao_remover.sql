-- Remover / Revogar conexão bancária (RD-98 p2/p4) · Code: code-desenvolvedor-3
--
-- Origem: auditor_pdca_2 (jornada GE · /dashboard/financeiro/conexoes-bancarias). A tela conecta
-- bancos por API (credenciais cifradas no Vault) mas NÃO tinha como REMOVER/REVOGAR uma conexão —
-- necessário para trocar/encerrar banco ou revogar credencial comprometida. A remoção precisa ser
-- SOFT-DELETE rastreável (quem removeu, quando, audit_log_global) e REVOGAR os segredos no Vault,
-- nunca DELETE físico da credencial nem segredo órfão no cofre.
--
-- ADITIVA: colunas novas NULLABLE (deleted_at/deleted_by), função nova de remoção e um trigger
-- de invariante. NÃO altera dado de cliente, NÃO altera título. RLS da tabela inalterada
-- (a função é SECURITY DEFINER com guarda de empresa; a tela passa a filtrar deleted_at IS NULL).
--
-- RD-38 (provado antes do merge, BEGIN…ROLLBACK, timeout curto):
--   - erp_banco_provider_config NÃO tinha deleted_at/deleted_by (0 ocorrências) → aditiva.
--   - Em produção há credenciais REAIS: a prova pesada (revogar de fato) roda em cópia local /
--     @pos-migration contra linha sintética; na produção só confirmo additividade + compilação.

-- 1) Soft-delete rastreável (colunas aditivas) -------------------------------------------
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
COMMENT ON COLUMN public.erp_banco_provider_config.deleted_at IS
  'Soft-delete da conexão (revogada). NULL = ativa/visível. Nunca DELETE físico de credencial.';

-- 2) Invariante: uma conexão ATIVA nunca fica marcada como removida ------------------------
-- Mantém a correção do caso "reconectar o mesmo banco depois de remover": o salvar_credencial
-- faz UPSERT na mesma linha (company_id, banco_codigo, ambiente) e põe ativo=true; este trigger
-- garante que, ficando ativa, a marca de remoção cai sozinha (sem reescrever o salvar_credencial).
CREATE OR REPLACE FUNCTION public.fn_banco_config_ativo_sem_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.ativo IS TRUE THEN
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_banco_config_ativo_sem_delete ON public.erp_banco_provider_config;
CREATE TRIGGER trg_banco_config_ativo_sem_delete
  BEFORE INSERT OR UPDATE ON public.erp_banco_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_banco_config_ativo_sem_delete();

-- 3) Remover / Revogar conexão ------------------------------------------------------------
-- Guarda fail-closed: usuário autenticado com acesso à empresa da conexão. Revoga TODOS os
-- segredos no Vault (client_secret, cert, cert_senha, api_key, webhook) e anula as referências na
-- linha para não deixar segredo órfão; soft-delete + estado 'revogado' + inativa + audit_log_global.
CREATE OR REPLACE FUNCTION public.fn_banco_conexao_remover(p_config_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_uid uuid;
  v_cfg record;
  v_vault_ids uuid[];
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida');
  END IF;

  SELECT * INTO v_cfg FROM public.erp_banco_provider_config WHERE id = p_config_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conexao nao encontrada');
  END IF;

  -- guarda de empresa do REGISTRO (fail-closed; RAISE 'Sem acesso a esta empresa' se o usuário não tem a empresa)
  PERFORM public.fn__guarda_empresa(v_cfg.company_id);

  IF v_cfg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_removida', true);
  END IF;

  -- segredos do Vault a revogar (só os preenchidos)
  v_vault_ids := ARRAY(
    SELECT x FROM unnest(ARRAY[
      v_cfg.client_secret_vault_id, v_cfg.cert_vault_id, v_cfg.cert_senha_vault_id,
      v_cfg.api_key_vault_id, v_cfg.webhook_secret_vault_id
    ]) AS x WHERE x IS NOT NULL
  );
  IF array_length(v_vault_ids, 1) IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = ANY(v_vault_ids);
  END IF;

  -- soft-delete + anula referências de segredo + marca revogada + inativa
  UPDATE public.erp_banco_provider_config
     SET deleted_at = now(), deleted_by = v_uid, ativo = false,
         estado_conexao = 'revogado', estado_atualizado_em = now(),
         client_secret_vault_id = NULL, cert_vault_id = NULL, cert_senha_vault_id = NULL,
         api_key_vault_id = NULL, webhook_secret_vault_id = NULL,
         updated_at = now(), updated_by = v_uid
   WHERE id = p_config_id;

  v_email := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_cfg.company_id, v_uid, v_email, 'erp_banco_provider_config', p_config_id::text, 'remover_conexao_banco',
    jsonb_build_object('provider', v_cfg.provider, 'banco_codigo', v_cfg.banco_codigo,
      'ambiente', v_cfg.ambiente, 'ativo', v_cfg.ativo,
      'segredos_revogados', COALESCE(array_length(v_vault_ids, 1), 0)),
    jsonb_build_object('deleted_at', now(), 'estado_conexao', 'revogado')
  );

  RETURN jsonb_build_object('ok', true, 'segredos_revogados', COALESCE(array_length(v_vault_ids, 1), 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_banco_conexao_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_conexao_remover(uuid) TO authenticated, service_role;

-- 4) RD-95: "?" da ação de remover/revogar ----------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('banco.remover_conexao','/dashboard/financeiro/conexoes-bancarias','Conexão','Remover / Revogar conexão',
   'Use para encerrar a conexão com um banco: quando trocar de banco, parar de usar a integração ou precisar revogar uma credencial que possa ter sido comprometida. Pede confirmação antes.',
   'Revoga (apaga) os segredos guardados no cofre (Vault) e marca a conexão como removida — ela some da lista e para de sincronizar. Fica registrado quem removeu e quando. Os extratos e boletos já importados NÃO são apagados.',
   'Você trocou o banco de cobrança: remova a conexão antiga para que ninguém use as credenciais vencidas.',
   'Remover não apaga seu histórico de extratos/boletos — só encerra a conexão. Para voltar a usar o mesmo banco depois, basta Conectar de novo e informar as credenciais.',
   'ge', 80, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
