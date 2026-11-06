-- Hub · Cockpit da obra — re-apontar a instância DEMO auditada (system_screens) para uma OBRA VIVA.
-- Por quê (PDCA auditor_pdca_1, 31/10, gap 5 · RD-38): a instância registrada era
-- /dashboard/projetos/obras/6257dc23-bd6e-4ca2-bccb-ecdd632d331f/cockpit, mas essa obra NÃO existe em
-- projetos_obras (SELECT = 0 linhas). O cockpit caía no empty-state de "obra inexistente" e o auditor pago
-- pontuava falso-baixo (score 5), sem avaliar a tela real.
-- Correção: apontar para a obra DEMO viva e mais completa (DEMO-FC-001, company 006: receita, custo, viagens,
-- margem e prazo preenchidos), para o auditor avaliar o cockpit com dado real. Limpa os snapshots antigos (eram
-- da página de erro); o auditor regenera no próximo run.
-- Aditiva/segura: UPDATE de 1 linha de metadado com WHERE específico (não toca dado de cliente, RLS, função,
-- fiscal nem financeiro). Idempotente: no 2º run a linha-morta já não existe e 0 linhas são afetadas.
-- Faixa de migration do agente: segundos :10.
UPDATE public.system_screens
   SET rota = '/dashboard/projetos/obras/5a016907-af97-4736-bea4-8057380f3966/cockpit',
       screenshot_url = NULL,
       html_snapshot_url = NULL,
       errors_snapshot_url = NULL
 WHERE rota = '/dashboard/projetos/obras/6257dc23-bd6e-4ca2-bccb-ecdd632d331f/cockpit'
   AND NOT EXISTS (
     SELECT 1 FROM public.system_screens s2
      WHERE s2.rota = '/dashboard/projetos/obras/5a016907-af97-4736-bea4-8057380f3966/cockpit'
   );
