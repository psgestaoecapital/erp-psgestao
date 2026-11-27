-- RD-98 pilar 3 (origem do dado) · Hub · tela 109 "Calendário da obra"
-- Rota /dashboard/projetos/obras/[id]/calendario (publicada em #6261, Code: desenvolvedor_4_g).
--
-- Problema (auditor PDCA · aud8 26/11, gap 2): a rota NÃO está em public.system_screens
--   (prova RD-38, produção 26/11: SELECT count(*) FROM system_screens
--    WHERE rota='/dashboard/projetos/obras/[id]/calendario' → 0).
-- Sem a linha, o auditor não confere de onde a tela lê/grava (origem do dado) e a RD-98 p3
-- fica aberta — mesma régua das telas irmãs de /obras/[id]/* que já têm linha.
--
-- Fonte CONFERIDA no código vivo (main), não suposta (RD-38):
--   src/app/dashboard/projetos/obras/[id]/calendario/page.tsx
--     rpcs_chamadas: fn_obra_calendario_listar (l.48), fn_obra_calendario_salvar (l.64),
--                    fn_obra_calendario_excluir (l.81)  — únicos acessos ao banco (nenhum .from())
--     tabela de origem dos RPCs: projetos_obra_calendario (migration 20261127162245, no ledger)
--
-- Aditivo e idempotente (só INSERT com guarda NOT EXISTS em system_screens, catálogo interno de
-- auditoria): não toca núcleo, RLS, menu, função, dado de cliente nem estrutura. Re-run não duplica.
--
-- RD-38:
--   ANTES: 0 linhas para a rota.
--   DEPOIS: 1 linha, rpcs = 3 funções, views = {projetos_obra_calendario}.

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, modulo, estado_real)
SELECT gen_random_uuid(),
       '/dashboard/projetos/obras/[id]/calendario',
       'hub_construcao',
       'Calendário da obra',
       'Dias não úteis da obra (feriados, folgas e pontos facultativos) usados para o prazo real do cronograma. CRUD com exclusão lógica rastreável; leitura/gravação guardadas por empresa (fn_obra_calendario_*). Aberta pelo Cockpit da obra.',
       ARRAY['projetos_obra_calendario'],
       ARRAY['fn_obra_calendario_listar','fn_obra_calendario_salvar','fn_obra_calendario_excluir'],
       'projetos_obras',
       'parcial'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_screens
  WHERE rota = '/dashboard/projetos/obras/[id]/calendario'
);
