-- Reconciliação do ledger de cobertura §310 (Hub · Dashboard geral) — RD-38 / RD-52
--
-- Doutrina RD-38: "auditar e provar no dado, nunca supor"; o ledger não pode mentir.
-- Dois requisitos do blueprint vivo da tela 310 estão marcados status_baseline='ausente'
-- mas JÁ ESTÃO IMPLEMENTADOS na tela viva (src/app/dashboard/projetos/page.tsx):
--
--  1) c8da1f90  "'Por onde começar' passa a se chamar 'Ferramentas de Gestão', sem a
--                numeração 1-2-3, com atalhos..."
--     Prova no código: comentário §310 em page.tsx L58-59 ("Ferramentas de Gestão
--     ... atalhos de trabalho SEM numeração 1-2-3") e a seção <SectionLabel>Ferramentas
--     de Gestão</SectionLabel> (L468-470). O rótulo antigo e a numeração não existem mais.
--
--  2) d4f358fd  "Novidades do Hub e sugestões de uso ficam curtas e no fim da página; o
--                botão de configuração de BDI sai do topo."
--     Prova no código: page.tsx L484 (<SectionLabel>Novidades do Hub</SectionLabel> ao fim),
--     L226 (comentário "BDI saiu do topo (fica ao fim...)") e L501-511 (seção
--     "CONFIGURAÇÃO DA EMPRESA — §310: a configuração de BDI saiu do topo e fica aqui, ao fim"
--     com o botão "Configurar BDI da empresa").
--
-- Esta migration só corrige o ledger (status_baseline ausente -> atendido) desses dois
-- requisitos provados. NÃO toca requisitos genuinamente pendentes da 310 (filtros do
-- dashboard, bloco financeiro reaproveitado, modos, comparação entre obras, pós-obra).
-- (Valor 'atendido' é o permitido pelo CHECK blueprint_tela_requisito_status_chk
--  {ausente,parcial,atendido,travado}; 'completo' NÃO existe e quebraria o deploy — RD-52.)
--
-- Aditiva e idempotente: guarda por status_baseline='ausente' (re-rodar não altera nada).
-- Sem RLS/policy/grant; blueprint_tela_requisito é tabela de referência interna de cobertura,
-- não é dado de cliente.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE id IN (
         'c8da1f90-24d2-4782-a945-76ce68ab12a2',  -- "Ferramentas de Gestão" (sem numeração)
         'd4f358fd-a8bf-433b-abbd-d24b43d11d48'   -- Novidades/sugestões ao fim + BDI fora do topo
       )
   AND vertical = 'hub_projetos'
   AND tela_num = 310
   AND status_baseline = 'ausente';
