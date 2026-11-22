-- Reconciliação do ledger de cobertura §310 (Hub · Dashboard geral) — RD-38 / RD-52
--
-- Doutrina RD-38: "auditar e provar no dado, nunca supor"; o ledger não pode mentir.
-- Dois requisitos do blueprint vivo da tela 310 estão com status_baseline='ausente'
-- mas JÁ ESTÃO IMPLEMENTADOS na tela viva (/dashboard/projetos — página do Hub):
--
--   c8da1f90  "'Por onde começar' passa a se chamar 'Ferramentas de Gestão', sem a
--              numeração 1-2-3, com atalhos para Funil de oportunidades, Obras e
--              Resultado por obra e espaço para novos atalhos. [relatório 03]"
--
--     Prova no código (src/app/dashboard/projetos/page.tsx, main):
--       * <SectionLabel>Ferramentas de Gestão</SectionLabel> (L470) — o título "Por onde
--         começar" foi renomeado; não há numeração 1-2-3 (grid simples de cards, L471-478).
--       * const PASSOS (L60-66): atalhos SEM número — "Funil de oportunidades"
--         (/dashboard/projetos/oportunidades), "Obras" (/dashboard/projetos/obras) e
--         "Resultado por obra" (/dashboard/projetos/obras/resultado) — os três pedidos —,
--         mais "Agenda e tarefas" e "Plano de ação 5W2H" (o grid md:grid-cols-3 comporta
--         novos atalhos conforme o Hub cresce = "espaço para novos atalhos").
--
--   d4f358fd  "Novidades do Hub e sugestões de uso ficam curtas e no fim da página; o
--              botão de configuração de BDI sai do topo. [reunião 20/11 · relatório 01]"
--
--     Prova no código (mesma página, main):
--       * Seção "Novidades do Hub" (data-testid="novidades-hub", L483) fica no FIM da
--         página — depois dos indicadores, funil e obras — com apenas 2 cards curtos
--         (Resultado por obra, Cockpit da obra). O topo abre direto nos indicadores.
--       * A configuração de BDI SAIU do topo: a ação "Configurar BDI da empresa"
--         (/dashboard/projetos/configuracoes) fica na última seção "Configuração da
--         empresa" (L501-513), ao fim da página, com AjudaCampo "?".
--
-- Esta migration só corrige o ledger (status_baseline ausente -> atendido) DESSES dois
-- requisitos provados na tela viva. NÃO toca os demais requisitos da 310 genuinamente
-- pendentes (painel gerencial do dia, modos, bloco financeiro da GE, indicadores
-- clicáveis, filtros do dashboard, pendências documentais, etc.).
--
-- Valor 'atendido' = o permitido pelo CHECK blueprint_tela_requisito_status_chk
--   {ausente,parcial,atendido,travado}; 'completo' NÃO existe (quebraria o deploy — RD-52).
-- Aditiva e idempotente: guarda por status_baseline='ausente' (re-rodar não altera nada).
-- Sem RLS/policy/grant; blueprint_tela_requisito é ledger interno de cobertura, não é
-- dado de cliente.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE id IN (
         'c8da1f90-24d2-4782-a945-76ce68ab12a2',  -- "Ferramentas de Gestão" (ex-"Por onde começar")
         'd4f358fd-a8bf-433b-abbd-d24b43d11d48'   -- Novidades ao fim + BDI fora do topo
       )
   AND vertical = 'hub_projetos'
   AND tela_num = 310
   AND status_baseline = 'ausente';
