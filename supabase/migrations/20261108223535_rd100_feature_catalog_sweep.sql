-- RD-100 (CEO 01/11, INEGOCIÁVEL) · sweep amplo (GO do eng_chefe 08/11) — feature_catalog.
-- Remove nome de sistema de terceiro / posicionamento vs concorrente do catálogo de features (user-facing),
-- trocando por termo genérico ("sistemas de mercado", "sistema anterior", "sistemas externos").
-- EXCEÇÃO RD-100 preservada: identificador TÉCNICO não visível exigido pelo provedor — ex.: a função
-- fn_parsear_siga_path (nome de função real) NÃO é tocada; só o texto de posicionamento ao redor.
-- Catálogo é DADO DE SISTEMA (não de cliente). Aditivo/IDEMPOTENTE: replace() de substring já trocada é no-op.
-- RD-38: cópia de segurança ANTES (feature_catalog_bkp_rd100) e prova de contagem antes/depois no PR.

-- backup ANTES (snapshot da linha inteira; só grava uma vez por id)
CREATE TABLE IF NOT EXISTS public.feature_catalog_bkp_rd100 (
  id text PRIMARY KEY,
  dados jsonb NOT NULL,
  bkp_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.feature_catalog_bkp_rd100 (id, dados)
SELECT f.id, to_jsonb(f)
FROM public.feature_catalog f
WHERE f.id IN (
  'F.admin.sync_status','F.core.importer_universal','F.financeiro.dre_drag_drop',
  'F.importar.preset_omie','F.importar.preset_siga','F.noc.alertas_etl',
  'F.compliance.ai_copilot_cat_jsa','F.inteligencia.anti_fraude','feat_commerce_reforma'
)
ON CONFLICT (id) DO NOTHING;

-- descricao_executiva
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, 'Omie/Nibo', 'sistemas externos')
 WHERE id = 'F.admin.sync_status';
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, '(Omie, SIGA, ContaAzul)', '(vários sistemas de mercado)')
 WHERE id = 'F.core.importer_universal';
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, 'Diferencial vs ContaAzul (DRE fixo) e Omie (limitado)', 'Diferencial frente a sistemas de mercado (DRE fixo ou limitado)')
 WHERE id = 'F.financeiro.dre_drag_drop';
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, 'pronto para Omie via', 'pronto para sistema de mercado (layout A) via')
 WHERE id = 'F.importar.preset_omie';
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, 'pronto para SIGA via', 'pronto para sistema de mercado (layout B) via')
 WHERE id = 'F.importar.preset_siga';
UPDATE public.feature_catalog SET descricao_executiva = replace(descricao_executiva, 'integracao Omie/Hooked para', 'integracao com sistemas externos para')
 WHERE id = 'F.noc.alertas_etl';

-- observacao
UPDATE public.feature_catalog SET observacao = replace(observacao, 'diferencial vs SAP/TOTVS', 'diferencial frente a sistemas de mercado')
 WHERE id = 'F.compliance.ai_copilot_cat_jsa';
UPDATE public.feature_catalog SET observacao = replace(observacao, 'mapeamentos SIGA em', 'mapeamentos do sistema anterior em')
 WHERE id = 'F.importar.preset_siga';
UPDATE public.feature_catalog SET observacao = replace(observacao, 'Vantagem competitiva vs Omie/ContaAzul', 'Vantagem competitiva frente a sistemas de mercado')
 WHERE id = 'feat_commerce_reforma';

-- descricao_tecnica (posicionamento; a função fn_parsear_siga_path fica intacta por ser identificador técnico)
UPDATE public.feature_catalog SET descricao_tecnica = replace(descricao_tecnica, 'Diferencial vs Omie/ContaAzul', 'Diferencial frente a sistemas de mercado')
 WHERE id = 'F.inteligencia.anti_fraude';
