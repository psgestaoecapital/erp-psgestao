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

## Exemplos de calibragem
- **92:** Resultado por obra — cartões de margem em grade proporcional, ícones lucide, estados vazios com ação, 390 px em 1 coluna.
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
