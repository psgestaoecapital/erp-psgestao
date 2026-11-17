-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas da tela /dashboard/ehs/setores.
-- A tela LISTA/CRIA/EDITA/DESATIVA setores lendo e gravando direto na tabela compliance_setores
-- (src/app/dashboard/ehs/setores/page.tsx: supabase.from('compliance_setores') em select/insert/update).
-- Nao ha .rpc() na tela. Aditivo, idempotente, so metadado de catalogo (nao toca dado de cliente).
UPDATE public.system_screens
SET views_consumidas = ARRAY['compliance_setores']::text[]
WHERE rota = '/dashboard/ehs/setores';
