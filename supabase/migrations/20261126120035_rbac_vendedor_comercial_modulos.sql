-- Indústria · habilitar o papel "Vendedor Comercial" (rbac_papel.slug='industria_comercial') — ligar aos módulos.
-- CEO 24/11 (Frioeste): cadastrar vendedores com código acessando o app de vendas. RD-38 (provado no banco):
--  • o papel JÁ existe (industria_comercial, "Vendedor Comercial", vertical industria, ativo) — NÃO criar papel;
--  • GAP real: rbac_papel_modulo do industria_comercial está VAZIO → quem recebe o papel não abre NENHUM módulo
--    (fn_pode_acessar_rota/fn_modulos_sidebar_por_area liberam o módulo SSE ele está no rbac_papel_modulo do papel);
--  • acesso a dado do vendedor (ver só as próprias vendas) NÃO depende deste papel: é o vínculo de código em
--    com_vendedor_acesso que fn_bi_comercial_scope usa (modo 'vendedor'). Este papel só governa QUAIS MÓDULOS abrem.
--  • níveis válidos em rbac_papel_modulo: 'ver' | 'editar'. Vendedor só precisa VER/usar (não administra).
--  • Frioeste (975365cc-…10d8) já tem os 3 módulos na assinatura ativa (comercial_meu_painel, app 3fe599cd,
--    admin_vendedores) — nada a habilitar por empresa.
-- Aditivo e idempotente (WHERE NOT EXISTS). NÃO inclui admin_vendedores (é do admin que cadastra, não do vendedor).
-- Nenhuma permissão existente é alterada/removida.

-- Painel comercial "Meu painel de vendas" (o vendedor vê só as próprias vendas; isolação por com_vendedor_acesso).
INSERT INTO public.rbac_papel_modulo (papel_slug, module_id, nivel, criado_por)
SELECT 'industria_comercial', 'comercial_meu_painel', 'ver', 'code-desenvolvedor-3'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rbac_papel_modulo
  WHERE papel_slug='industria_comercial' AND module_id='comercial_meu_painel');

-- App de vendas (celular) — /dashboard/comercial/instalar-app.
INSERT INTO public.rbac_papel_modulo (papel_slug, module_id, nivel, criado_por)
SELECT 'industria_comercial', '3fe599cd-8cd1-443d-b856-061c20754aca', 'ver', 'code-desenvolvedor-3'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rbac_papel_modulo
  WHERE papel_slug='industria_comercial' AND module_id='3fe599cd-8cd1-443d-b856-061c20754aca');
