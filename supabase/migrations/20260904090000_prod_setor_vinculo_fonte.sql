-- Produtividade · SETOR/CARGO é VÍNCULO, não texto (correção de arquitetura do CEO).
--
-- O problema: um setor do PS ("Abate") agrupa VÁRIOS nomes de cada base — no ponto: ABATE, DESCARGA
-- E ABATE, BALANÇA DE CARCAÇAS; na produção (ATAK): ABT0101, ABT0103, ABT0106. JOIN por texto casa
-- por coincidência (e "Abate" ≠ "ABATE" já falha), e renomear quebra o cálculo em silêncio.
--
-- Regra (registrada em erp_contexto_projeto): NENHUM objeto do banco tem nome de fornecedor. O nome
-- do sistema ("ATAK", "IO Point") é CONFIGURAÇÃO (dado em prod_fonte_dados.nome), nunca estrutura.
-- Duas fontes genéricas por tipo ('producao' | 'ponto'); o vínculo guarda a CHAVE, não o nome.
--
-- Marcar a sugestão preenche o VÍNCULO. Aí renomear o setor vira cosmético e o cálculo segue pela chave.

-- 1 · Fonte de dados (genérica; o nome do sistema é config).
CREATE TABLE IF NOT EXISTS public.prod_fonte_dados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id   uuid NOT NULL,
  tipo       text NOT NULL CHECK (tipo IN ('producao','ponto')),
  nome       text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_fonte_dados_plant ON public.prod_fonte_dados(company_id, plant_id, tipo);

-- 2 · Vínculo setor↔chave-da-fonte (1 linha por chave). rotulo = o que a fonte mostra.
CREATE TABLE IF NOT EXISTS public.prod_setor_vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id   uuid NOT NULL,
  setor_id   uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE CASCADE,
  fonte_id   uuid NOT NULL REFERENCES public.prod_fonte_dados(id) ON DELETE CASCADE,
  chave      text NOT NULL,
  rotulo     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fonte_id, chave)   -- uma chave de uma fonte pertence a NO MÁXIMO um setor
);
CREATE INDEX IF NOT EXISTS idx_prod_setor_vinculo_setor ON public.prod_setor_vinculo(setor_id);

-- 3 · Vínculo cargo↔chave-da-fonte (mesma estrutura).
CREATE TABLE IF NOT EXISTS public.prod_cargo_vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id   uuid NOT NULL,
  cargo_id   uuid NOT NULL REFERENCES public.prod_cargo(id) ON DELETE CASCADE,
  fonte_id   uuid NOT NULL REFERENCES public.prod_fonte_dados(id) ON DELETE CASCADE,
  chave      text NOT NULL,
  rotulo     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fonte_id, chave)
);
CREATE INDEX IF NOT EXISTS idx_prod_cargo_vinculo_cargo ON public.prod_cargo_vinculo(cargo_id);

-- RLS tenant (padrão do projeto: empresa do usuário OU admin).
ALTER TABLE public.prod_fonte_dados   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_setor_vinculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_cargo_vinculo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prod_fonte_dados' AND policyname='p_prod_fonte_tenant') THEN
    CREATE POLICY p_prod_fonte_tenant ON public.prod_fonte_dados FOR ALL TO public
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin()); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prod_setor_vinculo' AND policyname='p_prod_setor_vinc_tenant') THEN
    CREATE POLICY p_prod_setor_vinc_tenant ON public.prod_setor_vinculo FOR ALL TO public
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin()); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prod_cargo_vinculo' AND policyname='p_prod_cargo_vinc_tenant') THEN
    CREATE POLICY p_prod_cargo_vinc_tenant ON public.prod_cargo_vinculo FOR ALL TO public
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin()); END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prod_fonte_dados, public.prod_setor_vinculo, public.prod_cargo_vinculo TO authenticated;

-- Semente idempotente das fontes existentes (nome = config, renomeável). Só onde há dado real.
INSERT INTO public.prod_fonte_dados (company_id, plant_id, tipo, nome)
SELECT DISTINCT c.company_id, c.plant_id, 'ponto',
       COALESCE((SELECT pc.provider FROM ind_ponto_provider_config pc
                  WHERE pc.company_id=c.company_id AND pc.plant_id=c.plant_id AND pc.ativo LIMIT 1), 'Ponto eletrônico')
FROM ind_ponto_colaborador c
JOIN industrial_plants ip ON ip.id = c.plant_id AND ip.company_id = c.company_id
WHERE NOT EXISTS (SELECT 1 FROM public.prod_fonte_dados f WHERE f.company_id=c.company_id AND f.plant_id=c.plant_id AND f.tipo='ponto');

INSERT INTO public.prod_fonte_dados (company_id, plant_id, tipo, nome)
SELECT DISTINCT ip.company_id, ip.id, 'producao', 'ATAK'
FROM industrial_plants ip
WHERE EXISTS (SELECT 1 FROM ind_atak_fato af WHERE af.company_id=ip.company_id AND af.dominio='producao_frigorifico')
  AND NOT EXISTS (SELECT 1 FROM public.prod_fonte_dados f WHERE f.company_id=ip.company_id AND f.plant_id=ip.id AND f.tipo='producao');

-- 4 · Chaves disponíveis de uma fonte, com contagem e a QUEM já está vinculada (pra agrupar sem duplicar).
--     p_alvo = 'setor' | 'cargo'. A leitura é por TIPO da fonte (produto sabe ler cada base); o schema
--     acima não tem nome de fornecedor.
CREATE OR REPLACE FUNCTION public.fn_prod_fonte_chaves(p_company_id uuid, p_plant_id uuid, p_fonte_id uuid, p_alvo text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tipo text; v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT tipo INTO v_tipo FROM prod_fonte_dados WHERE id = p_fonte_id AND company_id = p_company_id AND plant_id = p_plant_id;
  IF v_tipo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'fonte_invalida'); END IF;

  IF v_tipo = 'ponto' THEN
    WITH base AS (
      SELECT g.chave, g.contagem FROM (
        SELECT btrim(CASE WHEN p_alvo='cargo' THEN funcao ELSE departamento END) AS chave, count(*)::int AS contagem
        FROM ind_ponto_colaborador
        WHERE company_id = p_company_id AND plant_id = p_plant_id
          AND COALESCE(btrim(CASE WHEN p_alvo='cargo' THEN funcao ELSE departamento END),'') <> ''
        GROUP BY 1
      ) g
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('chave', b.chave, 'contagem', b.contagem,
             'vinculado_a', CASE WHEN p_alvo='cargo'
                THEN (SELECT c.nome FROM prod_cargo_vinculo cv JOIN prod_cargo c ON c.id=cv.cargo_id WHERE cv.fonte_id=p_fonte_id AND cv.chave=b.chave)
                ELSE (SELECT s.nome FROM prod_setor_vinculo sv JOIN prod_setor s ON s.id=sv.setor_id WHERE sv.fonte_id=p_fonte_id AND sv.chave=b.chave) END)
           ORDER BY b.contagem DESC, b.chave), '[]'::jsonb) INTO v FROM base b;

  ELSIF v_tipo = 'producao' THEN
    IF p_alvo = 'cargo' THEN
      RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'itens', '[]'::jsonb); -- produção não tem cargo
    END IF;
    WITH base AS (
      SELECT (raw->>'PERFIL_TMV') AS chave, count(*)::int AS contagem
      FROM ind_atak_fato
      WHERE company_id = p_company_id AND dominio = 'producao_frigorifico' AND COALESCE(raw->>'PERFIL_TMV','') <> ''
      GROUP BY 1
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('chave', b.chave, 'contagem', b.contagem,
             'vinculado_a', (SELECT s.nome FROM prod_setor_vinculo sv JOIN prod_setor s ON s.id=sv.setor_id WHERE sv.fonte_id=p_fonte_id AND sv.chave=b.chave))
           ORDER BY b.contagem DESC, b.chave), '[]'::jsonb) INTO v FROM base b;
  ELSE
    v := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'itens', v);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_prod_fonte_chaves(uuid, uuid, uuid, text) TO authenticated;
