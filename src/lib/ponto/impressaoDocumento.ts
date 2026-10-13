// #258 · Impressão do documento de assinatura (e do relatório de prova). Antes o documento era impresso de DENTRO do
// modal: o fundo é position:fixed (o navegador repete elemento fixo em TODA página impressa — a 1ª folha saía duas
// vezes) e o cartão tinha max-height 86vh + rolagem (o resto — inclusive o bloco de assinatura — era cortado).
// Agora o modal vai para um portal no <body>; na impressão todo o resto da página some, o fundo deixa de ser fixo, o
// cartão perde altura máxima e rolagem, e o bloco de assinatura não se parte entre folhas.
export const CSS_IMPRESSAO = `@media print {
  body > *:not(.ps-print-portal) { display: none !important }
  .ps-print-portal { position: static !important; inset: auto !important; display: block !important; background: none !important; padding: 0 !important; overflow: visible !important }
  .ps-print-portal .ps-print-doc { position: static !important; max-height: none !important; max-width: none !important; width: 100% !important; overflow: visible !important; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important }
  .ps-print-portal .no-print { display: none !important }
  .ps-print-assinatura { break-inside: avoid; page-break-inside: avoid }
  @page { size: A4; margin: 14mm }
}`
