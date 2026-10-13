-- Central de Dev — ⑤ ícone medidor na topbar: contador leve para o badge.
-- número = "travado em quem olha" = documentos vivos em rascunho aguardando aprovação do CEO.
-- cor = saúde do sistema (por system_screens): vermelho se há tela QUEBRADA; amarelo se há tela
--       DESCONHECIDA (não validada) OU rascunho aguardando; verde caso contrário.
-- Chamada leve (um jsonb pequeno). A tela pesada só carrega no clique.

CREATE OR REPLACE FUNCTION public.fn_dev_medidor_badge()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    SELECT count(*)::int AS rascunhos
    FROM public.erp_documento_vertical WHERE vigente AND status='rascunho'
  ),
  s AS (
    SELECT
      count(*) FILTER (WHERE estado_real='quebrada')::int     AS quebradas,
      count(*) FILTER (WHERE estado_real='desconhecida')::int AS desconhecidas
    FROM public.system_screens
  )
  SELECT jsonb_build_object(
    'numero', r.rascunhos,
    'rascunhos', r.rascunhos,
    'telas_quebradas', s.quebradas,
    'telas_desconhecidas', s.desconhecidas,
    'cor', CASE
      WHEN s.quebradas > 0 THEN 'vermelho'
      WHEN s.desconhecidas > 0 OR r.rascunhos > 0 THEN 'amarelo'
      ELSE 'verde' END
  ) FROM r, s;
$$;
GRANT EXECUTE ON FUNCTION public.fn_dev_medidor_badge() TO authenticated, service_role;
