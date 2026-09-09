-- ============================================================
-- Movimentacoes de rebanho · grupo_id por operacao em lote (estorno em massa)
-- Chamado urgente (Estancia Umuarama 636af107): transferiram 93 animais Piquete 6 -> Piquete 18
-- por engano; a operacao foi UMA (10s, 93 animais pela tela) mas gravou 93 linhas com grupo_id NULL.
--
-- Causa raiz (RD-38): a infra de estorno POR GRUPO ja existe e funciona
-- (fn_pec_movimentacao_estornar/listar/obter/editar keyd em COALESCE(grupo_id, id)), mas
-- fn_pec_movimentacao_registrar NAO gravava grupo_id -> cada linha virava seu proprio "grupo"
-- (COALESCE(grupo_id,id)=id) e nao dava para estornar a operacao inteira, so linha a linha.
--
-- Fix:
--   1) fn_pec_movimentacao_registrar passa a aceitar/gravar p_grupo_id (um uuid por operacao,
--      gerado no front na transferencia/morte em lote). Retrocompativel: parametro no fim, default
--      NULL; corpo identico ao anterior fora a coluna grupo_id no INSERT.
--   2) Backfill dos existentes por gaps-and-islands: mesma company+propriedade+tipo+data+origem+
--      destino+lote_destino+criado_por, com created_at agrupado (gap < 120s = mesma operacao).
--      Idempotente: so toca grupo_id NULL. Usa o id da 1a linha da ilha como grupo_id (uuid real,
--      estavel, consistente com COALESCE(grupo_id,id)).
--
-- RD-55: nada e apagado. grupo_id apenas HABILITA o estorno por grupo, que ja marca
-- estornada/estornada_em/estornada_por/motivo_estorno e devolve o animal ao piquete de origem
-- (fn_pec_mov_reverter_animais, via area_origem_id capturada no registro).
-- ============================================================

-- DROP da assinatura antiga (14 args) ANTES de recriar com p_grupo_id. Sem isto, adicionar um
-- parametro com default cria um OVERLOAD e as chamadas de 14 args ficam ambiguas
-- ("function is not unique"). Com o DROP, sobra so a versao de 15 args e toda chamada (com ou sem
-- p_grupo_id) resolve para ela via default. Nenhum trigger depende desta funcao (nao e trigger fn).
DROP FUNCTION IF EXISTS public.fn_pec_movimentacao_registrar(
  uuid, uuid, text, date, uuid, uuid, integer, numeric, numeric, uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_registrar(
  p_company_id uuid,
  p_propriedade_id uuid,
  p_tipo text,
  p_data date DEFAULT NULL::date,
  p_animal_id uuid DEFAULT NULL::uuid,
  p_lote_id uuid DEFAULT NULL::uuid,
  p_quantidade integer DEFAULT 1,
  p_peso_kg numeric DEFAULT NULL::numeric,
  p_valor numeric DEFAULT NULL::numeric,
  p_area_origem_id uuid DEFAULT NULL::uuid,
  p_area_destino_id uuid DEFAULT NULL::uuid,
  p_lote_destino_id uuid DEFAULT NULL::uuid,
  p_contraparte_nome text DEFAULT NULL::text,
  p_observacao text DEFAULT NULL::text,
  p_grupo_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_tipo = 'transferencia' AND p_animal_id IS NOT NULL AND p_area_origem_id IS NULL THEN
    SELECT area_atual_id INTO p_area_origem_id FROM erp_pec_animal WHERE id = p_animal_id AND company_id = p_company_id;
  END IF;

  INSERT INTO erp_pec_movimentacao(company_id,propriedade_id,animal_id,lote_id,tipo,data,quantidade,peso_kg,valor,
    area_origem_id,area_destino_id,lote_destino_id,contraparte_nome,observacao,grupo_id,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,p_tipo,COALESCE(p_data,CURRENT_DATE),p_quantidade,p_peso_kg,p_valor,
    p_area_origem_id,p_area_destino_id,p_lote_destino_id,p_contraparte_nome,p_observacao,p_grupo_id,auth.uid())
  RETURNING id INTO v_id;

  IF p_animal_id IS NOT NULL THEN
    IF p_tipo IN ('venda','morte','abate') THEN
      UPDATE erp_pec_animal SET status = CASE p_tipo WHEN 'venda' THEN 'vendido' WHEN 'morte' THEN 'morto' ELSE 'abatido' END,
        data_saida = COALESCE(p_data,CURRENT_DATE), motivo_saida = p_tipo, ativo = false
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'transferencia' THEN
      UPDATE erp_pec_animal SET lote_id = COALESCE(p_lote_destino_id, lote_id), area_atual_id = COALESCE(p_area_destino_id, area_atual_id)
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'retencao' THEN
      UPDATE erp_pec_animal SET categoria = 'novilha' WHERE id=p_animal_id AND company_id=p_company_id AND categoria='bezerra';
    END IF;
  END IF;
  RETURN v_id;
END $function$;

-- Backfill global idempotente (gaps-and-islands). So toca linhas com grupo_id NULL e animal_id
-- presente. Ja rodou para a Estancia Umuarama (636af107) via hotfix; aqui cobre o restante.
WITH base AS (
  SELECT id, company_id, propriedade_id, tipo, data, area_origem_id, area_destino_id, lote_destino_id, criado_por, created_at
  FROM public.erp_pec_movimentacao
  WHERE grupo_id IS NULL AND animal_id IS NOT NULL
), marked AS (
  SELECT *,
    CASE WHEN lag(created_at) OVER w IS NULL
           OR created_at - lag(created_at) OVER w > interval '120 seconds'
         THEN 1 ELSE 0 END AS novo
  FROM base
  WINDOW w AS (PARTITION BY company_id, propriedade_id, tipo, data, area_origem_id, area_destino_id, lote_destino_id, criado_por ORDER BY created_at, id)
), islandnum AS (
  SELECT id, company_id, propriedade_id, tipo, data, area_origem_id, area_destino_id, lote_destino_id, criado_por, created_at,
    sum(novo) OVER (PARTITION BY company_id, propriedade_id, tipo, data, area_origem_id, area_destino_id, lote_destino_id, criado_por ORDER BY created_at, id) AS ilha
  FROM marked
), gid AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY company_id, propriedade_id, tipo, data, area_origem_id, area_destino_id, lote_destino_id, criado_por, ilha ORDER BY created_at, id) AS gid
  FROM islandnum
)
UPDATE public.erp_pec_movimentacao m
SET grupo_id = g.gid, updated_at = now()
FROM gid g
WHERE m.id = g.id AND m.grupo_id IS NULL;
