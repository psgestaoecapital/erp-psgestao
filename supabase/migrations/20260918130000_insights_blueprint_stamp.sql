-- Insight Auditor (item A) — carimbo do blueprint comparado.
--
-- O CEO: "o resultado precisa dizer QUAL VERSÃO do blueprint comparou. Se o documento mudar, o
-- diagnóstico vira arqueologia — o mesmo erro da foto velha." Sem isso, um veredito continua
-- pendurado a uma baliza que já mudou, sem ninguém saber.
--
-- O insight-auditor passa a injetar no prompt o Documento Mestre Vivo da vertical da tela
-- (erp_documento_vertical, vigente) e a GRAVAR aqui contra QUAL versão comparou. Assim, quando o
-- blueprint evoluir (ex.: Hub V10 -> V11), fica explícito no dado quais vereditos são velhos.
ALTER TABLE public.system_screens_insights
  ADD COLUMN IF NOT EXISTS blueprint_vertical text,
  ADD COLUMN IF NOT EXISTS blueprint_versao   integer,
  ADD COLUMN IF NOT EXISTS blueprint_md5      text;

COMMENT ON COLUMN public.system_screens_insights.blueprint_vertical
  IS 'Vertical do Documento Mestre Vivo (erp_documento_vertical) usado como baliza nesta análise. NULL = tela sem blueprint mapeado.';
COMMENT ON COLUMN public.system_screens_insights.blueprint_versao
  IS 'Versão do blueprint comparado. Se o blueprint evoluir, vereditos com versão < vigente são arqueologia.';
COMMENT ON COLUMN public.system_screens_insights.blueprint_md5
  IS 'md5(conteudo_md) do blueprint comparado — prova byte-a-byte da baliza usada.';

-- Helper para a edge insight-auditor: os blueprints VIGENTES com o md5 calculado NO POSTGRES
-- (a mesma prova que o CEO valida). Evita depender de MD5 no runtime Deno.
CREATE OR REPLACE FUNCTION public.fn_documentos_vigentes_md5()
RETURNS TABLE (vertical text, versao integer, conteudo_md text, md5 text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT d.vertical, d.versao, d.conteudo_md, md5(d.conteudo_md) AS md5
  FROM public.erp_documento_vertical d
  WHERE d.vigente IS TRUE;
$function$;
