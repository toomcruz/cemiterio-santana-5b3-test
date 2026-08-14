-- C4: typed UUID-array support for closed request proposal schemas. Local package only.
begin;

create or replace function support_vnext_shadow.is_valid_uuid_string(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path=pg_catalog
as $$
begin
  perform p_value::uuid;
  return true;
exception when invalid_text_representation then
  return false;
end $$;

create or replace function support_vnext_shadow.valid_proposal_fields(p_fields jsonb,p_schema jsonb)
returns boolean
language plpgsql
immutable
set search_path=pg_catalog,support_vnext_shadow
as $$
declare k text; v jsonb; item jsonb; expected text;
begin
 if jsonb_typeof(p_fields)<>'object' or jsonb_typeof(p_schema)<>'object'
    or not support_vnext_shadow.closed_object(p_schema,array['properties','required'])
    or jsonb_typeof(coalesce(p_schema->'properties','{}'::jsonb))<>'object'
    or not support_vnext_shadow.json_array_of_strings(coalesce(p_schema->'required','[]'::jsonb)) then return false; end if;
 for k,v in select key,value from jsonb_each(p_fields) loop
   if not (p_schema->'properties' ? k) or k in ('subject','category','category_code','sector','setor','severity','gravidade') then return false; end if;
   expected:=p_schema#>>array['properties',k,'type'];
   if expected='uuid_array' then
     if jsonb_typeof(v)<>'array' then return false; end if;
     for item in select value from jsonb_array_elements(v) loop
       if jsonb_typeof(item)<>'string' or not support_vnext_shadow.is_valid_uuid_string(item#>>'{}') then return false; end if;
     end loop;
   elsif expected not in ('string','number','integer','boolean','null')
      or (expected='string' and jsonb_typeof(v)<>'string')
      or (expected='number' and jsonb_typeof(v)<>'number')
      or (expected='integer' and (jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^-?[0-9]+$'))
      or (expected='boolean' and jsonb_typeof(v)<>'boolean')
      or (expected='null' and v<>'null'::jsonb) then return false;
   end if;
 end loop;
 return not exists(select 1 from jsonb_array_elements_text(coalesce(p_schema->'required','[]'::jsonb)) r where not(p_fields ? r));
end $$;

commit;
