-- Hub · /dashboard/projetos (Painel) — delta até 95 (auditor 27/10 15:29, caixa cda58f8d · Code: desenvolvedor_4_g)
-- Índice do Hub 83. Deltas:
--   #1 BUG de consistência: "Obras por situação" do Painel contava por v_obra_resultado (view derivada), enquanto a
--      tela /projetos/obras conta por projetos_obras (fn_obras_kpis). Fontes diferentes = risco de divergência (o
--      auditor viu "Concluídas 0" no Painel x "Concluídas 1"/DEMO-OB-004 na lista). RD-38: hoje as duas batem
--      (concluida=1 nas duas), mas a FONTE é diferente — alinhamos estruturalmente: o Painel passa a contar as 4
--      situações pela MESMA fonte da lista (projetos_obras, via fn_obras_kpis). Aqui fn_obras_kpis ganha as chaves
--      ADITIVAS pausada/cancelada (as existentes não mudam; projetos/obras seguem lendo as mesmas).
--   #2 RD-98 p3: /dashboard/projetos estava com system_screens.views_consumidas/rpcs_chamadas vazios — preenche.
--
-- SENSÍVEL (RD-94.1): CREATE OR REPLACE de função existente — via do Hub (label hub). Apenas ADITIVO (novas chaves no
-- JSON), mesma fonte (projetos_obras), mesma guarda de empresa (get_user_company_ids). Nenhuma mudança de RLS/policy.

CREATE OR REPLACE FUNCTION public.fn_obras_kpis(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'em_andamento',       count(*) FILTER (WHERE status='em_andamento'),
    'concluidas',         count(*) FILTER (WHERE status='concluida'),
    'pausada',            count(*) FILTER (WHERE status='pausada'),
    'cancelada',          count(*) FILTER (WHERE status='cancelada'),
    'valor_em_andamento', COALESCE(sum(valor_previsto) FILTER (WHERE status='em_andamento'),0),
    'valor_concluido',    COALESCE(sum(valor_previsto) FILTER (WHERE status='concluida'),0))
  FROM public.projetos_obras WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids());
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_kpis(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obras_kpis(uuid[]) TO authenticated;

-- RD-98 p3 · origem do dado do Painel (grep de src/app/dashboard/projetos/page.tsx: .from + .rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'v_projetos_resumo_empresa', -- contas a pagar/receber abertas
        'v_obra_resultado',          -- obras em andamento: receita/custo previstos (tabela do Painel)
        'erp_orcamentos',            -- propostas pendentes (rascunho/enviado)
        'erp_crm_oportunidade'       -- funil: abertas/ganhas/perdidas (filtra deleted_at)
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_obras_kpis'              -- obras por situação (4) + valor das obras — MESMA fonte da tela de Obras
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos';
