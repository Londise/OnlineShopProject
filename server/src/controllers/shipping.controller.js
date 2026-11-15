import { defaultShippingQuoter } from '../services/melhor-envio.service.js';

const QUOTE_DISPLAY_LIMIT = 2;

export const quote = async (req, res) => {
  const quoteShipping = req.app.locals.shippingQuote ?? defaultShippingQuoter;
  const result = await quoteShipping({ postalCode: req.body.postalCode, pieces: req.body.pieces });
  res.json({ ...result, options: result.options.slice(0, QUOTE_DISPLAY_LIMIT) });
};
