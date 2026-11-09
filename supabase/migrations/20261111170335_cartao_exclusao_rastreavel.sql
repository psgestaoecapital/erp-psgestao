-- GE · Cartões/Adquirentes · exclusão RASTREÁVEL (PDCA auditor_pdca_2 · /dashboard/financeiro/cartoes)
-- Laudo RD-98 p2 (CRUD incompleto: Excluir AUSENTE) + p4 (exclusão rastreável): hoje não há como
-- excluir adquirente/taxa (só adquirente_salvar/taxa_salvar), e as tabelas não têm deleted_at.
--
-- FIX aditivo (não altera dado existente, idempotente, REVOKE anon):
--   * ADD deleted_at/deleted_by em erp_cartao_adquirente e erp_cartao_taxa (soft-delete, nunca DELETE físico).
--   * fn_cartao_adquirente_excluir / fn_cartao_taxa_excluir: soft-delete + trilha em audit_log_global.
--     - Adquirente com REPASSE EM ABERTO (erp_receber.eh_repasse_cartao, status aberto/vencido) é BLOQUEADA,
--       com motivo honesto (RD-51) — não some com dinheiro a conciliar.
--   * fn_cartao_adquirente_listar / fn_cartao_taxa_listar passam a esconder deleted_at IS NOT NULL (byte-idêntico
--     fora isso). Motor fn_cartao_calcular / fn_cartao_registrar_recebimento INTACTOS (P5 anti-regressão).
--   * RD-95: chave de ajuda da nova busca de adquirente.
-- Faixa de migration do code-desenvolvedor-3 (segundos :35), acima da main.

-- 1) Colunas de soft-delete (aditivas)
ALTER TABLE public.erp_cartao_adquirente ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.erp_cartao_adquirente ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.erp_cartao_taxa       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.erp_cartao_taxa       ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) listar: esconder os excluídos (único delta vs. versão viva)
CREATE OR REPLACE FUNCTION public.fn_cartao_adquirente_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok',true,'adquirentes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'conta_bancaria_id',conta_bancaria_id,'documento',documento,'observacao',observacao,'ativo',ativo) ORDER BY nome)
    FROM erp_cartao_adquirente WHERE company_id=p_company_id AND ativo AND deleted_at IS NULL),'[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_cartao_taxa_listar(p_company_id uuid, p_adquirente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok',true,'taxas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',id,'adquirente_id',adquirente_id,'bandeira',bandeira,
      'modalidade',modalidade,'parcelas_de',parcelas_de,'parcelas_ate',parcelas_ate,
      'taxa_percentual',taxa_percentual,'prazo_repasse_dias',prazo_repasse_dias)
      ORDER BY bandeira, modalidade, parcelas_de)
    FROM erp_cartao_taxa WHERE company_id=p_company_id AND ativo
      AND deleted_at IS NULL
      AND (p_adquirente_id IS NULL OR adquirente_id=p_adquirente_id)),'[]'::jsonb));
END $function$;

-- 3) EXCLUIR adquirente — soft-delete; bloqueia se houver repasse de cartão EM ABERTO
CREATE OR REPLACE FUNCTION public.fn_cartao_adquirente_excluir(p_company_id uuid, p_adquirente_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_abertos int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT nome INTO v_nome FROM erp_cartao_adquirente
   WHERE id=p_adquirente_id AND company_id=p_company_id AND deleted_at IS NULL;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','adquirente não encontrada'); END IF;

  SELECT count(*) INTO v_abertos FROM erp_receber r
   WHERE r.company_id=p_company_id AND r.adquirente_id=p_adquirente_id
     AND r.eh_repasse_cartao AND r.status IN ('aberto','vencido') AND r.deleted_at IS NULL;
  IF v_abertos > 0 THEN
    RETURN jsonb_build_object('ok',false,'erro',
      'Esta adquirente tem '||v_abertos||' repasse(s) de cartão em aberto. Concilie ou baixe os repasses antes de excluir.');
  END IF;

  UPDATE erp_cartao_adquirente
     SET deleted_at=now(), deleted_by=v_uid, ativo=false, updated_at=now()
   WHERE id=p_adquirente_id AND company_id=p_company_id;
  -- taxas da adquirente acompanham (soft-delete em cascata, auditável)
  UPDATE erp_cartao_taxa
     SET deleted_at=now(), deleted_by=v_uid, ativo=false, updated_at=now()
   WHERE adquirente_id=p_adquirente_id AND company_id=p_company_id AND deleted_at IS NULL;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'erp_cartao_adquirente', p_adquirente_id::text,
          'cartao_adquirente_excluir', jsonb_build_object('nome',v_nome,'ativo',true),
          jsonb_build_object('nome',v_nome,'ativo',false,'deleted_at',now()));

  RETURN jsonb_build_object('ok',true,'nome',v_nome);
END $function$;

-- 4) EXCLUIR taxa — soft-delete
CREATE OR REPLACE FUNCTION public.fn_cartao_taxa_excluir(p_company_id uuid, p_taxa_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_desc text;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT (bandeira||' '||modalidade||' '||parcelas_de||'-'||parcelas_ate||'x') INTO v_desc
    FROM erp_cartao_taxa WHERE id=p_taxa_id AND company_id=p_company_id AND deleted_at IS NULL;
  IF v_desc IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','taxa não encontrada'); END IF;

  UPDATE erp_cartao_taxa
     SET deleted_at=now(), deleted_by=v_uid, ativo=false, updated_at=now()
   WHERE id=p_taxa_id AND company_id=p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'erp_cartao_taxa', p_taxa_id::text,
          'cartao_taxa_excluir', jsonb_build_object('desc',v_desc,'ativo',true),
          jsonb_build_object('desc',v_desc,'ativo',false,'deleted_at',now()));

  RETURN jsonb_build_object('ok',true,'desc',v_desc);
END $function$;

-- 5) Trancar as RPCs (sem anon) — inclui as listar redefinidas acima (check_fn_guards exige REVOKE por função DEFINER)
REVOKE ALL ON FUNCTION public.fn_cartao_adquirente_excluir(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cartao_taxa_excluir(uuid, uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cartao_adquirente_listar(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cartao_taxa_listar(uuid, uuid)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cartao_adquirente_excluir(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cartao_taxa_excluir(uuid, uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cartao_adquirente_listar(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cartao_taxa_listar(uuid, uuid)        TO authenticated, service_role;

-- 6) RD-95: chave de ajuda da nova busca de adquirente
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES ('financeiro.cartoes.busca_adquirente', '/dashboard/financeiro/cartoes', 'Adquirentes', 'Buscar adquirente',
        'Digite parte do nome da adquirente para filtrar a lista.',
        'Acha rápido uma adquirente quando há muitas cadastradas, sem rolar a lista inteira.',
        'Digite "Cielo" para ver só as adquirentes com esse nome.',
        'Buscar pelo CNPJ: a busca é pelo NOME da adquirente, não pelo documento.',
        'financeiro', 45)
ON CONFLICT (chave) DO NOTHING;
