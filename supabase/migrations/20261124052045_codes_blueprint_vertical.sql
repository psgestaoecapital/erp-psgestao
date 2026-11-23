-- Aba Codes · "Qualidade por vertical" ganha a 3ª medida: % CONSTRUÍDO frente ao blueprint (CEO 22/11/2026).
-- O gráfico já mostra a NOTA REAL do auditor e as PRONTAS (≥95); agora mostra QUANTO de cada vertical já existe
-- frente ao blueprint vivo (blueprint_tela_requisito). A medida é por REQUISITO (não por tela): as "telas" do
-- blueprint misturam telas reais com telas de referência de mercado (Hub 101–309), então contar telas engana.
--   % construído = (atendidos + ½ × parciais) ÷ total de requisitos da vertical, a partir de status_baseline.
-- Decisão do Eng. Chefe. Só sobe quando a linha do blueprint é marcada com evidência (regra de entrega + auditores).
--
-- Aditiva: cria uma função de LEITURA nova; não toca tabela, RLS, nem o gráfico existente. Mesma guarda da
-- fn_codes_qualidade_vertical (service_role ou PS admin). SECURITY DEFINER + STABLE. REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_codes_blueprint_vertical()
 RETURNS TABLE(
   area_slug text,
   requisitos integer,
   atendidos integer,
   parciais integer,
   ausentes integer,
   pct_construido integer,
   essenciais integer,
   pct_essenciais integer,
   telas_blueprint integer,
   telas_com_algo integer
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Mesma guarda da fn_codes_qualidade_vertical: só service_role ou PS admin leem o diagnóstico da esteira.
  IF NOT (auth.role() = 'service_role' OR public.fn_eh_ps_admin()) THEN RETURN; END IF;

  RETURN QUERY
  WITH amc AS (
    -- Mapa area_slug (vertical do gráfico/menu) → vertical do blueprint. As "telas" do blueprint misturam
    -- tela real e referência de mercado, então a medida é por REQUISITO. area_slug sem mapa → vertical NULL
    -- ("sem blueprint no banco": o gráfico esconde a barra e explica no tooltip).
    SELECT a.area_slug,
           CASE a.area_slug
             WHEN 'hub'                THEN 'hub_projetos'        -- Hub de Projetos
             WHEN 'compliance'         THEN 'ehs'                 -- PS EHS (rótulo "EHS", slug interno 'compliance')
             WHEN 'gestao_empresarial' THEN 'gestao_empresarial'  -- Gestão Empresarial (GE)
             WHEN 'revenda_veiculos'   THEN 'revenda_veiculos'    -- Revenda de veículos
             WHEN 'pm'                 THEN 'pm'                   -- P&M
             WHEN 'industrial'         THEN 'industria'           -- Indústria
             WHEN 'ecommerce'          THEN 'ecommerce'           -- E-commerce
             ELSE NULL                                            -- demais verticais: sem blueprint no banco
           END AS vertical
    FROM public.area_menu_config a
    WHERE a.ativo = true
  ),
  agg AS (
    SELECT r.vertical,
           count(*)::int AS requisitos,
           count(*) FILTER (WHERE r.status_baseline = 'atendido')::int AS atendidos,
           count(*) FILTER (WHERE r.status_baseline = 'parcial')::int  AS parciais,
           -- ausentes = tudo que não está atendido nem parcial (inclui 'travado' e eventuais outros estados).
           (count(*) - count(*) FILTER (WHERE r.status_baseline IN ('atendido','parcial')))::int AS ausentes,
           round(100.0 * (count(*) FILTER (WHERE r.status_baseline = 'atendido')
                          + 0.5 * count(*) FILTER (WHERE r.status_baseline = 'parcial'))
                 / NULLIF(count(*), 0))::int AS pct_construido,
           count(*) FILTER (WHERE r.prioridade = 'essencial')::int AS essenciais,
           round(100.0 * (count(*) FILTER (WHERE r.status_baseline = 'atendido' AND r.prioridade = 'essencial')
                          + 0.5 * count(*) FILTER (WHERE r.status_baseline = 'parcial' AND r.prioridade = 'essencial'))
                 / NULLIF(count(*) FILTER (WHERE r.prioridade = 'essencial'), 0))::int AS pct_essenciais,
           count(DISTINCT r.tela_num)::int AS telas_blueprint,
           count(DISTINCT r.tela_num) FILTER (WHERE r.status_baseline IN ('atendido','parcial'))::int AS telas_com_algo
    FROM public.blueprint_tela_requisito r
    GROUP BY r.vertical
  )
  SELECT amc.area_slug,
         agg.requisitos,
         agg.atendidos,
         agg.parciais,
         agg.ausentes,
         agg.pct_construido,
         agg.essenciais,
         agg.pct_essenciais,
         agg.telas_blueprint,
         agg.telas_com_algo
  FROM amc
  LEFT JOIN agg ON agg.vertical = amc.vertical
  ORDER BY amc.area_slug;
END;
$function$;

-- SECURITY DEFINER fechada ao anon (regra 1 do check_fn_guards): sem REVOKE fica aberta a PUBLIC/anon por padrão.
REVOKE ALL ON FUNCTION public.fn_codes_blueprint_vertical() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_codes_blueprint_vertical() TO authenticated, service_role;

-- Atualiza o "?" (RD-95) do gráfico para explicar a nova barra em linguagem do CEO. Idempotente por chave.
UPDATE public.erp_ajuda_campo
SET para_que_serve = 'Mostra, por vertical, TRÊS coisas: (1) quanto já está CONSTRUÍDO frente ao blueprint — a barra escura "Construído × blueprint", medida por REQUISITO (atendidos + ½ dos parciais ÷ total de requisitos da vertical), não por tela, porque o blueprint mistura tela real com tela de referência de mercado; (2) a NOTA MÉDIA real do auditor (robô) das telas (barra ouro); (3) quantas estão PRONTAS de verdade, nota ≥ 95 (barra verde). A nota e as prontas contam só telas com FOTO FRESCA (últimos 7 dias). O % construído só sobe quando a linha do blueprint é marcada com evidência (pela entrega e pela reconciliação dos auditores). Vertical sem blueprint no banco: sem a barra escura.',
    exemplo = 'Hub: construído 9% (32 atendidos + 103 parciais de 936 requisitos) · nota média 48 · 0% prontas. Gestão: construído 26%. Vertical sem blueprint: só nota e prontas.',
    versao = versao + 1,
    atualizado_em = now()
WHERE chave = 'dev.codes.qualidade_vertical';
