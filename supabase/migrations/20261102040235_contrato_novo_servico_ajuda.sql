-- #3857 (Pdois) · Novo Contrato Recorrente: a empresa com catálogo próprio de serviços (agency_servico) escolhe o
-- SERVIÇO dela no lugar da lista genérica de tipos. A tela muda; aqui entra só o "?" (RD-95) dos dois campos.
-- ADITIVA: só linhas novas em erp_ajuda_campo. Nenhuma função, view, policy ou dado de cliente é alterado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Contratos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/contratos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.novo.servico', 'Serviço do contrato',
  'Escolha qual serviço da sua empresa este contrato cobra. A lista mostra só os serviços do seu catálogo (os mesmos usados nas propostas).',
  'Identifica o contrato e já sugere o nome dele. Para o serviço aparecer aqui, ele precisa estar ativo no catálogo de serviços da empresa.',
  'Gestão de redes sociais', 'Procurar um serviço que está inativo no catálogo: ative-o antes para ele aparecer na lista.', 1),
 ('ge.contrato.novo.tipo', 'Tipo do contrato',
  'Escolha o tipo de serviço que este contrato cobra. Se a empresa tiver um catálogo próprio de serviços, a tela mostra os serviços dela no lugar desta lista.',
  'Agrupa os contratos no resumo "MRR por tipo de serviço" do painel de contratos.',
  'BPO Financeiro', 'Deixar o tipo que já vem marcado sem conferir: o contrato fica no grupo errado do resumo.', 2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
