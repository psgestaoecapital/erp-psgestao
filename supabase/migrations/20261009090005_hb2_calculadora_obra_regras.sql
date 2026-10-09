-- HB2 (Calculadora de Obra, fatia 1): regras de cálculo como DADO. company_id nulo = regra de referência (semente, só leitura);
-- empresa ajusta a sua cópia na próxima fatia (escrita só por função). Só objeto NOVO; RLS por empresa; sem anon.
CREATE TABLE IF NOT EXISTS public.erp_calc_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  codigo text NOT NULL CHECK (length(btrim(codigo)) >= 2),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('parede','forro','revestimento','piso','outro')),
  regra jsonb NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_calc_regra_empresa_codigo ON public.erp_calc_regra (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);
ALTER TABLE public.erp_calc_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_calc_regra_select ON public.erp_calc_regra;
CREATE POLICY erp_calc_regra_select ON public.erp_calc_regra FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_calc_regra FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_calc_regra FROM authenticated;
GRANT SELECT ON public.erp_calc_regra TO authenticated;

INSERT INTO public.erp_calc_regra (company_id, codigo, nome, tipo, regra)
SELECT NULL, v.codigo, v.nome, v.tipo, v.regra FROM (VALUES
  ('parede-simples-1-chapa', 'Parede simples (1 chapa por face)', 'parede', $json${"codigo":"parede-simples-1-chapa","nome":"Parede simples (1 chapa por face)","tipo":"parede","referencia":"Trevo Drywall · referência de mercado a validar","parametros":{"perda":1.05,"chapa_m2":2.16},"faixas_pe_direito":[{"de":0.2,"ate":2.5,"bitola":"M48","espacamento_mm":600,"duplo":false},{"de":2.55,"ate":2.7,"bitola":"M48","espacamento_mm":400,"duplo":false},{"de":2.75,"ate":3,"bitola":"M70","espacamento_mm":600,"duplo":false},{"de":3.05,"ate":3.3,"bitola":"M70","espacamento_mm":400,"duplo":false},{"de":3.35,"ate":3.6,"bitola":"M70","espacamento_mm":600,"duplo":true},{"de":3.65,"ate":4.05,"bitola":"M70","espacamento_mm":400,"duplo":true},{"de":4.1,"ate":4.15,"bitola":"M90","espacamento_mm":600,"duplo":true},{"de":4.2,"ate":4.6,"bitola":"M90","espacamento_mm":400,"duplo":true}],"itens":[{"codigo":"chapa","nome":"Chapa de gesso acartonado","unidade_compra":"chapa","por_embalagem":2.16,"por_embalagem_param":"chapa_m2","base":"area","coef":2,"perda":true},{"codigo":"la","nome":"Lã mineral (miolo)","unidade_compra":"m²","por_embalagem":1,"base":"area","coef":1,"perda":true},{"codigo":"guia","nome":"Guia (barra 3 m)","unidade_compra":"barra","por_embalagem":3,"base":"comprimento","coef":2,"perda":true},{"codigo":"montante","nome":"Montante (barra 3 m)","unidade_compra":"barra","por_embalagem":3,"base":"montante_m","coef":1,"perda":false},{"codigo":"parafuso-ppa25","nome":"Parafuso PPA25","unidade_compra":"cento","por_embalagem":100,"base":"area","coef":22,"coef_por_espacamento":{"400":25,"600":22,"600d":30,"400d":33},"perda":false},{"codigo":"massa","nome":"Massa para junta (balde 22 kg)","unidade_compra":"balde","por_embalagem":22,"base":"area","coef":0.94,"perda":false},{"codigo":"fita","nome":"Fita para junta (rolo 150 m)","unidade_compra":"rolo","por_embalagem":150,"base":"area","coef":3,"perda":false}]}$json$::jsonb),
  ('forro-f530', 'Forro estruturado F530', 'forro', $json${"codigo":"forro-f530","nome":"Forro estruturado F530","tipo":"forro","referencia":"Trevo Drywall · referência de mercado a validar","parametros":{"perda":1.05,"chapa_m2":2.16},"faixas_pe_direito":[],"itens":[{"codigo":"chapa","nome":"Chapa de gesso acartonado","unidade_compra":"chapa","por_embalagem":2.16,"por_embalagem_param":"chapa_m2","base":"area","coef":1,"perda":true},{"codigo":"perfil-f530","nome":"Perfil F530 (barra 3 m)","unidade_compra":"barra","por_embalagem":3,"base":"area","coef":1.7,"perda":false},{"codigo":"tabica","nome":"Tabica (barra 3 m), pelo perímetro real","unidade_compra":"barra","por_embalagem":3,"base":"perimetro","coef":1.1,"perda":false},{"codigo":"pendural","nome":"Pendural","unidade_compra":"un","por_embalagem":1,"base":"area","coef":1.25,"perda":false},{"codigo":"tirante","nome":"Tirante","unidade_compra":"un","por_embalagem":1,"base":"area","coef":1.25,"perda":false},{"codigo":"uniao","nome":"União de perfil","unidade_compra":"un","por_embalagem":1,"base":"area","coef":0.45,"perda":false},{"codigo":"parafuso-ppa25","nome":"Parafuso PPA25","unidade_compra":"cento","por_embalagem":100,"base":"area","coef":13,"perda":false},{"codigo":"parafuso-pfm13","nome":"Parafuso PFM13","unidade_compra":"cento","por_embalagem":100,"base":"area","coef":2,"perda":false},{"codigo":"massa","nome":"Massa para junta (balde 22 kg)","unidade_compra":"balde","por_embalagem":22,"base":"area","coef":0.7,"perda":false},{"codigo":"fita","nome":"Fita para junta (rolo 150 m)","unidade_compra":"rolo","por_embalagem":150,"base":"area","coef":1.5,"perda":false}]}$json$::jsonb)
) AS v(codigo, nome, tipo, regra)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_calc_regra r WHERE r.company_id IS NULL AND r.codigo = v.codigo);
