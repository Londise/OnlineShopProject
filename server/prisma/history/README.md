# Histórico anterior

Os arquivos em `mysql/` são as migrações originais, preservadas sem alterações
como registro da estrutura de origem. Não são executados pelos comandos Prisma
atuais e não representam suporte MySQL no backend.

A história ativa PostgreSQL fica em `../migrations/`. Não reaplique a migração
MySQL no PostgreSQL e não importe `_prisma_migrations` do banco antigo.
