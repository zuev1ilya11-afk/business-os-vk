-- Synthetic LOCAL staging contract, NEVER a production migration.
-- Tables are reconstructed from checked-in Edge contracts and additive migrations.
-- This is not a claim that the inaccessible production schema was inspected.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE business_staff (
 id uuid PRIMARY KEY,external_id text UNIQUE NOT NULL,full_name text NOT NULL,
 role text NOT NULL,is_active boolean NOT NULL DEFAULT true,phone text,city text,
 login text UNIQUE,password_hash text,has_password boolean DEFAULT true,
 specialization text,district text,avatar_url text,comment text,work_start text,work_end text,
 last_seen_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()
);
CREATE TABLE orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,external_source text,external_id text,
 source text,client text NOT NULL,phone text,address text NOT NULL,city text,work text NOT NULL,
 status text NOT NULL DEFAULT 'Новая' CHECK(status IN ('Новая','Назначена','В работе','Выполнена','Отменена','Рекламация')),
 master_staff_id uuid REFERENCES business_staff(id),master_name text,master_id uuid,
 amount numeric NOT NULL DEFAULT 0,original_amount numeric NOT NULL DEFAULT 0,
 master_payout numeric DEFAULT 0,manager_payout numeric DEFAULT 0,dispatcher_payout numeric DEFAULT 0,
 scheduled_date date,scheduled_time time,time_slot text,comment text,
 created_by_vk_id text,sync_status text,source_updated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 extra_work_done boolean DEFAULT false,extra_work_amount numeric DEFAULT 0,extra_work_description text,
 uncompleted_work_done boolean DEFAULT false,uncompleted_work_amount numeric DEFAULT 0,uncompleted_work_description text,
 wall_over_3m boolean DEFAULT false,wall_material text,possible_extra_work boolean DEFAULT false,
 report_review_status text DEFAULT 'not_submitted',report_type text,report_act_url text,report_measurement_url text,
 report_photo_urls text DEFAULT '[]',report_uploaded_at timestamptz,report_upload_token text,
 report_archive_url text,report_reviewed_by text,report_reviewed_at timestamptz,report_review_comment text,
 drive_archive_status text,drive_archive_folder_id text,drive_archive_url text,drive_archive_error text,drive_archived_at timestamptz,
 completed_at timestamptz,order_type text,apartment text,hands_comment_source text,hands_detail_overrides jsonb,
 is_claim boolean NOT NULL DEFAULT false,claim_opened_at timestamptz,claim_closed_at timestamptz,
 claim_parent_order_id bigint,claim_visit_no integer DEFAULT 0,claim_revisit_payment numeric DEFAULT 0,
 master_contact_control_active boolean DEFAULT false,
 master_reschedule_requested_at timestamptz,master_reschedule_requested_date date,
 master_reschedule_requested_time time,master_reschedule_reason text,master_reschedule_requested_by uuid,
 avito_chat_id text,avito_item_id text,avito_item_url text,
 UNIQUE(external_source,external_id)
);
CREATE TABLE staff_schedule(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,staff_id uuid REFERENCES business_staff(id),work_date date,status text,work_start text,work_end text,comment text,updated_at timestamptz DEFAULT now(),UNIQUE(staff_id,work_date));
CREATE TABLE order_claims(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id bigint REFERENCES orders(id),master_staff_id uuid,reason text,revisit_payment numeric DEFAULT 0,status text,opened_at timestamptz,closed_at timestamptz,opened_by text);
CREATE TABLE master_memo_materials(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,section text,title text,content text,sort_order integer DEFAULT 0,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
CREATE TABLE stage_login_attempts(key_hash text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE stage_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
