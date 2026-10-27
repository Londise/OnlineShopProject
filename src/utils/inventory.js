// null distinguishes invalid/empty input from an intentional zero stock.
export const parseInventoryQuantity = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
};
