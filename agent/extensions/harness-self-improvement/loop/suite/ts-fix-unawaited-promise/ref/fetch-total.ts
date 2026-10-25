type Price = { item: string; cents: number };

async function loadPrices(): Promise<Price[]> {
  return [
    { item: "tea", cents: 250 },
    { item: "cup", cents: 900 },
  ];
}

export async function totalCents(): Promise<number> {
  const prices = await loadPrices();
  return prices.reduce((sum, p) => sum + p.cents, 0);
}
