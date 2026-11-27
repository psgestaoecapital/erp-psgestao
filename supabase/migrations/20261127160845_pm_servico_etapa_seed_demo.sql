-- P&M · tela 135 "Tempo medido sem clique" (CEO 25/11) · SEED SÓ-DEMO
-- Semeia um fluxo de produção padrão de etapas por serviço na DEMO P&M, para tornar
-- DEMONSTRÁVEL o recurso da slice 1 (modal "Etapas" no Catálogo de Serviços) e da
-- instanciação por job (fn_agency_job_etapas_listar): com modelos preenchidos, o job
-- da DEMO nasce com as etapas e o tempo por etapa passa a ser medido por calendário.
--
-- SÓ-DEMO, ADITIVO e IDEMPOTENTE: TODA escrita é guardada pelo id da empresa DEMO P&M
-- (b0700000-0000-4000-a000-000000000002). Só insere em serviço que hoje tem 0 etapas
-- (não sobrescreve nada que o usuário tenha criado). Não altera tabela, função, RLS,
-- grant, trigger ou dado de empresa real.
-- Code: desenvolvedor_4_g

DO $$
DECLARE
  v_demo constant uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  -- só mexe se a empresa DEMO existir (idempotente em ambientes sem a DEMO)
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_demo AND c.is_demo = true) THEN
    RETURN;
  END IF;

  INSERT INTO public.agency_servico_etapa
    (company_id, servico_id, nome, descricao, ordem, medir_tempo)
  SELECT v_demo, s.id, e.nome, e.descricao, e.ordem, true
    FROM public.agency_servico s
    CROSS JOIN (VALUES
      (1, 'Briefing',             'Alinhar objetivo, referências e requisitos da peça com o cliente.'),
      (2, 'Criação',              'Produção da peça (design, redação, roteiro) conforme o briefing.'),
      (3, 'Revisão interna',      'Conferência de qualidade e aderência ao briefing antes de enviar.'),
      (4, 'Aprovação do cliente', 'Envio para aprovação e aguardo do retorno do cliente.'),
      (5, 'Ajustes finais',       'Aplicação dos ajustes solicitados na aprovação.'),
      (6, 'Publicação',           'Entrega/publicação da peça aprovada no canal combinado.')
    ) AS e(ordem, nome, descricao)
   WHERE s.company_id = v_demo
     AND s.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.agency_servico_etapa x WHERE x.servico_id = s.id
     );
END $$;
