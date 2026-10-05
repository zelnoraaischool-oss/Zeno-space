-- =============================================================================
-- zenospace 0005: 日本語の全文検索（PGroonga：8.2 / ZS-SRCH-02）
-- ひらがなとカタカナ、全角と半角の違いを NormalizerNFKC150 で吸収する。
-- =============================================================================
create extension if not exists pgroonga with schema extensions;

alter table public.works add column if not exists search_text text not null default '';

-- 作品の検索用テキスト（タイトル、キャッチコピー、説明、カテゴリ、制作者名、タグ、使用技術）
create or replace function private.works_search_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.search_text := concat_ws(' ', new.title, new.catch_copy, new.description,
    (select c.name from public.categories c where c.id = new.category_id),
    (select p.display_name || ' ' || p.handle from public.profiles p where p.id = new.owner_id),
    (select string_agg(t.name, ' ') from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = new.id),
    (select string_agg(t.name, ' ') from public.work_techs wt join public.techs t on t.id = wt.tech_id where wt.work_id = new.id));
  return new;
end;
$$;
create trigger works_search_text before insert or update on public.works for each row execute function private.works_search_text();

-- タグ・使用技術が変わったら作品の検索用テキストを作り直す
create or replace function private.touch_work_search_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.works set updated_at = now() where id = coalesce(new.work_id, old.work_id);
  return null;
end;
$$;
create trigger work_tags_search after insert or delete on public.work_tags for each row execute function private.touch_work_search_text();
create trigger work_techs_search after insert or delete on public.work_techs for each row execute function private.touch_work_search_text();

create index works_search_pgroonga on public.works using pgroonga (search_text extensions.pgroonga_text_full_text_search_ops_v2)
  with (normalizers = 'NormalizerNFKC150("unify_kana", true, "unify_to_romaji", false)');
-- 索引式には IMMUTABLE の関数しか使えない（array_to_string は STABLE）ため、包んだ関数で式を作る
create or replace function public.profile_search_text(p_name text, p_handle text, p_skills text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(p_name, '') || ' ' || coalesce(p_handle, '') || ' ' || coalesce(pg_catalog.array_to_string(p_skills, ' '), '') $$;
create index profiles_search_pgroonga on public.profiles using pgroonga ((public.profile_search_text(display_name, handle, skills)) extensions.pgroonga_text_full_text_search_ops_v2)
  with (normalizers = 'NormalizerNFKC150("unify_kana", true)');
create index tags_search_pgroonga on public.tags using pgroonga (name extensions.pgroonga_text_full_text_search_ops_v2)
  with (normalizers = 'NormalizerNFKC150("unify_kana", true)');

-- 作品一覧・件数・絞り込み（ZS-WORK-06〜08）。条件は src/lib/types.ts の WorkQuery と同じ JSON
create or replace function public.search_works(p_query jsonb default '{}', p_offset int default 0, p_limit int default 24)
returns table (id uuid, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      nullif(p_query ->> 'q', '') as text,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'types', '[]'))) as types,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'categoryIds', '[]'))::uuid) as cats,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'techIds', '[]'))::uuid) as techs,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'productionTypes', '[]'))) as prods,
      (p_query ->> 'priceMin')::int as pmin,
      (p_query ->> 'priceMax')::int as pmax,
      coalesce((p_query ->> 'openOnly')::boolean, false) as open_only,
      (p_query ->> 'ownerId')::uuid as owner,
      coalesce(p_query ->> 'sort', 'new') as sort
  ),
  hits as (
    select w.*, (select coalesce(sum(s.likes), 0) from public.work_daily_stats s where s.work_id = w.id and s.date >= current_date - 7) as pop
    from public.works w
    join public.profiles p on p.id = w.owner_id
    cross join q
    where w.status = 'active' and w.visibility = 'public' and w.published_at is not null
      and (q.text is null or w.search_text operator(extensions.&@~) q.text)
      and (cardinality(q.types) = 0 or w.type = any (q.types))
      and (cardinality(q.cats) = 0 or w.category_id = any (q.cats))
      and (cardinality(q.techs) = 0 or exists (select 1 from public.work_techs t where t.work_id = w.id and t.tech_id = any (q.techs)))
      and (cardinality(q.prods) = 0 or w.production_type = any (q.prods))
      and (q.pmin is null or coalesce(w.price_max, w.price_min, -1) >= q.pmin)
      and (q.pmax is null or coalesce(w.price_min, 2147483647) <= q.pmax)
      and (not q.open_only or p.commission_status = 'open')
      and (q.owner is null or w.owner_id = q.owner)
  )
  select h.id, count(*) over () as total
  from hits h, q
  order by
    case when q.sort = 'popular' then h.pop end desc nulls last,
    case when q.sort = 'likes' then h.like_count end desc nulls last,
    case when q.sort = 'views' then h.view_count end desc nulls last,
    h.published_at desc
  offset p_offset limit p_limit
$$;
grant execute on function public.search_works(jsonb, int, int) to anon, authenticated;
