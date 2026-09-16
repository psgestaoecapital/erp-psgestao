-- Central de Dev — mesma lente do BPO aplicada ao WEALTH (RD-38).
-- O "em uso" do wealth vinha SÓ de wealth_pluggy_items (sincronização Pluggy/open-finance por robô),
-- não de gente usando o módulo (wealth_clients/consultores = 0 em 30d). Isso é AUTOMAÇÃO, não uso.
-- Reclassifica as tabelas Pluggy como automacao → em-uso do wealth passa a refletir uso humano;
-- a sincronização aparece à parte, como no BPO.

UPDATE public.dev_area_tabela_uso SET papel='automacao', rotulo='sincronização Pluggy'
  WHERE area_slug='wealth' AND table_name IN ('wealth_pluggy_items','wealth_pluggy_consents');
