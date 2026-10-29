export const brlCurto = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
