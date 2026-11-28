-- PS EHS · EHS-7 / M11 (/dashboard/ehs/trabalhos-risco/permissoes) — Permissão de Trabalho (PT).
-- RD-98 fecha os gaps que o PDCA (auditor_pdca_1, 28/11, pós #6451) reconfirmou no código vivo:
--   * p4 — DELETE FÍSICO das medidas de controle: a tela fazia
--     supabase.from('ehs_pt_medida').delete().eq('pt_id', ...) a cada edição, apagando a prova
--     de tratamento do risco sem soft-delete, sem quem/quando e sem audit_log_global;
--   * p3 — ESCRITA DIRETA SEM RPC COM GUARDA: a tela gravava PT e medidas direto pelo client
--     (insert/update/update ativo=false), sem RPC com guarda de company_id/RLS/auditoria.
-- Este PR (mesmo padrão do #5988 / fn_ehs_posto_epi_*):
--   * ehs_permissao_trabalho e ehs_pt_medida ganham excluido_em/excluido_por (soft-delete; nunca
--     DELETE físico);
--   * fn_ehs_pt_salvar — cria/atualiza a PT e sincroniza as medidas (soft-delete das removidas,
--     insere as novas), tudo numa transação, com a MESMA guarda da RLS
--     (company_id IN get_user_company_ids() OR is_admin()) e rastro em audit_log_global;
--   * fn_ehs_pt_desativar — soft-delete rastreável da PT (excluido_em/por + motivo + auditoria).
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon. RLS das tabelas inalterada.
-- Base legal: NR-01 (GRO/PGR) e NRs de alto risco (NR-10/20/33/35) — a PT e suas medidas de
-- controle são registro de segurança e precisam de trilha de auditoria preservada.
-- Code: desenvolvedor_5_g

-- 1) Soft-delete rastreável (aditivo, idempotente)
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_permissao_trabalho ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_pt_medida          ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Criar/atualizar a PT + sincronizar as medidas (soft-delete das removidas; nunca DELETE físico)
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_id uuid, p_company_id uuid, p_campos jsonb, p_medidas jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_pt_id  uuid := p_id;
  v_titulo text := nullif(btrim(p_campos->>'titulo'), '');
  v_ini    timestamptz := nullif(p_campos->>'data_inicio', '')::timestamptz;
  v_fim    timestamptz := nullif(p_campos->>'data_fim', '')::timestamptz;
  v_novo   boolean := p_id IS NULL;
  v_n      int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF v_titulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A tarefa (título) é obrigatória'); END IF;
  IF v_ini IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O fim da validade não pode ser antes do início'); END IF;

  IF v_novo THEN
    INSERT INTO ehs_permissao_trabalho (
      company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
      responsavel_emissao, executantes, status, observacoes)
    VALUES (
      p_company_id,
      nullif(btrim(p_campos->>'numero'), ''),
      COALESCE(nullif(btrim(p_campos->>'tipo'), ''), 'geral'),
      v_titulo,
      nullif(btrim(p_campos->>'descricao'), ''),
      nullif(btrim(p_campos->>'local'), ''),
      nullif(btrim(p_campos->>'setor'), ''),
      v_ini, v_fim,
      nullif(btrim(p_campos->>'responsavel_emissao'), ''),
      nullif(btrim(p_campos->>'executantes'), ''),
      COALESCE(nullif(btrim(p_campos->>'status'), ''), 'rascunho'),
      nullif(btrim(p_campos->>'observacoes'), ''))
    RETURNING id INTO v_pt_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM ehs_permissao_trabalho
                    WHERE id = p_id AND company_id = p_company_id AND ativo = true) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'permissão de trabalho não encontrada nesta empresa'); END IF;
    UPDATE ehs_permissao_trabalho SET
      numero = nullif(btrim(p_campos->>'numero'), ''),
      tipo   = COALESCE(nullif(btrim(p_campos->>'tipo'), ''), 'geral'),
      titulo = v_titulo,
      descricao = nullif(btrim(p_campos->>'descricao'), ''),
      local  = nullif(btrim(p_campos->>'local'), ''),
      setor  = nullif(btrim(p_campos->>'setor'), ''),
      data_inicio = v_ini,
      data_fim    = v_fim,
      responsavel_emissao = nullif(btrim(p_campos->>'responsavel_emissao'), ''),
      executantes = nullif(btrim(p_campos->>'executantes'), ''),
      status = COALESCE(nullif(btrim(p_campos->>'status'), ''), status),
      observacoes = nullif(btrim(p_campos->>'observacoes'), ''),
      atualizado_em = now()
    WHERE id = p_id;
  END IF;

  -- Sincroniza as medidas: soft-delete das vivas (preserva a prova), insere as enviadas.
  UPDATE ehs_pt_medida
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE pt_id = v_pt_id AND ativo = true AND excluido_em IS NULL;

  INSERT INTO ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
  SELECT p_company_id, v_pt_id, t.ord::int, btrim(t.m->>'descricao'),
         COALESCE((t.m->>'atendido')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_medidas, '[]'::jsonb))
         WITH ORDINALITY AS t(m, ord)
   WHERE btrim(COALESCE(t.m->>'descricao', '')) <> '';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_pt_id,
          CASE WHEN v_novo THEN 'pt_criar' ELSE 'pt_atualizar' END,
          jsonb_build_object('titulo', v_titulo, 'tipo', p_campos->>'tipo',
                             'status', p_campos->>'status', 'n_medidas', v_n));

  RETURN jsonb_build_object('ok', true, 'id', v_pt_id, 'n_medidas', v_n);
END $function$;

-- 3) Desativar a PT (soft-delete rastreável; nunca DELETE físico)
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_r      ehs_permissao_trabalho%ROWTYPE;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  SELECT * INTO v_r FROM ehs_permissao_trabalho WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'permissão de trabalho não encontrada'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF v_motivo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar'); END IF;
  IF v_r.ativo = false THEN RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE ehs_permissao_trabalho SET
    ativo = false,
    excluido_em = now(),
    excluido_por = v_uid,
    observacoes = left(COALESCE(observacoes || ' ', '') || '[desativada: ' || v_motivo || ']', 2000),
    atualizado_em = now()
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id, 'pt_desativar',
          jsonb_build_object('titulo', v_r.titulo, 'status', v_r.status, 'ativo', v_r.ativo),
          jsonb_build_object('excluido_em', now(), 'excluido_por', v_uid, 'motivo', v_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Trancar as RPCs (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid, text)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid, text)           TO authenticated, service_role;
