-- Alerta do sino não promete tela que não existe (mesma família do badge / catalogo[0] / NFS-e).
-- Achado: o sino abria com links quebrados. Auditado no dado: das rotas dos alertas ativos, só
-- /dashboard/contas-bancarias não existia (a real é /dashboard/cadastros/contas-bancarias) — as de
-- /dashboard/financeiro/pagar EXISTEM (o query string é ignorado, não dá 404). Mas o padrão é o que
-- importa: alerta com link morto treina o usuário a não clicar. Três defesas:

-- (1) registro do que é rota válida (system_screens ∪ module_catalog). NULL/vazio = nada a validar.
CREATE OR REPLACE FUNCTION public.fn_rota_conhecida(p_link text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_link IS NULL OR btrim(p_link) = '' OR EXISTS (
    SELECT 1 FROM (SELECT split_part(split_part(p_link,'?',1),'#',1) AS base) b
    WHERE EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = b.base)
       OR EXISTS (SELECT 1 FROM public.module_catalog m WHERE split_part(split_part(m.rota,'?',1),'#',1) = b.base)
  )
$function$;

-- (2) TRAVA na origem: antes de gravar, se o link aponta para rota inexistente, grava SEM link.
--     Vale para TODOS os geradores (fn_alertas_gerar_automaticos, bpo, odonto, ...), presentes e
--     futuros. Assim o próximo alerta com rota inválida nasce sem link — aparece, mas não engana.
CREATE OR REPLACE FUNCTION public.tg_alerta_link_valido()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.link_acao IS NOT NULL AND NOT public.fn_rota_conhecida(NEW.link_acao) THEN
    NEW.link_acao := NULL;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_alerta_link_valido ON public.erp_alerta_proativo;
CREATE TRIGGER trg_alerta_link_valido BEFORE INSERT OR UPDATE OF link_acao
  ON public.erp_alerta_proativo FOR EACH ROW EXECUTE FUNCTION public.tg_alerta_link_valido();

-- (3) origem do único link errado: saldo_negativo apontava para /dashboard/contas-bancarias.
--     Transformação idempotente do corpo do gerador (rodar de novo é no-op).
DO $patch$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_alertas_gerar_automaticos'::regproc);
  v_def := replace(v_def, '''/dashboard/contas-bancarias''', '''/dashboard/cadastros/contas-bancarias''');
  EXECUTE v_def;
END $patch$;

-- backfill dos alertas já gravados com a rota antiga
UPDATE public.erp_alerta_proativo SET link_acao = '/dashboard/cadastros/contas-bancarias'
 WHERE tipo = 'saldo_negativo' AND link_acao = '/dashboard/contas-bancarias';
