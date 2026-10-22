-- EHS — ARQUIVO MORTO (CEO 15/10 20:00) · PR 1: base no banco.
-- Code: gilberto-desenv · via revisada (toca trigger + RLS + dado de colaborador).
--  (3) Exclusão física bloqueada em TODAS as tabelas do EHS (só arquivar/inativar, com motivo, data e autor).
--  (4) Reativação (recontratação) sem perder o histórico: cada arquivamento/reativação fica em ehs_arquivo_evento.
--  (5) Acesso só para papéis de SST/gestão da empresa, com registro de quem consultou (LGPD).
-- Bypass de manutenção: o mesmo set_config('app.permitir_delete_fisico','on',true) já usado pela
-- fn_gold_sst_seed_reparar (demo) e pela trava P0 (RD-30). Nenhuma outra função apaga nessas tabelas.

-- 1) Colunas de desligamento (aditivas)
ALTER TABLE public.compliance_funcionarios
  ADD COLUMN IF NOT EXISTS desligamento_motivo         text,
  ADD COLUMN IF NOT EXISTS desligamento_registrado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS desligamento_registrado_por uuid;

-- 2) Trava de DELETE físico em todo o EHS
CREATE OR REPLACE FUNCTION public.fn_ehs_bloqueia_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('app.permitir_delete_fisico', true), '') <> 'on' THEN
    RAISE EXCEPTION 'EHS: exclusão física bloqueada em % — arquive/inative com motivo, data e autor (arquivo morto). registro=%',
      TG_TABLE_NAME, OLD.id
      USING HINT = 'Use fn_ehs_arquivar_funcionario. Manutenção deliberada: set_config(app.permitir_delete_fisico,on,true).';
  END IF;
  RETURN OLD;
END $$;

-- 3) Log de arquivamento/reativação/consulta/dossiê (append-only)
CREATE TABLE IF NOT EXISTS public.ehs_arquivo_evento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  funcionario_id uuid REFERENCES public.compliance_funcionarios(id),
  tipo           text NOT NULL CHECK (tipo IN ('arquivado','reativado','consulta_lista','consulta_historico','dossie_emitido')),
  motivo         text,
  detalhe        jsonb NOT NULL DEFAULT '{}'::jsonb,
  autor_id       uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ehs_arquivo_evento_func ON public.ehs_arquivo_evento (funcionario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ehs_arquivo_evento_emp  ON public.ehs_arquivo_evento (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_ehs_evento_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ehs_arquivo_evento é append-only (LGPD/auditoria)';
END $$;
DROP TRIGGER IF EXISTS trg_ehs_evento_append_only ON public.ehs_arquivo_evento;
CREATE TRIGGER trg_ehs_evento_append_only BEFORE UPDATE ON public.ehs_arquivo_evento
  FOR EACH ROW EXECUTE FUNCTION public.fn_ehs_evento_append_only();

-- 4) Quem pode acessar o arquivo: papéis de SST/gestão vinculados à empresa (ou PS_ADMIN)
CREATE OR REPLACE FUNCTION public.fn_ehs_arquivo_pode(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND p_company IS NOT NULL AND (
    EXISTS (SELECT 1 FROM user_companies uc
             WHERE uc.user_id = auth.uid() AND uc.company_id = p_company
               AND uc.role IN ('socio','acesso_total','adm','admin','owner','rh_industrial','gerente'))
    OR (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))
        AND p_company IN (SELECT get_user_company_ids()))
  )
$$;

ALTER TABLE public.ehs_arquivo_evento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehs_arquivo_evento_select ON public.ehs_arquivo_evento;
CREATE POLICY ehs_arquivo_evento_select ON public.ehs_arquivo_evento
  FOR SELECT TO authenticated USING (public.fn_ehs_arquivo_pode(company_id));
REVOKE ALL ON public.ehs_arquivo_evento FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ehs_arquivo_evento TO authenticated;

-- 5) Instala o trigger de DELETE em todas as tabelas do EHS
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname ~ '^(compliance_|epi_|nr36_)' OR c.relname IN ('nr_treinamento_tipo','nr_turma','nr_turma_presenca','ehs_arquivo_evento'))
       AND c.relname <> 'compliance_funcionarios'  -- já tem trg_bloqueia_delete_fisico (RD-30), mesmo bypass
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ehs_bloqueia_delete ON public.%I', r.relname);
    EXECUTE format('CREATE TRIGGER trg_ehs_bloqueia_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ehs_bloqueia_delete()', r.relname);
  END LOOP;
END $$;

-- 6) Arquivar (desligar) colaborador — "excluir" na tela vira "arquivar"
CREATE OR REPLACE FUNCTION public.fn_ehs_arquivar_funcionario(p_funcionario uuid, p_motivo text, p_data date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f compliance_funcionarios%ROWTYPE;
BEGIN
  SELECT * INTO f FROM compliance_funcionarios WHERE id = p_funcionario;
  IF NOT FOUND OR NOT public.fn_ehs_arquivo_pode(f.company_id) THEN
    RAISE EXCEPTION 'sem acesso ao arquivo de colaboradores' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_motivo,''))) < 3 THEN
    RAISE EXCEPTION 'informe o motivo do desligamento';
  END IF;
  IF NOT f.ativo THEN
    RETURN jsonb_build_object('ok', true, 'ja_arquivado', true);
  END IF;
  UPDATE compliance_funcionarios
     SET ativo = false, data_demissao = COALESCE(p_data, current_date),
         desligamento_motivo = btrim(p_motivo), desligamento_registrado_em = now(),
         desligamento_registrado_por = auth.uid()
   WHERE id = f.id;
  INSERT INTO ehs_arquivo_evento (company_id, funcionario_id, tipo, motivo, detalhe)
  VALUES (f.company_id, f.id, 'arquivado', btrim(p_motivo),
          jsonb_build_object('data_desligamento', COALESCE(p_data, current_date),
                             'setor', f.setor, 'setor_id', f.setor_id, 'funcao', f.funcao, 'cargo', f.cargo,
                             'matricula', f.matricula));
  RETURN jsonb_build_object('ok', true, 'ja_arquivado', false);
END $$;

-- 7) Reativar (recontratação) — histórico anterior permanece nos eventos e nas tabelas
CREATE OR REPLACE FUNCTION public.fn_ehs_reativar_funcionario(p_funcionario uuid, p_motivo text, p_data_admissao date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f compliance_funcionarios%ROWTYPE;
BEGIN
  SELECT * INTO f FROM compliance_funcionarios WHERE id = p_funcionario;
  IF NOT FOUND OR NOT public.fn_ehs_arquivo_pode(f.company_id) THEN
    RAISE EXCEPTION 'sem acesso ao arquivo de colaboradores' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_motivo,''))) < 3 THEN
    RAISE EXCEPTION 'informe o motivo da reativação';
  END IF;
  IF f.ativo THEN
    RETURN jsonb_build_object('ok', true, 'ja_ativo', true);
  END IF;
  INSERT INTO ehs_arquivo_evento (company_id, funcionario_id, tipo, motivo, detalhe)
  VALUES (f.company_id, f.id, 'reativado', btrim(p_motivo),
          jsonb_build_object('desligamento_anterior', f.data_demissao, 'motivo_anterior', f.desligamento_motivo,
                             'nova_admissao', COALESCE(p_data_admissao, current_date)));
  UPDATE compliance_funcionarios
     SET ativo = true, data_admissao = COALESCE(p_data_admissao, current_date), data_demissao = NULL,
         desligamento_motivo = NULL, desligamento_registrado_em = NULL, desligamento_registrado_por = NULL
   WHERE id = f.id;
  RETURN jsonb_build_object('ok', true, 'ja_ativo', false);
END $$;

-- 8) Listar desligados (busca por nome/matrícula/CPF parcial); CPF sempre mascarado; consulta fica registrada
CREATE OR REPLACE FUNCTION public.fn_ehs_arquivo_listar(p_company uuid, p_busca text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_busca text := NULLIF(btrim(coalesce(p_busca,'')), '');
        v_dig text; v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1),100); v_itens jsonb; v_total int;
BEGIN
  IF NOT public.fn_ehs_arquivo_pode(p_company) THEN
    RAISE EXCEPTION 'sem acesso ao arquivo de colaboradores' USING ERRCODE = '42501';
  END IF;
  v_dig := regexp_replace(coalesce(v_busca,''), '\D', '', 'g');
  WITH base AS (
    SELECT f.* FROM compliance_funcionarios f
     WHERE f.company_id = p_company AND f.ativo = false
       AND (v_busca IS NULL
            OR f.nome_completo ILIKE '%' || v_busca || '%'
            OR f.matricula ILIKE '%' || v_busca || '%'
            OR (length(v_dig) >= 3 AND regexp_replace(coalesce(f.cpf,''), '\D', '', 'g') LIKE '%' || v_dig || '%'))
  ), pag AS (
    SELECT * FROM base ORDER BY data_demissao DESC NULLS LAST, nome_completo LIMIT v_lim OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'nome', nome_completo, 'matricula', matricula,
           'cpf_mascarado', CASE WHEN length(regexp_replace(coalesce(cpf,''),'\D','','g')) = 11
              THEN '***.' || substr(regexp_replace(cpf,'\D','','g'),4,3) || '.' || substr(regexp_replace(cpf,'\D','','g'),7,3) || '-**' END,
           'setor', setor, 'funcao', funcao, 'data_admissao', data_admissao,
           'data_desligamento', data_demissao, 'motivo', desligamento_motivo) ORDER BY data_demissao DESC NULLS LAST, nome_completo), '[]'::jsonb)
    INTO v_total, v_itens FROM pag;
  INSERT INTO ehs_arquivo_evento (company_id, tipo, detalhe)
  VALUES (p_company, 'consulta_lista', jsonb_build_object('com_busca', v_busca IS NOT NULL, 'total', v_total));
  RETURN jsonb_build_object('ok', true, 'total', v_total, 'itens', v_itens);
END $$;

REVOKE ALL ON FUNCTION public.fn_ehs_bloqueia_delete(), public.fn_ehs_evento_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ehs_arquivo_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_arquivo_pode(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ehs_arquivar_funcionario(uuid,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_arquivar_funcionario(uuid,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ehs_reativar_funcionario(uuid,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_reativar_funcionario(uuid,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ehs_arquivo_listar(uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_arquivo_listar(uuid,text,int,int) TO authenticated;
