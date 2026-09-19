// #61 (sistêmico) · sinal global e simples de "formulário sujo" (conteúdo não salvo na tela atual).
// O PwaBootstrap consulta isto para NUNCA recarregar a página por baixo de um formulário aberto quando
// um novo deploy assume o service worker. Telas com formulário marcam/desmarcam; sem refatorar nada:
// basta chamar marcarFormSujo(id) quando houver conteúdo e marcarFormLimpo(id) quando limpar/enviar.
// Estado por ABA (módulo em memória) — é exatamente o escopo que importa (o reload afeta a aba).

const sujos = new Set<string>()

export function marcarFormSujo(id: string): void { sujos.add(id) }
export function marcarFormLimpo(id: string): void { sujos.delete(id) }
export function haFormSujo(): boolean { return sujos.size > 0 }
