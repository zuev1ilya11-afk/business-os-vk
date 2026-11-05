# Client portal API contract v1

All JSON responses are `{ok:true,...}` or `{ok:false,error,code}` with HTTP status. Prefix `/client-api`. Public client entry `/client/`; staff integration uses same prefix, `x-bos-session` signed existing staff token. No client token is a staff token. Staff routes require owner/manager/dispatcher except catalog mutations owner/manager.

Client cookie is HttpOnly, SameSite=Strict, host-only. For ALL state-changing client routes after login pass `x-csrf-token` from `/session`; browser fetch credentials same-origin. POST auth routes require matching Origin as well. No client ID or role in payload.

## Auth/profile
- GET `/health` -> `{environment,delivery:'test'|'sms',ready}` (no secrets).
- GET `/session` -> `{authenticated:false}` or `{authenticated:true,profile,csrf_token}`. Profile `{id,name,phone,email,version,notification_preferences}`.
- POST `/auth/request` `{phone}` -> `{challenge_id,retry_after:60}`. Test code is delivered to a private local outbox, NEVER returned by HTTP or logged.
- POST `/auth/verify` `{challenge_id,code,consents:[{document:'privacy',version:'draft-2026-11-05'},{document:'terms',version:'draft-2026-11-05'},{document:'services',version:'draft-2026-11-05'}]}` -> session shape. Mandatory personal-data, terms and services documents from GET /documents are required; privacy is informational and marketing is optional. Required draft docs valid in isolated staging only. Existing clients need not repeat consent unless version changes.
- POST `/auth/logout` `{all_devices:boolean}` -> ok, clears cookie.
- POST `/auth/phone/request` `{phone}` -> challenge; requires session created within 5 minutes, otherwise 409 REAUTH_REQUIRED. Verify via `/auth/phone/verify` `{challenge_id,code}`; all sessions revoked and new issued.
- PATCH `/profile` `{version,name,email,notification_preferences:{in_app:true,push:false}}` -> `{profile}`; old version 409.
- GET `/addresses` -> `{addresses:[{id,label,address,entrance,floor,intercom,version}]}`; POST same fields without id -> `{address}`; PATCH `/addresses/:id` version+fields; DELETE `/addresses/:id`.
- POST `/privacy-requests` `{kind:'access'|'delete'|'correction',text,request_id}` -> `{request}`.
- GET `/documents` -> `{documents:[{document,version,title,body,reviewed:false}],public_launch_ready:false}`.

## Catalog/quote/order
- GET `/catalog?city=...` -> `{services:[{id,category,name,description,unit,price_type,price,conditions,city,version}],city:'Санкт-Петербург',timezone:'Europe/Moscow'}`. Types `fixed`,`from`,`unit`,`clarify`. Unconfirmed services published only as clarify.
- POST `/quote` `{items:[{service_id,quantity}],city,parameters:{length,height,wall_material,dismantling,completeness,additional_work}}` -> `{quote:{items:[{service_id,name,unit,quantity,unit_price,amount,price_type,conditions,catalog_version}],total:null|number,minimum_total:number,requires_clarification,calculation_version:1}}`. No price inputs accepted; all validated server-side. Quote public.
- POST `/orders` `{request_id,items,city,name,address,entrance,floor,intercom,description,comment,desired_date,desired_interval,parameters}` -> `{order,idempotent}`. Same request_id+same payload returns same order; changed payload 409. Desired time never confirmed.
- GET `/orders?limit=20&offset=0` -> `{orders,total,limit,offset}`.
- GET `/orders/:id` -> `{order}`.
- POST `/orders/:id/estimate/accept` `{version}` -> `{order}`.
- POST `/orders/:id/requests` `{request_id,type:'reschedule'|'cancel'|'warranty',text,desired_date,desired_interval}` -> `{request}`. Warranty only completed; never new order/payout. Cancellation/reschedule requests do not directly change order status.
- POST `/orders/:id/repeat` `{request_id}` -> `{order}`; re-quotes current catalog into a NEW payable order with no confirmed schedule/master (UI should prefer prefill + normal create for address review).

Order safe DTO: `{id,number,created_at,status,status_label,address,entrance,floor,intercom,city,timezone,description,comment,work_items,preliminary:{total,minimum_total,requires_clarification},estimate:null|{version,items,total,conditions,accepted_at},final_total:null|number,desired_date,desired_interval,visit:null|{date,time,interval},master:null|{name,photo_url,specialization},events:[{id,type,text,created_at}],requests:[...],attachments:[{id,name,mime,size,url}],unread_count,version}`. `visit` only if master_agreed_at confirms it. IDs are strings. No internal comments, finance/payroll or staff records.

## Messages/files
- GET `/messages?order_id=...&after=0` -> `{messages:[{id,order_id,body,sender:'client'|'company',created_at,attachments:[]}],unread_count}`. Omit order_id for general company conversation. Paginates max 100 chronological; `after` ID for next page. GET does NOT mark read.
- POST `/messages` `{request_id,order_id?:string,body}` -> `{message,idempotent}`.
- POST `/messages/read` `{order_id?:string,through_id}` -> ok. Cannot mark other clients' messages.
- POST `/orders/:id/attachments` `{name,mime,data_base64}` -> `{attachment}`. Photos JPEG/PNG/WebP, max 5 MB input and 10 per order, actual image decoded/reencoded to strip metadata; no SVG/HTML/GIF. Auth URL `/client-api/attachments/:id` no public storage paths.

## Staff
All `/staff` endpoints use x-bos-session, no cookie session accepted. For staging-only browser login an independently generated synthetic staff credential exists outside this API. API recognizes normal signed staff session format using isolated VK_APP_SECRET and business_staff.
- GET `/staff/orders?limit=20&offset=0` -> `{orders,total}` safe DTO plus `{client:{id,name,phone},internal_status,master_staff_id,updated_at}`.
- GET `/staff/orders/:id` -> `{order}` same.
- GET `/staff/masters` -> `{masters:[{id,name,specialization}]}`.
- PATCH `/staff/orders/:id` `{version,master_staff_id?,visit?:{date,time,interval}}` -> `{order}`. Assignment and visit supported in local real DB, audited. No completion route: existing report workflow owns completion.
- POST `/staff/orders/:id/estimates` `{version,items:[{name,unit,quantity,unit_price}],conditions}` -> `{order}`. version = current order.version optimistic guard; server derives total, accepted_at resets.
- POST `/staff/orders/:id/link` `{client_id,verification_note,version}` attaches exact old order after explicit staff verification; no phone-match import.
- GET `/staff/messages?order_id=...&client_id=...&after=0` -> messages; client_id required for general thread, order id resolves account otherwise.
- POST `/staff/messages` `{request_id,order_id?:string,client_id?:string,body}` -> `{message}`.
- POST `/staff/messages/read` `{order_id?,client_id?,through_id}`.
- GET `/staff/requests` -> `{requests:[...]}` pending requests including privacy; POST `/staff/requests/:id/resolve` `{version,status:'accepted'|'declined',response}` -> `{request}`. Accepted cancel sets only active order status canceled; accepted reschedule requires separate PATCH visit. Warranty resolution never changes finance.
- GET `/staff/catalog` -> `{services}` incl unpublished; POST `/staff/catalog` service fields incl `published` -> `{service}`; PATCH `/staff/catalog/:id` `{version,...fields}` -> `{service}`. Catalog writes only leadership. Price numeric >=0 for fixed/from/unit; null for clarify. `confirmed:true` required before publishing priced services.
- POST `/staff/masters/:id/public-profile` `{name,specialization,photo_url}` sets explicit safe public card; no auto exposure of private phone.
- GET `/staff/clients?q=...` -> `{clients:[{id,name,phone}]}` only explicit management lookup, limit 20. No bulk historical matching.

## Implemented contract additions

- Schema current version 5. Ordered migrations: `20261105150000_client_portal.sql`, `20261105153000_client_documents.sql`, `20261105154000_client_notification_leases.sql`, `20261105155000_client_price_events.sql`, `20261105160000_client_message_attachments.sql`.
- GET `/unread` -> `{count,order_count,general_count}` across the authenticated account.
- GET `/privacy-requests` -> own `{requests}`; staff replies are also persisted general company messages.
- POST `/attachments` uploads to the customer's general thread. Same body/decoder/limits as order upload. All upload endpoints accept optional `request_id` for exact retry idempotency.
- POST `/staff/attachments` uses `{client_id,order_id?,name,mime,data_base64,request_id?}`. Staff downloads use GET `/staff/attachments/:id` with x-bos-session, then a private blob URL.
- POST `/messages` and `/staff/messages` accept `attachment_ids:[id,...]`, including an empty array. Files must match account+thread and can be bound to one message only. Body may be empty when photos are present. GET messages returns actual attachment metadata.
- GET `/staff/threads` returns client/order threads including general support; customer phone and private profile are never disclosed to other customers.
- DTO includes original safe `parameters` and customer description for repeat-order prefill. Repeat endpoint re-quotes current catalog while preserving clarification parameters; no assignment/confirmed visit is copied.
- If a legacy staff edit changes accepted amount/items, `price_review_required:true`, `estimate.current:false`, `estimate.requires_reapproval:true`; historic accepted_at is retained. Reaccepting that outdated version returns409; staff must send a new estimate.
- Bodyless DELETE is supported; CSRF remains mandatory.
- Prices for staged synthetic fixtures are not commercial recommendations. Public catalog defaults to clarification until an authorized leader confirms a numeric price.
