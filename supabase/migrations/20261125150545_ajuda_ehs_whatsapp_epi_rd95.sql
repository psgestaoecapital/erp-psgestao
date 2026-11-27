-- RD-95 › /dashboard/ehs/whatsapp-epi (Bot WhatsApp · assinatura de EPI) · auditor 22/11, nota 90:
-- "nenhum campo/ação tem '?'". A tela ganhou <AjudaCampo> nos campos (Funcionário, EPIs a entregar,
-- Observação) e na ação (Gerar link WhatsApp); aqui cadastramos as chaves no banco (erp_ajuda_campo),
-- como exige o componente padrão. Aditivo e idempotente (ON CONFLICT na chave). Não toca estrutura,
-- RLS nem dado de cliente. RD-52: arquivo + PR, acima da main, faixa desenvolvedor_4_g (segundos :45).
-- Prova RD-38: 4 chaves inseridas (SELECT count conferido na revisão); rota '/dashboard/ehs/whatsapp-epi'.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
 ('ehs.whatsapp_epi.funcionario', '/dashboard/ehs/whatsapp-epi', 'EHS · Bot WhatsApp EPI', 'ehs',
  'Funcionário',
  'Escolha o colaborador que vai receber os EPIs e assinar a entrega pelo celular. A lista traz os funcionários da empresa selecionada (no grupo, aparece a empresa ao lado).',
  'Define para quem o link de assinatura será gerado e em nome de quem a entrega fica registrada.',
  'Selecionar "João da Silva · Produção" para enviar a ele a assinatura dos EPIs.',
  'Escolher um funcionário sem WhatsApp cadastrado — aparece o aviso e é preciso cadastrar o telefone antes.',
  1),
 ('ehs.whatsapp_epi.epis', '/dashboard/ehs/whatsapp-epi', 'EHS · Bot WhatsApp EPI', 'ehs',
  'EPIs a entregar',
  'Marque no catálogo os EPIs desta entrega e, em cada um marcado, ajuste a quantidade. Só aparecem os EPIs cadastrados no catálogo da empresa (ou globais).',
  'Monta a lista de itens que o funcionário vai conferir e assinar; cada item entra com a quantidade informada.',
  'Marcar "Luva de raspa" (qtd 1) e "Óculos de proteção" (qtd 2).',
  'Esquecer de ajustar a quantidade — o padrão é 1 por EPI marcado.',
  2),
 ('ehs.whatsapp_epi.observacao', '/dashboard/ehs/whatsapp-epi', 'EHS · Bot WhatsApp EPI', 'ehs',
  'Observação',
  'Texto livre e opcional sobre esta entrega (motivo, lote, condição).',
  'Fica registrado junto da entrega para contexto e auditoria.',
  'Ex.: "troca preventiva semestral".',
  'Usar a observação para dados obrigatórios do EPI — esses vão no catálogo, não aqui.',
  3),
 ('ehs.whatsapp_epi.gerar_link', '/dashboard/ehs/whatsapp-epi', 'EHS · Bot WhatsApp EPI', 'ehs',
  'Gerar link WhatsApp',
  'Clique para gerar o link wa.me com a página de assinatura e enviá-lo ao funcionário pelo WhatsApp.',
  'Cria o token de assinatura e abre o WhatsApp do funcionário com o link /sign/epi para ele assinar pelo celular (Lei 14.063/2020).',
  'Depois de escolher o funcionário e marcar ao menos um EPI, o botão libera e gera o link.',
  'Clicar sem funcionário ou sem EPI marcado — o botão fica desabilitado até os dois estarem preenchidos.',
  4)
ON CONFLICT (chave) DO NOTHING;
