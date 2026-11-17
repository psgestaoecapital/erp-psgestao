-- Central de Metas (/dashboard/metas) · campo de valor da meta — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): o campo onde o gestor digita a meta de cada indicador
--   (src/components/metas/CentralMetas.tsx, CardMeta) não tinha "?".
-- CORREÇÃO (aditiva, idempotente): 1 chave NOVA no grupo "Metas".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('metas.definir.valor', '/dashboard/metas', 'Metas', 'Valor da meta',
   'O número que você quer atingir neste indicador, na mesma unidade dele (R$, %, dias, unidades…). O sistema sugere, mas a meta é sua decisão (RD-25).',
   'Vira a referência do indicador: o sistema compara o realizado com este valor e sinaliza se está acima ou abaixo, conforme a direção boa (maior ou menor é melhor).',
   'Prazo médio de entrega (menor é melhor) → 5 (dias).',
   'Digitar o valor em unidade diferente do indicador (ex.: 0,05 quando a meta é 5%) deixa a comparação errada — use a mesma unidade mostrada.',
   'geral', 9210)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
