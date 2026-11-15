# Seletores de testes UI e E2E

- Prefira `getByRole`/`findByRole` com papel e nome acessível. Para nomes fixos ou nomes completos derivados da fixture, explicite `exact: true`. No Testing Library essa já é a correspondência padrão para strings; explicitá-la mantém o contrato legível e consistente com o Playwright.
- Restrinja controles repetidos ao diálogo, formulário, cartão ou região correspondente. Não use um nome parcial na página inteira quando o contexto é conhecido.
- Regex são apropriadas para conteúdo realmente variável (quantidade, preço, estado de carregamento ou nomes compostos). Use prefixos/sufixos delimitados quando fizerem parte da identidade; não use regex para abreviar um nome fixo conhecido.
- Use `getByLabel` (Playwright) / `getByLabelText` (Testing Library), com o label completo e `exact: true`, para campos sem papel acessível adequado, como senha e input de arquivo. O label atual do arquivo é **Escolher arquivo**, não apenas **Arquivo**.
- Reutilize `test/support/locators.js` nos testes UI e `test/e2e/locators.js` nos E2E para catálogo e painéis de mídia. Os helpers selecionam por contexto e identidade, nunca pelo primeiro resultado.
- Não resolva ambiguidades com `.first()`, `.last()`, `.nth()` ou `getAllBy…()[0]`. Posição só é válida quando a ordem é o comportamento sob teste, como o percurso de foco por Tab; deixe essa intenção documentada.
- Seletores CSS/DOM são aceitáveis para medir layout, estilos, dimensões e relações de elementos. Não substitua seletores semânticos de ações por classes CSS ou cadeias posicionais.
- Preserve as verificações existentes e o modo estrito. Não desative testes, adicione retries ou aumente timeouts para ocultar um seletor incorreto.
- Ao mudar texto ou estrutura de uma tela, revise os seletores dos testes afetados e execute os testes UI e E2E correspondentes. Uma rodada antiga não valida os arquivos modificados.
- E2E e integração PostgreSQL geram o mesmo Prisma client: execute-os em sequência, com Node 22.23.4+ (<23), usando apenas os ambientes descartáveis existentes.
