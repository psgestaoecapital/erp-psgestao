-- Produtividade · Apontamento hora a hora: EXCLUSÃO RASTREÁVEL (RD-98 p2 CRUD "D" + p4 rastreável).
-- Gap do auditor em /dashboard/produtividade/apontamento: a grade posto×hora não tinha como
-- REMOVER um apontamento errado na tela. O "corrigir" já existia (relançar a mesma hora é upsert);
-- faltava o EXCLUIR. Aqui:
--   1) colunas de soft-delete (aditivo, nunca DROP) em prod_apontamento_hora;
--   2) a leitura (fn_prod_produtividade_hora) passa a IGNORAR linhas excluídas;
--   3) o lançamento (fn_prod_apontar_hora) REVIVE a linha se ela estava excluída (relançar desfaz a exclusão);
--   4) fn_prod_apontamento_hora_excluir — soft-delete rastreável (autor + audit_log_global), guarda por empresa/planta;
--   5) ajuda "?" (RD-95) das ações Corrigir/Excluir + origem RD-98 p3 (system_screens).
-- ADITIVA e idempotente. Não altera dado de cliente real (só marca deleted_at a pedido do usuário).
-- Code: dev7claudeps

-- 1) Soft-delete (aditivo) ---------------------------------------------------
ALTER TABLE public.prod_apontamento_hora
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_por uuid;

-- 2) Leitura ignora excluídos (CREATE OR REPLACE; só acrescenta o filtro deleted_at IS NULL) --
CREATE OR REPLACE FUNCTION public.fn_prod_produtividade_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'posto_numero', (linha->>'hora')::int), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'posto_id', a.posto_id,
      'posto_numero', po.numero,
      'hora', a.hora,
      'produzido', SUM(a.qtd_produzida),
      'capacidade', po.capacidade_hora,
      'produtividade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                                ELSE round((SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1) END,
      'ociosidade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                             ELSE greatest(0, round((1 - SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1)) END,
      'pessoas_presentes', MAX(a.pessoas_presentes)
    ) AS linha
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
      AND a.deleted_at IS NULL
    GROUP BY a.posto_id, po.numero, po.capacidade_hora, a.hora
  ) s;
  RETURN jsonb_build_object('ok', true, 'data', p_data, 'postos', v);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) TO authenticated, service_role;

-- 3) Lançar REVIVE a linha excluída (CREATE OR REPLACE; só acrescenta deleted_at/deleted_por = NULL no UPDATE) --
CREATE OR REPLACE FUNCTION public.fn_prod_apontar_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_produto_id uuid, p_data date, p_hora integer, p_qtd_produzida numeric, p_posto_id uuid DEFAULT NULL::uuid, p_etapa_id uuid DEFAULT NULL::uuid, p_tarefa_id uuid DEFAULT NULL::uuid, p_unidade text DEFAULT NULL::text, p_pessoas_presentes integer DEFAULT NULL::integer, p_fonte text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;
  IF p_qtd_produzida IS NULL OR p_qtd_produzida < 0 THEN RAISE EXCEPTION 'qtd_invalida'; END IF;
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto','balanca') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo f WHERE f.id = p_fluxo_id AND f.company_id = p_company_id AND f.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'fluxo_nao_encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_produto p WHERE p.id = p_produto_id AND p.company_id = p_company_id AND p.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  -- Validar as FKs opcionais contra a mesma empresa/planta (e a etapa contra o fluxo) quando informadas,
  -- para não aceitar referência cruzada de outra empresa.
  IF p_posto_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_posto po WHERE po.id = p_posto_id AND po.company_id = p_company_id AND po.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'posto_nao_encontrado'; END IF;
  IF p_etapa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_fluxo_etapa e WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.fluxo_id = p_fluxo_id)
  THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  INSERT INTO public.prod_apontamento_hora (company_id, plant_id, fluxo_id, etapa_id, tarefa_id, posto_id, produto_id,
      data, hora, qtd_produzida, unidade, pessoas_presentes, fonte, criado_por)
  VALUES (p_company_id, p_plant_id, p_fluxo_id, p_etapa_id, p_tarefa_id, p_posto_id, p_produto_id,
      p_data, p_hora, p_qtd_produzida, p_unidade, p_pessoas_presentes, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) DO UPDATE SET
      etapa_id = EXCLUDED.etapa_id, tarefa_id = EXCLUDED.tarefa_id, qtd_produzida = EXCLUDED.qtd_produzida,
      unidade = EXCLUDED.unidade, pessoas_presentes = EXCLUDED.pessoas_presentes, fonte = EXCLUDED.fonte,
      updated_at = now(),
      -- relançar DESFAZ uma exclusão anterior (a linha volta a valer)
      deleted_at = NULL, deleted_por = NULL
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) TO authenticated, service_role;

-- 4) Exclusão rastreável (soft-delete + audit) -------------------------------
-- Remove TODOS os lançamentos de um posto numa hora (a grade mostra posto×hora somando produtos);
-- marca deleted_at/deleted_por e grava em audit_log_global. Guarda por empresa/planta (fail-closed).
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_hora_excluir(
    p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_posto_id uuid, p_data date, p_hora integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer; v_ids uuid[];
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;

  WITH upd AS (
    UPDATE public.prod_apontamento_hora a
       SET deleted_at = now(), deleted_por = auth.uid()
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id
       AND a.posto_id IS NOT DISTINCT FROM p_posto_id
       AND a.data = p_data AND a.hora = p_hora
       AND a.deleted_at IS NULL
    RETURNING a.id
  )
  SELECT count(*)::int, array_agg(id) INTO v_n, v_ids FROM upd;

  IF coalesce(v_n,0) > 0 THEN
    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), auth.jwt()->>'email', 'prod_apontamento_hora',
            coalesce(p_posto_id::text,'(sem posto)')||'@'||p_data::text||' '||lpad(p_hora::text,2,'0')||'h',
            'excluir',
            jsonb_build_object('fluxo_id', p_fluxo_id, 'posto_id', p_posto_id, 'data', p_data, 'hora', p_hora, 'ids', v_ids),
            jsonb_build_object('deleted_at', now(), 'removidos', v_n));
  END IF;

  RETURN jsonb_build_object('ok', true, 'removidos', coalesce(v_n,0));
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_apontamento_hora_excluir(uuid, uuid, uuid, uuid, date, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_hora_excluir(uuid, uuid, uuid, uuid, date, integer) TO authenticated, service_role;

-- 5) Ajuda "?" (RD-95) das ações novas + origem RD-98 p3 ----------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('prod.apont.corrigir', '/dashboard/produtividade/apontamento', 'Apontamento horário', 'Corrigir lançamento',
  'Clique para reabrir o formulário já com o posto e a hora desta linha; escolha o produto, ajuste a quantidade e lance de novo.',
  'Relançar a mesma hora para o mesmo posto e produto CORRIGE o valor (não duplica) — é como se edita um apontamento.',
  'Produtividade do posto 3 às 08h ficou errada: Corrigir → ajusta a quantidade → Lançar.',
  'Esquecer de reescolher o produto antes de relançar.', 'industria', 90, 1, 'publicado'),
 ('prod.apont.excluir', '/dashboard/produtividade/apontamento', 'Apontamento horário', 'Excluir lançamento',
  'Remove os lançamentos deste posto nesta hora. Pede confirmação; fica registrado quem excluiu (rastreável).',
  'Tira da grade um apontamento lançado por engano, sem apagar o histórico de auditoria.',
  'Lancei 950 no posto 2 às 14h por engano: Excluir → confirma → some da grade.',
  'Excluir quando era só corrigir o número — para corrigir, use Corrigir e relance.', 'industria', 91, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = EXCLUDED.status;

-- origem RD-98 p3: acrescenta a RPC de exclusão na lista (idempotente)
UPDATE public.system_screens
   SET rpcs_chamadas = (
     SELECT array_agg(DISTINCT x) FROM unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_prod_apontamento_hora_excluir']) x)
 WHERE rota = '/dashboard/produtividade/apontamento';
