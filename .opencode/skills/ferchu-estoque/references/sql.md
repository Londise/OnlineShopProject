# Consulta única de inspeção e verificação

Substituir a lista de slugs pelo escopo solicitado. A mesma consulta serve antes/depois; retorna apenas catálogo/estoque, sem usuários ou pedidos.

```sql
SELECT p.id, p.slug, p.name, p.price_cents AS base_price_cents,
       jsonb_agg(jsonb_build_object(
         'option_id', po.id, 'color_id', vo.id, 'color', vo.name,
         'color_slug', vo.slug, 'swatch_hex', vo.swatch_hex,
         'size', s.code, 'variant_id', pv.id,
         'price_cents', coalesce(pv.price_cents, p.price_cents),
         'on_hand', i.on_hand, 'reserved', i.reserved,
         'available', i.on_hand-i.reserved
       ) ORDER BY po.sort_order, s.sort_order) AS variants
FROM app.products p
JOIN app.product_options po ON po.product_id=p.id AND po.active
JOIN app.variant_options vo ON vo.id=po.variant_option_id AND vo.active
LEFT JOIN app.product_variants pv ON pv.product_option_id=po.id AND pv.active
LEFT JOIN app.sizes s ON s.id=pv.size_id
LEFT JOIN app.inventory_levels i ON i.variant_id=pv.id
WHERE p.slug IN ('calca-malha-viscolycra','calca-linho',
                 'pantacourt-linho','bermuda-linho')
GROUP BY p.id ORDER BY p.name;
```

## Escrita: montar apenas as operações necessárias

- Um `DO $$ DECLARE ... BEGIN ... END $$;` é atômico; se houver exceção, reverte todas as alterações desse bloco.
- Validar quantidade/identidade dos produtos antes de escrever. Locks de produto primeiro e inventário em seguida, sempre na mesma ordem.
- Capturar `before_json` com preços, variantes, opções ativas e inventários do escopo. Após a escrita, capturar `after_json` e inserir auditoria por produto.
- Novos registros usam `INSERT ... ON CONFLICT ... RETURNING id INTO v_*`. Não executar `DO UPDATE` se o pedido não autoriza alterar um registro existente.
- Para ajustar estoque existente, obter físico/reserva com lock; definir alvo; abortar se alvo < reserva; atualizar físico e `updated_at`, preservando reserva. Movimento usa `alvo - físico anterior`, não o alvo.
- Para novo tamanho, inserir `sizes` somente se ausente; associar variantes **apenas às cores ativas dos produtos autorizados**. Criar inventário e movimento inicial.
- Alterar só preço não gera movimento de estoque.
- Depois de erro/timeout de escrita, consultar o estado/auditoria antes de decidir repetir.

## Verificação compacta adicional

Para pedidos de tamanho/preço, substituir o `jsonb_agg` acima por agrupamento em produto/tamanho:

```sql
SELECT p.name, s.code, count(*) AS colors,
       min(coalesce(pv.price_cents,p.price_cents)) AS min_price_cents,
       max(coalesce(pv.price_cents,p.price_cents)) AS max_price_cents,
       sum(i.on_hand) AS physical, sum(i.reserved) AS reserved
FROM app.products p
JOIN app.product_options po ON po.product_id=p.id AND po.active
JOIN app.variant_options vo ON vo.id=po.variant_option_id AND vo.active
JOIN app.product_variants pv ON pv.product_option_id=po.id AND pv.active
JOIN app.sizes s ON s.id=pv.size_id
JOIN app.inventory_levels i ON i.variant_id=pv.id
WHERE p.slug IN ('calca-malha-viscolycra','calca-linho',
                 'pantacourt-linho','bermuda-linho')
GROUP BY p.id,s.id ORDER BY p.name,s.sort_order;
```
