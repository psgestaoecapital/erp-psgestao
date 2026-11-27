-- feat(hub · §310): reconcilia baseline do Dashboard geral (2 linhas já entregues na tela)
--
-- Regra V32 (CEO 21/11): ao publicar, o dev marca as linhas do blueprint que a tela já atende.
-- Duas linhas de §310 estão entregues em src/app/dashboard/projetos/page.tsx mas seguiam 'ausente':
--
--  1) c8da1f90 — "Por onde começar" vira "Ferramentas de Gestão", sem numeração 1-2-3, com atalhos
--     para Funil de oportunidades, Obras e Resultado por obra e espaço para novos atalhos.
--     PROVA (RD-38): const PASSOS = [Funil de oportunidades, Obras, Resultado por obra, Agenda e
--     tarefas, Plano de ação 5W2H] — grid sem numeração, comporta novos atalhos; SectionLabel
--     "Ferramentas de Gestão".
--  2) d4f358fd — Novidades do Hub e sugestões curtas no fim da página; botão de BDI sai do topo.
--     PROVA (RD-38): seção "Novidades do Hub" (data-testid novidades-hub) ao fim; "Configurar BDI
--     da empresa" na última seção ("saiu do topo e fica aqui, ao fim").
--
-- Aditivo (só UPDATE de metadado do blueprint), idempotente (WHERE status_baseline <> 'atendido').

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'src/app/dashboard/projetos/page.tsx · /dashboard/projetos · PASSOS=[Funil, Obras, Resultado por obra, Agenda, Plano 5W2H], sem numeração'
 WHERE id = 'c8da1f90-24d2-4782-a945-76ce68ab12a2'
   AND status_baseline <> 'atendido';

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'src/app/dashboard/projetos/page.tsx · /dashboard/projetos · seção "Novidades do Hub" ao fim + "Configurar BDI" na última seção (saiu do topo)'
 WHERE id = 'd4f358fd-a8bf-433b-abbd-d24b43d11d48'
   AND status_baseline <> 'atendido';
