---
name: Estoque Ferchu Modas
description: Alterar estoque, cores, tamanhos e preços dos produtos da Ferchu Modas no Supabase com consultas agrupadas, transação auditada e verificação no site.
---

# Estoque Ferchu Modas

## Fluxo mínimo: consultar → alterar → verificar

1. Confirmar somente dados ausentes: produto, cores/tamanhos, quantidade **por cor e tamanho**, preço, estoque físico ou disponível. Não presumir estoque de tamanho novo nem substituição de cores.
2. Usar Supabase MCP, não instalar ferramentas ou dependências. Descobrir `execute_sql` via `search` apenas se a assinatura ainda não estiver disponível. Consultar os produtos exatos e as variantes em **uma chamada**, com a consulta de `references/sql.md`. Não listar tabelas/reler Prisma se o contrato abaixo continua válido; conferir colunas apenas ao surgir divergência.
3. Executar **uma transação DML** com escopo exato, guardas, locks, registros de movimento e auditoria. Não alterar schema nem executar seed/migrations para editar catálogo. Usar variáveis `v_*` e colunas qualificadas para evitar ambiguidades. Nunca repetir escrita de resultado incerto sem consultar o estado.
4. Verificar em **uma consulta agrupada** cores, tamanhos, preço efetivo, estoque e reservas; comparar com o pedido. Conferir também a resposta real `/api/v1/products` e a tela se houve inclusão de tamanho/cor/preço. Não enviar pedidos de teste em produção.
5. Responder com produtos/preços e ressalvas de reservas. Mudanças só de dados não precisam de deploy. Para código, testar e publicar **somente se autorizado**, incluindo apenas os arquivos da tarefa.

## Contrato conhecido

- Schema privado `app`; MCP já aponta para o projeto desta loja. Nunca mostrar credenciais ou dados pessoais.
- `products`: `id`, `slug`, `name`, `material`, `price_cents`, `active`, `updated_at`.
- `variant_options`: `id`, `type='COLOR'`, `name`, `slug` único, `swatch_hex`, `active`. São globais: não renomear/recolorir opções compartilhadas sem autorização; criar outra quando necessário.
- `product_options`: `id`, `product_id`, `variant_option_id`, `sort_order`, `active`. Único `(product_id,variant_option_id)`.
- `sizes`: `id`, `code` único, `sort_order`, `active`. Ordem atual P, M, G, GG, EXG.
- `product_variants`: `id`, `product_option_id`, `size_id`, `sku` único, `price_cents` anulável, `active`, `updated_at`. Único `(product_option_id,size_id)`.
- `inventory_levels`: `variant_id` PK, `on_hand`, `reserved`, `updated_at`. Disponível = físico − reservado. Nunca zerar reservas nem baixar físico abaixo delas.
- `inventory_movements`: `id`, `variant_id`, `type`, `on_hand_delta`, `reserved_delta`, `reason`. Registrar `INITIAL` para estoque novo; `ADJUSTMENT` para diferença real. Enum SQL: `app."InventoryMovementType"`.
- `audit_logs`: `id`, `entity_type`, `entity_id`, `action`, `before_json`, `after_json`; preservar antes/depois. `actor_id` pode ser nulo em operação MCP; não inventar usuário.
- IDs textuais novos: `gen_random_uuid()::text`. Preencher `updated_at=now()` explicitamente; Prisma não faz isso em SQL direto.
- Preços em **centavos**: R$ 28 = `2800`. Efetivo = `coalesce(product_variants.price_cents,products.price_cents)`. Alterar preço-base quando todas as variantes comuns devem herdar o novo preço; tamanho especial usa override.
- Troca total de cartela: desativar opções/variantes antigas **somente nos produtos autorizados**. Não excluir histórico, pedidos, snapshots nem imagens.
- Slugs validados: `calca-malha-viscolycra`, `calca-linho`, `pantacourt-linho`, `bermuda-linho`. Não adivinhar slugs pelo nome.

## Armadilhas já resolvidas

- MCP retorna o **último SELECT**; juntar leituras em um único `jsonb_build_object` ou fazer um SELECT agrupado.
- Bloquear inventários existentes com `FOR UPDATE OF i` e ordem estável; preservar `reserved` no `ON CONFLICT`. Usar `SET LOCAL lock_timeout='5s'` e abortar se estoque-alvo < reserva.
- Cores precisam de `swatch_hex`, não só nome. API já entrega `swatchHex`; `src/hooks/useCatalog.js` o preserva e `src/components/BuilderModalButton.jsx` o usa antes do fallback legado.
- EXG já funciona dinamicamente na tela e no carrinho. Não adicionar listas fixas de tamanhos.
- Para verificar no Browse: `page.evaluate(async () => (await fetch('/api/v1/products')).json())` na origem da loja. **`page.request` não existe nesse plugin.**
- Desenvolvimento exige URL absoluta: `VITE_API_URL=http://127.0.0.1:5173/api/v1 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. Usar backend local configurado ou interceptação explícita apenas para teste visual; nunca confundir fixture com API real.
- Testes frontend: `npm run test:ui -- test/ui/storefront.test.jsx`; build: `npm run build`. Não rodar integração PostgreSQL para uma simples alteração de CSS/dados.
- Loja: `https://ferchumodas.shop`. Deploy Git autorizado: revisar diff, adicionar **caminhos exatos**, commit e push `origin main`; Vercel `ferchumodas`, projeto `prj_MY9ljrfZo6jow2QjzSLaQwDhVlAA`, equipe `team_goy3HMaXB1pPtzyoK2xaQjwi`. Confirmar READY e verificar no domínio real.
- Mídia: `GET /admin/media-assets` aceita `limit/offset/purpose/q` e retorna `{assets,total}`; `DELETE /admin/media-assets/:id` só exclui sem vínculo (produto/categoria/banner/opção/pedido → 409). Upload recodifica e remove EXIF; exigir `Origin` exato em mutações. CSP do frontend vive em `deploy/vercel-config.js`.
