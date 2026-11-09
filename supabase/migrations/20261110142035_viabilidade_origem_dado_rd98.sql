-- PDCA GE (aud8claudeps) · /dashboard/viabilidade · RD-98 pilar 3 (origem do dado) + classificação de system_screens
-- A tela mostra uma análise gerada pela IA via o endpoint /api/consultor (não há view/RPC de negócio direta).
-- Os únicos acessos a dado são o seletor de empresa (companies, company_groups, user_companies, users).
-- Registra esses como views_consumidas e tira a rota de 'desconhecida' -> 'parcial' (funcional; falta a prévia guiada do relatório, gap4).
-- Aditivo/idempotente: views via UNION (nunca remove o que já existia); estado_real só muda se ainda for 'desconhecida'.
-- system_screens é metadata de SISTEMA (catálogo de telas), não dado de cliente; sem tocar backend/cálculo/RLS.
-- Code: code-desenvolvedor-3

UPDATE public.system_screens
SET views_consumidas = ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(views_consumidas, '{}'::text[])
        || ARRAY['companies','company_groups','user_companies','users']::text[]
      ) ORDER BY 1),
    estado_real = CASE WHEN estado_real = 'desconhecida' THEN 'parcial' ELSE estado_real END,
    atualizado_em = now()
WHERE rota = '/dashboard/viabilidade';
