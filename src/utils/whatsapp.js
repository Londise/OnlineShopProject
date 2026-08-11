export function buildOrderMessage({
  lines,
  qtyTotal,
  selectedDelivery,
  orderNumber,
}) {

  // Se não houver linhas de pedido, retorna uma string vazia
  if (!lines || lines.length === 0) return "";

  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  let message = "Olá! Gostaria de fazer o seguinte pedido:\n";
  if (orderNumber) message += `Pedido: ${orderNumber}\n`;
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

  // Agrupa por produto
  const groupedProducts = {};

  lines.forEach((line) => {
    if (!groupedProducts[line.name]) {
      groupedProducts[line.name] = {};
    }

    if (!groupedProducts[line.name][line.size]) {
      groupedProducts[line.name][line.size] = [];
    }

    groupedProducts[line.name][line.size].push(line);
  });

  Object.entries(groupedProducts).forEach(([productName, sizes]) => {
    message += `📦 ${productName.toUpperCase()}\n\n`;

    Object.entries(sizes).forEach(([size, items]) => {
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

export function sendToWhatsApp(message) {

  if (!message) return

  const PHONE = import.meta.env.VITE_WHATSAPP_NUMBER;

  const params = new URLSearchParams({
    phone: PHONE,
    text: message,
  });

  const url = `https://api.whatsapp.com/send?${params}`;

  window.open(url, "_blank");
}
