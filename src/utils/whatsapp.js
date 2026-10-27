export function buildOrderMessage({
  lines,
  qtyTotal,
  selectedDelivery,
  orderNumber,
}) {

  // Se não houver linhas de pedido, retorna uma string vazia
  if (!lines || lines.length === 0) return "";

  let message = "Olá! Gostaria de fazer o seguinte pedido:\n";
  if (orderNumber) message += `Pedido: ${orderNumber}\n`;
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

  // Agrupa por produto
  const groupedProducts = new Map();

  lines.forEach((line) => {
    if (!groupedProducts.has(line.name)) {
      groupedProducts.set(line.name, new Map());
    }

    const sizes = groupedProducts.get(line.name);
    if (!sizes.has(line.size)) {
      sizes.set(line.size, []);
    }

    sizes.get(line.size).push(line);
  });

  groupedProducts.forEach((sizes, productName) => {
    message += `📦 ${productName.toUpperCase()}\n\n`;

    sizes.forEach((items, size) => {
      message += `${size}\n`;

      items.forEach((item) => {
        message += `• ${item.color}: ${item.quantity}\n`;
      });

      message += "\n";
    });

    message += "━━━━━━━━━━━━━━━━━━━━\n\n";
  });

  message += `🧺 Total de peças: ${qtyTotal}\n`;

  if (selectedDelivery) {
    message += `🚚 Entrega: ${selectedDelivery.label}\n`;
  }
  return message;
}

export function buildWhatsAppUrl(message, phone = import.meta.env?.VITE_WHATSAPP_NUMBER) {
  const params = new URLSearchParams();
  if (phone != null && String(phone).trim()) params.set("phone", String(phone).trim());
  params.set("text", message);
  return `https://api.whatsapp.com/send?${params}`;
}
