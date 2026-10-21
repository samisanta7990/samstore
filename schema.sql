-- Supabase SQL Editor ውስጥ ሙሉውን ለጥፈው Run ይጫኑ
create table catalog(id serial primary key, cat text not null, plat text, title text not null, label text not null, price int not null);
create table orders(
 id bigserial primary key,
 code text unique not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
 cat text, product text not null, package text not null, amount int not null, info text not null,
 status text not null default 'pending', txn_id text, receipt_path text,
 claimed_by uuid, claimed_by_name text, created_at timestamptz default now());
create unique index orders_txn on orders(txn_id) where txn_id is not null and status<>'rejected';
alter table catalog enable row level security;
alter table orders enable row level security;
create policy cat_read on catalog for select using (true);
create policy adm_sel on orders for select to authenticated using (true);

insert into catalog(cat,plat,title,label,price)
select 'ef','All Region','eFootball Coins - All Region',a||' Coins',b from unnest(array[130,300,550,750,1040,2130,3250,5700],array[300,550,950,1300,1800,3400,4800,7900]) t(a,b);
insert into catalog(cat,plat,title,label,price)
select 'ef','Japan Region','eFootball Coins - Japan Region',a||' Coins',b from unnest(array[137,315,578,788,1092,2237,3413,5985],array[300,550,950,1300,1800,3400,4800,7900]) t(a,b);
insert into catalog(cat,title,label,price)
select 'pubg','PUBG UC',a||' UC',b from unnest(array[60,325,660,985,1320,1800,2460,3850,5650,8100,11950,16200,24300,32400],array[220,880,1720,2780,3550,4180,5900,8650,13000,17200,25500,34000,51500,68500]) t(a,b);
insert into catalog(cat,title,label,price)
select 'ff','Free Fire Diamonds',a||' Diamonds',b from unnest(array[110,231,341,462,583,693,1188,2420],array[180,375,550,750,935,1120,1840,3750]) t(a,b);
insert into catalog(cat,title,label,price) values('gem','Gemini Premium','18 ወር',350);

create function create_order(p_id int,p_info text) returns text language plpgsql security definer set search_path=public as $$
declare c catalog; r text;
begin
 select * into c from catalog where id=p_id;
 if not found or length(coalesce(p_info,''))<1 or length(p_info)>200 then raise exception 'BAD'; end if;
 insert into orders(cat,product,package,amount,info) values(c.cat,c.title,c.label,c.price,trim(p_info)) returning code into r;
 return r;
end$$;

create function attach_receipt(p_code text,p_txn text,p_path text) returns void language plpgsql security definer set search_path=public as $$
begin
 update orders set txn_id=upper(trim(p_txn)),receipt_path=p_path,status='awaiting_review' where code=upper(p_code) and status='pending';
 if not found then raise exception 'NOORDER'; end if;
exception when unique_violation then raise exception 'DUP';
end$$;

create function get_order(p_code text) returns json language sql security definer set search_path=public as $$
 select to_json(o) from (select code,product,package,amount,status,created_at from orders where code=upper(p_code)) o $$;

create function review_order(p_id bigint,p_ok boolean) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH'; end if;
 update orders set status=case when p_ok then 'approved' else 'rejected' end where id=p_id and status='awaiting_review';
 return found;
end$$;

create function claim_order(p_id bigint) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH'; end if;
 update orders set claimed_by=auth.uid(),claimed_by_name=split_part(auth.jwt()->>'email','@',1)
  where id=p_id and status='approved' and claimed_by is null;
 return found;
end$$;

create function deliver_order(p_id bigint) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH'; end if;
 update orders set status='delivered',info=case when cat='ef' then '[ተሰርዟል]' else info end
  where id=p_id and status='approved' and claimed_by=auth.uid();
 return found;
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,5242880,array['image/jpeg']) on conflict do nothing;
create policy rc_up on storage.objects for insert to anon,authenticated with check(bucket_id='receipts');
create policy rc_rd on storage.objects for select to authenticated using(bucket_id='receipts');
