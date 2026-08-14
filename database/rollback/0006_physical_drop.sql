-- Physical rollback ONLY after operational OFF and explicit retention approval.
begin;
-- This package intentionally does not issue DROP schema automatically: audit/release/request evidence may exist.
-- If the isolated database is disposable, run 0002 then 0001 physical rollback after manually dropping 0003–0006 dependent functions/triggers/tables in dependency order.
commit;
