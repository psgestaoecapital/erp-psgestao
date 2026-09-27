# SPEC · Revenda: modelo de ganho do carro consignado (repasse fixo ou comissão %)

> **Origem:** decisão do CEO de 26/09 (contexto 31dac1f3, chamado #115). Todo carro consignado tem **dois modelos** de ganho, escolhidos **por veículo**; nenhum é o padrão.
> **Status:** SPEC para o CEO aprovar. **Nada é construído antes da aprovação.**
> **Regra-mãe (RD-51):** carro consignado **nunca** tem "lucro = venda − custo". Enquanto o modelo não for informado, a tela mostra **"ganho a definir"**, nunca zero nem venda − custo.

---

## 1. O que existe hoje (provado no código, 27/09)

- **Marcação.** O consignado é marcado só por `veic_veiculo.origem = 'consignacao'`, escolhido na criação do carro. Depois disso não dá para editar.
- **Campos inexistentes.** Não há campo de repasse, comissão % ou dono (consignante). `fornecedor_id` e `fornecedor_nome` existem, mas nenhuma tela os preenche.
- **O que o #115 já corrigiu.** Quatro funções deixaram de mostrar lucro de consignado: preço mínimo, salvar precificação, conta do carro e pátio (lucro do mês e ranking de ROI).
- **Onde o consignado ainda sai como "lucro ≈ preço de venda"** (custo de aquisição 0):
  - cenários de precificação, simulador e lote;
  - simulador de negociação (e a margem % que define a alçada);
  - diálogo da venda (margem aparente e real);
  - composição da venda;
  - acerto pós-venda (lucro realizado);
  - relatório de vendas (lucro, ROI e comissão do vendedor sobre o lucro);
  - margem média do pátio.
- **Obrigação com o dono.** Não existe. A venda gera só contas a receber; contas a pagar nascem só de custos.
- **Demo Revenda.** Tem 1 consignado (Duster, sem venda). Nada exercita a venda de um consignado.

## 2. Modelo proposto (aditivo)

```
veic_veiculo
  + consignado_modelo   text  NULL  CHECK IN ('repasse_fixo','comissao_pct')   -- NULL = ganho a definir
  + consignado_repasse  numeric NULL   -- modelo A: quanto o DONO recebe (R$)
  + consignado_comissao_pct numeric NULL  -- modelo B: % da venda que fica com a LOJA
  + consignado_dono_id  uuid NULL → erp_clientes   -- o consignante (quem recebe o repasse)
  + consignado_definido_por uuid, consignado_definido_em timestamptz   -- auditoria (auth.uid())
```

**Uma função única calcula o ganho de todas as telas:** `fn_veic_consignado_ganho(veiculo, preco)`.
- **A (repasse fixo):** ganho da loja = preço − repasse − custos que a loja pagou.
- **B (comissão %):** ganho da loja = preço × % − custos que a loja pagou.
- **Sem modelo:** devolve `ganho_a_definir = true` e ganho NULL, nunca zero.

O custo de aquisição continua **nulo**, porque a loja não comprou o carro. Todas as telas da seção 3 passam a ler dessa função em vez de "venda − custo". Carro próprio não muda nada.

## 3. Telas e campos

| # | Tela | O que muda |
|---|---|---|
| 1 | **Ficha → bloco "Consignação"** (no lugar do card "Aquisição: consignado") | Escolha **Repasse fixo (R$)** ou **Comissão (%)**, campo do valor e **Dono do carro** (busca de cliente). Mostra o ganho da loja no preço anunciado ou **"ganho a definir"**. |
| 2 | **Novo veículo** (origem = Consignação) | Os mesmos 3 campos, **opcionais**. Dá para cadastrar sem eles, e o carro fica "ganho a definir". |
| 3 | **Precificação do veículo** (hoje sai cedo para consignado) | Mostra o preço e o ganho da loja por cenário (0/30/60/120 dias), já com o modelo. Sem modelo, mostra só o aviso "defina o modelo de ganho". |
| 4 | **Diálogo da venda** | Mostra o ganho da loja pelo modelo e o **repasse ao dono** (A: fixo; B: preço − comissão). **A venda não conclui sem modelo** (bloqueio no servidor com mensagem clara). |
| 5 | **Simulador de negociação** | O lucro e a margem % da alçada passam a usar o ganho da loja; a base da margem % é o **preço**, não o custo. |
| 6 | **Acerto pós-venda** | Nova linha **"Repasse ao dono: R$ X — a pagar"**. O lucro realizado é o ganho da loja menos os custos pós-venda. |
| 7 | **Relatório de vendas** | Colunas de ganho e ROI pelo modelo. A comissão do vendedor sobre "lucro" usa o ganho da loja. |
| 8 | **Pátio: margem média** | O consignado entra pelo ganho; sem modelo fica **fora** da média, com contador "N sem modelo". |

## 4. Obrigação com o dono (repasse a pagar)

- **Quando nasce.** Ao **registrar a venda** de um consignado com modelo, o sistema cria **um título a pagar** para o dono:
  - modelo A: o valor do repasse;
  - modelo B: preço de venda − comissão.
- **Rastreio.** O título usa `erp_pagar` com `ref_externa_sistema = 'revenda_consignado'` e `ref_externa_id = veic_venda.id`, uma chave própria que não colide com os títulos de custo.
- **Vencimento.** Padrão configurável em `veic_config` (proposta: 5 dias após o recebimento).
- **Cancelamento.** Cancelar a venda cancela o título, se ainda não foi pago. Se já foi pago, o cancelamento é bloqueado com aviso.
- **Tributação sobre a diferença.** No modelo B, a base fiscal é a comissão, não o preço cheio. Isso segue o perfil fiscal (`veic_perfil_fiscal.consignacao_*`) e fica marcado para o contador validar. **Sem mudança fiscal nesta entrega.**

## 5. Fora desta SPEC (decisões do CEO que continuam valendo)

- **Dados antigos da Alliance:** não mexer. Os 3 consignados reais existentes ficam "ganho a definir" até alguém escolher o modelo na ficha. Nenhum UPDATE em lote.
- **Duas suspeitas achadas no mapeamento** (fora do consignado; viram diagnóstico próprio, sem mexer agora):
  - o acerto pode descontar duas vezes os custos pós-venda;
  - o retorno do banco pode entrar duas vezes (recebível e acerto).

## 6. Entrega proposta (depois de aprovada)

1. **PR 1, banco:** campos, `fn_veic_consignado_ganho`, trava da venda sem modelo, título do repasse e seed da demo. A demo ganha um consignado A e um B, com uma venda de cada.
2. **PR 2, telas 1 a 4:** ficha, novo veículo, precificação e diálogo da venda.
3. **PR 3, telas 5 a 8:** simulador de negociação, acerto, relatório e pátio.

Cada PR vai com o teste da regra e o teste do caminho principal da tela (RD-83), na demo Revenda.

## 7. Perguntas para o CEO aprovar

1. **Vencimento padrão do repasse** ao dono: 5 dias após o recebimento?
2. **Venda sem modelo:** bloquear (proposta) ou permitir com alerta?
3. **Comissão do vendedor** no consignado: calcula sobre o **ganho da loja** (proposta) ou sobre o **preço de venda**?
