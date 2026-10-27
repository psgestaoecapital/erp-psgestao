-- Hub · /dashboard/projetos/oportunidades — delta 93 -> 95 (aud 27/10 13:44 · Code: desenvolvedor_4_g)
-- Auditor PDCA (visual 93, bugs_detectados vazio): "? no card/colunas + RD-98 -> 95".
--   RD-95: o card do funil ganha "?" DEDICADO em dois indicadores que só tinham o "?" geral do card:
--          o badge de ANEXOS e o badge de PROBABILIDADE (% de fechar). Chaves novas em erp_ajuda_campo.
--          (card_anexos já existia no banco; card_probabilidade é nova.)
--   RD-98 pilar 3 (ORIGEM): a rota estava com system_screens.views_consumidas/rpcs_chamadas vazios (null).
--          Registra a origem real do dado desta tela (grep .from + .rpc em page.tsx, OportunidadesKanban.tsx,
--          OportunidadeFormModal.tsx e [id]/page.tsx). 'projetos-plantas' NÃO entra (é bucket de storage, não view).
--
-- Migration ADITIVA (RD-94.1): só INSERT de ajuda (ON CONFLICT DO NOTHING) + UPDATE de catálogo de telas. Sem RLS,
-- sem tocar dado de cliente, sem alterar função/view existente.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.oportunidades.card_anexos', 'Oportunidades', 'Anexos no card',
   'Nada a preencher: é o número de arquivos (plantas, fotos, propostas) anexados a esta oportunidade.',
   'Mostra, direto no card do funil, quantos anexos a oportunidade tem — sem precisar abrir a ficha. Clipe com número = há arquivos; sem o clipe = nenhum anexo ainda.',
   'Um card com "📎 2" tem duas plantas/fotos anexadas; abra a oportunidade para ver ou baixar cada uma.',
   'Achar que a ausência do clipe é erro: significa apenas que ninguém anexou arquivo ainda — anexe pela ficha da oportunidade.',
   61, '/dashboard/projetos/oportunidades'),
  ('projetos.oportunidades.card_probabilidade', 'Oportunidades', 'Probabilidade de fechar',
   'Nada a preencher aqui: o percentual vem do que você definiu na ficha da oportunidade (campo Probabilidade).',
   'Mostra, no card, a chance estimada de ganhar o negócio (0 a 100%). Serve para priorizar o funil: foque primeiro nas de maior probabilidade e maior valor.',
   'Uma proposta já em negociação adiantada pode estar com 80%; um lead recém-chegado, com 20%.',
   'Confundir com a etapa do funil: a etapa é o estágio (prospecção, orçando…); a probabilidade é a sua aposta de fechar, que você ajusta na ficha.',
   62, '/dashboard/projetos/oportunidades')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado das telas de /dashboard/projetos/oportunidades (page.tsx + Kanban + FormModal + [id]/page.tsx)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_crm_oportunidade',            -- funil: lista das oportunidades (filtra deleted_at)
        'erp_clientes',                    -- cliente de cada oportunidade (join + busca no form)
        'erp_crm_interacao',               -- histórico de interações na ficha
        'erp_crm_oportunidade_historico',  -- quem moveu / tempo por etapa
        'erp_crm_visita',                  -- visita técnica ligada ao lead
        'erp_orcamentos',                  -- proposta gerada a partir da oportunidade
        'projetos_obras'                   -- obra criada quando a oportunidade é ganha
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_crm_pipeline',                     -- resumo do funil (pipeline/ganhas no mês)
        'fn_crm_mover_etapa',                  -- arrastar card entre etapas (com trava/auditoria)
        'fn_crm_oportunidade_ganhar',          -- marcar como ganha (vira obra)
        'fn_crm_oportunidade_excluir',         -- soft-delete rastreável (RD-55)
        'fn_crm_oportunidade_retornar_funil',  -- devolver uma terminal (ganho/perdido) ao funil
        'fn_crm_oportunidades_fechadas',       -- abrir a lista de ganhas/perdidas
        'fn_crm_orcamento_do_card',            -- orçamento vinculado ao card
        'fn_crm_quem_moveu',                   -- autor do último movimento (card)
        'fn_crm_tempo_etapa',                  -- tempo parado na etapa (card)
        'fn_oportunidade_gerar_orcamento',     -- gerar proposta a partir da oportunidade
        'fn_usuarios_da_empresa',              -- responsáveis para o filtro/atribuição
        'next_orcamento_numero'                -- numeração da proposta gerada
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/oportunidades';
