-- Produtividade Industrial · Fase 1 · card em BI→Transversais + registro do módulo (§7.1/§7.2).
-- Ordem do CEO: card e wiring ANTES da tela (faz o módulo existir no menu; sem isso a tela fica
-- pronta e inalcançável). O card acende quando há dado (posto cadastrado), "aguarda dados" sem (§8.1).

-- ── Card BI: linha em ind_bi_tema, seção transversais, entre Embalagens (200) e Cruzamento (210) ──
-- Clona ambito/fonte_scope/icone do tema Embalagens (mesmo ramo/superfície). Idempotente.
INSERT INTO public.ind_bi_tema
  (codigo, nome, subtitulo, icone, secao, ordem, rota_detalhe, destaque, previsto, ativo, ambito, fonte_scope, fonte_tabela)
SELECT 'produtividade', 'Produtividade', 'Postos, turnos e fluxos por planta',
       e.icone, 'transversais', 205, '/dashboard/produtividade', 'novo', true, true,
       e.ambito, e.fonte_scope, 'prod_posto'
FROM public.ind_bi_tema e
WHERE e.codigo = 'embalagens'
  AND NOT EXISTS (SELECT 1 FROM public.ind_bi_tema WHERE codigo = 'produtividade');

-- ── fn_bi_temas_industrial: card acende com posto cadastrado (patch cirúrgico, preserva o resto) ──
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.fn_bi_temas_industrial(uuid)'::regprocedure);
  IF v_def ILIKE '%v_prod%' THEN RAISE NOTICE 'card produtividade já no RPC'; RETURN; END IF;
  v_new := v_def;
  -- 1) variável
  v_new := replace(v_new, E'  v_out jsonb;\n', E'  v_out jsonb; v_prod int := 0;\n');
  -- 2) contagem de postos no bloco de acesso
  v_new := replace(v_new,
    'select coalesce(sum(cabecas),0) into v_abate_cab from ind_abate_evento where company_id = p_company_id;',
    E'select coalesce(sum(cabecas),0) into v_abate_cab from ind_abate_evento where company_id = p_company_id;\n    select count(*) into v_prod from prod_posto where company_id = p_company_id and ativo;');
  -- 3) tem_dado
  v_new := replace(v_new,
    E'when t.codigo = ''comercial'' then (v_venda > 0)\n      else false end,',
    E'when t.codigo = ''comercial'' then (v_venda > 0)\n      when t.codigo = ''produtividade'' then (v_prod > 0)\n      else false end,');
  -- 4) metrica
  v_new := replace(v_new,
    E'when t.codigo = ''comercial'' and v_venda > 0 then v_vd_fmt || '' vendas''\n      else null end',
    E'when t.codigo = ''comercial'' and v_venda > 0 then v_vd_fmt || '' vendas''\n      when t.codigo = ''produtividade'' and v_prod > 0 then v_prod::text || '' posto(s) cadastrado(s)''\n      else null end');
  IF v_new = v_def THEN RAISE EXCEPTION 'nenhuma âncora casou em fn_bi_temas_industrial — abortando'; END IF;
  EXECUTE v_new;
END $mig$;

-- ── Registro do módulo (§7.1): subgrupo + module_catalog (grupo industrial) ──
INSERT INTO public.module_subgrupos (id, grupo, label, ordem, ativo)
VALUES ('produtividade', 'industrial', 'Produtividade', 99, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, ramos_aplicaveis, surface_in_groups)
VALUES ('produtividade', 'Produtividade', '/dashboard/produtividade', 'industrial', 'produtividade', 'Gauge', 205, true, true, ARRAY['bovinos']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
