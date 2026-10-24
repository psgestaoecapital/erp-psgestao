-- HB3 (fatia 12) · Cronograma da obra: curva S REALIZADA (histórico do avanço físico).
-- Achado (auditor PDCA 24/10, /dashboard/projetos/obras/[id]/cronograma): "Curva S com linha de realizado separada da
-- linha planejada (só há um ponto, não uma curva realizada)". Não existia histórico do % das tarefas: só o valor de hoje.
--
-- Só objetos NOVOS (aditiva, RD-94.1 c):
-- 1) tabela projetos_obra_tarefa_avanco — um ponto por tarefa e por dia (o último % do dia), RLS por empresa só de
--    leitura, REVOKE anon. FKs ON DELETE CASCADE: a limpeza da semente da demo (DELETE das tarefas/obras) segue igual.
-- 2) gatilho tg_obra_tarefa_avanco_registrar (AFTER INSERT ou UPDATE de percentual em projetos_obra_tarefa): grava o
--    ponto do dia (fuso de São Paulo). Não muda a tarefa nem a função fn_obra_tarefa_salvar.
--    Empresa de demonstração (companies.is_demo): a tarefa que NASCE com avanço ganha também a rampa semanal do início
--    até hoje, para a curva realizada da demo existir e sobreviver ao fn_demo_reset sem mexer na semente.
-- 3) ponto de partida: o % atual de cada tarefa ativa vira o ponto de hoje (só leitura da tarefa; dado de cliente não é
--    alterado, RD-55); na demo 006, a rampa das tarefas já semeadas.
-- 4) "?" (RD-95) da linha realizada.
-- Plano de volta: DROP TRIGGER trg_obra_tarefa_avanco ON projetos_obra_tarefa; DROP FUNCTION
-- tg_obra_tarefa_avanco_registrar(); DROP FUNCTION fn__obra_tarefa_avanco_rampa(uuid); DROP TABLE
-- projetos_obra_tarefa_avanco; DELETE da chave projetos.cronograma.curva_realizada.
CREATE TABLE IF NOT EXISTS public.projetos_obra_tarefa_avanco (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  tarefa_id      uuid NOT NULL REFERENCES public.projetos_obra_tarefa(id) ON DELETE CASCADE,
  data           date NOT NULL,
  percentual     numeric(5,2) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  registrado_por uuid,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tarefa_id, data)
);
CREATE INDEX IF NOT EXISTS projetos_obra_tarefa_avanco_obra_idx
  ON public.projetos_obra_tarefa_avanco (company_id, obra_id, data);

ALTER TABLE public.projetos_obra_tarefa_avanco ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_tarefa_avanco FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_tarefa_avanco_ler ON public.projetos_obra_tarefa_avanco;
CREATE POLICY projetos_obra_tarefa_avanco_ler ON public.projetos_obra_tarefa_avanco FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_tarefa_avanco TO authenticated;

-- Rampa semanal da demo: do início da tarefa até hoje (ou até o fim, se já passou), linear até o % atual.
-- ci-sem-guarda: fn__obra_tarefa_avanco_rampa — só grava em empresa is_demo; sem GRANT a usuário (gatilho e migration)
CREATE OR REPLACE FUNCTION public.fn__obra_tarefa_avanco_rampa(p_tarefa_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t record; v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; v_ate date; v_n integer := 0;
BEGIN
  SELECT tf.* INTO t FROM public.projetos_obra_tarefa tf JOIN public.companies c ON c.id = tf.company_id AND c.is_demo IS TRUE
   WHERE tf.id = p_tarefa_id AND tf.excluido_em IS NULL;
  IF t.id IS NULL OR t.percentual <= 0 OR t.inicio > v_hoje THEN RETURN 0; END IF;
  v_ate := LEAST(v_hoje, t.fim);
  INSERT INTO public.projetos_obra_tarefa_avanco (company_id, obra_id, tarefa_id, data, percentual)
  SELECT t.company_id, t.obra_id, t.id, d::date,
         round(t.percentual * ((d::date - t.inicio + 1)::numeric / (v_ate - t.inicio + 1)), 2)
    FROM generate_series(t.inicio, v_ate, interval '7 days') AS d
   WHERE d::date < v_ate
  ON CONFLICT (tarefa_id, data) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.projetos_obra_tarefa_avanco (company_id, obra_id, tarefa_id, data, percentual)
  VALUES (t.company_id, t.obra_id, t.id, v_ate, t.percentual)
  ON CONFLICT (tarefa_id, data) DO NOTHING;
  RETURN v_n + 1;
END $$;
REVOKE ALL ON FUNCTION public.fn__obra_tarefa_avanco_rampa(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_obra_tarefa_avanco_registrar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.excluido_em IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN PERFORM public.fn__obra_tarefa_avanco_rampa(NEW.id); END IF;
  INSERT INTO public.projetos_obra_tarefa_avanco (company_id, obra_id, tarefa_id, data, percentual, registrado_por)
  VALUES (NEW.company_id, NEW.obra_id, NEW.id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, NEW.percentual, auth.uid())
  ON CONFLICT (tarefa_id, data) DO UPDATE
    SET percentual = EXCLUDED.percentual, registrado_por = EXCLUDED.registrado_por, registrado_em = now();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tg_obra_tarefa_avanco_registrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_obra_tarefa_avanco ON public.projetos_obra_tarefa;
CREATE TRIGGER trg_obra_tarefa_avanco AFTER INSERT OR UPDATE OF percentual ON public.projetos_obra_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.tg_obra_tarefa_avanco_registrar();

-- Ponto de partida: rampa da demo e o % de hoje de cada tarefa ativa (a tarefa em si não muda).
SELECT public.fn__obra_tarefa_avanco_rampa(t.id)
  FROM public.projetos_obra_tarefa t JOIN public.companies c ON c.id = t.company_id AND c.is_demo IS TRUE
 WHERE t.excluido_em IS NULL;
INSERT INTO public.projetos_obra_tarefa_avanco (company_id, obra_id, tarefa_id, data, percentual)
SELECT t.company_id, t.obra_id, t.id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, t.percentual
  FROM public.projetos_obra_tarefa t
 WHERE t.excluido_em IS NULL
ON CONFLICT (tarefa_id, data) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.cronograma.curva_realizada', 'Cronograma da obra', 'Linha realizada da curva S',
  'Nada a preencher: cada vez que alguém atualiza o % de uma tarefa, o sistema guarda o avanço daquele dia. A linha verde liga esses dias.',
  'Mostra como a obra avançou de verdade ao longo do tempo, ao lado do planejado. A distância entre a linha verde e a dourada é o atraso (ou adiantamento) de cada semana, não só o de hoje.',
  'Em 05/10 a obra estava em 30% com 45% planejado; hoje está em 56% com 98% planejado: o atraso cresceu.',
  'Atualizar o % só no fim da obra: a linha realizada fica reta e não mostra quando o atraso começou.',
  45, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
