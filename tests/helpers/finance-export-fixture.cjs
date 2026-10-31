// Synthetic data only. No real client details or production attachments.
const base={status:'Выполнена',completed_at:'2026-10-10T21:30:00Z',created_at:'2026-10-01T08:00:00Z',received_date:'2026-10-01',scheduled_date:'2026-10-11',master_agreed_at:'2026-10-02T09:00:00Z',source:'Авито',city:'Санкт-Петербург',master_staff_id:'m',master_name:'Тестовый мастер',client:'Тестовый клиент',phone:'+70000000000',address:'Тестовый адрес',extra_work_amount:0,uncompleted_work_amount:0,work:'Монтаж',report_upload_token:'synthetic-report'};
function fixture(){return {
 staff:[{id:'m',external_id:'staff_m',role:'master',full_name:'Тестовый мастер',is_active:true},{id:'n',external_id:'staff_n',role:'master',full_name:'Второй мастер',is_active:true}],
 orders:[
  {...base,id:'1',order_number:'00001',amount:1000,original_amount:1000,master_payout:600,work_items:[{name:'Монтаж',quantity:2,unit:'шт.',unit_price:500,amount:1000}]},
  {...base,id:'2',source:'Hands',amount:2000,original_amount:2000,master_payout:1105,extra_work_amount:300,extra_work_description:'Дополнительный крепёж',work:'Карниз × 2 шт.\nПодрезка × 2 пил.',work_items:[{name:'Карниз',quantity:2,unit:'шт.',unit_price:800,amount:1600},{name:'Подрезка',quantity:2,unit:'пил.',unit_price:200,amount:400}]},
  {...base,id:'3',source:'Руки',amount:800,original_amount:1000,master_payout:442,uncompleted_work_amount:200,uncompleted_work_items:[{service_id:'standard_020',name:'Подрезка',quantity:1,unit:'пил.',unit_price:200,amount:200}],work:'Подрезка карниза по длине × 5 пил.'},
  {...base,id:'4',source:'Лемана Про',external_source:'lemana_pro',amount:1000,original_amount:1000,master_payout:552.5,master_staff_id:'n',master_name:'Второй мастер'},
  {...base,id:'5',status:'В работе',amount:9000,master_payout:5400},
  {...base,id:'6',status:'Отменена',amount:5000,master_payout:3000},
  {...base,id:'7',amount:900,original_amount:1000,master_payout:540,comment:'Согласованная цена; отдельная скидка не хранится'},
 ],
 expenses:[{id:'e1',expense_date:'2026-10-11',category:'transport',amount:50,order_id:'1',comment:'Проезд',created_by_name:'Тестовый владелец'}, {id:'e2',expense_date:'2026-10-12',category:'rent',amount:100,comment:'Общий расход',created_by_name:'Тестовый владелец'}, {id:'e3',expense_date:'2026-09-01',category:'tools',amount:999,order_id:'1'}],
 filters:{period:{start:'2026-10-01',end:'2026-10-31'},master:'',source:'',city:'',work:''}
}}
module.exports={fixture};
