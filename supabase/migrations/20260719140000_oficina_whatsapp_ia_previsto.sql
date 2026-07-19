-- OFICINA LOTE D · WhatsApp IA volta como PREVISTO (RD-33: roadmap visível, nunca 404).
-- Estava desativado (#706) por causar 404 (rota NULL → a RPC sintetizava caminho morto). Agora:
-- ativo=true + legacy=false (a RPC exige) + rota → placeholder "Em construção" (do LOTE #707).
-- Resultado: aparece no menu com badge "Previsto"; clicar abre "Em construção", sem 404.
-- Já está nos 3 planos de oficina (plan_modules). feature_catalog = previsto → badge correto.

UPDATE public.module_catalog
  SET ativo = true,
      legacy = false,
      rota = '/dashboard/em-construcao/oficina_whatsapp_ia'
  WHERE id = 'oficina_whatsapp_ia';
