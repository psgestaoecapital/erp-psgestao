-- RD-95 ("?" em todo campo/indicador/ação) · Veículos da Oficina — gap do auditor: tela rica (busca, passagens,
-- último KM, chassi, evolução do KM, histórico de serviços, contatos, enviar histórico ao cliente) com NENHUM
-- AjudaCampo (grep=0 em src/app/dashboard/oficina/veiculos/page.tsx). Semeia as chaves oficina.veiculos.* da rota
-- /dashboard/oficina/veiculos. RD-98 p3: preenche a ORIGEM do dado em system_screens (rpcs_chamadas) — a tela só lê
-- por RPC (fn_oficina_veiculos_listar / _veiculo_historico / _veiculo_contatos / fn_veiculo_link_publico_gerar).
-- Catálogo de ajuda e origem são metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE:
-- ON CONFLICT (chave) DO NOTHING no catálogo; UPDATE só onde a origem está NULL. Não toca cálculo nem dado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('oficina.veiculos.busca','Veículos da Oficina','Buscar veículo',
 'Digite a placa ou o nome do cliente e toque na lupa (ou aperte Enter). A lista filtra pelos veículos que já passaram pela oficina.',
 'Acha rápido o histórico de um carro específico sem rolar a lista inteira — base para ver passagens, KM e serviços anteriores.',
 'Digitar "ABC1D23" ou "Maria" e tocar na lupa.',
 'Esperar o carro aparecer sozinho: os veículos entram na lista conforme você abre OS com a placa preenchida — sem placa, não aparecem aqui.',
 1,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.passagens','Veículos da Oficina','Passagens',
 'Indicador (não se preenche). Mostra quantas vezes o veículo já passou pela oficina (quantas OS tem no histórico).',
 'Dá a noção de recorrência do cliente: carro com muitas passagens é cliente fiel; poucas, oportunidade de pós-venda.',
 '"3 passagens" = o carro já teve 3 ordens de serviço.',
 'Confundir passagens com visitas agendadas: aqui conta OS registrada, não agenda futura.',
 2,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.ultimo_km','Veículos da Oficina','Último KM',
 'Indicador (não se preenche). É a quilometragem mais recente registrada para o veículo numa OS.',
 'Ajuda a estimar a próxima revisão e a prever desgaste de peças pelo uso do carro.',
 '"84.230 km" lido na última passagem.',
 'Tratar como KM de hoje: é o KM da última OS; o carro pode ter rodado mais desde então.',
 3,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.chassi','Veículos da Oficina','Chassi',
 'Indicador (não se preenche aqui). Número do chassi do veículo, quando foi informado no cadastro/recepção.',
 'Identifica o veículo de forma única quando a placa não basta (garantia, emissão de documento).',
 '9BD15822AB1234567.',
 'Esperar que apareça sempre: só mostra quando o chassi foi preenchido na recepção do veículo.',
 4,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.km_evolucao','Veículos da Oficina','Evolução do KM',
 'Indicador (não se preenche). Mostra como a quilometragem cresceu passagem a passagem.',
 'Revela a intensidade de uso do veículo — quanto mais rápido o KM sobe, mais frequente deve ser a manutenção.',
 'Barras subindo de 60.000 → 72.000 → 84.000 km entre as passagens.',
 'Ler uma barra isolada como total: a leitura é a tendência entre as datas, não um valor único.',
 5,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.historico','Veículos da Oficina','Histórico de serviços',
 'Indicador (não se preenche). Lista cada OS do veículo com data, status, queixa, laudo, peças, KM, mecânico e valor.',
 'É a memória do carro na oficina: evita refazer diagnóstico e mostra o que já foi trocado.',
 '"12/03/2026 · Entregue · troca de pastilhas · R$ 480,00".',
 'Achar que a lista está incompleta: só aparecem OS com a placa deste veículo; OS sem placa não entram.',
 6,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.contatos','Veículos da Oficina','Contatos',
 'Indicador (não se preenche aqui). Registra os contatos feitos com o cliente sobre este veículo (pós-venda, retorno).',
 'Evita ligar duas vezes na mesma semana e mostra se o cliente já respondeu ou agendou retorno.',
 '"WhatsApp · respondeu · retorno agendado 20/03".',
 'Ligar sem conferir: veja aqui o último contato antes de acionar o cliente de novo.',
 7,'/dashboard/oficina/veiculos','oficina','publicado'),
('oficina.veiculos.compartilhar','Veículos da Oficina','Enviar histórico ao cliente',
 'Ação (toque no botão). Gera um link público do histórico do veículo SEM valores e abre o WhatsApp para enviar ao cliente.',
 'Dá transparência ao cliente sobre o que já foi feito no carro, fortalecendo a confiança — sem expor preços internos.',
 'Tocar em "Enviar histórico ao cliente" e compartilhar o link no WhatsApp.',
 'Achar que o cliente verá valores: o link público mostra serviços e datas, nunca os preços.',
 8,'/dashboard/oficina/veiculos','oficina','publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3 (origem do dado): a tela lê só por RPC; preenche rpcs_chamadas onde ainda está NULL (aditivo, idempotente).
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_oficina_veiculos_listar','fn_oficina_veiculo_historico','fn_oficina_veiculo_contatos',
      'fn_veiculo_link_publico_gerar','fn_ajuda_campo_listar','fn_ajuda_campo_uso'
    ],
    views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[])
WHERE rota = '/dashboard/oficina/veiculos'
  AND rpcs_chamadas IS NULL;
