-- Compliance · Funcionários (/dashboard/compliance/funcionarios) · RD-98 p2/p4 (Excluir rastreável)
-- A migration dev7 (20261111214115) já fechou RD-95 "?" dos filtros/colunas e RD-100 e origem do dado,
-- mas DEIXOU PENDENTE o RD-98 p2 "Excluir" (decisão sensível — soft-delete + audit).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente — colunas novas NULL por padrão)
-- entrega só esse complemento:
--   1) Soft-delete em compliance_funcionarios: colunas excluido_em / excluido_por.
--   2) fn_compliance_funcionario_arquivar / _restaurar: guardadas (auth + empregadora), com audit.
--      Nunca DELETE físico. 'ativo' (desligado) é conceito separado de 'excluido' (cadastro removido).
--   3) Chave de ajuda "?" (RD-95) do novo filtro "Cadastro" (ativos / excluídos) — padrão underscore.
-- Faixa de migration do code-desenvolvedor-3 (segundos :35), acima da main.

-- 1) Soft-delete (aditivo) ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.compliance_funcionarios
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Arquivar / Restaurar (soft-delete rastreável) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_arquivar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, nome_completo INTO v_company, v_nome
    FROM public.compliance_funcionarios WHERE id = p_id AND excluido_em IS NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Funcionário não encontrado ou já excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.compliance_funcionarios
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'compliance_funcionarios', p_id, 'arquivar',
            jsonb_build_object('excluido', false),
            jsonb_build_object('excluido', true, 'nome', v_nome, 'excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_restaurar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para restaurar'); END IF;
  SELECT company_id, nome_completo INTO v_company, v_nome
    FROM public.compliance_funcionarios WHERE id = p_id AND excluido_em IS NOT NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Funcionário não encontrado ou não está excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.compliance_funcionarios
     SET excluido_em = NULL, excluido_por = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'compliance_funcionarios', p_id, 'restaurar',
            jsonb_build_object('excluido', true),
            jsonb_build_object('excluido', false, 'nome', v_nome, 'restaurado_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_arquivar(uuid)  FROM anon;
REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_arquivar(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_restaurar(uuid) TO authenticated;

-- 3) RD-95 "?" do novo filtro "Cadastro" + ações Excluir/Restaurar da tela de detalhe (idempotente) ──────────
-- As chaves acao.excluir/acao.restaurar são referenciadas em funcionarios/[id]/page.tsx (rota
-- /dashboard/compliance/funcionarios, resolvida por fn_ajuda_campo_listar) — sem esta linha o "?" abria vazio.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compliance/funcionarios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.funcionarios.filtro_cadastro','Filtros','Cadastro','Escolha "Cadastros ativos" (em uso) ou "🗑 Excluídos" (arquivados).','Separa os cadastros em uso dos que foram excluídos — a exclusão é reversível.','"🗑 Excluídos" mostra os arquivados, com a opção Restaurar.','Procurar um cadastro excluído na lista de Ativos: ele só aparece em Excluídos.',7),
 ('compliance.funcionarios.acao.excluir','Ações','Excluir','Clique para arquivar (excluir) este cadastro de funcionário.','Remove o cadastro da lista de ativos sem apagar o histórico — a exclusão é reversível e fica registrada (quem/quando).','Depois de excluir, o cadastro aparece no filtro "🗑 Excluídos", de onde pode ser Restaurado.','Achar que o dado foi perdido: nada é apagado de verdade, só arquivado; use Restaurar para voltar.',8),
 ('compliance.funcionarios.acao.restaurar','Ações','Restaurar','Clique para reverter a exclusão e trazer o cadastro de volta aos ativos.','Desfaz o arquivamento — o cadastro volta a aparecer na lista de "Cadastros ativos".','Some do filtro "🗑 Excluídos" e reaparece nos ativos, com o registro de quem restaurou.','Procurar o botão Restaurar na aba de ativos: ele só aparece no cadastro já excluído.',9)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
