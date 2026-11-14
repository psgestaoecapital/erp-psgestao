-- PDCA Hub · /dashboard/projetos/obras/os (aud8 93/95) — indicador de custo/margem por OS no cartão.
-- Enquanto o motor de medição está vazio (projetos_obra_medicao=0, bloqueio de núcleo já escalado), o Eng. Chefe
-- autorizou começar o indicador SÓ com o realizado de mão de obra x o orçado do serviço da OS (obra_item.valor_contratado):
--   Orçado (serviço)   = projetos_obra_item.valor_contratado do item da OS
--   Realizado          = soma das horas apontadas (projetos_obra_mao_obra_apontamento.valor) — já no cartão
--   Margem parcial     = Orçado − Realizado (SÓ mão de obra; materiais/subempreiteiros entram quando o motor ligar)
-- Sem valor contratado no serviço → "sem orçado" (nunca R$ 0 falso). RD-95: "?" nos dois indicadores novos.
-- Aditiva e idempotente (ON CONFLICT DO NOTHING); só catálogo de ajuda, não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.os_obra.orcado', 'OS de obra', 'Orçado (serviço)',
  'Nada a preencher: é o valor contratado do serviço ligado a esta OS, vindo do contrato da obra.',
  'Mostra quanto o cliente paga pelo serviço desta OS, para comparar com o que já está sendo gasto.',
  'OS de "Forro de gesso": serviço contratado por R$ 14.694,90.',
  'Confundir com o custo: o orçado aqui é o preço de venda do serviço, não o custo dele. OS sem serviço ligado mostra "sem orçado".',
  34, '/dashboard/projetos/obras/os'),
 ('projetos.os_obra.margem_parcial', 'OS de obra', 'Margem parcial',
  'Nada a preencher: é o orçado do serviço menos o que já foi gasto de mão de obra nesta OS.',
  'Dá um primeiro sinal de margem ainda durante a obra — verde a partir de 25%, amarelo abaixo, vermelho se já passou do orçado.',
  'Orçado R$ 14.694,90 − mão de obra R$ 1.212,00 = R$ 13.482,90 (92%).',
  'Achar que é a margem final: ela conta SÓ a mão de obra apontada. Materiais e subempreiteiros entram quando a medição estiver ligada, então a margem real tende a cair.',
  35, '/dashboard/projetos/obras/os')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
