-- NFE-F5 · fix (RD-44/45 · achado do CEO): existiam DUAS entradas de Reforma Tributária no catálogo.
--   reforma_tributaria_2026 → /dashboard/em-construcao/... (ATIVA, e é a que os tenants já têm — KGF inclusive)
--   commerce_reforma_tributaria → /dashboard/commerce/reforma (a que ativei por engano no #1188)
-- Resultado: mesmo com a tela real pronta, a Jordana cairia em "em construção" — selo mentiroso (RD-58).
--
-- Correção (como o CEO pediu): REPONTAR a entrada que os tenants já têm (reforma_tributaria_2026) para a
-- tela real — assim quem já tem o módulo herda a tela SEM precisar de nova ativação — e desativar a
-- duplicata que criei (commerce_reforma_tributaria). RD-26: eu deveria ter achado reforma_tributaria_2026
-- antes de ativar um slot novo.

-- 1) repontar a entrada existente p/ a tela real (não desativa: tenants herdam)
UPDATE public.module_catalog
   SET rota = '/dashboard/commerce/reforma', grupo = 'commerce', subgrupo = 'compras'
 WHERE id = 'reforma_tributaria_2026';

-- 2) desativar a duplicata que ativei no #1188 (catálogo + a ativação por tenant que adicionei p/ a KGF)
UPDATE public.module_catalog SET ativo = false WHERE id = 'commerce_reforma_tributaria';
UPDATE public.tenant_modules_active SET is_active = false, deactivated_at = now()
 WHERE module_id = 'commerce_reforma_tributaria';
