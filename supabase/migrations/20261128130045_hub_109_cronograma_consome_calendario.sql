-- Hub §109 (tela "Calendário da obra") · fatia de CONSUMO pelo cronograma — fecha o GAP do auditor_pdca_1 (26/11):
-- a tela 109 promete "O cronograma usa o calendário para contar só os dias realmente trabalhados", mas NADA lia
-- projetos_obra_calendario. Esta migration cria a função de LEITURA que o cronograma passa a consumir, para que um
-- dia não útil cadastrado (feriado/folga/ponto facultativo) deixe de contar como dia trabalhado no prazo da tarefa.
--
-- RD-26 (reusar, não duplicar): reaproveita projetos_obra_calendario (criada em 20261127162245), a regra de dias úteis
-- já usada no app (semana < 6 + fn_e_feriado_nacional) e o mesmo guard de leitura de fn_obra_calendario_listar.
-- Aditiva: só cria 1 função NOVA e insere 1 chave de ajuda NOVA (RD-95). Não altera função/tabela/RLS/dado existente.
--
-- Prova RD-38 (no banco, antes do deploy): a obra DEMO 006 "Reforma loja – Mercado Central" tem 4 tarefas e, após o
-- seed SÓ-DEMO desta migration, 1 feriado dentro da janela de uma tarefa → a função devolve dias_nao_uteis = 1 e o
-- total de dias trabalhados cai exatamente 1 em relação ao mesmo cálculo sem o calendário (conferência no fechamento).

-- ── Leitura: dias realmente trabalhados por tarefa do cronograma (exclui fim de semana, feriado nacional e os dias
-- não úteis do calendário da obra). STABLE, com a mesma conferência de acesso à empresa do fn_obra_calendario_listar.
CREATE OR REPLACE FUNCTION public.fn_obra_cronograma_dias(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_por jsonb; v_total int; v_nao_uteis int;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_nao_uteis
    FROM public.projetos_obra_calendario c
   WHERE c.obra_id = p_obra_id AND c.company_id = v_company AND c.excluido_em IS NULL;

  WITH cal AS (
    SELECT c.data FROM public.projetos_obra_calendario c
     WHERE c.obra_id = p_obra_id AND c.company_id = v_company AND c.excluido_em IS NULL
  ),
  por_tarefa AS (
    SELECT t.id AS tarefa_id,
           count(*) FILTER (
             WHERE extract(isodow FROM g.d) < 6
               AND NOT public.fn_e_feriado_nacional(g.d::date)
               AND NOT EXISTS (SELECT 1 FROM cal WHERE cal.data = g.d::date)
           )::int AS trabalhados
      FROM public.projetos_obra_tarefa t
      CROSS JOIN LATERAL generate_series(t.inicio, t.fim, interval '1 day') g(d)
     WHERE t.obra_id = p_obra_id AND t.company_id = v_company AND t.excluido_em IS NULL
     GROUP BY t.id
  )
  SELECT COALESCE(jsonb_object_agg(tarefa_id, trabalhados), '{}'::jsonb), COALESCE(sum(trabalhados), 0)::int
    INTO v_por, v_total
    FROM por_tarefa;

  RETURN jsonb_build_object(
    'ok', true,
    'obra_id', p_obra_id,
    'dias_nao_uteis', v_nao_uteis,
    'total_trabalhados', v_total,
    'por_tarefa', v_por
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_cronograma_dias(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_cronograma_dias(uuid) TO authenticated;

-- ── RD-95: ajuda "?" do novo indicador "dias trabalhados" no cronograma.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'projetos.cronograma.dias_trabalhados',
  '/dashboard/projetos/obras/[id]/cronograma',
  'Cronograma da obra',
  'Dias trabalhados',
  'Nada a preencher aqui: é um cálculo automático. O que define os dias não úteis é o Calendário da obra (feriados, folgas e pontos facultativos).',
  'Mostra quantos dias de cada tarefa são realmente trabalhados: tira os fins de semana, os feriados nacionais e os dias não úteis que você cadastrou no Calendário da obra. Assim o prazo reflete os dias em que a equipe de fato produz.',
  'Uma tarefa de 01/06 a 10/06 com um feriado no dia 05 e cadastrado no calendário conta 6 dias trabalhados (tira 2 fins de semana e o feriado).',
  'Cadastrar o feriado no Calendário da obra e não ver o número mudar: confira se a data cai dentro do período (início a fim) da tarefa.',
  'hub_projetos',
  21
)
ON CONFLICT (chave) DO NOTHING;

-- ── Seed SÓ-DEMO (idempotente): um feriado dentro da janela de uma tarefa da obra "Reforma loja – Mercado Central"
-- (DEMO 006) para a jornada "dia não útil deixa de contar" ficar auditável. Guardado por is_demo + id fixo da DEMO.
DO $seed$
DECLARE v_obra uuid; v_company uuid := 'b0700000-0000-4000-a000-000000000006'::uuid; v_data date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_company AND is_demo = true) THEN
    SELECT o.id INTO v_obra FROM public.projetos_obras o
     WHERE o.company_id = v_company AND o.nome = 'Reforma loja – Mercado Central' LIMIT 1;
    IF v_obra IS NOT NULL THEN
      -- um dia útil (seg–sex) dentro da janela de alguma tarefa da obra, para o feriado ter efeito visível
      SELECT g.d::date INTO v_data
        FROM public.projetos_obra_tarefa t
        CROSS JOIN LATERAL generate_series(t.inicio, t.fim, interval '1 day') g(d)
       WHERE t.obra_id = v_obra AND t.excluido_em IS NULL
         AND extract(isodow FROM g.d) < 6
         AND NOT public.fn_e_feriado_nacional(g.d::date)
       ORDER BY g.d LIMIT 1;
      IF v_data IS NOT NULL THEN
        INSERT INTO public.projetos_obra_calendario (company_id, obra_id, data, tipo, descricao)
        SELECT v_company, v_obra, v_data, 'feriado', 'Feriado municipal (exemplo DEMO)'
         WHERE NOT EXISTS (
           SELECT 1 FROM public.projetos_obra_calendario c
            WHERE c.obra_id = v_obra AND c.company_id = v_company AND c.data = v_data AND c.excluido_em IS NULL
         );
      END IF;
    END IF;
  END IF;
END $seed$;
