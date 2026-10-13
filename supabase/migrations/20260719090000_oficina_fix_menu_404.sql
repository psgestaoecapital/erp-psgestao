-- FIX URGENTE · 404 na Oficina. Item de menu ativo apontando p/ rota inexistente (rota NULL) →
-- o mecânico clica e cai numa 404 (parecia sistema quebrado). Regra: menu sem destino real = 404.
-- Desativa TODO item da área oficina que esteja ativo SEM rota (destino inexistente).
-- Culpado atual: oficina_whatsapp_ia ("WhatsApp IA Cliente", ativo=true, rota=NULL).
-- Reversível: reativar quando a tela existir (SET ativo=true + rota real). RD-51 (UI não mente).

UPDATE public.module_catalog
  SET ativo = false
  WHERE grupo = 'oficina'
    AND ativo = true
    AND (rota IS NULL OR btrim(rota) = '');
