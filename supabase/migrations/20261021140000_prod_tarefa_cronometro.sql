-- Produtividade Indústria · Cronoanálise digitada (CEO 21/10, com o CEO na fábrica).
-- Permite apontar o TEMPO CRONOMETRADO de uma tarefa (tempo medido + nº de peças) e o sistema calcula a
-- Cap./h na hora, sem depender da análise do vídeo. Guarda cada medição para a média de 3+ ciclos.
-- ADITIVO: tabela nova + função nova + ajuda nova. Não altera nada existente (só recalcula cap_hora da própria
-- tarefa via RPC SECURITY DEFINER, mesmo caminho do fn_prod_tarefa_salvar).

-- 1) Tabela das medições (uma linha por cronometragem)
CREATE TABLE IF NOT EXISTS public.prod_tarefa_tempo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  plant_id     uuid NOT NULL,
  tarefa_id    uuid NOT NULL REFERENCES public.prod_tarefa(id) ON DELETE CASCADE,
  tempo_seg    numeric NOT NULL CHECK (tempo_seg > 0),
  qtd_pecas    numeric NOT NULL DEFAULT 1 CHECK (qtd_pecas > 0),
  seg_por_peca numeric GENERATED ALWAYS AS (tempo_seg / qtd_pecas) STORED,
  observacao   text,
  medido_por   uuid DEFAULT auth.uid(),
  medido_em    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prod_tarefa_tempo_tarefa ON public.prod_tarefa_tempo(tarefa_id);
CREATE INDEX IF NOT EXISTS ix_prod_tarefa_tempo_company ON public.prod_tarefa_tempo(company_id, plant_id);

ALTER TABLE public.prod_tarefa_tempo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_tarefa_tempo_sel ON public.prod_tarefa_tempo;
CREATE POLICY prod_tarefa_tempo_sel ON public.prod_tarefa_tempo FOR SELECT TO authenticated
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

REVOKE ALL ON public.prod_tarefa_tempo FROM PUBLIC, anon;
GRANT SELECT ON public.prod_tarefa_tempo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prod_tarefa_tempo TO service_role;

-- 2) RPC: grava a medição e recalcula a Cap./h (média dos ciclos). Escrita só por aqui (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.fn_prod_tarefa_cronometro_salvar(
  p_company_id uuid, p_plant_id uuid, p_tarefa_id uuid,
  p_tempo_seg numeric, p_qtd_pecas numeric DEFAULT 1, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cap numeric; v_n integer; v_media numeric;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  -- a tarefa tem que ser da empresa/planta
  IF NOT EXISTS (SELECT 1 FROM public.prod_tarefa t
                 WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id) THEN
    RAISE EXCEPTION 'tarefa_nao_encontrada';
  END IF;
  IF p_tempo_seg IS NULL OR p_tempo_seg <= 0 THEN RAISE EXCEPTION 'tempo_invalido'; END IF;
  IF coalesce(p_qtd_pecas, 1) <= 0 THEN RAISE EXCEPTION 'pecas_invalido'; END IF;

  INSERT INTO public.prod_tarefa_tempo (company_id, plant_id, tarefa_id, tempo_seg, qtd_pecas, observacao)
  VALUES (p_company_id, p_plant_id, p_tarefa_id, p_tempo_seg, coalesce(p_qtd_pecas, 1), nullif(btrim(p_observacao), ''));

  SELECT count(*), avg(seg_por_peca) INTO v_n, v_media
    FROM public.prod_tarefa_tempo WHERE tarefa_id = p_tarefa_id;

  v_cap := round(3600.0 / v_media, 1);  -- peças por hora a partir da média de segundos por peça

  UPDATE public.prod_tarefa SET
    cap_hora = v_cap,
    unidade_cap = coalesce(nullif(unidade_cap, ''), 'peças/h'),
    estado = CASE WHEN v_n >= 3 THEN 'valida' ELSE estado END,
    updated_at = now()
  WHERE id = p_tarefa_id AND company_id = p_company_id AND plant_id = p_plant_id;

  RETURN jsonb_build_object('ok', true, 'cap_hora', v_cap, 'n_medicoes', v_n,
                            'seg_por_peca_medio', round(v_media, 1));
END $$;

REVOKE ALL ON FUNCTION public.fn_prod_tarefa_cronometro_salvar(uuid,uuid,uuid,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tarefa_cronometro_salvar(uuid,uuid,uuid,numeric,numeric,text) TO authenticated, service_role;

-- 3) Ajuda RD-95 (o "?" dos campos do cronômetro)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tarefas e vídeos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/produtividade/tarefas', 'industria', 'publicado'
FROM (VALUES
  ('prod.tarefa.crono', 'Cronômetro', 'Abre o cronômetro da tarefa: digite o tempo medido e o sistema calcula a Cap./h.',
     'Transforma a cronometragem em capacidade, sem esperar a análise do vídeo.', 'Cronômetro ▾',
     'Cronometrar e não gravar a medição — ela não entra no cálculo.', 200),
  ('prod.tarefa.crono_tempo', 'Tempo medido (segundos)', 'O tempo que você cronometrou, em segundos.',
     'É o numerador da conta: Cap./h = 3600 ÷ (segundos por peça).', '130',
     'Pôr minutos no lugar de segundos (2 min = 120, não 2).', 210),
  ('prod.tarefa.crono_pecas', 'Nº de peças', 'Quantas peças saíram nesse tempo cronometrado.',
     'Permite medir por peça (1) ou por lote (ex.: 3 peças em 130 s).', '3',
     'Deixar vazio quando mediu um lote — aí a conta fica por 1 peça só.', 220),
  ('prod.tarefa.crono_media', 'Cap./h calculada', 'Resultado automático: 3600 ÷ média de segundos por peça dos ciclos medidos.',
     'Mostra a capacidade do posto com base no cronômetro; com 3+ ciclos a tarefa vira "válida".', '83 peças/h',
     'Confiar em 1 único ciclo — meça pelo menos 3 para a média ter confiança.', 230),
  ('prod.tarefa.crono_obs', 'Observação (opcional)', 'Uma nota curta sobre a medição (ritmo, condição do posto).',
     'Ajuda a entender depois por que um ciclo saiu diferente.', 'ritmo normal',
     'Escrever um texto longo — aqui é só uma nota curta.', 240)
) v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
