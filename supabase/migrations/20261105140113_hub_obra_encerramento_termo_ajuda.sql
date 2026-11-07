-- RD-95 (CEO 08/10): "?" nos campos NOVOS da aba "Termo de entrega" do Encerramento da obra
-- (Hub · Gestão de Obras · H8) · /dashboard/projetos/obras/[id]/encerramento.
-- A UI do termo (PR da aba Termo) consome fn_obra_termo_entrega_obter/_registrar (#3920, já na main).
-- Esta migration só cadastra a ajuda dos campos/ação novos — aditiva, só texto em erp_ajuda_campo.
-- Idempotente (ON CONFLICT chave DO NOTHING). RD-100: sem nome de terceiros.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/obras/[id]/encerramento', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.encerramento.termo', 'Termo de entrega', 'Termo de entrega',
  'Registro do encerramento da obra: a data em que foi entregue, observações e a assinatura de quem entrega. Comece como rascunho e, quando estiver certo, assine.',
  'Formaliza a entrega da obra ao cliente e deixa um registro imutável do momento em que ela foi concluída.',
  'Obra entregue em 20/12 com a ressalva de pintura externa pendente, assinada pela responsável técnica.',
  'Assinar antes de conferir a data e as observações: depois de assinado, o termo não pode mais ser editado.',
  60),
 ('projetos.encerramento.termo_data', 'Termo de entrega', 'Data de entrega',
  'O dia em que a obra foi (ou será) entregue ao cliente. Campo obrigatório.',
  'Marca a data oficial da entrega — base para prazos de garantia e para o relatório ao cliente.',
  '20/12/2026.',
  'Usar a data de hoje por hábito quando a entrega foi (ou será) em outro dia.',
  61),
 ('projetos.encerramento.termo_obs', 'Termo de entrega', 'Observações',
  'Texto livre com o que for relevante da entrega: pendências resolvidas, ressalvas, itens combinados com o cliente. Opcional.',
  'Deixa por escrito, junto do termo, as condições em que a obra foi entregue — evita discussão depois.',
  '"Entregue com a pintura externa pendente, a ser concluída até 15/01 conforme acordado."',
  'Escrever combinados importantes só por mensagem: aqui eles ficam anexados ao termo da obra.',
  62),
 ('projetos.encerramento.termo_assinatura', 'Termo de entrega', 'Assinatura (nome de quem assina)',
  'O nome (e, se quiser, o papel) de quem está assinando a entrega pela empresa. Exigido para assinar.',
  'Identifica o responsável pela entrega no termo — quem respondeu pela obra na assinatura.',
  'Eng. Ana Prado — responsável técnica.',
  'Deixar em branco e tentar assinar: a assinatura é obrigatória para fechar o termo.',
  63),
 ('projetos.encerramento.termo_assinar', 'Termo de entrega', 'Assinar e encerrar o termo',
  'Confirma a entrega: grava o termo como assinado por você, com data e hora. Pede uma confirmação antes.',
  'Fecha o termo de entrega. Depois de assinado ele fica imutável, como registro definitivo do encerramento.',
  'Depois de revisar a data e a assinatura, clicar em "Assinar e encerrar o termo" e confirmar.',
  'Assinar com a data errada: como o termo vira imutável, não dá para corrigir depois — confira antes.',
  64)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
