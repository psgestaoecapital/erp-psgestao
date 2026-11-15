-- CUSTEIO POR KG · FATIA 2 (Indústria · CEO 11/11, contexto 46b4527a, RD-102): consolidar a MEDIÇÃO
-- tempo×peso (segundos por kg) num PADRÃO DE TEMPO por posto × produto.
--
-- A FATIA 1.5 já faz a cronoanálise gravar peso_kg e a coluna GERADA prod_tarefa_tempo.seg_por_kg
-- (= tempo_seg/peso_kg quando peso>0). Esta fatia fecha o elo: uma RPC que tira a MÉDIA de seg_por_kg
-- das medições de cada posto × produto e grava em prod_tempo_padrao. O produto final é sempre medido
-- em kg (genérico: bovinos, suínos, aves, serraria).
--
-- RD-38 (schema é a verdade): a tabela prod_tempo_padrao só aceita
--   origem        ∈ {'cronometrado','deduzido'}  -> a medição é 'cronometrado';
--   unidade_tempo ∈ {'min_por_kg','min_por_unidade'} -> padrão por kg é 'min_por_kg'.
-- Por isso o padrão sai em MINUTOS por kg (seg_por_kg / 60), origem 'cronometrado'.
--
-- Mapa do dado (reuso, RD-26 — nada recriado):
--   prod_tarefa_tempo.tarefa_id -> prod_tarefa.etapa_id -> prod_fluxo_etapa (posto_id, fluxo_id)
--   prod_fluxo_etapa.fluxo_id   -> prod_fluxo.produto_id
--   => média de seg_por_kg agrupada por (posto_id, produto_id).
--
-- Idempotente: mantém UMA linha de padrão cronometrado por kg VIGENTE (vigencia_fim IS NULL,
-- origem='cronometrado', unidade_tempo='min_por_kg') por posto × produto; re-rodar só atualiza o tempo
-- para a média corrente. Não toca padrões deduzidos nem por unidade. Aditiva: função NOVA, sem DROP/DELETE.
-- Agente: desenvolvedor_4_g (faixa de segundos :45–:54).

CREATE OR REPLACE FUNCTION public.fn_prod_tempo_padrao_do_medido(
  p_company_id uuid,
  p_plant_id   uuid,
  p_posto_id   uuid DEFAULT NULL,
  p_produto_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grupos      integer := 0;
  v_inseridos   integer := 0;
  v_atualizados integer := 0;
  r record;
BEGIN
  -- guarda de empresa/planta (mesma usada pela cronoanálise)
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);

  FOR r IN
    SELECT fe.posto_id,
           f.produto_id,
           round(avg(tt.seg_por_kg) / 60.0, 4) AS media_min_kg,   -- segundos/kg -> minutos/kg
           count(*)                            AS n
      FROM public.prod_tarefa_tempo tt
      JOIN public.prod_tarefa       t  ON t.id  = tt.tarefa_id
      JOIN public.prod_fluxo_etapa  fe ON fe.id = t.etapa_id
      JOIN public.prod_fluxo        f  ON f.id  = fe.fluxo_id
     WHERE tt.company_id  = p_company_id
       AND tt.plant_id    = p_plant_id
       AND tt.seg_por_kg IS NOT NULL
       -- produto é opcional: quando o fluxo ainda não aponta produto, o padrão fica por posto
       -- (prod_tempo_padrao.produto_id é nullable); quando aponta, sai por posto × produto.
       AND (p_posto_id   IS NULL OR fe.posto_id  = p_posto_id)
       AND (p_produto_id IS NULL OR f.produto_id = p_produto_id)
     GROUP BY fe.posto_id, f.produto_id
    HAVING round(avg(tt.seg_por_kg) / 60.0, 4) > 0   -- tempo > 0 (constraint)
  LOOP
    v_grupos := v_grupos + 1;

    -- atualiza o padrão cronometrado por kg VIGENTE deste posto×produto, se já existir
    UPDATE public.prod_tempo_padrao
       SET tempo      = r.media_min_kg,
           updated_at = now()
     WHERE company_id    = p_company_id
       AND plant_id      = p_plant_id
       AND posto_id      = r.posto_id
       AND produto_id IS NOT DISTINCT FROM r.produto_id
       AND origem        = 'cronometrado'
       AND unidade_tempo = 'min_por_kg'
       AND vigencia_fim IS NULL;

    IF FOUND THEN
      v_atualizados := v_atualizados + 1;
    ELSE
      INSERT INTO public.prod_tempo_padrao
        (company_id, plant_id, posto_id, produto_id, tempo, unidade_tempo, origem, vigencia_inicio)
      VALUES
        (p_company_id, p_plant_id, r.posto_id, r.produto_id, r.media_min_kg, 'min_por_kg', 'cronometrado', current_date);
      v_inseridos := v_inseridos + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'grupos',      v_grupos,
    'inseridos',   v_inseridos,
    'atualizados', v_atualizados
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_prod_tempo_padrao_do_medido(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tempo_padrao_do_medido(uuid, uuid, uuid, uuid) TO authenticated, service_role;
