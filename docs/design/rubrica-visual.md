# Rubrica de nota visual PS (0–100) e ícones premium

Dono: `gilberto-produto` (design system). Usada pelo auditor de IA do PDCA de qualidade (motor: `gilberto-chamados`).
Regra-mãe: RD-96 — nunca copiar concorrente; tela ultra premium, legível, visivelmente melhor e mais fácil.

## Como medir
Cada tela é avaliada em **3 larguras: 1366, 1920 e 390 px**. A nota de cada dimensão é a **pior** das três larguras
(tela boa no desktop e quebrada no celular não passa). Nota final = soma ponderada. Abaixo de 70 = reprovada no PDCA;
85+ = padrão PS. Cada ponto tirado precisa citar o elemento e a largura.

| # | Dimensão | Peso |
|---|----------|------|
| 1 | Dimensionamento e uso do espaço | 25 |
| 2 | Ícones | 15 |
| 3 | Tipografia | 15 |
| 4 | Espaçamento e ritmo | 10 |
| 5 | Contraste e cor | 10 |
| 6 | Estados vazios, carregando e erro | 10 |
| 7 | Consistência com o design system PS | 15 |

## 1. Dimensionamento e uso do espaço (25)
Perguntas, em cada largura:
- Há **vazio desperdiçado**? (coluna ocupando 30% da largura com 70% em branco; cartão de 3 números num painel de 1900 px)
- Há **conteúdo espremido**? (texto cortado, tabela com coluna ilegível, botões colados)
- Há **rolagem lateral** na página (proibida; só tabela larga pode rolar dentro do próprio contêiner, com indicação)?
- A **grade é proporcional** (colunas múltiplas de uma base; 12 colunas em 1366/1920, 1 coluna em 390) e os alvos de toque no celular têm ≥ 44 px?
- Há **hierarquia de tamanhos**: um título de tela, subtítulos claramente menores, corpo menor ainda; o indicador principal é o maior elemento da tela?

Descontos: rolagem lateral da página −10; texto cortado/sobreposto −8 cada (máx. −16); vazio > 40% da área útil −8; sem hierarquia (3 ou mais elementos competindo no mesmo tamanho) −6; alvo de toque < 44 px −4.
- **Nota alta (22–25):** painel em 1920 usa 3–4 colunas de cartões do mesmo alto, gráfico ocupa 2 colunas, indicador principal em 32 px e rótulos em 12 px; em 390 vira 1 coluna sem corte.
- **Nota baixa (0–8):** em 1920 um formulário de 400 px colado à esquerda e o resto em branco; em 390 a tabela estoura a largura da página.

## 2. Ícones (15)
- Um **único conjunto**: `lucide-react`, traço fino (`strokeWidth` 1.5), tamanho 16/20/24 px, cor herdada do texto ou do dourado PS.
- **Proibido emoji** como ícone ou enfeite de rótulo, botão, aba, menu, título, cartão ou estado vazio; proibido ícone com cara de clip-art, de celular ou "de IA" (carinha, foguete, faíscas, lâmpada).
- Ícone sempre ao lado de texto ou com `aria-label`; nunca dois estilos de ícone na mesma tela.
- Significado óbvio: o ícone representa a ação (lixeira = excluir), não decora.
- **Nota alta (14–15):** todos os ícones lucide 1.5, alinhados à linha de base do texto. **Nota baixa (0–5):** abas com 📊 📄 🤖; botão com ✅/❌; mistura de emoji e SVG.
Descontos: cada emoji como ícone −3 (máx. −12); mistura de dois conjuntos −5; ícone sem significado −2.

## 3. Tipografia (15)
- Família única do design system; **escala**: 12 (apoio) · 14 (corpo) · 16 (destaque) · 20/24 (título de seção) · 32 (indicador principal). Nada fora da escala.
- Corpo ≥ 14 px (12 só para legenda/apoio); linha de 1,4–1,6; no máximo 2 pesos por bloco (400 e 600).
- Números alinhados à direita e com fonte tabular; moeda sempre no mesmo formato.
- **Alta:** título 24/600, corpo 14/400, legendas 12 cinza. **Baixa:** 9–10 px em tabelas, 5 tamanhos competindo, negrito em tudo, CAIXA ALTA em parágrafos.

## 4. Espaçamento e ritmo (10)
Múltiplos de 4 (8/16/24/32). Mesmo respiro entre blocos da mesma família; cartões com padding ≥ 16; rótulo colado ao seu campo, blocos distintos separados por ≥ 24. **Baixa:** margens aleatórias (7, 13, 22 px), campos sem respiro, blocos sem separação.

## 5. Contraste e cor (10)
Texto sobre fundo ≥ 4,5:1 (3:1 para ≥ 18 px/negrito); cor nunca é a única pista (erro = cor + ícone + texto); dourado PS só em ação principal e destaque; no máximo 1 cor de destaque + semânticas (verde/âmbar/vermelho) por tela. **Baixa:** cinza claro sobre branco, texto sobre foto, 6 cores competindo.

## 6. Estados vazios, carregando e erro (10)
Todo estado existe e é desenhado: vazio (explica o que falta e oferece a ação para resolver, com ícone lucide — nunca "Nenhum dado"), carregando (esqueleto, não tela em branco), erro (diz o que houve e como seguir). **Alta:** "Nenhuma obra ainda — Criar a primeira obra". **Baixa:** tabela vazia só com cabeçalhos; spinner infinito; erro técnico cru.

## 7. Consistência com o design system PS (15)
Componentes padrão (botão, cartão, modal, `AjudaCampo` "?" em todo campo — RD-95), cantos, sombras e cores iguais às demais telas; mesmo lugar para título, ações primárias (canto superior direito) e filtros; textos em português simples, sem jargão; tarefa principal em até 3 toques. **Baixa:** botão de estilo próprio, modal fora do padrão, campo sem "?".

## Notas de concorrência (CEO 09/10) — duas notas 0–100 ao lado da nota visual
Entram no C do PDCA, por tela, junto com as 7 dimensões acima (que continuam somando 100). Não se somam à nota visual:
saem como **nota de originalidade** e **nota de diferenciais**, cada uma com a lista de pontos que a baixaram.
A base de comparação são as partes de **mapeamento** dos documentos vivos da vertical (`erp_documento_vertical`:
Sienge, Procore, Trevo etc.) e os **diferenciais PS** listados no blueprint da mesma vertical.

### A. Originalidade × concorrentes mapeados (0–100)
Compare a tela com cada sistema mapeado, em quatro eixos (25 pontos cada): **ordem do menu**, **nomes** (telas, campos,
botões), **leiaute** (disposição de blocos, tabelas, abas) e **fluxo** (sequência de passos da tarefa principal).
- Eixo 100% igual ao mapeado (mesma ordem, mesmos nomes, mesmo leiaute ou mesmo fluxo) = **0 no eixo e tela REPROVADA
  no PDCA** (RD-96), qualquer que seja a nota visual. O auditor cita o ponto exato e o que mudar.
- Semelhança parcial (2 de 4 elementos coincidem) = 10 a 15 no eixo; só o conceito comum do domínio (ex.: "medição") = 25.
- Termo técnico do setor ou exigência legal (NFS-e, SINAPI, NR-36) não conta como cópia; a **apresentação** dele conta.
- **Alta (85+):** nomes próprios em português simples, tarefa principal em ≤ 3 toques por um caminho diferente do concorrente.
  **Baixa (< 50):** mesmo nome de menu e mesma ordem de abas do concorrente.

### B. Diferenciais PS presentes e visíveis (0–100)
Para a tarefa da tela, liste os diferenciais PS do blueprint da vertical; cada um vale partes iguais dos 100.
Por diferencial: **100%** se presente **e visível** sem rolagem em 1366 px ou a 1 toque; **50%** se presente mas escondido
(menu secundário, aba sem destaque); **0** se ausente. Diferencial que existe no banco mas não aparece no menu ou na aba do
usuário conta **0** (entrega só vale se o usuário enxerga). Sem diferencial cadastrado no blueprint → o auditor registra
"blueprint sem diferencial para esta tarefa" como sugestão, sem nota.
- **Alta:** diferencial no primeiro bloco da tela, com "?" (RD-95). **Baixa:** diferencial só em relatório que ninguém abre.

### C. Paridade de função (verificação, sem nota própria)
Lista do que os concorrentes têm **naquela tarefa** e o que a tela PS não cobre. Lacuna de função reconhecida pelo CEO
como obrigatória vira item de **reprovação**; as demais viram sugestão.

### D. Sugestões à frente
O auditor propõe melhorias em quatro eixos: **facilidade de uso**, **produtividade do usuário**, **redução de custo
para o cliente** e **vantagem sobre os concorrentes**, cada uma com **impacto estimado** (alto/médio/baixo e a conta
resumida). Gravadas no banco de sugestões (motor do `gilberto-chamados`; status sugerida/aprovada/recusada/virou onda);
o CEO prioriza e as aprovadas viram ondas.

### Formato de saída por tela
`{ nota_visual, nota_originalidade, nota_diferenciais, reprovada, pontos_descontados[{elemento, largura, motivo}],
paridade_lacunas[], sugestoes[{eixo, texto, impacto}] }`

## Exemplos de calibragem
- **92 (visual; originalidade 90, diferenciais 80):** Resultado por obra — cartões de margem em grade proporcional, ícones lucide, estados vazios com ação, 390 px em 1 coluna.
- **71:** tela correta e legível, mas com 4 emojis nas abas e 40% da área em branco em 1920.
- **38:** tabela de 14 colunas que estoura a página em 390 px, fonte 10 px, emojis como ícones, sem estado vazio.

## Ícones premium — como aplicar
```tsx
import { Activity } from 'lucide-react'
<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Activity size={16} strokeWidth={1.5}/>Leitura</span>
```
- Gate `scripts/gates/check-icones-premium.ts`: PR que **adiciona** emoji no texto de interface (`src/app/dashboard`, `src/components`) reprova. O legado não bloqueia.
- Relatório da varredura: `npx tsx scripts/relatorio-icones.ts [--telas]` (por vertical; a lista só deve diminuir).
- Fora do escopo do gate: comentários, logs, e-mail, PDF e texto de changelog (dado histórico).
