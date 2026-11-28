-- RD-98 p1 (estado_real) + p3 (origem do dado): classifica
-- /dashboard/ehs/combate-incendio (M14 fatia 1 · NR-23 extintores/hidrantes).
--
-- Contexto: reauditoria de jornada (auditor_pdca_1 · 28/11, pós #5833) — a tela PASSA a–g
-- com dado REAL na DEMO EHS (b0700000-...-000b, 4 equipamentos ativos, 1 vencido / 1 a vencer).
-- Só faltava o registro RD-98:
--   p1) system_screens.estado_real estava 'desconhecida' → a tela tem dado real e funciona.
--   p3) system_screens.views_consumidas / rpcs_chamadas vazios → registrar a origem do dado.
--
-- OBS (RD-38 · prova no dado, nunca supor): o auditor pediu estado_real='real', mas esse valor
-- NÃO existe no domínio — o CHECK de system_screens.estado_real só aceita
-- pronto/parcial/placeholder/quebrada/desconhecida/removido (é "maturidade de produto",
-- conforme 20260903140000). 'real' quebraria o deploy-migrations. Mapeado para 'parcial':
-- a tela funciona com dado real (logo, não é 'desconhecida'/'placeholder'), mas M14 é a fatia 1
-- — a inspeção mensal no app vem em fatia futura (o próprio blueprint de M14 fica 'parcial',
-- ver 20261129150045_ehs_m14_combate_incendio.sql). Escolha conservadora e honesta; se o
-- CEO/Eng. Chefe quiser 'pronto', é uma linha.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS, grants,
-- segredo/vault nem cálculo. Tabela e RPCs apenas REFERENCIADAS pelo nome. Aditivo e idempotente.
--
-- Fontes conferidas no código vivo (RD-38):
--   src/app/dashboard/ehs/combate-incendio/page.tsx:
--     from('ehs_combate_incendio') — leitura (select, filtro ativo=true + company_id),
--       soft-delete (update ativo=false + excluido_em/por/motivo) e gravação do cadastro
--       (insert/update na mesma tabela).
--     componente AjudaCampo → rpc fn_ajuda_campo_listar (texto do "?") e fn_ajuda_campo_uso.
--   A relação e as 2 RPCs existem em public (conferido em pg_class / pg_proc).
UPDATE public.system_screens
SET views_consumidas = ARRAY['ehs_combate_incendio']::text[],
    rpcs_chamadas     = ARRAY['fn_ajuda_campo_listar', 'fn_ajuda_campo_uso']::text[],
    estado_real       = 'parcial',
    atualizado_em     = now()
WHERE rota = '/dashboard/ehs/combate-incendio'
  AND estado_real = 'desconhecida';
