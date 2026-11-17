-- Industrial · Folha de Pagamento (/dashboard/industrial/folha) · RD-98 pilar 2 (excluir) + pilar 4 (rastro).
-- Auditoria aud8 (11/11): a tela importa a folha por competência mas NÃO deixava EXCLUIR uma competência
-- importada por engano — o arquivo errado ficava para sempre (só um re-upload da MESMA competência regravava).
-- Esta PR fecha o gap com uma RPC guardada de exclusão rastreável + o botão na tela. Code: desenvolvedor_4_g.
--
-- POR QUE EXCLUSÃO FÍSICA (e não soft-delete): o fluxo de importação já trata a competência como
-- SUBSTITUÍVEL — /api/industrial/folha/upload faz DELETE físico de folha_competencia/folha_verba da
-- (company_id, competencia) e reinsere a cada upload. Além disso as agregações de núcleo
-- (fn_custo_folha_setor, fn_turnover_periodo) e os leitores (mão de obra, produtividade, BI de Gente)
-- leem folha_competencia SEM conceito de "excluído". Um soft-delete criaria divergência (linhas
-- marcadas apareceriam nessas agregações) e exigiria tocar núcleo. A exclusão física é consistente com
-- o "regrava no re-upload" já existente; o rastro completo (quem, quando, o que havia) fica em
-- audit_log_global — RD-98 pilar 4 atendido sem apagar o histórico de auditoria.
--
-- Segurança: SECURITY DEFINER com a MESMA guarda da leitura (company_id do usuário + fn__pode_ver_folha,
-- que restringe folha a RH/diretoria — LGPD/salário). Escopo por company_id (RD-45). REVOKE anon. ADITIVO.

CREATE OR REPLACE FUNCTION public.fn_folha_competencia_excluir(
  p_company_id uuid, p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_funcs int;
  v_total numeric;
  v_verbas int;
BEGIN
  -- guarda: a empresa é do usuário E ele tem direito de ver folha (RH/diretoria). Mesma régua da leitura.
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT fn__pode_ver_folha(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'acesso à folha restrito ao RH e à diretoria');
  END IF;
  IF p_competencia IS NULL OR p_competencia = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe a competência a excluir');
  END IF;

  SELECT count(*), COALESCE(sum(total_geral), 0)
    INTO v_funcs, v_total
    FROM folha_competencia
   WHERE company_id = p_company_id AND competencia = p_competencia;

  IF v_funcs = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'competência não encontrada para esta empresa');
  END IF;

  SELECT count(*) INTO v_verbas
    FROM folha_verba
   WHERE company_id = p_company_id AND competencia = p_competencia;

  -- verbas primeiro (FK folha_competencia_id), depois a competência.
  DELETE FROM folha_verba
   WHERE company_id = p_company_id AND competencia = p_competencia;
  DELETE FROM folha_competencia
   WHERE company_id = p_company_id AND competencia = p_competencia;

  -- rastro completo (RD-98 pilar 4): guarda o que existia antes de apagar.
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'folha_competencia', p_competencia, 'folha_competencia_excluir',
          jsonb_build_object('competencia', p_competencia, 'funcionarios', v_funcs,
                             'total_geral', v_total, 'verbas', v_verbas),
          jsonb_build_object('excluida_em', now(), 'excluida_por', v_uid));

  RETURN jsonb_build_object('ok', true, 'funcionarios', v_funcs, 'verbas', v_verbas, 'total_geral', v_total);
END $function$;

-- Trancar (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_folha_competencia_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_folha_competencia_excluir(uuid, text) TO authenticated, service_role;

-- Ajuda (RD-95) da ação nova
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('industrial.folha.excluir', '/dashboard/industrial/folha', 'Folha · Ações', 'Excluir competência',
  'Não preenche nada — é uma ação. Remove por completo a folha de uma competência importada por engano (todos os funcionários e verbas daquele mês).',
  'Corrigir um upload errado sem precisar re-subir por cima. A exclusão é rastreável: quem excluiu, quando e o que havia (funcionários, total, verbas) fica registrado na auditoria.',
  'Subiu a planilha de 09/2026 no lugar de 10/2026 → Excluir competência 09/2026 → suba o arquivo certo.',
  'Excluir a competência certa achando que era a errada: confira o mês/ano e o total antes de confirmar. Se precisar, basta reimportar o arquivo.',
  'industrial', 10, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();

-- Origem do dado (RD-98 pilar 3): registrar a RPC nova no catálogo da tela
UPDATE public.system_screens
   SET rpcs_chamadas = (
         SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn__pode_ver_folha','fn_folha_competencia_excluir']))),
       atualizado_em = now()
 WHERE rota = '/dashboard/industrial/folha';
