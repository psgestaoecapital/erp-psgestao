-- ============================================================
-- IBPT · Lei 12.741/2012 · Caminho A (tabela real por NCM/LC116) — para LUCRO REAL / regime normal
-- ============================================================
-- Contexto (premissa CORRIGIDA — RD-38/RD-44): a API "De Olho no Imposto" do IBPT FUNCIONA e é o
-- caminho oficial recomendado (comunicado oficial deolhonoimposto.ibpt.org.br; versão vigente 26.2.A,
-- vigência 20/08–30/09/2026; confirma o token válido do OMIE). O levantamento anterior ("API fora
-- do ar") vinha do FAQ desatualizado e estava errado.
--
-- As 4 empresas Simples seguem pelo PERCENTUAL único (Caminho B, lei12741_ativo + percentual). Este
-- Caminho A é para a FC PISOS (b202b50f · SC · lucro_real), que precisa das alíquotas por NCM.
--
-- Desenho (copiando o OMIE): tabela POR EMPRESA (cada empresa tem a sua), duas fontes de carga —
--   • Opção A: TOKEN por CNPJ → API atualiza sozinha (token no VAULT, nunca em coluna aberta);
--   • Opção B: upload de CSV (Latin1, separado por ';') → para quem não tem token.
--
-- 🔑 ALERTA POR VIGÊNCIA + HASH, nunca por "versão mudou" (RD-38): o próprio IBPT avisa que uma
-- versão nova pode ter o MESMO conteúdo (ex.: 26.1.L só teve a vigência estendida). Então:
--   • guardamos versão E hash do conteúdo;
--   • se o conteúdo vier idêntico, atualizamos só a vigência e NÃO reimportamos/incomodamos;
--   • o alerta dispara quando a VIGÊNCIA expira (ou está perto), com a mensagem "sua tabela vence em".
-- Alerta que grita à toa é alerta que o usuário aprende a ignorar.

-- token da API do IBPT no cofre (espelha focus_token_vault_id) — credencial, nunca coluna aberta
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS ibpt_token_vault_id uuid;
COMMENT ON COLUMN public.erp_fiscal_provider_config.ibpt_token_vault_id IS
  'IBPT · id do secret no Vault com o token da API De Olho no Imposto (Caminho A, Lucro Real). Nunca guardar o token em coluna aberta.';

-- versão da tabela IBPT por empresa/UF (uma ativa por empresa+UF)
CREATE TABLE IF NOT EXISTS public.erp_ibpt_tabela (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  uf             text NOT NULL,
  versao         text NOT NULL,
  vigencia_inicio date,
  vigencia_fim    date,
  conteudo_hash  text NOT NULL,                 -- md5 do conteúdo (versão nova ≠ conteúdo novo)
  fonte          text NOT NULL DEFAULT 'csv' CHECK (fonte IN ('api','csv')),
  qtd_itens      int NOT NULL DEFAULT 0,
  ativo          boolean NOT NULL DEFAULT true,
  importado_em   timestamptz NOT NULL DEFAULT now(),
  importado_por  uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ibpt_tabela_ativa ON public.erp_ibpt_tabela (company_id, uf) WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_ibpt_tabela_company ON public.erp_ibpt_tabela (company_id, uf, vigencia_fim);
ALTER TABLE public.erp_ibpt_tabela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ibpt_tabela_rls ON public.erp_ibpt_tabela;
CREATE POLICY ibpt_tabela_rls ON public.erp_ibpt_tabela FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- itens (alíquotas por código): NCM (produto/NF-e) · NBS/LC116 (serviço/NFS-e)
CREATE TABLE IF NOT EXISTS public.erp_ibpt_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id     uuid NOT NULL REFERENCES public.erp_ibpt_tabela(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('ncm','nbs','lc116')),
  codigo        text NOT NULL,
  ex            text,
  descricao     text,
  aliq_nacional numeric NOT NULL DEFAULT 0,     -- federal p/ produto/serviço nacional (%)
  aliq_importado numeric NOT NULL DEFAULT 0,    -- federal p/ importado (%)
  aliq_estadual numeric NOT NULL DEFAULT 0,     -- (%)
  aliq_municipal numeric NOT NULL DEFAULT 0     -- (%)
);
CREATE INDEX IF NOT EXISTS ix_ibpt_item_lookup ON public.erp_ibpt_item (tabela_id, tipo, codigo);
ALTER TABLE public.erp_ibpt_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ibpt_item_rls ON public.erp_ibpt_item;
CREATE POLICY ibpt_item_rls ON public.erp_ibpt_item FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.erp_ibpt_tabela t WHERE t.id = tabela_id AND (t.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.erp_ibpt_tabela t WHERE t.id = tabela_id AND (t.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())));

-- IMPORTAR (Opção B: CSV parseado no front → itens jsonb; Opção A: mesma fn com fonte='api').
-- itens: [{tipo,codigo,ex,descricao,aliq_nacional,aliq_importado,aliq_estadual,aliq_municipal}, ...]
-- Se o conteúdo (hash) for IDÊNTICO ao da tabela ativa, NÃO reimporta: atualiza só a vigência.
CREATE OR REPLACE FUNCTION public.fn_ibpt_importar(p_company_id uuid, p_uf text, p_versao text,
  p_vigencia_inicio date, p_vigencia_fim date, p_itens jsonb, p_fonte text DEFAULT 'csv')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_hash text; v_ativa record; v_id uuid; v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_hash := md5(COALESCE(p_itens,'[]'::jsonb)::text);
  SELECT * INTO v_ativa FROM public.erp_ibpt_tabela WHERE company_id=p_company_id AND uf=upper(p_uf) AND ativo;

  -- conteúdo idêntico → só estende vigência, não incomoda
  IF v_ativa.id IS NOT NULL AND v_ativa.conteudo_hash = v_hash THEN
    UPDATE public.erp_ibpt_tabela SET versao=p_versao, vigencia_inicio=p_vigencia_inicio, vigencia_fim=p_vigencia_fim,
           fonte=p_fonte, importado_em=now(), importado_por=auth.uid() WHERE id=v_ativa.id;
    RETURN jsonb_build_object('ok', true, 'tabela_id', v_ativa.id, 'reaproveitado', true, 'itens', v_ativa.qtd_itens,
      'mensagem', 'Conteúdo idêntico ao vigente — atualizada só a vigência (sem novo download).');
  END IF;

  -- conteúdo novo → nova tabela ativa, aposenta a anterior
  v_n := jsonb_array_length(COALESCE(p_itens,'[]'::jsonb));
  UPDATE public.erp_ibpt_tabela SET ativo=false WHERE company_id=p_company_id AND uf=upper(p_uf) AND ativo;
  INSERT INTO public.erp_ibpt_tabela (company_id, uf, versao, vigencia_inicio, vigencia_fim, conteudo_hash, fonte, qtd_itens, importado_por)
  VALUES (p_company_id, upper(p_uf), p_versao, p_vigencia_inicio, p_vigencia_fim, v_hash, p_fonte, v_n, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.erp_ibpt_item (tabela_id, tipo, codigo, ex, descricao, aliq_nacional, aliq_importado, aliq_estadual, aliq_municipal)
  SELECT v_id, lower(COALESCE(it->>'tipo','ncm')), it->>'codigo', it->>'ex', it->>'descricao',
         COALESCE((it->>'aliq_nacional')::numeric,0), COALESCE((it->>'aliq_importado')::numeric,0),
         COALESCE((it->>'aliq_estadual')::numeric,0), COALESCE((it->>'aliq_municipal')::numeric,0)
  FROM jsonb_array_elements(COALESCE(p_itens,'[]'::jsonb)) it WHERE it->>'codigo' IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'tabela_id', v_id, 'reaproveitado', false, 'itens', v_n, 'hash', v_hash);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_ibpt_importar(uuid, text, text, date, date, jsonb, text) TO authenticated;

-- ALÍQUOTA para a emissão (produto NCM / serviço LC116) — soma federal(nac/imp)+estadual+municipal.
-- p_importado escolhe a federal correta. Só usa a tabela ATIVA e dentro da vigência.
CREATE OR REPLACE FUNCTION public.fn_ibpt_aliquota(p_company_id uuid, p_uf text, p_tipo text, p_codigo text, p_importado boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_t record; v_i record; v_fed numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_t FROM public.erp_ibpt_tabela WHERE company_id=p_company_id AND uf=upper(p_uf) AND ativo;
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_tabela'); END IF;
  SELECT * INTO v_i FROM public.erp_ibpt_item WHERE tabela_id=v_t.id AND tipo=lower(p_tipo)
    AND codigo=regexp_replace(COALESCE(p_codigo,''),'[^0-9]','','g') ORDER BY ex NULLS FIRST LIMIT 1;
  IF v_i.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'codigo_nao_encontrado', 'versao', v_t.versao); END IF;
  v_fed := CASE WHEN p_importado THEN v_i.aliq_importado ELSE v_i.aliq_nacional END;
  RETURN jsonb_build_object('ok', true, 'versao', v_t.versao, 'vigencia_fim', v_t.vigencia_fim,
    'aliq_federal', v_fed, 'aliq_estadual', v_i.aliq_estadual, 'aliq_municipal', v_i.aliq_municipal,
    'aliq_total', round(v_fed + v_i.aliq_estadual + v_i.aliq_municipal, 2), 'descricao', v_i.descricao,
    'vencida', (v_t.vigencia_fim IS NOT NULL AND v_t.vigencia_fim < current_date));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_ibpt_aliquota(uuid, text, text, text, boolean) TO authenticated;

-- ALERTA por VIGÊNCIA (não por versão): tabelas ativas vencidas ou a vencer em <= p_dias
CREATE OR REPLACE FUNCTION public.fn_ibpt_vigencia_status(p_company_id uuid, p_dias int DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_t record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_t FROM public.erp_ibpt_tabela WHERE company_id=p_company_id AND ativo ORDER BY vigencia_fim NULLS LAST LIMIT 1;
  IF v_t.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tem_tabela', false, 'nivel', 'sem_tabela',
      'mensagem', 'Nenhuma tabela IBPT importada. Importe via token (API) ou CSV.'); END IF;
  RETURN jsonb_build_object('ok', true, 'tem_tabela', true, 'versao', v_t.versao, 'uf', v_t.uf, 'vigencia_fim', v_t.vigencia_fim,
    'dias_para_vencer', CASE WHEN v_t.vigencia_fim IS NULL THEN NULL ELSE (v_t.vigencia_fim - current_date) END,
    'nivel', CASE WHEN v_t.vigencia_fim IS NULL THEN 'ok'
                  WHEN v_t.vigencia_fim < current_date THEN 'vencida'
                  WHEN v_t.vigencia_fim <= current_date + p_dias THEN 'a_vencer' ELSE 'ok' END,
    'mensagem', CASE WHEN v_t.vigencia_fim IS NULL THEN 'Tabela sem vigência informada.'
                     WHEN v_t.vigencia_fim < current_date THEN 'Sua tabela IBPT venceu em '||to_char(v_t.vigencia_fim,'DD/MM/YYYY')||'. Atualize antes de emitir.'
                     WHEN v_t.vigencia_fim <= current_date + p_dias THEN 'Sua tabela IBPT vence em '||to_char(v_t.vigencia_fim,'DD/MM/YYYY')||'.'
                     ELSE 'Vigente até '||to_char(v_t.vigencia_fim,'DD/MM/YYYY')||'.' END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_ibpt_vigencia_status(uuid, int) TO authenticated;
