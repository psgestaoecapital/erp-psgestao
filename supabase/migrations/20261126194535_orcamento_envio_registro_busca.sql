-- Orçamento (CEO 24/11): busca unificada de item + finalização (salvar/imprimir/enviar).
-- Aditiva (RD-97). Sem função nova — a tela já grava erp_orcamentos por update (policy de dono).
-- Registro de envio: enviado_em + enviado_canal (reaproveita o rastro; nunca envia sozinho).
-- RD-52: arquivo + PR; nunca apply_migration.

ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_canal text;

-- Ajuda RD-95 dos campos/botões novos (idempotente)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('orcamentos.item.busca_unificada', '/dashboard/orcamentos', 'Itens', 'Buscar item',
   'Digite o que procura: busca ao mesmo tempo no Catálogo (serviços com composição/CPU), nos Serviços fiscais e nos Produtos do estoque.',
   'Você não precisa saber antes de que tipo é o item — escolha no resultado e a linha assume o tipo e o preço certos.',
   'Digitar "prepar" acha o serviço "Preparação do substrato" do catálogo com o preço custo+BDI.',
   'Procurar só em Produto e achar que o serviço não existe — a busca unificada cobre as 3 fontes.', 'projetos', 70),
  ('orcamentos.item.fonte_catalogo', '/dashboard/orcamentos', 'Itens', 'Serviço do catálogo',
   'Serviços que você cadastrou no Catálogo, com composição de custo (CPU) e BDI.',
   'O preço sai do custo da composição × (1 + BDI). É o serviço "de engenharia" do Hub.',
   'Assentamento de piso (com BOM e BDI).',
   'Confundir com Serviço fiscal (esse é para a nota/ISS).', 'projetos', 71),
  ('orcamentos.item.fonte_servico', '/dashboard/orcamentos', 'Itens', 'Serviço fiscal',
   'Serviço do cadastro fiscal (LC116/ISS) para emissão de nota.',
   'Traz o código do serviço e a alíquota de ISS para a NFS-e.',
   'Serviço de pintura (LC116 7.02).',
   'Usar serviço fiscal quando queria o serviço do catálogo (com CPU/BDI).', 'projetos', 72),
  ('orcamentos.item.fonte_produto', '/dashboard/orcamentos', 'Itens', 'Produto',
   'Itens do estoque (produtos cadastrados), com preço de venda.',
   'Entra na proposta como mercadoria/material, com o preço de venda do cadastro.',
   'Saco de argamassa; placa de gesso.',
   'Digitar o nome de um serviço no campo de produto — use a busca unificada.', 'projetos', 73),
  ('orcamentos.finalizar', '/dashboard/orcamentos', 'Finalização', 'Finalizar e enviar',
   'Depois de salvar, escolha como entregar a proposta: imprimir, baixar PDF, e-mail, WhatsApp ou copiar o link.',
   'Salvar funciona sozinho; o envio é sempre opcional e por sua ação — nada é enviado automaticamente.',
   'WhatsApp abre com o telefone do cliente e o link da proposta já no texto.',
   'Achar que salvou = enviou. Só envia quando você clica a ação.', 'projetos', 74)
ON CONFLICT (chave) DO NOTHING;
