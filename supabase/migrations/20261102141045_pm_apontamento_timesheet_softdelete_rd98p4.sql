-- P&M · /dashboard/pm/apontamento-horas (Apontamento de horas) — RD-98 p4 (exclusão rastreável)
-- AUDITORIA P&M (aud8, 31/10, nota 90). Code: desenvolvedor_4_g
--
-- PROBLEMA (RD-38, provado no dado · DEMO Agência b0700000-0000-4000-a000-000000000002):
--   A tela lista lançamentos de agency_timesheet mas NÃO oferece excluir um lançamento errado
--   (ruído de cronômetro, hora lançada no job errado). agency_timesheet não tinha soft-delete
--   (sem excluido_em/excluido_por), então um apontamento equivocado inflava Horas/Custo e a margem
--   do job sem forma rastreável de corrigir. CRUD incompleto (RD-98 pilar 2) e sem exclusão
--   rastreável (RD-98 pilar 4).
--
-- CORREÇÃO: excluir um lançamento passa a ser SOFT-DELETE rastreável (excluido_em + excluido_por)
--   com trilha em audit_log_global, por uma RPC guardada por empresa (fn_pm_timesheet_excluir).
--   Mesma doutrina da RD-98 p4 já aplicada em /dashboard/producao (fn_pm_registro_excluir).
--   Nunca DELETE físico de dado de cliente.
--
-- Regressão: as colunas nascem NULL em todo registro atual, então o filtro `excluido_em IS NULL`
--   na listagem é NO-OP sobre os dados de hoje; a única mudança de comportamento é que exclusões
--   passam a preservar o registro (marca a data) em vez de não existirem. 100% ADITIVO e reversível.

-- 1) Colunas de soft-delete (aditivo, idempotente)
ALTER TABLE public.agency_timesheet
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Exclusão rastreável do apontamento (soft-delete + audit). Guarda por empresa; nunca DELETE físico.
CREATE OR REPLACE FUNCTION public.fn_pm_timesheet_excluir(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM agency_timesheet
    WHERE id = p_id AND excluido_em IS NULL;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  IF v_co <> p_company_id THEN RAISE EXCEPTION 'Lançamento de outra empresa'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);

  UPDATE agency_timesheet
    SET excluido_em = now(), excluido_por = auth.uid()
    WHERE id = p_id AND company_id = v_co AND excluido_em IS NULL;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, auth.uid(), 'agency_timesheet', p_id, 'excluir',
            jsonb_build_object('excluido_em', NULL),
            jsonb_build_object('excluido_em', now()));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_timesheet_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_timesheet_excluir(uuid, uuid) TO authenticated, service_role;

-- 3) RD-95: "?" da ação Excluir na tabela de lançamentos (ON CONFLICT DO NOTHING, aditivo)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('pm.apontamento.excluir', 'Lançamentos', 'Excluir lançamento',
   'Remove um lançamento de horas errado (ruído de cronômetro, hora no job errado). A exclusão é rastreável: guarda quem excluiu e quando, e o registro some das listas e dos totais.',
   'Mantém Horas, Custo e a margem do job honestos ao tirar apontamentos equivocados, sem apagar o histórico — a exclusão fica no log de auditoria.',
   'Parou o cronômetro sem querer e gerou um lançamento de 2 min: exclua para não poluir o total.',
   'Excluir um lançamento válido achando que é ruído — confira as horas e o job antes de confirmar.',
   20, '/dashboard/pm/apontamento-horas', 'pm', 'publicado'),
  ('pm.apontamento.kpi_horas', 'Indicadores', 'Horas (últimas)',
   'Soma das horas dos lançamentos à vista (os últimos registros). Com o ruído de cronômetro oculto, conta só o trabalho real.',
   'É o total de esforço apontado no período que está na tela — a base da Margem de cada job (horas × custo/hora).',
   '12 lançamentos somando 41,5 h.',
   'Estranhar o total sem notar que o filtro "ruído de cronômetro" está escondendo lançamentos curtos.',
   21, '/dashboard/pm/apontamento-horas', 'pm', 'publicado'),
  ('pm.apontamento.kpi_custo', 'Indicadores', 'Custo apontado',
   'Soma do custo (horas × custo/hora da pessoa) dos lançamentos à vista. Só aparece para quem pode ver salário (LGPD).',
   'Mostra quanto o esforço apontado custou, para comparar com a receita do job e ver a margem real.',
   'R$ 3.120,00 em 41,5 h.',
   'Comparar o custo com a receita de outro período — confira se os dois olham o mesmo intervalo.',
   22, '/dashboard/pm/apontamento-horas', 'pm', 'publicado'),
  ('pm.apontamento.kpi_lancamentos', 'Indicadores', 'Lançamentos',
   'Quantos lançamentos de horas existem nos últimos registros, com a quebra entre reais e ruído de cronômetro (menos de ~3 min).',
   'Ajuda a enxergar a qualidade do apontamento: muito ruído indica cronômetro iniciado/parado sem trabalho real.',
   '14 lançamentos · 12 reais · 2 de ruído.',
   'Confundir ruído com trabalho real — o ruído não entra em Horas nem em Custo quando está oculto.',
   23, '/dashboard/pm/apontamento-horas', 'pm', 'publicado')
ON CONFLICT (chave) DO NOTHING;
