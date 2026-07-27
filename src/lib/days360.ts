function isLastDayOfMonth(iso: string): boolean {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia === ultimoDia;
}

/** Replica a função DAYS360 do Excel (método US/NASD), usada na planilha de referência da multa rescisória. */
export function days360(inicioIso: string, fimIso: string): number {
  const [y1, m1] = inicioIso.split("-").map(Number);
  let d1 = Number(inicioIso.split("-")[2]);
  const [y2Raw, m2Raw] = fimIso.split("-").map(Number);
  let d2 = Number(fimIso.split("-")[2]);
  let m2 = m2Raw;
  let y2 = y2Raw;

  if (isLastDayOfMonth(inicioIso)) d1 = 30;

  if (isLastDayOfMonth(fimIso)) {
    if (d1 < 30) {
      d2 = 1;
      m2 += 1;
      if (m2 > 12) {
        m2 = 1;
        y2 += 1;
      }
    } else {
      d2 = 30;
    }
  }

  if (d2 === 31 && d1 >= 30) d2 = 30;

  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}
