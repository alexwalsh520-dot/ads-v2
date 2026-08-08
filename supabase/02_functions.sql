-- ═══════════════════════════════════════════════════════════════════════════
-- ADS V2 — FUNCTIONS
--
-- Run this AFTER 01_tables.sql. Idempotent (CREATE OR REPLACE throughout).
--
-- These are the heavy reads. They live in the database rather than in the app
-- because the alternative is dragging tens of thousands of rows over the wire
-- to add them up in JavaScript. Every one is deterministic: same inputs, same
-- answer, no hidden state.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- THE SYNC LOCK. Cron schedulers double-fire. Without this, two syncs run at
-- once and race each other. Claiming is a single atomic INSERT ... ON CONFLICT:
-- exactly one caller can win, and a run that dies without releasing is taken
-- over after its TTL rather than blocking the sync forever.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.adsv2_claim_sync_lock(
  p_holder text, p_ttl_seconds integer default 900, p_lock_key text default 'sync_lock'
)
returns table(claimed boolean, took_over boolean, previous_holder text, previous_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '10s'
as $function$
declare
  v_prev_holder   text;
  v_prev_at       timestamptz;
  v_prev_released text;
  v_won           boolean := false;
begin
  if p_holder is null or btrim(p_holder) = '' then
    raise exception 'a sync lock claim must name its holder';
  end if;

  select m.value ->> 'holder',
         case when jsonb_typeof(m.value -> 'at') = 'string'
              then (m.value ->> 'at')::timestamptz end,
         m.value ->> 'released_at'
    into v_prev_holder, v_prev_at, v_prev_released
    from public.adsv2_meta m
   where m.key = p_lock_key;

  insert into public.adsv2_meta (key, value, updated_at)
  values (
    p_lock_key,
    jsonb_strip_nulls(jsonb_build_object(
      'holder',      p_holder,
      'at',          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ttl_seconds', p_ttl_seconds,
      'released_at', null
    )),
    now()
  )
  on conflict (key) do update
     set value = excluded.value
                 || case
                      when public.adsv2_meta.value ->> 'released_at' is null
                       and public.adsv2_meta.value ->> 'holder' is not null
                      then jsonb_build_object(
                             'took_over_from', public.adsv2_meta.value ->> 'holder',
                             'took_over_at',   public.adsv2_meta.value ->> 'at')
                      else '{}'::jsonb
                    end,
         updated_at = now()
   where
     jsonb_typeof(public.adsv2_meta.value -> 'at') is distinct from 'string'
     or public.adsv2_meta.value ->> 'released_at' is not null
     or (public.adsv2_meta.value ->> 'at')::timestamptz
          < now() - make_interval(secs => p_ttl_seconds)
  returning true into v_won;

  -- A LOSER RE-READS. The "before" read happens outside the row lock, so under
  -- a real double-fire both twins read the same pre-existing holder: whoever
  -- ran an hour ago. A loser reporting THAT would put a stale name in its skip
  -- row and in the sync history. Only the losing path pays for the extra read.
  if not coalesce(v_won, false) then
    select m.value ->> 'holder',
           case when jsonb_typeof(m.value -> 'at') = 'string'
                then (m.value ->> 'at')::timestamptz end
      into v_prev_holder, v_prev_at
      from public.adsv2_meta m
     where m.key = p_lock_key;
  end if;

  return query select
    coalesce(v_won, false),
    coalesce(v_won, false) and v_prev_holder is not null and v_prev_released is null,
    v_prev_holder,
    v_prev_at;
end;
$function$;

create or replace function public.adsv2_release_sync_lock(
  p_holder text, p_lock_key text default 'sync_lock'
)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '10s'
as $function$
  update public.adsv2_meta
     set value = value || jsonb_build_object(
           'released_at',
           to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
         updated_at = now()
   where key = p_lock_key
     and value ->> 'holder' = p_holder
     and value ->> 'released_at' is null
  returning true;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- THE MAIN READ. One row per ad keyword for a date window: spend, DMs, booked
-- calls, calls taken, sales, cash. This is what the table on screen is made of.
--
-- `ident` looks back 180 days past the window on purpose: an ad that spent
-- nothing this week still has a name, a campaign, and a creative to show.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.adsv2_window_leaves(
  p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb
)
returns table(
  client_key text, keyword text, ad_id text, ad_name text, campaign_id text, campaign_name text,
  adset_id text, adset_name text, ad_status text, campaign_status text, preview_url text,
  video_url text, is_video boolean, spend_cents bigint, impressions bigint, clicks bigint,
  messages bigint, booked bigint, upcoming bigint, showed_people bigint, taken_rows bigint,
  taken_people bigint, new_clients bigint, collected_usd_cents bigint,
  contracted_usd_cents bigint, has_spend boolean
)
language sql
stable
as $function$
  with spend_daily as (
    select amid.client_key, amid.keyword_normalized as kw, amid.date,
      amid.spend_cents, amid.impressions, amid.link_clicks,
      upper(coalesce(p_currency->>amid.client_key,'USD')) as ccy
    from ads_meta_insights_daily amid
    where amid.client_key = any(p_clients)
      and amid.raw_payload->>'reporting_timezone' = 'America/New_York'
      and amid.date >= p_from and amid.date <= p_to
      and amid.keyword_normalized is not null and amid.keyword_normalized <> ''
  ),
  spend as (
    select client_key, kw,
      sum(case when ccy = 'USD' then spend_cents
        else round(spend_cents * coalesce((
          select fr.rate from fx_rates fr
          where fr.base = sd.ccy and fr.quote = 'USD' and fr.rate_date <= sd.date
          order by fr.rate_date desc limit 1), 1)) end)::bigint as spend_cents,
      sum(impressions)::bigint as impressions, sum(link_clicks)::bigint as clicks
    from spend_daily sd group by client_key, kw
  ),
  ident as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, ad_id, ad_name, campaign_id, campaign_name,
      adset_id, adset_name, ad_effective_status, campaign_effective_status
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and date >= (p_from - 180)
    order by client_key, keyword_normalized, date desc
  ),
  prev as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, raw_payload->>'creative_preview' as preview_url
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and raw_payload->>'creative_preview' is not null and date >= (p_from - 180)
    order by client_key, keyword_normalized, date desc
  ),
  dm as (
    select client_key, keyword_normalized as kw, count(distinct subscriber_id) as messages
    from adsv2_dm_facts
    where client_key = any(p_clients) and et_day >= p_from and et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  bk_person as (
    select client_key, keyword_normalized as kw, contact_id,
      bool_or(taken) as taken_any, bool_or(is_upcoming) as upcoming_any
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
      and contact_id is not null
    group by client_key, keyword_normalized, contact_id
  ),
  booked as (
    select client_key, kw,
      count(*) as booked,
      count(*) filter (where upcoming_any and not taken_any) as upcoming,
      count(*) filter (where taken_any) as showed_people
    from bk_person group by client_key, kw
  ),
  taken as (
    select client_key, keyword_normalized as kw,
      count(*) filter (where call_taken) as taken_rows,
      count(distinct coalesce(subscriber_id, prospect_name)) filter (where call_taken) as taken_people,
      count(*) filter (where is_win) as new_clients,
      coalesce(sum(collected_usd_cents),0)::bigint as collected_usd_cents,
      coalesce(sum(contracted_usd_cents),0)::bigint as contracted_usd_cents
    from adsv2_sale_facts
    where client_key = any(p_clients) and sale_et_day >= p_from and sale_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  keys as (
    select client_key, kw from spend
    union select client_key, kw from dm
    union select client_key, kw from booked
    union select client_key, kw from taken
  )
  select k.client_key, k.kw, i.ad_id, i.ad_name, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name,
    i.ad_effective_status, i.campaign_effective_status,
    coalesce(ci.stored_thumb_url, ci.stored_image_url, p.preview_url) as preview_url,
    ci.stored_video_url as video_url,
    coalesce(ci.is_video, false) as is_video,
    coalesce(s.spend_cents,0), coalesce(s.impressions,0), coalesce(s.clicks,0),
    coalesce(d.messages,0), coalesce(b.booked,0), coalesce(b.upcoming,0),
    coalesce(b.showed_people,0),
    coalesce(t.taken_rows,0), coalesce(t.taken_people,0), coalesce(t.new_clients,0),
    coalesce(t.collected_usd_cents,0), coalesce(t.contracted_usd_cents,0), (s.kw is not null)
  from keys k
  join ident i on i.client_key = k.client_key and i.kw = k.kw
  left join ad_creative_image ci on ci.ad_id = i.ad_id
  left join prev p on p.client_key = k.client_key and p.kw = k.kw
  left join spend s on s.client_key = k.client_key and s.kw = k.kw
  left join dm d on d.client_key = k.client_key and d.kw = k.kw
  left join booked b on b.client_key = k.client_key and b.kw = k.kw
  left join taken t on t.client_key = k.client_key and t.kw = k.kw
$function$;

-- The same window, sliced by day instead of by keyword — this is the chart.
create or replace function public.adsv2_window_days(
  p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb
)
returns table(
  et_day date, spend_cents bigint, impressions bigint, clicks bigint, messages bigint,
  booked bigint, taken bigint, new_clients bigint, collected_usd_cents bigint
)
language sql
stable
as $function$
  with spend as (
    select amid.date as d,
      sum(case when upper(coalesce(p_currency->>amid.client_key,'USD'))='USD' then amid.spend_cents
        else round(amid.spend_cents * coalesce((
          select fr.rate from fx_rates fr
          where fr.base = upper(coalesce(p_currency->>amid.client_key,'USD')) and fr.quote='USD' and fr.rate_date <= amid.date
          order by fr.rate_date desc limit 1),1)) end)::bigint as spend_cents,
      sum(amid.impressions)::bigint as impressions,
      sum(amid.link_clicks)::bigint as clicks
    from ads_meta_insights_daily amid
    where amid.client_key = any(p_clients)
      and amid.raw_payload->>'reporting_timezone' = 'America/New_York'
      and amid.date >= p_from and amid.date <= p_to
      and amid.keyword_normalized is not null and amid.keyword_normalized <> ''
    group by amid.date
  ),
  dm as (
    select et_day as d, count(distinct subscriber_id) as messages
    from adsv2_dm_facts
    where client_key = any(p_clients) and et_day >= p_from and et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by et_day
  ),
  bk as (
    select booked_et_day as d, count(distinct contact_id) as booked
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by booked_et_day
  ),
  tk as (
    select sale_et_day as d,
      count(*) filter (where call_taken) as taken,
      count(*) filter (where is_win) as new_clients,
      coalesce(sum(collected_usd_cents),0)::bigint as collected_usd_cents
    from adsv2_sale_facts
    where client_key = any(p_clients) and sale_et_day >= p_from and sale_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by sale_et_day
  )
  select gd::date as et_day,
    coalesce(s.spend_cents,0), coalesce(s.impressions,0), coalesce(s.clicks,0),
    coalesce(dm.messages,0), coalesce(bk.booked,0),
    coalesce(tk.taken,0), coalesce(tk.new_clients,0), coalesce(tk.collected_usd_cents,0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join spend s on s.d = gd::date
  left join dm on dm.d = gd::date
  left join bk on bk.d = gd::date
  left join tk on tk.d = gd::date
  order by gd;
$function$;

-- Where ALL the cash came from, ad or not. Ads V2 shows ad revenue, but the
-- honest picture needs the rest of the tracker sitting next to it.
create or replace function public.adsv2_revenue_days(p_clients text[], p_from date, p_to date)
returns table(
  et_day date, organic_scoped_cents bigint, ads_all_cents bigint, organic_all_cents bigint,
  misc_chat_all_cents bigint, other_origin_all_cents bigint, tracker_all_cents bigint
)
language sql
stable
as $function$
  with cat as (
    select sale_et_day as d,
      collected_usd_cents as cents,
      (keyword_normalized is not null and keyword_normalized <> ''
        and not is_organic and not awaiting_review) as is_ads,
      is_organic,
      (lower(coalesce(call_type,'')) = 'miscellaneous chat'
        and not (keyword_normalized is not null and keyword_normalized <> ''
                 and not awaiting_review)) as is_misc,
      (lower(coalesce(call_type,'')) in ('follow up','outbound call','closer cold call')
        and not (keyword_normalized is not null and keyword_normalized <> ''
                 and not awaiting_review)) as is_other_origin,
      (client_key = any(p_clients)) as in_scope
    from adsv2_sale_facts
    where sale_et_day >= p_from and sale_et_day <= p_to
  ),
  agg as (
    select d,
      coalesce(sum(cents) filter (where is_organic and in_scope), 0)::bigint as organic_scoped_cents,
      coalesce(sum(cents) filter (where is_ads), 0)::bigint as ads_all_cents,
      coalesce(sum(cents) filter (where is_organic), 0)::bigint as organic_all_cents,
      coalesce(sum(cents) filter (where is_misc), 0)::bigint as misc_chat_all_cents,
      coalesce(sum(cents) filter (where is_other_origin), 0)::bigint as other_origin_all_cents,
      coalesce(sum(cents), 0)::bigint as tracker_all_cents
    from cat group by d
  )
  select gd::date as et_day,
    coalesce(a.organic_scoped_cents, 0),
    coalesce(a.ads_all_cents, 0),
    coalesce(a.organic_all_cents, 0),
    coalesce(a.misc_chat_all_cents, 0),
    coalesce(a.other_origin_all_cents, 0),
    coalesce(a.tracker_all_cents, 0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join agg a on a.d = gd::date
  order by gd;
$function$;

-- Show rate, counted per PERSON and only over calls that were actually due.
-- A call still in the future is not a no-show and must not drag the rate down.
create or replace function public.adsv2_showrate_cohort(p_clients text[], p_from date, p_to date)
returns table(client_key text, keyword text, showed bigint, due bigint)
language sql
stable
as $function$
  with p as (
    select client_key, keyword_normalized as kw, contact_id,
      bool_or(taken) as taken_any, bool_or(is_upcoming) as upcoming_any
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review
      and keyword_normalized is not null and keyword_normalized <> '' and contact_id is not null
    group by client_key, keyword_normalized, contact_id
  )
  select client_key, kw,
    count(*) filter (where taken_any)::bigint as showed,
    count(*) filter (where not (upcoming_any and not taken_any))::bigint as due
  from p group by client_key, kw
$function$;

-- The budget as it stood on a given day.
create or replace function public.adsv2_budget_asof(p_clients text[], p_to date)
returns table(
  entity_level text, entity_id text, campaign_id text, daily_usd_cents bigint,
  lifetime_usd_cents bigint, holds boolean, effective_status text
)
language sql
stable
as $function$
  select distinct on (entity_level, entity_id)
    entity_level, entity_id, campaign_id, daily_budget_usd_cents, lifetime_budget_usd_cents, holds_budget, effective_status
  from adsv2_budget_snapshots
  where client_key = any(p_clients) and et_day <= p_to
  order by entity_level, entity_id, et_day desc
$function$;

create or replace function public.adsv2_latest_budget_state(p_client text)
returns table(
  entity_level text, entity_id text, et_day date, daily_budget_cents bigint,
  lifetime_budget_cents bigint, effective_status text
)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select distinct on (s.entity_level, s.entity_id)
    s.entity_level, s.entity_id, s.et_day,
    s.daily_budget_cents, s.lifetime_budget_cents, s.effective_status
  from public.adsv2_budget_snapshots s
  where s.client_key = p_client
  order by s.entity_level, s.entity_id, s.et_day desc;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- STAMPING PASSES. Run after the facts are rebuilt; they fill in what one
-- source alone could not know.
-- ─────────────────────────────────────────────────────────────────────────

-- Connect each booking to the DM that produced it, five ways, best first.
-- A booking with no subscriber found stays blank rather than being guessed at.
create or replace function public.adsv2_stamp_booking_links(p_from date, p_to date)
returns integer
language plpgsql
as $function$
declare
  n integer;
begin
  update adsv2_booking_facts bf
  set dm_et_day = r.dm_day,
      taken = r.taken,
      linked_subscriber_id = r.sub
  from (
    select b.id, b.sub,
      coalesce(kw.kw_day, anyd.any_day) as dm_day,
      (tk.hit is not null) as taken
    from (
      select bf2.id, bf2.client_key, bf2.contact_id, bf2.keyword_normalized,
        coalesce(
          res.subscriber_id,
          nullif(ga.manychat_user_id, ''),
          mcl.subscriber_id,
          pc.sub,
          sp.sub
        ) as sub
      from adsv2_booking_facts bf2
      left join adsv2_booking_resolutions res
        on res.appointment_key = bf2.appointment_key
      left join lateral (
        select nullif(g.raw_payload->>'manychat_user_id','') as manychat_user_id
        from ghl_appointments g
        where g.appointment_id = bf2.appointment_key
        limit 1
      ) ga on true
      left join lateral (
        select m.subscriber_id
        from manychat_contact_links m
        where m.ghl_contact_id = bf2.contact_id
        limit 1
      ) mcl on true
      left join lateral (
        select (x.subscriber_ids)[1] as sub
        from person_context x
        where x.client_key = bf2.client_key
          and x.linked_via in ('subscriber','contact')
          and array_length(x.subscriber_ids,1) >= 1
          and bf2.contact_id = any(x.contact_ids)
        limit 1
      ) pc on true
      left join lateral (
        select s.manychat_subscriber_id as sub
        from sales_tracker_rows s
        join manychat_contact_links m2 on m2.subscriber_id = s.manychat_subscriber_id
        where m2.ghl_contact_id = bf2.contact_id
          and nullif(s.manychat_subscriber_id,'') is not null
        limit 1
      ) sp on true
      where bf2.booked_et_day >= p_from and bf2.booked_et_day <= p_to
    ) b
    left join lateral (
      select min((e.event_at at time zone 'America/New_York')::date) as kw_day
      from ads_keyword_events e
      where e.subscriber_id = b.sub and e.event_type = 'dm_keyword'
        and lower(e.keyword_normalized) = lower(b.keyword_normalized)
    ) kw on true
    left join lateral (
      select min((e.event_at at time zone 'America/New_York')::date) as any_day
      from ads_keyword_events e
      where e.subscriber_id = b.sub and e.event_type = 'dm_keyword'
    ) anyd on true
    left join lateral (
      select 1 as hit
      from sales_tracker_rows s
      where s.manychat_subscriber_id = b.sub
        and lower(coalesce(s.call_taken_status,'')) = 'yes'
      limit 1
    ) tk on true
  ) r
  where bf.id = r.id;

  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Carry the setter's name from the DM onto the booking it produced.
create or replace function public.adsv2_stamp_facts_setters(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_updated integer;
begin
  with pick as (
    select distinct on (k.subscriber_id)
           k.subscriber_id, nullif(trim(k.setter_name),'') as setter_name
    from public.ads_keyword_events k
    where k.subscriber_id is not null
      and nullif(trim(k.setter_name),'') is not null
    order by k.subscriber_id, k.event_at
  ), upd as (
    update public.adsv2_booking_facts b
       set setter_name = pick.setter_name
      from pick
     where pick.subscriber_id = (b.evidence->>'subscriber')
       and (b.setter_name is null or b.setter_name = '')
       and b.booked_et_day between p_from and p_to
    returning 1
  )
  select count(*)::integer into v_updated from upd;
  return v_updated;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- THE LABELLER. Decides what an unattributed sale actually was, in five
-- passes, each with its own evidence written into the row. Nothing here
-- guesses: a sale with no evidence keeps its blank and shows as unknown.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.adsv2_label_sale_origins(
  p_from date, p_to date, p_active_clients text[]
)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_labeled  integer := 0;
  v_stamped  integer := 0;
  v_resolved integer := 0;
  v_organic  integer := 0;
  v_nonad    integer := 0;
begin
  -- A) The DM came from an ad, but from a creator you no longer run.
  with cand as (
    select f.id,
      (select e.client_key from ads_keyword_events e
        where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
        order by e.event_at desc limit 1) as former_creator,
      (select e.keyword_normalized from ads_keyword_events e
        where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
        order by e.event_at desc limit 1) as kw
    from adsv2_sale_facts f
    where f.sale_et_day between p_from and p_to
      and f.blank_reason = 'unknown'
      and f.subscriber_id is not null
      and exists (select 1 from ads_keyword_events e
                   where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day)
      and not exists (select 1 from ads_keyword_events e
                   where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
                     and e.client_key = any(p_active_clients))
  ), upd as (
    update adsv2_sale_facts f
       set blank_reason = 'former_creator_ad',
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('former_creator', c.former_creator, 'keyword', c.kw,
                                   'labeled_by', 'adsv2_label_sale_origins')
      from cand c
     where c.id = f.id
    returning 1
  )
  select count(*)::integer into v_labeled from upd;

  -- B) This buyer only ever typed ONE keyword before buying. That is not a
  --    guess, it is the only possibility.
  with cand as (
    select f.id,
           min(e.keyword_normalized) as kw,
           min(e.client_key) as ck,
           min(e.event_at) as first_event
    from adsv2_sale_facts f
    join ads_keyword_events e
      on e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
    where f.sale_et_day between p_from and p_to
      and f.blank_reason = 'unknown'
      and f.subscriber_id is not null
      and not exists (select 1 from ads_keyword_events e2
                       where e2.subscriber_id = f.subscriber_id
                         and e2.event_at::date <= f.sale_et_day
                         and (e2.client_key is null or not (e2.client_key = any(p_active_clients))))
    group by f.id
    having count(distinct e.keyword_normalized) = 1
       and count(distinct e.client_key) = 1
  ), upd as (
    update adsv2_sale_facts f
       set evidence_key = 'subscriber_single_presale_keyword',
           keyword_normalized = c.kw,
           client_key = c.ck,
           blank_reason = null,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('subscriber', f.subscriber_id, 'keyword', c.kw,
                                   'first_keyword_at', c.first_event,
                                   'stamped_by', 'adsv2_label_sale_origins')
      from cand c
     where c.id = f.id
       and not exists (select 1 from organic_keywords o
                        where o.keyword_normalized = c.kw and o.client_key = c.ck)
    returning 1
  )
  select count(*)::integer into v_stamped from upd;

  -- C1) A human said which keyword it was. Human beats machine, always.
  with upd as (
    update adsv2_sale_facts f
       set evidence_key = 'human_resolution',
           keyword_normalized = r.keyword_normalized,
           client_key = r.client_key,
           blank_reason = null,
           awaiting_review = false,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('keyword', r.keyword_normalized, 'decided_by', r.resolved_by,
                                   'resolution_note', r.note, 'resolved_at', r.created_at)
      from adsv2_sale_resolutions r
     where r.sale_key = f.sale_key
       and f.sale_et_day between p_from and p_to
       and r.keyword_normalized is not null
       and (f.evidence_key is distinct from 'human_resolution' or f.awaiting_review)
    returning 1
  )
  select count(*)::integer into v_resolved from upd;

  -- C2) The keyword belongs to organic content, not a paid ad. Real revenue,
  --     but it must never be credited to ad spend.
  with upd as (
    update adsv2_sale_facts f
       set is_organic = true,
           method = 'organic',
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('organic_keyword', f.keyword_normalized,
                                   'organic_rule', 'registry_keywords type=organic',
                                   'flagged_by', 'adsv2_label_sale_origins')
     where f.sale_et_day between p_from and p_to
       and f.keyword_normalized is not null
       and f.client_key is not null
       and (f.is_organic = false or f.method is distinct from 'organic')
       and exists (select 1 from registry_keywords k
                    where k.type = 'organic'
                      and k.keyword_normalized = f.keyword_normalized
                      and k.client_key         = f.client_key)
    returning 1
  )
  select count(*)::integer into v_organic from upd;

  -- D) A human looked and said: this one did not come from an ad at all.
  with upd as (
    update adsv2_sale_facts f
       set evidence_key   = 'human_resolution',
           keyword_normalized = null,
           client_key     = r.client_key,
           blank_reason   = 'human_confirmed_non_ad',
           awaiting_review = false,
           is_organic     = false,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('decided_by', r.resolved_by,
                                   'resolution_note', r.note,
                                   'resolved_at', r.created_at,
                                   'confirmed_non_ad', true,
                                   'resolved_by_part', 'D')
             || case when f.keyword_normalized is not null
                     then jsonb_build_object('overrode_machine_keyword', f.keyword_normalized)
                     else '{}'::jsonb end
      from adsv2_sale_resolutions r
     where r.sale_key = f.sale_key
       and f.sale_et_day between p_from and p_to
       and r.keyword_normalized is null
       and (f.blank_reason is distinct from 'human_confirmed_non_ad'
            or f.awaiting_review
            or f.keyword_normalized is not null
            or f.evidence_key is distinct from 'human_resolution')
    returning 1
  )
  select count(*)::integer into v_nonad from upd;

  return v_labeled + v_stamped + v_resolved + v_organic + v_nonad;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- SELF-CHECK HELPERS. Read by /api/cron/ads-v2-selfcheck.
-- ─────────────────────────────────────────────────────────────────────────

-- Spend rows that were pulled in some timezone other than America/New_York.
-- Any number above zero means a day boundary somewhere does not mean what the
-- rest of the numbers assume it means.
create or replace function public.adsv2_unmarked_served_spend(p_clients text[])
returns bigint
language sql
stable
as $function$
  select count(*)::bigint
  from ads_meta_insights_daily
  where client_key = any(p_clients)
    and (raw_payload->>'reporting_timezone') is distinct from 'America/New_York';
$function$;

-- Facts that should have a setter's name and do not.
create or replace function public.adsv2_count_facts_missing_setter()
returns table(table_name text, rows bigint)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select 'adsv2_dm_facts'::text, count(*)
  from public.adsv2_dm_facts f
  join public.ads_keyword_events e on e.id::text = f.event_key
  where (f.setter_name is null or f.setter_name = '')
    and e.setter_name is not null and e.setter_name <> ''
  union all
  select 'adsv2_booking_facts'::text, count(*)
  from public.adsv2_booking_facts f
  where (f.setter_name is null or f.setter_name = '')
    and exists (
      select 1 from public.ads_keyword_events e
      where e.subscriber_id = (f.evidence->>'subscriber')
        and e.setter_name is not null and e.setter_name <> ''
    );
$function$;

-- A database cron job that makes its own HTTP calls is a second, invisible
-- scheduler nobody is watching. Every job here should be scheduled by the app.
-- Returns nothing when pg_cron is not installed, which is the normal case.
create or replace function public.adsv2_audit_cron_jobs()
returns table(jobid bigint, jobname text, schedule text, command text, violation text)
language plpgsql
security definer
set search_path to 'public', 'cron'
as $function$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  return query execute $q$
    select j.jobid, j.jobname, j.schedule, j.command, 'http_call'::text
    from cron.job j
    where j.command ~* 'net\.http|http_post|http_get|http\(|pg_net'
  $q$;
end;
$function$;
