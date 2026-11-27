-- PDCA Hub · /dashboard/projetos/catalogo/[id] — RD-98 pilar 4 (exclusão rastreável) no BOM do serviço.
--
-- GAP (auditor_pdca_1): BomEditor.removerLinha fazia DELETE FÍSICO direto no client
-- (supabase.from('projetos_servicos_bom').delete().eq('id', ...)). A composição sumia sem quem/quando/
-- motivo e sem audit_log. É o mesmo padrão que a #5988 corrigiu nos subitens do EHS.
--
-- DECISÃO DE DESENHO (zero-regressão): projetos_servicos_bom é lido por ~20 funções de núcleo
-- (recálculo de custo, precificação de montagem, fork/duplicar/importar catálogo, reserva de material,
-- produtividade, simulação). Um soft-delete IN-PLACE (deleted_at) obrigaria a filtrar `deleted_at IS NULL`
-- em TODAS elas; qualquer uma esquecida RESSUSCITA o item (ex.: fn_projetos_fork_servico copia a linha
-- como viva) ou REPRECIFICA com o fantasma — regressão silenciosa. Em vez disso, a exclusão passa por uma
-- RPC SECURITY DEFINER que (1) guarda por empresa, (2) grava o SNAPSHOT durável em
-- projetos_servicos_bom_excluido + audit_log_global (rastro e recuperação) e (3) remove a linha VIVA.
-- Assim os 20 leitores já tratam o item como ausente por construção, e a exclusão fica 100% rastreável.
-- O trigger AFTER DELETE (trg_bom_recalcular_servico) recalcula o custo do serviço na hora.
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon. Nenhum dado de cliente é alterado.
-- Code: code-desenvolvedor-3

-- 1) Histórico durável da exclusão (rastro + recuperação). Tabela nova, RLS por empresa, só a RPC escreve.
CREATE TABLE IF NOT EXISTS public.projetos_servicos_bom_excluido (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id      uuid NOT NULL,
  servico_id  uuid NOT NULL,
  company_id  uuid,
  snapshot    jsonb NOT NULL,
  motivo      text,
  excluido_por uuid,
  excluido_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bom_excluido_servico ON public.projetos_servicos_bom_excluido (servico_id);
CREATE INDEX IF NOT EXISTS ix_bom_excluido_company ON public.projetos_servicos_bom_excluido (company_id);

ALTER TABLE public.projetos_servicos_bom_excluido ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da empresa do serviço (ou admin). Sem policy de INSERT/UPDATE/DELETE: só a RPC SECDEF grava.
DROP POLICY IF EXISTS bom_excluido_select ON public.projetos_servicos_bom_excluido;
CREATE POLICY bom_excluido_select ON public.projetos_servicos_bom_excluido
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON public.projetos_servicos_bom_excluido FROM anon;
GRANT SELECT ON public.projetos_servicos_bom_excluido TO authenticated;
GRANT ALL  ON public.projetos_servicos_bom_excluido TO service_role;

-- 2) EXCLUIR item do BOM, rastreável (snapshot + audit_log; nunca some sem rastro)
CREATE OR REPLACE FUNCTION public.fn_projetos_bom_excluir(p_bom_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row projetos_servicos_bom%ROWTYPE;
  v_company uuid;
  v_publico boolean;
BEGIN
  SELECT * INTO v_row FROM projetos_servicos_bom WHERE id = p_bom_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true);  -- idempotente
  END IF;

  SELECT company_id, COALESCE(is_publico, false) INTO v_company, v_publico
  FROM projetos_servicos WHERE id = v_row.servico_id;

  -- Guarda: só membro da empresa do serviço (ou admin). Serviço público não se edita pela tela.
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso ao serviço');
  END IF;

  -- Rastro durável ANTES de remover (snapshot completo da linha)
  INSERT INTO projetos_servicos_bom_excluido (bom_id, servico_id, company_id, snapshot, motivo, excluido_por)
  VALUES (v_row.id, v_row.servico_id, v_company, to_jsonb(v_row), NULLIF(btrim(p_motivo), ''), v_uid);

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'projetos_servicos_bom', v_row.id, 'bom_item_excluir',
          to_jsonb(v_row),
          jsonb_build_object('excluido_por', v_uid, 'excluido_em', now(), 'motivo', NULLIF(btrim(p_motivo), '')));

  -- Remove a linha viva (o trigger AFTER DELETE recalcula o custo do serviço)
  DELETE FROM projetos_servicos_bom WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'servico_id', v_row.servico_id);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_bom_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_bom_excluir(uuid, text) TO authenticated, service_role;
