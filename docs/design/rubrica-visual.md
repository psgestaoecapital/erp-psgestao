# Rubrica de nota visual por tela (0–100) — PS Gestão (CEO 09/10)

Usada pelo auditor de IA do PDCA. Medir em 1366, 1920 e 390 px. Cada dimensão vale 0–100% do seu peso.

| Dimensão | Peso | Nota alta (≥ 90) | Nota baixa (≤ 40) |
|---|---|---|---|
| Dimensionamento e uso do espaço | 25 | Conteúdo ocupa a largura útil; grade proporcional; sem vazio desperdiçado nem espremido; sem rolagem lateral nos 3 tamanhos; hierarquia de tamanhos clara | Coluna estreita no meio de 1920 px; tabela cortada em 390 px; rolagem lateral |
| Ícones | 15 | Um só conjunto de traço fino (`Icone.tsx`), tamanho e cor herdados do texto | Emoji como ícone, mistura de estilos, ícone sem significado |
| Tipografia | 15 | Escala definida (título, subtítulo, corpo, apoio), corpo ≥ 14 px, peso só para hierarquia | Mais de 3 tamanhos aleatórios, corpo < 12 px, tudo em negrito |
| Espaçamento | 15 | Múltiplos de 4/8 px, respiro generoso entre blocos, alinhamento consistente | Blocos colados, margens diferentes a cada seção |
| Contraste e cor | 10 | Texto ≥ 4,5:1, cor com função (estado), paleta PS | Texto cinza claro sobre fundo claro, cor decorativa |
| Estados vazios, carregando e erro | 10 | Mensagem em linguagem do usuário + próxima ação | Tela em branco, "undefined", spinner eterno |
| Consistência com o design system | 10 | Componentes e "?" (RD-95) padrão; nada copiado de concorrente (RD-96) | Botões e cartões próprios, estilos soltos em linha |

Nota da tela = soma ponderada. Abaixo de 70 entra na fila de correção do PDCA.
Regra dura: emoji usado como ícone limita a dimensão "Ícones" a 0 e a nota total a 85.
Gate: `scripts/gates/check-emoji-icone.ts` (baseline por arquivo que só diminui; arquivo novo nasce sem emoji).
