-- SUPERSEDED: the user authorized READ only and explicitly withheld official publication of the three proposals.
-- The executed read-only activation is recorded in activate-read-authorized.sql.
do $$begin raise exception 'LEGACY_RULE_PUBLICATION_NOT_AUTHORIZED';end$$;
