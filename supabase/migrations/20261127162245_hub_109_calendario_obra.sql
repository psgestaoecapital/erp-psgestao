-- Hub §109 (blueprint essencial, ausente): "Calendário da obra (folgas, feriados)".
-- Fatia de BANCO (aditiva): registra os dias NÃO úteis de cada obra (feriado, folga, ponto facultativo),
-- base para o cronograma pular esses dias no cálculo de prazos. Só objetos NOVOS — não toca RLS/grants/dados
-- existentes, não altera nenhuma função existente, não apaga nada. A tela de edição e o consumo pelo
-- cronograma entram em fatias seguintes (a tela depende de uma entrada no menu "Execução da obra" = decisão
-- do Eng. Chefe).
--
-- Padrão idêntico ao de projetos_obra_tarefa (RD-26): RLS por empresa, REVOKE anon, gravação só por função
-- com guarda de empresa (fn__guarda_empresa), autoria por auth.uid(), exclusão lógica (RD-30/RD-98).
--
-- Prova RD-38 (no banco, antes do deploy): to_regclass('public.projetos_obra_calendario') = NULL e
-- pg_proc sem fn_obra_calendario* (0 linhas) — tudo criado por esta migration é novo; zero impacto em dado
-- de cliente.

CREATE TABLE IF NOT EXISTS public.projetos_obra_calendario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id      uuid NOT NULL REFERENCES public.projetos_obras(id),
  data         date NOT NULL,
  tipo         text NOT NULL DEFAULT 'feriado' CHECK (tipo IN ('feriado', 'folga', 'ponto_facultativo')),
  descricao    text,
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  excluido_em  timestamptz,
  excluido_por uuid
);
-- um dia não útil por obra/data (reativa a mesma linha em vez de duplicar)
CREATE UNIQUE INDEX IF NOT EXISTS projetos_obra_calendario_uq
  ON public.projetos_obra_calendario (company_id, obra_id, data) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS projetos_obra_calendario_idx
  ON public.projetos_obra_calendario (company_id, obra_id, data) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_calendario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_calendario FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_calendario_ler ON public.projetos_obra_calendario;
CREATE POLICY projetos_obra_calendario_ler ON public.projetos_obra_calendario FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_calendario TO authenticated;

-- Leitura: dias não úteis da obra (ordenados por data). STABLE, com conferência de acesso à empresa.
CREATE OR REPLACE FUNCTION public.fn_obra_calendario_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'data', c.data, 'tipo', c.tipo, 'descricao', c.descricao
         ) ORDER BY c.data), '[]'::jsonb)
    INTO v_itens
    FROM public.projetos_obra_calendario c
   WHERE c.obra_id = p_obra_id AND c.company_id = v_company AND c.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'itens', v_itens);
END $function$;

-- Gravação (inclui/edita): guarda de empresa + autoria por auth.uid(). Reativa a linha excluída da mesma data.
CREATE OR REPLACE FUNCTION public.fn_obra_calendario_salvar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_id   uuid  := NULLIF(p_dados->>'id','')::uuid;
  v_data date  := (p_dados->>'data')::date;
  v_tipo text  := COALESCE(NULLIF(btrim(p_dados->>'tipo'), ''), 'feriado');
  v_desc text  := NULLIF(btrim(p_dados->>'descricao'), '');
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data do dia não útil.'; END IF;
  IF v_tipo NOT IN ('feriado', 'folga', 'ponto_facultativo') THEN
    RAISE EXCEPTION 'Tipo deve ser feriado, folga ou ponto facultativo.';
  END IF;

  IF v_id IS NULL THEN
    -- reativa a linha excluída da mesma obra/data, se houver; senão insere
    UPDATE public.projetos_obra_calendario
       SET tipo = v_tipo, descricao = v_desc, excluido_em = NULL, excluido_por = NULL,
           criado_por = auth.uid(), criado_em = now()
     WHERE obra_id = p_obra_id AND company_id = v_company AND data = v_data AND excluido_em IS NOT NULL
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      INSERT INTO public.projetos_obra_calendario (company_id, obra_id, data, tipo, descricao, criado_por)
      VALUES (v_company, p_obra_id, v_data, v_tipo, v_desc, auth.uid())
      RETURNING id INTO v_id;
    END IF;
  ELSE
    UPDATE public.projetos_obra_calendario SET
      data = v_data, tipo = v_tipo, descricao = v_desc
    WHERE id = v_id AND obra_id = p_obra_id AND company_id = v_company AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Dia não útil não encontrado.'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'Esta obra já tem um dia não útil nesta data.');
END $function$;

-- Exclusão lógica (RD-30/RD-98): guarda de empresa + autoria por auth.uid().
CREATE OR REPLACE FUNCTION public.fn_obra_calendario_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_calendario WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Dia não útil não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_calendario
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE id = p_id AND excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_calendario_listar(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_calendario_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_calendario_excluir(uuid)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_calendario_listar(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_calendario_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_calendario_excluir(uuid)       TO authenticated, service_role;
