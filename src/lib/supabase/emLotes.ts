// Filtro `.in(coluna, lista)` com lista grande (22/10/2026): o Supabase manda
// a lista na URL e, acima de umas 300 ids, o pedido falha ("fetch failed"
// depois de ~9 s) -- foi o que deixou vazio o quadro de produção da campanha
// Brasil Cap (605 imobiliárias). Divide em lotes e junta o resultado.
export async function buscarEmLotes<T, V = string>(
  valores: V[],
  consulta: (lote: V[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 200
): Promise<T[]> {
  const lotes: V[][] = [];
  for (let i = 0; i < valores.length; i += tamanho) lotes.push(valores.slice(i, i + tamanho));
  const respostas = await Promise.all(lotes.map((lote) => consulta(lote)));
  const todos: T[] = [];
  for (const { data, error } of respostas) {
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
  }
  return todos;
}
