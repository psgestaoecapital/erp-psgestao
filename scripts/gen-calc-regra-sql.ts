// Gera o INSERT de semente da migration da Calculadora de Obra a partir das regras de referência (fonte única).
import { SISTEMAS_REFERENCIA } from '../src/lib/hub/calculadoraObraReferencia'
const linhas = SISTEMAS_REFERENCIA.map(s => `  ('${s.codigo}', '${s.nome}', '${s.tipo}', $json$${JSON.stringify(s)}$json$::jsonb)`)
console.log(`INSERT INTO public.erp_calc_regra (company_id, codigo, nome, tipo, regra)\nSELECT NULL, v.codigo, v.nome, v.tipo, v.regra FROM (VALUES\n${linhas.join(',\n')}\n) AS v(codigo, nome, tipo, regra)\nWHERE NOT EXISTS (SELECT 1 FROM public.erp_calc_regra r WHERE r.company_id IS NULL AND r.codigo = v.codigo);`)
