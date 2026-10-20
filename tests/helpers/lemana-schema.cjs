const fs=require('node:fs');
const owner='00000000-0000-4000-8000-000000000001',master='00000000-0000-4000-8000-000000000002';
const schema=`create role anon;create role authenticated;create role service_role;
create table business_staff(id uuid primary key,external_id text,full_name text,role text,is_active boolean);
create type order_status as enum('Новая','Назначена','В работе','Выполнена','Отменена');
create table orders(id bigint generated always as identity primary key,source text,external_source text,external_id text,created_at timestamptz default now(),updated_at timestamptz default now(),client text not null,address text not null,phone text,work text not null,status order_status default 'Новая',city text,master_staff_id uuid,master_name text,amount numeric,original_amount numeric,master_payout numeric,manager_payout numeric,dispatcher_payout numeric,scheduled_date date,scheduled_time time,created_by_vk_id text,sync_status text,source_updated_at timestamptz,report_review_status text,unique(external_source,external_id));
insert into business_staff values('${owner}','100','Владелец','owner',true),('${master}','staff_m','Тестовый мастер','master',true);
insert into orders(source,external_source,external_id,client,address,work,amount,original_amount,master_payout)values('Телефон','mini_app','app_old','Синтетический клиент','Тестовый адрес','Историческая работа',1000,1200,321);`;
const row=(number='00042')=>({order_number:number,external_id:number,external_source:'lemana_pro',source:'Лемана Про',client:'Синтетический клиент',phone:'+79990000001',address:'Тестовый адрес',work:'',amount:1000,original_amount:1000,master_payout:552.5,manager_payout:0,dispatcher_payout:0,master_staff_id:master,master_name:'Тестовый мастер',status:'Назначена',created_at:'2026-10-20T07:30:00Z',received_date:'2026-10-20',scheduled_date:'2026-10-21',scheduled_time:'12:00:00',city:'Тестовый город',amount_confirmed:true,lemana_import_meta:{timezone:'Europe/Moscow'}});
async function init(pg){await pg.exec(schema);await pg.exec(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));await pg.exec("update orders set order_number='manual-001' where id=1");await pg.exec(fs.readFileSync('supabase/migrations/20261020180000_lemana_import_work_items.sql','utf8'))}

module.exports={schema,row,init,owner,master};
