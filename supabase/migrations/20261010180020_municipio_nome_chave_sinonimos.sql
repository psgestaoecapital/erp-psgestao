-- Caixa jordana-code 7f5305cb (Eng. Chefe 09/10): o gatilho do IBGE (#2290) rodou em 19 clientes que já tinham cidade/UF —
-- 7 preenchidos, 12 sem correspondência só por GRAFIA. Prova no dado (RD-38, consulta de 09/10):
--   "HERVAL D OESTE/SC"       × oficial "Herval d'Oeste"         (4206702)   — apóstrofo
--   "ITAPEJARA D OESTE/PR" ×4 × oficial "Itapejara d'Oeste"      (4111209)   — apóstrofo
--   "SÃO JORGE D OESTE/PR" ×2 × oficial "São Jorge d'Oeste"      (4125209)   — apóstrofo
--   "ESTRELA D OESTE/SP"      × oficial "Estrela d'Oeste"        (3515202)   — apóstrofo
--   "NAO ME TOQUE (RS)/RS" ×3 × oficial "Não-Me-Toque"           (4312658)   — hífen
--   "MOGI MIRIM/SP"           × oficial "Moji Mirim"             (3530805)   — grafia oficial diferente da usual
--
-- UMA regra só (RD-65/RD-71) para o gatilho e para o autocompletar do cadastro (PessoaForm, ClienteForm, CepEndereco e a
-- importação OMIE chamam fn_municipio_por_nome_uf):
--   1) fn_municipio_nome_chave(nome): sem o sufixo " (UF)", sem acento, minúsculas e SÓ letras e números (tira apóstrofo,
--      hífen, ponto e espaços) — "Herval d'Oeste" e "HERVAL D OESTE" viram a mesma chave "hervaldoeste".
--      Conferido na tabela oficial: nenhuma UF tem dois municípios com a mesma chave (0 colisões em 5.570);
--   2) não casou pela chave → tabela de sinônimos oficiais erp_gov_municipio_sinonimo (Mogi Mirim → Moji Mirim e similares);
--   3) não achou → não inventa (RD-51): vazio, a emissão continua avisando.
-- Custo: índice de expressão (uf, fn_municipio_nome_chave(nome_municipio)) na tabela oficial (5.570 linhas, criado uma vez);
-- a busca chama a função só para o nome digitado — nunca por linha da tabela.
-- Aditivo no gatilho: continua só preenchendo IBGE vazio, sem mexer em IE/contribuinte nem em outra coluna.

-- 1) Chave de comparação do nome do município.
CREATE OR REPLACE FUNCTION public.fn_municipio_nome_chave(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(lower(public.f_unaccent(regexp_replace(p_nome, '\s*\(.*\)\s*$', ''))), '[^a-z0-9]', '', 'g')
$$;

REVOKE ALL ON FUNCTION public.fn_municipio_nome_chave(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_municipio_nome_chave(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_municipio_nome_chave(text) IS
  'Chave do nome do município para casar com a tabela oficial: sem " (UF)", sem acento, minúsculas, só letras e números (caixa jordana-code 7f5305cb).';

CREATE INDEX IF NOT EXISTS ix_municipios_uf_nome_chave
  ON public.erp_gov_nfse_municipios (uf, public.fn_municipio_nome_chave(nome_municipio));

-- 2) Sinônimos oficiais: nome usual (chave) → código IBGE. Tabela global de referência (sem dono, sem dado pessoal).
CREATE TABLE IF NOT EXISTS public.erp_gov_municipio_sinonimo (
  uf          char(2) NOT NULL,
  chave       text    NOT NULL,
  codigo_ibge text    NOT NULL REFERENCES public.erp_gov_nfse_municipios(codigo_ibge),
  nome_usual  text    NOT NULL,
  motivo      text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, chave)
);

ALTER TABLE public.erp_gov_municipio_sinonimo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_gov_municipio_sinonimo FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.erp_gov_municipio_sinonimo TO authenticated;
GRANT ALL ON TABLE public.erp_gov_municipio_sinonimo TO service_role;
DROP POLICY IF EXISTS erp_gov_municipio_sinonimo_leitura ON public.erp_gov_municipio_sinonimo;
CREATE POLICY erp_gov_municipio_sinonimo_leitura ON public.erp_gov_municipio_sinonimo
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.erp_gov_municipio_sinonimo IS
  'Grafias usuais de município que a tabela oficial (erp_gov_nfse_municipios) escreve diferente — usadas por fn_municipio_por_nome_uf. Referência global.';

-- Só sinônimos conferidos contra a tabela oficial (o código é FK: grafia que não existe nem entra).
INSERT INTO public.erp_gov_municipio_sinonimo (uf, chave, codigo_ibge, nome_usual, motivo)
SELECT v.uf, public.fn_municipio_nome_chave(v.nome_usual), v.cod, v.nome_usual, v.motivo
FROM (VALUES
  ('SP', 'Mogi Mirim',          '3530805', 'grafia oficial do IBGE: Moji Mirim'),
  ('SP', 'Embu',                '3515004', 'nome antigo; oficial: Embu das Artes'),
  ('RJ', 'Parati',              '3303807', 'grafia antiga; oficial: Paraty'),
  ('RJ', 'Buzios',              '3300233', 'nome usual; oficial: Armação dos Búzios'),
  ('SC', 'Picarras',            '4212809', 'nome antigo; oficial: Balneário Piçarras')
) AS v(uf, nome_usual, cod, motivo)
WHERE EXISTS (SELECT 1 FROM public.erp_gov_nfse_municipios g WHERE g.codigo_ibge = v.cod AND g.uf = v.uf)
ON CONFLICT (uf, chave) DO NOTHING;

-- 3) A regra única. Mesma assinatura e retorno de antes (lida a versão viva em 09/10 com pg_get_functiondef);
--    passa a tirar "/UF" do fim, comparar pela chave e cair nos sinônimos.
CREATE OR REPLACE FUNCTION public.fn_municipio_por_nome_uf(p_nome text, p_uf text)
RETURNS TABLE(codigo_ibge text, nome_municipio text, uf text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_chave text; v_uf text;
BEGIN
  IF p_nome IS NULL OR p_uf IS NULL THEN RETURN; END IF;
  v_uf := upper(btrim(p_uf));
  IF length(v_uf) <> 2 THEN RETURN; END IF;
  -- "Naviraí/MS" ou "Naviraí - MS" no campo cidade → "Naviraí"
  v_chave := public.fn_municipio_nome_chave(regexp_replace(p_nome, '\s*[/-]\s*' || v_uf || '\s*$', '', 'i'));
  IF coalesce(v_chave, '') = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.codigo_ibge, m.nome_municipio, m.uf
      FROM public.erp_gov_nfse_municipios m
     WHERE m.uf = v_uf
       AND public.fn_municipio_nome_chave(m.nome_municipio) = v_chave
     ORDER BY m.codigo_ibge
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.codigo_ibge, m.nome_municipio, m.uf
      FROM public.erp_gov_municipio_sinonimo s
      JOIN public.erp_gov_nfse_municipios m ON m.codigo_ibge = s.codigo_ibge
     WHERE s.uf = v_uf AND s.chave = v_chave
     LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.fn_municipio_por_nome_uf(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_municipio_por_nome_uf(text, text) TO authenticated, service_role;

-- 4) O gatilho do cadastro usa a mesma regra (só preenche IBGE vazio, como na #2290).
CREATE OR REPLACE FUNCTION public.fn_clientes_ibge_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uf  text;
  v_cod text;
BEGIN
  IF coalesce(btrim(NEW.codigo_ibge_municipio), '') <> '' THEN
    RETURN NEW;
  END IF;
  v_uf := upper(btrim(coalesce(NEW.uf, '')));
  IF length(v_uf) <> 2 OR coalesce(btrim(NEW.cidade), '') = '' THEN
    RETURN NEW;
  END IF;

  SELECT f.codigo_ibge INTO v_cod FROM public.fn_municipio_por_nome_uf(NEW.cidade, v_uf) f;

  IF v_cod IS NOT NULL THEN
    NEW.codigo_ibge_municipio := v_cod;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_clientes_ibge_auto() FROM PUBLIC, anon;
