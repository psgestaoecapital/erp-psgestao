# LAYOUT CNAB 240 PAGAMENTO SICOOB — decodificado dos 2 arquivos reais
Fonte da verdade para o Code Web. Extraído posição a posição de:
- `cnab_pgto_756_56979.rem` (EMPRESA EXEMPLO, 6 linhas — boleto)
- `cnab_pgto_756_63082.rem` (23 linhas — boleto + tributo + PIX, múltiplos lotes)

🔴 Os 2 arquivos `.rem` reais estão em /mnt/user-data/outputs/ (o CEO baixa e commita em docs/cnab/ do repo,
OU o Code Web usa este layout + os arquivos anexos). Este doc é a decodificação; os `.rem` são a prova
byte a byte. Versão de layout Sicoob: **087** (arquivo) / **040** (lote).

---

## ESTRUTURA GERAL
Arquivo = Header Arquivo (tipo 0) + [ N lotes ] + Trailer Arquivo (tipo 9).
Cada lote = Header Lote (tipo 1) + [ N detalhes tipo 3 ] + Trailer Lote (tipo 5).
Um arquivo pode ter VÁRIOS LOTES, um por forma de pagamento.
Cada linha = 240 caracteres + CRLF. Encoding **latin-1**. Numérico = zero à esquerda. Texto = espaço à direita.

---

## HEADER DE ARQUIVO (tipo 0) — 1 por arquivo
```
[001-003] Banco                = '756'
[004-007] Lote                 = '0000'
[008-008] Tipo registro        = '0'
[009-017] CNAB (brancos)       = espaços
[018-018] Tipo inscr empresa   = '2' (2=CNPJ, 1=CPF)
[019-032] CNPJ empresa         = 14 díg (ex '11222333000181')
[033-052] Convênio/código      = 20 pos, zero-pad (ex '00000000000000009999')
[053-057] Agência              = '03039' (a COOPERATIVA do Sicoob vai aqui)
[058-058] DV agência           = '2'
[059-070] Conta                = 12 pos zero-pad (ex '000000999999')
[071-071] DV conta             = '4'
[072-072] DV ag/conta          = espaço
[073-102] Nome empresa         = 30 pos, texto
[103-132] Nome banco           = 'SiCoob' + espaços
[133-142] CNAB                 = espaços
[143-143] Código remessa       = '1' (1=remessa)
[144-151] Data geração         = DDMMAAAA (ex '09122025')
[152-157] Hora geração         = HHMMSS
[158-163] Nº sequencial arquivo= 6 díg (ex '000019') ← controle de numeração
[164-166] Versão layout arquivo= '087'
[167-171] Densidade            = '01600'
[resto até 240]                = espaços/zeros conforme FEBRABAN
```

## HEADER DE LOTE (tipo 1) — 1 por forma de pagamento
```
[001-003] Banco                = '756'
[004-007] Lote                 = '0001','0002'... (sequencial no arquivo)
[008-008] Tipo registro        = '1'
[009-009] Tipo operação        = 'C' (crédito/pagamento)
[010-011] Tipo serviço         = ver TABELA abaixo
[012-013] Forma pagamento      = ver TABELA abaixo
[014-016] Versão layout lote   = '040'
[017-017] CNAB                 = espaço
[018-018] Tipo inscr           = '2'
[019-032] CNPJ empresa         = 14 díg
[033-052] Convênio             = 20 pos
[053-057] Agência (cooperativa)= '03039'
[059-070] Conta                = 12 pos
[074-103] Nome empresa         = 30 pos
[104-133] Mensagem/finalidade  = 30 pos (pode ser branco)
```

### TABELA DE FORMAS (medida dos arquivos reais)
| tipo_serviço [10-11] | forma_pgto [12-13] | Segmento detalhe | Uso |
|---|---|---|---|
| 03 | 30 | J | Boleto/liquidação (mesmo/outros bancos) |
| 03 | 31 | J | **Pagamento de boleto** (título outro banco) |
| 22 | 11 | O | **Tributo/concessionária** com código de barras |
| 20 | 47 | J | **PIX** (QR-code/chave) |
| 20 | 01/41 | A | **Transferência/TED** (crédito conta / outro banco) — ⚠️ NÃO há exemplo real, inferir FEBRABAN |

## SEGMENTO J (tipo 3) — pagamento de BOLETO (forma 30/31) e PIX(47)
```
[001-003] Banco                = '756'
[004-007] Lote                 = mesmo do header lote
[008-008] Tipo registro        = '3'
[009-013] Nº sequencial regist = '00001','00002'... (dentro do lote)
[014-014] Segmento             = 'J'
[015-017] Cód movimento        = '000' (inclusão)
[018-061] Código de barras     = 44 pos (o código de barras do boleto)
[062-091] Nome cedente/benefic = 30 pos
[092-099] Data vencimento      = DDMMAAAA
[100-114] Valor do título      = 15 pos (centavos, zero-pad) ex '000000000029808' = R$298,08
[115-129] Desconto/abatimento  = 15 pos
[130-144] Acréscimos/mora      = 15 pos
[145-152] Data pagamento       = DDMMAAAA
[153-167] Valor pagamento      = 15 pos (centavos)
[168-182] Quantidade moeda     = 15 pos (zeros)
[183-202] Nº doc/seu número    = 20 pos
[resto até 240]                = brancos/zeros
```

## SEGMENTO O (tipo 3) — TRIBUTO/concessionária com código de barras (forma 11)
```
[001-003] Banco                = '756'
[008-008] Tipo                 = '3'
[014-014] Segmento             = 'O'
[015-017] Movimento            = '000'
[018-061] Código de barras     = 44 pos (código de barras do tributo)
[062-091] Nome concessionária  = 30 pos (ex 'MINISTERIO DA FAZENDA')
[092-099] Data vencimento      = DDMMAAAA
[100-107] Data pagamento       = DDMMAAAA
[108-122] Valor pagamento      = 15 pos
[resto]                        = conforme FEBRABAN
```

## SEGMENTO A (tipo 3) — TRANSFERÊNCIA/TED — ⚠️ SEM EXEMPLO REAL
Não veio nos arquivos. Layout FEBRABAN padrão (VALIDAR EM HOMOLOGAÇÃO antes de produção):
```
[014-014] Segmento             = 'A'
[015-017] Movimento            = '000'
[018-020] Câmara               = 3 pos
[021-023] Banco favorecido     = 3 pos (de erp_fornecedores.banco)
[024-028] Agência favorecido   = 5 pos (erp_fornecedores.agencia)
[029-041] Conta favorecido     = erp_fornecedores.conta
[044-073] Nome favorecido      = 30 pos
[093-100] Data pagamento       = DDMMAAAA
[120-134] Valor pagamento      = 15 pos
```
🔴 Este segmento NÃO tem prova real do Sicoob → forma 'transferência' fica travada p/ homologação.

## TRAILER DE LOTE (tipo 5)
```
[001-003] Banco = '756' · [004-007] Lote · [008-008] Tipo='5'
[018-023] Qtd registros do lote (inclui header+detalhes+trailer)
[024-041] Somatória valores do lote (18 pos, centavos)
```

## TRAILER DE ARQUIVO (tipo 9)
```
[001-003] Banco='756' · [004-007]='9999' · [008-008]='9'
[018-023] Qtd de lotes
[024-029] Qtd de registros do arquivo (todas as linhas)
```

---

## PROVA OBRIGATÓRIA (RD-38)
O gerador do Code Web deve produzir um arquivo que, para os mesmos dados de entrada, seja **byte a byte
idêntico** aos 2 `.rem` reais (nas partes de boleto/tributo/PIX). Teste automatizado: gerar → comparar
com o `.rem` real → diff zero. Sem isso, não vai a produção. TED (segmento A) só em homologação até prova real.

## DADOS DA EMPRESA (perfil Sicoob PS Gestão — do banco)
banco 756 · cooperativa/agência 03039 · conta 000000-0 · convênio 0000000 · certificado no vault.
(No arquivo real da EMPRESA EXEMPLO os valores são dela; para PS Gestão usar os da erp_banco_provider_config.)
