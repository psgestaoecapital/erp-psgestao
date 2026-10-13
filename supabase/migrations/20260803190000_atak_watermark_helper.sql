-- RD-41 · ATAK coletor multi-domínio — helper de watermark auto-recuperável (sem tabela de estado).
-- O "último ponto" de cada domínio vem do próprio landing ind_atak_fato: max(raw->>coluna_watermark).
-- Usado pela edge atak-ingest (ação 'config') pra dizer ao coletor de onde retomar (incremental).
-- RD-26: só leitura do landing existente. Nada novo de dado.
CREATE OR REPLACE FUNCTION public.fn_atak_watermark(p_company_id uuid, p_dominio text, p_coluna text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT max(raw->>p_coluna)
    FROM ind_atak_fato
   WHERE company_id = p_company_id AND dominio = p_dominio;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_atak_watermark(uuid, text, text) TO service_role, authenticated;

-- Mapa config-driven pro COLETOR (legado, sem token): devolve os domínios ATIVOS (template global +
-- a empresa) com a expressão de chave, a coluna de watermark e o ÚLTIMO ponto coletado (p/ incremental).
-- REVISAR*/NULL em coluna_watermark → watermark null → carga FULL. RD-38: só leitura (metadados +
-- max do landing); NÃO expõe senha (a senha do SQL Server segue só no .env da máquina). Anon: o coletor
-- lê com a anon key (pública) — mesma postura do fn_atak_agente_config.
CREATE OR REPLACE FUNCTION public.fn_atak_mapa_coletor(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_doms jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
      'dominio', fm.dominio, 'tabela_origem', fm.tabela_origem,
      'chave_fato_sql', fm.chave_fato_sql, 'coluna_watermark', fm.coluna_watermark,
      'watermark', CASE WHEN fm.coluna_watermark IS NULL OR fm.coluna_watermark LIKE 'REVISAR%' THEN NULL
                        ELSE (SELECT max(f.raw->>fm.coluna_watermark) FROM ind_atak_fato f
                               WHERE f.company_id = p_company_id AND f.dominio = fm.dominio) END
    ) ORDER BY fm.ordem)
    INTO v_doms
    FROM atak_fonte_mapa fm
   WHERE fm.ativo AND (fm.company_id IS NULL OR fm.company_id = p_company_id);
  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'dominios', COALESCE(v_doms, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_atak_mapa_coletor(uuid) TO anon, authenticated;
