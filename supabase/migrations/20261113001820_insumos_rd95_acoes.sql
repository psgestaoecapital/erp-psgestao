-- Hub · Insumos (/dashboard/projetos/insumos) — RD-95 (#3363): "?" (AjudaCampo) nas ações da linha que ainda não
-- tinham ajuda: Atualizar preço, Editar e Excluir. As demais (Ligar/Trocar estoque, Restaurar) já têm. Aditiva:
-- só insere 3 linhas de ajuda, ON CONFLICT (chave) DO NOTHING — não altera texto já publicado nem toca dado de
-- cliente. Texto em linguagem do usuário, 4 blocos fixos. Faixa do agente jordana-code (segundos :20).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.insumos.atualizar_preco', 'Insumos', 'Atualizar preço',
 'Abre a janela para registrar um novo preço de compra do insumo, com a data da compra.',
 'Mantém o custo do insumo em dia e alimenta a coluna Variação (compara o preço atual com o anterior).',
 'Comprou o saco de cimento mais caro? Registre o novo preço com a data: a Variação mostra a diferença.',
 'Usar para corrigir um erro de digitação do preço antigo: isto registra uma NOVA compra; para corrigir, use Editar.',
 48, '/dashboard/projetos/insumos', 'hub_projetos', 'publicado'),
('projetos.insumos.editar', 'Insumos', 'Editar',
 'Abre o cadastro do insumo para alterar nome, código, categoria, unidade, custo, fornecedor e demais dados.',
 'Corrige ou completa o cadastro do insumo sem criar um novo — tudo que o insumo é fica aqui.',
 'Ajustar a unidade de "UN" para "m²" ou completar o NCM que faltava.',
 'Tentar trocar o vínculo com o estoque por aqui: o vínculo é feito pelo botão de estoque (ícone de corrente).',
 49, '/dashboard/projetos/insumos', 'hub_projetos', 'publicado'),
('projetos.insumos.excluir', 'Insumos', 'Excluir',
 'Remove o insumo da lista. Fica desabilitado quando o insumo está em uso em algum serviço (a coluna "Em uso" mostra quantos).',
 'Tira da lista o que não se usa mais, sem apagar o histórico — insumo em uso é protegido para não quebrar os serviços.',
 'Excluir um insumo cadastrado por engano e que nenhum serviço usa.',
 'Esperar excluir um insumo "Em uso": o botão fica travado; tire-o dos serviços antes, ou apenas inative o insumo.',
 50, '/dashboard/projetos/insumos', 'hub_projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
