// Shared catalogue: the existing prices and units, consumed by browser and server.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_PRICE_CATALOG=api;})(typeof window==='undefined'?globalThis:window,function(){
const standard=[
{id:'standard_001',n:'Замер помещения. Выезд на объект, составление обмерного плана.',u:'выезд',p:1500},
{id:'standard_002',n:'Выезд за пределы города (в одну сторону за каждый км)',u:'км',p:70},
{id:'standard_003',n:'Минимальная стоимость выезда мастера',u:'',p:2800},
{id:'standard_004',n:'Повторный выезд по вине магазина',u:'выезд',p:1200},
{id:'standard_005',n:'Установка декоративного карниза длиной до 2,5 метров',u:'комплект',p:1699},
{id:'standard_006',n:'Установка декоративного карниза длиной до 3,5 метров',u:'комплект',p:2229},
{id:'standard_007',n:'Установка декоративного карниза длиной более 3,5 метров',u:'пог. м',p:999},
{id:'standard_008',n:'Установка горизонтальных жалюзи на створку окна',u:'комплект',p:1005},
{id:'standard_009',n:'Монтаж рулонной шторы / день-ночь на стену, потолок или в проём',u:'комплект',p:1340},
{id:'standard_010',n:'Установка рулонной шторы / день-ночь на створку окна',u:'комплект',p:1199},
{id:'standard_011',n:'Монтаж римской шторы на стену / потолок',u:'комплект',p:1290},
{id:'standard_012',n:'Монтаж вертикальных жалюзи на стену / потолок',u:'п.м.',p:1270},
{id:'standard_013',n:'Монтаж горизонтальных жалюзи на стену / потолок',u:'',p:null},
{id:'standard_014',n:'Монтаж шторы плиссе',u:'комплект',p:1199},
{id:'standard_015',n:'Установка декоративного крючка / подхвата',u:'шт',p:180},
{id:'standard_016',n:'Установка бленды',u:'п.м.',p:300},
{id:'standard_017',n:'Демонтаж декоративного крючка или подхвата',u:'шт',p:80},
{id:'standard_018',n:'Демонтаж карниза',u:'шт',p:400},
{id:'standard_019',n:'Демонтаж рулонных штор, римских штор и жалюзи всех видов',u:'шт',p:250},
{id:'standard_020',n:'Подрезка карниза по длине',u:'пил.',p:200},
{id:'standard_021',n:'Эркерное соединение карниза',u:'шт',p:250},
{id:'standard_022',n:'Монтаж направляющих для рулонной шторы',u:'комплект',p:580},
{id:'standard_023',n:'Монтаж дополнительной точки крепления декоративного карниза',u:'шт',p:380},
{id:'standard_024',n:'Доплата за работы на высоте более 3 метров',u:'п.м.',p:550},
{id:'standard_025',n:'Подрезка гладкой светопроницаемой рулонной шторы',u:'шт.',p:750},
{id:'standard_026',n:'Подрезка рулонной шторы Блэкаут',u:'шт.',p:750},
{id:'standard_027',n:'Подрезка рулонной шторы день-ночь',u:'шт.',p:750},
{id:'standard_028',n:'Установка магнита для нижней фиксации рулонной шторы / жалюзи',u:'точка',p:200},
{id:'standard_029',n:'Подрезка ламелей вертикальных жалюзи',u:'шт.',p:50},
{id:'standard_030',n:'Монтаж ламелей',u:'шт.',p:150},
{id:'standard_031',n:'Монтаж декоративного короба рулонной шторы',u:'шт.',p:550},
{id:'standard_032',n:'Подрезка декоративного короба рулонной шторы',u:'пил.',p:440},
{id:'standard_033',n:'Монтаж внешнего угла-поворота для карниза',u:'шт.',p:380},
{id:'standard_034',n:'Средство подмащивания для высоты от 3 метров',u:'шт.',p:830}
];
const avito={"version":"2026-09-30","title":"Авито — Санкт-Петербург и Ленинградская область","currency":"RUB","regions":["Санкт-Петербург","Ленинградская область"],"priceMode":"from","minimumVisitPrice":null,"travelFee":null,"materialsIncluded":null,"categories":[{"id":"plumbing","name":"Сантехника"},{"id":"electrical","name":"Электрика"},{"id":"handyman","name":"Мастер на час"}],"services":[{"id":"dishwasher_washer","category":"plumbing","name":"Установка и подключение посудомойки, стиральной машины","fromPrice":1500},{"id":"water_heater","category":"plumbing","name":"Установка водонагревателя","fromPrice":2000},{"id":"mixer","category":"plumbing","name":"Установка и замена смесителя","fromPrice":1000},{"id":"toilet","category":"plumbing","name":"Установка и подключение унитаза","fromPrice":2000},{"id":"bath","category":"plumbing","name":"Установка и подключение ванны","fromPrice":3500},{"id":"shower_cabin","category":"plumbing","name":"Сборка и установка душевой кабины","fromPrice":5000},{"id":"installation_frame","category":"plumbing","name":"Сборка и установка каркаса инсталляции","fromPrice":2500,"note":"Цена указана за 2,5 м, далее каждый 1 м + 500 ₽. Размер и применимость расчёта уточнить.","requiresReview":true},{"id":"tap","category":"plumbing","name":"Замена крана","fromPrice":700},{"id":"flexible_hose","category":"plumbing","name":"Монтаж и демонтаж гибкой подводки","fromPrice":700},{"id":"shower_switch","category":"plumbing","name":"Ремонт переключателя душа","fromPrice":500},{"id":"shower_rail","category":"plumbing","name":"Установка штанги для душа","fromPrice":700},{"id":"sealant","category":"plumbing","name":"Герметизация ванны, мойки-раковины, душевой кабины или поддона","fromPrice":2000},{"id":"shower_tray","category":"plumbing","name":"Демонтаж и монтаж душевого поддона","fromPrice":2100},{"id":"filter","category":"plumbing","name":"Замена фильтра грубой и тонкой очистки","fromPrice":1500},{"id":"tee","category":"plumbing","name":"Установка тройника","fromPrice":1000},{"id":"manifold","category":"plumbing","name":"Установка коллектора","fromPrice":3000},{"id":"socket_install","category":"electrical","name":"Установка розеток и выключателей","fromPrice":300},{"id":"data_socket","category":"electrical","name":"Установка компьютерной, антенной, телефонной розетки","fromPrice":500},{"id":"cable_channel","category":"electrical","name":"Установка кабель-каналов","fromPrice":400},{"id":"chandelier","category":"electrical","name":"Сборка и установка люстры","fromPrice":1200},{"id":"light_fixture","category":"electrical","name":"Сборка и установка настенных и потолочных светильников, бра","fromPrice":1200},{"id":"breaker","category":"electrical","name":"Установка и подключение автомата","fromPrice":500},{"id":"electrical_panel","category":"electrical","name":"Установка и монтаж распределительного щита","fromPrice":2000},{"id":"panel_niche","category":"electrical","name":"Устройство ниши под электрощит","fromPrice":2000},{"id":"socket_replace","category":"electrical","name":"Замена розетки/выключателя","fromPrice":300},{"id":"switch_block","category":"electrical","name":"Замена блока выключателей туалет/ванна/кухня","fromPrice":850},{"id":"curtain_rod","category":"handyman","name":"Установка карнизов","fromPrice":1500},{"id":"tv_bracket","category":"handyman","name":"Монтаж кронштейнов для ТВ","fromPrice":800},{"id":"pull_up_bar","category":"handyman","name":"Установка турников","fromPrice":1000},{"id":"shelf","category":"handyman","name":"Навеска полок на стену","fromPrice":500},{"id":"wall_cabinet","category":"handyman","name":"Установка навесных шкафов","fromPrice":800},{"id":"mirror","category":"handyman","name":"Установка зеркала на стену","fromPrice":500},{"id":"dryer","category":"handyman","name":"Установка сушилки для белья","fromPrice":500},{"id":"vent_grille","category":"handyman","name":"Установка вентиляционных решёток","fromPrice":500},{"id":"drilling","category":"handyman","name":"Сверление отверстий","fromPrice":200},{"id":"plumbing_general","category":"handyman","name":"Установка унитаза, раковин, смесителей, ванн","fromPrice":1000,"note":"Общая позиция. Для конкретной услуги используйте соответствующую цену раздела «Сантехника».","requiresReview":true},{"id":"furniture","category":"handyman","name":"Ремонт, сборка мебели","fromPrice":1000}]};
return {version:'2026-10-01',standard,avito};
});
