# Hasura Permissions

> Copy this and follow in Hasura Console → Data → each table → Permissions tab

| Table | Admin | Tester |
| :-- | :-- | :-- |
| **modules** | Full CRUD | SELECT only |
| **tests** | Full CRUD | SELECT only |
| **steps** | Full CRUD | SELECT + UPDATE own (status, remarks) |
| **testlocks** | Full CRUD | SELECT + INSERT/UPDATE/DELETE own rows |
| **auditlog** | SELECT + INSERT | SELECT + INSERT own rows |
